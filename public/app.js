const app = document.getElementById('app');
const scanMeta = document.getElementById('scan-meta');
const rescanBtn = document.getElementById('rescan');
const themeBtn = document.getElementById('theme');

const TIMELINE_DAYS = 14;
const END_STATE = {
	replied: 'AI ตอบแล้ว รอคุณ',
	rate_limited: 'ติด limit',
	interrupted: 'หยุดกลางคัน',
	no_reply: 'ยังไม่มีคำตอบ',
	unknown: 'ไม่ทราบสถานะ',
};
const LIMIT_NAME = { five_hour: 'limit 5 ชั่วโมง', seven_day: 'limit รายสัปดาห์' };
const STATUS = {
	in_progress: { label: 'กำลังทำ', shape: 's-progress' },
	blocked: { label: 'ติดปัญหา', shape: 's-blocked' },
	waiting: { label: 'รออยู่', shape: 's-waiting' },
	done: { label: 'เสร็จแล้ว', shape: 's-done' },
	abandoned: { label: 'เลิกทำแล้ว', shape: 's-done' },
};
const PAUSE_TEXT = {
	auth: 'สรุปด้วย AI ไม่ได้ เพราะ claude CLI ยังไม่ได้ login ให้เปิด Claude Code แล้วใช้คำสั่ง /login จากนั้นกดสรุปอีกครั้ง',
	rate_limit: 'สรุปด้วย AI ไม่ได้ชั่วคราว เพราะบัญชีที่ claude CLI ใช้อยู่ติด limit ระบบจะลองใหม่เอง',
	missing_cli: 'หาโปรแกรม claude ไม่เจอ ให้ติดตั้ง Claude Code CLI หรือตั้ง summary.claudeBin ใน config.local.json',
};
const ICON = {
	back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
	search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M20 20l-3.5-3.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
};

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ESC[c]);

/** The server only accepts writes that carry JSON, so every non-GET call sends some. */
async function api(path, { body, ...options } = {}) {
	if (options.method && options.method !== 'GET') {
		options.headers = { 'content-type': 'application/json' };
		options.body = JSON.stringify(body ?? {});
	}
	const res = await fetch(path, options);
	if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
	return res.json();
}

// Time

const toMs = ts => (typeof ts === 'number' ? ts : Date.parse(ts));
const formatDateTime = ts => new Date(toMs(ts)).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const formatTime = ts => new Date(toMs(ts)).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

function spanText(ms) {
	const minutes = Math.max(1, Math.round(ms / 60000));
	if (minutes < 60) return `${minutes} นาที`;
	const hours = Math.floor(minutes / 60), rest = minutes % 60;
	if (hours < 24) return rest ? `${hours} ชม. ${rest} นาที` : `${hours} ชม.`;
	const days = Math.floor(hours / 24), restHours = hours % 24;
	return restHours ? `${days} วัน ${restHours} ชม.` : `${days} วัน`;
}

function ago(ts) {
	if (!ts) return 'ไม่ทราบเวลา';
	const diff = Date.now() - toMs(ts);
	if (diff < 60000) return 'เมื่อสักครู่';
	if (diff > 7 * 86400000) return formatDateTime(ts);
	return `${spanText(diff)}ที่แล้ว`;
}

// Colours and shapes

