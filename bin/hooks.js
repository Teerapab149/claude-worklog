#!/usr/bin/env node
// npm run install-hooks     adds Worklog's hooks to Claude Code's settings.json
// npm run uninstall-hooks   takes them out again
// The settings file is copied to data/backups before it is changed. The
// settings page does the same through src/hook-install.js.

import { loadConfig } from '../src/config.js';
import { applyHooks } from '../src/hook-install.js';

const action = process.argv[2];
if (action !== 'install' && action !== 'uninstall') {
	console.log('ใช้ได้สองแบบ: node bin/hooks.js install หรือ node bin/hooks.js uninstall');
	process.exit(1);
}
const result = applyHooks(loadConfig(), action);
(result.ok ? console.log : console.error)(result.message);
process.exit(result.ok ? 0 : 1);
