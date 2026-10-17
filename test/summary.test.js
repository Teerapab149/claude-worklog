import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { resolveConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { buildDigest, maskSecrets } from '../src/digest.js';
import { scan } from '../src/indexer.js';
import { cleanSummary, cleanText } from '../src/summarizer.js';
import { createSummaryQueue, getSummary } from '../src/summaries.js';

const BANNED = /[\u00B7\u2192\u2190\u2014\p{Extended_Pictographic}]/u;
const line = r => JSON.stringify(r) + '\n';

test('cleanText removes the characters the person does not want', () => {
	const dirty = 'สรุป: ทำ A \u2192 ได้ B \u00B7 แก้ C \u2014 เสร็จแล้ว \u{1F680}';
	const clean = cleanText(dirty);
	assert.doesNotMatch(clean, BANNED);
	assert.doesNotMatch(clean, /^สรุป/);
	assert.equal(clean, 'ทำ A แล้ว ได้ B, แก้ C, เสร็จแล้ว');
});

test('cleanSummary fills missing fields and drops bad dates', () => {
	const out = cleanSummary({ headline: 'งาน \u2014 ค้าง', status: 'weird', next_steps: ['ทำต่อ \u2192 ส่ง'], deadlines: [{ date: '20 ต.ค.', text: 'ส่งงาน' }] });
	assert.equal(out.status, 'in_progress');
	assert.deepEqual(out.done, []);
	assert.equal(out.deadlines[0].date, null);
	assert.doesNotMatch(JSON.stringify(out), BANNED);
});

test('maskSecrets hides keys but keeps file paths', () => {
	const text = 'key sk-ant-api03-abcdefghijklmnop and password=hunter2hunter in E:/chatbot/app/components/projects/ProjectWorkspace.js';
	const masked = maskSecrets(text);
	assert.doesNotMatch(masked, /sk-ant-api03/);
	assert.doesNotMatch(masked, /hunter2/);
	assert.match(masked, /password=\[ซ่อน\]/);
	assert.match(masked, /ProjectWorkspace\.js/);
});

test('buildDigest keeps the first request and the latest turns within budget', () => {
	const turns = [{ role: 'user', ts: '2026-10-16T01:00:00Z', text: 'งานแรก' }];
	for (let i = 0; i < 50; i++) turns.push({ role: i % 2 ? 'user' : 'assistant', ts: '2026-10-16T02:00:00Z', text: `ข้อความ ${i} ${'x'.repeat(200)}` });
	const digest = buildDigest({ project_name: 'shop', end_state: 'rate_limited' }, { turns, files: new Map([['E:/shop/a.js', 3]]) }, { maxChars: 3000 });
	assert.ok(digest.length <= 3300);
	assert.match(digest, /งานแรก/);
	assert.match(digest, /ข้อความ 49/);
	assert.match(digest, /ตัดบทสนทนาช่วงกลางออก/);
	assert.match(digest, /ติด usage limit/);
	assert.match(digest, /E:\/shop\/a\.js/);
});

function setup() {
	const claudeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-'));
	const dir = path.join(claudeDir, 'projects', 'E--H-');
	fs.mkdirSync(dir, { recursive: true });
	const now = Date.parse('2026-10-16T12:00:00Z');
	fs.writeFileSync(path.join(dir, 'one.jsonl'),
		line({ type: 'bridge-session', ownerAccountUuid: 'acct-1' })
		+ line({ type: 'user', cwd: 'E:\\shop', timestamp: '2026-10-16T01:00:00Z', message: { content: 'ทำหน้า login' } })
		+ line({ type: 'assistant', timestamp: '2026-10-16T01:05:00Z', message: { content: [{ type: 'text', text: 'ทำหน้า login แล้ว' }] } }));
	const config = resolveConfig({ claudeDir, codexDir: path.join(claudeDir, 'codex'), roots: ['E:\\'], dataDir: path.join(claudeDir, 'data') });
	const db = openDb(':memory:');
	scan(db, config);
	return { claudeDir, config, db, now };
}

const waitFor = async (check, ms = 2000) => {
	const end = Date.now() + ms;
	while (!check()) {
		if (Date.now() > end) throw new Error('timed out');
		await new Promise(r => setTimeout(r, 10));
	}
};

test('queue summarizes stale sessions, then their project, and skips fresh ones', async () => {
	const { claudeDir, config, db, now } = setup();
	const calls = [];
	const run = async ({ system, input }) => {
		calls.push({ project: system.includes('ภาพรวมของหนึ่งโปรเจค'), input });
		return { summary: cleanSummary({ headline: 'ทำหน้า login เสร็จ', status: 'done', next_steps: ['ทำหน้า register'] }), costUsd: 0.001 };
	};
	const queue = createSummaryQueue({ db, config, run, now: () => now });

	assert.equal(queue.enqueueStale(), 1);
	await waitFor(() => queue.idle() && calls.length === 2);
	assert.equal(calls[0].project, false);
	assert.match(calls[0].input, /ทำหน้า login/);
	assert.equal(calls[1].project, true);
	assert.equal(getSummary(db, 'session', 'one').data.headline, 'ทำหน้า login เสร็จ');
	assert.equal(getSummary(db, 'project', 'e:/shop').data.next_steps[0], 'ทำหน้า register');

	assert.equal(queue.enqueueStale(), 0);
	db.close();
	fs.rmSync(claudeDir, { recursive: true, force: true });
});

test('an auth failure pauses the queue until the person asks again', async () => {
	const { claudeDir, config, db, now } = setup();
	let fail = true;
	const run = async () => {
		if (fail) throw Object.assign(new Error('OAuth session expired'), { kind: 'auth' });
		return { summary: cleanSummary({ headline: 'ok', status: 'done' }), costUsd: 0 };
	};
	const queue = createSummaryQueue({ db, config, run, now: () => now });
	queue.enqueueStale();
	await waitFor(() => queue.status().paused);
	assert.equal(queue.status().paused.kind, 'auth');
	assert.equal(getSummary(db, 'session', 'one').error_kind, 'auth');
	assert.equal(queue.isBusy('session', 'one'), true);

	fail = false;
	queue.enqueue('session', 'one', { manual: true });
	await waitFor(() => queue.idle());
	assert.equal(getSummary(db, 'session', 'one').data.headline, 'ok');
	assert.equal(getSummary(db, 'session', 'one').error, null);
	db.close();
	fs.rmSync(claudeDir, { recursive: true, force: true });
});

test('automatic summaries wait for a quiet session, respect the daily limit and never-send folders', async () => {
	const { claudeDir, config, db, now } = setup();
	const calls = [];
	const run = async ({ input }) => {
		calls.push(input);
		return { summary: cleanSummary({ headline: 'ok', status: 'done' }), costUsd: 0, usage: { in: 1000, out: 50 } };
	};
	// Still being worked on: the last message was five minutes ago.
	let queue = createSummaryQueue({ db, config, run, now: () => Date.parse('2026-10-16T01:10:00Z') });
	assert.equal(queue.enqueueStale(), 0);

	// The folder is on the never-send list: nothing goes out, even when asked.
	config.summary.neverSend = ['E:/shop'];
	queue = createSummaryQueue({ db, config, run, now: () => now });
	assert.equal(queue.enqueueStale(), 0);
	queue.enqueue('session', 'one', { manual: true });
	await waitFor(() => queue.idle());
	assert.equal(calls.length, 0);
	assert.equal(getSummary(db, 'session', 'one').error_kind, 'never_send');

	// Over the daily limit only what the person asks for runs, and tokens are counted.
	config.summary.neverSend = [];
	config.summary.dailyLimit = 1;
	queue = createSummaryQueue({ db, config, run, now: () => now });
	assert.equal(queue.status().capped, true);
	queue.enqueue('session', 'one');
	await new Promise(r => setTimeout(r, 50));
	assert.equal(calls.length, 0);
	queue.enqueue('session', 'one', { manual: true });
	await waitFor(() => calls.length === 1 && !queue.status().running);
	assert.ok(queue.status().today.tokens >= 1050);
	db.close();
	fs.rmSync(claudeDir, { recursive: true, force: true });
});

test('a provider that says how long to wait sets the pause', async () => {
	const { claudeDir, config, db, now } = setup();
	const run = async () => { throw Object.assign(new Error('slow down'), { kind: 'rate_limit', retryAfterMs: 42000 }); };
	const queue = createSummaryQueue({ db, config, run, now: () => now });
	queue.enqueueStale();
	await waitFor(() => queue.status().paused);
	assert.equal(queue.status().paused.until, now + 42000);
	db.close();
	fs.rmSync(claudeDir, { recursive: true, force: true });
});

test('maskSecrets hides the key formats people paste, and keeps hosts and paths', () => {
	// Built here so no file holds anything that looks like a real key.
	const gemini = `AIza${'Sy0aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV'.slice(0, 35)}`;
	const stripe = `sk_live_${'4eC39HqLyjWDarjtT1zdp7dc'}`;
	const cases = [
		`GEMINI_API_KEY=${gemini}`,
		`export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`,
		`db at postgres://admin:hunter2pass@db.example.com:5432/app`,
		`charge with ${stripe}`,
		'รหัสผ่าน: hunter22',
	];
	for (const text of cases) {
		const masked = maskSecrets(text);
		assert.match(masked, /\[ซ่อน\]/, text);
		assert.doesNotMatch(masked, /hunter2|wJalrXUtn|4eC39HqLyj|Sy0aB1cD2e/, text);
	}
	assert.match(maskSecrets('postgres://admin:hunter2pass@db.example.com:5432/app'), /postgres:\/\/\[ซ่อน\]@db\.example\.com/);
	assert.equal(maskSecrets('E:/chatbot/app/components/ProjectWorkspace.js'), 'E:/chatbot/app/components/ProjectWorkspace.js');
});
