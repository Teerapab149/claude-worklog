// Summarizes a session or a project, either through the claude CLI in print
// mode on the person's own subscription, or through an API that speaks the
// OpenAI chat format (Gemini, Groq, OpenRouter, Ollama and others).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const SUMMARY_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['headline', 'status', 'done', 'in_progress', 'next_steps', 'waiting_on', 'deadlines'],
	properties: {
		headline: { type: 'string', description: 'หนึ่งประโยค ว่างานนี้ทำอะไรและตอนนี้อยู่ตรงไหน' },
		status: { type: 'string', enum: ['done', 'in_progress', 'blocked', 'waiting', 'abandoned'] },
		done: { type: 'array', items: { type: 'string' }, maxItems: 6 },
		in_progress: { type: 'array', items: { type: 'string' }, maxItems: 5 },
		next_steps: { type: 'array', items: { type: 'string' }, maxItems: 5 },
		waiting_on: { type: 'array', items: { type: 'string' }, maxItems: 4 },
		deadlines: {
			type: 'array', maxItems: 4,
			items: {
				type: 'object', additionalProperties: false, required: ['date', 'text'],
				properties: {
					date: { type: ['string', 'null'], description: 'YYYY-MM-DD ถ้าระบุวันได้ ไม่งั้น null' },
					text: { type: 'string' },
				},
			},
		},
	},
};

const STYLE_RULES = `กฎการเขียน (สำคัญมาก):
- เขียนภาษาไทยธรรมดา ประโยคสั้น ชัด แบบที่คนเขียนโน้ตให้ตัวเอง
- ห้ามใช้จุดกึ่งกลาง (\u00B7) ลูกศร (\u2192 \u2190) em dash (\u2014) อีโมจิ หรือสัญลักษณ์ตกแต่ง
- ห้ามใช้เครื่องหมาย + แทนคำว่า "และ"
- ห้ามขึ้นต้นด้วยคำเกริ่น เช่น "สรุป:" "แน่นอน" "Here's"
- ชื่อไฟล์ ชื่อโค้ด และศัพท์เทคนิค เขียนตามต้นฉบับได้`;

export const SESSION_PROMPT = `คุณช่วยจดบันทึกงานที่ผู้ใช้ทำร่วมกับผู้ช่วย AI เขียนโค้ด (Claude Code, Codex หรือเครื่องมืออื่น) เพื่อให้ผู้ใช้กลับมาทำต่อได้ทันทีหลังจากหยุดไปหลายวัน
อ่านบทสนทนาของหนึ่ง session แล้วสรุปตาม schema:
- headline: ประโยคเดียว บอกว่า session นี้ทำงานอะไร และจบที่ตรงไหน
- status: done ถ้างานที่ขอเสร็จแล้ว, in_progress ถ้ายังทำค้าง, blocked ถ้าติดปัญหาที่ต้องแก้ก่อน, waiting ถ้ารอคนอื่นหรือรอผู้ใช้ตัดสินใจ, abandoned ถ้าเลิกทำไปแล้ว
- done: สิ่งที่ทำเสร็จจริงใน session นี้ (ไม่ใช่สิ่งที่วางแผนไว้)
- in_progress: สิ่งที่เริ่มแล้วแต่ยังไม่เสร็จ
- next_steps: สิ่งที่ควรทำต่อเป็นลำดับ เขียนให้ลงมือได้ทันที
- waiting_on: สิ่งที่รอจากคนอื่นหรือรอผู้ใช้ตอบ
- deadlines: กำหนดส่งหรือวันสอบที่ถูกพูดถึง แปลงเป็นวันที่จริงโดยอิงเวลาในบทสนทนา
ถ้า session จบเพราะติด usage limit หรือถูกหยุดกลางคัน ให้ถือว่างานล่าสุดยังไม่เสร็จ
อย่าเดาสิ่งที่ไม่มีในบทสนทนา ถ้าไม่มีข้อมูลให้ใช้ array ว่าง

${STYLE_RULES}`;

