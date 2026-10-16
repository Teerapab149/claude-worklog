#!/usr/bin/env node
// npm run app   opens Worklog in its own window, like a desktop app.
//
// The server runs inside this process and the window is Edge (or Chrome) in
// app mode with a profile of its own. The page keeps a connection open to the
// server, so once the last window has been closed for a few seconds the
// server stops, the browser processes of that profile are ended, and nothing
// is left running. When a server is already running (npm start, or start at
// login) only the window is opened and that server is left alone.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { appBrowser, installedAppId, windowArgs } from '../src/app-window.js';
import { INSTALLED, VERSION, configFile, loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { startServer } from '../src/server.js';
import { createUpdater } from '../src/update.js';

const config = loadConfig();
const port = Number(process.env.PORT) || config.port || 4317;
const url = `http://localhost:${port}/`;
const profile = path.join(config.dataDir, 'app-window');
fs.mkdirSync(config.dataDir, { recursive: true });
const logFile = path.join(config.dataDir, 'server.log');
if (fs.existsSync(logFile) && fs.statSync(logFile).size > 1024 * 1024) fs.renameSync(logFile, `${logFile}.old`);
const log = (...parts) => fs.appendFileSync(logFile, `${new Date().toISOString()} ${parts.join(' ')}\n`);
process.on('uncaughtException', error => { log(`app crashed: ${error.stack}`); process.exit(1); });

// Only a copy from the installer updates itself.
const updater = INSTALLED
	? createUpdater({ dir: path.join(config.dataDir, 'updates'), current: VERSION, enabled: () => config.updates.auto, log })
	: null;

function openWindow() {
	const browser = appBrowser(config);
	if (browser) {
		const appId = installedAppId(profile);
		spawn(browser, windowArgs(url, profile, appId), { detached: true, stdio: 'ignore' }).unref();
		// Edge quietly opens nothing when it no longer knows the app, so a
		// window that never connects is opened again the plain way.
		if (appId && server) {
			setTimeout(() => {
				if (server.pagesOpen() > 0) return;
				log('เปิดแบบแอปที่ติดตั้งไม่ขึ้น จึงเปิดหน้าต่างแบบธรรมดาแทน');
				spawn(browser, windowArgs(url, profile), { detached: true, stdio: 'ignore' }).unref();
			}, 12000).unref();
		}
		return;
	}
	log('ไม่พบ Edge หรือ Chrome จึงเปิดในเบราว์เซอร์หลักแทน');
	spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

/** Ends the browser processes that use Worklog's own profile, which can linger in the background. */
function closeBrowser() {
	if (process.platform !== 'win32') return;
	const dir = profile.replace(/'/g, "''");
	spawnSync('powershell', ['-NoProfile', '-Command',
		`Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" | `
		+ `Where-Object { $_.CommandLine -and $_.CommandLine.Contains('${dir}') } | `
		+ 'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'], { windowsHide: true });
}

const db = openDb(path.join(config.dataDir, 'index.db'));
let server;
function shutdown() {
	log('ปิดหน้าต่างแอปแล้ว ปิดเซิร์ฟเวอร์ตาม');
	closeBrowser();
	server.closeAllConnections();
	server.close();
	db.close();
	updater?.installOnExit();
	process.exit(0);
}

try {
	server = await startServer({ db, config, configFile: configFile(), appInstalled: () => Boolean(installedAppId(profile)), updater, port, log, idle: { graceMs: 10000, firstMs: 90000, onIdle: shutdown } });
	log(`เปิดแอปที่ ${url}`);
	updater?.start();
}
catch (error) {
	if (error.code !== 'EADDRINUSE') throw error;
	// Someone else runs the server, so it is theirs to stop.
	db.close();
	openWindow();
	process.exit(0);
}
openWindow();
