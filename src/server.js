// Local web server. Listens on 127.0.0.1 only and rescans the logs when they change.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { APP_ROOT, readLocalConfig, resolveConfig, writeLocalConfig } from './config.js';
import { regroup, scan } from './indexer.js';
import { overlaps } from './overlap.js';
import * as queries from './queries.js';
import * as settings from './settings.js';
import { createSummaryQueue } from './summaries.js';
import { watchLogs } from './watch.js';

const PUBLIC_DIR = path.join(APP_ROOT, 'public');
const TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.woff2': 'font/woff2',
	'.ico': 'image/x-icon',
	'.png': 'image/png',
	'.webmanifest': 'application/manifest+json',
};
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * Keeps count of open pages. Each page holds one event stream open for as
 * long as it is showing, so the count drops to zero when the last window
 * closes. idle.onIdle runs once nobody has been connected for idle.graceMs
 * (long enough to ride out a reload), or when no page ever connects within
 * idle.firstMs.
 */
function createPresence(idle) {
	let open = 0;
	let timer = idle ? setTimeout(() => idle.onIdle(), idle.firstMs ?? 60000) : null;
	return {
		join(req, res) {
			res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
			res.write(': open\n\n');
			// Something must cross the stream now and then, or it may be dropped as dead.
			const ping = setInterval(() => res.write(': ping\n\n'), 25000);
			open++;
			clearTimeout(timer);
			req.on('close', () => {
				clearInterval(ping);
				open--;
				if (idle && open === 0) timer = setTimeout(() => idle.onIdle(), idle.graceMs ?? 10000);
			});
		},
		stop: () => clearTimeout(timer),
	};
}

