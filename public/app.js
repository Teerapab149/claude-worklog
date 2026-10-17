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
// What went wrong with a summary and what to do about it, by kind of error
// and by what does the summarizing. Every fix is a click in Worklog; none
// asks for a terminal or a file.
const SUMMARY_TROUBLE = {
	claude: {
		auth: 'claude CLI ยังไม่ได้เข้าสู่ระบบ หรือการเข้าสู่ระบบหมดอายุ ไปที่หน้าตั้งค่าแล้วกดเข้าสู่ระบบ Claude หรือเปลี่ยนไปสรุปด้วย API',
		rate_limit: 'บัญชี Claude ที่ใช้สรุปติด limit อยู่ Worklog จะลองใหม่เอง',
		missing_cli: 'ไม่พบ claude CLI ในเครื่องนี้ ไปที่หน้าตั้งค่าเพื่อเปลี่ยนไปสรุปด้วย API เช่น Gemini ซึ่งมีแบบใช้ฟรี',
	},
	api: {
		auth: 'API ไม่รับ key ที่ใส่ไว้ ไปที่หน้าตั้งค่าเพื่อใส่ key ใหม่แล้วกดทดสอบ',
		rate_limit: 'API ที่ใช้สรุปให้รอก่อน เพราะเรียกถี่หรือใช้เกินโควต้า Worklog จะลองใหม่เอง',
	},
	any: {
		never_send: 'โฟลเดอร์นี้ตั้งไว้ในหน้าตั้งค่าว่าห้ามส่งให้ AI จึงไม่ได้สรุป',
		local_only: 'เปิดโหมดสรุปด้วยโปรแกรมในเครื่องเท่านั้นไว้ จึงไม่ส่งออกไปสรุปนอกเครื่อง เลือก Ollama หรือ LM Studio ในหน้าตั้งค่า หรือปิดโหมดนี้',
		timeout: 'AI ใช้เวลานานเกินไป กดสรุปใหม่ได้ ถ้ายังเป็นอยู่ ลองโมเดลที่เร็วกว่าในหน้าตั้งค่า',
		bad_output: 'AI ตอบกลับมาในรูปแบบที่อ่านไม่ได้ กดสรุปใหม่ได้ ถ้ายังเป็นอยู่ ลองเปลี่ยนโมเดลในหน้าตั้งค่า',
		failed: 'สรุปไม่สำเร็จ กดสรุปใหม่ได้ ถ้ายังเป็นอยู่ ดูรายละเอียดด้านล่างหรือตรวจในหน้าตั้งค่า',
	},
};
const troubleText = (kind, provider) => SUMMARY_TROUBLE[provider === 'api' ? 'api' : 'claude'][kind] ?? SUMMARY_TROUBLE.any[kind] ?? SUMMARY_TROUBLE.any.failed;
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
	const data = await res.json();
	// The overview and settings say whether the settings file could be read.
	if (data && 'warning' in data) setNotice('config', data.warning);
	return data;
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
	// The 5-hour window guessed from when the account was used, for accounts with no real reading.
	const w = acct.window5h && !acct.limited
		? `<p class="rod-meta">รอบ 5 ชั่วโมงนี้เริ่มราว ${esc(formatTime(acct.window5h.startedAt))} รีเซ็ตราว ${esc(formatTime(acct.window5h.resetsAt))} (ประมาณจากเวลาที่ใช้)</p>` : '';
	// One tap when the Claude app says the 5-hour limit is reached; weekly limits are marked on the accounts page.
	const quick = !detail && acct.tool === 'claude' && !acct.limited
		? `<div class="rod-quick"><button class="btn-copy" type="button" data-quick-limit="${esc(acct.uuid)}" data-resets="${acct.window5h?.resetsAt ?? ''}">ติด limit 5 ชั่วโมง</button>
			<a class="rod-meta" href="#/accounts">ติดรายสัปดาห์</a></div>` : '';
	return `<div class="rod ${accountPaint(acct.uuid)}">
		<div class="rod-head"><span class="rod-name">${esc(accountName(acct))}</span><span class="rod-state ${u.state}">${esc(u.text)}</span></div>
		${u.tubes.map(tube).join('')}${none}${w}
		${detail ? `<p class="rod-meta">${acct.sessions} session, ใช้ล่าสุด ${esc(ago(acct.last_ts))}</p>` : ''}
		${detail && acct.tool === 'claude' ? markForm(acct) : quick}
	</div>`;
}

app.addEventListener('click', async event => {
	const button = event.target.closest('[data-quick-limit]');
	if (!button) return;
	button.disabled = true;
	// Without an estimate the window is taken to end five hours from now.
	const resetsAt = Number(button.dataset.resets) > Date.now() ? Number(button.dataset.resets) : Date.now() + 5 * 3600 * 1000;
	try {
		await api(`/api/accounts/${encodeURIComponent(button.dataset.quickLimit)}/limit`, { method: 'POST', body: { window: 'five_hour', resets_at: resetsAt } });
		await route({ quiet: true });
	}
	catch {
		button.disabled = false;
		button.textContent = 'บันทึกไม่สำเร็จ';
	}
});

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
	if (anyBusy) pollTimer = setTimeout(() => route({ quiet: true, auto: true }), 3000);
}

