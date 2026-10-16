// Fills in the account of sessions whose log never says which account ran them.

function gapMs(a, b) {
	const aStart = Date.parse(a.first_ts), aEnd = Date.parse(a.last_ts);
	const bStart = Date.parse(b.first_ts), bEnd = Date.parse(b.last_ts);
	return Math.max(0, aStart - bEnd, bStart - aEnd);
}

/**
 * Returns a Map of session id to account uuid for sessions without an account
 * from the log. Each borrows the account of the nearest session in time that
 * has one, when that session is within windowMs. Automated sessions are left
 * alone: a scheduled task can run under either account.
 */
export function inferAccounts(sessions, windowMs) {
	const known = sessions.filter(s => s.account_source === 'log' && s.first_ts && s.last_ts);
	const result = new Map();
	for (const s of sessions) {
		if (s.account_source === 'log' || s.is_automated || !s.first_ts || !s.last_ts) continue;
		let best = null, bestGap = Infinity;
		for (const k of known) {
			const gap = gapMs(s, k);
			if (gap < bestGap) { best = k; bestGap = gap; }
		}
		if (best && bestGap <= windowMs) result.set(s.id, best.account_uuid);
	}
	return result;
}
