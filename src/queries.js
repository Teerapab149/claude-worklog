// Read models for the web app. Every function returns plain JSON-ready data.

import fs from 'node:fs';
import path from 'node:path';
import { sessionTitle } from './session-state.js';
import { contentTs, getSummary } from './summaries.js';
import { howToContinue, recommend } from './recommend.js';

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

	return rows.map((row, i) => {
		const active = limits.all(row.uuid, nowSec).map(l => ({ type: l.rate_limit_type, resets_at: l.resets_at * 1000, seen_at: l.ts }));
		active.sort((a, b) => b.resets_at - a.resets_at);
		return { ...row, color: i, limited: active.length > 0, limits: active };
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
		const summary = getSummary(db, 'project', p.key)?.data ?? getSummary(db, 'session', latest.id)?.data ?? null;
		const deadlines = [
			...(summary?.deadlines ?? []),
			...recentQ.all(p.key, since).flatMap(r => JSON.parse(r.json).deadlines ?? []),
		];
		items.push({ project: p, latest, summary, deadlines, active: open.has(latest.id) });
	}
	return recommend(items, accounts(db, config, now), now);
}
