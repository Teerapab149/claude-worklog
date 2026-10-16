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

/**
 * Arguments for a plain app window. The profile of its own keeps it apart
 * from the person's browser, and the rest turns off what a dashboard does
 * not need, which keeps the window's memory down.
 */
export function windowArgs(url, profile) {
	return [
		`--app=${url}`,
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
