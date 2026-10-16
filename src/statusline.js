// Claude Code passes the status line command a JSON snapshot that, for Pro
// and Max subscribers, includes how much of the 5-hour and weekly windows is
// used. The session logs never record that, so the status line is the only
// place to learn it. Each reading is stored against the session; the session
// log later tells which account it belongs to.

const WINDOWS = { five_hour: { minutes: 300, short: '5 ชม.' }, seven_day: { minutes: 10080, short: 'สัปดาห์' } };

export function readings(input) {
	const limits = input?.rate_limits;
	if (!limits || typeof limits !== 'object') return [];
	return Object.keys(WINDOWS).flatMap(window => {
		const w = limits[window];
		if (!w || !Number.isFinite(w.used_percentage)) return [];
		return [{
			window,
			usedPercent: w.used_percentage,
			windowMinutes: WINDOWS[window].minutes,
			resetsAt: Number.isFinite(w.resets_at) ? w.resets_at * 1000 : null,
		}];
	});
}

/** Stores what changed since the last reading of this session. Returns the readings. */
export function record(db, input, now = Date.now()) {
	const found = readings(input);
	if (!found.length || typeof input.session_id !== 'string') return found;
	const last = db.raw.prepare(`SELECT used_percent, resets_at FROM usage
		WHERE session_id = ? AND window = ? ORDER BY ts DESC LIMIT 1`);
	const account = db.getSession(input.session_id)?.account_uuid ?? null;
	const ts = new Date(now).toISOString();
	for (const r of found) {
		const prev = last.get(input.session_id, r.window);
		if (prev && prev.used_percent === r.usedPercent && prev.resets_at === r.resetsAt) continue;
		db.addUsage(input.session_id, { ...r, ts, account, source: 'statusline' });
	}
	return found;
}

/** The one line Claude Code shows under the prompt. */
export function render(found) {
	if (!found.length) return '';
	return found.map(r => `${WINDOWS[r.window].short} เหลือ ${Math.max(0, Math.round(100 - r.usedPercent))}%`).join(', ');
}
