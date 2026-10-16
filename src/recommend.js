// Decides which project to pick up next. Every point a project earns comes
// with a sentence saying why, so the page can show the reasoning instead of
// a bare number.

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

const STATUS_POINTS = {
	in_progress: [25, 'สรุปล่าสุดบอกว่ายังทำค้าง'],
	blocked: [20, 'ติดปัญหาที่ต้องแก้ก่อน'],
	waiting: [-10, 'กำลังรอบางอย่างอยู่'],
	done: [-30, 'สรุปล่าสุดบอกว่างานเสร็จแล้ว'],
};

const thaiDate = d => new Date(d).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
const thaiDateTime = ts => new Date(ts).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function spanText(ms) {
	const hours = Math.round(ms / HOUR);
	if (hours < 1) return 'ไม่ถึงชั่วโมง';
	if (hours < 48) return `${hours} ชั่วโมง`;
	return `${Math.round(hours / 24)} วัน`;
}

/** Midnight at the start of a YYYY-MM-DD date, local time. */
function dayStart(dateText) {
	const [y, m, d] = dateText.split('-').map(Number);
	return new Date(y, m - 1, d).getTime();
}

function deadlinePoints(daysLeft) {
	if (daysLeft <= 1) return 50;
	if (daysLeft <= 3) return 35;
	if (daysLeft <= 7) return 20;
	if (daysLeft <= 14) return 10;
	return 0;
}

function recencyPoints(ageMs) {
	if (ageMs < DAY) return 15;
	if (ageMs < 3 * DAY) return 10;
	if (ageMs < 7 * DAY) return 5;
	if (ageMs > 30 * DAY) return -20;
	return 0;
}

/**
 * Picks the account to continue with. Claude work resumes from the local
 * transcript whichever account is signed in, so a limited account can hand
 * over to the other one.
 */
const nameOf = a => (a.tool === 'claude' && !/claude/i.test(a.label) ? `Claude ${a.label}` : a.label);
const freeAt = a => Math.max(0, ...a.limits.map(x => x.resets_at));

export function suggestAccount(latest, accounts) {
	if (latest.tool !== 'claude') {
		const acct = accounts.find(a => a.uuid === latest.account_uuid);
		return { uuid: latest.account_uuid, note: `ทำต่อใน ${acct ? nameOf(acct) : latest.tool}` };
	}
	const claude = accounts.filter(a => a.tool === 'claude');
	const free = claude.filter(a => !a.limited);
	const last = claude.find(a => a.uuid === latest.account_uuid);
	if (last && !last.limited) return { uuid: last.uuid, note: `ใช้ ${nameOf(last)} ต่อได้เลย เป็นบัญชีเดิมที่ทำงานนี้` };
	if (free.length) {
		const why = last ? `${nameOf(last)} ติด limit ถึง ${thaiDateTime(freeAt(last))}` : 'ไม่รู้ว่าครั้งก่อนใช้บัญชีไหน';
		return { uuid: free[0].uuid, note: `ใช้ ${nameOf(free[0])} เพราะ ${why}` };
	}
	const soonest = claude.length ? claude.reduce((a, b) => (freeAt(a) <= freeAt(b) ? a : b)) : null;
	const codex = accounts.find(a => a.tool === 'codex');
	return {
		uuid: codex?.uuid ?? null,
		note: soonest
			? `บัญชี Claude ติด limit ทุกบัญชี ${nameOf(soonest)} ว่างก่อนตอน ${thaiDateTime(freeAt(soonest))}${codex ? ' หรือทำต่อใน Codex ไปก่อน' : ''}`
			: 'ไม่พบบัญชีที่ใช้ได้',
	};
}

export function resumeCommand(latest) {
	if (!latest?.id) return null;
	const cd = latest.cwd ? `cd "${latest.cwd}"; ` : '';
	if (latest.tool === 'codex') return `${cd}codex resume ${latest.id}`;
	return `${cd}claude --resume ${latest.id}`;
}

/** Sessions opened from a desktop app are picked up there, not with a command. */
export function openedFrom(latest) {
	return /desktop/i.test(latest?.entrypoint ?? '') ? 'app' : 'terminal';
}

const bullets = (label, items) => (items?.length ? [label, ...items.slice(0, 5).map(x => `- ${x}`), ''] : []);
const clip = (text, max) => (text.length > max ? `${text.slice(0, max).trimEnd()}...` : text);

/**
 * Text to paste into a new session so it can carry on without the old one,
 * for when the old account is limited or the old session has grown too long.
 */
export function continuePrompt(latest, summary) {
	const tool = latest.tool === 'codex' ? 'Codex' : 'Claude Code';
	const lines = [`ช่วยทำงานต่อจาก session เดิมใน ${tool} ชื่อ "${latest.title}"${latest.cwd ? ` ในโฟลเดอร์ ${latest.cwd}` : ''}`, ''];
	if (summary?.headline) {
		lines.push(`งานถึงไหนแล้ว: ${summary.headline}`, '',
			...bullets('ที่ยังค้างอยู่', summary.in_progress),
			...bullets('ขั้นต่อไป', summary.next_steps),
			...bullets('เรื่องที่รออยู่', summary.waiting_on));
	}
	else if (latest.last_human_text) {
		lines.push(`คำสั่งล่าสุดที่ผมให้ไว้: ${clip(latest.last_human_text, 400)}`, '');
	}
	if (latest.jsonl_path) {
		lines.push(`บทสนทนาเดิมอยู่ที่ ${latest.jsonl_path} ไฟล์นี้ยาว ถ้าต้องการรายละเอียดให้อ่านเฉพาะส่วนท้าย`);
	}
	lines.push('ก่อนเริ่ม ให้ตรวจสถานะจริงในโฟลเดอร์ เช่น git status แล้วบอกผมสั้นๆ ว่าจะเริ่มจากตรงไหน');
	return lines.join('\n');
}