export const PROJECT_PROMPT = `คุณช่วยจดบันทึกภาพรวมของหนึ่งโปรเจคที่ผู้ใช้ทำร่วมกับผู้ช่วย AI เขียนโค้ด (Claude Code, Codex หรือเครื่องมืออื่น) ผ่านหลาย session และอาจหลายบัญชี
ข้อมูลที่ได้รับคือสรุปของแต่ละ session เรียงจากใหม่ไปเก่า รวมสรุปเป็นสถานะปัจจุบันของทั้งโปรเจคตาม schema
- ข้อมูลจาก session ที่ใหม่กว่าถือว่าถูกต้องกว่า ถ้าขัดกัน
- done ให้เลือกเฉพาะชิ้นงานสำคัญที่เสร็จแล้ว
- next_steps คือสิ่งที่ควรทำต่อในโปรเจคนี้ เรียงจากสำคัญที่สุด
- ถ้าเห็นว่าสอง session ทำงานชิ้นเดียวกันซ้ำ ให้ใส่ไว้ใน in_progress ว่าควรตรวจว่าทับกันหรือไม่

${STYLE_RULES}`;

// Characters the person never wants to see in generated text, written as
// escapes so this file stays free of them too.
const REPLACEMENTS = [
	[/\s*[\u2014\u2013]\s*/g, ', '],
	[/\s*\u00B7\s*/g, ', '],
	[/\s*\u2192\s*/g, ' แล้ว '],
	[/\s*\u2190\s*/g, ' จาก '],
	[/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, ''],
	[/^(สรุป|Summary)\s*[:：]\s*/i, ''],
	[/ {2,}/g, ' '],
	[/,\s*,/g, ','],
];

export function cleanText(text) {
	let out = String(text ?? '');
	for (const [pattern, replacement] of REPLACEMENTS) out = out.replace(pattern, replacement);
	return out.trim().replace(/^,\s*/, '').replace(/,$/, '');
}

export function cleanSummary(raw) {
	const list = v => (Array.isArray(v) ? v.map(cleanText).filter(Boolean) : []);
	const status = SUMMARY_SCHEMA.properties.status.enum.includes(raw?.status) ? raw.status : 'in_progress';
	return {
		headline: cleanText(raw?.headline),
		status,
		done: list(raw?.done),
		in_progress: list(raw?.in_progress),
		next_steps: list(raw?.next_steps),
		waiting_on: list(raw?.waiting_on),
		deadlines: Array.isArray(raw?.deadlines)
			? raw.deadlines
				.map(d => ({ date: /^\d{4}-\d{2}-\d{2}$/.test(d?.date ?? '') ? d.date : null, text: cleanText(d?.text) }))
				.filter(d => d.text)
			: [],
	};
}

export class SummarizerError extends Error {
	constructor(message, kind) {
		super(message);
		this.kind = kind; // 'auth' | 'rate_limit' | 'missing_cli' | 'timeout' | 'bad_output' | 'failed'
	}
}

function classify(message) {
	if (/authenticat|oauth|log ?in|credential|401/i.test(message)) return 'auth';
	if (/rate.?limit|usage limit|429|quota/i.test(message)) return 'rate_limit';
	return 'failed';
}

/**
 * On Windows the npm shim is a .cmd file, which Node will not spawn without
 * a shell. Look for the real executable so arguments pass through untouched.
 */
export function resolveClaudeBin(configured) {
	if (configured) return configured;
	if (process.platform !== 'win32') return 'claude';
	for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
		if (!dir) continue;
		const exe = path.join(dir, 'claude.exe');
		if (fs.existsSync(exe)) return exe;
		const shim = path.join(dir, 'claude.cmd');
		if (fs.existsSync(shim)) {
			const match = fs.readFileSync(shim, 'utf8').match(/"%dp0%\\([^"]+\.exe)"/i);
			if (match) {
				const target = path.join(dir, match[1]);
				if (fs.existsSync(target)) return target;
			}
		}
	}
	return 'claude';
}

