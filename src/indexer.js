// Reads every session log under <claudeDir>/projects into the database.
// Each file is read from where the previous scan stopped, so a rescan only
// costs the lines written since.

import fs from 'node:fs';
import { inferAccounts } from './accounts.js';
import { resolveProject } from './projects.js';
import { emptySession, finalizeSession } from './session-state.js';
import { ADAPTERS, enabledAdapters } from './sources/index.js';

const adapterLabel = tool => ADAPTERS[tool]?.label ?? tool;

const CHUNK_BYTES = 4 * 1024 * 1024;

/** Yields complete lines between start and end, with the byte offset after each. */
export function* readLines(fd, start, end) {
	let pos = start;
	let carry = Buffer.alloc(0);
	while (pos < end) {
		const buf = Buffer.allocUnsafe(Math.min(CHUNK_BYTES, end - pos));
		const n = fs.readSync(fd, buf, 0, buf.length, pos);
		if (n === 0) break;
		pos += n;
		const data = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
		const dataStart = pos - data.length;
		let from = 0, nl;
		while ((nl = data.indexOf(10, from)) !== -1) {
			yield { line: data.toString('utf8', from, nl), endOffset: dataStart + nl + 1 };
			from = nl + 1;
		}
		// A line still being written stays unread until the next scan.
		carry = Buffer.from(data.subarray(from));
	}
}

export function scanFile(db, config, adapter, ctx, file, stats) {
	const stat = fs.statSync(file);
	const state = db.getScanState(file);
	const sessionId = adapter.sessionId(file);
	if (state && state.size === stat.size && state.mtime_ms === stat.mtimeMs) {
		stats.unchanged += 1;
		return;
	}
	if (state?.excluded) {
		db.setScanState({ path: file, sessionId, size: stat.size, mtimeMs: stat.mtimeMs, offset: stat.size, excluded: true });
		stats.excluded += 1;
		return;
	}

	let offset = state?.offset ?? 0;
	// A file that shrank was rewritten, so its old rows no longer hold.
	if (stat.size < offset) offset = 0;
	let session = offset > 0 ? db.getSession(sessionId) : null;
	if (!session) {
		offset = 0;
		session = emptySession(sessionId, file, adapter.tool);
	}

	db.transaction(() => {
		if (offset === 0) db.deleteSessionData(sessionId);
		const hooks = {
			onEdit: e => db.addEdit(sessionId, e),
			onQuota: e => db.addQuota(sessionId, e),
			onUsage: e => db.addUsage(sessionId, e),
		};
		const fd = fs.openSync(file, 'r');
		let newOffset = offset;
		try {
			for (const { line, endOffset } of readLines(fd, offset, stat.size)) {
				newOffset = endOffset;
				const text = line.trim();
				if (!text) continue;
				let record;
				try { record = JSON.parse(text); }
				catch { stats.badLines += 1; continue; }
				if (record && typeof record === 'object') adapter.apply(session, record, hooks, ctx);
			}
		}
		finally { fs.closeSync(fd); }

		finalizeSession(session);
		const project = resolveProject(session.cwd, config);
		const skip = project?.excluded ? 'always' : adapter.skip(session);
		if (skip) {
			db.deleteSessionData(sessionId);
			// "until_changed" reads the whole file again once it grows.
			const always = skip === 'always';
			db.setScanState({ path: file, sessionId, size: stat.size, mtimeMs: stat.mtimeMs, offset: always ? stat.size : 0, excluded: always });
			stats.excluded += 1;
			return;
		}
		if (project) {
			session.project_key = project.key;
			db.saveProject(project);
		}
		db.saveSession(session);
		db.setScanState({ path: file, sessionId, size: stat.size, mtimeMs: stat.mtimeMs, offset: newOffset, excluded: false });
		stats.read += 1;
	});
}

export function scan(db, config) {
	const stats = { files: 0, read: 0, unchanged: 0, excluded: 0, badLines: 0, inferred: 0, byTool: {} };
	for (const adapter of enabledAdapters(config)) {
		const files = adapter.listFiles(config);
		const ctx = adapter.prepare(config);
		stats.files += files.length;
		stats.byTool[adapter.tool] = files.length;
		for (const file of files) {
			try { scanFile(db, config, adapter, ctx, file, stats); }
			catch (error) {
				// A file deleted or locked mid-scan is retried on the next scan.
				if (error.code !== 'ENOENT' && error.code !== 'EBUSY') throw error;
			}
		}
		// Stored under a session id of its own, so rescanning one thread never removes it.
		for (const u of adapter.latestUsage?.(files) ?? []) {
			db.addUsage(`${adapter.tool}:latest`, { ...u, account: adapter.tool, source: 'latest' });
		}
	}

	db.transaction(() => {
		const sessions = db.allSessions();
		// Only Claude sessions borrow an account from their neighbours; other
		// tools either name their account or share one per tool.
		const claudeSessions = sessions.filter(s => s.tool === 'claude');
		const inferred = inferAccounts(claudeSessions, config.inferAccountWindowHours * 3600 * 1000);
		for (const s of claudeSessions) {
			if (s.account_source === 'log') continue;
			const uuid = inferred.get(s.id) ?? null;
			db.setSessionAccount(s.id, uuid, uuid ? 'inferred' : null);
		}
		stats.inferred = inferred.size;

		const accounts = new Map();
		for (const s of sessions) if (s.account_uuid) accounts.set(s.account_uuid, s.tool);
		for (const uuid of Object.keys(config.accounts ?? {})) if (!accounts.has(uuid)) accounts.set(uuid, 'claude');
		for (const [uuid, tool] of accounts) {
			const fallback = tool === 'claude' ? `Claude ${uuid.slice(0, 4)}` : adapterLabel(tool);
			db.saveAccount(uuid, config.accounts?.[uuid] ?? fallback, tool);
		}
	});
	return stats;
}
