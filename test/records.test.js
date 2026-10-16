import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileEdits, humanPrompt, isRateLimited } from '../src/records.js';
import { resolveProject } from '../src/projects.js';
import { inferAccounts } from '../src/accounts.js';
import { applyRecord, emptySession, finalizeSession } from '../src/session-state.js';

test('humanPrompt keeps typed text and drops tool results, hooks and scheduled turns', () => {
	assert.equal(humanPrompt({ type: 'user', origin: { kind: 'human' }, message: { content: 'ช่วยดูรายงาน' } }), 'ช่วยดูรายงาน');
	assert.equal(humanPrompt({ type: 'user', message: { content: [{ type: 'text', text: 'older log' }] } }), 'older log');
	assert.equal(humanPrompt({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } }), null);
	assert.equal(humanPrompt({ type: 'user', isMeta: true, message: { content: 'meta' } }), null);
	assert.equal(humanPrompt({ type: 'user', message: { content: '<command-name>/clear</command-name>' } }), null);
	assert.equal(humanPrompt({ type: 'user', turnOrigin: 'scheduled', message: { content: 'run' } }), null);
	assert.equal(humanPrompt({ type: 'user', origin: { kind: 'task-notification' }, message: { content: 'x' } }), null);
});

test('fileEdits reads edit tool paths only', () => {
	const record = { type: 'assistant', message: { content: [
		{ type: 'tool_use', name: 'Write', input: { file_path: 'E:\\a.md' } },
		{ type: 'tool_use', name: 'Read', input: { file_path: 'E:\\b.md' } },
		{ type: 'tool_use', name: 'NotebookEdit', input: { notebook_path: 'E:\\c.ipynb' } },
	] } };
	assert.deepEqual(fileEdits(record).map(e => e.path), ['E:\\a.md', 'E:\\c.ipynb']);
});

test('isRateLimited spots the usage limit error', () => {
	assert.equal(isRateLimited({ type: 'assistant', isApiErrorMessage: true, error: 'rate_limit' }), true);
	assert.equal(isRateLimited({ type: 'assistant', message: { content: [] } }), false);
});

test('resolveProject groups by first folder under a root', () => {
	const config = { roots: ['E:\\'], exclude: ['E:\\Research\\bench\\fixtures\\'], projectNames: { 'shop': 'Corner Shop' } };
	assert.equal(resolveProject('E:\\Research\\bench', config).key, 'e:/research');
	assert.equal(resolveProject('e:\\research', config).key, 'e:/research');
	assert.equal(resolveProject('E:\\shop', config).name, 'Corner Shop');
	assert.equal(resolveProject('E:\\webapp\\app-v2\\.claude\\worktrees\\lucid-11afc4', config).key, 'e:/webapp');
	assert.deepEqual(resolveProject('E:\\Research\\bench\\fixtures\\sample-app', config), { excluded: true });
	assert.equal(resolveProject('C:\\Users\\me\\code\\app', config).name, 'app');
	assert.equal(resolveProject(null, config), null);
});

test('inferAccounts borrows the nearest account within the window only', () => {
	const hour = 3600 * 1000;
	const sessions = [
		{ id: 'known', account_uuid: 'A', account_source: 'log', first_ts: '2026-10-01T10:00:00Z', last_ts: '2026-10-01T12:00:00Z' },
		{ id: 'near', first_ts: '2026-10-01T13:00:00Z', last_ts: '2026-10-01T14:00:00Z' },
		{ id: 'far', first_ts: '2026-09-01T10:00:00Z', last_ts: '2026-09-01T11:00:00Z' },
		{ id: 'robot', is_automated: 1, first_ts: '2026-10-01T12:30:00Z', last_ts: '2026-10-01T12:31:00Z' },
	];
	const result = inferAccounts(sessions, 6 * hour);
	assert.equal(result.get('near'), 'A');
	assert.equal(result.has('far'), false);
	assert.equal(result.has('robot'), false);
});

test('session state records account, titles and how the session ended', () => {
	const s = emptySession('s1', 'x.jsonl');
	const edits = [];
	const records = [
		{ type: 'bridge-session', ownerAccountUuid: 'acct-1' },
		{ type: 'user', origin: { kind: 'human' }, cwd: 'E:\\shop', timestamp: '2026-10-16T01:00:00Z', message: { content: 'เริ่มงาน' } },
		{ type: 'assistant', timestamp: '2026-10-16T01:01:00Z', message: { model: 'claude-opus-5-5', content: [
			{ type: 'text', text: 'แก้ไฟล์แล้ว' },
			{ type: 'tool_use', name: 'Edit', input: { file_path: 'E:\\shop\\a.js' } },
		] } },
		{ type: 'custom-title', customTitle: 'shop MVP' },
		{ type: 'assistant', timestamp: '2026-10-16T01:02:00Z', isApiErrorMessage: true, error: 'rate_limit', message: { content: [] } },
	];
	for (const r of records) applyRecord(s, r, { onEdit: e => edits.push(e) });
	finalizeSession(s);
	assert.equal(s.account_uuid, 'acct-1');
	assert.equal(s.account_source, 'log');
	assert.equal(s.cwd, 'E:\\shop');
	assert.equal(s.custom_title, 'shop MVP');
	assert.equal(s.human_turns, 1);
	assert.equal(s.last_assistant_text, 'แก้ไฟล์แล้ว');
	assert.equal(s.end_state, 'rate_limited');
	assert.equal(s.model, 'claude-opus-5-5');
	assert.deepEqual(edits.map(e => e.path), ['E:\\shop\\a.js']);
});