function pausedNote(summarizer) {
	const p = summarizer?.paused;
	if (!p) return '';
	return `<div class="paused"><p>สรุปด้วย AI หยุดไว้ก่อน ${esc(troubleText(p.kind, summarizer.provider))} <a href="#/settings">ไปที่หน้าตั้งค่า</a></p>
		${p.message ? `<details class="trouble-detail"><summary>รายละเอียด</summary><p>${esc(p.message)}</p></details>` : ''}</div>`;
}

/** Why the last summary of this one failed and what to do, with the raw message tucked away. */
function failedNote(summary, summarizer) {
	if (!summary?.error || summarizer?.paused) return '';
	return `<div class="paused"><p>${esc(troubleText(summary.error_kind, summarizer?.provider))}</p>
		<details class="trouble-detail"><summary>รายละเอียด</summary><p>${esc(summary.error)}</p></details></div>`;
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
		${busy ? '' : failedNote(summary, summarizer)}
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
	scanMeta.textContent = scan.error || scan.stats?.failed
		? 'อ่าน log บางส่วนไม่ได้ ดูที่หน้าตั้งค่า'
		: `อ่าน log ล่าสุดเมื่อ ${formatTime(scan.at)}`;
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

/** Why the list is empty: nothing read yet, no logs at all, or really nothing left to do. */
function emptyToday(data) {
	if (!data.scan) return 'กำลังอ่าน log ครั้งแรก รอสักครู่';
	if (!data.scan.stats?.files) return 'ยังไม่เจอ log ของ Claude Code หรือ Codex ในเครื่องนี้ ลองใช้ Claude Code หรือ Codex ทำงานสักครั้ง แล้วงานจะขึ้นที่นี่ แชทธรรมดาในแอป Claude ไม่ถูกนับ';
	if (!data.projects?.length) return 'อ่าน log แล้วแต่ยังไม่มีงาน ลองตรวจโฟลเดอร์ที่ไม่นับในหน้าตั้งค่า';
	return 'ไม่มีงานค้าง ทุกโปรเจคเสร็จหรือเลิกทำแล้ว งานใหม่จะขึ้นที่นี่เมื่อเริ่มทำ';
}

async function renderToday() {
	const data = await api('/api/overview');
	// A fresh install asks a few things before anything is sent anywhere.
	if (data.setup) {
		location.hash = '#/setup';
		return;
	}
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
				: `<p class="empty">${emptyToday(data)}</p>`)}
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

// The API part of the summary settings. Presets and which ones have a saved
// key come from the server; the keys themselves never do.
let apiPresets = {};
let keyHints = {};

function keyPlaceholder(preset) {
	if (keyHints[preset]) return `บันทึกไว้แล้ว ลงท้าย ${keyHints[preset]} เว้นว่างไว้เพื่อใช้ key เดิม`;
	return apiPresets[preset]?.needsKey ? 'วาง API key ที่นี่' : 'ไม่ต้องใส่ก็ได้';
}

function keyHelp(preset) {
	const p = apiPresets[preset];
	if (!p) return '';
	if (preset === 'ollama') return 'ติดตั้ง Ollama แล้วโหลดโมเดลที่ต้องการไว้ก่อน ทุกอย่างอยู่ในเครื่องนี้ ไม่มีอะไรส่งออกไป';
	if (preset === 'lmstudio') return 'เปิด LM Studio โหลดโมเดล แล้วเปิด Local Server ไว้ ทุกอย่างอยู่ในเครื่องนี้ ไม่มีอะไรส่งออกไป';
	if (preset === 'azure') return 'เปลี่ยนชื่อ resource ในที่อยู่ API เป็นของคุณ และใส่ชื่อ deployment เป็นชื่อโมเดล key เก็บไว้ในเครื่องนี้เท่านั้น';
	return p.keyUrl ? `ขอ key ได้ที่ <a href="${esc(p.keyUrl)}" target="_blank" rel="noopener noreferrer">${esc(new URL(p.keyUrl).host)}</a> key เก็บไว้ในเครื่องนี้เท่านั้น` : 'key เก็บไว้ในเครื่องนี้เท่านั้น';
}

