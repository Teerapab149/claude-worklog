// Runs a scan when a session log changes, instead of on a fixed timer, so an
// idle machine does no work at all. While a session is busy writing its log
// the scans are spaced out by minGapMs. A slow fallback timer covers events
// the operating system drops.

import fs from 'node:fs';

export function watchLogs(dirs, onChange, { debounceMs = 2000, minGapMs = 30000, fallbackMs = 15 * 60000, log = () => {} } = {}) {
	let timer = null;
	let last = 0;
	const watchers = [];

	const run = () => {
		timer = null;
		last = Date.now();
		onChange();
	};
	const schedule = () => {
		if (timer) return;
		timer = setTimeout(run, Math.max(debounceMs, minGapMs - (Date.now() - last)));
	};

	for (const dir of dirs) {
		if (!fs.existsSync(dir)) continue;
		try {
			const w = fs.watch(dir, { recursive: true }, (_event, name) => {
				if (!name || String(name).endsWith('.jsonl')) schedule();
			});
			w.on('error', error => log(`watch ${dir} stopped: ${error.message}`));
			watchers.push(w);
		}
		catch (error) {
			log(`watch ${dir} failed, scanning on the fallback timer only: ${error.message}`);
		}
	}
	// Without any watcher the fallback is all there is, so it runs as often as the old timer did.
	const fallback = setInterval(run, watchers.length ? fallbackMs : Math.min(fallbackMs, 2 * 60000));

	return {
		watching: watchers.length,
		close() {
			clearTimeout(timer);
			clearInterval(fallback);
			for (const w of watchers) w.close();
		},
	};
}
