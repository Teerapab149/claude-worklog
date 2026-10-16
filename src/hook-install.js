// Adds and removes Worklog's hooks in a Claude Code settings object, leaving
// every other setting and hook as it was.

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
