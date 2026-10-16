#!/usr/bin/env node
// Claude Code runs this for each hook event, with the event as JSON on stdin:
//   node bin/hook.js pre-tool-use | session-start | session-end
// A hook must never get in the way of work, so any failure is logged to
// data/hook.log and the script exits 0 without printing anything.

import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT, loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { preToolUse, sessionEnd, sessionStart } from '../src/hooks.js';

const event = process.argv[2];
let config = null;

async function readStdin() {
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(chunk);
	return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

try {
	config = loadConfig();
	const input = await readStdin();
	let out = null;
	if (event === 'session-end') out = await sessionEnd(config);
	else {
		const db = openDb(path.join(config.dataDir, 'index.db'));
		try {
			if (event === 'pre-tool-use') out = preToolUse(db, config, input);
			else if (event === 'session-start') out = sessionStart(db, config, input);
		}
		finally { db.close(); }
	}
	if (out) process.stdout.write(JSON.stringify(out));
}
catch (error) {
	try {
		const dir = config?.dataDir ?? path.join(APP_ROOT, 'data');
		fs.mkdirSync(dir, { recursive: true });
		fs.appendFileSync(path.join(dir, 'hook.log'), `${new Date().toISOString()} ${event} ${error.stack}\n`);
	}
	catch {
		// Nowhere left to report it.
	}
}
process.exit(0);
