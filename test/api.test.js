import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveConfig } from '../src/config.js';
import { checkApi, editable, merge, SettingsError } from '../src/settings.js';
import { apiSettings, runApi, runSummary, testApi } from '../src/summarizer.js';
import { openDb } from '../src/db.js';

const reply = (content, extra = {}) => ({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content } }], ...extra }) });
const fail = (status, message) => ({ ok: false, status, text: async () => JSON.stringify({ error: { message } }) });

test('presets fill the address and model, and a key is kept per preset', () => {
	const api = apiSettings({ api: { preset: 'groq', keys: { groq: 'gsk_1', gemini: 'AIza' } } });
	assert.equal(api.baseUrl, 'https://api.groq.com/openai/v1');
	assert.equal(api.apiKey, 'gsk_1');
	assert.equal(apiSettings({ api: { preset: 'ollama', baseUrl: 'http://localhost:11434/v1/', model: 'llama3' } }).baseUrl, 'http://localhost:11434/v1');
	assert.equal(apiSettings({}).preset, 'gemini');
});

test('a summary through the API sends the key, asks for JSON and cleans the reply', async () => {
	const config = resolveConfig({ summary: { provider: 'api', api: { preset: 'gemini', keys: { gemini: 'AIza-key' } } } });
	let sent;
	const fetch = async (url, init) => {
		sent = { url, init, body: JSON.parse(init.body) };
		return reply('```json\n{"headline":"ทำหน้า A \u2014 เสร็จแล้ว","status":"done","done":["หน้า A"],"in_progress":[],"next_steps":[],"waiting_on":[],"deadlines":[]}\n```');
	};
	const out = await runApi({ system: 'S', input: 'I', config, fetch });
	assert.equal(sent.url, 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
	assert.equal(sent.init.headers.authorization, 'Bearer AIza-key');
	assert.equal(sent.body.model, 'gemini-2.5-flash');
	assert.deepEqual(sent.body.response_format, { type: 'json_object' });
	assert.match(sent.body.messages[0].content, /JSON Schema/);
	assert.equal(out.summary.headline, 'ทำหน้า A, เสร็จแล้ว');
	assert.equal(out.summary.status, 'done');
});

test('API failures become the error kinds the queue already knows', async () => {
	const config = resolveConfig({ summary: { provider: 'api', api: { preset: 'groq', keys: { groq: 'k' } } } });
	const kindOf = async res => (await runApi({ system: 'S', input: 'I', config, fetch: async () => res }).catch(e => e)).kind;
	assert.equal(await kindOf(fail(401, 'Invalid API Key')), 'auth');
	assert.equal(await kindOf(fail(429, 'Rate limit')), 'rate_limit');
	assert.equal(await kindOf(fail(500, 'boom')), 'failed');
	assert.equal(await kindOf(reply('no json here')), 'bad_output');
	const noKey = resolveConfig({ summary: { provider: 'api', api: { preset: 'groq' } } });
	const error = await runApi({ system: 'S', input: 'I', config: noKey, fetch: async () => assert.fail('must not call') }).catch(e => e);
	assert.equal(error.kind, 'auth');
	// Ollama needs no key.
	const local = resolveConfig({ summary: { provider: 'api', api: { preset: 'ollama' } } });
	const ok = await runApi({ system: 'S', input: 'I', config: local, fetch: async () => reply('{"headline":"x","status":"done"}') });
	assert.equal(ok.summary.headline, 'x');
});

test('runSummary picks the summarizer the settings name', async () => {
	const config = resolveConfig({ summary: { provider: 'api', api: { preset: 'ollama' } } });
	const original = globalThis.fetch;
	globalThis.fetch = async () => reply('{"headline":"จาก API","status":"in_progress"}');
	try { assert.equal((await runSummary({ system: 'S', input: 'I', config })).summary.headline, 'จาก API'); }
	finally { globalThis.fetch = original; }
});

test('the test button reports a refused key, a missing model, and a working one', async () => {
	const api = { ...apiSettings({ api: { preset: 'groq', keys: { groq: 'k' } } }) };
	const models = { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'openai/gpt-oss-120b' }, { id: 'llama-3.3-70b-versatile' }] }) };
	assert.equal((await testApi(api, { fetch: async () => fail(401, 'Invalid API Key') })).ok, false);
	const missing = await testApi({ ...api, model: 'nope' }, { fetch: async () => models });
	assert.equal(missing.ok, false);
	assert.deepEqual(missing.models, ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b']);
	const good = await testApi(api, { fetch: async url => (url.endsWith('/models') ? models : reply('{"ok": true}')) });
	assert.equal(good.ok, true);
});

test('API settings refuse plain http off this machine and keep keys away from the page', () => {
	assert.throws(() => checkApi({ preset: 'custom', baseUrl: 'http://example.com/v1', model: 'm' }), e => e instanceof SettingsError && e.field === 'apiBaseUrl');
	assert.equal(checkApi({ preset: 'ollama', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b' }).baseUrl, 'http://localhost:11434/v1');
	assert.throws(() => checkApi({ preset: 'gemini', baseUrl: 'https://x.dev', model: '' }), e => e.field === 'apiModel');

	const local = { summary: { api: { preset: 'gemini', keys: { gemini: 'AIza-old', groq: 'gsk-1' } } } };
	const gemini = { preset: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' };
	// An empty key keeps the saved one, and preset defaults are stored as empty.
	let next = merge(local, { summary: { provider: 'api', api: { ...gemini, apiKey: '' } } }, new Set()).next;
	assert.deepEqual(next.summary.api, { preset: 'gemini', baseUrl: '', model: '', keys: { gemini: 'AIza-old', groq: 'gsk-1' } });
	next = merge(local, { summary: { api: { ...gemini, apiKey: 'AIza-new' } } }, new Set()).next;
	assert.equal(next.summary.api.keys.gemini, 'AIza-new');
	next = merge(local, { summary: { api: { ...gemini, clearKey: true } } }, new Set()).next;
	assert.deepEqual(next.summary.api.keys, { groq: 'gsk-1' });

	const db = openDb(':memory:');
	const shown = editable(db, resolveConfig(local));
	assert.deepEqual(shown.summary.keyHints, { gemini: '-old', groq: 'sk-1' });
	assert.equal(JSON.stringify(shown).includes('AIza-old'), false);
	db.close();
});

test('the claude login check reads auth status and copes with a missing or old CLI', async () => {
	const { claudeStatus } = await import('../src/summarizer.js');
	const config = resolveConfig({ summary: { claudeBin: 'claude' } });
	const fakeRun = (stdout, { fail } = {}) => () => {
		const handlers = {};
		const child = {
			stdout: { on: (_, f) => { if (stdout) setImmediate(() => f(Buffer.from(stdout))); } },
			on: (event, f) => { handlers[event] = f; },
			kill() {},
		};
		setImmediate(() => setImmediate(() => (fail ? handlers.error?.(fail) : handlers.close?.(0))));
		return child;
	};
	assert.deepEqual(await claudeStatus(config, { run: fakeRun('{"loggedIn":true,"email":"a@b.c","subscriptionType":"max"}') }),
		{ found: true, loggedIn: true, email: 'a@b.c', plan: 'max' });
	assert.equal((await claudeStatus(config, { run: fakeRun('{"loggedIn":false}') })).loggedIn, false);
	assert.equal((await claudeStatus(config, { run: fakeRun('Unknown command: auth') })).found, true);
	assert.equal((await claudeStatus(config, { run: fakeRun('', { fail: Object.assign(new Error('x'), { code: 'ENOENT' }) }) })).found, false);
});
