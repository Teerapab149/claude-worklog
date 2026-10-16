import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { resolveConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { scan } from '../src/indexer.js';

function fixture() {
	const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-'));
	const dir = path.join(claudeDir, 'projects', 'E--H-');
	fs.mkdirSync(dir, { recursive: true });
	const config = resolveConfig({ claudeDir, codexDir: path.join(claudeDir, 'codex'), roots: ['E:\\'], exclude: ['E:\\shop\\fixtures'], accounts: { 'acct-1': 'บัญชีหลัก' } });
	return { claudeDir, dir, config };
}

const line = r => JSON.stringify(r) + '\n';

test('scan reads only new lines and leaves a half written line for later', () => {
	const { claudeDir, dir, config } = fixture();
	const file = path.join(dir, 'aaa.jsonl');
	fs.writeFileSync(file,
		line({ type: 'bridge-session', ownerAccountUuid: 'acct-1' })
		+ line({ type: 'user', cwd: 'E:\\shop', timestamp: '2026-10-16T01:00:00Z', message: { content: 'งานแรก' } })
		+ '{"type":"assistant","timestamp":"2026-10-16T01:0');
	const db = openDb(':memory:');

	let stats = scan(db, config);
	assert.equal(stats.read, 1);
	let s = db.getSession('aaa');
	assert.equal(s.human_turns, 1);
	assert.equal(s.last_assistant_text, null);
	assert.equal(s.project_key, 'e:/shop');

	fs.appendFileSync(file, '1:00Z","message":{"content":[{"type":"text","text":"เสร็จแล้ว"}]}}\n'
		+ line({ type: 'user', timestamp: '2026-10-16T02:00:00Z', message: { content: 'งานที่สอง' } }));
	stats = scan(db, config);
	s = db.getSession('aaa');
	assert.equal(s.last_assistant_text, 'เสร็จแล้ว');
	assert.equal(s.human_turns, 2);
	assert.equal(s.last_human_text, 'งานที่สอง');
	assert.equal(s.account_uuid, 'acct-1');
	assert.equal(stats.badLines, 0);

	stats = scan(db, config);
	assert.equal(stats.unchanged, 1);
	assert.equal(db.raw.prepare('SELECT label FROM accounts WHERE uuid = ?').get('acct-1').label, 'บัญชีหลัก');
	db.close();
	fs.rmSync(claudeDir, { recursive: true, force: true });
});

test('scan drops sessions in excluded folders and infers missing accounts', () => {
	const { claudeDir, dir, config } = fixture();
	fs.writeFileSync(path.join(dir, 'known.jsonl'),
		line({ type: 'bridge-session', ownerAccountUuid: 'acct-1' })
		+ line({ type: 'user', cwd: 'E:\\shop', timestamp: '2026-10-16T01:00:00Z', message: { content: 'a' } }));
	fs.writeFileSync(path.join(dir, 'unknown.jsonl'),
		line({ type: 'user', cwd: 'E:\\shop', timestamp: '2026-10-16T02:00:00Z', message: { content: 'b' } }));
	fs.writeFileSync(path.join(dir, 'skip.jsonl'),
		line({ type: 'user', cwd: 'E:\\shop\\fixtures\\x', timestamp: '2026-10-16T02:00:00Z', message: { content: 'c' } }));
	const db = openDb(':memory:');

	const stats = scan(db, config);
	assert.equal(stats.excluded, 1);
	assert.equal(db.getSession('skip'), null);
	const unknown = db.getSession('unknown');
	assert.equal(unknown.account_uuid, 'acct-1');
	assert.equal(unknown.account_source, 'inferred');
	db.close();
	fs.rmSync(claudeDir, { recursive: true, force: true });
});
