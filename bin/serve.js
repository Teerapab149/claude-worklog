#!/usr/bin/env node
// npm start                 opens the dashboard at http://localhost:4317
// node bin/serve.js --log   same, writing output to data/server.log (used by autostart)

import fs from 'node:fs';
import path from 'node:path';
import { configFile, loadConfig } from '../src/config.js';
import { openDbChecked } from '../src/db.js';
import { startServer } from '../src/server.js';

const config = loadConfig();
const port = Number(process.env.PORT) || config.port || 4317;

let log = console.log;
if (process.argv.includes('--log')) {
	const file = path.join(config.dataDir, 'server.log');
	fs.mkdirSync(config.dataDir, { recursive: true });
	// Start a fresh file once it passes 1 MB so it never grows without bound.
	if (fs.existsSync(file) && fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, `${file}.old`);
	log = (...parts) => fs.appendFileSync(file, `${new Date().toISOString()} ${parts.join(' ')}\n`);
	process.on('uncaughtException', error => { log(`crashed: ${error.stack}`); process.exit(1); });
}

const { db } = openDbChecked(path.join(config.dataDir, 'index.db'), { log });
try {
	const server = await startServer({ db, config, configFile: configFile(), port, log });
	log(`เปิดหน้าเว็บได้ที่ http://localhost:${server.address().port}`);
}
catch (error) {
	if (error.code !== 'EADDRINUSE') throw error;
	// Another copy is already serving, most likely the one started at login.
	log(`port ${port} มีโปรแกรมใช้อยู่แล้ว ถ้าเป็น Worklog ที่เปิดไว้ก่อน ให้เข้า http://localhost:${port} ได้เลย`);
	db.close();
	process.exit(0);
}
