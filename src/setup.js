// Guesses a first config from what is already in the logs, so a new user
// does not have to know where their projects live or what their account
// ids are.

import os from 'node:os';
import path from 'node:path';

const WORKTREE = /[\\/]\.claude[\\/]worktrees[\\/].*$/i;

/**
 * Folders that hold several projects side by side, from the folders sessions
 * ran in. A folder becomes a root once two or more of its direct children
 * have sessions. Deeper roots come first, because a session belongs to the
 * first root that contains it.
 */
export function suggestRoots(cwds, { tmp = os.tmpdir() } = {}) {
	const children = new Map();
	const tmpLower = tmp.toLowerCase();
	for (const raw of cwds) {
		if (!raw) continue;
		const cwd = raw.replace(WORKTREE, '').replace(/[\\/]+$/, '');
		if (cwd.toLowerCase().startsWith(tmpLower)) continue;
		const parent = path.dirname(cwd);
		if (!parent || parent === cwd) continue;
		const key = parent.toLowerCase();
		if (!children.has(key)) children.set(key, { parent, names: new Set() });
		children.get(key).names.add(path.basename(cwd).toLowerCase());
	}
	const depth = p => p.split(/[\\/]/).filter(Boolean).length;
	return [...children.values()]
		.filter(c => c.names.size >= 2)
		.map(c => c.parent)
		.sort((a, b) => depth(b) - depth(a) || a.localeCompare(b));
}

/** Splits what the person typed into a list of folders. */
export function parseFolders(text) {
	return text.split(/[;\n]/).map(s => s.trim()).filter(Boolean);
}