function apiFields(summary) {
	apiPresets = summary.presets;
	keyHints = summary.keyHints ?? {};
	const a = summary.api;
	return `
		${field('apiPreset', 'ผู้ให้บริการ', `<select class="input input-select" id="apiPreset" name="apiPreset">
			${Object.entries(apiPresets).map(([v, p]) => `<option value="${v}" ${a.preset === v ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select>`)}
		${field('apiBaseUrl', 'ที่อยู่ API', `<input class="input mono-input" id="apiBaseUrl" name="apiBaseUrl" spellcheck="false" value="${esc(a.baseUrl)}">`)}
		${field('apiModel', 'โมเดล', `<input class="input mono-input" id="apiModel" name="apiModel" list="apiModels" spellcheck="false" value="${esc(a.model)}"><datalist id="apiModels"></datalist>`,
			'กดทดสอบแล้วจะมีรายชื่อโมเดลที่ใช้ได้ให้เลือก')}
		${field('apiKey', 'API key', `<input class="input mono-input" id="apiKey" name="apiKey" type="password" autocomplete="off" spellcheck="false" placeholder="${esc(keyPlaceholder(a.preset))}">`,
			`<span id="keyHelp">${keyHelp(a.preset)}</span>`)}
		<div class="mark-actions">
			<button class="btn-copy" type="button" data-test-api>ทดสอบ</button>
			<button class="btn-copy" type="button" data-clear-key ${keyHints[a.preset] ? '' : 'hidden'}>ลบ key ที่บันทึกไว้</button>
			<span class="save-status" id="api-status" role="status"></span>
		</div>`;
}

/** The API fields as the server expects them, for saving and for testing. */
function apiBody(form) {
	const el = form.elements;
	return { preset: el.apiPreset.value, baseUrl: el.apiBaseUrl.value, model: el.apiModel.value, apiKey: el.apiKey.value };
}

app.addEventListener('change', event => {
	const form = event.target.closest('#settings');
	if (!form) return;
	if (event.target.name === 'provider') {
		for (const pane of form.querySelectorAll('.provider-pane')) pane.hidden = pane.dataset.provider !== event.target.value;
	}
	if (event.target.name === 'apiPreset') {
		const preset = event.target.value, p = apiPresets[preset];
		const el = form.elements;
		if (preset !== 'custom') { el.apiBaseUrl.value = p.baseUrl; el.apiModel.value = p.model; }
		el.apiKey.value = '';
		el.apiKey.placeholder = keyPlaceholder(preset);
		form.querySelector('#keyHelp').innerHTML = keyHelp(preset);
		form.querySelector('[data-clear-key]').hidden = !keyHints[preset];
		form.querySelector('#apiModels').innerHTML = '';
		form.querySelector('#api-status').textContent = '';
	}
});

app.addEventListener('click', async event => {
	const test = event.target.closest('[data-test-api]');
	const clear = event.target.closest('[data-clear-key]');
	if (!test && !clear) return;
	const form = event.target.closest('#settings');
	const status = form.querySelector('#api-status');
	if (clear) {
		form.dataset.clearKey = form.elements.apiPreset.value;
		form.elements.apiKey.value = '';
		form.elements.apiKey.placeholder = 'จะลบ key เมื่อกดบันทึก';
		clear.hidden = true;
		return;
	}
	test.disabled = true;
	status.className = 'save-status';
	status.textContent = 'กำลังทดสอบ';
	try {
		const res = await fetch('/api/summary/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(apiBody(form)) });
		const data = await res.json();
		if (!res.ok) throw new Error(data.field ? data.error : 'ทดสอบไม่สำเร็จ');
		status.className = `save-status ${data.ok ? 'is-ok' : 'is-error'}`;
		status.textContent = data.ok ? `${data.message} กดบันทึกเพื่อใช้ค่านี้` : data.message;
		form.querySelector('#apiModels').innerHTML = data.models.slice(0, 200).map(m => `<option value="${esc(m)}">`).join('');
	}
	catch (error) {
		status.className = 'save-status is-error';
		status.textContent = error.message;
	}
	finally {
		test.disabled = false;
	}
});

/** Today's automatic summaries against the daily limit, in words. */
function usageLine(s) {
	if (!s?.today) return 'เมื่อถึงเพดาน Worklog จะหยุดสรุปเองจนถึงพรุ่งนี้ แต่ยังกดสรุปเองได้เสมอ';
	const calls = s.today.calls ?? 0, tokens = s.today.tokens ?? 0;
	const tokenText = tokens ? ` ใช้ไปราว ${tokens.toLocaleString('th-TH')} token` : '';
	return `วันนี้สรุปไปแล้ว ${calls} ครั้ง${tokenText}${s.capped ? ' ถึงเพดานแล้ว จะสรุปเองต่อพรุ่งนี้ แต่ยังกดสรุปเองได้' : ''}`;
}

const PLAN_NAME = { pro: 'Pro', max: 'Max', team: 'Team', enterprise: 'Enterprise', free: 'Free' };

/** Asks the server whether the claude CLI is there and signed in, and says so under the Claude choice. */
async function checkClaude() {
	const line = document.getElementById('claude-status');
	if (!line) return;
	line.className = 'save-status';
	line.textContent = 'กำลังตรวจ claude CLI';
	let s;
	try { s = await api('/api/summary/claude-status', { method: 'POST' }); }
	catch { s = { found: true, loggedIn: false, error: 'ตรวจไม่สำเร็จ' }; }
	const now = document.getElementById('claude-status');
	if (!now) return;
	if (s.loggedIn) {
		now.className = 'save-status is-ok';
		now.textContent = `login แล้วด้วย ${s.email ?? 'บัญชี Claude'}${s.plan ? ` (แผน ${PLAN_NAME[s.plan] ?? s.plan})` : ''} การสรุปจะใช้โควต้าของบัญชีนี้`;
	}
	else {
		now.className = 'save-status is-error';
		now.textContent = !s.found
			? 'ไม่พบ claude CLI ในเครื่องนี้ เลือกสรุปด้วย API แทนได้ เช่น Gemini ซึ่งมีแบบใช้ฟรี'
			: `claude CLI ยังไม่ได้เข้าสู่ระบบ กดเข้าสู่ระบบ Claude แล้วทำตามขั้นตอนในเบราว์เซอร์ เสร็จแล้วกดตรวจอีกครั้ง${s.error ? ` (${s.error})` : ''}`;
	}
	const login = document.querySelector('[data-claude-login]');
	if (login) login.hidden = s.loggedIn || !s.found;
	return s;
}

app.addEventListener('click', async event => {
	if (event.target.closest('[data-claude-check]')) checkClaude();
	const login = event.target.closest('[data-claude-login]');
	if (!login) return;
	login.disabled = true;
	try {
		const { started } = await api('/api/summary/claude-login', { method: 'POST' });
		document.getElementById('claude-status').textContent = started
			? 'เปิดหน้าต่างเข้าสู่ระบบแล้ว ทำตามขั้นตอนในเบราว์เซอร์ เสร็จแล้วกดตรวจอีกครั้ง'
			: 'เปิดหน้าต่างเข้าสู่ระบบไม่ได้';
	}
	catch { /* the status line already explains */ }
	finally { login.disabled = false; }
});

function updateText(version, u) {
	if (u.last && !u.last.ok) return `อัปเดตเป็นเวอร์ชัน ${u.last.version} ไม่สำเร็จ ตอนนี้ยังเป็น ${version} กดติดตั้งตอนนี้เพื่อลองอีกครั้งแบบเห็นความคืบหน้า`;
	if (u.status === 'ready') {
		return u.auto
			? `เวอร์ชัน ${u.latest} ดาวน์โหลดไว้แล้ว จะติดตั้งเองหลังจากปิดหน้าต่าง Worklog หรือกดติดตั้งตอนนี้`
			: `มีเวอร์ชัน ${u.latest} ดาวน์โหลดไว้แล้ว กดติดตั้งตอนนี้เมื่อพร้อม`;
	}
	if (u.last?.ok && u.last.version === version && u.status !== 'error') return `อัปเดตเป็นเวอร์ชัน ${version} เรียบร้อยแล้ว`;
	if (!u.auto) return `เวอร์ชัน ${version} ปิดการอัปเดตเองไว้ กดตรวจตอนนี้เพื่อดูว่ามีเวอร์ชันใหม่ไหม`;
	if (u.status === 'downloading') return `กำลังดาวน์โหลดเวอร์ชัน ${u.latest}`;
	if (u.status === 'checking' || u.status === 'idle') return `เวอร์ชัน ${version} กำลังตรวจหาเวอร์ชันใหม่`;
	if (u.status === 'error') return `เวอร์ชัน ${version} ตรวจหาเวอร์ชันใหม่ไม่สำเร็จ ${u.error ?? ''}`.trim();
	return `เวอร์ชัน ${version} เป็นเวอร์ชันล่าสุดแล้ว${u.checkedAt ? ` ตรวจเมื่อ ${formatTime(u.checkedAt)}` : ''}`;
}

app.addEventListener('click', async event => {
	const button = event.target.closest('[data-hooks]');
	if (!button) return;
	button.disabled = true;
	let message;
	try { message = (await api('/api/hooks', { method: 'POST', body: { action: button.dataset.hooks } })).hooks.message; }
	catch { message = 'ทำไม่สำเร็จ'; }
	await route({ quiet: true });
	const status = document.getElementById('hooks-status');
	if (status) status.textContent = message;
});

app.addEventListener('click', async event => {
	const install = event.target.closest('[data-update-install]');
	if (!install) return;
	install.disabled = true;
	install.textContent = 'กำลังปิดเพื่อติดตั้ง';
	try {
		await api('/api/update/install', { method: 'POST' });
		install.closest('.how-row').querySelector('p').textContent = 'Worklog จะปิดหน้าต่างนี้ ติดตั้งเวอร์ชันใหม่ แล้วเปิดขึ้นมาเอง';
	}
	catch {
		install.disabled = false;
		install.textContent = 'ติดตั้งไม่สำเร็จ';
	}
});

app.addEventListener('click', async event => {
	const button = event.target.closest('[data-update-check]');
	if (!button) return;
	button.disabled = true;
	button.textContent = 'กำลังตรวจ';
	try { await api('/api/update/check', { method: 'POST' }); }
	catch { button.textContent = 'ตรวจไม่สำเร็จ'; return; }
	await route({ quiet: true });
});

/** installed comes from the server, which looks in the window's profile; null when not opened from the shortcut. */
/** What the last scan read, and which files it could not, in words. */
function scanFact(scan) {
	if (!scan) return 'ยังไม่ได้อ่าน';
	if (scan.error) return `อ่านไม่สำเร็จ ${esc(scan.error)} กดอ่าน log ใหม่ที่แถบด้านข้างเพื่อลองอีกครั้ง`;
	const st = scan.stats;
	const head = `เมื่อ ${esc(formatTime(scan.at))} อ่าน ${st.files} ไฟล์ ใช้เวลา ${(scan.ms / 1000).toFixed(1)} วินาที`;
	if (!st.failed) return head;
	return `${head}<br>อ่านไม่ได้ ${st.failed} ไฟล์ อาจเป็นเพราะเครื่องมือเปลี่ยนรูปแบบ log หรือไฟล์ถูกล็อกอยู่ ไฟล์อื่นอ่านได้ปกติ
		<details class="trouble-detail"><summary>รายละเอียด</summary>${(st.errors ?? []).map(e => `<p><span class="mono">${esc(e.file)}</span> ${esc(e.message)}</p>`).join('')}</details>`;
}

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
	const { scan, settings: st, editable: ed, canSave, summaryRunning, summarizer, appInstalled, version, update } = await api('/api/settings');
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
			${summaryRunning || !ed.summary.enabled ? '' : '<p class="field-help">ถ้าเพิ่งเปิด การสรุปจะเริ่มเมื่อปิดหน้าต่าง Worklog แล้วเปิดใหม่</p>'}
			<fieldset class="choices"><legend class="field-label">ใช้อะไรสรุป</legend>
				${radio('provider', 'claude', 'Claude Code CLI ใช้โควต้าของบัญชี Claude ที่ login ไว้ในเครื่องนี้', ed.summary.provider === 'claude')}
				${radio('provider', 'api', 'API ของผู้ให้บริการ AI ด้วย key ของคุณเอง (Claude, OpenAI, Gemini, Groq และอื่นๆ) หรือโปรแกรมในเครื่องอย่าง Ollama', ed.summary.provider === 'api')}</fieldset>
			<div class="provider-pane fields" data-provider="claude" ${ed.summary.provider === 'claude' ? '' : 'hidden'}>
				<div class="how-row"><p class="save-status" id="claude-status" role="status">กำลังตรวจ claude CLI</p>
					<span class="mark-actions"><button class="btn-copy" type="button" data-claude-login hidden>เข้าสู่ระบบ Claude</button>
					<button class="btn-copy" type="button" data-claude-check>ตรวจอีกครั้ง</button></span></div>
				<fieldset class="choices"><legend class="field-label">โมเดล</legend>
					${Object.entries(SUMMARY_MODEL).map(([v, t]) => radio('model', v, t, ed.summary.model === v)).join('')}</fieldset>
			</div>
			<div class="provider-pane fields" data-provider="api" ${ed.summary.provider === 'api' ? '' : 'hidden'}>${apiFields(ed.summary)}</div>
			${field('autoDays', 'สรุปเองเฉพาะงานที่มีข้อความใหม่ในกี่วันล่าสุด', `<span class="unit"><input class="input input-num" id="autoDays" name="autoDays" type="number" min="1" max="60" step="1" value="${ed.summary.autoDays}"> วัน</span>`,
				'งานที่เก่ากว่านี้จะสรุปเมื่อคุณกดปุ่มสรุปในหน้าโปรเจคเท่านั้น')}
			${field('dailyLimit', 'สรุปเองได้ไม่เกินวันละ', `<span class="unit"><input class="input input-num" id="dailyLimit" name="dailyLimit" type="number" min="1" max="1000" step="1" value="${ed.summary.dailyLimit}"> ครั้ง</span>`,
				esc(usageLine(summarizer)))}
			${field('neverSend', 'โฟลเดอร์ที่ห้ามส่งให้ AI', `<textarea class="input mono-input" id="neverSend" name="neverSend" rows="2" spellcheck="false">${esc(ed.summary.neverSend.join('\n'))}</textarea>`,
				'บรรทัดละหนึ่งโฟลเดอร์ งานในโฟลเดอร์เหล่านี้จะไม่ถูกส่งให้ AI ไม่ว่าจะสรุปเองหรือกดสรุป เหมาะกับงานของลูกค้าหรืองานที่เป็นความลับ')}
			<label class="switch"><input type="checkbox" name="localOnly" ${ed.summary.localOnly ? 'checked' : ''}><span class="switch-track" aria-hidden="true"></span><span>สรุปด้วยโปรแกรมในเครื่องนี้เท่านั้น</span></label>
			<p class="field-help">เปิดไว้แล้ว Worklog จะไม่ส่งบทสนทนาออกนอกเครื่องเลย ใช้ได้กับ Ollama หรือ LM Studio ที่ติดตั้งไว้ในเครื่องนี้</p>
		</div>`)}
		${box('งานทับซ้อน', `<div class="fields">
			${field('windowMinutes', 'นับว่าทับกันเมื่อสอง session แก้ไฟล์เดียวกันห่างกันไม่เกิน', `<span class="unit"><input class="input input-num" id="windowMinutes" name="windowMinutes" type="number" min="5" max="240" step="1" value="${ed.overlap.windowMinutes}"> นาที</span>`)}
			<fieldset class="choices"><legend class="field-label">เมื่อ Claude กำลังจะแก้ไฟล์ที่อีก session เพิ่งแก้</legend>
				${Object.entries(OVERLAP_MODE).map(([v, t]) => radio('preToolUse', v, t, ed.overlap.preToolUse === v)).join('')}</fieldset>
			<div class="how-row"><p>hook ของ Worklog ใน Claude Code ${on(st.hooksInstalled > 0, 'ติดตั้งแล้ว', 'ยังไม่ได้ติดตั้ง')}
				<span class="field-help">ทำให้ Claude รู้ว่ามีอีก session แก้ไฟล์เดียวกันอยู่ และอ่านสรุปงานล่าสุดก่อนเริ่ม</span></p>
				<span class="mark-actions"><button class="btn-copy" type="button" data-hooks="${st.hooksInstalled > 0 ? 'uninstall' : 'install'}">${st.hooksInstalled > 0 ? 'เอา hook ออก' : 'ติดตั้ง hook'}</button>
				<span class="save-status" id="hooks-status" role="status"></span></span></div>
		</div>`)}
		${update ? box('อัปเดต', `<div class="fields">
			<label class="switch"><input type="checkbox" name="updatesAuto" ${update.auto ? 'checked' : ''}><span class="switch-track" aria-hidden="true"></span><span>อัปเดตเองเมื่อมีเวอร์ชันใหม่</span></label>
			<div class="how-row"><p>${esc(updateText(version, update))}</p>
				<span class="mark-actions">
					${update.status === 'ready' && update.canInstallNow ? '<button class="btn-copy" type="button" data-update-install>ติดตั้งตอนนี้</button>' : ''}
					<button class="btn-copy" type="button" data-update-check>ตรวจตอนนี้</button></span></div>
			<p class="field-help">Worklog ถาม GitHub ว่ามีเวอร์ชันใหม่ไหม ถ้ามีจะดาวน์โหลดไว้ แล้วติดตั้งเองหลังจากปิดหน้าต่าง ครั้งถัดไปที่เปิดจะเป็นเวอร์ชันใหม่ ค่าที่ตั้งไว้และข้อมูลยังอยู่ครบ</p>
		</div>`) : ''}
		<div class="save-bar">
			<button class="btn-save" type="submit" ${canSave ? '' : 'disabled'}>บันทึก</button>
			<p class="save-status" id="save-status" role="status"></p>
		</div>
		</form>
		${box('หน้าต่าง Worklog', windowSetting(appInstalled))}
		${box('ที่อยู่ข้อมูล', `<dl class="facts">
			${fact('อ่าน log ล่าสุด', scanFact(scan))}
			${fact('ข้อมูลของ Claude Code', `<span class="mono">${esc(st.sources.claude)}</span>`)}
			${fact('ข้อมูลของ Codex', `<span class="mono">${esc(st.sources.codex)}</span>`)}
			${fact('ที่เก็บข้อมูลของ Worklog', `<span class="mono">${esc(st.dataDir)}</span>`)}
		</dl>`)}
	</div>`;
	checkClaude();
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
		summary: {
			enabled: el.summaryEnabled.checked, model: el.model.value, autoDays: Number(el.autoDays.value), provider: el.provider.value,
			dailyLimit: Number(el.dailyLimit.value), neverSend: lines(el.neverSend.value), localOnly: el.localOnly.checked,
			...(el.provider.value === 'api' ? { api: { ...apiBody(form), clearKey: form.dataset.clearKey === el.apiPreset.value } } : {}),
		},
		overlap: { windowMinutes: Number(el.windowMinutes.value), preToolUse: el.preToolUse.value },
		...(el.updatesAuto ? { updates: { auto: el.updatesAuto.checked } } : {}),
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
			const target = { roots: el.roots, exclude: el.exclude, autoDays: el.autoDays, windowMinutes: el.windowMinutes,
				apiBaseUrl: el.apiBaseUrl, apiModel: el.apiModel, apiKey: el.apiKey, dailyLimit: el.dailyLimit, neverSend: el.neverSend }[data.field];
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

// First run

/**
 * The page a fresh install opens on. It shows what was found, then asks the
 * few things that cannot be guessed. Nothing is summarized, and so nothing is
 * sent anywhere, until the person presses เริ่มใช้งาน.
 */
async function renderSetup() {
	const { editable: ed, sources, scan } = await api('/api/setup');
	showScan(scan);
	const on = (yes, text) => `<span class="pill ${yes ? 'on' : 'off'}">${text}</span>`;
	const found = (name, src) => src.found
		? `${on(true, 'เจอแล้ว')} ${name} มีงาน ${src.sessions} session`
		: `${on(false, 'ไม่เจอ')} ไม่พบ log ของ ${name} ในเครื่องนี้`;
	const roots = (ed.roots.length ? ed.roots : ed.suggestedRoots).join('\n');
	const accountHelp = a => [
		a.lastTs ? `ใช้ล่าสุด ${ago(a.lastTs)}` : '',
		a.recentProjects?.length ? `กับ ${a.recentProjects.join(', ')}` : '',
	].filter(Boolean).join(' ');
	const choice = (value, title, help, checked) => `<label class="choice"><input type="radio" name="summaryChoice" value="${value}" ${checked ? 'checked' : ''}>
		<span><b class="choice-title">${esc(title)}</b><br><span class="field-help">${esc(help)}</span></span></label>`;

	app.innerHTML = `<div class="page">
		<header class="page-head"><h1>เริ่มใช้ Worklog</h1>
			<p>ตอบอีกไม่กี่ข้อแล้วเริ่มได้เลย ทุกอย่างแก้ภายหลังได้ในหน้าตั้งค่า</p></header>
		<form class="settings" id="setup" novalidate>
		${box('เจออะไรในเครื่องนี้', `<div class="fields">
			<p>${found('Claude Code', sources.claude)}</p>
			<p>${found('Codex', sources.codex)}</p>
			<p class="field-help">Worklog อ่านเฉพาะงานที่ทำใน Claude Code และ Codex ซึ่งเก็บ log ไว้ในเครื่องนี้ แชทธรรมดาในแอปหรือเว็บ Claude ไม่ถูกอ่าน และไม่มีอะไรส่งออกไปจนกว่าคุณจะเลือกวิธีสรุปด้านล่าง</p>
		</div>`)}
		${box('โฟลเดอร์โปรเจค', `<div class="fields">
			${field('roots', 'โฟลเดอร์ที่เก็บโปรเจค', `<textarea class="input mono-input" id="roots" name="roots" rows="3" spellcheck="false">${esc(roots)}</textarea>`,
				'Worklog เดาจากงานที่เคยทำ บรรทัดละหนึ่งโฟลเดอร์ โฟลเดอร์ย่อยข้างในแต่ละอันนับเป็นหนึ่งโปรเจค ถ้าไม่แน่ใจ ปล่อยไว้แบบนี้ได้')}
		</div>`)}
		${ed.accounts.length ? box('ตั้งชื่อบัญชี Claude', `<div class="fields">
			<p class="field-help">ตั้งชื่อที่จำง่าย เช่น บัญชีงาน หรือ บัญชีส่วนตัว ดูจากโปรเจคที่ใช้ล่าสุดว่าเป็นบัญชีไหน</p>
			${ed.accounts.map(a => field(`acct-${esc(a.uuid)}`, `รหัส ${esc(a.uuid.slice(0, 8))} <span class="guess">(${a.sessions} session)</span>`,
				`<input class="input" id="acct-${esc(a.uuid)}" data-account="${esc(a.uuid)}" maxlength="40" value="${esc(a.label)}">`, esc(accountHelp(a)))).join('')}
		</div>`) : ''}
		${box('สรุปงานด้วย AI', `<div class="fields">
			<p class="field-help">AI ช่วยอ่านบทสนทนาแล้วบอกว่างานไปถึงไหน ควรทำอะไรต่อ ไม่ใช้ก็ได้ ส่วนอื่นของ Worklog ทำงานได้ครบ</p>
			<fieldset class="choices"><legend class="field-label">ใช้อะไรสรุป</legend>
				${choice('claude', 'Claude Code CLI', 'ใช้โควต้าของบัญชี Claude ที่เข้าสู่ระบบไว้ในเครื่องนี้', true)}
				<div class="how-row choice-extra"><p class="save-status" id="claude-status" role="status">กำลังตรวจ claude CLI</p>
					<span class="mark-actions"><button class="btn-copy" type="button" data-claude-login hidden>เข้าสู่ระบบ Claude</button>
					<button class="btn-copy" type="button" data-claude-check>ตรวจอีกครั้ง</button></span></div>
				${choice('api', 'API ด้วย key ของคุณเอง', 'Claude API, OpenAI, Gemini (มีแบบใช้ฟรี), Groq หรือโปรแกรมในเครื่องอย่าง Ollama ตั้งค่า key ต่อในหน้าตั้งค่าหลังกดเริ่มใช้งาน', false)}
				${choice('off', 'ยังไม่ใช้', 'ไม่ส่งอะไรออกไปเลย เปิดภายหลังได้ในหน้าตั้งค่า', false)}
			</fieldset>
		</div>`)}
		${box('เตือนงานทับซ้อน', `<div class="fields">
			<label class="switch"><input type="checkbox" name="hooks" checked><span class="switch-track" aria-hidden="true"></span><span>ติดตั้ง hook ใน Claude Code</span></label>
			<p class="field-help">ให้ Claude รู้ตัวก่อนแก้ไฟล์ที่อีก session เพิ่งแก้ และอ่านสรุปงานล่าสุดของโปรเจคก่อนเริ่ม session ใหม่ เอาออกได้ในหน้าตั้งค่า</p>
		</div>`)}
		<div class="save-bar">
			<button class="btn-save" type="submit">เริ่มใช้งาน</button>
			<p class="save-status" id="save-status" role="status"></p>
		</div>
		</form>
	</div>`;
	const status = await checkClaude();
	// Without a signed-in CLI, the safe first choice is not to summarize at all.
	if (status && !status.loggedIn) {
		const off = app.querySelector('input[name="summaryChoice"][value="off"]');
		if (off) off.checked = true;
	}
}

app.addEventListener('submit', async event => {
	const form = event.target.closest('#setup');
	if (!form) return;
	event.preventDefault();
	const el = form.elements;
	const status = form.querySelector('#save-status');
	const choice = el.summaryChoice.value;
	const settings = {
		roots: lines(el.roots.value),
		accounts: Object.fromEntries([...form.querySelectorAll('[data-account]')].map(i => [i.dataset.account, i.value])),
		summary: { enabled: choice !== 'off', provider: choice === 'api' ? 'api' : 'claude' },
	};
	form.querySelector('.btn-save').disabled = true;
	status.className = 'save-status';
	status.textContent = 'กำลังบันทึก';
	try {
		const res = await fetch('/api/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settings, hooks: el.hooks.checked }) });
		const data = await res.json();
		if (!res.ok) {
			status.className = 'save-status is-error';
			status.textContent = data.field ? data.error : 'บันทึกไม่สำเร็จ';
			form.querySelector('.btn-save').disabled = false;
			if (data.field === 'roots') el.roots.focus();
			return;
		}
		// With an API the key comes next, on the settings page.
		location.hash = choice === 'api' ? '#/settings' : '#/';
	}
	catch {
		status.className = 'save-status is-error';
		status.textContent = 'บันทึกไม่สำเร็จ';
		form.querySelector('.btn-save').disabled = false;
	}
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

const PAGES = { '/': 'today', '/projects': 'projects', '/accounts': 'accounts', '/settings': 'settings', '/setup': 'setup' };

// Open disclosures are matched by their own label and the heading of the
// block around them, so a redraw can open the same ones again.
const disclosureKey = d => `${d.closest('article, section, .row, .rod')?.querySelector('h2, h3, .rod-name, .row-title')?.textContent ?? ''}|${d.querySelector('summary')?.textContent ?? ''}`;

/** True while the person is typing or choosing something on the page, which a redraw would wipe. */
function busyEditing() {
	const el = document.activeElement;
	return Boolean(el && app.contains(el) && el.matches('input, textarea, select'));
}

let lastRefresh = 0;

/**
 * auto marks a refresh nobody asked for (a log changed, a summary finished,
 * the window came back). Those wait while the person is typing, leave the
 * settings form alone, and keep open disclosures, focus and scroll as they were.
 */
async function route({ quiet = false, auto = false } = {}) {
	const hash = location.hash.replace(/^#/, '') || '/';
	const [, kind, rawId] = hash.match(/^\/(p|s)\/(.+)$/) ?? [];
	const page = PAGES[hash] ?? (kind === 's' || kind === 'p' ? 'projects' : 'today');
	if (auto && (page === 'settings' || page === 'setup' || busyEditing())) {
		if (page !== 'settings' && page !== 'setup') pollTimer = setTimeout(() => route({ quiet: true, auto: true }), 3000);
		return;
	}
	for (const link of document.querySelectorAll('.nav')) {
		if (link.dataset.page === page) link.setAttribute('aria-current', 'page');
		else link.removeAttribute('aria-current');
	}
	clearTimeout(pollTimer);
	const scrollY = window.scrollY;
	const open = quiet ? new Set([...app.querySelectorAll('details[open]')].map(disclosureKey)) : new Set();
	const focusKey = quiet && document.activeElement?.closest?.('#app') ? document.activeElement.textContent : null;
	animateBars = !quiet;
	if (!quiet) loading(page === 'projects' && !kind ? 'single' : 'cols');
	try {
		if (kind === 'p') await renderProject(decodeURIComponent(rawId));
		else if (kind === 's') await renderSession(decodeURIComponent(rawId));
		else if (page === 'projects') await renderProjects();
		else if (page === 'accounts') await renderAccounts();
		else if (page === 'settings') await renderSettings();
		else if (page === 'setup') await renderSetup();
		else await renderToday();
		if (animateBars) releaseBars();
		lastRefresh = Date.now();
	}
	catch (error) {
		if (!quiet) failed(error);
	}
	if (quiet) {
		for (const d of app.querySelectorAll('details')) if (open.has(disclosureKey(d))) d.open = true;
		if (focusKey) [...app.querySelectorAll('a, button, summary')].find(el => el.textContent === focusKey)?.focus({ preventScroll: true });
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

// A line at the bottom of the window for things that concern the whole app:
// a settings file that could not be read, or a Worklog that has closed.
const notices = new Map();
function setNotice(key, text) {
	if (text) notices.set(key, text);
	else notices.delete(key);
	const box = document.getElementById('notice');
	box.textContent = [...notices.values()].join(' ');
	box.hidden = notices.size === 0;
}

// Tells the server this page is open, and hears from it when logs or
// summaries change. When Worklog runs as an app it stops once no page has
// been open for a few seconds. EventSource reconnects on its own.
if ('EventSource' in window) {
	const stream = new EventSource('/api/alive');
	let goneTimer = null, wasGone = false;
	stream.addEventListener('changed', () => route({ quiet: true, auto: true }));
	stream.addEventListener('open', () => {
		clearTimeout(goneTimer);
		goneTimer = null;
		setNotice('gone', null);
		// Back after a restart or an update: what is on screen may be old.
		if (wasGone) route({ quiet: true, auto: true });
		wasGone = false;
	});
	stream.addEventListener('error', () => {
		goneTimer ??= setTimeout(() => {
			wasGone = true;
			setNotice('gone', 'Worklog ปิดไปแล้ว หน้านี้จะไม่อัปเดตอีก ปิดหน้าต่างนี้แล้วเปิด Worklog จากไอคอนอีกครั้ง');
		}, 5000);
	});
}

// Coming back to the window after a while shows what changed meanwhile.
window.addEventListener('focus', () => {
	if (Date.now() - lastRefresh > 60000) route({ quiet: true, auto: true });
});
