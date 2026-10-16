import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { editPath } from './overlap.js';
import { emptySession } from './session-state.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS scan_state (
	path TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	size INTEGER NOT NULL,
	mtime_ms REAL NOT NULL,
	offset INTEGER NOT NULL,
	excluded INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS projects (
	key TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	path TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
	uuid TEXT PRIMARY KEY,
	label TEXT NOT NULL,
	tool TEXT NOT NULL DEFAULT 'claude'
);
CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	tool TEXT NOT NULL DEFAULT 'claude',
	jsonl_path TEXT NOT NULL,
	project_key TEXT,
	cwd TEXT,
	account_uuid TEXT,
	account_source TEXT,
	custom_title TEXT,
	ai_title TEXT,
	first_ts TEXT,
	last_ts TEXT,
	last_prompt TEXT,
	last_human_text TEXT,
	last_human_ts TEXT,
	last_assistant_text TEXT,
	last_assistant_ts TEXT,
	human_turns INTEGER NOT NULL DEFAULT 0,
	assistant_turns INTEGER NOT NULL DEFAULT 0,
	scheduled_turns INTEGER NOT NULL DEFAULT 0,
	last_event TEXT,
	last_event_ts TEXT,
	is_automated INTEGER NOT NULL DEFAULT 0,
	end_state TEXT,
	model TEXT,
	git_branch TEXT,
	version TEXT,
	entrypoint TEXT,
	pr_url TEXT
);
CREATE INDEX IF NOT EXISTS sessions_project ON sessions(project_key, last_ts);
CREATE TABLE IF NOT EXISTS file_edits (
	session_id TEXT NOT NULL,
	ts TEXT NOT NULL,
	path TEXT NOT NULL,
	tool TEXT NOT NULL,
	UNIQUE (session_id, ts, path, tool)
);
CREATE INDEX IF NOT EXISTS file_edits_path ON file_edits(path, ts);
CREATE INDEX IF NOT EXISTS file_edits_ts ON file_edits(ts);
-- Edits reported by the PreToolUse hook as they happen, before the log is
-- scanned. path is normalized (forward slashes, lower case on Windows).
CREATE TABLE IF NOT EXISTS live_edits (
	session_id TEXT NOT NULL,
	ts TEXT NOT NULL,
	path TEXT NOT NULL,
	cwd TEXT
);
CREATE INDEX IF NOT EXISTS live_edits_path ON live_edits(path, ts);
-- The hook warns a session once per file, until another session edits it again.
CREATE TABLE IF NOT EXISTS overlap_warnings (
	session_id TEXT NOT NULL,
	path TEXT NOT NULL,
	warned_at TEXT NOT NULL,
	PRIMARY KEY (session_id, path)
);
CREATE TABLE IF NOT EXISTS quota_events (
	session_id TEXT NOT NULL,
	ts TEXT NOT NULL,
	status TEXT,
	rate_limit_type TEXT,
	resets_at INTEGER,
	UNIQUE (session_id, ts)
);
-- One AI summary per session or project. source_ts is the newest message the
-- summary has seen; a newer message makes it stale.
CREATE TABLE IF NOT EXISTS summaries (
	kind TEXT NOT NULL,
	ref TEXT NOT NULL,
	source_ts TEXT,
	json TEXT,
	model TEXT,
	cost_usd REAL,
	created_at TEXT,
	error TEXT,
	error_kind TEXT,
	error_at TEXT,
	PRIMARY KEY (kind, ref)
);
`;

const SESSION_COLUMNS = Object.keys(emptySession('', ''));

export function openDb(file) {
	if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
	const db = new DatabaseSync(file);
	db.exec('PRAGMA journal_mode = WAL;');
	// Hooks write while the server scans, so wait for the lock briefly.
	db.exec('PRAGMA busy_timeout = 1000;');
	db.function('normpath', { deterministic: true }, p => (typeof p === 'string' ? editPath(p) : null));
	db.exec(SCHEMA);
	migrate(db);
	return wrap(db);
}

// Columns added after the first release, for databases made before them.
const ADDED_COLUMNS = [
	['sessions', 'tool', "TEXT NOT NULL DEFAULT 'claude'"],
	['accounts', 'tool', "TEXT NOT NULL DEFAULT 'claude'"],
];

function migrate(db) {
	for (const [table, column, type] of ADDED_COLUMNS) {
		const has = db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
		if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
	}
}

function wrap(db) {
	const q = {
		getScan: db.prepare('SELECT * FROM scan_state WHERE path = ?'),
		setScan: db.prepare(`INSERT INTO scan_state (path, session_id, size, mtime_ms, offset, excluded)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(path) DO UPDATE SET session_id = excluded.session_id, size = excluded.size,
				mtime_ms = excluded.mtime_ms, offset = excluded.offset, excluded = excluded.excluded`),
		getSession: db.prepare('SELECT * FROM sessions WHERE id = ?'),
		saveSession: db.prepare(`INSERT OR REPLACE INTO sessions (${SESSION_COLUMNS.join(', ')})
			VALUES (${SESSION_COLUMNS.map(() => '?').join(', ')})`),
		deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
		deleteEdits: db.prepare('DELETE FROM file_edits WHERE session_id = ?'),
		deleteQuota: db.prepare('DELETE FROM quota_events WHERE session_id = ?'),
		addEdit: db.prepare('INSERT OR IGNORE INTO file_edits (session_id, ts, path, tool) VALUES (?, ?, ?, ?)'),
		addQuota: db.prepare(`INSERT OR IGNORE INTO quota_events (session_id, ts, status, rate_limit_type, resets_at)
			VALUES (?, ?, ?, ?, ?)`),
		saveProject: db.prepare(`INSERT INTO projects (key, name, path) VALUES (?, ?, ?)
			ON CONFLICT(key) DO UPDATE SET name = excluded.name, path = excluded.path`),
		saveAccount: db.prepare(`INSERT INTO accounts (uuid, label, tool) VALUES (?, ?, ?)
			ON CONFLICT(uuid) DO UPDATE SET label = excluded.label, tool = excluded.tool`),
		setAccount: db.prepare('UPDATE sessions SET account_uuid = ?, account_source = ? WHERE id = ?'),
	};

	return {
		raw: db,
		close: () => db.close(),
		transaction(fn) {
			db.exec('BEGIN');
			try { const out = fn(); db.exec('COMMIT'); return out; }
			catch (error) { db.exec('ROLLBACK'); throw error; }
		},
		getScanState: p => q.getScan.get(p) ?? null,
		setScanState: ({ path: p, sessionId, size, mtimeMs, offset, excluded }) =>
			q.setScan.run(p, sessionId, size, mtimeMs, offset, excluded ? 1 : 0),
		getSession: id => {
			const row = q.getSession.get(id);
			return row ? { ...row } : null;
		},
		saveSession: s => q.saveSession.run(...SESSION_COLUMNS.map(c => s[c] ?? null)),
		deleteSessionData(id) {
			q.deleteSession.run(id);
			q.deleteEdits.run(id);
			q.deleteQuota.run(id);
		},
		addEdit: (sessionId, e) => q.addEdit.run(sessionId, e.ts, e.path, e.tool),
		addQuota: (sessionId, e) => q.addQuota.run(sessionId, e.ts, e.status ?? null, e.rateLimitType ?? null,
			Number.isFinite(e.resetsAt) ? e.resetsAt : null),
		saveProject: p => q.saveProject.run(p.key, p.name, p.path),
		saveAccount: (uuid, label, tool = 'claude') => q.saveAccount.run(uuid, label, tool),
		setSessionAccount: (id, uuid, source) => q.setAccount.run(uuid, source, id),
		allSessions: () => db.prepare('SELECT * FROM sessions').all(),
	};
}
