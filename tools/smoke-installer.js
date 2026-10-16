#!/usr/bin/env node
// node tools/smoke-installer.js   (Windows, after tools/build-installer.js)
//
// Installs dist/Worklog-Setup-<version>.exe quietly into a temporary folder,
// with Worklog's data and Claude Code's settings pointed at temporary folders
// too, then checks that it runs, reads a log and installed its hooks, and
// that uninstalling removes the hooks and keeps the data. CI runs this before
// any release goes out, because installed copies update themselves.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_ROOT } from '../src/config.js';

const { version } = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8'));
const setup = path.join(APP_ROOT, 'dist', `Worklog-Setup-${version}.exe`);
if (!fs.existsSync(setup)) throw new Error(`${setup} not found; run tools/build-installer.js first`);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-smoke-'));
const appDir = path.join(root, 'app');
const home = path.join(root, 'home');
const claudeDir = path.join(root, 'claude');
const logDir = path.join(claudeDir, 'projects', 'C--work-shop');
fs.mkdirSync(logDir, { recursive: true });
fs.writeFileSync(path.join(claudeDir, 'settings.json'), '{}\n');
fs.writeFileSync(path.join(logDir, 'smoke.jsonl'), JSON.stringify({
	type: 'user', cwd: 'C:\\work\\shop', timestamp: new Date().toISOString(), message: { content: 'smoke test' },
}) + '\n');
const env = { ...process.env, WORKLOG_HOME: home, CLAUDE_CONFIG_DIR: claudeDir, CODEX_HOME: path.join(root, 'codex') };

const step = text => console.log(`== ${text}`);
const fail = text => { console.error(`FAIL ${text}`); process.exitCode = 1; throw new Error(text); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hooksIn = () => fs.readFileSync(path.join(claudeDir, 'settings.json'), 'utf8').includes(path.join(appDir, 'bin', 'hook.js').replace(/\\/g, '\\\\'));

step(`install ${path.basename(setup)} into ${appDir}`);
const install = spawnSync(setup, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', `/DIR=${appDir}`, '/TASKS=hooks', `/LOG=${path.join(root, 'install.log')}`], { env, timeout: 300000 });
if (install.status !== 0) fail(`setup exited with ${install.status}\n${fs.existsSync(path.join(root, 'install.log')) ? fs.readFileSync(path.join(root, 'install.log'), 'utf8').slice(-3000) : ''}`);
for (const file of ['node/node.exe', 'bin/app.js', 'installed', 'Worklog.vbs', 'unins000.exe']) {
	if (!fs.existsSync(path.join(appDir, file))) fail(`missing ${file} after install`);
}
if (!fs.existsSync(path.join(home, 'config.local.json'))) fail('first-run setup did not write config.local.json');
if (!hooksIn()) fail('hooks were not added to settings.json');

step('start the installed server and ask it for the overview');
const port = 4399;
const server = spawn(path.join(appDir, 'node', 'node.exe'), ['--disable-warning=ExperimentalWarning', path.join(appDir, 'bin', 'serve.js')],
	{ env: { ...env, PORT: String(port) }, stdio: 'inherit' });
try {
	let ping = null;
	for (let i = 0; i < 60 && !ping; i++) {
		await sleep(500);
		try { ping = await (await fetch(`http://127.0.0.1:${port}/api/ping`)).json(); }
		catch { /* not up yet */ }
	}
	if (ping?.app !== 'worklog' || ping.version !== version) fail(`ping answered ${JSON.stringify(ping)}`);
	const overview = await (await fetch(`http://127.0.0.1:${port}/api/overview`)).json();
	if (!overview.projects?.some(p => p.name === 'shop')) fail(`the smoke log was not read: ${JSON.stringify(overview.projects)}`);
	const page = await fetch(`http://127.0.0.1:${port}/`);
	if (page.status !== 200) fail(`page answered ${page.status}`);
}
finally {
	server.kill();
	await sleep(1000);
}

step('uninstall');
spawnSync(path.join(appDir, 'unins000.exe'), ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], { env, timeout: 120000 });
// The uninstaller hands over to a copy of itself and returns at once.
for (let i = 0; i < 120 && fs.existsSync(path.join(appDir, 'bin', 'app.js')); i++) await sleep(500);
if (fs.existsSync(path.join(appDir, 'bin', 'app.js'))) fail('files are still there after uninstall');
if (hooksIn()) fail('hooks are still in settings.json after uninstall');
if (!fs.existsSync(path.join(home, 'config.local.json'))) fail('uninstall removed the settings, which it must keep');

console.log('smoke test passed');
