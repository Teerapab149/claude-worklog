#!/usr/bin/env node
// node tools/fetch-fonts.js   downloads the app's fonts into public/fonts
//
// The page loads its fonts from its own folder so it works offline and asks
// no outside server for anything. Only the Thai and basic Latin subsets are
// kept. All three families are under the SIL Open Font License.

import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT } from '../src/config.js';

const FAMILIES = 'family=Mitr:wght@500;600&family=Noto+Sans+Thai+Looped:wght@400;500;600&family=Nunito:wght@400;700';
const KEEP = new Set(['thai', 'latin']);
// A current browser's agent, so the stylesheet lists woff2 files.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const dir = path.join(APP_ROOT, 'public', 'fonts');
fs.mkdirSync(dir, { recursive: true });
const css = await (await fetch(`https://fonts.googleapis.com/css2?${FAMILIES}&display=swap`, { headers: { 'user-agent': UA } })).text();

const out = ['/* Made by tools/fetch-fonts.js. Fonts: SIL Open Font License 1.1. */'];
let bytes = 0;
for (const match of css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*\{[^}]+\})/g)) {
	const [, subset, block] = match;
	if (!KEEP.has(subset)) continue;
	const family = block.match(/font-family:\s*'([^']+)'/)[1];
	const weight = block.match(/font-weight:\s*(\d+)/)[1];
	const url = block.match(/url\((https:[^)]+)\)/)[1];
	const name = `${family.toLowerCase().replace(/\s+/g, '-')}-${weight}-${subset}.woff2`;
	const data = Buffer.from(await (await fetch(url)).arrayBuffer());
	fs.writeFileSync(path.join(dir, name), data);
	bytes += data.length;
	out.push(block.replace(/url\([^)]+\)/, `url(${name})`));
}
fs.writeFileSync(path.join(dir, 'fonts.css'), out.join('\n') + '\n');
console.log(`เขียน ${out.length - 1} ไฟล์ฟอนต์ใน ${dir} รวม ${(bytes / 1024).toFixed(0)} KB`);
