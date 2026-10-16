import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { watchLogs } from '../src/watch.js';

const wait = ms => new Promise(r => setTimeout(r, ms));

test('a changed log starts one scan, other files and quiet folders start none', async t => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-watch-'));
	fs.mkdirSync(path.join(dir, 'proj'));
	let scans = 0;
	const w = watchLogs([dir, path.join(dir, 'missing')], () => scans++, { debounceMs: 100, minGapMs: 100, fallbackMs: 60000 });
	t.after(() => { w.close(); fs.rmSync(dir, { recursive: true, force: true }); });
	assert.equal(w.watching, 1);

	fs.writeFileSync(path.join(dir, 'proj', 'notes.txt'), 'x');
	await wait(400);
	assert.equal(scans, 0);

	for (let i = 0; i < 5; i++) fs.appendFileSync(path.join(dir, 'proj', 'a.jsonl'), '{}\n');
	await wait(600);
	assert.equal(scans, 1);
});
