// Summaries through an AI API with the person's own key, or through a model
// running on this machine. Each preset knows how its provider is called:
//   kind        'openai' (the chat completions format most providers copy),
//               'anthropic' (the Messages API) or 'ollama' (its own /api/chat)
//   jsonMode    'schema' (structured output), 'object' (JSON mode) or 'none'
//   authHeader  how the key is sent: 'bearer' (default), 'api-key' or 'x-api-key'
//   reasoning   a reasoning_effort to send, kept low because a summary needs little
//   maxChars    a smaller conversation digest for small local models
// A provider that refuses part of a request (a JSON mode, reasoning_effort,
// temperature) is asked again without it, and what worked is remembered.

import { savedKeyFor } from './secrets.js';
import { SummarizerError, checkSummary, parseReply, portableSchema, SUMMARY_SCHEMA } from './summary-format.js';

export const API_PRESETS = {
	anthropic: { label: 'Anthropic API (Claude)', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-haiku-5-5', needsKey: true, authHeader: 'x-api-key', keyUrl: 'https://platform.claude.com/settings/keys' },
	openai: { label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-6-luna', needsKey: true, jsonMode: 'schema', keyUrl: 'https://platform.openai.com/api-keys' },
	gemini: { label: 'Gemini', kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.5-flash-lite', needsKey: true, jsonMode: 'schema', reasoning: 'minimal', keyUrl: 'https://aistudio.google.com/apikey' },
	groq: { label: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', needsKey: true, jsonMode: 'schema', reasoning: 'low', keyUrl: 'https://console.groq.com/keys' },
	openrouter: { label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemini-3.5-flash-lite', needsKey: true, jsonMode: 'object', keyUrl: 'https://openrouter.ai/keys' },
	mistral: { label: 'Mistral', kind: 'openai', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', needsKey: true, jsonMode: 'schema', keyUrl: 'https://console.mistral.ai/api-keys' },
	deepseek: { label: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', needsKey: true, jsonMode: 'object', keyUrl: 'https://platform.deepseek.com/api_keys' },
	ollama: { label: 'Ollama (ในเครื่อง)', kind: 'ollama', baseUrl: 'http://localhost:11434', model: 'qwen3:8b', needsKey: false, maxChars: 8000 },
	lmstudio: { label: 'LM Studio (ในเครื่อง)', kind: 'openai', baseUrl: 'http://localhost:1234/v1', model: '', needsKey: false, jsonMode: 'schema', maxChars: 8000 },
	azure: { label: 'Azure OpenAI', kind: 'openai', baseUrl: 'https://ชื่อ-resource.openai.azure.com/openai/v1', model: '', needsKey: true, jsonMode: 'schema', authHeader: 'api-key' },
	custom: { label: 'กำหนดเอง', kind: 'openai', baseUrl: '', model: '', needsKey: false, jsonMode: 'object' },
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
export const isLocalUrl = url => {
	try { return LOCAL_HOSTS.has(new URL(url).hostname); }
	catch { return false; }
};

const trimUrl = url => String(url ?? '').replace(/\/+$/, '');

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
		apiKey: savedKeyFor(summary, preset, baseUrl, { defaultBaseUrl: base.baseUrl }),
		needsKey: base.needsKey,
	};
}

/** How many characters of a conversation to send: smaller for small local models. */
export const digestChars = summary => {
	const preset = API_PRESETS[apiSettings(summary).preset];
	return summary.provider === 'api' && preset.maxChars ? Math.min(summary.maxChars, preset.maxChars) : summary.maxChars;
};

const JSON_RULE = `ตอบเป็น JSON object เดียวเท่านั้น ไม่มีข้อความอื่นนอก JSON ใช้ชื่อฟิลด์และชนิดตาม JSON Schema นี้:\n${JSON.stringify(portableSchema(SUMMARY_SCHEMA))}`;
const REPAIR = 'คำตอบก่อนหน้าไม่ใช่ JSON ตาม schema ที่ให้ไว้ ช่วยตอบใหม่เป็น JSON object เดียวตาม schema เท่านั้น ห้ามมีข้อความอื่น';
const MAX_TOKENS = 2000;
const RETRYABLE = new Set([408, 409, 425, 500, 502, 503, 504, 529]);
const defaultSleep = ms => new Promise(r => setTimeout(r, ms));

/** Milliseconds until the next midnight in California, when Gemini's daily quota starts again. */
function untilPacificMidnight(now = Date.now()) {
	const next = new Date(now);
	next.setUTCHours(8, 0, 0, 0); // midnight PST; during PDT this is an hour late, which only errs on the safe side
	if (next.getTime() <= now) next.setUTCDate(next.getUTCDate() + 1);
	return next.getTime() - now;
}

function retryAfter(headers) {
	const value = headers?.get?.('retry-after');
	if (!value) return null;
	const seconds = Number(value);
	if (Number.isFinite(seconds)) return seconds * 1000;
	const at = Date.parse(value);
	return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

function apiError(res, text, host) {
	let detail = '';
	try {
		// Gemini wraps its error in a list.
		const parsed = JSON.parse(text);
		const body = Array.isArray(parsed) ? parsed[0] : parsed;
		const err = body?.error;
		detail = String((typeof err === 'string' ? err : err?.message) ?? body?.message ?? '').slice(0, 300);
	}
	catch {
		detail = text.slice(0, 200);
	}
	const status = res.status;
	// Gemini answers a bad key with 400 rather than 401.
	const badKey = status === 401 || status === 403 || (status === 400 && /api.?key/i.test(detail));
	const kind = badKey ? 'auth' : status === 429 ? 'rate_limit' : 'failed';
	let retryAfterMs = retryAfter(res.headers);
	// A daily quota will not come back in a few minutes, so wait for the day to turn.
	if (kind === 'rate_limit' && /per.?day|daily|requests per day|PerDay/i.test(detail)) retryAfterMs = untilPacificMidnight();
	const lead = kind === 'auth' ? `${host} ไม่รับ API key นี้`
		: kind === 'rate_limit' ? `${host} ให้รอก่อน เพราะเรียกถี่หรือใช้เกินโควต้า`
		: status === 404 ? `${host} ไม่รู้จักที่อยู่หรือโมเดลนี้ (HTTP 404)`
		: `${host} ตอบกลับด้วย HTTP ${status}`;
	return new SummarizerError(detail ? `${lead} (${detail})` : lead, kind, { status, detail, retryAfterMs });
}

function headersFor(api) {
	const headers = { 'content-type': 'application/json' };
	const preset = API_PRESETS[api.preset] ?? API_PRESETS.custom;
	if (preset.kind === 'anthropic') headers['anthropic-version'] = '2023-06-01';
	if (!api.apiKey) return headers;
	const how = preset.authHeader ?? 'bearer';
	if (how === 'x-api-key') headers['x-api-key'] = api.apiKey;
	else if (how === 'api-key') headers['api-key'] = api.apiKey;
	else headers.authorization = `Bearer ${api.apiKey}`;
	return headers;
}

/**
 * One HTTP call with a short retry for errors that pass by themselves (a
 * server error, a dropped connection). A time-out is not retried: it already
 * waited long enough.
 */
async function request(api, path, { body, timeoutMs = 180000, fetch = globalThis.fetch, sleep = defaultSleep }) {
	const host = new URL(api.baseUrl).host;
	if (api.needsKey && !api.apiKey) throw new SummarizerError(`ยังไม่ได้ใส่ API key ของ ${host}`, 'auth');
	for (let attempt = 1; ; attempt++) {
		let res, text;
		try {
			res = await fetch(`${api.baseUrl}${path}`, {
				method: body ? 'POST' : 'GET', headers: headersFor(api), body: body ? JSON.stringify(body) : undefined,
				signal: AbortSignal.timeout(timeoutMs),
			});
			text = await res.text();
		}
		catch (error) {
			if (error.name === 'TimeoutError') throw new SummarizerError(`${host} ใช้เวลานานเกินไป`, 'timeout');
			const code = error.cause?.code ?? '';
			if (attempt < 3 && code !== 'ECONNREFUSED' && code !== 'ENOTFOUND') { await sleep(attempt * 3000 + Math.random() * 500); continue; }
			const why = code === 'ECONNREFUSED' ? 'ไม่มีโปรแกรมรออยู่ที่นั่น ถ้าเป็น Ollama หรือ LM Studio ให้เปิดโปรแกรมนั้นก่อน'
				: code === 'ENOTFOUND' ? 'หาที่อยู่นี้ไม่เจอ ตรวจที่อยู่ API หรืออินเทอร์เน็ต'
				: code || error.message;
			throw new SummarizerError(`ต่อ ${host} ไม่ได้ ${why}`, 'failed');
		}
		if (res.ok) {
			try { return JSON.parse(text); }
			catch { throw new SummarizerError(`${host} ตอบกลับมาไม่ใช่ JSON`, 'bad_output'); }
		}
		const error = apiError(res, text, host);
		if (attempt < 3 && RETRYABLE.has(res.status)) {
			await sleep(Math.min(error.retryAfterMs ?? attempt * 3000, 20000) + Math.random() * 500);
			continue;
		}
		throw error;
	}
}

// Which JSON mode worked for each address and model, so a refusal is paid once per run.
const modeCache = new Map();
const refusedFor = (error, pattern) => (error.status === 400 || error.status === 422) && pattern.test(error.detail ?? '');

async function openaiCall(api, system, messages, opts) {
	const preset = API_PRESETS[api.preset] ?? API_PRESETS.custom;
	const cacheKey = `${api.baseUrl}|${api.model}`;
	let mode = modeCache.get(cacheKey) ?? preset.jsonMode ?? 'object';
	let reasoning = preset.reasoning ?? null;
	let temperature = true;
	for (;;) {
		const body = { model: api.model, max_tokens: opts.maxTokens ?? MAX_TOKENS, messages: [{ role: 'system', content: `${system}\n\n${JSON_RULE}` }, ...messages] };
		if (temperature) body.temperature = 0.2;
		if (reasoning) body.reasoning_effort = reasoning;
		if (mode === 'schema') body.response_format = { type: 'json_schema', json_schema: { name: 'worklog_summary', strict: true, schema: portableSchema() } };
		else if (mode === 'object') body.response_format = { type: 'json_object' };
		let data;
		try { data = await request(api, '/chat/completions', { ...opts, body }); }
		catch (error) {
			if (reasoning && refusedFor(error, /reasoning/i)) { reasoning = null; continue; }
			if (temperature && refusedFor(error, /temperature/i)) { temperature = false; continue; }
			if (mode !== 'none' && refusedFor(error, /response_format|json_schema|json_object|schema|structured/i)) {
				mode = mode === 'schema' ? 'object' : 'none';
				continue;
			}
			throw error;
		}
		modeCache.set(cacheKey, mode);
		const choice = data.choices?.[0];
		return {
			text: choice?.message?.content ?? '',
			truncated: choice?.finish_reason === 'length',
			usage: { in: data.usage?.prompt_tokens ?? 0, out: data.usage?.completion_tokens ?? 0 },
			costUsd: Number(data.usage?.cost) || 0,
			mode,
		};
	}
}

async function anthropicCall(api, system, messages, opts) {
	const cacheKey = `${api.baseUrl}|${api.model}`;
	let structured = modeCache.get(cacheKey) !== 'none';
	for (;;) {
		const body = {
			model: api.model,
			max_tokens: opts.maxTokens ?? MAX_TOKENS,
			// The instructions are the same on every call, so they are cached between calls.
			system: [{ type: 'text', text: `${system}\n\n${JSON_RULE}`, cache_control: { type: 'ephemeral' } }],
			messages,
		};
		if (structured) body.output_config = { format: { type: 'json_schema', schema: portableSchema() } };
		let data;
		try { data = await request(api, '/messages', { ...opts, body }); }
		catch (error) {
			if (structured && refusedFor(error, /output_config|format|schema/i)) { structured = false; continue; }
			throw error;
		}
		modeCache.set(cacheKey, structured ? 'schema' : 'none');
		return {
			text: (data.content ?? []).filter(b => b.type === 'text').map(b => b.text).join(''),
			truncated: data.stop_reason === 'max_tokens',
			usage: { in: (data.usage?.input_tokens ?? 0) + (data.usage?.cache_read_input_tokens ?? 0), out: data.usage?.output_tokens ?? 0 },
			costUsd: 0,
			mode: structured ? 'schema' : 'none',
		};
	}
}

async function ollamaCall(api, system, messages, opts) {
	// Ollama's own endpoint takes a schema and a context size; through its
	// OpenAI endpoint the context stays at a few thousand tokens and the start
	// of a Thai conversation is silently dropped.
	const base = { ...api, baseUrl: api.baseUrl.replace(/\/v1$/, '') };
	const data = await request(base, '/api/chat', {
		...opts,
		body: {
			model: api.model, stream: false, format: portableSchema(),
			messages: [{ role: 'system', content: system }, ...messages],
			options: { num_ctx: 16384, temperature: 0.2, num_predict: opts.maxTokens ?? MAX_TOKENS },
		},
	});
	return {
		text: data.message?.content ?? '',
		truncated: data.done_reason === 'length',
		usage: { in: data.prompt_eval_count ?? 0, out: data.eval_count ?? 0 },
		costUsd: 0,
		mode: 'schema',
	};
}

const callerFor = api => ({ anthropic: anthropicCall, ollama: ollamaCall })[(API_PRESETS[api.preset] ?? API_PRESETS.custom).kind] ?? openaiCall;

/**
 * Runs one summary through the API. Same shape as runClaude, plus token
 * counts. A reply that is cut off or is not a summary gets one chance to be
 * corrected before it counts as a failure.
 */
export async function runApi({ system, input, config, fetch = globalThis.fetch, sleep = defaultSleep }) {
	const api = apiSettings(config.summary);
	if (config.summary.localOnly && !isLocalUrl(api.baseUrl)) {
		throw new SummarizerError('เปิดโหมดในเครื่องเท่านั้นอยู่ จึงไม่ส่งบทสนทนาไปที่ API นอกเครื่อง', 'local_only');
	}
	const call = callerFor(api);
	const opts = { fetch, sleep, timeoutMs: config.summary.timeoutMs };
	const messages = [{ role: 'user', content: input }];
	let reply = await call(api, system, messages, opts);
	const usage = { ...reply.usage };
	try {
		if (reply.truncated) throw new SummarizerError('คำตอบยาวเกินจนถูกตัด', 'bad_output');
		return { summary: checkSummary(parseReply(reply.text)), costUsd: reply.costUsd, usage };
	}
	catch (error) {
		if (error.kind !== 'bad_output') throw error;
		reply = await call(api, system, [...messages, { role: 'assistant', content: reply.text.slice(0, 4000) || '{}' }, { role: 'user', content: REPAIR }], opts);
		usage.in += reply.usage.in;
		usage.out += reply.usage.out;
		if (reply.truncated) throw new SummarizerError('คำตอบยาวเกินจนถูกตัด แม้ลองใหม่แล้ว ลองโมเดลอื่น', 'bad_output');
		return { summary: checkSummary(parseReply(reply.text)), costUsd: reply.costUsd, usage };
	}
}

/** The models a provider offers, or [] when it has no list. */
async function listModels(api, opts) {
	const kind = (API_PRESETS[api.preset] ?? API_PRESETS.custom).kind;
	if (kind === 'ollama') {
		const data = await request({ ...api, baseUrl: api.baseUrl.replace(/\/v1$/, '') }, '/api/tags', opts);
		return (data.models ?? []).map(m => m.name ?? m.model).filter(Boolean).sort();
	}
	const data = await request(api, '/models', opts);
	return (data.data ?? data.models ?? []).map(m => String(m.id ?? m.name ?? '').replace(/^models\//, '')).filter(Boolean).sort();
}

/**
 * Checks an API the person is about to use: that the key is accepted, which
 * models it offers, and that the chosen model answers in JSON. Returns
 * { ok, message, models } and never throws.
 */
export async function testApi(api, { fetch = globalThis.fetch, sleep = defaultSleep, timeoutMs = 45000 } = {}) {
	const opts = { fetch, sleep, timeoutMs };
	let models = [];
	try { models = await listModels(api, opts); }
	catch (error) {
		// Some servers have no model list; a refused key or a server that is not there shows up here first.
		if (error.kind === 'auth' || /ต่อ .* ไม่ได้/.test(error.message)) return { ok: false, message: error.message, models };
	}
	if (!api.model) return { ok: false, message: 'ยังไม่ได้ใส่ชื่อโมเดล เลือกจากรายการที่มีให้', models };
	if (models.length && !models.includes(api.model)) {
		return { ok: false, message: `ไม่พบโมเดล ${api.model} ในรายการ เลือกจากรายการที่มีให้แทน`, models };
	}
	try {
		const reply = await callerFor(api)(api, 'ทดสอบการเชื่อมต่อ ตอบสั้นที่สุดตาม schema', [{ role: 'user', content: 'ทดสอบ' }], { ...opts, maxTokens: 600 });
		parseReply(reply.text);
		const how = { schema: 'ตอบตาม schema ได้', object: 'ตอบเป็น JSON ได้', none: 'ตอบเป็น JSON ได้เมื่อบอกใน prompt' }[reply.mode] ?? 'ตอบเป็น JSON ได้';
		return { ok: true, message: `ใช้ได้ ${api.model} ${how}`, models };
	}
	catch (error) {
		return { ok: false, message: error.message, models };
	}
}
