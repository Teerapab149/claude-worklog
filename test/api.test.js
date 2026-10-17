import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { protectKey, revealKey, savedKeyFor } from '../src/secrets.js';
import { checkApi, editable, merge, SettingsError } from '../src/settings.js';
import { apiSettings, runApi, runSummary, testApi } from '../src/summarizer.js';

const SUMMARY = { headline: 'ทำหน้า A เสร็จแล้ว', status: 'done', done: ['หน้า A'], in_progress: [], next_steps: [], waiting_on: [], deadlines: [] };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const chat = (content, extra = {}) => json({ choices: [{ message: { content }, finish_reason: 'stop', ...extra }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
const fail = (status, message, headers) => json({ error: { message } }, status, headers);
const noSleep = async () => {};
const apiConfig = (preset, extra = {}) => resolveConfig({ summary: { provider: 'api', api: { preset, keys: { [preset]: 'k-123' }, ...extra } } });

test('presets fill the address and model, and a key is kept per preset', () => {
	const api = apiSettings({ api: { preset: 'groq', keys: { groq: 'gsk_1', gemini: 'AIza' } } });
	assert.equal(api.baseUrl, 'https://api.groq.com/openai/v1');
	assert.equal(api.apiKey, 'gsk_1');
	assert.equal(apiSettings({ api: { preset: 'ollama', baseUrl: 'http://localhost:11434/', model: 'llama3' } }).baseUrl, 'http://localhost:11434');
	assert.equal(apiSettings({}).preset, 'gemini');
	assert.equal(apiSettings({}).model, 'gemini-3.5-flash-lite');
});

test('an OpenAI-style call asks for the schema, sends the key the way the provider wants, and cleans the reply', async () => {
	let sent;
	const fetch = async (url, init) => {
		sent = { url, headers: init.headers, body: JSON.parse(init.body) };
		return chat('```json\n' + JSON.stringify({ ...SUMMARY, headline: 'ทำหน้า A \u2014 **เสร็จ**', done: ['1', '2', '3', '4', '5', '6', '7', '8'] }) + '\n```');
	};
	const out = await runApi({ system: 'S', input: 'I', config: apiConfig('gemini'), fetch, sleep: noSleep });
	assert.equal(sent.url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
	assert.equal(sent.headers.authorization, 'Bearer k-123');
	assert.equal(sent.body.response_format.type, 'json_schema');
	assert.equal(JSON.stringify(sent.body.response_format).includes('maxItems'), false);
	assert.equal(sent.body.reasoning_effort, 'minimal');
	assert.equal(sent.body.max_tokens, 2000);
	assert.equal(out.summary.headline, 'ทำหน้า A, เสร็จ');
	assert.equal(out.summary.done.length, 6);
	assert.deepEqual(out.usage, { in: 100, out: 20 });

	// Azure takes the key in its own header.
	await runApi({ system: 'S', input: 'I', config: apiConfig('azure', { baseUrl: 'https://x.openai.azure.com/openai/v1', model: 'm', keyUrls: { azure: 'https://x.openai.azure.com/openai/v1' } }), fetch, sleep: noSleep });
	assert.equal(sent.headers['api-key'], 'k-123');
	assert.equal(sent.headers.authorization, undefined);
});

test('a provider that refuses the schema, reasoning or temperature is asked again without it', async () => {
	const bodies = [];
	const fetch = async (url, init) => {
		const body = JSON.parse(init.body);
		bodies.push(body);
		if (body.reasoning_effort) return fail(400, 'Unrecognized request argument supplied: reasoning_effort');
		if (body.response_format?.type === 'json_schema') return fail(400, "'response_format.type' must be 'json_object' or 'text'");
		if ('temperature' in body) return fail(400, 'temperature is not supported with this model');
		return chat(JSON.stringify(SUMMARY));
	};
	const config = resolveConfig({ summary: { provider: 'api', api: { preset: 'groq', model: 'refuser-2', keys: { groq: 'k' } } } });
	const out = await runApi({ system: 'S', input: 'I', config, fetch, sleep: noSleep });
	assert.equal(out.summary.status, 'done');
	const last = bodies.at(-1);
	assert.equal(last.reasoning_effort, undefined);
	assert.equal(last.temperature, undefined);
	assert.equal(last.response_format.type, 'json_object');
});

test('server errors are retried, Retry-After is kept, and a daily quota waits for the day to turn', async () => {
	let calls = 0;
	const flaky = async () => (++calls < 3 ? fail(503, 'overloaded') : chat(JSON.stringify(SUMMARY)));
	assert.equal((await runApi({ system: 'S', input: 'I', config: apiConfig('groq'), fetch: flaky, sleep: noSleep })).summary.status, 'done');
	assert.equal(calls, 3);

	const limited = await runApi({ system: 'S', input: 'I', config: apiConfig('groq'), fetch: async () => fail(429, 'Rate limit reached', { 'retry-after': '42' }), sleep: noSleep }).catch(e => e);
	assert.equal(limited.kind, 'rate_limit');
	assert.equal(limited.retryAfterMs, 42000);
	const daily = await runApi({ system: 'S', input: 'I', config: apiConfig('gemini'), fetch: async () => fail(429, 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 1000 per day'), sleep: noSleep }).catch(e => e);
	// Until midnight in California, never more than a day.
	assert.ok(daily.retryAfterMs > 0 && daily.retryAfterMs <= 24 * 3600 * 1000);
});

test('a reply that is not a summary gets one repair, then counts as bad output', async () => {
	const seen = [];
	let n = 0;
	const fetch = async (url, init) => {
		seen.push(JSON.parse(init.body).messages.length);
		return chat(++n === 1 ? '{"ok": true}' : JSON.stringify(SUMMARY));
	};
	assert.equal((await runApi({ system: 'S', input: 'I', config: apiConfig('groq'), fetch, sleep: noSleep })).summary.headline, SUMMARY.headline);
	assert.deepEqual(seen, [2, 4]);
	const never = await runApi({ system: 'S', input: 'I', config: apiConfig('groq'), fetch: async () => chat('no json here'), sleep: noSleep }).catch(e => e);
	assert.equal(never.kind, 'bad_output');
	const cut = await runApi({ system: 'S', input: 'I', config: apiConfig('groq'), fetch: async () => chat('{"headline": "x', { finish_reason: 'length' }), sleep: noSleep }).catch(e => e);
	assert.equal(cut.kind, 'bad_output');
});

test('Anthropic and Ollama are called the way each of them works', async () => {
	let sent;
	const anthropic = async (url, init) => {
		sent = { url, headers: init.headers, body: JSON.parse(init.body) };
		return json({ content: [{ type: 'text', text: JSON.stringify(SUMMARY) }], stop_reason: 'end_turn', usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 5 } });
	};
	const out = await runApi({ system: 'S', input: 'I', config: apiConfig('anthropic'), fetch: anthropic, sleep: noSleep });
	assert.equal(sent.url, 'https://api.anthropic.com/v1/messages');
	assert.equal(sent.headers['x-api-key'], 'k-123');
	assert.equal(sent.headers['anthropic-version'], '2023-06-01');
	assert.deepEqual(sent.body.system[0].cache_control, { type: 'ephemeral' });
	assert.equal(sent.body.output_config.format.type, 'json_schema');
	assert.deepEqual(out.usage, { in: 100, out: 5 });

	const ollama = async (url, init) => {
		sent = { url, headers: init.headers, body: JSON.parse(init.body) };
		return json({ message: { content: JSON.stringify(SUMMARY) }, done_reason: 'stop', prompt_eval_count: 7, eval_count: 3 });
	};
	const local = resolveConfig({ summary: { provider: 'api', api: { preset: 'ollama', baseUrl: 'http://localhost:11434/v1' } } });
	await runApi({ system: 'S', input: 'I', config: local, fetch: ollama, sleep: noSleep });
	assert.equal(sent.url, 'http://localhost:11434/api/chat');
	assert.equal(sent.body.options.num_ctx, 16384);
	assert.equal(sent.body.format.type, 'object');
	assert.equal(sent.headers.authorization, undefined);
});

test('a missing key, a refused key and local-only mode stop before anything is sent', async () => {
	const kindOf = async (config, fetch) => (await runApi({ system: 'S', input: 'I', config, fetch, sleep: noSleep }).catch(e => e)).kind;
	assert.equal(await kindOf(resolveConfig({ summary: { provider: 'api', api: { preset: 'groq' } } }), async () => assert.fail('must not call')), 'auth');
	assert.equal(await kindOf(apiConfig('groq'), async () => fail(401, 'Invalid API Key')), 'auth');
	assert.equal(await kindOf(apiConfig('gemini'), async () => json([{ error: { message: 'API key not valid. Please pass a valid API key.' } }], 400)), 'auth');
	const localOnly = resolveConfig({ summary: { provider: 'api', localOnly: true, api: { preset: 'groq', keys: { groq: 'k' } } } });
	assert.equal(await kindOf(localOnly, async () => assert.fail('must not call')), 'local_only');
	const cli = resolveConfig({ summary: { provider: 'claude', localOnly: true } });
	assert.equal((await runSummary({ system: 'S', input: 'I', config: cli }).catch(e => e)).kind, 'local_only');
});

test('the test button reports a refused key, a missing model, and a working one', async () => {
	const api = apiSettings({ api: { preset: 'groq', keys: { groq: 'k' } } });
	const models = () => json({ data: [{ id: 'openai/gpt-oss-120b' }, { id: 'llama-3.3-70b-versatile' }] });
	assert.equal((await testApi(api, { fetch: async () => fail(401, 'Invalid API Key'), sleep: noSleep })).ok, false);
	const missing = await testApi({ ...api, model: 'nope' }, { fetch: async () => models(), sleep: noSleep });
	assert.equal(missing.ok, false);
	assert.deepEqual(missing.models, ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b']);
	const good = await testApi(api, { fetch: async url => (url.endsWith('/models') ? models() : chat(JSON.stringify(SUMMARY))), sleep: noSleep });
	assert.equal(good.ok, true);
	const ollama = apiSettings({ api: { preset: 'ollama' } });
	const listed = await testApi(ollama, { fetch: async url => (url.endsWith('/api/tags') ? json({ models: [{ name: 'qwen3:8b' }] }) : json({ message: { content: JSON.stringify(SUMMARY) } })), sleep: noSleep });
	assert.deepEqual([listed.ok, listed.models], [true, ['qwen3:8b']]);
});

test('keys are encrypted on Windows, read from the environment first, and only sent to their own address', () => {
	const fake = (script, input) => (script.includes('Unprotect') ? Buffer.from(`k:${Buffer.from(input, 'base64').toString()}`).toString('base64') : Buffer.from(input).toString('base64'));
	const stored = protectKey('secret', { platform: 'win32', run: fake });
	assert.ok(stored.dpapi);
	assert.equal(revealKey(stored, { platform: 'win32', run: fake }), 'k:secret');
	assert.equal(protectKey('secret', { platform: 'linux' }), 'secret');
	const summary = { api: { preset: 'groq', keys: { groq: 'saved' } } };
	assert.equal(savedKeyFor(summary, 'groq', 'https://api.groq.com/openai/v1', { env: { WORKLOG_GROQ_KEY: 'from-env' } }), 'from-env');
	assert.equal(savedKeyFor(summary, 'groq', 'https://evil.example/v1', { env: {}, defaultBaseUrl: 'https://api.groq.com/openai/v1' }), '');
});

test('API settings refuse plain http off this machine and keep keys away from the page', () => {
	assert.throws(() => checkApi({ preset: 'custom', baseUrl: 'http://example.com/v1', model: 'm' }), e => e instanceof SettingsError && e.field === 'apiBaseUrl');
	assert.equal(checkApi({ preset: 'ollama', baseUrl: 'http://localhost:11434', model: 'qwen3:8b' }).baseUrl, 'http://localhost:11434');
	assert.throws(() => checkApi({ preset: 'gemini', baseUrl: 'https://x.dev', model: '' }), e => e.field === 'apiModel');

	const local = { summary: { api: { preset: 'gemini', keys: { gemini: 'AIza-old', groq: 'gsk-1' } } } };
	const gemini = { preset: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.5-flash-lite' };
	// An empty key keeps the saved one, and preset defaults are stored as empty.
	let next = merge(local, { summary: { provider: 'api', api: { ...gemini, apiKey: '' } } }, new Set()).next;
	assert.deepEqual(Object.fromEntries(Object.entries(next.summary.api.keys).map(([p, k]) => [p, revealKey(k)])), { gemini: 'AIza-old', groq: 'gsk-1' });
	assert.equal(next.summary.api.baseUrl, '');
	assert.equal(next.summary.api.model, '');
	assert.equal(next.summary.api.keyUrls.groq, 'https://api.groq.com/openai/v1');
	// Pointing the preset somewhere else does not carry the saved key along.
	const moved = merge(local, { summary: { api: { ...gemini, baseUrl: 'https://evil.example/v1' } } }, new Set()).next;
	assert.equal(apiSettings(moved.summary).apiKey, '');
	assert.equal(apiSettings(next.summary).apiKey, 'AIza-old');
	next = merge(local, { summary: { api: { ...gemini, apiKey: 'AIza-new' } } }, new Set()).next;
	assert.equal(apiSettings(next.summary).apiKey, 'AIza-new');
	next = merge(local, { summary: { api: { ...gemini, clearKey: true } } }, new Set()).next;
	assert.deepEqual(Object.keys(next.summary.api.keys), ['groq']);
	assert.equal(revealKey(next.summary.api.keys.groq), 'gsk-1');

	const db = openDb(':memory:');
	const shown = editable(db, resolveConfig(local));
	assert.deepEqual(shown.summary.keyHints, { gemini: '-old', groq: 'sk-1' });
	assert.equal(JSON.stringify(shown).includes('AIza-old'), false);
	db.close();
});

test('the claude login check reads auth status and copes with a missing or old CLI', async () => {
	const { claudeStatus } = await import('../src/summarizer.js');
	const config = resolveConfig({ summary: { claudeBin: 'claude' } });
	const fakeRun = (stdout, { fail: error } = {}) => () => {
		const handlers = {};
		const child = {
			stdout: { on: (_, f) => { if (stdout) setImmediate(() => f(Buffer.from(stdout))); } },
			on: (event, f) => { handlers[event] = f; },
			kill() {},
		};
		setImmediate(() => setImmediate(() => (error ? handlers.error?.(error) : handlers.close?.(0))));
		return child;
	};
	assert.deepEqual(await claudeStatus(config, { run: fakeRun('{"loggedIn":true,"email":"a@b.c","subscriptionType":"max"}') }),
		{ found: true, loggedIn: true, email: 'a@b.c', plan: 'max' });
	assert.equal((await claudeStatus(config, { run: fakeRun('{"loggedIn":false}') })).loggedIn, false);
	assert.equal((await claudeStatus(config, { run: fakeRun('Unknown command: auth') })).found, true);
	assert.equal((await claudeStatus(config, { run: fakeRun('', { fail: Object.assign(new Error('x'), { code: 'ENOENT' }) }) })).found, false);
});
