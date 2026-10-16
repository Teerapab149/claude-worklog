// The small files each operating system needs to start the dashboard at
// login. bin/autostart.js writes them and tells the system about them.

import path from 'node:path';
import { APP_ROOT } from './config.js';

export const LABEL = 'com.worklog.dashboard';

/** The command that starts the dashboard, as [program, ...arguments]. */
export function serveCommand(node = process.execPath) {
	return [node, '--disable-warning=ExperimentalWarning', path.join(APP_ROOT, 'bin', 'serve.js'), '--log'];
}

// VBScript doubles a quote to put it inside a string.
const vbs = s => s.replace(/"/g, '""');

export function windowsLauncher(command = serveCommand()) {
	const line = command.map(part => (part.startsWith('--') ? part : `"${part}"`)).join(' ');
	return [
		"' Starts the Worklog dashboard without a console window. Made by npm run autostart:install.",
		'Set shell = CreateObject("WScript.Shell")',
		`shell.CurrentDirectory = "${vbs(APP_ROOT)}"`,
		`shell.Run "${vbs(line)}", 0, False`,
		'',
	].join('\r\n');
}

/** The command behind the Worklog shortcut, which opens the app window. */
export function appCommand(node = process.execPath) {
	return [node, '--disable-warning=ExperimentalWarning', path.join(APP_ROOT, 'bin', 'app.js')];
}

/**
 * What the Worklog shortcut runs. It always starts bin/app.js, which brings
 * an open Worklog window forward when there is one, found by its process
 * rather than its title (a stale window or a browser tab shares the title).
 */
export function appLauncher(command = appCommand()) {
	const line = command.map(part => (part.startsWith('--') ? part : `"${part}"`)).join(' ');
	return [
		"' Opens Worklog in its own window. Made by npm run shortcut:install.",
		'Set shell = CreateObject("WScript.Shell")',
		`shell.CurrentDirectory = "${vbs(APP_ROOT)}"`,
		`shell.Run "${vbs(line)}", 0, False`,
		'',
	].join('\r\n');
}

const xml = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A launchd agent for macOS, kept in ~/Library/LaunchAgents. */
export function macPlist(command = serveCommand()) {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${LABEL}</string>
	<key>ProgramArguments</key>
	<array>
${command.map(part => `		<string>${xml(part)}</string>`).join('\n')}
	</array>
	<key>WorkingDirectory</key>
	<string>${xml(APP_ROOT)}</string>
	<key>RunAtLoad</key>
	<true/>
	<key>ProcessType</key>
	<string>Background</string>
</dict>
</plist>
`;
}

// systemd reads a quoted word with C-style escapes, and % starts a specifier.
const unitWord = s => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%')}"`;

/** A systemd user service for Linux, kept in ~/.config/systemd/user. */
export function linuxUnit(command = serveCommand()) {
	return `[Unit]
Description=Worklog dashboard for Claude Code and Codex sessions

[Service]
ExecStart=${command.map(unitWord).join(' ')}
WorkingDirectory=${APP_ROOT}
Restart=on-failure
Nice=10

[Install]
WantedBy=default.target
`;
}
