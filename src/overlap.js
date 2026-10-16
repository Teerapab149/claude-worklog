// Spots two sessions working on the same thing: the same file edited by
// different sessions within a short window, or several sessions open in one
// project at once. Edits come from two places, the scanned logs (file_edits)
// and the PreToolUse hook (live_edits), which knows about an edit before the
// next scan does.

import path from 'node:path';
import { sessionTitle } from './session-state.js';

const MINUTE = 60 * 1000;

/** One spelling per file, so E:\a\B.js and e:/a/b.js compare equal. */
export function editPath(file, cwd = null) {
	let p = file;
	if (cwd && !path.isAbsolute(p) && !/^[a-z]:[\\/]/i.test(p)) p = path.join(cwd, p);
	p = p.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
	// Windows paths ignore case. A drive letter is the surest sign of one.
	if (/^[a-z]:\//i.test(p) || process.platform === 'win32') p = p.toLowerCase();
	return p;
}

export const windowMs = config => (config.overlap?.windowMinutes ?? 30) * MINUTE;

export function recordEdit(db, { sessionId, file, cwd = null, now = Date.now() }) {
	db.raw.prepare('INSERT INTO live_edits (session_id, ts, path, cwd) VALUES (?, ?, ?, ?)')
		.run(sessionId, new Date(now).toISOString(), editPath(file, cwd), cwd);
	// The logs hold the lasting record, this table only bridges until a scan.
	db.raw.prepare('DELETE FROM live_edits WHERE ts < ?').run(new Date(now - 2 * 86400000).toISOString());
}

/**
 * Latest edit of this file by each other session since a time, newest first.
 * A forked or resumed session carries a copy of the history it came from,
 * so an edit with the very same time in both logs is one edit, not two.
 */
function otherEdits(db, { sessionId, file, since }) {
	return db.raw.prepare(`
		WITH edits AS (
			SELECT session_id, ts FROM file_edits WHERE ts >= ?1 AND normpath(path) = ?2
			UNION ALL
			SELECT session_id, ts FROM live_edits WHERE ts >= ?1 AND path = ?2
		)
		SELECT session_id, MAX(ts) AS ts FROM edits e
		WHERE session_id != ?3 AND NOT EXISTS (SELECT 1 FROM edits m WHERE m.session_id = ?3 AND m.ts = e.ts)
		GROUP BY session_id ORDER BY ts DESC`).all(since, file, sessionId);
}

function accountLabel(db, config, uuid) {
	if (!uuid) return null;
	return config.accounts?.[uuid] ?? db.raw.prepare('SELECT label FROM accounts WHERE uuid = ?').get(uuid)?.label ?? null;
}

/** Who ran a session, in a form short enough for a warning. */
export function describeSession(db, config, id) {
	const row = db.getSession(id);
	if (!row) return { id, title: null, tool: null, account_uuid: null, account: null, project_key: null };
	return {
		id,
		title: sessionTitle(row),
		tool: row.tool,
		account_uuid: row.account_uuid,
		account: row.tool === 'codex' ? 'Codex' : accountLabel(db, config, row.account_uuid),
		project_key: row.project_key,
	};
}

/**
 * Called before a session edits a file. Returns null when nobody else touched
 * the file within the window. Otherwise returns the other sessions and whether
 * this session has already been told about them (repeat: true), so the hook
 * can stop the first edit and let the next one through.
 */
export function checkEdit(db, config, { sessionId, file, cwd = null, now = Date.now() }) {
	const p = editPath(file, cwd);
	const since = new Date(now - windowMs(config)).toISOString();
	const others = otherEdits(db, { sessionId, file: p, since });
	if (!others.length) return null;

	const warned = db.raw.prepare('SELECT warned_at FROM overlap_warnings WHERE session_id = ? AND path = ?').get(sessionId, p);
	// A warning covers the edits it was about. A newer edit by someone else is news.
	const repeat = Boolean(warned && warned.warned_at >= others[0].ts);
	if (!repeat) {
		db.raw.prepare(`INSERT INTO overlap_warnings (session_id, path, warned_at) VALUES (?, ?, ?)
			ON CONFLICT(session_id, path) DO UPDATE SET warned_at = excluded.warned_at`)
			.run(sessionId, p, new Date(now).toISOString());
	}
	return {
		file,
		repeat,
		others: others.map(o => ({ ...describeSession(db, config, o.session_id), ts: o.ts })),
	};
}

/**
 * Everything the dashboard shows about overlapping work: projects with more
 * than one session open now, and files that two sessions edited within the
 * window during the last day. strong marks cases that span accounts, where
 * one side cannot see what the other did.
 */
export function overlaps(db, config, active, now = Date.now()) {
	const byProject = new Map();
	for (const s of active) {
		if (!s.project_key) continue;
		if (!byProject.has(s.project_key)) byProject.set(s.project_key, []);
		byProject.get(s.project_key).push(s);
	}
	const openTogether = [...byProject.values()].filter(list => list.length > 1).map(list => ({
		project_key: list[0].project_key,
		project_name: list[0].project_name,
		sessions: list.map(s => ({ id: s.id, title: s.title, account_uuid: s.account_uuid })),
		strong: new Set(list.map(s => s.account_uuid).filter(Boolean)).size > 1,
	}));

	const gap = windowMs(config);
	const rows = db.raw.prepare(`
		SELECT session_id, ts, normpath(path) AS p, path FROM file_edits WHERE ts >= ?1
		UNION ALL
		SELECT session_id, ts, path AS p, path FROM live_edits WHERE ts >= ?1
		ORDER BY p, ts`).all(new Date(now - 86400000 - gap).toISOString());

	const files = [];
	for (let i = 0; i < rows.length;) {
		let j = i;
		while (j < rows.length && rows[j].p === rows[i].p) j++;
		const shown = rows[j - 1].path;
		// A forked or resumed session carries a copy of the history it came
		// from, so rows with the same time are one edit seen in several logs.
		// Two edits overlap only when no session shares both.
		const group = [];
		for (const r of rows.slice(i, j)) {
			if (group.at(-1)?.ts === r.ts) group.at(-1).sessions.add(r.session_id);
			else group.push({ ts: r.ts, sessions: new Set([r.session_id]) });
		}
		i = j;
		const involved = new Map();
		const touch = (edit, id) => { if (!involved.has(id) || involved.get(id) < edit.ts) involved.set(id, edit.ts); };
		for (let a = 1; a < group.length; a++) {
			// Rows are in time order, so look back only as far as the window reaches.
			for (let b = a - 1; b >= 0 && Date.parse(group[a].ts) - Date.parse(group[b].ts) <= gap; b--) {
				if ([...group[a].sessions].some(id => group[b].sessions.has(id))) continue;
				for (const edit of [group[a], group[b]]) for (const id of edit.sessions) touch(edit, id);
			}
		}
		if (!involved.size) continue;
		const sessions = [...involved].map(([id, ts]) => ({ ...describeSession(db, config, id), ts })).sort((x, y) => (x.ts < y.ts ? 1 : -1));
		if (Date.parse(sessions[0].ts) < now - 86400000) continue;
		files.push({
			path: shown,
			last_ts: sessions[0].ts,
			sessions,
			strong: new Set(sessions.map(s => s.account_uuid ?? s.tool).filter(Boolean)).size > 1,
		});
	}
	files.sort((x, y) => (x.last_ts < y.last_ts ? 1 : -1));
	return { windowMinutes: gap / MINUTE, openTogether, files: files.slice(0, 20) };
}
