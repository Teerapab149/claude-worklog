import assert from 'node:assert/strict';
import { test } from 'node:test';
import { howToContinue, recommend, resumeCommand, suggestAccount } from '../src/recommend.js';

const NOW = new Date(2026, 9, 16, 18, 0).getTime(); // 16 Oct 2026 18:00 local
const hoursAgo = h => new Date(NOW - h * 3600 * 1000).toISOString();

const A = { uuid: 'a', label: 'บัญชี A', tool: 'claude', limited: false, limits: [] };
const B = { uuid: 'b', label: 'บัญชี B', tool: 'claude', limited: true, limits: [{ type: 'five_hour', resets_at: NOW + 2 * 3600 * 1000 }] };
const CODEX = { uuid: 'codex', label: 'Codex', tool: 'codex', limited: false, limits: [] };

function session(over) {
	return { id: 's', title: 'งาน', tool: 'claude', account_uuid: 'a', cwd: 'E:\\work', end_state: 'replied', last_ts: hoursAgo(2), ...over };
}

test('a session cut off by a usage limit with an exam in two days comes first', () => {
	const items = [
		{ project: { key: 'p1', name: 'งานเก่า' }, latest: session({ id: 'old', last_ts: hoursAgo(24 * 40) }), summary: { status: 'in_progress', next_steps: ['ทำต่อ'] } },
		{ project: { key: 'p2', name: 'notes' }, latest: session({ id: 'report', end_state: 'rate_limited', account_uuid: 'b' }),
			summary: { status: 'in_progress', next_steps: ['ทำโจทย์ฝึก'], headline: 'เตรียมส่งรายงาน' }, deadlines: [{ date: '2026-10-18', text: 'ส่งรายงานโครงการ' }] },
		{ project: { key: 'p3', name: 'เสร็จแล้ว' }, latest: session({ id: 'done' }), summary: { status: 'done' } },
	];
	const out = recommend(items, [A, B, CODEX], NOW);
	assert.equal(out[0].project.name, 'notes');
	assert.match(out[0].reasons[0], /ติด limit/);
	assert.ok(out[0].reasons.some(r => /อีก 2 วัน/.test(r)));
	assert.equal(out[0].next_step, 'ทำโจทย์ฝึก');
	// B is limited, so the work moves to A.
	assert.equal(out[0].account.uuid, 'a');
	assert.match(out[0].account.note, /บัญชี B ติด limit/);
	assert.ok(!out.some(i => i.project.name === 'เสร็จแล้ว'));
	assert.ok(out.find(i => i.project.name === 'งานเก่า').cautions.some(c => /ไม่ได้แตะมา/.test(c)));
});

test('abandoned work and projects without a person session are left out', () => {
	const out = recommend([
		{ project: { key: 'x', name: 'เลิกทำ' }, latest: session({}), summary: { status: 'abandoned' } },
		{ project: { key: 'y', name: 'ไม่มี session' }, latest: null, summary: null },
	], [A], NOW);
	assert.equal(out.length, 0);
});

test('when every Claude account is limited, Codex is offered with the earliest reset', () => {
	const C = { ...B, uuid: 'c', label: 'บัญชี C', limits: [{ type: 'five_hour', resets_at: NOW + 5 * 3600 * 1000 }] };
	const pick = suggestAccount(session({ account_uuid: 'c' }), [B, C, CODEX]);
	assert.equal(pick.uuid, 'codex');
	assert.match(pick.note, /Claude บัญชี B ว่างก่อน/);
	assert.match(pick.note, /Codex/);
});

test('resume commands match the tool', () => {
	assert.equal(resumeCommand(session({ id: 'abc' })), 'cd "E:\\work"; claude --resume abc');
	assert.equal(resumeCommand(session({ id: 'xyz', tool: 'codex' })), 'cd "E:\\work"; codex resume xyz');
});

test('a session that is still open is not reported as waiting for a reply', () => {
	const [item] = recommend([
		{ project: { key: 'p', name: 'เปิดอยู่' }, latest: session({ end_state: 'no_reply' }), summary: null, active: true },
	], [A], NOW);
	assert.ok(item.reasons.includes('มี session ที่ยังเปิดทำอยู่ตอนนี้'));
	assert.ok(!item.reasons.some(r => /ยังไม่ได้คำตอบ/.test(r)));
});

test('work opened in the desktop app is found in its sidebar, terminal work gets a command', () => {
	const summary = { headline: 'MVP ใกล้เสร็จ', in_progress: ['เชื่อม Supabase'], next_steps: ['ทำสไลด์'], waiting_on: [] };
	const app = howToContinue(session({ id: 'abc', entrypoint: 'claude-desktop', jsonl_path: 'C:\\logs\\abc.jsonl' }), summary);
	assert.equal(app.via, 'app');
	assert.equal(app.app, 'Claude');
	assert.equal(app.command, null);
	assert.match(app.prompt, /ชื่อ "งาน" ในโฟลเดอร์ E:\\work/);
	assert.match(app.prompt, /งานถึงไหนแล้ว: MVP ใกล้เสร็จ/);
	assert.match(app.prompt, /- เชื่อม Supabase\n\nขั้นต่อไป\n- ทำสไลด์\n\n/);
	assert.match(app.prompt, /C:\\logs\\abc\.jsonl/);
	assert.ok(!/เรื่องที่รออยู่/.test(app.prompt));

	assert.equal(howToContinue(session({ tool: 'codex', entrypoint: 'Codex Desktop' }), null).app, 'Codex');
	const term = howToContinue(session({ id: 'abc', entrypoint: 'cli', last_human_text: 'แก้หน้า login' }), null);
	assert.equal(term.via, 'terminal');
	assert.equal(term.command, 'cd "E:\\work"; claude --resume abc');
	assert.match(term.prompt, /คำสั่งล่าสุดที่ผมให้ไว้: แก้หน้า login/);
});

test('a change of account is flagged so the prompt can lead', () => {
	const items = [{ project: { key: 'p', name: 'p' }, latest: session({ account_uuid: 'b', end_state: 'rate_limited', entrypoint: 'claude-desktop' }), summary: null }];
	const [item] = recommend(items, [A, B], NOW);
	assert.equal(item.account.uuid, 'a');
	assert.equal(item.switched, true);
	assert.equal(item.continue.via, 'app');
	assert.equal(recommend([{ ...items[0], latest: session({ entrypoint: 'claude-desktop' }) }], [A, B], NOW)[0].switched, false);
});

test('account advice is honest without a reading and spreads work across free accounts', async () => {
	const { suggestAccount } = await import('../src/recommend.js');
	const latest = { tool: 'claude', account_uuid: 'a' };
	const acct = (uuid, extra = {}) => ({ uuid, label: uuid, tool: 'claude', limited: false, limits: [], usage: [], used5h: 0, ...extra });
	assert.match(suggestAccount(latest, [acct('a')]).note, /ยังไม่เห็นว่าติด limit/);
	assert.match(suggestAccount(latest, [acct('a', { usage: [{ used_percent: 30 }] })]).note, /เหลือ 70%/);
	// a is limited; of b and c, c was used less in the last five hours.
	const limited = acct('a', { limited: true, limits: [{ resets_at: Date.now() + 3600000 }] });
	assert.equal(suggestAccount(latest, [limited, acct('b', { used5h: 4 }), acct('c', { used5h: 1 })]).uuid, 'c');
});
