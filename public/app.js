const app = document.getElementById('app');
const scanMeta = document.getElementById('scan-meta');
const rescanBtn = document.getElementById('rescan');

const TIMELINE_DAYS = 14;
const END_STATE = {
	replied: { label: 'AI ตอบแล้ว รอคุณ', tone: 'ok' },
	rate_limited: { label: 'ติด limit', tone: 'warn' },
	interrupted: { label: 'หยุดกลางคัน', tone: 'warn' },
	no_reply: { label: 'ยังไม่มีคำตอบ', tone: 'muted' },
	unknown: { label: 'ไม่ทราบสถานะ', tone: 'muted' },
};
const LIMIT_NAME = { five_hour: 'limit 5 ชั่วโมง', seven_day: 'limit รายสัปดาห์' };

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ESC[c]);

async function api(path, options) {
	const res = await fetch(path, options);
	if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
	return res.json();
}

// Time

const toMs = ts => (typeof ts === 'number' ? ts : Date.parse(ts));

function formatDateTime(ts) {
	return new Date(toMs(ts)).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function formatTime(ts) {
	return new Date(toMs(ts)).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
}

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

// Accounts

let accountIndex = new Map();

function useAccounts(accounts) {
	accountIndex = new Map(accounts.map(a => [a.uuid, a]));
}

/** Account name with its tool, so two tools never read alike. */
function accountName(acct) {
	return acct.tool === 'claude' && !/claude/i.test(acct.label) ? `Claude ${acct.label}` : acct.label;
}

function dotClass(uuid) {
	const acct = accountIndex.get(uuid);
	return acct ? `a${acct.color % 4}` : '';
}

function accountChip(uuid, source) {
	const acct = accountIndex.get(uuid);
	if (!acct) return '<span class="chip"><span class="dot"></span>ไม่ทราบบัญชี</span>';
	const guess = source === 'inferred'
		? ' <span class="guess" title="log ไม่ได้บอกบัญชี จึงเดาจาก session อื่นในช่วงเวลาใกล้กัน">(เดา)</span>'
		: '';
	return `<span class="chip"><span class="dot ${dotClass(uuid)}"></span>${esc(accountName(acct))}${guess}</span>`;
}

function stateBadge(session) {
	if (session.is_automated) return '<span class="badge muted">งานอัตโนมัติ</span>';
	const state = END_STATE[session.end_state] ?? END_STATE.unknown;
	return `<span class="badge ${state.tone}">${state.label}</span>`;
}

function accountCard(acct) {
	const status = acct.tool !== 'claude'
		? 'log ของเครื่องมือนี้ไม่ได้บอกเรื่อง limit'
		: acct.limited
		? acct.limits.map(l => `ติด ${LIMIT_NAME[l.type] ?? 'limit'} ถึง ${formatDateTime(l.resets_at)} (อีก ${spanText(l.resets_at - Date.now())})`).join('<br>')
		: 'ใช้งานได้';
	return `<div class="card">
		<div class="acct-name"><span class="dot ${dotClass(acct.uuid)}"></span>${esc(accountName(acct))}</div>
		<div class="acct-status ${acct.tool !== 'claude' ? '' : acct.limited ? 'limited' : 'free'}">${status}</div>
		<div class="acct-meta">${acct.sessions} session, ใช้ล่าสุด ${esc(ago(acct.last_ts))}</div>
	</div>`;
}

// AI summaries

const SUMMARY_STATUS = {
	done: { label: 'เสร็จแล้ว', tone: 'ok' },
	in_progress: { label: 'ยังทำค้าง', tone: 'warn' },
	blocked: { label: 'ติดปัญหา', tone: 'warn' },
	waiting: { label: 'รออยู่', tone: 'muted' },
	abandoned: { label: 'เลิกทำแล้ว', tone: 'muted' },
};
const PAUSE_TEXT = {
	auth: 'สรุปด้วย AI ไม่ได้ เพราะ claude CLI ยังไม่ได้ login ให้เปิด terminal พิมพ์ claude แล้วใช้คำสั่ง /login จากนั้นกดสรุปอีกครั้ง',
	rate_limit: 'สรุปด้วย AI ไม่ได้ชั่วคราว เพราะบัญชีที่ claude CLI ใช้อยู่ติด limit ระบบจะลองใหม่เอง',
	missing_cli: 'หาโปรแกรม claude ไม่เจอ ให้ติดตั้ง Claude Code CLI หรือตั้ง summary.claudeBin ใน config.local.json',
};

let pollTimer = null;

function summaryPausedNote(summarizer) {
	if (!summarizer?.paused) return '';
	return `<p class="note warn-note">${esc(PAUSE_TEXT[summarizer.paused.kind] ?? summarizer.paused.message)}</p>`;
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

/** Summary card with a button to refresh. kind is 'session' or 'project'. */
function summaryCard(summary, kind, ref, summarizer) {
	// A paused queue keeps its items, but the person should be able to retry.
	const busy = summary?.busy && !summarizer?.paused;
	const data = summary?.data;
	const button = `<button class="btn btn-small" type="button" data-summarize="${kind}" data-ref="${esc(ref)}" ${busy ? 'disabled' : ''}>
		${busy ? 'กำลังสรุป' : data ? 'สรุปใหม่' : 'สรุปด้วย AI'}</button>`;
	let meta = '';
	if (data) {
		meta = `สรุปเมื่อ ${esc(ago(summary.created_at))}${summary.stale ? ', มีข้อความใหม่หลังจากนั้น' : ''}`;
	}
	else if (summary?.error && !busy) {
		meta = `<span class="error">สรุปไม่สำเร็จ ${esc(ago(summary.error_at))}</span>`;
	}
	else if (!busy) {
		meta = kind === 'project' ? 'ยังไม่มีสรุปของโปรเจคนี้' : 'ยังไม่มีสรุปของ session นี้';
	}

	const body = data ? `
		<p class="headline">${SUMMARY_STATUS[data.status] ? `<span class="badge ${SUMMARY_STATUS[data.status].tone}">${SUMMARY_STATUS[data.status].label}</span> ` : ''}${esc(data.headline)}</p>
		<div class="sum-grid">
			${listBlock('ขั้นต่อไป', data.next_steps)}
			${listBlock('ค้างอยู่', data.in_progress)}
			${listBlock('รออยู่', data.waiting_on)}
			${deadlineBlock(data.deadlines)}
			${listBlock('ทำเสร็จแล้ว', data.done)}
		</div>` : busy ? '<div class="skeleton slim"></div>' : '';

	return `<div class="card summary ${summary?.stale ? 'stale' : ''}">
		<div class="sum-head"><span class="sum-meta">${meta}</span>${button}</div>
		${body}
		${summaryPausedNote(summarizer)}
	</div>`;
}

/** Re-renders while any summary on the page is being made. */
function pollWhileBusy(anyBusy) {
	clearTimeout(pollTimer);
	if (anyBusy) pollTimer = setTimeout(() => route({ quiet: true }), 3000);
}

// Pages

function loading() {
	app.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
}

function failed(error) {
	const text = error.status === 404 ? 'ไม่พบข้อมูลนี้ อาจถูกลบไปแล้ว' : 'โหลดข้อมูลไม่สำเร็จ ลองกดสแกนใหม่หรือรีเฟรชหน้า';
	app.innerHTML = `<a class="back" href="#/">ทุกโปรเจค</a><p class="error">${text}</p>`;
}

function showScan(scan) {
	if (!scan) return;
	scanMeta.textContent = scan.error ? 'สแกนล่าสุดมีปัญหา' : `สแกนล่าสุด ${formatTime(scan.at)}`;
}

function activeRow(s) {
	const href = s.project_key ? `#/s/${encodeURIComponent(s.id)}` : null;
	const tag = href ? 'a' : 'div';
	return `<${tag} class="row" ${href ? `href="${href}"` : ''}>
		<div class="row-title">${esc(s.project_name ?? 'ไม่ทราบโปรเจค')}</div>
		<div class="row-side"><span class="live ${s.status === 'busy' ? '' : 'idle'}">${s.status === 'busy' ? 'กำลังทำงาน' : 'เปิดค้างไว้'}</span></div>
		<div class="row-sub">${esc(s.title ?? '')} ${accountChip(s.account_uuid, s.account_source)}</div>
	</${tag}>`;
}

function projectRow(p) {
	const latest = p.latest;
	const dots = p.accounts.map(uuid => `<span class="dot ${dotClass(uuid)}" title="${esc(accountIndex.has(uuid) ? accountName(accountIndex.get(uuid)) : '')}"></span>`).join('');
	const prompt = latest?.last_human_text ?? latest?.last_prompt;
	const sum = p.summary?.data;
	const next = sum?.next_steps?.[0];
	const snippet = sum
		? `<div class="snippet">${esc(sum.headline)}${next ? `<br><b>ขั้นต่อไป</b> ${esc(next)}` : ''}</div>`
		: prompt ? `<div class="snippet"><b>สั่งล่าสุด</b> ${esc(prompt)}</div>` : '';
	return `<a class="row" href="#/p/${encodeURIComponent(p.key)}">
		<div class="row-title">${esc(p.name)} <span class="dots">${dots}</span>${sum && SUMMARY_STATUS[sum.status] ? ` <span class="badge ${SUMMARY_STATUS[sum.status].tone}">${SUMMARY_STATUS[sum.status].label}</span>` : ''}</div>
		<div class="row-side"><span class="when">${esc(ago(p.last_ts))}</span><br>${p.sessions} session</div>
		${latest ? `<div class="row-sub">${esc(latest.title)} ${stateBadge(latest)} ${accountChip(latest.account_uuid, latest.account_source)}</div>` : ''}
		${snippet}
	</a>`;
}

/**
 * How to pick the work back up. A session opened in the desktop app is
 * found in its sidebar; one opened in a terminal has a resume command.
 * Both get a prompt for starting fresh, which leads when the account changed.
 */
function continueBlock(c, { switched = false } = {}) {
	if (!c) return '';
	const folder = c.cwd ? ` ในโฟลเดอร์ <span class="mono">${esc(c.cwd)}</span>` : '';
	const promptRow = lead => `<div class="how-row">
		<p>${lead}</p>
		<button class="btn btn-small" type="button" data-copy="${esc(c.prompt)}">คัดลอก prompt</button>
	</div>`;
	const fresh = switched
		? promptRow(`บัญชีเปลี่ยนจากครั้งก่อน ให้เปิด session ใหม่${folder} แล้ววาง prompt นี้`)
		: promptRow(`หรือเปิด session ใหม่${folder} แล้ววาง prompt นี้`);
	const old = c.via === 'app'
		? `<p class="how-old">${switched ? 'ถ้ายังเปิด session เดิมได้ ให้หา session ชื่อ' : 'เปิด session ชื่อ'} <b>"${esc(c.title)}"</b> จากแถบด้านซ้ายของแอป ${esc(c.app)}</p>`
		: `<div class="cmd"><code>${esc(c.command)}</code><button class="btn btn-small" type="button" data-copy="${esc(c.command)}">คัดลอก</button></div>`;
	return `<div class="how">
		${switched ? fresh + old : old + fresh}
		<details class="prompt-preview"><summary>ดู prompt</summary><div class="quote">${esc(c.prompt)}</div></details>
	</div>`;
}

function nextCard(item, rank) {
	const p = item.project;
	const reasons = item.reasons.map(r => `<li>${esc(r)}</li>`).join('')
		+ item.cautions.map(c => `<li class="caution">${esc(c)}</li>`).join('');
	return `<div class="card next">
		<div class="next-head">
			<span class="rank">${rank}</span>
			<a class="next-name" href="#/p/${encodeURIComponent(p.key)}">${esc(p.name)}</a>
			<a class="next-session" href="#/s/${encodeURIComponent(item.latest.id)}">${esc(item.latest.title)}</a>
		</div>
		${item.headline ? `<p class="next-headline">${esc(item.headline)}</p>` : ''}
		${item.next_step ? `<p class="next-step"><b>เริ่มจาก</b> ${esc(item.next_step)}</p>` : ''}
		<ul class="reasons">${reasons}</ul>
		<div class="next-foot">
			<p class="next-account"><span class="dot ${dotClass(item.account.uuid)}"></span>${esc(item.account.note)}</p>
			${continueBlock(item.continue, { switched: item.switched })}
		</div>
	</div>`;
}

function nextSection(next) {
	if (!next?.length) return '';
	const top = next.slice(0, 3), rest = next.slice(3);
	return `<section>
		<h2>ทำอะไรต่อดี</h2>
		<div class="next-list">${top.map((item, i) => nextCard(item, i + 1)).join('')}</div>
		${rest.length ? `<details class="more"><summary>งานอื่นที่ยังค้างอีก ${rest.length} โปรเจค</summary>
			<div class="list">${rest.map(item => `<a class="row" href="#/p/${encodeURIComponent(item.project.key)}">
				<div class="row-title">${esc(item.project.name)}</div>
				<div class="row-side">${esc(ago(item.latest.last_ts))}</div>
				<div class="snippet">${esc(item.reasons[0] ?? '')}</div>
			</a>`).join('')}</div>
		</details>` : ''}
	</section>`;
}

function overlapSection(o) {
	if (!o || (!o.openTogether.length && !o.files.length)) return '';
	const together = o.openTogether.map(g => `<a class="row" href="#/p/${encodeURIComponent(g.project_key)}">
		<div class="row-title">${esc(g.project_name)} เปิดอยู่ ${g.sessions.length} session พร้อมกัน</div>
		<div class="row-side">${g.strong ? '<span class="badge warn">คนละบัญชี</span>' : '<span class="badge muted">แจ้งให้รู้</span>'}</div>
		<div class="snippet">${g.sessions.map(s => `${accountChip(s.account_uuid)} ${esc(s.title ?? s.id.slice(0, 8))}`).join('<br>')}</div>
	</a>`);
	const files = o.files.map(f => `<a class="row" href="#/s/${encodeURIComponent(f.sessions[0].id)}">
		<div class="row-title file-path">${esc(relativePath(f.path, ''))}</div>
		<div class="row-side"><span class="badge warn">${f.strong ? 'คนละบัญชีแก้ไฟล์เดียวกัน' : 'แก้ไฟล์เดียวกัน'}</span></div>
		<div class="snippet">${f.sessions.map(s => `${accountChip(s.account_uuid)} ${esc(s.title ?? s.id.slice(0, 8))}, ${esc(ago(s.ts))}`).join('<br>')}</div>
	</a>`);
	return `<section>
		<h2>งานทับซ้อน</h2>
		<p class="note">session ที่แก้ไฟล์เดียวกันห่างกันไม่เกิน ${o.windowMinutes} นาทีใน 24 ชั่วโมงที่ผ่านมา และโปรเจคที่เปิดหลาย session พร้อมกัน</p>
		<div class="list">${[...together, ...files].join('')}</div>
	</section>`;
}

async function renderHome() {
	const data = await api('/api/overview');
	useAccounts(data.accounts);
	showScan(data.scan);
	const s = data.summarizer;
	const working = s && (s.running || s.pending.length);
	pollWhileBusy(working && !s.paused);
	app.innerHTML = `
		<div class="page-head">
			<h1>กลับมาทำงานต่อ</h1>
			<p>ทุกโปรเจคที่ทำกับ Claude Code และ Codex เรียงตามเวลาที่ทำล่าสุด</p>
			${working && !s.paused ? `<p class="note">กำลังสรุปด้วย AI เหลืออีก ${s.pending.length + (s.running ? 1 : 0)} รายการ</p>` : ''}
			${summaryPausedNote(s)}
		</div>
		${overlapSection(data.overlaps)}
		${nextSection(data.next)}
		<section>
			<h2>เครื่องมือและบัญชี</h2>
			<div class="accounts">${data.accounts.map(accountCard).join('')}</div>
		</section>
		${data.active.length ? `<section>
			<h2>เปิดอยู่ตอนนี้</h2>
			<div class="list">${data.active.map(activeRow).join('')}</div>
		</section>` : ''}
		<section>
			<h2>โปรเจค</h2>
			<div class="list">${data.projects.map(projectRow).join('') || '<div class="empty">ยังไม่พบ session ใน log ลองเปิด Claude Code ทำงานสักครั้ง แล้วกดสแกนใหม่</div>'}</div>
		</section>`;
}

function timeline(sessions) {
	const end = Date.now();
	const start = end - TIMELINE_DAYS * 86400000;
	const range = end - start;
	const inRange = sessions.filter(s => s.last_ts && toMs(s.last_ts) >= start);
	if (!inRange.length) return `<div class="empty">ไม่มี session ใน ${TIMELINE_DAYS} วันที่ผ่านมา</div>`;

	const laneKeys = [...new Set(inRange.map(s => (s.is_automated ? 'auto' : s.account_uuid ?? 'none')))];
	laneKeys.sort((a, b) => (accountIndex.get(a)?.color ?? 9) - (accountIndex.get(b)?.color ?? 9));
	const laneLabel = key => {
		if (key === 'auto') return '<span class="dot"></span>งานอัตโนมัติ';
		const acct = accountIndex.get(key);
		return acct ? `<span class="dot ${dotClass(key)}"></span>${esc(accountName(acct))}` : '<span class="dot"></span>ไม่ทราบบัญชี';
	};
	const lanes = laneKeys.map(key => {
		const segs = inRange.filter(s => (s.is_automated ? 'auto' : s.account_uuid ?? 'none') === key).map(s => {
			const from = Math.max(toMs(s.first_ts), start);
			const left = ((from - start) / range) * 100;
			const width = Math.max(((toMs(s.last_ts) - from) / range) * 100, 0.4);
			const tip = `${s.title} (${formatDateTime(s.first_ts)} ถึง ${formatTime(s.last_ts)})`;
			return `<a class="seg ${dotClass(s.account_uuid)} ${s.is_automated ? 'auto' : ''}" href="#/s/${encodeURIComponent(s.id)}"
				style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" title="${esc(tip)}" aria-label="${esc(tip)}"></a>`;
		}).join('');
		return `<div class="lane"><div class="lane-label">${laneLabel(key)}</div><div class="track">${segs}</div></div>`;
	}).join('');

	const ticks = [];
	for (let d = TIMELINE_DAYS; d >= 0; d -= 2) {
		const t = end - d * 86400000;
		const label = d === 0 ? 'วันนี้' : new Date(t).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
		ticks.push(`<span style="left:${(((t - start) / range) * 100).toFixed(2)}%">${label}</span>`);
	}
	return `${lanes}<div class="ticks"><span></span><div class="ticks-inner">${ticks.join('')}</div></div>`;
}

function relativePath(file, base) {
	const norm = p => p.replace(/\\/g, '/');
	const f = norm(file), b = norm(base ?? '');
	return b && f.toLowerCase().startsWith(b.toLowerCase() + '/') ? f.slice(b.length + 1) : f;
}

function fileRows(files, base) {
	if (!files.length) return '<div class="empty">ไม่มีการแก้ไฟล์ผ่านเครื่องมือแก้ไฟล์ของ Claude</div>';
	return files.map(f => `<div class="row">
		<div class="file-path">${esc(relativePath(f.path, base))}</div>
		<div class="row-side">${esc(ago(f.last_ts))}${f.session_count > 1 ? `<br>${f.session_count} session` : ''}</div>
	</div>`).join('');
}

function sessionRow(s) {
	const headline = s.summary?.data?.headline;
	return `<a class="row" href="#/s/${encodeURIComponent(s.id)}">
		<div class="row-title">${esc(s.title)}</div>
		<div class="row-side"><span class="when">${esc(ago(s.last_ts))}</span><br>${s.human_turns} รอบ</div>
		<div class="row-sub">${stateBadge(s)} ${accountChip(s.account_uuid, s.account_source)}</div>
		${headline ? `<div class="snippet">${esc(headline)}</div>` : ''}
	</a>`;
}

async function renderProject(key) {
	const data = await api(`/api/projects/${encodeURIComponent(key)}`);
	useAccounts(data.accounts);
	const p = data.project;
	const people = p.sessions.filter(s => !s.is_automated);
	const lastHuman = people[0];
	pollWhileBusy(!data.summarizer?.paused && (p.summary.busy || p.sessions.some(s => s.summary.busy)));
	app.innerHTML = `
		<a class="back" href="#/">ทุกโปรเจค</a>
		<div class="page-head">
			<h1>${esc(p.name)}</h1>
			<p class="mono">${esc(p.path)}</p>
			<div class="stats">
				<span><b>${p.sessions.length}</b> session</span>
				<span>ทำล่าสุด <b>${esc(ago(p.sessions[0]?.last_ts))}</b></span>
				${lastHuman ? `<span>session ล่าสุดที่คุณเปิด <b>${esc(lastHuman.title)}</b></span>` : ''}
			</div>
		</div>
		<section>
			<h2>สถานะโปรเจค</h2>
			${summaryCard(p.summary, 'project', p.key, data.summarizer)}
		</section>
		<section>
			<h2>ช่วง ${TIMELINE_DAYS} วันล่าสุด</h2>
			<div class="card timeline">${timeline(p.sessions)}</div>
		</section>
		<section>
			<h2>Session ทั้งหมด</h2>
			<div class="list">${p.sessions.map(sessionRow).join('')}</div>
		</section>
		<section>
			<h2>ไฟล์ที่แก้ล่าสุด</h2>
			<div class="list files">${fileRows(p.files, p.path)}</div>
		</section>`;
}

async function renderSession(id) {
	const data = await api(`/api/sessions/${encodeURIComponent(id)}`);
	useAccounts(data.accounts);
	const s = data.session;
	pollWhileBusy(s.summary.busy && !data.summarizer?.paused);
	const meta = [
		['เริ่ม', s.first_ts ? formatDateTime(s.first_ts) : '-'],
		['ทำล่าสุด', s.last_ts ? `${formatDateTime(s.last_ts)} (${ago(s.last_ts)})` : '-'],
		['ใช้เวลาตั้งแต่ต้นจนจบ', s.first_ts && s.last_ts ? spanText(toMs(s.last_ts) - toMs(s.first_ts)) : '-'],
		['จำนวนรอบที่คุณสั่ง', String(s.human_turns)],
		['โมเดล', s.model ?? '-'],
		['branch', s.git_branch ?? '-'],
	];
	app.innerHTML = `
		${s.project_key ? `<a class="back" href="#/p/${encodeURIComponent(s.project_key)}">${esc(s.project_name ?? 'โปรเจค')}</a>` : '<a class="back" href="#/">ทุกโปรเจค</a>'}
		<div class="page-head">
			<h1>${esc(s.title)}</h1>
			<div class="stats">${stateBadge(s)} ${accountChip(s.account_uuid, s.account_source)} <span class="mono">${esc(s.cwd ?? '')}</span></div>
		</div>
		<div class="card"><dl class="meta-grid">${meta.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
			${s.pr_url ? `<p>Pull request <a class="mono" href="${esc(s.pr_url)}" target="_blank" rel="noopener">${esc(s.pr_url)}</a></p>` : ''}
		</div>
		<section>
			<h2>สรุป session นี้</h2>
			${summaryCard(s.summary, 'session', s.id, data.summarizer)}
		</section>
		<section>
			<h2>ที่คุณสั่งล่าสุด</h2>
			<div class="card">
				<div class="quote-label"><span>${s.last_human_ts ? esc(formatDateTime(s.last_human_ts)) : ''}</span></div>
				<div class="quote">${esc(s.last_human_text ?? s.last_prompt ?? 'ไม่มีข้อความที่คุณพิมพ์ใน session นี้')}</div>
			</div>
		</section>
		<section>
			<h2>${s.tool === 'codex' ? 'Codex' : 'Claude'} ตอบล่าสุด</h2>
			<div class="card">
				<div class="quote-label"><span>${s.last_assistant_ts ? esc(formatDateTime(s.last_assistant_ts)) : ''}</span></div>
				<div class="quote">${esc(s.last_assistant_text ?? 'ไม่มีคำตอบที่เป็นข้อความ')}</div>
			</div>
		</section>
		<section>
			<h2>กลับไปทำต่อ</h2>
			<div class="card">${continueBlock(s.continue)}</div>
		</section>
		<section>
			<h2>ไฟล์ที่แก้ใน session นี้</h2>
			<div class="list files">${fileRows(s.files, s.cwd)}</div>
		</section>`;
}

// Routing

async function route({ quiet = false } = {}) {
	const hash = location.hash.replace(/^#/, '') || '/';
	const [, kind, rawId] = hash.match(/^\/(p|s)\/(.+)$/) ?? [];
	clearTimeout(pollTimer);
	const scrollY = window.scrollY;
	if (!quiet) loading();
	try {
		if (kind === 'p') await renderProject(decodeURIComponent(rawId));
		else if (kind === 's') await renderSession(decodeURIComponent(rawId));
		else await renderHome();
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
	rescanBtn.textContent = 'กำลังสแกน';
	try {
		const { scan } = await api('/api/scan', { method: 'POST' });
		showScan(scan);
		await route();
	}
	finally {
		rescanBtn.disabled = false;
		rescanBtn.textContent = 'สแกนใหม่';
	}
});

window.addEventListener('hashchange', route);
route();
