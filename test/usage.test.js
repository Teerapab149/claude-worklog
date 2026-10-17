import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { resolveConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { addHooks, isOurStatusLine, removeHooks } from '../src/hook-install.js';
import { accounts } from '../src/queries.js';
import { emptySession } from '../src/session-state.js';
import { codex } from '../src/sources/codex.js';
import { record, render } from '../src/statusline.js';

const NOW = Date.parse('2026-10-16T12:00:00Z');
const config = resolveConfig({ accounts: { a: 'บัญชี A' } });

function setup() {
	const db = openDb(':memory:');
	db.saveAccount('a', 'บัญชี A');
	db.saveAccount('codex', 'Codex', 'codex');
	db.saveSession({ ...emptySession('s1', 's1.jsonl'), account_uuid: 'a', account_source: 'log', first_ts: '2026-10-16T09:00:00Z', last_ts: '2026-10-16T11:00:00Z' });
	return db;
}

test('the status line stores Claude usage once per change and prints what is left', () => {
	const db = setup();
	const input = { session_id: 's1', rate_limits: {
		five_hour: { used_percentage: 38, resets_at: (NOW + 2 * 3600000) / 1000 },
		seven_day: { used_percentage: 12.5, resets_at: (NOW + 3 * 86400000) / 1000 },
	} };
	const found = record(db, input, NOW);
	assert.equal(render(found), '5 ชม. เหลือ 62%, สัปดาห์ เหลือ 88%');
	record(db, input, NOW + 1000);
	assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM usage').get().n, 2);
	assert.equal(render(record(db, { session_id: 's1' }, NOW)), '');

	const acct = accounts(db, config, NOW).find(a => a.uuid === 'a');
	assert.deepEqual(acct.usage.map(u => [u.window, u.used_percent]).sort(), [['five_hour', 38], ['seven_day', 12.5]]);
});

test('a window past its reset is full again only if the account was not used since', () => {
	const db = setup();
	db.addUsage('codex:latest', { account: 'codex', ts: '2026-10-01T00:00:00Z', window: 'primary', usedPercent: 100, windowMinutes: 43200, resetsAt: NOW - 86400000, source: 'latest' });
	const codexAcct = accounts(db, config, NOW).find(a => a.uuid === 'codex');
	assert.equal(codexAcct.usage[0].used_percent, 0);
	assert.equal(codexAcct.usage[0].reset_seen, NOW - 86400000);

	db.addUsage('s1', { account: 'a', ts: '2026-10-16T08:00:00Z', window: 'five_hour', usedPercent: 90, windowMinutes: 300, resetsAt: NOW - 2 * 3600000, source: 'statusline' });
	// That window reset at 10:00 and account a was used at 11:00, so the old reading says nothing.
	assert.equal(accounts(db, config, NOW).find(a => a.uuid === 'a').usage.length, 0);
});

test('a refusal still in force counts as a used-up window', () => {
	const db = setup();
	db.addQuota('s1', { ts: '2026-10-16T11:30:00Z', status: 'rejected', rateLimitType: 'five_hour', resetsAt: (NOW + 3600000) / 1000 });
	const acct = accounts(db, config, NOW).find(a => a.uuid === 'a');
	assert.equal(acct.usage[0].used_percent, 100);
	assert.equal(acct.usage[0].source, 'refusal');
});

test('the newest Codex usage is read from the tail of the newest logs', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-codex-'));
	const line = (ts, limits) => JSON.stringify({ timestamp: ts, type: 'event_msg', payload: { type: 'token_count', rate_limits: limits } });
	const old = path.join(dir, 'old.jsonl'), recent = path.join(dir, 'new.jsonl');
	fs.writeFileSync(old, line('2026-10-01T00:00:00Z', { primary: { used_percent: 10, window_minutes: 300, resets_at: 1 } }) + '\n');
	fs.writeFileSync(recent, line('2026-10-05T00:00:00Z', { primary: { used_percent: 55, window_minutes: 43200, resets_at: 1790000000 } }) + '\n'
		+ line('2026-10-05T00:01:00Z', null) + '\n');
	fs.utimesSync(old, new Date('2026-10-01'), new Date('2026-10-01'));
	try {
		const [u] = codex.latestUsage([old, recent]);
		assert.equal(u.usedPercent, 55);
		assert.equal(u.windowMinutes, 43200);
		assert.equal(u.resetsAt, 1790000000 * 1000);
	}
	finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the status line is installed only when none is set, and removed cleanly', () => {
	const ours = addHooks({}, 'C:\\node.exe');
	assert.ok(isOurStatusLine(ours.statusLine));
	assert.match(ours.statusLine.command, /^"C:\/node\.exe" .* "[^"]+\/bin\/statusline\.js"$/);
	assert.deepEqual(removeHooks(ours), {});
	const mine = { statusLine: { type: 'command', command: 'my-status' } };
	assert.deepEqual(addHooks(mine, 'node').statusLine, mine.statusLine);
	assert.deepEqual(removeHooks(addHooks(mine, 'node')), mine);
});

test('a limit marked by hand holds until its reset, then lets the account go', () => {
	const db = setup();
	db.markLimit('a', 'seven_day', NOW + 3600000, new Date(NOW).toISOString());
	let acct = accounts(db, config, NOW).find(a => a.uuid === 'a');
	assert.equal(acct.limited, true);
	assert.deepEqual(acct.limits.map(l => [l.type, l.manual]), [['seven_day', true]]);
	acct = accounts(db, config, NOW + 2 * 3600000).find(a => a.uuid === 'a');
	assert.equal(acct.limited, false);
	assert.equal(acct.marked, false);
});

test('hooks from another copy of Worklog are replaced, not run twice, and other hooks stay', () => {
	const elsewhere = { type: 'command', command: 'node', args: ['--disable-warning=ExperimentalWarning', 'D:/old/worklog/bin/hook.js', 'pre-tool-use'] };
	const theirs = { type: 'command', command: 'node', args: ['C:/tools/bin/hook.js', 'lint'] };
	const settings = {
		hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [elsewhere, theirs] }] },
		statusLine: { type: 'command', command: '"node" --disable-warning=ExperimentalWarning "D:/old/worklog/bin/statusline.js"' },
	};
	const out = addHooks(settings, 'node');
	const all = Object.values(out.hooks).flat().flatMap(g => g.hooks);
	assert.equal(all.filter(h => h.args?.includes('pre-tool-use')).length, 1);
	assert.ok(all.includes(theirs) || all.some(h => h.args?.[1] === 'lint'));
	assert.ok(!out.statusLine.command.includes('D:/old'));
	assert.deepEqual(removeHooks(out).hooks.PreToolUse[0].hooks.map(h => h.args[1]), ['lint']);
});

test('the 5-hour window is estimated from use when no reading says otherwise', () => {
	const db = setup();
	// s1 ran 09:00 to 11:00; at 12:00 the window started at 09:00 and ends at 14:00.
	const acct = accounts(db, config, NOW).find(a => a.uuid === 'a');
	assert.deepEqual(acct.window5h, { startedAt: Date.parse('2026-10-16T09:00:00Z'), resetsAt: Date.parse('2026-10-16T14:00:00Z') });
	assert.equal(acct.used5h, 1);
	// Long after, there is no current window to guess.
	assert.equal(accounts(db, config, NOW + 10 * 3600000).find(a => a.uuid === 'a').window5h, null);
});
