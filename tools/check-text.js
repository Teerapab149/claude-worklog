#!/usr/bin/env node
// node tools/check-text.js   fails when a tracked text file contains a
// character the project never uses in its writing: a middle dot, an arrow,
// an em or en dash, or an emoji. Code that must match these characters
// writes them as \u escapes. CI runs this on every push.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const BANNED = /[\u00B7\u2190\u2192\u2013\u2014\u2600-\u27BF]|\p{Extended_Pictographic}/u;
const TEXT = /\.(js|mjs|json|md|html|css|yml|yaml|iss|vbs|txt|webmanifest)$/i;
const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(f => TEXT.test(f));
let bad = 0;
for (const file of files) {
	if (!fs.existsSync(file)) continue;
	fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
		if (BANNED.test(line)) {
			bad += 1;
			console.log(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
		}
	});
}
if (bad) {
	console.log(`\n${bad} line(s) use a character the writing rules ban. Use words, commas or a \\u escape in code.`);
	process.exit(1);
}
console.log(`checked ${files.length} files`);
