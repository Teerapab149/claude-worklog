// Read models for the web app. Every function returns plain JSON-ready data.

import fs from 'node:fs';
import path from 'node:path';
import { sessionTitle } from './session-state.js';
import { contentTs, getSummary } from './summaries.js';
import { howToContinue, recommend } from './recommend.js';
import { isOurs } from './hook-install.js';

function withSummary(db, kind, ref, newestTs, queue) {
	const summary = getSummary(db, kind, ref);
	return {
		...summary,
		stale: Boolean(summary?.data && newestTs && summary.source_ts < newestTs),
		busy: queue ? queue.isBusy(kind, ref) : false,
	};
}

const SESSION_FIELDS = `s.id, s.tool, s.project_key, s.cwd, s.account_uuid, s.account_source, s.custom_title, s.ai_title,
	s.first_ts, s.last_ts, s.last_prompt, s.last_human_text, s.last_human_ts, s.last_assistant_text,
	s.last_assistant_ts, s.human_turns, s.assistant_turns, s.is_automated, s.end_state, s.model,
	s.git_branch, s.pr_url, s.jsonl_path, s.entrypoint, p.name AS project_name`;

function shapeSession(row) {
	return { ...row, title: sessionTitle(row), is_automated: Boolean(row.is_automated) };
}

/** Accounts in config order first, then any others, each with a stable color slot. */
const FIVE_HOURS = 5 * 3600 * 1000;

export function accounts(db, config, now = Date.now()) {
	const rows = db.raw.prepare(`
		SELECT a.uuid, a.label, a.tool, COUNT(s.id) AS sessions, MAX(s.last_ts) AS last_ts
		FROM accounts a LEFT JOIN sessions s ON s.account_uuid = a.uuid
		GROUP BY a.uuid`).all();
	const order = Object.keys(config.accounts ?? {});
	rows.sort((a, b) => {
		const ia = order.indexOf(a.uuid), ib = order.indexOf(b.uuid);
		return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.uuid.localeCompare(b.uuid);
	});

	// The log only records a limit when a request was refused, so an account
	// with no refusal still in force is treated as available.
	const limits = db.raw.prepare(`
		SELECT q.rate_limit_type, MAX(q.resets_at) AS resets_at, MAX(q.ts) AS ts
		FROM quota_events q JOIN sessions s ON s.id = q.session_id
		WHERE s.account_uuid = ? AND q.status = 'rejected' AND q.resets_at > ?
		GROUP BY q.rate_limit_type`);
	const nowSec = Math.floor(now / 1000);
	// The newest reading of each window.
	const usageQ = db.raw.prepare(`
		SELECT u.window, u.used_percent, u.window_minutes, u.resets_at, u.ts, u.source
		FROM usage u LEFT JOIN sessions s ON s.id = u.session_id
		WHERE COALESCE(u.account_uuid, s.account_uuid) = ?
		ORDER BY u.ts DESC`);
	// A window past its reset is full again if the account has not been used
	// on this machine since then. If it has, the old reading says nothing.
	const fresh = (u, lastUsed) => {
		if (!u.resets_at || u.resets_at > now) return u;
		if (lastUsed && Date.parse(lastUsed) > u.resets_at) return null;
		return { ...u, used_percent: 0, reset_seen: u.resets_at, resets_at: null };
	};

	// Sessions active in the last five hours, for spreading work across accounts.
	const recentQ = db.raw.prepare(`SELECT first_ts, last_ts FROM sessions
		WHERE account_uuid = ? AND is_automated = 0 AND last_ts >= ? AND first_ts IS NOT NULL`);
	// Limits the person marked by hand count the same as a refusal until they reset.
	const marks = db.raw.prepare('SELECT window, resets_at, marked_at FROM limit_marks WHERE account_uuid = ? AND resets_at > ?');

	return rows.map((row, i) => {
		const active = limits.all(row.uuid, nowSec).map(l => ({ type: l.rate_limit_type, resets_at: l.resets_at * 1000, seen_at: l.ts }));
		for (const m of marks.all(row.uuid, now)) {
			const same = active.find(l => l.type === m.window);
			if (!same) active.push({ type: m.window, resets_at: m.resets_at, seen_at: m.marked_at, manual: true });
			else if (same.seen_at < m.marked_at) Object.assign(same, { resets_at: m.resets_at, seen_at: m.marked_at, manual: true });
		}
		active.sort((a, b) => b.resets_at - a.resets_at);
		const usage = new Map();
		for (const u of usageQ.all(row.uuid)) if (!usage.has(u.window)) usage.set(u.window, u);
		for (const [window, u] of usage) {
			const f = fresh(u, row.last_ts);
			if (f) usage.set(window, f);
			else usage.delete(window);
		}
		// A refusal still in force means that window is used up, whatever was read before it.
		for (const l of active) {
			const seen = usage.get(l.type);
			if (!seen || seen.ts < l.seen_at) {
				usage.set(l.type, { window: l.type, used_percent: 100, window_minutes: null, resets_at: l.resets_at, ts: l.seen_at, source: l.manual ? 'manual' : 'refusal' });
			}
		}
		const recent = recentQ.all(row.uuid, new Date(now - FIVE_HOURS).toISOString());
		// The Claude desktop app never says how much of the 5-hour window is
		// used. Its start can still be guessed: the earliest activity in the
		// last five hours. Shown as an estimate, and only without a real reading.
		let window5h = null;
		// A session that began more than five hours ago hides where the window
		// turned over, so then nothing is guessed rather than a wrong time.
		if (row.tool === 'claude' && recent.length && !usage.has('five_hour')) {
			const started = Math.min(...recent.map(r => Date.parse(r.first_ts)));
			if (started >= now - FIVE_HOURS) window5h = { startedAt: started, resetsAt: started + FIVE_HOURS };
		}
		return {
			...row, color: i, limited: active.length > 0, limits: active, marked: active.some(l => l.manual),
			usage: [...usage.values()], used5h: recent.length, window5h,
		};
	});
}