// configFile is where the settings page saves; without one the page is read only.
// appInstalled tells whether the app window's profile has Worklog installed as an app.
export function createApp({ db, config, configFile = null, appInstalled = null, queue = null, log = console.log, idle = null }) {
	let lastScan = null;
	const presence = createPresence(idle);

	function runScan() {
		const started = Date.now();
		try {
			const stats = scan(db, config);
			lastScan = { at: Date.now(), ms: Date.now() - started, stats, error: null };
			queue?.enqueueStale();
		}
		catch (error) {
			lastScan = { at: Date.now(), ms: Date.now() - started, stats: null, error: error.message };
			log(`scan failed: ${error.stack}`);
		}
		return lastScan;
	}

	const routes = [
		['GET', /^\/api\/overview$/, () => {
			const active = queries.activeSessions(db, config);
			return {
				scan: lastScan,
				summarizer: queue?.status() ?? null,
				accounts: queries.accounts(db, config),
				next: queries.nextUp(db, config),
				overlaps: overlaps(db, config, active),
				active,
				projects: queries.projects(db, queue),
			};
		}],
		['POST', /^\/api\/projects\/(.+)\/summarize$/, ([key]) => summarize('project', key)],
		['POST', /^\/api\/sessions\/([\w-]+)\/summarize$/, ([id]) => summarize('session', id)],
		['GET', /^\/api\/projects\/(.+)$/, ([key]) => {
			const data = queries.project(db, key, queue);
			return data ? { accounts: queries.accounts(db, config), summarizer: queue?.status() ?? null, project: data } : null;
		}],
		['GET', /^\/api\/sessions\/([\w-]+)$/, ([id]) => {
			const data = queries.session(db, id, queue);
			return data ? { accounts: queries.accounts(db, config), summarizer: queue?.status() ?? null, session: data } : null;
		}],
		['POST', /^\/api\/scan$/, () => ({ scan: runScan() })],
		['POST', /^\/api\/accounts\/([\w-]+)\/limit$/, ([uuid], body) => markLimit(uuid, body)],
		['DELETE', /^\/api\/accounts\/([\w-]+)\/limit$/, ([uuid]) => {
			if (!hasAccount(uuid)) return null;
			db.clearLimits(uuid);
			return { accounts: queries.accounts(db, config) };
		}],
		['GET', /^\/api\/settings$/, () => settingsBody()],
		['PUT', /^\/api\/settings$/, (_, body) => saveSettings(body)],
	];

	const hasAccount = uuid => Boolean(db.raw.prepare('SELECT 1 FROM accounts WHERE uuid = ?').get(uuid));
	// The longest a window can still have to run, so a typo cannot park an account for months.
	const WINDOW_MS = { five_hour: 5 * 3600000, seven_day: 7 * 86400000 };

	function markLimit(uuid, body, now = Date.now()) {
		if (!hasAccount(uuid)) return null;
		const resetsAt = Number(body?.resets_at);
		const longest = WINDOW_MS[body?.window];
		if (!longest || !Number.isFinite(resetsAt) || resetsAt <= now || resetsAt > now + longest + 3600000) {
			throw httpError(400, 'bad_limit');
		}
		db.markLimit(uuid, body.window, Math.round(resetsAt));
		return { accounts: queries.accounts(db, config) };
	}

	function settingsBody(extra = {}) {
		return {
			scan: lastScan,
			settings: queries.settings(db, config),
			editable: settings.editable(db, config),
			canSave: Boolean(configFile),
			// Turning summaries on needs a restart, because the queue is made at start.
			summaryRunning: Boolean(queue),
			appInstalled: appInstalled ? appInstalled() : null,
			...extra,
		};
	}

	function saveSettings(body) {
		if (!configFile) throw httpError(409, 'read_only');
		const local = readLocalConfig(configFile);
		const known = new Set(db.raw.prepare("SELECT uuid FROM accounts WHERE tool = 'claude'").all().map(a => a.uuid));
		const { next, changed } = settings.merge(local, body ?? {}, known);
		writeLocalConfig(next, configFile);
		// Every part of the server holds this one object, so change it in place.
		const fresh = resolveConfig(next);
		for (const key of Object.keys(config)) if (!(key in fresh)) delete config[key];
		Object.assign(config, fresh);
		if (changed.folders) regroup(db, config);
		if (changed.folders || changed.accounts) runScan();
		return settingsBody({ saved: true, regrouped: changed.folders });
	}

	function summarize(kind, ref) {
		if (!queue || !config.summary.enabled) return { queued: false, reason: 'disabled' };
		const exists = kind === 'session'
			? db.getSession(ref)
			: db.raw.prepare('SELECT 1 FROM projects WHERE key = ?').get(ref);
		if (!exists) return null;
		// A project summary is built from its session summaries, so refresh
		// any session that has none or is out of date first.
		if (kind === 'project') {
			const rows = db.raw.prepare(`SELECT s.id, s.last_human_ts, s.last_assistant_ts, m.source_ts, m.json
				FROM sessions s LEFT JOIN summaries m ON m.kind = 'session' AND m.ref = s.id
				WHERE s.project_key = ? AND s.is_automated = 0 AND s.human_turns > 0
				ORDER BY s.last_ts DESC LIMIT 8`).all(ref);
			for (const r of rows.reverse()) {
				const newest = [r.last_human_ts, r.last_assistant_ts].filter(Boolean).sort().pop();
				if (!r.json || (newest && r.source_ts < newest)) queue.enqueue('session', r.id, { manual: true });
			}
		}
		queue.enqueue(kind, ref, { manual: true });
		return { queued: true, summarizer: queue.status() };
	}

	function sendJson(res, status, body) {
		res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
		res.end(JSON.stringify(body));
	}

	function serveStatic(res, pathname) {
		const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
		const file = path.resolve(PUBLIC_DIR, rel);
		if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
			res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
			return res.end('ไม่พบหน้านี้');
		}
		res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
		fs.createReadStream(file).pipe(res);
	}

	// A page on another site can still send a plain form to 127.0.0.1, so a
	// write must carry JSON (which needs a preflight this server never grants)
	// and, when the browser names its origin, come from this server.
	function writeAllowed(req) {
		if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return false;
		const origin = req.headers.origin;
		if (!origin) return true;
		try { return ALLOWED_HOSTS.has(new URL(origin).hostname); }
		catch { return false; }
	}

	function readJson(req) {
		return new Promise((resolve, reject) => {
			const chunks = [];
			let size = 0;
			req.on('data', chunk => {
				size += chunk.length;
				if (size > 65536) { reject(httpError(413, 'too_large')); req.destroy(); }
				else chunks.push(chunk);
			});
			req.on('end', () => {
				const text = Buffer.concat(chunks).toString('utf8');
				try { resolve(text ? JSON.parse(text) : {}); }
				catch { reject(httpError(400, 'bad_json')); }
			});
			req.on('error', reject);
		});
	}

	async function handle(req, res) {
		// Refuse requests addressed to any other host name, so a web page
		// elsewhere cannot reach this server through DNS rebinding.
		const host = (req.headers.host ?? '').replace(/:\d+$/, '');
		if (!ALLOWED_HOSTS.has(host)) {
			res.writeHead(403);
			return res.end();
		}
		const url = new URL(req.url, 'http://localhost');
		if (url.pathname === '/api/alive' && req.method === 'GET') return presence.join(req, res);
		if (!url.pathname.startsWith('/api/')) {
			if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'method_not_allowed' });
			return serveStatic(res, url.pathname);
		}
		for (const [method, pattern, handler] of routes) {
			const match = url.pathname.match(pattern);
			if (!match) continue;
			if (req.method !== method) continue;
			if (method !== 'GET' && !writeAllowed(req)) return sendJson(res, 403, { error: 'forbidden' });
			try {
				const input = method === 'GET' ? null : await readJson(req);
				const body = await handler(match.slice(1).map(decodeURIComponent), input);
				return body ? sendJson(res, 200, body) : sendJson(res, 404, { error: 'not_found' });
			}
			catch (error) {
				if (error.status) return sendJson(res, error.status, { error: error.message, field: error.field });
				log(`${req.method} ${url.pathname} failed: ${error.stack}`);
				return sendJson(res, 500, { error: 'internal' });
			}
		}
		const known = routes.some(([, pattern]) => pattern.test(url.pathname));
		sendJson(res, known ? 405 : 404, { error: known ? 'method_not_allowed' : 'not_found' });
	}

	return { handle, runScan, presence };
}

/** Folders whose .jsonl files are the session logs of each tool that is read. */
function logDirs(config) {
	return [
		config.sources.claude && path.join(config.claudeDir, 'projects'),
		config.sources.codex && path.join(config.codexDir, 'sessions'),
	].filter(Boolean);
}

export function startServer({ db, config, configFile = null, appInstalled = null, port = 4317, watch = {}, log = console.log, run, idle = null }) {
	const queue = config.summary.enabled ? createSummaryQueue({ db, config, log, ...(run ? { run } : {}) }) : null;
	const app = createApp({ db, config, configFile, appInstalled, queue, log, idle });
	const server = http.createServer(app.handle);
	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, '127.0.0.1', () => {
			server.off('error', reject);
			// Scanning starts only once the port is ours, so a second copy
			// that cannot listen exits without touching the database.
			app.runScan();
			const watcher = watchLogs(logDirs(config), app.runScan, { log, ...watch });
			server.on('close', () => { watcher.close(); app.presence.stop(); });
			resolve(server);
		});
	});
}
