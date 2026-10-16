// What each Claude Code hook does. bin/hook.js reads the event from stdin,
// calls one of these and prints the result. Each returns the JSON object to
// print, or null to stay silent and let Claude Code carry on as usual.

import { readPort } from './port.js';
import { resolveProject } from './projects.js';
import { activeSessions } from './queries.js';
import { checkEdit, describeSession, recordEdit } from './overlap.js';
import { EDIT_TOOLS } from './records.js';
import { getSummary } from './summaries.js';

const MINUTE = 60 * 1000;

/** How long ago, written to sit before the word ก่อน. */
function agoText(ts, now) {
	const minutes = Math.round((now - Date.parse(ts)) / MINUTE);
	if (minutes < 1) return 'ไม่ถึงนาที';
	if (minutes < 90) return `${minutes} นาที`;
	const hours = Math.round(minutes / 60);
	return hours < 48 ? `${hours} ชั่วโมง` : `${Math.round(hours / 24)} วัน`;
}

function who(s) {
	const title = s.title ? `"${s.title}"` : `session ${s.id.slice(0, 8)}`;
	const by = s.tool === 'codex' ? 'Codex' : s.account ? `Claude ${s.account}` : null;
	return by ? `${title} (${by})` : title;
}

export function preToolUse(db, config, input, now = Date.now()) {
	if (!EDIT_TOOLS.has(input.tool_name)) return null;
	const file = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
	if (typeof file !== 'string' || !file || !input.session_id) return null;
	const mode = config.overlap.preToolUse;
	const edit = { sessionId: input.session_id, file, cwd: input.cwd ?? null, now };
	if (mode === 'off') {
		recordEdit(db, edit);
		return null;
	}

	const found = checkEdit(db, config, edit);
	if (!found || found.repeat) {
		recordEdit(db, edit);
		return null;
	}

	const [first, ...rest] = found.others;
	const more = rest.length ? ` และอีก ${rest.length} session` : '';
	const text = `Worklog: ไฟล์ ${file} มี session อื่นแก้ไปเมื่อ ${agoText(first.ts, now)}ก่อน คือ ${who(first)}${more} `
		+ 'เนื้อหาในไฟล์อาจไม่ตรงกับที่อ่านไว้แล้ว ให้อ่านไฟล์นี้ใหม่ก่อนแก้ และบอกผู้ใช้ว่ามีอีก session ทำงานกับไฟล์นี้อยู่';

	if (mode === 'deny_once') {
		// The edit did not happen, so it is not recorded. The retry will be.
		return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny',
			permissionDecisionReason: `${text} ถ้ายังต้องแก้ ให้สั่งแก้อีกครั้ง ครั้งต่อไปจะผ่าน` } };
	}
	recordEdit(db, edit);
	if (mode === 'ask') {
		return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: text } };
	}
	return { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text } };
}

function listLine(label, items) {
	return items?.length ? `${label}\n${items.slice(0, 4).map(x => `- ${x}`).join('\n')}` : null;
}

/**
 * Gives a new session the state of its project: other sessions open in it
 * right now, and the summary of the last piece of work, which may have been
 * done with the other account and so is not in this session's memory.
 */
export function sessionStart(db, config, input, now = Date.now()) {
	if (input.source && !['startup', 'clear'].includes(input.source)) return null;
	const project = resolveProject(input.cwd, config);
	if (!project || project.excluded) return null;
	const parts = [];

	const open = activeSessions(db, config).filter(s => s.project_key === project.key && s.id !== input.session_id);
	if (open.length) {
		const names = open.slice(0, 3).map(s => who({ ...describeSession(db, config, s.id), title: s.title }));
		parts.push(`ตอนนี้มี session อื่นเปิดอยู่ในโปรเจคนี้อีก ${open.length} ตัว คือ ${names.join(', ')} `
			+ 'ถ้าจะแก้ไฟล์ ให้ระวังว่าอาจแก้ไฟล์เดียวกัน และถามผู้ใช้ก่อนถ้างานดูเหมือนซ้ำกัน');
	}

	const last = db.raw.prepare(`SELECT id, last_ts FROM sessions
		WHERE project_key = ? AND id != ? AND is_automated = 0 AND human_turns > 0 AND last_ts >= ?
		ORDER BY last_ts DESC LIMIT 1`).get(project.key, input.session_id ?? '', new Date(now - 3 * 86400000).toISOString());
	if (last) {
		const summary = getSummary(db, 'project', project.key)?.data ?? getSummary(db, 'session', last.id)?.data;
		if (summary?.headline) {
			parts.push([
				`งานล่าสุดในโปรเจคนี้ทำเมื่อ ${agoText(last.last_ts, now)}ก่อน ใน ${who(describeSession(db, config, last.id))}`,
				`สรุป: ${summary.headline}`,
				listLine('ที่ยังค้างอยู่', summary.in_progress),
				listLine('ขั้นต่อไป', summary.next_steps),
				listLine('เรื่องที่รออยู่', summary.waiting_on),
			].filter(Boolean).join('\n'));
		}
	}

	if (!parts.length) return null;
	const text = [`ข้อมูลจาก Worklog เกี่ยวกับโปรเจค ${project.name}`, ...parts,
		'ใช้ข้อมูลนี้เป็นพื้นหลังเท่านั้น ถ้าผู้ใช้ขอเรื่องอื่นก็ทำตามที่ผู้ใช้ขอ'].join('\n\n');
	return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: text } };
}

/** Asks the running dashboard to read the session that just ended. */
export async function sessionEnd(config) {
	const port = readPort(config);
	try {
		await fetch(`http://127.0.0.1:${port}/api/scan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(1000) });
	}
	catch {
		// The dashboard is not running. Its next start scans anyway.
	}
	return null;
}
