#!/usr/bin/env node
// npm run install-hooks     adds Worklog's hooks to Claude Code's settings.json
// npm run uninstall-hooks   takes them out again
// The settings file is copied to data/backups before it is changed.

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { addHooks, removeHooks } from '../src/hook-install.js';

const action = process.argv[2];
if (action !== 'install' && action !== 'uninstall') {
	console.log('ใช้ได้สองแบบ: node bin/hooks.js install หรือ node bin/hooks.js uninstall');
	process.exit(1);
}

const config = loadConfig();
const file = path.join(config.claudeDir, 'settings.json');
const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
const settings = before ? JSON.parse(before) : {};
const after = JSON.stringify(action === 'install' ? addHooks(settings) : removeHooks(settings), null, 2) + '\n';

if (before !== null && after.trim() === before.trim()) {
	console.log(action === 'install' ? 'ติดตั้ง hook ไว้แล้ว ไม่ต้องแก้อะไร' : 'ไม่มี hook ของ Worklog ใน settings.json');
	process.exit(0);
}
if (before !== null) {
	const dir = path.join(config.dataDir, 'backups');
	fs.mkdirSync(dir, { recursive: true });
	const backup = path.join(dir, `settings-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
	fs.writeFileSync(backup, before);
	console.log(`สำรอง settings.json เดิมไว้ที่ ${backup}`);
}
fs.writeFileSync(file, after);
console.log(action === 'install'
	? `ติดตั้ง hook ใน ${file} แล้ว มีผลกับ session ที่เปิดใหม่หลังจากนี้`
	: `เอา hook ของ Worklog ออกจาก ${file} แล้ว`);
