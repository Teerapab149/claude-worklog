#!/usr/bin/env node
// npm run setup   writes config.local.json from what is found in the logs.
// Run it again any time to rename accounts or change project folders;
// answers already in config.local.json are offered as the defaults.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { configFile, resolveConfig, writeLocalConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { scan } from '../src/indexer.js';
import { parseFolders, suggestRoots } from '../src/setup.js';

const file = configFile();
const local = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const config = resolveConfig(local);
// --defaults takes every suggestion without asking. The installer passes it,
// because it runs this in a hidden console that looks like a terminal.
const interactive = process.stdin.isTTY && !process.argv.includes('--defaults');
const ask = interactive ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
const question = async (text, fallback) => {
	if (!ask) {
		console.log(`  ใช้ ${fallback}`);
		return fallback;
	}
	const answer = (await ask.question(`${text}\n  [${fallback}] `)).trim();
	return answer || fallback;
};

console.log(fs.existsSync(file) ? `ปรับ ${file}` : `สร้าง ${file}`);
for (const [name, dir] of [['Claude Code', config.claudeDir], ['Codex', config.codexDir]]) {
	console.log(`  ${name}: ${dir} ${fs.existsSync(dir) ? '' : '(ไม่พบ จะข้ามไป)'}`);
}

// Read the logs into a throwaway database so nothing is kept from this run.
console.log('\nกำลังอ่าน log เพื่อหาบัญชีและโฟลเดอร์โปรเจค...');
const db = openDb(':memory:');
const stats = scan(db, { ...config, roots: [] });
console.log(`อ่านแล้ว ${stats.files} ไฟล์`);
if (!stats.files) console.log('ยังไม่พบ session ใน log ลองใช้ Claude Code หรือ Codex สักครั้ง แล้วรันคำสั่งนี้ใหม่');

const cwds = db.raw.prepare('SELECT cwd FROM sessions WHERE is_automated = 0').all().map(r => r.cwd);
const suggested = local.roots?.length ? local.roots : suggestRoots(cwds);
console.log('\nโฟลเดอร์ที่เก็บโปรเจคไว้ข้างใน แต่ละโฟลเดอร์ย่อยจะนับเป็นหนึ่งโปรเจค');
const roots = parseFolders(await question('ใส่ได้หลายโฟลเดอร์ คั่นด้วย ; หรือกด Enter เพื่อใช้ค่าในวงเล็บ', suggested.join('; ') || 'ไม่มี'))
	.filter(r => r !== 'ไม่มี');

const accounts = { ...local.accounts };
const found = db.raw.prepare(`SELECT s.account_uuid AS uuid, COUNT(*) AS n FROM sessions s
	WHERE s.tool = 'claude' AND s.account_source = 'log' GROUP BY s.account_uuid ORDER BY n DESC`).all();
if (found.length) console.log(`\nพบบัญชี Claude ${found.length} บัญชี ตั้งชื่อเรียกให้จำง่าย เช่น บัญชีงาน หรือ บัญชีส่วนตัว`);
for (const { uuid, n } of found) {
	accounts[uuid] = await question(`บัญชีรหัส ${uuid.slice(0, 8)} (${n} session)`, accounts[uuid] ?? `บัญชี ${uuid.slice(0, 4)}`);
}
ask?.close();
db.close();

// The installer runs this with --defaults and nobody has chosen anything yet;
// the setup page in Worklog asks the rest the first time it opens. A setup
// already finished stays finished.
const out = { ...local, roots, accounts };
if (!interactive && local.setup !== 'done' && !fs.existsSync(file)) out.setup = 'pending';
if (interactive) out.setup = 'done';
writeLocalConfig(out, file);
console.log(`\nบันทึกแล้วที่ ${file}`);

const index = path.join(config.dataDir, 'index.db');
if (fs.existsSync(index) && JSON.stringify(local.roots ?? []) !== JSON.stringify(roots)) {
	console.log('โฟลเดอร์โปรเจคเปลี่ยนไป ให้รัน npm run scan -- --full เพื่อจัดกลุ่มใหม่ (สรุปด้วย AI ที่มีอยู่จะหายและต้องสรุปใหม่)');
}
console.log(`
ขั้นต่อไป
  npm start                  เปิดหน้าเว็บที่ http://localhost:${config.port ?? 4317}
  npm run autostart:install  ให้เปิดเองทุกครั้งที่เข้าเครื่อง
  npm run install-hooks      ให้ Claude Code เตือนเมื่อสอง session แก้ไฟล์เดียวกัน`);
