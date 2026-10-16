// The settings page edits config.local.json. Each field is checked here, and
// only the fields the page knows about are changed; anything else the person
// put in the file by hand stays as it was.

import fs from 'node:fs';
import path from 'node:path';
import { suggestRoots } from './setup.js';
import { API_PRESETS, apiSettings } from './summarizer.js';

export const MODELS = ['haiku', 'sonnet'];
export const OVERLAP_MODES = ['deny_once', 'ask', 'context', 'off'];
export const PROVIDERS = ['claude', 'api'];
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Checks the API fields from the page: a known preset, an address that is
 * https (or http on this machine, for Ollama) and a model name. Used both for
 * saving and for the test button.
 */
export function checkApi(input) {
	const preset = String(input?.preset ?? '');
	if (!API_PRESETS[preset]) throw new SettingsError('apiPreset', 'ไม่รู้จักผู้ให้บริการนี้');
	const baseUrl = String(input?.baseUrl ?? '').trim().replace(/\/+$/, '');
	let url;
	try { url = new URL(baseUrl); }
	catch { throw new SettingsError('apiBaseUrl', 'ที่อยู่ API ไม่ถูกต้อง ให้ใส่แบบ https://...'); }
	if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))) {
		throw new SettingsError('apiBaseUrl', 'ที่อยู่ API ต้องขึ้นต้นด้วย https:// ยกเว้นที่รันในเครื่องนี้');
	}
	const model = String(input?.model ?? '').trim();
	if (!model || model.length > 120 || /\s/.test(model)) throw new SettingsError('apiModel', 'ใส่ชื่อโมเดล เช่น gemini-2.5-flash');
	const apiKey = input?.apiKey === undefined ? undefined : String(input.apiKey).trim();
	if (apiKey && (apiKey.length > 400 || /\s/.test(apiKey))) throw new SettingsError('apiKey', 'API key ไม่ถูกต้อง');
	return { preset, baseUrl, model, apiKey };
}

/** The last four characters, enough to tell keys apart without showing them. */
const keyHint = key => (key ? key.slice(-4) : null);

/** A mistake the person can fix; the message is shown on the page as is. */
export class SettingsError extends Error {
	constructor(field, message) {
		super(message);
		this.field = field;
		this.status = 400;
	}
}

function folders(field, value) {
	if (!Array.isArray(value)) throw new SettingsError(field, 'รูปแบบรายการโฟลเดอร์ไม่ถูกต้อง');
	const out = [];
	for (const raw of value) {
		const folder = String(raw ?? '').trim();
		if (!folder) continue;
		if (folder.length > 500) throw new SettingsError(field, 'ชื่อโฟลเดอร์ยาวเกินไป');
		if (!path.isAbsolute(folder)) throw new SettingsError(field, `${folder} ไม่ใช่ที่อยู่เต็ม ให้ใส่แบบ E:\\projects`);
		if (field === 'roots' && !fs.existsSync(folder)) throw new SettingsError(field, `ไม่พบโฟลเดอร์ ${folder}`);
		if (!out.some(f => f.toLowerCase() === folder.toLowerCase())) out.push(folder);
	}
	if (out.length > 50) throw new SettingsError(field, 'ใส่ได้ไม่เกิน 50 โฟลเดอร์');
	return out;
}

function whole(field, value, min, max, unit) {
	const n = Number(value);
	if (!Number.isInteger(n) || n < min || n > max) throw new SettingsError(field, `ใส่ตัวเลข ${min} ถึง ${max} ${unit}`);
	return n;
}

/** What the page shows and edits. */
export function editable(db, config) {
	const cwds = db.raw.prepare('SELECT cwd FROM sessions WHERE is_automated = 0').all().map(r => r.cwd);
	const accounts = db.raw.prepare(`SELECT a.uuid, a.label, a.tool, COUNT(s.id) AS sessions
		FROM accounts a LEFT JOIN sessions s ON s.account_uuid = a.uuid
		WHERE a.tool = 'claude' GROUP BY a.uuid ORDER BY sessions DESC`).all();
	return {
		roots: config.roots,
		suggestedRoots: suggestRoots(cwds),
		exclude: config.exclude,
		accounts: accounts.map(a => ({ uuid: a.uuid, label: config.accounts?.[a.uuid] ?? a.label, sessions: a.sessions })),
		summary: {
			enabled: config.summary.enabled, model: config.summary.model, autoDays: config.summary.autoDays,
			provider: config.summary.provider === 'api' ? 'api' : 'claude',
			api: (({ preset, baseUrl, model }) => ({ preset, baseUrl, model }))(apiSettings(config.summary)),
			// Keys never leave the server; the page only learns which presets have one.
			keyHints: Object.fromEntries(Object.entries(config.summary.api?.keys ?? {}).map(([p, k]) => [p, keyHint(k)]).filter(([, h]) => h)),
			presets: API_PRESETS,
		},
		overlap: { windowMinutes: config.overlap.windowMinutes, preToolUse: config.overlap.preToolUse },
	};
}

