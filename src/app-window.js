// Finds a browser that can open Worklog as a window of its own (app mode).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const WINDOWS_BROWSERS = [
	['Microsoft', 'Edge', 'Application', 'msedge.exe'],
	['Google', 'Chrome', 'Application', 'chrome.exe'],
];

export function appBrowser(config, { env = process.env, exists = fs.existsSync } = {}) {
	if (config.app?.browser) return exists(config.app.browser) ? config.app.browser : null;
	if (process.platform !== 'win32') return null;
	const roots = [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean);
	for (const parts of WINDOWS_BROWSERS) {
		for (const root of roots) {
			const file = path.join(root, ...parts);
			if (exists(file)) return file;
		}
	}
	return null;
}

// How an app came into a profile, as Chromium numbers it. These are the ones
// the browser puts there itself (defaults, policy, sync), never Worklog.
const NOT_BY_PERSON = new Set([10, 11, 12, 13, 14, 16]);

/**
 * The id of Worklog as an installed app in its own profile, or null. Edge
 * does not derive the id from the URL the way Chrome documents, so it is
 * read from the profile instead. The profile belongs to Worklog alone and
 * keeps sync off, so the newest app a person installed there is Worklog.
 */
export function installedAppId(profile, { read = file => fs.readFileSync(file, 'utf8') } = {}) {
	let metrics;
	try { metrics = JSON.parse(read(path.join(profile, 'Default', 'Preferences'))).web_app_install_metrics; }
	catch { return null; }
	const ids = Object.entries(metrics ?? {})
		.filter(([id, m]) => /^[a-p]{32}$/.test(id) && !NOT_BY_PERSON.has(m?.install_source))
		.sort((a, b) => Number(b[1]?.install_timestamp ?? 0) - Number(a[1]?.install_timestamp ?? 0));
	return ids[0]?.[0] ?? null;
}

/**
 * Arguments for the app window. The profile of its own keeps it apart from
 * the person's browser, and the rest turns off what a dashboard does not
 * need, which keeps the window's memory down. Once Worklog is installed as
 * an app the window opens by its app id, which gives it a title bar in the
 * page's own colour; until then it is a plain app window.
 */
export function windowArgs(url, profile, appId = null) {
	return [
		appId ? `--app-id=${appId}` : `--app=${url}`,
		`--user-data-dir=${profile}`,
		'--window-size=1280,900',
		'--no-first-run',
		'--no-default-browser-check',
		'--disable-extensions',
		'--disable-component-extensions-with-background-pages',
		'--disable-background-networking',
		'--disable-sync',
		'--disable-features=msEdgeCollections,EdgeCollections,msEntityExtraction,Translate,MediaRouter',
		'--no-pings',
		'--disable-gpu',
	];
}

// Windows-only helpers. Each runs one short PowerShell command with the
// values passed through the environment, so no path needs quoting.
function powershell(script, env = {}) {
	if (process.platform !== 'win32') return '';
	const out = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script],
		{ encoding: 'utf8', windowsHide: true, timeout: 15000, env: { ...process.env, ...env } });
	return (out.stdout ?? '').trim();
}

/**
 * The process id of a browser window that uses Worklog's own profile, or
 * null. Found by the profile in its command line, never by window title,
 * because any browser tab of the page carries the same title.
 */
export function profileWindowPid(profile) {
	const pid = Number(powershell(`$ids = Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" |
		Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:WL_PROFILE) } | ForEach-Object { $_.ProcessId }
		Get-Process -Id $ids -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } |
		Select-Object -First 1 -ExpandProperty Id`, { WL_PROFILE: profile }));
	return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** Brings that window to the front. */
export function focusWindow(pid) {
	powershell('(New-Object -ComObject WScript.Shell).AppActivate([int]$env:WL_PID) | Out-Null', { WL_PID: String(pid) });
}

/** True while the Worklog installer runs (it holds the WorklogSetup mutex). */
export function setupRunning() {
	return powershell("try { [Threading.Mutex]::OpenExisting('WorklogSetup').Dispose(); 'yes' } catch { 'no' }") === 'yes';
}
