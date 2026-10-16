import assert from 'node:assert/strict';
import { test } from 'node:test';
import { linuxUnit, macPlist, windowsLauncher } from '../src/autostart.js';

const command = ['/usr/bin/node', '--disable-warning=ExperimentalWarning', '/home/a b/100%/"w"/serve.js', '--log'];

test('start-at-login files keep paths with spaces and special characters intact', () => {
	assert.match(linuxUnit(command), /^ExecStart="\/usr\/bin\/node" "--disable-warning=ExperimentalWarning" "\/home\/a b\/100%%\/\\"w\\"\/serve.js" "--log"$/m);
	assert.match(macPlist(['/opt/node', '/x&y/<serve>.js']), /<string>\/x&amp;y\/&lt;serve&gt;\.js<\/string>/);
	assert.match(windowsLauncher(['C:\\Program Files\\node.exe', '--flag', 'C:\\a "b"\\serve.js', '--log']),
		/shell\.Run """C:\\Program Files\\node\.exe"" --flag ""C:\\a ""b""\\serve\.js"" --log", 0, False/);
});