function pidAlive(pid) {
	try { process.kill(pid, 0); return true; }
	catch (error) { return error.code === 'EPERM'; }
}

/** Sessions whose Claude Code process is running now. */
export function activeSessions(db, config) {
	const dir = path.join(config.claudeDir, 'sessions');
	if (!fs.existsSync(dir)) return [];
	const lookup = db.raw.prepare(`SELECT ${SESSION_FIELDS} FROM sessions s LEFT JOIN projects p ON p.key = s.project_key WHERE s.id = ?`);
	const out = [];
	for (const name of fs.readdirSync(dir)) {
		if (!name.endsWith('.json')) continue;
		let info;
		try { info = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); }
		catch { continue; }
		if (!info.sessionId || !Number.isInteger(info.pid) || !pidAlive(info.pid)) continue;
		// Worklog's own summarizer runs claude inside its data folder; that is not the person's work.
		if (info.cwd && path.resolve(info.cwd).toLowerCase().startsWith(config.dataDir.toLowerCase())) continue;
		const row = lookup.get(info.sessionId);
		out.push({
			id: info.sessionId,
			status: info.status ?? null,
			updated_at: info.updatedAt ?? null,
			cwd: info.cwd ?? row?.cwd ?? null,
			title: info.name || (row ? sessionTitle(row) : null),
			project_key: row?.project_key ?? null,
			project_name: row?.project_name ?? (info.cwd ? path.basename(info.cwd) : null),
			account_uuid: row?.account_uuid ?? null,
			account_source: row?.account_source ?? null,
		});
	}
	return out.sort((a, b) => (b.updated_at ?? 0) - (a.updated_at ?? 0));
}

function newestSessionSummaryTs(db, key) {
	return db.raw.prepare(`SELECT MAX(m.source_ts) AS ts FROM summaries m JOIN sessions s ON s.id = m.ref
		WHERE m.kind = 'session' AND m.json IS NOT NULL AND s.project_key = ? AND s.is_automated = 0`).get(key)?.ts ?? null;
}

/** Projects by most recent work, each with the latest session a person ran. */
export function projects(db, queue) {
	const rows = db.raw.prepare(`
		SELECT p.key, p.name, p.path, COUNT(s.id) AS sessions, MAX(s.last_ts) AS last_ts,
			SUM(s.is_automated) AS automated, GROUP_CONCAT(DISTINCT s.account_uuid) AS account_list
		FROM projects p JOIN sessions s ON s.project_key = p.key
		GROUP BY p.key ORDER BY last_ts DESC`).all();
	const latest = db.raw.prepare(`
		SELECT ${SESSION_FIELDS} FROM sessions s LEFT JOIN projects p ON p.key = s.project_key
		WHERE s.project_key = ? ORDER BY s.is_automated ASC, s.last_ts DESC LIMIT 1`);
	return rows.map(({ account_list, ...row }) => {
		const last = latest.get(row.key);
		return {
			...row,
			accounts: account_list ? account_list.split(',') : [],
			latest: last ? shapeSession(last) : null,
			summary: withSummary(db, 'project', row.key, newestSessionSummaryTs(db, row.key), queue),
		};
	});
}

