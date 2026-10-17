// Stores AI summaries and works through a queue of sessions and projects
// that need one, one AI call at a time. Summaries cost the person quota or
// money, so the automatic ones are rationed: a session is summarized once it
// has been quiet for a while, a project at most every half hour, at most a
// handful per scan and a set number per day. Asking from the page skips all
// of that, except folders the person said must never go to an AI.

import { buildDigest, readConversation, stamp } from './digest.js';
import { normalizePath } from './projects.js';
import { PROJECT_PROMPT, SESSION_PROMPT, SummarizerError, digestChars, runSummary, summaryModel } from './summarizer.js';
import { sessionTitle } from './session-state.js';
import { adapterFor } from './sources/index.js';

// How long the whole queue waits after an error that would fail every call.
// local_only waits for the person to change the setting or ask again.
const PAUSE_MS = { auth: 30 * 60 * 1000, rate_limit: 30 * 60 * 1000, missing_cli: 2 * 60 * 1000, local_only: 24 * 3600 * 1000 };
const IDLE_MS = 15 * 60 * 1000;
const PROJECT_EVERY_MS = 30 * 60 * 1000;
const AUTO_PER_SCAN = 20;
const RETRY_AFTER_ERROR_MS = 60 * 60 * 1000;
const PROJECT_INPUT_SESSIONS = 8;

/** Time of the newest message in a session, which a summary is measured against. */
export function contentTs(s) {
	const a = s.last_human_ts ?? '', b = s.last_assistant_ts ?? '';
	return (a > b ? a : b) || null;
}

export function getSummary(db, kind, ref) {
	const row = db.raw.prepare('SELECT * FROM summaries WHERE kind = ? AND ref = ?').get(kind, ref);
	if (!row) return null;
	return {
		data: row.json ? JSON.parse(row.json) : null,
		source_ts: row.source_ts,
		created_at: row.created_at,
		error: row.error,
		error_kind: row.error_kind,
		error_at: row.error_at,
	};
}

function saveSummary(db, kind, ref, { summary, costUsd, usage, sourceTs, model }) {
	db.raw.prepare(`INSERT INTO summaries (kind, ref, source_ts, json, model, cost_usd, tokens_in, tokens_out, created_at, error, error_kind, error_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
		ON CONFLICT(kind, ref) DO UPDATE SET source_ts = excluded.source_ts, json = excluded.json, model = excluded.model,
			cost_usd = excluded.cost_usd, tokens_in = excluded.tokens_in, tokens_out = excluded.tokens_out,
			created_at = excluded.created_at, error = NULL, error_kind = NULL, error_at = NULL`)
		.run(kind, ref, sourceTs, JSON.stringify(summary), model, costUsd ?? 0, usage?.in ?? null, usage?.out ?? null, new Date().toISOString());
}

/** Summaries made or tried since local midnight, and the tokens they used. */
export function todayUse(db, now = Date.now()) {
	const midnight = new Date(now);
	midnight.setHours(0, 0, 0, 0);
	const since = midnight.toISOString();
	return db.raw.prepare(`SELECT
		SUM(CASE WHEN created_at >= ? OR error_at >= ? THEN 1 ELSE 0 END) AS calls,
		SUM(CASE WHEN created_at >= ? THEN COALESCE(tokens_in, 0) + COALESCE(tokens_out, 0) ELSE 0 END) AS tokens
		FROM summaries`).get(since, since, since);
}

function saveError(db, kind, ref, error) {
	db.raw.prepare(`INSERT INTO summaries (kind, ref, error, error_kind, error_at) VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(kind, ref) DO UPDATE SET error = excluded.error, error_kind = excluded.error_kind, error_at = excluded.error_at`)
		.run(kind, ref, error.message, error.kind ?? 'failed', new Date().toISOString());
}

function sessionRow(db, id) {
	return db.raw.prepare(`SELECT s.*, p.name AS project_name FROM sessions s
		LEFT JOIN projects p ON p.key = s.project_key WHERE s.id = ?`).get(id);
}

const STATUS_TH = { done: 'เสร็จแล้ว', in_progress: 'ยังทำค้าง', blocked: 'ติดปัญหา', waiting: 'รออยู่', abandoned: 'เลิกทำ' };

