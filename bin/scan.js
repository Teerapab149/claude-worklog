#!/usr/bin/env node
// npm run scan            reads new lines from every session log
// npm run scan -- --full  forgets earlier scans and reads everything again

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { scan } from '../src/indexer.js';

const config = loadConfig();
const dbFile = path.join(config.dataDir, 'index.db');
if (process.argv.includes('--full')) {
	for (const suffix of ['', '-wal', '-shm']) fs.rmSync(dbFile + suffix, { force: true });
}

const db = openDb(dbFile);
const started = Date.now();
const stats = scan(db, config);
const seconds = ((Date.now() - started) / 1000).toFixed(1);

console.log(`อ่าน log ${stats.files} ไฟล์ใน ${seconds} วินาที (อ่านใหม่ ${stats.read}, ไม่เปลี่ยน ${stats.unchanged}, ตัดออก ${stats.excluded}, บรรทัดเสีย ${stats.badLines})`);

const rows = db.raw.prepare(`
	SELECT a.label, s.account_source AS source, COUNT(*) AS n
	FROM sessions s LEFT JOIN accounts a ON a.uuid = s.account_uuid
	GROUP BY a.label, s.account_source ORDER BY n DESC`).all();
console.log('\nsession แยกตามบัญชี');
for (const r of rows) {
	const source = r.source === 'inferred' ? ' (เดาจากช่วงเวลา)' : '';
	console.log(`  ${(r.label ?? 'ไม่ทราบบัญชี') + source}: ${r.n}`);
}
const automated = db.raw.prepare('SELECT COUNT(*) AS n FROM sessions WHERE is_automated = 1').get().n;
console.log(`  ในจำนวนนี้เป็นงานอัตโนมัติ ${automated} session`);

const projects = db.raw.prepare(`
	SELECT p.name, COUNT(*) AS n, MAX(s.last_ts) AS last
	FROM sessions s JOIN projects p ON p.key = s.project_key
	GROUP BY p.key ORDER BY last DESC`).all();
console.log('\nโปรเจคเรียงตามเวลาที่ทำล่าสุด');
for (const p of projects) {
	const when = p.last ? new Date(p.last).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
	console.log(`  ${p.name.padEnd(24)} ${String(p.n).padStart(3)} session   ล่าสุด ${when}`);
}
db.close();
