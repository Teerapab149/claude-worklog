#!/usr/bin/env node
// Claude Code runs this as its status line, with the session snapshot as JSON
// on stdin. It records how much of each usage window is left and prints it.
// Installed by npm run install-hooks. A failure prints nothing and is logged
// to data/hook.log, so the status line never shows an error.

import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT, loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { record, render } from '../src/statusline.js';

let config = null;
try {
	config = loadConfig();
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(chunk);
	const input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
	const db = openDb(path.join(config.dataDir, 'index.db'));
	try { process.stdout.write(render(record(db, input))); }
	finally { db.close(); }
}
catch (error) {
	try {
		const dir = config?.dataDir ?? path.join(APP_ROOT, 'data');
		fs.mkdirSync(dir, { recursive: true });
		fs.appendFileSync(path.join(dir, 'hook.log'), `${new Date().toISOString()} statusline ${error.stack}\n`);
	}
	catch {
		// Nowhere left to report it.
	}
}
