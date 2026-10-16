// Turns one session log into a short plain-text digest for the summarizer.
// Only what the person typed and what Claude said goes in: tool output is
// left out, long turns are clipped, the middle of a long session is dropped,
// and anything that looks like a credential is masked.

import fs from 'node:fs';
import { readLines } from './indexer.js';
import { claude } from './sources/claude.js';

const SECRET_PATTERNS = [
	/sk-ant-[\w-]{10,}/g,
	/\bsk-[A-Za-z0-9_-]{20,}/g,
	/\bgh[pousr]_[A-Za-z0-9]{20,}/g,
	/\bxox[abposr]-[\w-]{10,}/g,
	/\bAKIA[0-9A-Z]{16}\b/g,
	/\beyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g,
	/\b(Bearer|Basic)\s+[\w.~+/=-]{16,}/gi,
	/\b((?:api[_-]?key|secret|token|password|passwd|pwd)\s*[:=]\s*)["']?[^\s"']{6,}/gi,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
	// Long random-looking strings. Mixed case plus a digit, and no slash, so
	// file paths and long English words are left alone.
	/\b(?=[A-Za-z0-9+_-]*\d)(?=[A-Za-z0-9+_-]*[A-Z])(?=[A-Za-z0-9+_-]*[a-z])[A-Za-z0-9+_-]{40,}={0,2}/g,
];

export function maskSecrets(text) {
	let out = text;
	for (const pattern of SECRET_PATTERNS) {
		out = out.replace(pattern, (match, prefix) => (typeof prefix === 'string' && /[:=]\s*$/.test(prefix) ? `${prefix}[ซ่อน]` : '[ซ่อน]'));
	}
	return out;
}

function clipTurn(text, limit) {
	return text.length > limit ? `${text.slice(0, limit)} [ตัดส่วนที่เหลือ]` : text;
}

/** Reads a session log and returns its conversation turns and edited files. */
export function readConversation(jsonlPath, adapter = claude) {
	const turns = [];
	const files = new Map();
	const fd = fs.openSync(jsonlPath, 'r');
	try {
		const size = fs.fstatSync(fd).size;
		for (const { line } of readLines(fd, 0, size)) {
			let r;
			try { r = JSON.parse(line); }
			catch { continue; }
			if (!r || typeof r !== 'object') continue;
			const turn = adapter.turn(r);
			if (turn) turns.push(turn);
			for (const edit of adapter.edits(r)) files.set(edit.path, (files.get(edit.path) ?? 0) + 1);
		}
	}
	finally { fs.closeSync(fd); }
	return { turns, files };
}

const ROLE = { user: 'ผู้ใช้' };
const END = { rate_limited: 'ติด usage limit', interrupted: 'ผู้ใช้หยุดกลางคัน', replied: 'Claude ตอบแล้ว รอผู้ใช้', no_reply: 'ผู้ใช้ส่งข้อความแล้วยังไม่มีคำตอบ' };

function stamp(ts) {
	return ts ? new Date(ts).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '';
}

/**
 * Builds the digest text. Keeps the first request (it says what the session
 * was for) and then as many of the latest turns as fit in maxChars.
 */
export function buildDigest(session, { turns, files }, { maxChars = 24000, turnChars = 1500, adapter = claude } = {}) {
	const head = [
		`เครื่องมือ: ${adapter.label}`,
		`โปรเจค: ${session.project_name ?? '-'}`,
		`โฟลเดอร์: ${session.cwd ?? '-'}`,
		`ชื่อ session: ${session.custom_title || session.ai_title || '-'}`,
		`ช่วงเวลา: ${stamp(session.first_ts)} ถึง ${stamp(session.last_ts)}`,
		`สถานะตอนจบ: ${END[session.end_state] ?? 'ไม่ทราบ'}`,
	];
	const topFiles = [...files.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([p]) => p);
	if (topFiles.length) head.push(`ไฟล์ที่ถูกแก้: ${topFiles.join(', ')}`);

	const aiName = adapter.label;
	const render = t => `[${ROLE[t.role] ?? aiName} ${stamp(t.ts)}]\n${maskSecrets(clipTurn(t.text, turnChars))}`;
	const first = turns.findIndex(t => t.role === 'user');
	const picked = [];
	let budget = maxChars - head.join('\n').length;
	const firstText = first === -1 ? null : render(turns[first]);
	if (firstText) budget -= firstText.length;

	for (let i = turns.length - 1; i > first; i--) {
		const text = render(turns[i]);
		if (text.length > budget) break;
		picked.unshift({ i, text });
		budget -= text.length;
	}
	const skipped = (picked.length ? picked[0].i : turns.length) - first - 1;

	const body = [];
	if (firstText) body.push(firstText);
	if (skipped > 0) body.push(`[ตัดบทสนทนาช่วงกลางออก ${skipped} ข้อความ]`);
	for (const p of picked) body.push(p.text);
	if (!body.length) body.push('[ไม่มีข้อความที่ผู้ใช้พิมพ์หรือ Claude ตอบเป็นข้อความ]');

	return `${head.join('\n')}\n\n--- บทสนทนา ---\n${body.join('\n\n')}`;
}