/** Files touched in a set of sessions, newest first, one row per file. */
function filesFor(db, where, param, limit) {
	return db.raw.prepare(`
		SELECT e.path, MAX(e.ts) AS last_ts, COUNT(*) AS edits, COUNT(DISTINCT e.session_id) AS session_count,
			(SELECT e2.session_id FROM file_edits e2 WHERE e2.path = e.path ORDER BY e2.ts DESC LIMIT 1) AS last_session_id
		FROM file_edits e JOIN sessions s ON s.id = e.session_id
		WHERE ${where}
		GROUP BY e.path ORDER BY last_ts DESC LIMIT ${Number(limit)}`).all(param);
}

export function project(db, key, queue) {
	const row = db.raw.prepare('SELECT key, name, path FROM projects WHERE key = ?').get(key);
	if (!row) return null;
	const sessions = db.raw.prepare(`
		SELECT ${SESSION_FIELDS} FROM sessions s LEFT JOIN projects p ON p.key = s.project_key
		WHERE s.project_key = ? ORDER BY s.last_ts DESC`).all(key).map(r => ({
		...shapeSession(r),
		summary: withSummary(db, 'session', r.id, contentTs(r), queue),
	}));
	return {
		...row,
		sessions,
		summary: withSummary(db, 'project', key, newestSessionSummaryTs(db, key), queue),
		files: filesFor(db, 's.project_key = ?', key, 40),
	};
}

export function session(db, id, queue) {
	const row = db.raw.prepare(`SELECT ${SESSION_FIELDS} FROM sessions s LEFT JOIN projects p ON p.key = s.project_key WHERE s.id = ?`).get(id);
	if (!row) return null;
	const shaped = shapeSession(row);
	const summary = withSummary(db, 'session', id, contentTs(row), queue);
	return {
		...shaped,
		summary,
		continue: howToContinue(shaped, summary?.data),
		files: filesFor(db, 'e.session_id = ?', id, 200),
	};
}

/** Projects ranked by what to pick up next, with the reasons for each. */
export function nextUp(db, config, now = Date.now()) {
	const latestQ = db.raw.prepare(`
		SELECT ${SESSION_FIELDS} FROM sessions s LEFT JOIN projects p ON p.key = s.project_key
		WHERE s.project_key = ? AND s.is_automated = 0 AND s.human_turns > 0
		ORDER BY s.last_ts DESC LIMIT 1`);
	// Deadlines mentioned in any recent session count, not only the latest.
	const recentQ = db.raw.prepare(`
		SELECT m.json FROM summaries m JOIN sessions s ON s.id = m.ref
		WHERE m.kind = 'session' AND m.json IS NOT NULL AND s.project_key = ? AND s.last_ts >= ?`);
	const since = new Date(now - 30 * 86400000).toISOString();
	const open = new Set(activeSessions(db, config).map(a => a.id));

	const items = [];
	for (const p of db.raw.prepare('SELECT key, name, path FROM projects').all()) {
		const row = latestQ.get(p.key);
		if (!row) continue;
		const latest = shapeSession(row);
		// Whichever is newer: a project summary written before the latest
		// session can still call the project done after new work started.
		const own = getSummary(db, 'project', p.key), last = getSummary(db, 'session', latest.id);
		const pick = own?.data && last?.data ? ((own.source_ts ?? '') >= (last.source_ts ?? '') ? own : last) : (own?.data ? own : last);
		const summary = pick?.data ?? null;
		const deadlines = [
			...(summary?.deadlines ?? []),
			...recentQ.all(p.key, since).flatMap(r => JSON.parse(r.json).deadlines ?? []),
		];
		items.push({ project: p, latest, summary, deadlines, active: open.has(latest.id) });
	}
	return recommend(items, accounts(db, config, now), now);
}

/** What is set up right now, for the settings page. Nothing secret is included. */
export function settings(db, config) {
	let hooks = 0;
	try {
		const file = path.join(config.claudeDir, 'settings.json');
		const groups = Object.values(JSON.parse(fs.readFileSync(file, 'utf8')).hooks ?? {}).flat();
		hooks = groups.flatMap(g => g.hooks ?? []).filter(isOurs).length;
	}
	catch {
		// No settings file yet, or one that is not JSON: no hooks of ours.
	}
	return {
		roots: config.roots,
		exclude: config.exclude,
		accounts: accounts(db, config).map(a => ({ uuid: a.uuid, label: a.label, tool: a.tool, sessions: a.sessions })),
		sources: { claude: config.claudeDir, codex: config.codexDir },
		summary: { enabled: config.summary.enabled, model: config.summary.model, autoDays: config.summary.autoDays },
		overlap: config.overlap,
		hooksInstalled: hooks,
		dataDir: config.dataDir,
	};
}
