#!/usr/bin/env node
// npm run autostart:install    start Worklog at every login, and start it now
// npm run autostart:uninstall  stop starting it at login
//
// Windows: a small launcher in the Startup folder (no admin rights needed)
//          and a "Worklog" link in the Start menu.
// macOS:   a launchd agent in ~/Library/LaunchAgents.
// Linux:   a systemd user service in ~/.config/systemd/user.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { LABEL, linuxUnit, macPlist, windowsLauncher } from '../src/autostart.js';
import { loadConfig } from '../src/config.js';

const config = loadConfig();
const port = Number(process.env.PORT) || config.port || 4317;
const url = `http://localhost:${port}/`;
const logFile = path.join(config.dataDir, 'server.log');

function isServing() {
	return new Promise(resolve => {
		const req = http.get(`${url}api/overview`, res => { res.resume(); resolve(res.statusCode === 200); });
		req.on('error', () => resolve(false));
		req.setTimeout(2000, () => { req.destroy(); resolve(false); });
	});
}

async function waitUntilServing() {
	for (let i = 0; i < 20 && !(await isServing()); i++) await new Promise(r => setTimeout(r, 500));
	console.log((await isServing()) ? `เปิดแล้วที่ ${url}` : `ยังเปิดไม่ขึ้น ดู log ได้ที่ ${logFile}`);
}

/** Runs a system command and says what went wrong if it fails. */
function run(cmd, args, { quiet = false } = {}) {
	const out = spawnSync(cmd, args, { encoding: 'utf8' });
	if (out.status !== 0 && !quiet) console.log(`${cmd} ${args.join(' ')} ไม่สำเร็จ: ${(out.stderr || out.error?.message || '').trim()}`);
	return out.status === 0;
}

const windows = {
	launcher: () => path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Worklog.vbs'),
	menuLink: () => path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Worklog.url'),
	async install() {
		fs.writeFileSync(this.launcher(), windowsLauncher());
		fs.writeFileSync(this.menuLink(), `[InternetShortcut]\r\nURL=${url}\r\n`);
		console.log(`ตั้งให้เปิดเองตอน login แล้ว (${this.launcher()})`);
		console.log('เพิ่ม Worklog ใน Start menu แล้ว พิมพ์ Worklog ในช่องค้นหาของ Windows เพื่อเปิดหน้าเว็บ');
		if (await isServing()) return console.log(`ตอนนี้มี Worklog เปิดอยู่แล้วที่ ${url}`);
		spawn('wscript.exe', [this.launcher()], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
		await waitUntilServing();
	},
	uninstall() {
		for (const file of [this.launcher(), this.menuLink()]) fs.rmSync(file, { force: true });
		console.log('เลิกเปิดเองตอน login แล้ว');
		console.log('ตัวที่เปิดอยู่ตอนนี้ยังทำงานจนกว่าจะ logout หรือปิด node.exe ใน Task Manager');
	},
};

const mac = {
	file: path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`),
	domain: `gui/${process.getuid?.()}`,
	async install() {
		fs.mkdirSync(path.dirname(this.file), { recursive: true });
		fs.writeFileSync(this.file, macPlist());
		// Loading twice fails, so unload any earlier copy first.
		run('launchctl', ['bootout', `${this.domain}/${LABEL}`], { quiet: true });
		if (!run('launchctl', ['bootstrap', this.domain, this.file])) return;
		console.log(`ตั้งให้เปิดเองตอน login แล้ว (${this.file})`);
		await waitUntilServing();
	},
	uninstall() {
		run('launchctl', ['bootout', `${this.domain}/${LABEL}`], { quiet: true });
		fs.rmSync(this.file, { force: true });
		console.log('เลิกเปิดเองตอน login และปิดตัวที่เปิดอยู่แล้ว');
	},
};

const linux = {
	file: path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'systemd', 'user', 'worklog.service'),
	async install() {
		fs.mkdirSync(path.dirname(this.file), { recursive: true });
		fs.writeFileSync(this.file, linuxUnit());
		if (!run('systemctl', ['--user', 'daemon-reload'])) {
			console.log('เครื่องนี้ไม่มี systemd แบบผู้ใช้ ให้เปิดด้วย npm start เองแทน');
			return;
		}
		if (!run('systemctl', ['--user', 'enable', '--now', 'worklog.service'])) return;
		console.log(`ตั้งให้เปิดเองตอน login แล้ว (${this.file})`);
		await waitUntilServing();
	},
	uninstall() {
		run('systemctl', ['--user', 'disable', '--now', 'worklog.service'], { quiet: true });
		fs.rmSync(this.file, { force: true });
		run('systemctl', ['--user', 'daemon-reload'], { quiet: true });
		console.log('เลิกเปิดเองตอน login และปิดตัวที่เปิดอยู่แล้ว');
	},
};

const platform = { win32: windows, darwin: mac, linux }[process.platform];
if (!platform) {
	console.log(`ยังตั้งให้เปิดเองบน ${process.platform} ไม่ได้ ให้เปิดด้วย npm start แทน`);
	process.exit(1);
}

const action = process.argv[2];
if (action === 'install') await platform.install();
else if (action === 'uninstall') platform.uninstall();
else {
	console.log('ใช้ npm run autostart:install หรือ npm run autostart:uninstall');
	process.exit(1);
}
