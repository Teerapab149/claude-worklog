import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { resolveConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { addHooks, HOOK_SCRIPT, isOurs, removeHooks } from '../src/hook-install.js';
import { preToolUse, sessionStart } from '../src/hooks.js';
import { checkEdit, editPath, overlaps } from '../src/overlap.js';
import { emptySession } from '../src/session-state.js';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const minutesAgo = m => new Date(NOW - m * 60000).toISOString();

function setup(overlap = {}) {
	const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-hook-'));
	const config = resolveConfig({ claudeDir, roots: ['E:\\'], accounts: { a: 'บัญชี A', b: 'บัญชี B' }, overlap });
	const db = openDb(':memory:');
	db.saveAccount('a', 'บัญชี A');
	db.saveAccount('b', 'บัญชี B');
	const save = (id, over) => db.saveSession({ ...emptySession(id, `${id}.jsonl`), project_key: 'e:/shop', cwd: 'E:\\shop',
		first_ts: minutesAgo(120), last_ts: minutesAgo(5), human_turns: 2, ...over });
	save('one', { account_uuid: 'a', custom_title: 'ทำหน้า login' });
	save('two', { account_uuid: 'b', custom_title: 'แก้ CSS' });
	const cleanup = () => { db.close(); fs.rmSync(claudeDir, { recursive: true, force: true }); };
	return { db, config, cleanup };
}

test('editPath gives one spelling for the same Windows file', () => {
	assert.equal(editPath('E:\\shop\\src\\App.js'), 'e:/shop/src/app.js');
	assert.equal(editPath('src\\App.js', 'E:\\shop'), 'e:/shop/src/app.js');
});

test('an edit after another session is stopped once, then let through', t => {
	const { db, config, cleanup } = setup();
	t.after(cleanup);
	db.addEdit('one', { ts: minutesAgo(10), path: 'E:\\shop\\src\\app.js', tool: 'Edit' });
	const input = { session_id: 'two', cwd: 'E:\\shop', tool_name: 'Edit', tool_input: { file_path: 'e:/shop/src/App.js' } };

	const first = preToolUse(db, config, input, NOW);
	assert.equal(first.hookSpecificOutput.permissionDecision, 'deny');
	assert.match(first.hookSpecificOutput.permissionDecisionReason, /10 นาทีก่อน/);
	assert.match(first.hookSpecificOutput.permissionDecisionReason, /"ทำหน้า login" \(Claude บัญชี A\)/);

	assert.equal(preToolUse(db, config, input, NOW + 1000), null);

	// Session one edits again, through the hook this time, so two hears about it.
	assert.equal(preToolUse(db, config, { ...input, session_id: 'one' }, NOW + 60000)?.hookSpecificOutput.permissionDecision, 'deny');
	assert.equal(preToolUse(db, config, { ...input, session_id: 'one' }, NOW + 61000), null);
	assert.equal(preToolUse(db, config, input, NOW + 120000)?.hookSpecificOutput.permissionDecision, 'deny');
});

test('edits outside the window, by the same session, or with other tools pass quietly', t => {
	const { db, config, cleanup } = setup();
	t.after(cleanup);
	db.addEdit('one', { ts: minutesAgo(45), path: 'E:\\shop\\old.js', tool: 'Edit' });
	db.addEdit('two', { ts: minutesAgo(2), path: 'E:\\shop\\mine.js', tool: 'Edit' });
	assert.equal(checkEdit(db, config, { sessionId: 'two', file: 'E:\\shop\\old.js', now: NOW }), null);
	assert.equal(checkEdit(db, config, { sessionId: 'two', file: 'E:\\shop\\mine.js', now: NOW }), null);
	assert.equal(preToolUse(db, config, { session_id: 'two', tool_name: 'Bash', tool_input: { command: 'ls' } }, NOW), null);
});

test('history copied into a forked session is not an overlap', t => {
	const { db, config, cleanup } = setup();
	t.after(cleanup);
	for (const id of ['one', 'two']) {
		db.addEdit(id, { ts: minutesAgo(12), path: 'E:\\shop\\a.js', tool: 'Write' });
		db.addEdit(id, { ts: minutesAgo(10), path: 'E:\\shop\\a.js', tool: 'Edit' });
	}
	assert.equal(checkEdit(db, config, { sessionId: 'two', file: 'E:\\shop\\a.js', now: NOW }), null);
	assert.equal(overlaps(db, config, [], NOW).files.length, 0);

	// After the fork both go on editing the file, which is a real overlap.
	db.addEdit('one', { ts: minutesAgo(4), path: 'E:\\shop\\a.js', tool: 'Edit' });
	db.addEdit('two', { ts: minutesAgo(2), path: 'E:\\shop\\a.js', tool: 'Edit' });
	assert.deepEqual(overlaps(db, config, [], NOW).files[0].sessions.map(s => s.id), ['two', 'one']);
	assert.ok(checkEdit(db, config, { sessionId: 'two', file: 'E:\\shop\\a.js', now: NOW }));
});

test('ask and context modes do not stop the edit', t => {
	for (const [mode, key] of [['ask', 'permissionDecision'], ['context', 'additionalContext']]) {
		const { db, config, cleanup } = setup({ preToolUse: mode });
		db.addEdit('one', { ts: minutesAgo(3), path: 'E:\\shop\\a.js', tool: 'Write' });
		const out = preToolUse(db, config, { session_id: 'two', tool_name: 'Write', tool_input: { file_path: 'E:\\shop\\a.js' } }, NOW);
		assert.ok(out.hookSpecificOutput[key], mode);
		assert.notEqual(out.hookSpecificOutput.permissionDecision, 'deny');
		cleanup();
	}
});

test('the dashboard lists files two accounts edited close together', t => {
	const { db, config, cleanup } = setup();
	t.after(cleanup);
	db.addEdit('one', { ts: minutesAgo(20), path: 'E:\\shop\\src\\app.js', tool: 'Edit' });
	db.addEdit('two', { ts: minutesAgo(8), path: 'e:/shop/src/app.js', tool: 'Edit' });
	db.addEdit('one', { ts: minutesAgo(300), path: 'E:\\shop\\far.js', tool: 'Edit' });
	db.addEdit('two', { ts: minutesAgo(30), path: 'E:\\shop\\far.js', tool: 'Edit' });
	const active = [
		{ id: 'one', project_key: 'e:/shop', project_name: 'shop', title: 'ทำหน้า login', account_uuid: 'a' },
		{ id: 'two', project_key: 'e:/shop', project_name: 'shop', title: 'แก้ CSS', account_uuid: 'b' },
	];
	const out = overlaps(db, config, active, NOW);
	assert.equal(out.files.length, 1);
	assert.deepEqual(out.files[0].sessions.map(s => s.id), ['two', 'one']);
	assert.equal(out.files[0].strong, true);
	assert.equal(out.openTogether.length, 1);
	assert.equal(out.openTogether[0].strong, true);
});

test('a new session hears about the last piece of work in its project', t => {
	const { db, config, cleanup } = setup();
	t.after(cleanup);
	db.raw.prepare("INSERT INTO summaries (kind, ref, json) VALUES ('project', 'e:/shop', ?)")
		.run(JSON.stringify({ headline: 'MVP ใกล้เสร็จ', in_progress: ['เชื่อม Supabase'], next_steps: ['ทำสไลด์'], waiting_on: [] }));
	const out = sessionStart(db, config, { session_id: 'new', cwd: 'E:\\shop\\src', source: 'startup' }, NOW);
	const text = out.hookSpecificOutput.additionalContext;
	assert.match(text, /โปรเจค shop/);
	assert.match(text, /MVP ใกล้เสร็จ/);
	assert.match(text, /- เชื่อม Supabase/);
	assert.equal(sessionStart(db, config, { session_id: 'new', cwd: 'E:\\shop', source: 'resume' }, NOW), null);
});

test('installing hooks keeps other settings and can be undone', () => {
	const other = { type: 'command', command: 'echo hi' };
	const settings = { theme: 'dark', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [other] }] } };
	const once = addHooks(settings, 'node');
	assert.deepEqual(addHooks(once, 'node'), once);
	assert.equal(once.hooks.PreToolUse.length, 2);
	assert.ok(once.hooks.SessionStart[0].hooks[0].args.includes(HOOK_SCRIPT));
	assert.ok(isOurs(once.hooks.SessionEnd[0].hooks[0]));
	assert.deepEqual(removeHooks(once), settings);
	assert.deepEqual(removeHooks(addHooks({ theme: 'dark' }, 'node')), { theme: 'dark' });
});