function projectInput(db, key) {
	const project = db.raw.prepare('SELECT * FROM projects WHERE key = ?').get(key);
	const rows = db.raw.prepare(`
		SELECT s.*, a.label AS account_label, m.json, m.source_ts
		FROM sessions s
		JOIN summaries m ON m.kind = 'session' AND m.ref = s.id AND m.json IS NOT NULL
		LEFT JOIN accounts a ON a.uuid = s.account_uuid
		WHERE s.project_key = ? AND s.is_automated = 0
		ORDER BY s.last_ts DESC LIMIT ?`).all(key, PROJECT_INPUT_SESSIONS);
	if (!project || !rows.length) return null;

	// Western dates, so deadlines come back as real ones.
	const lines = [`โปรเจค: ${project.name} (${project.path})`, ''];
	for (const r of rows) {
		const s = JSON.parse(r.json);
		lines.push(`## ${sessionTitle(r)}`);
		lines.push(`เครื่องมือ: ${adapterFor(r.tool).label}, บัญชี: ${r.account_label ?? 'ไม่ทราบ'}, ช่วงเวลา: ${stamp(r.first_ts)} ถึง ${stamp(r.last_ts)}, สถานะ: ${STATUS_TH[s.status] ?? s.status}`);
		lines.push(`สรุป: ${s.headline}`);
		for (const [label, list] of [['ทำเสร็จ', s.done], ['ค้างอยู่', s.in_progress], ['ขั้นต่อไป', s.next_steps], ['รออยู่', s.waiting_on]]) {
			if (list?.length) lines.push(`${label}: ${list.join('; ')}`);
		}
		for (const d of s.deadlines ?? []) lines.push(`กำหนด: ${d.date ?? 'ไม่ระบุวัน'} ${d.text}`);
		lines.push('');
	}
	const sourceTs = rows.map(r => r.source_ts).filter(Boolean).sort().pop() ?? null;
	return { input: lines.join('\n'), sourceTs };
}

