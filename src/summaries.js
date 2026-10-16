// Stores AI summaries and works through a queue of sessions and projects
// that need one, one claude call at a time.

import { buildDigest, readConversation } from './digest.js';
import { PROJECT_PROMPT, SESSION_PROMPT, runSummary, summaryModel } from './summarizer.js';
import { sessionTitle } from './session-state.js';
import { adapterFor } from './sources/index.js';

const PAUSE_MS = { auth: 30 * 60 * 1000, rate_limit: 30 * 60 * 1000, missing_cli: 2 * 60 * 1000 };
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

function saveSummary(db, kind, ref, { summary, costUsd, sourceTs, model }) {
	db.raw.prepare(`INSERT INTO summaries (kind, ref, source_ts, json, model, cost_usd, created_at, error, error_kind, error_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)
		ON CONFLICT(kind, ref) DO UPDATE SET source_ts = excluded.source_ts, json = excluded.json, model = excluded.model,
			cost_usd = excluded.cost_usd, created_at = excluded.created_at, error = NULL, error_kind = NULL, error_at = NULL`)
		.run(kind, ref, sourceTs, JSON.stringify(summary), model, costUsd, new Date().toISOString());
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

	const stamp = ts => (ts ? new Date(ts).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-');
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

export function createSummaryQueue({ db, config, run = runSummary, log = () => {}, now = Date.now }) {
	const queue = [];
	const queued = new Set();
	let running = null;
	let paused = null; // { until, kind, message }
	let lastError = null;

	const keyOf = (kind, ref) => `${kind}:${ref}`;

	function enqueue(kind, ref, { manual = false } = {}) {
		const key = keyOf(kind, ref);
		// Asking from the page means the person wants to try again now.
		if (manual) paused = null;
		if (!queued.has(key) && running?.key !== key) {
			queued.add(key);
			const item = { kind, ref, key };
			if (manual) queue.unshift(item);
			else queue.push(item);
		}
		setImmediate(pump);
	}

	async function summarizeSession(id) {
		const s = sessionRow(db, id);
		if (!s) return;
		const adapter = adapterFor(s.tool);
		const digest = buildDigest(s, readConversation(s.jsonl_path, adapter), { maxChars: config.summary.maxChars, adapter });
		const out = await run({ system: SESSION_PROMPT, input: digest, config });
		saveSummary(db, 'session', id, { ...out, sourceTs: contentTs(s), model: summaryModel(config.summary) });
		if (s.project_key && !s.is_automated) enqueue('project', s.project_key);
	}

	async function summarizeProject(key) {
		const input = projectInput(db, key);
		if (!input) return;
		const current = getSummary(db, 'project', key);
		if (current?.data && current.source_ts && current.source_ts >= input.sourceTs) return;
		const out = await run({ system: PROJECT_PROMPT, input: input.input, config });
		saveSummary(db, 'project', key, { ...out, sourceTs: input.sourceTs, model: summaryModel(config.summary) });
	}

	async function pump() {
		if (running || !queue.length) return;
		if (paused && paused.until > now()) return;
		paused = null;
		const item = queue.shift();
		queued.delete(item.key);
		running = item;
		try {
			if (item.kind === 'session') await summarizeSession(item.ref);
			else await summarizeProject(item.ref);
			lastError = null;
		}
		catch (error) {
			lastError = { kind: error.kind ?? 'failed', message: error.message, at: new Date(now()).toISOString() };
			log(`summary ${item.key} failed: ${error.message}`);
			saveError(db, item.kind, item.ref, error);
			// These stop every later call too, so wait instead of failing each one.
			// A missing CLI is often the CLI updating itself, so that wait is short.
			if (PAUSE_MS[error.kind]) {
				paused = { until: now() + PAUSE_MS[error.kind], kind: error.kind, message: error.message };
				queue.unshift(item);
				queued.add(item.key);
			}
		}
		finally {
			running = null;
		}
		setImmediate(pump);
	}

	/** Queues sessions with new messages since their summary, within autoDays. */
	function enqueueStale() {
		if (!config.summary.enabled) return 0;
		const since = new Date(now() - config.summary.autoDays * 86400000).toISOString();
		const rows = db.raw.prepare(`
			SELECT s.id, s.last_human_ts, s.last_assistant_ts, m.source_ts, m.json, m.error_at
			FROM sessions s LEFT JOIN summaries m ON m.kind = 'session' AND m.ref = s.id
			WHERE s.is_automated = 0 AND s.human_turns > 0
				AND MAX(COALESCE(s.last_human_ts, ''), COALESCE(s.last_assistant_ts, '')) >= ?
			ORDER BY MAX(COALESCE(s.last_human_ts, ''), COALESCE(s.last_assistant_ts, '')) DESC`).all(since);
		let added = 0;
		for (const r of rows) {
			const fresh = r.json && r.source_ts && r.source_ts >= contentTs(r);
			const recentError = r.error_at && now() - Date.parse(r.error_at) < RETRY_AFTER_ERROR_MS;
			if (fresh || recentError || queued.has(keyOf('session', r.id))) continue;
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
		};
	}

	const isBusy = (kind, ref) => running?.key === keyOf(kind, ref) || queued.has(keyOf(kind, ref));

	return { enqueue, enqueueStale, status, isBusy, idle: () => !running && !queue.length };
}
