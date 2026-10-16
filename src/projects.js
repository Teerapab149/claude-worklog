// Maps a session's working folder to the project it belongs to.

const WORKTREE_MARK = '/.claude/worktrees/';

export function normalizePath(p) {
	return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

function startsWithFolder(lower, prefix) {
	return lower === prefix || lower.startsWith(prefix + '/');
}

/**
 * Returns { key, name, path } for a working folder, { excluded: true } when
 * the folder matches config.exclude, or null when there is no folder.
 * key is lower case so E:\Research and e:\research land in one project.
 */
export function resolveProject(cwd, config) {
	if (typeof cwd !== 'string' || !cwd) return null;
	let full = normalizePath(cwd);
	const lower = full.toLowerCase();

	for (const ex of config.exclude ?? []) {
		const prefix = normalizePath(ex).toLowerCase();
		if (prefix && startsWithFolder(lower, prefix)) return { excluded: true };
	}

	// A worktree is the same project as the checkout it was cut from.
	const wt = lower.indexOf(WORKTREE_MARK);
	if (wt !== -1) full = full.slice(0, wt);

	for (const root of config.roots ?? []) {
		const r = normalizePath(root);
		if (!r || !startsWithFolder(full.toLowerCase(), r.toLowerCase())) continue;
		const folder = full.slice(r.length + 1).split('/')[0];
		if (!folder) break;
		const projectPath = `${r}/${folder}`;
		return { key: projectPath.toLowerCase(), name: config.projectNames?.[folder] ?? folder, path: projectPath };
	}

	const folder = full.split('/').pop() || full;
	return { key: full.toLowerCase(), name: config.projectNames?.[folder] ?? folder, path: full };
}
