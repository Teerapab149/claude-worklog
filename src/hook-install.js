// Adds and removes Worklog's hooks in a Claude Code settings object, leaving
// every other setting and hook as it was.

import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT } from './config.js';
import { EDIT_TOOLS } from './records.js';

export const HOOK_SCRIPT = path.join(APP_ROOT, 'bin', 'hook.js');
export const STATUS_SCRIPT = path.join(APP_ROOT, 'bin', 'statusline.js');

const slashes = p => p.replace(/\\/g, '/').toLowerCase();
const EVENTS = new Set(['session-start', 'pre-tool-use', 'session-end']);
const isHookScript = arg => typeof arg === 'string' && slashes(arg).endsWith('/bin/hook.js');

/**
 * True for a handler any copy of Worklog installed, wherever that copy lives
 * (a source checkout, the installed app, an older folder), so installing
 * from one copy replaces another instead of running both.
 */
export function isOurs(handler) {
	const args = Array.isArray(handler?.args) ? handler.args : [];
	return args.some(isHookScript) && args.some(a => EVENTS.has(a));
}

// Exec form (command plus args) starts node directly, so a path with spaces
// needs no quoting in Git Bash or PowerShell.
function handler(node, event, timeout) {
	return { type: 'command', command: node, args: ['--disable-warning=ExperimentalWarning', HOOK_SCRIPT, event], timeout };
}

export function ourHooks(node = process.execPath) {
	return {
		SessionStart: [{ hooks: [handler(node, 'session-start', 5)] }],
		PreToolUse: [{ matcher: [...EDIT_TOOLS].join('|'), hooks: [handler(node, 'pre-tool-use', 5)] }],
		SessionEnd: [{ hooks: [handler(node, 'session-end', 3)] }],
	};
}

/** True for the status line this app installed. */
export function isOurStatusLine(statusLine) {
	const command = typeof statusLine?.command === 'string' ? slashes(statusLine.command) : '';
	return command.includes('/bin/statusline.js') && command.includes('--disable-warning=experimentalwarning');
}

// The status line takes one command string. Forward slashes and quotes keep
// a path with spaces whole in Git Bash, which Claude Code uses on Windows.
function statusLine(node) {
	const q = p => `"${p.replace(/\\/g, '/')}"`;
	return { type: 'command', command: q(node) + ' --disable-warning=ExperimentalWarning ' + q(STATUS_SCRIPT), padding: 0 };
}

export function removeHooks(settings) {
	const out = structuredClone(settings);
	if (isOurStatusLine(out.statusLine)) delete out.statusLine;
	if (!out.hooks) return out;
	for (const [event, groups] of Object.entries(out.hooks)) {
		if (!Array.isArray(groups)) continue;
		const kept = groups
			.map(g => ({ ...g, hooks: (g.hooks ?? []).filter(h => !isOurs(h)) }))
			.filter(g => g.hooks.length);
		if (kept.length) out.hooks[event] = kept;
		else delete out.hooks[event];
	}
	if (!Object.keys(out.hooks).length) delete out.hooks;
	return out;
}

/**
 * Installing twice gives the same result as installing once. A status line
 * the person set up themselves is left alone; usage then comes from Codex only.
 */
export function addHooks(settings, node = process.execPath) {
	const out = removeHooks(settings);
	if (!out.statusLine) out.statusLine = statusLine(node);
	out.hooks ??= {};
	for (const [event, groups] of Object.entries(ourHooks(node))) {
		out.hooks[event] = [...(out.hooks[event] ?? []), ...groups];
	}
	return out;
}

/**
 * Adds ('install') or removes ('uninstall') Worklog's hooks in Claude Code's
 * settings.json, keeping a backup of the file first. A file that is not
 * valid JSON is never touched. Returns { ok, changed, message }.
 */
export function applyHooks(config, action, node = process.execPath) {
	const file = path.join(config.claudeDir, 'settings.json');
	const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
	let settings = {};
	try { settings = before?.trim() ? JSON.parse(before) : {}; }
	catch (error) {
		return { ok: false, changed: false, message: `อ่าน ${file} ไม่ได้ เพราะไม่ใช่ JSON ที่ถูกต้อง (${error.message}) จึงไม่แก้ไฟล์นี้` };
	}
	const after = JSON.stringify(action === 'install' ? addHooks(settings, node) : removeHooks(settings), null, 2) + '\n';
	if (before !== null && after.trim() === before.trim()) {
		return { ok: true, changed: false, message: action === 'install' ? 'ติดตั้ง hook ไว้แล้ว ไม่ต้องแก้อะไร' : 'ไม่มี hook ของ Worklog ใน settings.json' };
	}
	if (before !== null) {
		const dir = path.join(config.dataDir, 'backups');
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(path.join(dir, `settings-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), before);
	}
	// Through a temporary file, so Claude Code never reads a half-written settings file.
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(`${file}.worklog-tmp`, after);
	fs.renameSync(`${file}.worklog-tmp`, file);
	return {
		ok: true, changed: true,
		message: action === 'install' ? 'ติดตั้ง hook แล้ว มีผลกับ session ที่เปิดใหม่หลังจากนี้' : 'เอา hook ของ Worklog ออกแล้ว',
	};
}

/** How many of Worklog's hooks are in Claude Code's settings.json now. */
export function hooksInstalled(config) {
	try {
		const settings = JSON.parse(fs.readFileSync(path.join(config.claudeDir, 'settings.json'), 'utf8'));
		return Object.values(settings.hooks ?? {}).flat().flatMap(g => g.hooks ?? []).filter(isOurs).length;
	}
	catch {
		return 0;
	}
}