// onDone runs after each summary is saved or fails, so open pages can show it.
export function createSummaryQueue({ db, config, run = runSummary, log = () => {}, now = Date.now, onDone = () => {} }) {
	const queue = [];
	const queued = new Set();
	let running = null;
	let paused = null; // { until, kind, message }
	let lastError = null;

	const keyOf = (kind, ref) => `${kind}:${ref}`;

	/** Folders the person said must never be sent to an AI, matched like exclude. */
	function neverSend(folder) {
		if (!folder) return false;
		const lower = normalizePath(folder).toLowerCase();
		return (config.summary.neverSend ?? []).some(f => {
			const prefix = normalizePath(f).toLowerCase();
			return prefix && (lower === prefix || lower.startsWith(`${prefix}/`));
		});
	}

	function enqueue(kind, ref, { manual = false } = {}) {
		const key = keyOf(kind, ref);
		// Asking from the page means the person wants to try again now.
		if (manual) paused = null;
		const waiting = queue.find(i => i.key === key);
		if (waiting && manual) waiting.manual = true;
		if (!queued.has(key) && running?.key !== key) {
			queued.add(key);
			const item = { kind, ref, key, manual };
			if (manual) queue.unshift(item);
			else queue.push(item);
		}
		setImmediate(pump);
	}

	const capped = () => todayUse(db, now()).calls >= (config.summary.dailyLimit ?? 60);

	const NEVER_SEND = 'โฟลเดอร์นี้ตั้งไว้ในหน้าตั้งค่าว่าห้ามส่งให้ AI จึงไม่ได้สรุป';

	async function summarizeSession(id) {
		const s = sessionRow(db, id);
		if (!s) return;
		if (neverSend(s.cwd)) throw new SummarizerError(NEVER_SEND, 'never_send');
		const adapter = adapterFor(s.tool);
		const digest = buildDigest(s, readConversation(s.jsonl_path, adapter), { maxChars: digestChars(config.summary), adapter });
		const out = await run({ system: SESSION_PROMPT, input: digest, config });
		saveSummary(db, 'session', id, { ...out, sourceTs: contentTs(s), model: summaryModel(config.summary) });
		if (s.project_key && !s.is_automated) enqueue('project', s.project_key);
	}

	async function summarizeProject(key, manual) {
		const path = db.raw.prepare('SELECT path FROM projects WHERE key = ?').get(key)?.path;
		if (neverSend(path)) throw new SummarizerError(NEVER_SEND, 'never_send');
		const input = projectInput(db, key);
		if (!input) return;
		const current = getSummary(db, 'project', key);
		if (current?.data && current.source_ts && current.source_ts >= input.sourceTs) return;
		// A busy project would be summarized after every session; once in a while is enough.
		if (!manual && current?.created_at && now() - Date.parse(current.created_at) < PROJECT_EVERY_MS) return;
		const out = await run({ system: PROJECT_PROMPT, input: input.input, config });
		saveSummary(db, 'project', key, { ...out, sourceTs: input.sourceTs, model: summaryModel(config.summary) });
	}

	async function pump() {
		if (running || !queue.length) return;
		if (paused && paused.until > now()) return;
		paused = null;
		// Past the daily limit only what the person asked for runs.
		if (!queue[0].manual && capped()) {
			const asked = queue.findIndex(i => i.manual);
			if (asked < 0) return;
			queue.unshift(queue.splice(asked, 1)[0]);
		}
		const item = queue.shift();
		queued.delete(item.key);
		running = item;
		try {
			if (item.kind === 'session') await summarizeSession(item.ref);
			else await summarizeProject(item.ref, item.manual);
			lastError = null;
		}
		catch (error) {
			lastError = { kind: error.kind ?? 'failed', message: error.message, at: new Date(now()).toISOString() };
			log(`summary ${item.key} failed: ${error.message}`);
			saveError(db, item.kind, item.ref, error);
			// These stop every later call too, so wait instead of failing each one.
			// A missing CLI is often the CLI updating itself, so that wait is short.
			if (PAUSE_MS[error.kind]) {
				// A provider that says how long to wait knows better than our guess.
				paused = { until: now() + (error.retryAfterMs ?? PAUSE_MS[error.kind]), kind: error.kind, message: error.message };
				queue.unshift(item);
				queued.add(item.key);
			}
		}
		finally {
			running = null;
			onDone();
		}
		setImmediate(pump);
	}

	/** Queues sessions with new messages since their summary, within autoDays. */
	function enqueueStale() {
		// Nothing is sent anywhere until the person has gone through the setup page.
		if (!config.summary.enabled || config.setup === 'pending') return 0;
		const since = new Date(now() - config.summary.autoDays * 86400000).toISOString();
		const rows = db.raw.prepare(`
			SELECT s.id, s.cwd, s.last_human_ts, s.last_assistant_ts, m.source_ts, m.json, m.error_at
			FROM sessions s LEFT JOIN summaries m ON m.kind = 'session' AND m.ref = s.id
			WHERE s.is_automated = 0 AND s.human_turns > 0
				AND MAX(COALESCE(s.last_human_ts, ''), COALESCE(s.last_assistant_ts, '')) >= ?
			ORDER BY MAX(COALESCE(s.last_human_ts, ''), COALESCE(s.last_assistant_ts, '')) DESC`).all(since);
		let added = 0;
		for (const r of rows) {
			if (added >= AUTO_PER_SCAN) break;
			const fresh = r.json && r.source_ts && r.source_ts >= contentTs(r);
			const recentError = r.error_at && now() - Date.parse(r.error_at) < RETRY_AFTER_ERROR_MS;
			// A session still being worked on would be summarized after every message.
			const active = now() - Date.parse(contentTs(r)) < IDLE_MS;
			if (fresh || recentError || active || queued.has(keyOf('session', r.id)) || neverSend(r.cwd)) continue;
			enqueue('session', r.id);
			added += 1;
		}
		// Projects whose sessions have newer summaries than the project itself,
		// for example after a restart cut the queue short.
		const projects = db.raw.prepare(`
			SELECT s.project_key AS key FROM summaries m JOIN sessions s ON s.id = m.ref
			LEFT JOIN summaries pm ON pm.kind = 'project' AND pm.ref = s.project_key
			WHERE m.kind = 'session' AND m.json IS NOT NULL AND s.is_automated = 0 AND s.project_key IS NOT NULL
			GROUP BY s.project_key
			HAVING MAX(pm.json) IS NULL OR MAX(m.source_ts) > MAX(COALESCE(pm.source_ts, ''))`).all();
		for (const p of projects) {
			if (queued.has(keyOf('project', p.key))) continue;
			const current = getSummary(db, 'project', p.key);
			if (current?.error_at && now() - Date.parse(current.error_at) < RETRY_AFTER_ERROR_MS) continue;
			enqueue('project', p.key);
			added += 1;
		}
		// Also resumes a queue that was paused and whose pause has run out.
		setImmediate(pump);
		return added;
	}

	function status() {
		return {
			enabled: config.summary.enabled,
			provider: config.summary.provider === 'api' ? 'api' : 'claude',
			running: running ? { kind: running.kind, ref: running.ref } : null,
			pending: queue.map(i => ({ kind: i.kind, ref: i.ref })),
			paused: paused && paused.until > now() ? paused : null,
			last_error: lastError,
			today: todayUse(db, now()),
			dailyLimit: config.summary.dailyLimit ?? 60,
			capped: capped(),
		};
	}

	const isBusy = (kind, ref) => running?.key === keyOf(kind, ref) || queued.has(keyOf(kind, ref));

	return { enqueue, enqueueStale, status, isBusy, idle: () => !running && !queue.length };
}
