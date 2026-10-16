import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { resolveConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { startServer } from '../src/server.js';

const line = r => JSON.stringify(r) + '\n';
// The server only takes writes that carry JSON.
const post = (url, body, method = 'POST') => fetch(url, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

test('API serves overview, project and session, and refuses other hosts', async t => {
	const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-'));
	const dir = path.join(claudeDir, 'projects', 'E--H-');
	fs.mkdirSync(dir, { recursive: true });
	const future = Math.floor(Date.now() / 1000) + 3600;
	fs.writeFileSync(path.join(dir, 'abc.jsonl'),
		line({ type: 'bridge-session', ownerAccountUuid: 'acct-1' })
		+ line({ type: 'user', cwd: 'E:\\shop', timestamp: '2026-10-16T01:00:00Z', message: { content: 'ทำ MVP' } })
		+ line({ type: 'assistant', timestamp: '2026-10-16T01:01:00Z', quotaLimits: { status: 'rejected', rateLimitType: 'five_hour', resetsAt: future },
			isApiErrorMessage: true, error: 'rate_limit', message: { content: [] } }));
	const config = resolveConfig({ claudeDir, codexDir: path.join(claudeDir, 'codex'), roots: ['E:\\'], accounts: { 'acct-1': 'บัญชีหลัก' } });
	const db = openDb(':memory:');
	const run = async () => ({ summary: { headline: 'ทำ MVP ค้างเพราะ limit', status: 'in_progress', done: [], in_progress: [], next_steps: [], waiting_on: [], deadlines: [] }, costUsd: 0 });
	const server = await startServer({ db, config, port: 0, log: () => {}, run });
	t.after(() => { server.close(); db.close(); fs.rmSync(claudeDir, { recursive: true, force: true }); });
	const base = `http://127.0.0.1:${server.address().port}`;

	const overview = await (await fetch(`${base}/api/overview`)).json();
	assert.equal(overview.projects.length, 1);
	assert.equal(overview.projects[0].name, 'shop');
	assert.equal(overview.projects[0].latest.end_state, 'rate_limited');
	assert.equal(overview.accounts[0].label, 'บัญชีหลัก');
	assert.equal(overview.accounts[0].limited, true);

	const project = await (await fetch(`${base}/api/projects/${encodeURIComponent('e:/shop')}`)).json();
	assert.equal(project.project.sessions[0].id, 'abc');

	const session = await (await fetch(`${base}/api/sessions/abc`)).json();
	assert.equal(session.session.last_human_text, 'ทำ MVP');

	const queued = await (await post(`${base}/api/sessions/abc/summarize`)).json();
	assert.equal(queued.queued, true);
	let summary;
	for (let i = 0; i < 100 && !summary?.data; i++) {
		await new Promise(r => setTimeout(r, 20));
		summary = (await (await fetch(`${base}/api/sessions/abc`)).json()).session.summary;
	}
	assert.equal(summary.data.headline, 'ทำ MVP ค้างเพราะ limit');
	assert.equal((await post(`${base}/api/sessions/nope/summarize`)).status, 404);

	assert.equal((await fetch(`${base}/api/sessions/nope`)).status, 404);
	// fetch() will not set Host, so this check goes through node:http.
	const foreign = await new Promise((resolve, reject) => {
		http.get(`${base}/api/overview`, { headers: { host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject);
	});
	assert.equal(foreign, 403);
	assert.equal((await fetch(`${base}/../package.json`)).status, 404);
	const page = await fetch(`${base}/`);
	assert.match(await page.text(), /Worklog/);
});

test('in app mode the server reports idle once the last page closes', async t => {
	const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-idle-'));
	const config = resolveConfig({ claudeDir, codexDir: path.join(claudeDir, 'codex'), summary: { enabled: false } });
	const db = openDb(':memory:');
	let idle = 0;
	const server = await startServer({ db, config, port: 0, log: () => {}, idle: { graceMs: 150, firstMs: 5000, onIdle: () => idle++ } });
	t.after(() => { server.closeAllConnections(); server.close(); db.close(); fs.rmSync(claudeDir, { recursive: true, force: true }); });
	const port = server.address().port;

	const page = await new Promise(resolve => http.get({ host: '127.0.0.1', port, path: '/api/alive', headers: { host: 'localhost' } }, resolve));
	assert.equal(page.headers['content-type'], 'text/event-stream');
	await new Promise(r => setTimeout(r, 300));
	assert.equal(idle, 0);
	page.destroy();
	await new Promise(r => setTimeout(r, 400));
	assert.equal(idle, 1);
});

test('an account can be marked as limited by hand and cleared, and writes need JSON from this host', async t => {
	const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-mark-'));
	const config = resolveConfig({ claudeDir, codexDir: path.join(claudeDir, 'codex'), summary: { enabled: false } });
	const db = openDb(':memory:');
	db.saveAccount('acct-1', 'บัญชีหลัก');
	const server = await startServer({ db, config, port: 0, log: () => {} });
	t.after(() => { server.close(); db.close(); fs.rmSync(claudeDir, { recursive: true, force: true }); });
	const url = `http://127.0.0.1:${server.address().port}/api/accounts/acct-1/limit`;
	const resetsAt = Date.now() + 2 * 86400000;

	// A plain form post, or one from another site, is refused.
	assert.equal((await fetch(url, { method: 'POST', body: 'window=seven_day' })).status, 403);
	const foreign = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' });
	assert.equal(foreign.status, 403);

	assert.equal((await post(url, { window: 'five_hour', resets_at: resetsAt })).status, 400);
	assert.equal((await post(url, { window: 'seven_day', resets_at: Date.now() - 1000 })).status, 400);
	assert.equal((await post(url.replace('acct-1', 'nobody'), { window: 'seven_day', resets_at: resetsAt })).status, 404);

	const marked = await (await post(url, { window: 'seven_day', resets_at: resetsAt })).json();
	const acct = marked.accounts.find(a => a.uuid === 'acct-1');
	assert.equal(acct.limited, true);
	assert.equal(acct.marked, true);
	assert.deepEqual(acct.usage.map(u => [u.window, u.used_percent, u.source]), [['seven_day', 100, 'manual']]);

	const cleared = await (await post(url, null, 'DELETE')).json();
	assert.equal(cleared.accounts.find(a => a.uuid === 'acct-1').limited, false);
	assert.equal((await fetch(url)).status, 405);
});

test('a malformed path gets a 400 and the server keeps running, with security headers on every reply', async t => {
	const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-bad-'));
	const config = resolveConfig({ claudeDir, codexDir: path.join(claudeDir, 'codex'), summary: { enabled: false } });
	const db = openDb(':memory:');
	const server = await startServer({ db, config, port: 0, log: () => {} });
	t.after(() => { server.close(); db.close(); fs.rmSync(claudeDir, { recursive: true, force: true }); });
	const base = `http://127.0.0.1:${server.address().port}`;
	const bad = await fetch(`${base}/%E0`);
	assert.equal(bad.status, 400);
	assert.equal((await fetch(`${base}/..%5c..%5cpackage.json`)).status, 404);
	const page = await fetch(`${base}/`);
	assert.equal(page.status, 200);
	assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
	assert.equal(page.headers.get('x-frame-options'), 'DENY');
	// The SessionEnd hook asks for a scan; that write must be accepted.
	const { sessionEnd } = await import('../src/hooks.js');
	let scanned = false;
	const original = globalThis.fetch;
	globalThis.fetch = async (url, init) => { scanned = init.headers['content-type'] === 'application/json'; return original(url, init); };
	try { await sessionEnd({ port: server.address().port, dataDir: claudeDir }); }
	finally { globalThis.fetch = original; }
	assert.equal(scanned, true);
});

test('an open page hears when a scan read new lines, and other sites cannot hold it open', async t => {
	const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-live-'));
	const dir = path.join(claudeDir, 'projects', 'E--x');
	fs.mkdirSync(dir, { recursive: true });
	const config = resolveConfig({ claudeDir, codexDir: path.join(claudeDir, 'codex'), summary: { enabled: false } });
	const db = openDb(':memory:');
	const server = await startServer({ db, config, port: 0, log: () => {} });
	const port = server.address().port;
	t.after(() => { server.closeAllConnections(); server.close(); db.close(); fs.rmSync(claudeDir, { recursive: true, force: true }); });

	const foreign = await new Promise(resolve => http.get({ host: '127.0.0.1', port, path: '/api/alive', headers: { host: 'localhost', 'sec-fetch-site': 'cross-site' } }, res => { res.resume(); resolve(res.statusCode); }));
	assert.equal(foreign, 403);

	const page = await new Promise(resolve => http.get({ host: '127.0.0.1', port, path: '/api/alive', headers: { host: 'localhost' } }, resolve));
	let text = '';
	page.on('data', d => { text += d; });
	assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/ping`)).json()).pages, 1);
	fs.writeFileSync(path.join(dir, 'new.jsonl'), JSON.stringify({ type: 'user', cwd: 'E:/x', timestamp: '2026-10-16T01:00:00Z', message: { content: 'hi' } }) + '\n');
	await post(`http://127.0.0.1:${port}/api/scan`);
	for (let i = 0; i < 20 && !text.includes('event: changed'); i++) await new Promise(r => setTimeout(r, 25));
	assert.match(text, /event: changed/);
	page.destroy();
});
