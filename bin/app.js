#!/usr/bin/env node
// npm run app   opens Worklog in its own window, like a desktop app.
//
// The server runs inside this process and the window is Edge (or Chrome) in
// app mode with a profile of its own. The page keeps a connection open to the
// server, so once the last window has been closed for a few seconds the
// server stops, the browser processes of that profile are ended, and nothing
// is left running. When Worklog is already running, its own window is brought
// to the front instead (found by process, never by window title).
//
// It runs with no console, so every failure must show up somewhere: a
// broken settings file starts Worklog with defaults and a warning on the
// page, and anything worse opens a page that says what went wrong.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { appBrowser, focusWindow, installedAppId, profileWindowPid, setupRunning, windowArgs } from '../src/app-window.js';
import { INSTALLED, VERSION, WORK_HOME, configFile, loadConfig, resolveConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { pingWorklog, readPort, savePort } from '../src/port.js';
import { startServer } from '../src/server.js';
import { createUpdater } from '../src/update.js';

// Until the settings are read, problems go to the default data folder.
let dataDir = path.join(WORK_HOME, 'data');
const log = (...parts) => {
	try {
		fs.mkdirSync(dataDir, { recursive: true });
		fs.appendFileSync(path.join(dataDir, 'server.log'), `${new Date().toISOString()} ${parts.join(' ')}\n`);
	}
	catch {
		// Nowhere left to write.
	}
};
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = s => String(s).replace(/[&<>"]/g, c => ESC[c]);

/** Shows a page that says Worklog could not start and why, then stops. */
function fatal(error) {
	log(`app crashed: ${error?.stack ?? error}`);
	try {
		const file = path.join(dataDir, 'error.html');
		fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><title>Worklog เปิดไม่ขึ้น</title>
<body style="font:16px/1.65 system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px;color:#3B2F2A;background:#F4EEE4">
<h1 style="font-size:24px">Worklog เปิดไม่ขึ้น</h1>
<p>เกิดปัญหาตอนเปิด ลองปิดหน้านี้แล้วเปิด Worklog จากไอคอนอีกครั้ง ถ้ายังเป็นอยู่ ให้ติดตั้ง Worklog ใหม่จากหน้า Releases ค่าที่ตั้งไว้และข้อมูลจะยังอยู่ครบ</p>
<p>รายละเอียดสำหรับแจ้งปัญหา:</p>
<pre style="white-space:pre-wrap;background:#fff;padding:12px 16px;border-radius:12px">${esc(String(error?.stack ?? error).slice(0, 4000))}</pre>
<p>บันทึกทั้งหมดอยู่ที่ ${esc(path.join(dataDir, 'server.log'))}</p></body>`);
		if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', file], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
	}
	catch {
		// The log line above is all that is left.
	}
	process.exit(1);
}
process.on('uncaughtException', fatal);
process.on('unhandledRejection', fatal);

// A settings file that will not parse must not keep Worklog from opening.
let config, configWarning = null;
try { config = loadConfig(); }
catch (error) {
	config = resolveConfig({});
	configWarning = `อ่านไฟล์ตั้งค่า ${configFile()} ไม่ได้ (${error.message}) จึงใช้ค่าเริ่มต้นไปก่อน แก้ในหน้าตั้งค่าแล้วกดบันทึกเพื่อเขียนไฟล์ใหม่`;
	log(configWarning);
}
dataDir = config.dataDir;
fs.mkdirSync(dataDir, { recursive: true });
const logFile = path.join(dataDir, 'server.log');
if (fs.existsSync(logFile) && fs.statSync(logFile).size > 1024 * 1024) fs.renameSync(logFile, `${logFile}.old`);
const profile = path.join(dataDir, 'app-window');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// While an update installs, the files of this very program are being
// replaced; wait for it rather than run half old, half new.
if (INSTALLED) {
	for (let i = 0; i < 90 && setupRunning(); i++) await sleep(2000);
}

// Only a copy from the installer updates itself.
const updater = INSTALLED
	? createUpdater({ dir: path.join(dataDir, 'updates'), current: VERSION, enabled: () => config.updates.auto, log })
	: null;

let port = readPort(config);
let server = null;
const urlOf = p => `http://localhost:${p}/`;

/** Ends the browser processes that use Worklog's own profile, which can linger in the background. */
function closeBrowser() {
	if (process.platform !== 'win32') return;
	const dir = profile.replace(/'/g, "''");
	spawnSync('powershell', ['-NoProfile', '-Command',
		`Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" | `
		+ `Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${dir}') } | `
		+ 'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'], { windowsHide: true });
}

function openPlain(url) {
	if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
	else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
}

function openWindow(url) {
	const browser = appBrowser(config);
	if (!browser) {
		log('ไม่พบ Edge หรือ Chrome จึงเปิดในเบราว์เซอร์หลักแทน');
		openPlain(url);
		return;
	}
	const appId = installedAppId(profile);
	spawn(browser, windowArgs(url, profile, appId), { detached: true, stdio: 'ignore' }).on('error', error => log(`เปิด ${browser} ไม่ได้: ${error.message}`)).unref();
	// Edge quietly opens nothing when it no longer knows the installed app.
	// Only when no page connected and no window of this profile exists is the
	// plain window opened, so a slow start never ends with two windows.
	if (appId && server) {
		setTimeout(() => {
			if (server.pagesOpen() > 0 || profileWindowPid(profile)) return;
			log('เปิดแบบแอปที่ติดตั้งไม่ขึ้น จึงเปิดหน้าต่างแบบธรรมดาแทน');
			spawn(browser, windowArgs(url, profile), { detached: true, stdio: 'ignore' }).unref();
		}, 15000).unref();
	}
}

// Worklog already running: show its window, or open one onto it.
const running = await pingWorklog(port);
if (running) {
	const pid = running.pages > 0 ? profileWindowPid(profile) : null;
	if (pid) focusWindow(pid);
	else openWindow(urlOf(port));
	process.exit(0);
}

const db = openDb(path.join(dataDir, 'index.db'));
function shutdown({ install = 'onExit' } = {}) {
	log('ปิดหน้าต่างแอปแล้ว ปิดเซิร์ฟเวอร์ตาม');
	closeBrowser();
	server.closeAllConnections();
	server.close();
	db.close();
	if (install === 'now') updater?.installNow();
	else updater?.installOnExit();
	process.exit(0);
}

// Another program on the port: move to the next free one and write it down,
// so the hooks and the next start use the same port.
for (let attempt = 0; attempt < 20 && !server; attempt++) {
	try {
		server = await startServer({
			db, config, configFile: configFile(), configWarning, updater, port, log,
			appInstalled: () => Boolean(installedAppId(profile)),
			// The settings page's "ติดตั้งตอนนี้": answer first, then close and run setup.
			onInstallNow: () => setTimeout(() => shutdown({ install: 'now' }), 500),
			idle: { graceMs: 10000, firstMs: 90000, onIdle: shutdown },
		});
	}
	catch (error) {
		if (error.code !== 'EADDRINUSE') throw error;
		if (await pingWorklog(port)) {
			// Another Worklog won the race to this port; use that one.
			db.close();
			openWindow(urlOf(port));
			process.exit(0);
		}
		log(`port ${port} มีโปรแกรมอื่นใช้อยู่ จะลอง port ${port + 1}`);
		port += 1;
	}
}
if (!server) throw new Error('หา port ว่างไม่ได้');
savePort(config, port);
log(`เปิดแอปที่ ${urlOf(port)}`);
updater?.start();
openWindow(urlOf(port));
