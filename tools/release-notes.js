#!/usr/bin/env node
// node tools/release-notes.js v0.2.0
// Prints the CHANGELOG.md section for that version, for the GitHub release.

import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT } from '../src/config.js';

const version = String(process.argv[2] ?? '').replace(/^v/, '');
const text = fs.readFileSync(path.join(APP_ROOT, 'CHANGELOG.md'), 'utf8');
const start = text.search(new RegExp(`^## ${version.replace(/\./g, '\\.')}\\b`, 'm'));
if (start < 0) {
	console.log(`Worklog ${version}`);
	process.exit(0);
}
const rest = text.slice(start);
const next = rest.slice(3).search(/^## /m);
console.log((next < 0 ? rest : rest.slice(0, next + 3)).replace(/^## [^\n]*\n/, '').trim());
