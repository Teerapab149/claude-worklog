import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appBrowser, installedAppId, windowArgs } from '../src/app-window.js';
import { appLauncher, linuxUnit, macPlist, windowsLauncher } from '../src/autostart.js';

const command = ['/usr/bin/node', '--disable-warning=ExperimentalWarning', '/home/a b/100%/"w"/serve.js', '--log'];

test('start-at-login files keep paths with spaces and special characters intact', () => {
	assert.match(linuxUnit(command), /^ExecStart="\/usr\/bin\/node" "--disable-warning=ExperimentalWarning" "\/home\/a b\/100%%\/\\"w\\"\/serve.js" "--log"$/m);
	assert.match(macPlist(['/opt/node', '/x&y/<serve>.js']), /<string>\/x&amp;y\/&lt;serve&gt;\.js<\/string>/);
	assert.match(windowsLauncher(['C:\\Program Files\\node.exe', '--flag', 'C:\\a "b"\\serve.js', '--log']),
		/shell\.Run """C:\\Program Files\\node\.exe"" --flag ""C:\\a ""b""\\serve\.js"" --log", 0, False/);
});

test('the shortcut brings an open window forward instead of opening another', () => {
	const vbs = appLauncher(['C:\\node.exe', '--flag', 'C:\\w\\bin\\app.js']);
	assert.match(vbs, /If Not shell\.AppActivate\("Worklog \|"\) Then/);
	assert.match(vbs, /shell\.Run """C:\\node\.exe"" --flag ""C:\\w\\bin\\app\.js""", 0, False/);
});

test('the app window prefers the configured browser, then Edge, then Chrome', () => {
	const env = { 'ProgramFiles(x86)': 'C:\\PF86', ProgramFiles: 'C:\\PF' };
	const has = list => file => list.includes(file);
	assert.equal(appBrowser({ app: { browser: 'D:\\b.exe' } }, { env, exists: has(['D:\\b.exe']) }), 'D:\\b.exe');
	if (process.platform !== 'win32') return;
	const edge = 'C:\\PF86\\Microsoft\\Edge\\Application\\msedge.exe';
	const chrome = 'C:\\PF\\Google\\Chrome\\Application\\chrome.exe';
	assert.equal(appBrowser({}, { env, exists: has([chrome, edge]) }), edge);
	assert.equal(appBrowser({}, { env, exists: has([chrome]) }), chrome);
	assert.equal(appBrowser({}, { env, exists: has([]) }), null);
});

test('the window opens by app id once Worklog is installed as an app in its profile', () => {
	const prefs = metrics => () => JSON.stringify({ web_app_install_metrics: metrics });
	const worklog = 'dabnalfaeamnjifabmgmpkpoeoenfoma';
	// The YouTube app Edge puts in every profile comes from sync (16) and is skipped.
	const both = {
		agimnkijcaahngcdmfeangaknmldooml: { install_source: 16, install_timestamp: '200' },
		[worklog]: { install_source: 4, install_timestamp: '100' },
	};
	assert.equal(installedAppId('P', { read: prefs(both) }), worklog);
	assert.equal(installedAppId('P', { read: prefs({ agimnkijcaahngcdmfeangaknmldooml: { install_source: 16 } }) }), null);
	assert.equal(installedAppId('P', { read: () => { throw new Error('no file'); } }), null);
	assert.equal(windowArgs('http://localhost:4317/', 'P', worklog)[0], `--app-id=${worklog}`);
	assert.equal(windowArgs('http://localhost:4317/', 'P')[0], '--app=http://localhost:4317/');
});