/** How to pick a piece of work back up, shaped by where it was opened. */
export function howToContinue(latest, summary) {
	if (!latest?.id) return null;
	const via = openedFrom(latest);
	return {
		via,
		app: latest.tool === 'codex' ? 'Codex' : 'Claude',
		title: latest.title,
		cwd: latest.cwd ?? null,
		command: via === 'terminal' ? resumeCommand(latest) : null,
		prompt: continuePrompt(latest, summary),
	};
}

/**
 * items: [{ project: {key, name}, latest: session row or null (latest one a
 * person ran), summary: summary data or null, deadlines: [{date, text}],
 * active: true while that session is still open }]
 * accounts: from queries.accounts(). Returns items with score and reasons,
 * best first, leaving out projects with nothing pulling them forward.
 */
export function recommend(items, accounts, now = Date.now()) {
	const today = new Date(now);
	today.setHours(0, 0, 0, 0);
	const out = [];

	for (const { project, latest, summary, deadlines = [], active = false } of items) {
		if (!latest) continue;
		if (summary?.status === 'abandoned') continue;
		const reasons = [];
		let score = 0;
		const add = (points, text) => { score += points; reasons.push({ points, text }); };

		// An open session is still mid-turn, so its end state says nothing yet.
		if (active) add(10, 'มี session ที่ยังเปิดทำอยู่ตอนนี้');
		else if (latest.end_state === 'rate_limited') add(40, `ค้างกลางทางเพราะติด limit เมื่อ ${thaiDateTime(latest.last_ts)}`);
		else if (latest.end_state === 'interrupted') add(30, `ถูกหยุดกลางคันเมื่อ ${thaiDateTime(latest.last_ts)}`);
		else if (latest.end_state === 'no_reply') add(25, 'ส่งคำสั่งไปแล้วแต่ยังไม่ได้คำตอบ');

		const status = STATUS_POINTS[summary?.status];
		if (status) add(status[0], summary.status === 'waiting' && summary.waiting_on?.[0] ? `รอ ${summary.waiting_on[0]}` : status[1]);

		let nearest = null;
		const seen = new Set();
		for (const d of deadlines) {
			if (!d?.date || !/^\d{4}-\d{2}-\d{2}$/.test(d.date) || seen.has(d.date + d.text)) continue;
			seen.add(d.date + d.text);
			const daysLeft = Math.round((dayStart(d.date) - today.getTime()) / DAY);
			if (daysLeft < -1) continue;
			if (!nearest || daysLeft < nearest.daysLeft) nearest = { ...d, daysLeft };
		}
		if (nearest) {
			const points = deadlinePoints(nearest.daysLeft);
			const when = nearest.daysLeft < 0 ? 'เลยกำหนดมาแล้ว' : nearest.daysLeft === 0 ? 'วันนี้' : `อีก ${nearest.daysLeft} วัน`;
			if (points || nearest.daysLeft < 0) add(points || 50, `กำหนด ${thaiDate(dayStart(nearest.date))} (${when}) ${nearest.text}`);
		}

		const age = now - Date.parse(latest.last_ts);
		const recency = recencyPoints(age);
		if (recency > 0) {
			const when = age < HOUR ? 'เพิ่งทำไปไม่ถึงชั่วโมงก่อน' : `ทำล่าสุดเมื่อ ${spanText(age)}ก่อน`;
			add(recency, age < 3 * DAY ? `${when} ยังจำบริบทได้ง่าย` : when);
		}
		else if (recency < 0) add(recency, `ไม่ได้แตะมา ${spanText(age)}`);

		const next = summary?.next_steps?.[0] ?? null;
		if (next) add(5, 'มีขั้นต่อไปที่ทำได้ทันที');

		if (score <= 0) continue;
		const account = suggestAccount(latest, accounts);
		out.push({
			project,
			score,
			reasons: reasons.filter(r => r.points > 0).sort((a, b) => b.points - a.points).map(r => r.text),
			cautions: reasons.filter(r => r.points < 0).map(r => r.text),
			headline: summary?.headline ?? null,
			next_step: next,
			latest: { id: latest.id, title: latest.title, tool: latest.tool, account_uuid: latest.account_uuid, last_ts: latest.last_ts, end_state: latest.end_state },
			account,
			// A new account cannot simply carry on in the old chat, so the
			// prompt comes first when the account changes.
			switched: Boolean(latest.account_uuid && account.uuid && account.uuid !== latest.account_uuid),
			continue: howToContinue(latest, summary),
		});
	}
	return out.sort((a, b) => b.score - a.score);
}
