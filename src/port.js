// Which port Worklog listens on. Normally config.port (4317), but when another
// program already holds that port the app moves to a free one and writes it
// down here, so the hooks and the next start find the same one.

import fs from 'node:fs';
import path from 'node:path';

const fileOf = config => path.join(config.dataDir, 'port');

export function readPort(config) {
	try {
		const n = Number(fs.readFileSync(fileOf(config), 'utf8').trim());
		if (Number.isInteger(n) && n > 0 && n < 65536) return n;
	}
	catch {
		// No file yet: the configured port.
	}
	return Number(process.env.PORT) || config.port || 4317;
}

export function savePort(config, port) {
	fs.mkdirSync(config.dataDir, { recursive: true });
	if (port === (config.port || 4317)) fs.rmSync(fileOf(config), { force: true });
	else fs.writeFileSync(fileOf(config), `${port}\n`);
}

/** What answers on this port: { app: 'worklog', version, pages } for Worklog, otherwise null. */
export async function pingWorklog(port, { fetch = globalThis.fetch, timeoutMs = 1500 } = {}) {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(timeoutMs) });
		const body = res.ok ? await res.json() : null;
		return body?.app === 'worklog' ? body : null;
	}
	catch {
		return null;
	}
}