/** One of four paints, picked from a name so a project keeps its colour. */
function paint(name) {
	let h = 0;
	for (const ch of String(name)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
	return `p${h % 4}`;
}

function shape(status, { small = false, cls = '' } = {}) {
	const s = STATUS[status]?.shape ?? 's-none';
	const label = STATUS[status]?.label ?? 'ยังไม่มีสรุป';
	return `<span class="shape ${s} ${small ? 'shape-sm' : ''} ${cls}" role="img" aria-label="${label}" title="${label}"></span>`;
}

// Accounts

let accountIndex = new Map();
const useAccounts = accounts => { accountIndex = new Map(accounts.map(a => [a.uuid, a])); };
const accountName = acct => (acct.tool === 'claude' && !/claude/i.test(acct.label) ? `Claude ${acct.label}` : acct.label);
const accountPaint = uuid => { const a = accountIndex.get(uuid); return a ? `p${a.color % 4}` : ''; };

function accountChip(uuid, source) {
	const acct = accountIndex.get(uuid);
	if (!acct) return '<span class="acct-note"><span class="acct-dot"></span>ไม่ทราบบัญชี</span>';
	const guess = source === 'inferred' ? ' <span class="guess" title="log ไม่ได้บอกบัญชี จึงเดาจาก session อื่นในช่วงเวลาใกล้กัน">(เดา)</span>' : '';
	return `<span class="acct-note ${accountPaint(uuid)}"><span class="acct-dot"></span>${esc(accountName(acct))}${guess}</span>`;
}

/** A usage window's name, from its kind or its length in minutes. */
function windowName(u) {
	if (u.window === 'five_hour' || u.window_minutes === 300) return '5 ชั่วโมง';
	if (u.window === 'seven_day' || u.window_minutes === 10080) return 'รายสัปดาห์';
	if (u.window_minutes >= 1440 && u.window_minutes % 1440 === 0) return `${u.window_minutes / 1440} วัน`;
	if (u.window_minutes) return `${Math.round(u.window_minutes / 60)} ชั่วโมง`;
	return LIMIT_NAME[u.window] ?? 'limit';
}

/**
 * One tube per usage window, filled with what is left. The account's state
 * reads from the emptiest tube; with no reading yet it falls back to what the
 * log knows, which is only whether a request was refused.
 */
function usageOf(acct) {
	const tubes = (acct.usage ?? [])
		.map(u => ({ ...u, left: Math.max(0, Math.min(100, Math.round(100 - u.used_percent))) }))
		.sort((a, b) => (a.window_minutes ?? 0) - (b.window_minutes ?? 0));
	const empty = tubes.find(t => t.left === 0);
	let state, text;
	if (empty) {
		state = 'waiting';
		text = empty.resets_at ? `ว่างอีก ${spanText(empty.resets_at - Date.now())}` : 'ใช้หมดแล้ว';
	}
	else if (tubes.length) {
		const least = Math.min(...tubes.map(t => t.left));
		state = least < 20 ? 'low' : 'ready';
		text = `เหลือ ${least}%`;
	}
	else if (acct.tool === 'claude') {
		// Without a reading, the log only shows that no request was refused.
		state = 'unknown';
		text = 'ไม่ได้ติด limit';
	}
	else {
		state = 'unknown';
		text = 'ยังไม่มีตัวเลข';
	}
	return { tubes, state, text };
}

function tube(t) {
	// An empty tube already says when it frees up in the account's state.
	const reset = t.left === 0 ? ''
		: t.resets_at ? `รีเซ็ตใน ${spanText(t.resets_at - Date.now())}`
		: t.reset_seen ? `รีเซ็ตแล้วเมื่อ ${formatDateTime(t.reset_seen)} และยังไม่ได้ใช้จากเครื่องนี้` : '';
	return `<div class="tube-row ${t.left === 0 ? 'is-empty' : t.left < 20 ? 'is-low' : ''}">
		<div class="tube-head"><span>${esc(windowName(t))}</span><span class="tube-left">เหลือ ${t.left}%</span></div>
		<div class="tube" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${t.left}" aria-label="${esc(`${windowName(t)} เหลือ ${t.left}%`)}">
			<span class="tube-fill" data-w="${t.left}%" style="width:${animateBars ? '0%' : `${t.left}%`}"></span>
		</div>
		${reset ? `<p class="rod-meta">${esc(reset)}</p>` : ''}
	</div>`;
}

function rod(acct, { detail = false } = {}) {
	const u = usageOf(acct);
	const none = u.tubes.length ? '' : `<p class="rod-meta">${detail
		? (acct.tool === 'claude'
			? 'แอป Claude ไม่ได้บันทึกว่าใช้ไปกี่เปอร์เซ็นต์ Worklog รู้แค่ตอนที่คำขอถูกปฏิเสธ ถ้าในแอปขึ้นว่าใช้ครบแล้ว ให้บอกไว้ตรงนี้'
			: 'log ยังไม่ได้บอกว่าใช้ไปเท่าไหร่')
		: 'ยังไม่มีตัวเลขเปอร์เซ็นต์'}</p>`;
	return `<div class="rod ${accountPaint(acct.uuid)}">
		<div class="rod-head"><span class="rod-name">${esc(accountName(acct))}</span><span class="rod-state ${u.state}">${esc(u.text)}</span></div>
		${u.tubes.map(tube).join('')}${none}
		${detail ? `<p class="rod-meta">${acct.sessions} session, ใช้ล่าสุด ${esc(ago(acct.last_ts))}</p>` : ''}
		${detail && acct.tool === 'claude' ? markForm(acct) : ''}
	</div>`;
}

// Marking a limit by hand

const MARK_HOURS = { five_hour: 5, seven_day: 7 * 24 };
const localInput = ms => {
	const d = new Date(ms);
	d.setMinutes(d.getMinutes() - d.getTimezoneOffset(), 0, 0);
	return d.toISOString().slice(0, 16);
};

/**
 * The log only knows about a limit once a request is refused, so the person
 * can say an account is used up, until when, from what the Claude app shows.
 */
function markForm(acct) {
	const marks = acct.limits.filter(l => l.manual);
	if (marks.length) {
		const text = marks.map(m => `${LIMIT_NAME[m.type] ?? 'limit'} ถึง ${formatDateTime(m.resets_at)}`).join(' และ ');
		return `<div class="mark-set"><p class="rod-meta">คุณบอกไว้ว่าติด ${esc(text)} Worklog จะไม่แนะนำบัญชีนี้จนถึงตอนนั้น</p>
			<button class="btn-copy" type="button" data-unmark="${esc(acct.uuid)}">ใช้ได้แล้ว</button></div>`;
	}
	const id = `mark-${esc(acct.uuid)}`;
	return `<details class="mark"><summary>บอกว่าบัญชีนี้ติด limit</summary>
		<form class="mark-form" data-mark="${esc(acct.uuid)}">
			<fieldset class="mark-window"><legend>ช่วงที่ใช้ครบ</legend>
				<label><input type="radio" name="window" value="seven_day" checked> รายสัปดาห์</label>
				<label><input type="radio" name="window" value="five_hour"> 5 ชั่วโมง</label>
			</fieldset>
			<label class="mark-when" for="${id}">รีเซ็ตตอน
				<input id="${id}" type="datetime-local" name="resets_at" required value="${localInput(Date.now() + MARK_HOURS.seven_day * 3600000)}"></label>
			<p class="rod-meta">ดูเวลารีเซ็ตได้ในหน้า Usage ของแอป Claude</p>
			<div class="mark-actions"><button class="btn-copy" type="submit">บันทึก</button><span class="mark-error" role="status"></span></div>
		</form></details>`;
}

app.addEventListener('change', event => {
	const radio = event.target.closest('.mark-form input[name="window"]');
	if (!radio) return;
	const when = radio.form.elements.resets_at;
	when.value = localInput(Date.now() + MARK_HOURS[radio.value] * 3600000);
});

app.addEventListener('submit', async event => {
	const form = event.target.closest('form[data-mark]');
	if (!form) return;
	event.preventDefault();
	const error = form.querySelector('.mark-error');
	const resetsAt = new Date(form.elements.resets_at.value).getTime();
	if (!(resetsAt > Date.now())) { error.textContent = 'เวลารีเซ็ตต้องเป็นเวลาข้างหน้า'; return; }
	try {
		await api(`/api/accounts/${encodeURIComponent(form.dataset.mark)}/limit`, {
			method: 'POST', body: { window: form.elements.window.value, resets_at: resetsAt },
		});
	}
	catch (e) {
		error.textContent = e.status === 400 ? 'เวลานี้ไกลเกินช่วงของ limit นี้' : 'บันทึกไม่สำเร็จ';
		return;
	}
	await route({ quiet: true });
});

let animateBars = false;
function releaseBars() {
	requestAnimationFrame(() => requestAnimationFrame(() => {
		for (const f of app.querySelectorAll('.tube-fill[data-w]')) f.style.width = f.dataset.w;
	}));
}

// Summaries

let pollTimer = null;
function pollWhileBusy(anyBusy) {
	clearTimeout(pollTimer);
	if (anyBusy) pollTimer = setTimeout(() => route({ quiet: true }), 3000);
}

function pausedNote(summarizer) {
	if (!summarizer?.paused) return '';
	return `<p class="paused">${esc(PAUSE_TEXT[summarizer.paused.kind] ?? summarizer.paused.message)}</p>`;
}

function workingNote(s) {
	if (!s || s.paused || !(s.running || s.pending.length)) return '';
	return `<p class="working"><span class="pulse"></span>กำลังสรุปด้วย AI อีก ${s.pending.length + (s.running ? 1 : 0)} รายการ</p>`;
}

function listBlock(title, items) {
	if (!items?.length) return '';
	return `<div class="sum-block"><h3>${title}</h3><ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`;
}

function deadlineBlock(deadlines) {
	if (!deadlines?.length) return '';
	const items = deadlines.map(d => {
		const when = d.date ? new Date(`${d.date}T00:00:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : 'ไม่ระบุวัน';
		return `<li><b>${esc(when)}</b> ${esc(d.text)}</li>`;
	});
	return `<div class="sum-block"><h3>กำหนดส่ง</h3><ul>${items.join('')}</ul></div>`;
}

function summaryBody(summary, kind, ref, summarizer) {
	const busy = summary?.busy && !summarizer?.paused;
	const data = summary?.data;
	const button = `<button class="btn-copy" type="button" data-summarize="${kind}" data-ref="${esc(ref)}" ${busy ? 'disabled' : ''}>${busy ? 'กำลังสรุป' : data ? 'สรุปใหม่' : 'สรุปด้วย AI'}</button>`;
	let meta;
	if (data) meta = `สรุปเมื่อ ${esc(ago(summary.created_at))}${summary.stale ? ' มีข้อความใหม่หลังจากนั้น' : ''}`;
	else if (summary?.error && !busy) meta = `สรุปไม่สำเร็จ ${esc(ago(summary.error_at))}`;
	else if (busy) meta = 'กำลังสรุป';
	else meta = kind === 'project' ? 'ยังไม่มีสรุปของโปรเจคนี้' : 'ยังไม่มีสรุปของ session นี้';
	return `<div class="summary">
		<div class="summary-head"><span class="summary-meta">${meta}</span>${button}</div>
		${data ? `<p class="headline">${shape(data.status)}<span>${esc(data.headline)}</span></p>
			<div class="sum-grid">
				${listBlock('ขั้นต่อไป', data.next_steps)}
				${listBlock('ยังค้างอยู่', data.in_progress)}
				${listBlock('เรื่องที่รออยู่', data.waiting_on)}
				${deadlineBlock(data.deadlines)}
				${listBlock('ทำเสร็จแล้ว', data.done)}
			</div>` : ''}
		${pausedNote(summarizer)}
	</div>`;
}

// Pieces shared by several pages

const box = (tag, body, { cls = '', tagCls = '' } = {}) => `<section class="box ${cls}"><h2 class="tag ${tagCls}">${tag}</h2>${body}</section>`;
const backLink = (href, text) => `<a class="back" href="${href}">${ICON.back}${esc(text)}</a>`;

/**
 * How to pick the work back up. A session opened in the desktop app is
 * found in its sidebar; one opened in a terminal has a resume command.
 * Both get a prompt for starting fresh, which leads when the account changed.
 */
function continueBlock(c, { switched = false } = {}) {
	if (!c) return '<p class="empty">ไม่มีข้อมูลพอจะบอกวิธีทำต่อ</p>';
	const folder = c.cwd ? ` ในโฟลเดอร์ <span class="mono">${esc(c.cwd)}</span>` : '';
	const fresh = `<div class="how-row"><p>${switched ? 'บัญชีเปลี่ยนจากครั้งก่อน ให้เปิด session ใหม่' : 'หรือเปิด session ใหม่'}${folder} แล้ววาง prompt นี้</p>
		<button class="btn-copy" type="button" data-copy="${esc(c.prompt)}">คัดลอก prompt</button></div>`;
	const old = c.via === 'app'
		? `<p class="how-old">${switched ? 'ถ้ายังเปิด session เดิมได้ ให้หา session ชื่อ' : 'เปิด session ชื่อ'} <b>"${esc(c.title)}"</b> จากแถบด้านซ้ายของแอป ${esc(c.app)}</p>`
		: `<div class="cmd"><code>${esc(c.command)}</code><button class="btn-copy" type="button" data-copy="${esc(c.command)}">คัดลอก</button></div>`;
	return `<div class="how">${switched ? fresh + old : old + fresh}
		<details class="prompt-preview"><summary>ดู prompt</summary><div class="quote">${esc(c.prompt)}</div></details></div>`;
}

function liveList(active) {
	if (!active.length) return '<p class="empty">ไม่มี session เปิดอยู่</p>';
	return `<div class="live-list">${active.map(s => {
		const inner = `<span class="pulse ${s.status === 'busy' ? '' : 'idle'}"></span>
			<span class="row-main"><span class="row-title">${esc(s.project_name ?? 'ไม่ทราบโปรเจค')}</span><span class="row-sub">${esc(s.title ?? '')}</span></span>
			<span class="row-side">${s.status === 'busy' ? 'กำลังทำงาน' : 'เปิดค้างไว้'}</span>`;
		return s.project_key ? `<a class="live" href="#/s/${encodeURIComponent(s.id)}">${inner}</a>` : `<div class="live">${inner}</div>`;
	}).join('')}</div>`;
}

function overlapList(o) {
	const together = o.openTogether.map(g => `<a class="warn" href="#/p/${encodeURIComponent(g.project_key)}">
		<span class="warn-title">${shape('blocked', { small: true, cls: 'p3' })}${esc(g.project_name)} เปิดอยู่ ${g.sessions.length} session พร้อมกัน</span>
		<span class="row-sub">${g.strong ? 'เปิดจากคนละบัญชี อีกฝั่งอาจไม่รู้ว่าทำอะไรไปแล้ว' : g.sessions.map(s => esc(s.title ?? s.id.slice(0, 8))).join(', ')}</span></a>`);
	const files = o.files.map(f => `<a class="warn" href="#/s/${encodeURIComponent(f.sessions[0].id)}">
		<span class="warn-title">${shape('blocked', { small: true, cls: 'p3' })}<span class="file-path">${esc(f.path.replace(/\\/g, '/').split('/').slice(-2).join('/'))}</span></span>
		<span class="row-sub">${f.strong ? 'คนละบัญชีแก้ไฟล์นี้' : 'สอง session แก้ไฟล์นี้'} ห่างกันไม่เกิน ${o.windowMinutes} นาที ล่าสุด ${esc(ago(f.last_ts))}</span></a>`);
	return `<div class="warn-list">${[...together, ...files].join('')}</div>`;
}

const hasOverlap = o => o && (o.openTogether.length || o.files.length);

function loading(kind = 'cols') {
	app.innerHTML = kind === 'cols'
		? '<div class="page"><div class="page-cols"><div class="stack"><div class="skeleton tall"></div><div class="skeleton"></div></div><div class="stack"><div class="skeleton"></div><div class="skeleton"></div></div></div></div>'
		: '<div class="page"><div class="skeleton"></div><div class="skeleton tall"></div></div>';
}

function failed(error) {
	const text = error.status === 404 ? 'ไม่พบข้อมูลนี้ อาจถูกลบไปแล้ว' : 'โหลดข้อมูลไม่สำเร็จ ลองกด อ่าน log ใหม่ หรือเปิดหน้านี้อีกครั้ง';
	app.innerHTML = `<div class="page"><div class="error-box"><p>${text}</p><a class="back" href="#/">${ICON.back}กลับไปหน้าวันนี้</a></div></div>`;
}

function showScan(scan) {
	if (!scan) return;
	scanMeta.textContent = scan.error ? 'อ่าน log ล่าสุดมีปัญหา' : `อ่าน log ล่าสุดเมื่อ ${formatTime(scan.at)}`;
}

// Today

function block(item) {
	const p = item.project;
	// A deadline reason reads "กำหนด <date> (<when>) <what>"; the chip keeps the date part.
	const brief = r => r.match(/^(กำหนด [^)]*\))/)?.[1] ?? r;
	const reasons = item.reasons.slice(0, 1).map(r => `<span class="chip hot" title="${esc(r)}"><span class="clamp">${esc(brief(r))}</span></span>`)
		.concat(item.cautions.slice(0, 1).map(c => `<span class="chip quiet"><span class="clamp">${esc(c)}</span></span>`)).join('');
	return `<article class="block ${paint(p.name)}">
		<div class="block-band"></div>
		<div class="block-body">
			<div class="block-title">${shape(item.status)}<h3 title="${esc(p.name)}"><a href="#/p/${encodeURIComponent(p.key)}">${esc(p.name)}</a></h3></div>
			${item.headline ? `<p class="block-lede">${esc(item.headline)}</p>` : `<p class="block-lede">${esc(item.latest.title)}</p>`}
			${item.next_step ? `<p class="next-step"><b>เริ่มจาก</b><span class="clamp">${esc(item.next_step)}</span></p>` : ''}
			<div class="chips">${reasons}</div>
			<div class="block-foot">
				<span class="acct-note ${accountPaint(item.account.uuid)}"><span class="acct-dot"></span>${esc(item.account.note)}</span>
				<details class="go"><summary class="btn-go">ทำต่อ</summary>
					<div class="go-panel">${continueBlock(item.continue, { switched: item.switched })}</div></details>
			</div>
		</div>
	</article>`;
}

function mini(item) {
	return `<a class="mini ${paint(item.project.name)}" href="#/p/${encodeURIComponent(item.project.key)}">
		<span class="mini-title">${shape(item.status, { small: true })}${esc(item.project.name)}</span>
		<span class="mini-sub">${esc(item.reasons[0] ?? item.cautions[0] ?? ago(item.latest.last_ts))}</span></a>`;
}

async function renderToday() {
	const data = await api('/api/overview');
	useAccounts(data.accounts);
	showScan(data.scan);
	const s = data.summarizer;
	pollWhileBusy(s && !s.paused && (s.running || s.pending.length));
	const top = data.next.slice(0, 3), rest = data.next.slice(3);
	app.innerHTML = `<div class="page"><div class="page-cols">
		<div class="stack">
			<header class="page-head"><h1>วันนี้ทำอะไรต่อดี</h1>
				<p>${top.length ? `${top.length === 1 ? 'งานที่ควร' : `${top.length} งานที่ควร`}หยิบก่อน เรียงจากเรื่องที่รีบที่สุด` : 'ยังไม่มีงานที่ค้างอยู่'}</p>
				${workingNote(s)}${pausedNote(s)}</header>
			${box('ทำต่อ', top.length ? `<div class="blocks">${top.map(block).join('')}</div>`
				: '<p class="empty">ไม่มีงานค้าง เมื่อเปิด Claude Code หรือ Codex ทำงาน งานจะขึ้นที่นี่</p>')}
			${rest.length ? box('ยังค้างอยู่อีก', `<div class="minis">${rest.map(mini).join('')}</div>`) : ''}
		</div>
		<div class="stack">
			${box('บัญชี', `<div class="rods">${data.accounts.map(a => rod(a)).join('')}</div>`)}
			${box('เปิดอยู่ตอนนี้', liveList(data.active))}
			${hasOverlap(data.overlaps) ? box('งานทับซ้อน', overlapList(data.overlaps), { tagCls: 'tag-alert' }) : ''}
		</div>
	</div></div>`;
}

// Projects

let projectQuery = '';
const GROUPS = [
	['in_progress', 'กำลังทำ'],
	['blocked', 'ติดปัญหา'],
	['waiting', 'รออยู่'],
	[null, 'ยังไม่มีสรุป'],
	['finished', 'เสร็จหรือเลิกทำแล้ว'],
];
const groupOf = p => {
	const st = p.summary?.data?.status;
	if (st === 'done' || st === 'abandoned') return 'finished';
	return STATUS[st] ? st : null;
};

function projectRow(p) {
	const sum = p.summary?.data;
	const sub = sum?.next_steps?.[0] ? `เริ่มจาก ${sum.next_steps[0]}` : sum?.headline ?? p.latest?.last_human_text ?? p.latest?.title ?? '';
	const dots = p.accounts.map(uuid => `<span class="acct-dot ${accountPaint(uuid)}" title="${esc(accountIndex.has(uuid) ? accountName(accountIndex.get(uuid)) : '')}"></span>`).join('');
	const st = sum?.status;
	return `<a class="row ${paint(p.name)}" href="#/p/${encodeURIComponent(p.key)}" data-find="${esc(`${p.name} ${sum?.headline ?? ''}`.toLowerCase())}">
		${shape(st)}
		<span class="row-main"><span class="row-title">${esc(p.name)}</span><span class="row-sub">${esc(sub)}</span></span>
		<span class="row-side">${st === 'done' || st === 'abandoned' ? `<span class="stamp ${st === 'abandoned' ? 'gone' : ''}">${STATUS[st].label}</span><br>` : ''}${esc(ago(p.last_ts))}<br><span class="dots">${dots}</span> ${p.sessions} session</span>
	</a>`;
}

function filterProjects() {
	const q = projectQuery.trim().toLowerCase();
	for (const row of app.querySelectorAll('[data-find]')) row.hidden = Boolean(q) && !row.dataset.find.includes(q);
	for (const g of app.querySelectorAll('[data-group]')) {
		const shown = g.querySelectorAll('[data-find]:not([hidden])').length;
		g.hidden = shown === 0;
		g.querySelector('.count').textContent = shown;
		if (q && g.tagName === 'DETAILS') g.open = true;
	}
	const none = app.querySelector('#no-match');
	if (none) none.hidden = Boolean(app.querySelector('[data-find]:not([hidden])'));
}

async function renderProjects() {
	const data = await api('/api/overview');
	useAccounts(data.accounts);
	showScan(data.scan);
	const groups = GROUPS.map(([key, label]) => [key, label, data.projects.filter(p => groupOf(p) === key)]).filter(g => g[2].length);
	app.innerHTML = `<div class="page">
		<header class="page-head"><h1>โปรเจค</h1><p>${data.projects.length} โปรเจค แบ่งตามสถานะจากสรุปล่าสุด</p></header>
		${box('ทั้งหมด', `<div class="box-head"><label class="search">${ICON.search}<input type="search" id="find" placeholder="ค้นหาชื่อโปรเจค" value="${esc(projectQuery)}" aria-label="ค้นหาโปรเจค"></label></div>
			${groups.map(([key, label, list]) => {
				const head = `<div class="group-head">${shape(key === 'finished' ? 'done' : key, { small: true })}<h2>${label}</h2><span class="count">${list.length}</span></div>`;
				const rows = `<div class="rows">${list.map(projectRow).join('')}</div>`;
				return key === 'finished'
					? `<details class="group" data-group><summary>${head}</summary>${rows}</details>`
					: `<div class="group" data-group>${head}${rows}</div>`;
			}).join('') || '<p class="empty">ยังไม่พบ session ใน log ลองเปิด Claude Code ทำงานสักครั้ง แล้วกด อ่าน log ใหม่</p>'}
			<p class="empty" id="no-match" hidden>ไม่มีโปรเจคที่ตรงกับคำค้นนี้</p>`)}
	</div>`;
	const find = app.querySelector('#find');
	find?.addEventListener('input', () => { projectQuery = find.value; filterProjects(); });
	filterProjects();
}

// Accounts

async function renderAccounts() {
	const data = await api('/api/overview');
	useAccounts(data.accounts);
	showScan(data.scan);
	app.innerHTML = `<div class="page"><div class="page-cols">
		<div class="stack">
			<header class="page-head"><h1>บัญชี</h1><p>บัญชีไหนใช้ได้ บัญชีไหนติด limit ถึงเมื่อไหร่</p></header>
			${box('เครื่องมือและบัญชี', `<div class="rods">${data.accounts.map(a => rod(a, { detail: true })).join('') || '<p class="empty">ยังไม่พบบัญชีใน log</p>'}</div>`)}
		</div>
		<div class="stack">
			${box('เปิดอยู่ตอนนี้', liveList(data.active))}
			${box('งานทับซ้อน', hasOverlap(data.overlaps) ? overlapList(data.overlaps) : '<p class="empty">ไม่มีงานทับซ้อนใน 24 ชั่วโมงที่ผ่านมา</p>', { tagCls: hasOverlap(data.overlaps) ? 'tag-alert' : '' })}
		</div>
	</div></div>`;
}

// Settings

const OVERLAP_MODE = {
	deny_once: 'หยุดการแก้ครั้งแรกแล้วบอก Claude ว่าไฟล์นี้มีอีก session แก้อยู่ ถ้า Claude ลองอีกครั้งจะแก้ได้ (แนะนำ)',
	ask: 'ถามคุณก่อนทุกครั้ง',
	context: 'ให้แก้ได้เลย แล้วบอก Claude หลังจากนั้น',
	off: 'ไม่เตือน',
};
const SUMMARY_MODEL = { haiku: 'Haiku ใช้โควต้าน้อยกว่า', sonnet: 'Sonnet สรุปละเอียดกว่า แต่ใช้โควต้ามากกว่า' };
const lines = text => text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);

function field(id, label, control, help = '') {
	return `<div class="field"><label class="field-label" for="${id}">${label}</label>${control}${help ? `<p class="field-help">${help}</p>` : ''}</div>`;
}

/** installed comes from the server, which looks in the window's profile; null when not opened from the shortcut. */
function windowSetting(installed) {
	if (installed) return '<p class="field-help">Worklog ติดตั้งเป็นแอปแล้ว แถบด้านบนของหน้าต่างใช้สีเดียวกับหน้า</p>';
	if (installOffer) {
		return `<div class="how-row"><p>ติดตั้ง Worklog เป็นแอป เพื่อให้แถบด้านบนของหน้าต่างเป็นสีเดียวกับหน้า หลังติดตั้ง ให้ปิดหน้าต่างนี้แล้วเปิดจาก shortcut เดิม</p>
			<button class="btn-copy" type="button" data-install>ติดตั้งเป็นแอป</button></div>`;
	}
	return '<p class="field-help">ติดตั้งเป็นแอปได้เมื่อเปิด Worklog จาก shortcut ถ้าเปิดอยู่แล้วแต่ไม่มีปุ่ม ให้ลองปิดหน้าต่างแล้วเปิดใหม่</p>';
}

app.addEventListener('click', async event => {
	const button = event.target.closest('[data-install]');
	if (!button || !installOffer) return;
	button.disabled = true;
	await installOffer.prompt();
	const { outcome } = await installOffer.userChoice;
	installOffer = null;
	button.textContent = outcome === 'accepted' ? 'ติดตั้งแล้ว' : 'ยังไม่ได้ติดตั้ง';
});

async function renderSettings() {
	const { scan, settings: st, editable: ed, canSave, summaryRunning, appInstalled } = await api('/api/settings');
	showScan(scan);
	const fact = (k, v) => `<div class="fact"><dt>${k}</dt><dd>${v}</dd></div>`;
	const on = (yes, a, b) => `<span class="pill ${yes ? 'on' : 'off'}">${yes ? a : b}</span>`;
	const suggest = ed.suggestedRoots.length && ed.suggestedRoots.join('\n') !== ed.roots.join('\n')
		? `<button class="btn-copy" type="button" data-fill-roots="${esc(ed.suggestedRoots.join('\n'))}">ใช้โฟลเดอร์ที่ Worklog หาเจอ</button>` : '';
	const radio = (name, value, text, checked) =>
		`<label class="choice"><input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}><span>${esc(text)}</span></label>`;

	app.innerHTML = `<div class="page">
		<header class="page-head"><h1>ตั้งค่า</h1><p>${canSave
			? 'แก้แล้วกดบันทึกที่ท้ายหน้า ค่าทั้งหมดเก็บไว้ในไฟล์ config.local.json ในเครื่องนี้'
			: 'Worklog ที่เปิดอยู่นี้แก้ค่าไม่ได้ ให้เปิดจาก shortcut ของ Worklog แทน'}</p></header>
		<form class="settings" id="settings" novalidate>
		${box('โปรเจค', `<div class="fields">
			${field('roots', 'โฟลเดอร์ที่เก็บโปรเจค', `<textarea class="input mono-input" id="roots" name="roots" rows="3" spellcheck="false">${esc(ed.roots.join('\n'))}</textarea>${suggest}`,
				'ใส่บรรทัดละหนึ่งโฟลเดอร์ โฟลเดอร์ย่อยข้างในแต่ละอันนับเป็นหนึ่งโปรเจค ถ้าเว้นว่าง แต่ละ session จะจัดกลุ่มตามโฟลเดอร์ที่ทำงาน')}
			${field('exclude', 'โฟลเดอร์ที่ไม่นับ', `<textarea class="input mono-input" id="exclude" name="exclude" rows="2" spellcheck="false">${esc(ed.exclude.join('\n'))}</textarea>`,
				'session ที่ทำงานในโฟลเดอร์เหล่านี้จะไม่แสดงใน Worklog')}
		</div>`)}
		${box('ชื่อบัญชี', ed.accounts.length ? `<div class="fields">${ed.accounts.map(a => field(`acct-${esc(a.uuid)}`,
			`รหัส ${esc(a.uuid.slice(0, 8))} <span class="guess">(${a.sessions} session)</span>`,
			`<input class="input" id="acct-${esc(a.uuid)}" data-account="${esc(a.uuid)}" maxlength="40" value="${esc(a.label)}">`)).join('')}</div>`
			: '<p class="empty">ยังไม่พบบัญชี Claude ใน log</p>')}
		${box('สรุปด้วย AI', `<div class="fields">
			<label class="switch"><input type="checkbox" name="summaryEnabled" ${ed.summary.enabled ? 'checked' : ''}><span class="switch-track" aria-hidden="true"></span><span>สรุปงานด้วย AI</span></label>
			<p class="field-help">ใช้โควต้าของบัญชี Claude ที่ claude CLI login อยู่ ${summaryRunning || !ed.summary.enabled ? '' : 'ถ้าเพิ่งเปิด การสรุปจะเริ่มเมื่อปิดหน้าต่าง Worklog แล้วเปิดใหม่'}</p>
			<fieldset class="choices"><legend class="field-label">โมเดล</legend>
				${Object.entries(SUMMARY_MODEL).map(([v, t]) => radio('model', v, t, ed.summary.model === v)).join('')}</fieldset>
			${field('autoDays', 'สรุปเองเฉพาะงานที่มีข้อความใหม่ในกี่วันล่าสุด', `<span class="unit"><input class="input input-num" id="autoDays" name="autoDays" type="number" min="1" max="60" step="1" value="${ed.summary.autoDays}"> วัน</span>`,
				'งานที่เก่ากว่านี้จะสรุปเมื่อคุณกดปุ่มสรุปในหน้าโปรเจคเท่านั้น')}
		</div>`)}
		${box('งานทับซ้อน', `<div class="fields">
			${field('windowMinutes', 'นับว่าทับกันเมื่อสอง session แก้ไฟล์เดียวกันห่างกันไม่เกิน', `<span class="unit"><input class="input input-num" id="windowMinutes" name="windowMinutes" type="number" min="5" max="240" step="1" value="${ed.overlap.windowMinutes}"> นาที</span>`)}
			<fieldset class="choices"><legend class="field-label">เมื่อ Claude กำลังจะแก้ไฟล์ที่อีก session เพิ่งแก้</legend>
				${Object.entries(OVERLAP_MODE).map(([v, t]) => radio('preToolUse', v, t, ed.overlap.preToolUse === v)).join('')}</fieldset>
			<p class="field-help">hook ของ Worklog ${on(st.hooksInstalled > 0, 'ติดตั้งแล้ว', 'ยังไม่ได้ติดตั้ง')}</p>
		</div>`)}
		<div class="save-bar">
			<button class="btn-save" type="submit" ${canSave ? '' : 'disabled'}>บันทึก</button>
			<p class="save-status" id="save-status" role="status"></p>
		</div>
		</form>
		${box('หน้าต่าง Worklog', windowSetting(appInstalled))}
		${box('ที่อยู่ข้อมูล', `<dl class="facts">
			${fact('ข้อมูลของ Claude Code', `<span class="mono">${esc(st.sources.claude)}</span>`)}
			${fact('ข้อมูลของ Codex', `<span class="mono">${esc(st.sources.codex)}</span>`)}
			${fact('ที่เก็บข้อมูลของ Worklog', `<span class="mono">${esc(st.dataDir)}</span>`)}
		</dl>`)}
	</div>`;
}

app.addEventListener('submit', async event => {
	const form = event.target.closest('#settings');
	if (!form) return;
	event.preventDefault();
	const status = form.querySelector('#save-status');
	const save = form.querySelector('.btn-save');
	const el = form.elements;
	const body = {
		roots: lines(el.roots.value),
		exclude: lines(el.exclude.value),
		accounts: Object.fromEntries([...form.querySelectorAll('[data-account]')].map(i => [i.dataset.account, i.value])),
		summary: { enabled: el.summaryEnabled.checked, model: el.model.value, autoDays: Number(el.autoDays.value) },
		overlap: { windowMinutes: Number(el.windowMinutes.value), preToolUse: el.preToolUse.value },
	};
	status.className = 'save-status';
	status.textContent = 'กำลังบันทึก';
	save.disabled = true;
	let res;
	try {
		res = await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
		const data = await res.json();
		if (!res.ok) {
			status.className = 'save-status is-error';
			status.textContent = data.field ? data.error : 'บันทึกไม่สำเร็จ';
			const target = { roots: el.roots, exclude: el.exclude, autoDays: el.autoDays, windowMinutes: el.windowMinutes }[data.field];
			target?.focus();
			return;
		}
		await route({ quiet: true });
		const after = document.getElementById('save-status');
		if (after) {
			after.className = 'save-status is-ok';
			after.textContent = data.regrouped ? 'บันทึกแล้ว และจัดกลุ่มโปรเจคใหม่แล้ว' : 'บันทึกแล้ว';
		}
	}
	catch {
		status.className = 'save-status is-error';
		status.textContent = 'บันทึกไม่สำเร็จ';
	}
	finally {
		save.disabled = false;
	}
});

app.addEventListener('click', event => {
	const fill = event.target.closest('[data-fill-roots]');
	if (!fill) return;
	const roots = document.getElementById('roots');
	roots.value = fill.dataset.fillRoots;
	roots.focus();
});

// Project and session detail

function timeline(sessions) {
	const end = Date.now();
	const DAY = 86400000;
	const inRange = sessions.filter(s => s.last_ts && toMs(s.last_ts) >= end - TIMELINE_DAYS * DAY);
	if (!inRange.length) return `<p class="empty">ไม่มี session ใน ${TIMELINE_DAYS} วันที่ผ่านมา</p>`;
	const earliest = Math.min(...inRange.map(s => toMs(s.first_ts ?? s.last_ts)));
	const days = Math.min(TIMELINE_DAYS, Math.max(3, Math.ceil((end - earliest) / DAY) + 1));
	const start = end - days * DAY;
	const range = end - start;
	const laneOf = s => (s.is_automated ? 'auto' : s.account_uuid ?? 'none');
	const laneKeys = [...new Set(inRange.map(laneOf))].sort((a, b) => (accountIndex.get(a)?.color ?? 9) - (accountIndex.get(b)?.color ?? 9));
	const laneLabel = key => {
		if (key === 'auto') return '<span class="acct-dot"></span>งานอัตโนมัติ';
		const acct = accountIndex.get(key);
		return acct ? `<span class="acct-dot ${accountPaint(key)}"></span>${esc(accountName(acct))}` : '<span class="acct-dot"></span>ไม่ทราบบัญชี';
	};
	const lanes = laneKeys.map(key => {
		let lane = inRange.filter(s => laneOf(s) === key)
			.map(s => ({ s, from: Math.max(toMs(s.first_ts), start), to: toMs(s.last_ts), runs: 1 }));
		// Automated runs come in bursts; ones closer than a segment is wide read as one piece.
		if (key === 'auto') {
			// Wide enough to cover the 14px minimum width of a segment on a typical track.
			const touch = range * 0.03;
			lane = lane.sort((a, b) => a.from - b.from).reduce((out, seg) => {
				const last = out.at(-1);
				if (last && seg.from <= last.to + touch) { last.to = Math.max(last.to, seg.to); last.runs += 1; }
				else out.push({ ...seg });
				return out;
			}, []);
		}
		const segs = lane.map(({ s, from, to, runs }) => {
			const left = ((from - start) / range) * 100;
			const width = Math.max(((to - from) / range) * 100, 0.6);
			const tip = runs > 1
				? `งานอัตโนมัติ ${runs} ครั้ง (${formatDateTime(from)} ถึง ${formatTime(to)})`
				: `${s.title} (${formatDateTime(s.first_ts)} ถึง ${formatTime(s.last_ts)})`;
			return `<a class="seg ${accountPaint(s.account_uuid)} ${s.is_automated ? 'auto' : ''}" href="#/s/${encodeURIComponent(s.id)}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" title="${esc(tip)}" aria-label="${esc(tip)}"></a>`;
		}).join('');
		return `<div class="lane"><div class="lane-label">${laneLabel(key)}</div><div class="track">${segs}</div></div>`;
	}).join('');
	const ticks = [];
	for (let d = days; d >= 0; d -= days > 7 ? 2 : 1) {
		const t = end - d * DAY;
		ticks.push(`<span style="left:${(((t - start) / range) * 100).toFixed(2)}%">${d === 0 ? 'วันนี้' : new Date(t).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}</span>`);
	}
	return `${lanes}<div class="ticks"><span></span><div class="ticks-inner">${ticks.join('')}</div></div>`;
}

/** A path inside the project shows from the project folder; one outside shows its last two parts. */
function shortPath(file, base) {
	const f = file.replace(/\\/g, '/'), b = (base ?? '').replace(/\\/g, '/');
	if (b && f.toLowerCase().startsWith(b.toLowerCase() + '/')) return f.slice(b.length + 1);
	return f.split('/').slice(-2).join('/');
}

function fileRows(files, base) {
	if (!files.length) return '<p class="empty">ไม่มีการแก้ไฟล์ผ่านเครื่องมือแก้ไฟล์</p>';
	const row = f => `<div class="row"><span class="file-path" title="${esc(f.path)}">${esc(shortPath(f.path, base)).replace(/\//g, '/<wbr>')}</span>
		<span class="row-side">${esc(ago(f.last_ts))}${f.session_count > 1 ? `, ${f.session_count} session` : ''}</span></div>`;
	const first = files.slice(0, 8), rest = files.slice(8);
	return `<div class="rows files">${first.map(row).join('')}</div>
		${rest.length ? `<details class="files-more"><summary>ดูอีก ${rest.length} ไฟล์</summary><div class="rows files">${rest.map(row).join('')}</div></details>` : ''}`;
}

function sessionRow(s) {
	const headline = s.summary?.data?.headline;
	return `<a class="row ${accountPaint(s.account_uuid)}" href="#/s/${encodeURIComponent(s.id)}">
		${shape(s.summary?.data?.status, { small: true })}
		<span class="row-main"><span class="row-title">${esc(s.title)}</span>
			<span class="row-sub">${s.is_automated ? 'งานอัตโนมัติ' : END_STATE[s.end_state] ?? END_STATE.unknown}${headline ? `, ${esc(headline)}` : ''}</span></span>
		<span class="row-side">${esc(ago(s.last_ts))}<br>${accountChip(s.account_uuid, s.account_source)}</span></a>`;
}

async function renderProject(key) {
	const data = await api(`/api/projects/${encodeURIComponent(key)}`);
	useAccounts(data.accounts);
	const p = data.project;
	pollWhileBusy(!data.summarizer?.paused && (p.summary.busy || p.sessions.some(s => s.summary.busy)));
	app.innerHTML = `<div class="page">
		${backLink('#/projects', 'โปรเจคทั้งหมด')}
		<div class="page-cols">
			<div class="stack">
				<header class="page-head ${paint(p.name)}"><h1>${esc(p.name)}</h1><p class="mono">${esc(p.path)}</p>
					<p>${p.sessions.length} session ทำล่าสุด ${esc(ago(p.sessions[0]?.last_ts))}</p></header>
				${box('สถานะโปรเจค', summaryBody(p.summary, 'project', p.key, data.summarizer))}
				${box('ช่วงที่ทำงานล่าสุด', timeline(p.sessions))}
				${box('session ทั้งหมด', `<div class="rows">${p.sessions.map(sessionRow).join('')}</div>`)}
			</div>
			<div class="stack">${box('ไฟล์ที่แก้ล่าสุด', fileRows(p.files, p.path))}</div>
		</div>
	</div>`;
}

async function renderSession(id) {
	const data = await api(`/api/sessions/${encodeURIComponent(id)}`);
	useAccounts(data.accounts);
	const s = data.session;
	pollWhileBusy(s.summary.busy && !data.summarizer?.paused);
	const meta = [
		['เริ่ม', s.first_ts ? formatDateTime(s.first_ts) : '-'],
		['ทำล่าสุด', s.last_ts ? formatDateTime(s.last_ts) : '-'],
		['ใช้เวลาทั้งหมด', s.first_ts && s.last_ts ? spanText(toMs(s.last_ts) - toMs(s.first_ts)) : '-'],
		['รอบที่คุณสั่ง', String(s.human_turns)],
		['โมเดล', s.model ?? '-'],
		['branch', s.git_branch ?? '-'],
	];
	app.innerHTML = `<div class="page">
		${s.project_key ? backLink(`#/p/${encodeURIComponent(s.project_key)}`, s.project_name ?? 'โปรเจค') : backLink('#/', 'วันนี้')}
		<div class="page-cols">
			<div class="stack">
				<header class="page-head"><h1>${esc(s.title)}</h1>
					<p>${s.is_automated ? 'งานอัตโนมัติ' : END_STATE[s.end_state] ?? END_STATE.unknown} ${accountChip(s.account_uuid, s.account_source)}</p></header>
				${box('สรุป session นี้', summaryBody(s.summary, 'session', s.id, data.summarizer))}
				${box('ที่คุณสั่งล่าสุด', `${s.last_human_ts ? `<p class="quote-when">${esc(formatDateTime(s.last_human_ts))}</p>` : ''}<div class="quote">${esc(s.last_human_text ?? s.last_prompt ?? 'ไม่มีข้อความที่คุณพิมพ์ใน session นี้')}</div>`)}
				${box(`${s.tool === 'codex' ? 'Codex' : 'Claude'} ตอบล่าสุด`, `${s.last_assistant_ts ? `<p class="quote-when">${esc(formatDateTime(s.last_assistant_ts))}</p>` : ''}<div class="quote">${esc(s.last_assistant_text ?? 'ไม่มีคำตอบที่เป็นข้อความ')}</div>`)}
			</div>
			<div class="stack">
				${box('กลับไปทำต่อ', continueBlock(s.continue))}
				${box('ข้อมูล session', `<dl class="meta-grid">${meta.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
					${s.cwd ? `<p class="mono" style="margin-top:12px">${esc(s.cwd)}</p>` : ''}
					${s.pr_url ? `<p style="margin-top:8px"><a class="mono" href="${esc(s.pr_url)}" target="_blank" rel="noopener">${esc(s.pr_url)}</a></p>` : ''}`)}
				${box('ไฟล์ที่แก้', fileRows(s.files, s.cwd))}
			</div>
		</div>
	</div>`;
}

// Routing

const PAGES = { '/': 'today', '/projects': 'projects', '/accounts': 'accounts', '/settings': 'settings' };

async function route({ quiet = false } = {}) {
	const hash = location.hash.replace(/^#/, '') || '/';
	const [, kind, rawId] = hash.match(/^\/(p|s)\/(.+)$/) ?? [];
	const page = PAGES[hash] ?? (kind === 's' || kind === 'p' ? 'projects' : 'today');
	for (const link of document.querySelectorAll('.nav')) {
		if (link.dataset.page === page) link.setAttribute('aria-current', 'page');
		else link.removeAttribute('aria-current');
	}
	clearTimeout(pollTimer);
	const scrollY = window.scrollY;
	animateBars = !quiet;
	if (!quiet) loading(page === 'projects' && !kind ? 'single' : 'cols');
	try {
		if (kind === 'p') await renderProject(decodeURIComponent(rawId));
		else if (kind === 's') await renderSession(decodeURIComponent(rawId));
		else if (page === 'projects') await renderProjects();
		else if (page === 'accounts') await renderAccounts();
		else if (page === 'settings') await renderSettings();
		else await renderToday();
		if (animateBars) releaseBars();
	}
	catch (error) {
		if (!quiet) failed(error);
	}
	window.scrollTo(0, quiet ? scrollY : 0);
}

app.addEventListener('click', async event => {
	const trigger = event.target.closest('[data-summarize]');
	if (trigger) {
		const { summarize: kind, ref } = trigger.dataset;
		trigger.disabled = true;
		trigger.textContent = 'กำลังสรุป';
		const base = kind === 'project' ? '/api/projects/' : '/api/sessions/';
		try { await api(`${base}${encodeURIComponent(ref)}/summarize`, { method: 'POST' }); }
		catch { trigger.textContent = 'สั่งสรุปไม่สำเร็จ'; return; }
		await route({ quiet: true });
		return;
	}
	const unmark = event.target.closest('[data-unmark]');
	if (unmark) {
		unmark.disabled = true;
		try { await api(`/api/accounts/${encodeURIComponent(unmark.dataset.unmark)}/limit`, { method: 'DELETE' }); }
		catch { unmark.disabled = false; unmark.textContent = 'ล้างไม่สำเร็จ'; return; }
		await route({ quiet: true });
		return;
	}
	const button = event.target.closest('[data-copy]');
	if (!button) return;
	button.dataset.label ??= button.textContent;
	try {
		await navigator.clipboard.writeText(button.dataset.copy);
		button.textContent = 'คัดลอกแล้ว';
	}
	catch {
		button.textContent = 'คัดลอกไม่ได้';
	}
	setTimeout(() => { button.textContent = button.dataset.label; }, 1500);
});

rescanBtn.addEventListener('click', async () => {
	rescanBtn.disabled = true;
	rescanBtn.textContent = 'กำลังอ่าน';
	try {
		const { scan } = await api('/api/scan', { method: 'POST' });
		showScan(scan);
		await route({ quiet: true });
	}
	catch {
		scanMeta.textContent = 'อ่าน log ไม่สำเร็จ';
	}
	finally {
		rescanBtn.disabled = false;
		rescanBtn.textContent = 'อ่าน log ใหม่';
	}
});

/** Gives the app window's title bar the page's ground colour, including a theme picked with the button. */
function syncTitleBar() {
	const ground = getComputedStyle(document.documentElement).getPropertyValue('--ground').trim();
	if (ground) for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.content = ground;
}

themeBtn.addEventListener('click', () => {
	const root = document.documentElement;
	const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
	root.dataset.theme = dark ? 'light' : 'dark';
	try { localStorage.setItem('worklog-theme', root.dataset.theme); } catch {}
	syncTitleBar();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncTitleBar);
syncTitleBar();

// Installing Worklog as an app gives its window a title bar in the page's
// colour. Edge offers the install once the page qualifies; the offer is kept
// for the button on the settings page.
let installOffer = null;
window.addEventListener('beforeinstallprompt', event => {
	event.preventDefault();
	installOffer = event;
	if (location.hash === '#/settings') route({ quiet: true });
});
window.addEventListener('appinstalled', () => {
	installOffer = null;
	if (location.hash === '#/settings') route({ quiet: true });
});

window.addEventListener('hashchange', () => route());
route();

// Tells the server this page is open. When Worklog runs as an app it stops
// once no page has been open for a few seconds. EventSource reconnects on its own.
if ('EventSource' in window) new EventSource('/api/alive');