/** Runs claude -p once and returns { summary, costUsd }. */
export function runClaude({ system, input, config }) {
	const opts = config.summary;
	const cwd = path.join(config.dataDir, 'summarizer');
	fs.mkdirSync(cwd, { recursive: true });
	const args = [
		'-p',
		'--model', opts.model,
		'--no-session-persistence',
		'--tools', '',
		'--setting-sources', '',
		'--output-format', 'json',
		'--system-prompt', system,
		'--json-schema', JSON.stringify(SUMMARY_SCHEMA),
	];

	return new Promise((resolve, reject) => {
		let child;
		try {
			child = spawn(resolveClaudeBin(opts.claudeBin), args, {
				cwd,
				windowsHide: true,
				// Lets this project's own hooks recognise and skip these runs.
				env: { ...process.env, WORKLOG_SUMMARIZER: '1' },
			});
		}
		catch (error) {
			return reject(new SummarizerError(error.message, 'missing_cli'));
		}
		let stdout = '', stderr = '';
		const timer = setTimeout(() => {
			child.kill();
			reject(new SummarizerError('claude ใช้เวลานานเกินไป', 'timeout'));
		}, opts.timeoutMs);
		child.stdout.on('data', d => { stdout += d; });
		child.stderr.on('data', d => { stderr += d; });
		child.on('error', error => {
			clearTimeout(timer);
			reject(new SummarizerError(error.message, error.code === 'ENOENT' ? 'missing_cli' : 'failed'));
		});
		child.on('close', code => {
			clearTimeout(timer);
			let data;
			try { data = JSON.parse(stdout); }
			catch {
				const message = (stderr || stdout || `claude exited with ${code}`).trim().slice(0, 500);
				return reject(new SummarizerError(message, classify(message)));
			}
			if (data.is_error) {
				const message = String(data.result ?? data.subtype ?? 'error').slice(0, 500);
				return reject(new SummarizerError(message, classify(message)));
			}
			let raw = data.structured_output;
			if (!raw && typeof data.result === 'string') {
				try { raw = JSON.parse(data.result.replace(/^```(?:json)?\s*|\s*```$/g, '')); }
				catch { return reject(new SummarizerError('claude ตอบกลับมาไม่ใช่ JSON', 'bad_output')); }
			}
			resolve({ summary: cleanSummary(raw), costUsd: Number(data.total_cost_usd) || 0 });
		});
		child.stdin.end(input);
	});
}

