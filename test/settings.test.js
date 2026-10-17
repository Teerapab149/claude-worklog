import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { resolveConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { regroup } from '../src/indexer.js';
import { emptySession } from '../src/session-state.js';
import { merge, SettingsError } from '../src/settings.js';
import { startServer } from '../src/server.js';

const known = new Set(['a']);

test('merge keeps fields it does not know and only changes what was sent', () => {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-set-'));
	const local = { roots: [], port: 4400, summary: { claudeBin: 'C:\\bin\\claude.exe' }, accounts: { a: 'เดิม', other: 'เก็บไว้' } };
	const { next, changed } = merge(local, {
		roots: [tmp, ` ${tmp} `, ''],
		accounts: { a: '  งาน ', stranger: 'ไม่รับ' },
		summary: { enabled: false, autoDays: '14' },
	}, known);
	assert.deepEqual(next.roots, [tmp]);
	assert.equal(next.port, 4400);
	assert.deepEqual(next.accounts, { a: 'งาน', other: 'เก็บไว้' });
	assert.deepEqual(next.summary, { claudeBin: 'C:\\bin\\claude.exe', enabled: false, autoDays: 14 });
	assert.deepEqual(changed, { folders: true, accounts: true, summaryEnabled: true, updatesOn: false });
	assert.equal(local.accounts.a, 'เดิม');
	fs.rmSync(tmp, { recursive: true, force: true });
});

test('merge refuses values the person has to fix, naming the field', () => {
	const bad = [
		[{ roots: ['projects'] }, 'roots'],
		[{ roots: ['Z:\\nowhere\\at\\all'] }, 'roots'],
		[{ accounts: { a: '   ' } }, 'accounts'],
		[{ summary: { model: 'gpt' } }, 'summary'],
		[{ summary: { autoDays: 0 } }, 'autoDays'],
		[{ overlap: { windowMinutes: 2.5 } }, 'windowMinutes'],
		[{ overlap: { preToolUse: 'yell' } }, 'overlap'],
	];
	for (const [input, field] of bad) {
		assert.throws(() => merge({}, input, known), e => e instanceof SettingsError && e.field === field, JSON.stringify(input));
	}
});

test('regroup moves sessions to their new project and drops excluded ones', () => {
	const db = openDb(':memory:');
	db.saveSession({ ...emptySession('s1', 's1.jsonl'), cwd: 'E:\\work\\shop', project_key: 'e:/work/shop' });
	db.saveSession({ ...emptySession('s2', 's2.jsonl'), cwd: 'E:\\work\\sandbox\\x' });
	db.setScanState({ path: 's2.jsonl', sessionId: 's2', size: 10, mtimeMs: 1, offset: 10, excluded: false });
	db.setScanState({ path: 'old.jsonl', sessionId: 'old', size: 5, mtimeMs: 1, offset: 5, excluded: true });
	regroup(db, resolveConfig({ roots: ['E:\\'], exclude: ['E:\\work\\sandbox'] }));
	assert.equal(db.getSession('s1').project_key, 'e:/work');
	assert.equal(db.getSession('s2'), null);
	assert.equal(db.getScanState('s2.jsonl').excluded, 1);
	assert.equal(db.getScanState('old.jsonl'), null);
	db.close();
});

test('the settings page saves to the config file and applies it without a restart', async t => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-save-'));
	const configFile = path.join(dir, 'config.local.json');
	const local = { port: 4555, claudeDir: dir, codexDir: path.join(dir, 'codex'), summary: { enabled: false }, accounts: { a: 'เดิม' } };
	fs.writeFileSync(configFile, JSON.stringify(local));
	const config = resolveConfig(local);
	const db = openDb(':memory:');
	db.saveAccount('a', 'เดิม');
	const server = await startServer({ db, config, configFile, port: 0, log: () => {} });
	t.after(() => { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
	const url = `http://127.0.0.1:${server.address().port}/api/settings`;
	const put = body => fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

	const before = await (await fetch(url)).json();
	assert.equal(before.canSave, true);
	assert.equal(before.editable.accounts[0].label, 'เดิม');

	const refused = await put({ overlap: { windowMinutes: 1 } });
	assert.equal(refused.status, 400);
	assert.equal((await refused.json()).field, 'windowMinutes');

	const saved = await (await put({ accounts: { a: 'บัญชีงาน' }, overlap: { windowMinutes: 45, preToolUse: 'ask' } })).json();
	assert.equal(saved.saved, true);
	assert.equal(config.overlap.windowMinutes, 45);
	assert.equal(saved.editable.accounts[0].label, 'บัญชีงาน');
	const file = JSON.parse(fs.readFileSync(configFile, 'utf8'));
	assert.equal(file.port, 4555);
	assert.deepEqual(file.overlap, { windowMinutes: 45, preToolUse: 'ask' });
	assert.equal(db.raw.prepare('SELECT label FROM accounts WHERE uuid = ?').get('a').label, 'บัญชีงาน');
});

test('a fresh install waits on the setup page, and finishing it saves the choices and starts nothing it should not', async t => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-setup-'));
	const configFile = path.join(dir, 'config.local.json');
	const local = { setup: 'pending', claudeDir: dir, codexDir: path.join(dir, 'codex'), accounts: { a: 'บัญชี a' } };
	fs.writeFileSync(configFile, JSON.stringify(local));
	const config = resolveConfig(local);
	const db = openDb(':memory:');
	db.saveAccount('a', 'บัญชี a');
	let summarized = 0;
	const server = await startServer({ db, config, configFile, port: 0, log: () => {}, run: async () => { summarized += 1; throw new Error('no'); } });
	t.after(() => { server.close(); db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
	const base = `http://127.0.0.1:${server.address().port}`;

	assert.equal((await (await fetch(`${base}/api/overview`)).json()).setup, true);
	const info = await (await fetch(`${base}/api/setup`)).json();
	assert.equal(info.sources.claude.found, false);

	const done = await fetch(`${base}/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ settings: { accounts: { a: 'บัญชีงาน' }, summary: { enabled: false, provider: 'claude' } }, hooks: false }) });
	assert.equal(done.status, 200);
	const file = JSON.parse(fs.readFileSync(configFile, 'utf8'));
	assert.equal(file.setup, 'done');
	assert.equal(file.accounts.a, 'บัญชีงาน');
	assert.equal(file.summary.enabled, false);
	assert.equal((await (await fetch(`${base}/api/overview`)).json()).setup, false);
	assert.equal(summarized, 0);
});
