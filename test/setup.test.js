import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { parseFolders, suggestRoots } from '../src/setup.js';

const j = (...parts) => path.join(...parts);

test('a folder with two or more project folders inside becomes a root, deepest first', () => {
	const base = j(path.sep, 'work');
	const cwds = [
		j(base, 'shop'), j(base, 'shop', 'api'), j(base, 'notes'),
		j(base, 'clients', 'alpha'), j(base, 'clients', 'beta'),
		j(base, 'shop', '.claude', 'worktrees', 'quick-fix'),
		j(path.sep, 'tmp', 'scratch', 'a'), j(path.sep, 'tmp', 'scratch', 'b'),
		null,
	];
	assert.deepEqual(suggestRoots(cwds, { tmp: j(path.sep, 'tmp') }), [j(base, 'clients'), base]);
});

test('folders typed by the person are split on semicolons and new lines', () => {
	assert.deepEqual(parseFolders(' C:\\a ; D:\\b\n\n'), ['C:\\a', 'D:\\b']);
});
