#!/usr/bin/env node
// npm run shortcut:install    adds a Worklog icon to the Desktop and the Start menu
// npm run shortcut:uninstall  removes them
//
// The icon opens Worklog in its own window and everything stops when the
// window is closed (see bin/app.js). Windows only for now.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { appLauncher } from '../src/autostart.js';
import { APP_ROOT, loadConfig } from '../src/config.js';

if (process.platform !== 'win32') {
	console.log('ตอนนี้ทำ shortcut ได้เฉพาะ Windows ให้เปิดด้วย npm run app แทน');
	process.exit(1);
}

const config = loadConfig();
const launcher = path.join(config.dataDir, 'Worklog.vbs');
const icon = path.join(APP_ROOT, 'public', 'icon.ico');
const programs = path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
// The link that npm run autostart:install used to put in the Start menu.
const oldMenuLink = path.join(programs, 'Worklog.url');

/** Runs PowerShell with values passed as environment variables, so no quoting is needed. */
function powershell(script, env = {}) {
	const out = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
		encoding: 'utf8', windowsHide: true, env: { ...process.env, ...env },
	});
	if (out.status !== 0) throw new Error((out.stderr || out.error?.message || 'powershell failed').trim());
	return out.stdout.trim();
}

const desktop = () => powershell("[Environment]::GetFolderPath('Desktop')");
const links = () => [path.join(desktop(), 'Worklog.lnk'), path.join(programs, 'Worklog.lnk')];

function install() {
	fs.mkdirSync(config.dataDir, { recursive: true });
	fs.writeFileSync(launcher, appLauncher());
	for (const link of links()) {
		powershell(`$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:WL_LINK)
$s.TargetPath = Join-Path $env:SystemRoot 'System32\\wscript.exe'
$s.Arguments = '"' + $env:WL_VBS + '"'
$s.WorkingDirectory = $env:WL_ROOT
$s.IconLocation = $env:WL_ICON + ',0'
$s.Description = 'Worklog: งานที่ทำกับ AI ค้างอยู่ตรงไหน'
$s.Save()`, { WL_LINK: link, WL_VBS: launcher, WL_ROOT: APP_ROOT, WL_ICON: icon });
		console.log(`สร้าง ${link} แล้ว`);
	}
	fs.rmSync(oldMenuLink, { force: true });
	console.log('ดับเบิลคลิกไอคอน Worklog เพื่อเปิด ปิดหน้าต่างเมื่อไหร่ทุกอย่างก็ปิดตาม');
}

function uninstall() {
	for (const file of [...links(), launcher]) fs.rmSync(file, { force: true });
	console.log('ลบ shortcut ของ Worklog แล้ว');
}

const action = process.argv[2];
if (action === 'install') install();
else if (action === 'uninstall') uninstall();
else {
	console.log('ใช้ npm run shortcut:install หรือ npm run shortcut:uninstall');
	process.exit(1);
}
