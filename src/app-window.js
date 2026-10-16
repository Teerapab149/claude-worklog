// Finds a browser that can open Worklog as a window of its own (app mode).

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
