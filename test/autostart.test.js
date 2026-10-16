import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appBrowser } from '../src/app-window.js';
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
