// Adds and removes Worklog's hooks in a Claude Code settings object, leaving
// every other setting and hook as it was.

import path from 'node:path';
import { APP_ROOT } from './config.js';
import { EDIT_TOOLS } from './records.js';

export const HOOK_SCRIPT = path.join(APP_ROOT, 'bin', 'hook.js');

const slashes = p => p.replace(/\\/g, '/').toLowerCase();
const isHookScript = arg => typeof arg === 'string' && slashes(arg) === slashes(HOOK_SCRIPT);

/** True for a handler this app installed. */
export function isOurs(handler) {
	return Array.isArray(handler?.args) && handler.args.some(isHookScript);
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

export function removeHooks(settings) {
	const out = structuredClone(settings);
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

/** Installing twice gives the same result as installing once. */
export function addHooks(settings, node = process.execPath) {
	const out = removeHooks(settings);
	out.hooks ??= {};
	for (const [event, groups] of Object.entries(ourHooks(node))) {
		out.hooks[event] = [...(out.hooks[event] ?? []), ...groups];
	}
	return out;
}