// Summaries through any API that speaks the OpenAI chat format. Each preset
// fills in the address and a model that summarizes Thai well; the person can
// change both. A key is kept per preset, so switching back does not lose it.
export const API_PRESETS = {
	gemini: { label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', needsKey: true, keyUrl: 'https://aistudio.google.com/apikey' },
	groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', needsKey: true, keyUrl: 'https://console.groq.com/keys' },
	openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.5-flash', needsKey: true, keyUrl: 'https://openrouter.ai/keys' },
	ollama: { label: 'Ollama (ในเครื่อง)', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b', needsKey: false, keyUrl: null },
	custom: { label: 'กำหนดเอง', baseUrl: '', model: '', needsKey: false, keyUrl: null },
};

const trimUrl = url => String(url ?? '').replace(/\/+$/, '');

/**
 * A saved key goes only to the address it was saved for, so changing the
 * address, by hand or by a forged request, can never send it somewhere else.
 * Keys saved before addresses were recorded belong to the address in use then.
 */
export function savedKey(summary, preset, baseUrl) {
	const api = summary?.api ?? {};
	const key = api.keys?.[preset];
	if (!key) return '';
	const own = api.keyUrls?.[preset]
		?? (api.preset === preset && api.baseUrl ? api.baseUrl : API_PRESETS[preset]?.baseUrl);
	return trimUrl(own) === trimUrl(baseUrl) ? key : '';
}

/** The API settings in force, with the preset filling whatever was left empty. */
export function apiSettings(summary) {
	const api = summary?.api ?? {};
	const preset = API_PRESETS[api.preset] ? api.preset : 'gemini';
	const base = API_PRESETS[preset];
	const baseUrl = trimUrl(api.baseUrl || base.baseUrl);
	return {
		preset,
		baseUrl,
		model: api.model || base.model,
		apiKey: savedKey(summary, preset, baseUrl),
		needsKey: base.needsKey,
	};
}

const JSON_RULE = `ตอบเป็น JSON object เดียวเท่านั้น ไม่มีข้อความอื่นนอก JSON ใช้ชื่อฟิลด์และชนิดตาม JSON Schema นี้:\n${JSON.stringify(SUMMARY_SCHEMA)}`;

function apiError(status, text, host) {
	let detail = '';
	try {
		// Gemini wraps its error in a list.
		const parsed = JSON.parse(text);
		const body = Array.isArray(parsed) ? parsed[0] : parsed;
		detail = String(body?.error?.message ?? body?.error ?? body?.message ?? '').slice(0, 300);
	}
	catch {
		detail = text.slice(0, 200);
	}
	// Gemini answers a bad key with 400 rather than 401.
	const badKey = status === 401 || status === 403 || (status === 400 && /api.?key/i.test(detail));
	const kind = badKey ? 'auth' : status === 429 ? 'rate_limit' : 'failed';
	const lead = kind === 'auth' ? `${host} ไม่รับ API key นี้` : kind === 'rate_limit' ? `${host} ให้รอก่อน เพราะเรียกถี่หรือใช้เกินโควต้า` : `${host} ตอบกลับด้วย HTTP ${status}`;
	return new SummarizerError(detail ? `${lead} (${detail})` : lead, kind);
}

async function callApi(api, path, { body, timeoutMs, fetch }) {
	const host = new URL(api.baseUrl).host;
	if (api.needsKey && !api.apiKey) throw new SummarizerError(`ยังไม่ได้ใส่ API key ของ ${host}`, 'auth');
	const headers = { 'content-type': 'application/json' };
	if (api.apiKey) headers.authorization = `Bearer ${api.apiKey}`;
	let res;
	try {
		res = await fetch(`${api.baseUrl}${path}`, {
			method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined,
			signal: AbortSignal.timeout(timeoutMs),
		});
	}
	catch (error) {
		if (error.name === 'TimeoutError') throw new SummarizerError(`${host} ใช้เวลานานเกินไป`, 'timeout');
		const code = error.cause?.code ?? '';
		const why = code === 'ECONNREFUSED' ? 'ไม่มีโปรแกรมรออยู่ที่นั่น ถ้าเป็น Ollama ให้เปิด Ollama ก่อน'
			: code === 'ENOTFOUND' ? 'หาที่อยู่นี้ไม่เจอ ตรวจที่อยู่ API หรืออินเทอร์เน็ต'
			: code || error.message;
		throw new SummarizerError(`ต่อ ${host} ไม่ได้ ${why}`, 'failed');
	}
	const text = await res.text();
	if (!res.ok) throw apiError(res.status, text, host);
	try { return JSON.parse(text); }
	catch { throw new SummarizerError(`${host} ตอบกลับมาไม่ใช่ JSON`, 'bad_output'); }
}

/** Pulls the JSON object out of a reply, even one wrapped in a code fence or a sentence. */
function parseReply(content) {
	const text = String(content ?? '');
	const start = text.indexOf('{'), end = text.lastIndexOf('}');
	if (start < 0 || end <= start) throw new SummarizerError('API ตอบกลับมาไม่มี JSON', 'bad_output');
	try { return JSON.parse(text.slice(start, end + 1)); }
	catch { throw new SummarizerError('API ตอบกลับมาเป็น JSON ที่อ่านไม่ได้', 'bad_output'); }
}

/** Runs one summary through the chat completions API. Same shape as runClaude. */
export async function runApi({ system, input, config, fetch = globalThis.fetch }) {
	const api = apiSettings(config.summary);
	const data = await callApi(api, '/chat/completions', {
		fetch, timeoutMs: config.summary.timeoutMs,
		body: {
			model: api.model,
			temperature: 0.2,
			response_format: { type: 'json_object' },
			messages: [{ role: 'system', content: `${system}\n\n${JSON_RULE}` }, { role: 'user', content: input }],
		},
	});
	const raw = parseReply(data.choices?.[0]?.message?.content);
	return { summary: cleanSummary(raw), costUsd: Number(data.usage?.cost) || 0 };
}

/** Runs a summary with whichever summarizer the settings name right now. */
export function runSummary(args) {
	return args.config.summary.provider === 'api' ? runApi(args) : runClaude(args);
}

/** The model name stored with a summary. */
export const summaryModel = summary => (summary.provider === 'api' ? apiSettings(summary).model : summary.model);

/**
 * Checks an API the person is about to use: that the key is accepted, which
 * models it offers, and that the chosen model answers in JSON. Returns
 * { ok, message, models } and never throws.
 */
export async function testApi(api, { fetch = globalThis.fetch, timeoutMs = 30000 } = {}) {
	let models = [];
	try {
		const list = await callApi(api, '/models', { fetch, timeoutMs });
		models = (list.data ?? list.models ?? []).map(m => String(m.id ?? m.name ?? '').replace(/^models\//, '')).filter(Boolean).sort();
	}
	catch (error) {
		// Some servers have no model list; a key they refuse still shows up below.
		if (error.kind === 'auth') return { ok: false, message: error.message, models };
	}
	if (models.length && !models.includes(api.model)) {
		return { ok: false, message: `ไม่พบโมเดล ${api.model} ในรายการ เลือกจากรายการที่มีให้แทน`, models };
	}
	try {
		const data = await callApi(api, '/chat/completions', {
			fetch, timeoutMs,
			body: {
				model: api.model, max_tokens: 50, temperature: 0, response_format: { type: 'json_object' },
				messages: [{ role: 'user', content: 'ตอบเป็น JSON {"ok": true} เท่านั้น' }],
			},
		});
		parseReply(data.choices?.[0]?.message?.content);
		return { ok: true, message: `ใช้ได้ ${api.model} ตอบกลับเป็น JSON ถูกต้อง`, models };
	}
	catch (error) {
		return { ok: false, message: error.message, models };
	}
}

/**
 * Whether the claude CLI is there and signed in, and as whom, from
 * `claude auth status`. It costs no quota. Returns
 * { found, loggedIn, email, plan } and never throws.
 */
export function claudeStatus(config, { run = spawn, timeoutMs = 20000 } = {}) {
	return new Promise(resolve => {
		let child, out = '';
		try {
			child = run(resolveClaudeBin(config.summary.claudeBin), ['auth', 'status', '--json'], { windowsHide: true });
		}
		catch {
			return resolve({ found: false, loggedIn: false });
		}
		const timer = setTimeout(() => { child.kill(); resolve({ found: true, loggedIn: false, error: 'claude ตอบช้าเกินไป' }); }, timeoutMs);
		child.stdout?.on('data', d => { out += d; });
		child.on('error', error => {
			clearTimeout(timer);
			resolve({ found: error.code !== 'ENOENT', loggedIn: false, error: error.code === 'ENOENT' ? null : error.message });
		});
		child.on('close', () => {
			clearTimeout(timer);
			let data;
			try { data = JSON.parse(out); }
			catch { return resolve({ found: true, loggedIn: false, error: 'อ่านผลจาก claude auth status ไม่ได้ อาจเป็นเวอร์ชันเก่า' }); }
			resolve({ found: true, loggedIn: data.loggedIn === true, email: data.email ?? null, plan: data.subscriptionType ?? null });
		});
	});
}
