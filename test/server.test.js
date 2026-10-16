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

	const queued = await (await fetch(`${base}/api/sessions/abc/summarize`, { method: 'POST' })).json();
	assert.equal(queued.queued, true);
	let summary;
	for (let i = 0; i < 100 && !summary?.data; i++) {
		await new Promise(r => setTimeout(r, 20));
		summary = (await (await fetch(`${base}/api/sessions/abc`)).json()).session.summary;
	}
	assert.equal(summary.data.headline, 'ทำ MVP ค้างเพราะ limit');
	assert.equal((await fetch(`${base}/api/sessions/nope/summarize`, { method: 'POST' })).status, 404);

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