/**
 * Returns the new file contents and which parts changed. input holds the
 * fields from the page; a field left out keeps its current value.
 */
export function merge(local, input, knownAccounts) {
	const next = structuredClone(local);
	const changed = { folders: false, accounts: false, summaryEnabled: false, updatesOn: false };
	if (input.roots !== undefined || input.exclude !== undefined) {
		const roots = input.roots === undefined ? local.roots ?? [] : folders('roots', input.roots);
		const exclude = input.exclude === undefined ? local.exclude ?? [] : folders('exclude', input.exclude);
		changed.folders = JSON.stringify(roots) !== JSON.stringify(local.roots ?? [])
			|| JSON.stringify(exclude) !== JSON.stringify(local.exclude ?? []);
		next.roots = roots;
		next.exclude = exclude;
	}
	if (input.accounts !== undefined) {
		if (!input.accounts || typeof input.accounts !== 'object') throw new SettingsError('accounts', 'รูปแบบชื่อบัญชีไม่ถูกต้อง');
		next.accounts = { ...local.accounts };
		for (const [uuid, raw] of Object.entries(input.accounts)) {
			if (!knownAccounts.has(uuid)) continue;
			const label = String(raw ?? '').trim();
			if (!label) throw new SettingsError('accounts', 'ชื่อบัญชีต้องไม่ว่าง');
			if (label.length > 40) throw new SettingsError('accounts', 'ชื่อบัญชียาวได้ไม่เกิน 40 ตัวอักษร');
			if (next.accounts[uuid] !== label) changed.accounts = true;
			next.accounts[uuid] = label;
		}
	}
	if (input.summary !== undefined) {
		const s = input.summary ?? {};
		const summary = { ...local.summary };
		if (s.enabled !== undefined) {
			if (typeof s.enabled !== 'boolean') throw new SettingsError('summary', 'รูปแบบการเปิดปิดไม่ถูกต้อง');
			changed.summaryEnabled = s.enabled !== (local.summary?.enabled ?? true);
			summary.enabled = s.enabled;
		}
		if (s.model !== undefined) {
			if (!MODELS.includes(s.model)) throw new SettingsError('summary', 'ไม่รู้จักโมเดลนี้');
			summary.model = s.model;
		}
		if (s.autoDays !== undefined) summary.autoDays = whole('autoDays', s.autoDays, 1, 60, 'วัน');
		if (s.provider !== undefined) {
			if (!PROVIDERS.includes(s.provider)) throw new SettingsError('summary', 'ไม่รู้จักวิธีสรุปนี้');
			summary.provider = s.provider;
		}
		if (s.api !== undefined) {
			const api = checkApi(s.api);
			const keys = { ...local.summary?.api?.keys };
			const keyUrls = { ...local.summary?.api?.keyUrls };
			// A key remembers the address it was given for (see savedKey).
			for (const p of Object.keys(keys)) {
				if (!keyUrls[p]) keyUrls[p] = local.summary?.api?.preset === p && local.summary.api.baseUrl ? local.summary.api.baseUrl : API_PRESETS[p]?.baseUrl;
			}
			// An empty key field keeps the key already saved; clearKey removes it.
			if (s.api.clearKey === true) { delete keys[api.preset]; delete keyUrls[api.preset]; }
			else if (api.apiKey) { keys[api.preset] = api.apiKey; keyUrls[api.preset] = api.baseUrl; }
			const preset = API_PRESETS[api.preset];
			summary.api = {
				preset: api.preset,
				// Values equal to the preset's are left empty, so a better default later reaches this person too.
				baseUrl: api.baseUrl === preset.baseUrl ? '' : api.baseUrl,
				model: api.model === preset.model ? '' : api.model,
				keys,
				keyUrls,
			};
		}
		next.summary = summary;
	}
	if (input.overlap !== undefined) {
		const o = input.overlap ?? {};
		const overlap = { ...local.overlap };
		if (o.windowMinutes !== undefined) overlap.windowMinutes = whole('windowMinutes', o.windowMinutes, 5, 240, 'นาที');
		if (o.preToolUse !== undefined) {
			if (!OVERLAP_MODES.includes(o.preToolUse)) throw new SettingsError('overlap', 'ไม่รู้จักวิธีเตือนนี้');
			overlap.preToolUse = o.preToolUse;
		}
		next.overlap = overlap;
	}
	if (input.updates !== undefined) {
		const auto = input.updates?.auto;
		if (typeof auto !== 'boolean') throw new SettingsError('updates', 'รูปแบบการเปิดปิดไม่ถูกต้อง');
		changed.updatesOn = auto && !(local.updates?.auto ?? true);
		next.updates = { ...local.updates, auto };
	}
	return { next, changed };
}
