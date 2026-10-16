#!/usr/bin/env node
// node tools/build-installer.js [--node path\to\node.exe]
//
// Copies what an installed Worklog needs into dist/stage, with a Node of its
// own so the person does not have to install one, then builds
// dist/Worklog-Setup-<version>.exe with Inno Setup. Without Inno Setup it
// stops after the stage folder. Only the files listed here go in, so the
// data folder, config.local.json and notes never leave this machine.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT } from '../src/config.js';

const SHIP = ['bin', 'src', 'public', 'package.json', 'LICENSE', 'README.md', 'README.en.md', 'config.example.json'];
const dist = path.join(APP_ROOT, 'dist');
const stage = path.join(dist, 'stage');
const { version } = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8'));

const at = process.argv.indexOf('--node');
const node = at > 0 ? process.argv[at + 1] : process.execPath;
const major = Number(spawnSync(node, ['-p', 'process.versions.node.split(".")[0]'], { encoding: 'utf8' }).stdout);
if (!(major >= 24)) {
	console.error(`${node} ไม่ใช่ Node 24 ขึ้นไป Worklog ต้องใช้ node:sqlite ที่มากับ Node 24`);
	process.exit(1);
}

fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(path.join(stage, 'node'), { recursive: true });
for (const item of SHIP) fs.cpSync(path.join(APP_ROOT, item), path.join(stage, item), { recursive: true });
fs.copyFileSync(node, path.join(stage, 'node', 'node.exe'));
fs.copyFileSync(path.join(APP_ROOT, 'installer', 'Worklog.vbs'), path.join(stage, 'Worklog.vbs'));
// Tells src/config.js to keep settings and data in the person's app data folder.
fs.writeFileSync(path.join(stage, 'installed'), `Worklog ${version}\n`);
console.log(`เตรียมไฟล์ไว้ที่ ${stage}`);

const script = path.join(APP_ROOT, 'installer', 'worklog.iss');
// Inno Setup reads a script as UTF-8 only when it starts with a byte order mark.
if (!fs.readFileSync(script).subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
	console.error(`${script} ต้องบันทึกเป็น UTF-8 แบบมี BOM ไม่อย่างนั้นข้อความภาษาไทยจะเพี้ยน`);
	process.exit(1);
}

const candidates = [
	process.env.ISCC,
	path.join(process.env['ProgramFiles(x86)'] ?? '', 'Inno Setup 6', 'ISCC.exe'),
	path.join(process.env.ProgramFiles ?? '', 'Inno Setup 6', 'ISCC.exe'),
	path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Inno Setup 6', 'ISCC.exe'),
].filter(Boolean);
const iscc = candidates.find(p => fs.existsSync(p));
if (!iscc) {
	console.log('ไม่พบ Inno Setup 6 จึงหยุดแค่เตรียมไฟล์ ติดตั้ง Inno Setup หรือตั้ง ISCC ให้ชี้ไปที่ ISCC.exe แล้วรันใหม่');
	process.exit(0);
}
const out = spawnSync(iscc, [`/DAppVersion=${version}`, `/DStage=${stage}`, script], { stdio: 'inherit' });
if (out.status !== 0) process.exit(out.status ?? 1);
console.log(`ได้ไฟล์ติดตั้งที่ ${path.join(dist, `Worklog-Setup-${version}.exe`)}`);
