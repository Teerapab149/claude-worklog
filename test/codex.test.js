import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { resolveConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { buildDigest, readConversation } from '../src/digest.js';
import { scan } from '../src/indexer.js';
import { codex } from '../src/sources/codex.js';

const line = r => JSON.stringify(r) + '\n';
const ID = '01a10d65-ad06-7021-ac8a-485a10374a5b';
const SUB = '01a10d65-ad06-7021-ac8a-485a10374a5c';
const COPY = '01a10d65-ad06-7021-ac8a-485a10374a5d';

function item(ts, turnId, it) {
	return line({ timestamp: ts, type: 'event_msg', payload: { type: 'item_completed', turn_id: turnId, item: it } });
}

function fixture() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-'));
	const codexDir = path.join(root, 'codex');
	const day = path.join(codexDir, 'sessions', '2026', '10', '05');
	fs.mkdirSync(day, { recursive: true });
	fs.writeFileSync(path.join(codexDir, 'session_index.jsonl'), line({ id: ID, thread_name: 'เตรียมพรีเซนต์ SFAS' }));
	fs.writeFileSync(path.join(day, `rollout-2026-10-05T10-00-00-${ID}.jsonl`),
		line({ timestamp: '2026-10-05T10:00:00Z', type: 'session_meta', payload: { id: ID, cwd: 'E:\\notes', cli_version: '0.160.0', originator: 'Codex Desktop', source: 'vscode' } })
		+ item('2026-10-05T10:00:01Z', 'external-import-turn-1', { type: 'UserMessage', content: [{ type: 'text', text: 'ข้อความที่นำเข้ามาจากเครื่องมืออื่น' }] })
		+ line({ timestamp: '2026-10-05T10:00:02Z', type: 'turn_context', payload: { model: 'gpt-5.6-terra', cwd: 'E:\\notes' } })
		+ item('2026-10-05T10:01:00Z', 't1', { type: 'UserMessage', content: [{ type: 'text', text: 'ทำสไลด์ SFAS ให้หน่อย' }] })
		+ item('2026-10-05T10:02:00Z', 't1', { type: 'FileChange', changes: { 'E:\\notes\\plan.pptx': { type: 'add' } } })
		+ item('2026-10-05T10:03:00Z', 't1', { type: 'AgentMessage', content: [{ type: 'Text', text: 'ทำสไลด์ SFAS เสร็จแล้ว' }] }));
	fs.writeFileSync(path.join(day, `rollout-2026-10-05T10-05-00-${SUB}.jsonl`),
		line({ timestamp: '2026-10-05T10:05:00Z', type: 'session_meta', payload: { id: SUB, cwd: 'E:\\notes', source: { subagent: { other: 'guardian' } } } })
		+ item('2026-10-05T10:05:01Z', 't9', { type: 'UserMessage', content: [{ type: 'text', text: 'งานของ sub-agent' }] }));
	fs.writeFileSync(path.join(day, `rollout-2026-10-05T11-00-00-${COPY}.jsonl`),
		line({ timestamp: '2026-10-05T11:00:00Z', type: 'session_meta', payload: { id: COPY, cwd: 'E:\\notes', source: 'vscode' } })
		+ item('2026-10-05T11:00:01Z', 'external-import-turn-1', { type: 'UserMessage', content: [{ type: 'text', text: 'สำเนาจาก Claude' }] }));
	const config = resolveConfig({ claudeDir: path.join(root, 'claude'), codexDir, roots: ['E:\\'] });
	return { root, config };
}

test('Codex sessions are read with their title, edits and turns, and sub-agents are skipped', () => {
	const { root, config } = fixture();
	const db = openDb(':memory:');
	const stats = scan(db, config);
	assert.equal(stats.byTool.codex, 3);
	assert.equal(stats.excluded, 2);
	assert.equal(db.getSession(COPY), null);
	assert.equal(db.getScanState([...db.raw.prepare('SELECT path FROM scan_state').all()].map(r => r.path).find(p => p.includes(COPY))).excluded, 0);

	const s = db.getSession(ID);
	assert.equal(s.tool, 'codex');
	assert.equal(s.project_key, 'e:/notes');
	assert.equal(s.custom_title, 'เตรียมพรีเซนต์ SFAS');
	assert.equal(s.account_uuid, 'codex');
	assert.equal(s.human_turns, 1);
	assert.equal(s.last_human_text, 'ทำสไลด์ SFAS ให้หน่อย');
	assert.equal(s.last_assistant_text, 'ทำสไลด์ SFAS เสร็จแล้ว');
	assert.equal(s.end_state, 'replied');
	assert.equal(s.model, 'gpt-5.6-terra');
	assert.equal(db.getSession(SUB), null);

	const edits = db.raw.prepare('SELECT path FROM file_edits WHERE session_id = ?').all(ID).map(r => r.path);
	assert.deepEqual(edits, ['E:\\notes\\plan.pptx']);
	assert.equal(db.raw.prepare('SELECT label, tool FROM accounts WHERE uuid = ?').get('codex').label, 'Codex');

	const digest = buildDigest({ ...s, project_name: 'notes' }, readConversation(s.jsonl_path, codex), { adapter: codex });
	assert.match(digest, /เครื่องมือ: Codex/);
	assert.match(digest, /\[Codex /);
	assert.doesNotMatch(digest, /นำเข้ามาจากเครื่องมืออื่น/);
	db.close();
	fs.rmSync(root, { recursive: true, force: true });
});
