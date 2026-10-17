// API keys. On Windows a saved key is encrypted with DPAPI for the signed-in
// Windows user, so the settings file alone (a backup, a synced folder, another
// account on the PC) does not give the key away. Elsewhere it is kept as typed.
// A key in the environment, WORKLOG_<PRESET>_KEY, wins over a saved one.

import { spawnSync } from 'node:child_process';

const PS_PROTECT = `Add-Type -AssemblyName System.Security
[Console]::InputEncoding = [Text.Encoding]::UTF8
$s = [Console]::In.ReadToEnd()
[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($s), $null, 'CurrentUser'))`;
const PS_REVEAL = `Add-Type -AssemblyName System.Security
$b = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'CurrentUser'))`;

// The key goes in on stdin, never as an argument another process could read.
function powershell(script, input) {
	const out = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script],
		{ input, encoding: 'utf8', windowsHide: true, timeout: 20000 });
	if (out.status !== 0) throw new Error((out.stderr || 'powershell failed').trim().slice(0, 200));
	return out.stdout.trim();
}

/** What to store for a key the person typed. */
export function protectKey(key, { platform = process.platform, run = powershell } = {}) {
	if (platform !== 'win32') return key;
	try { return { dpapi: run(PS_PROTECT, key) }; }
	catch {
		// No DPAPI after all: keep the key usable rather than lose it.
		return key;
	}
}

// Decrypting runs PowerShell, so each stored key is decrypted once per run.
const revealed = new Map();

/** The key itself, from whatever was stored. '' when it cannot be read (another Windows user, another PC). */
export function revealKey(stored, { platform = process.platform, run = powershell } = {}) {
	if (typeof stored === 'string') return stored;
	if (!stored?.dpapi || platform !== 'win32') return '';
	if (!revealed.has(stored.dpapi)) {
		let key = '';
		try { key = Buffer.from(run(PS_REVEAL, stored.dpapi), 'base64').toString('utf8'); }
		catch { /* stays empty */ }
		revealed.set(stored.dpapi, key);
	}
	return revealed.get(stored.dpapi);
}

/** The last four characters, enough to tell keys apart without showing them. */
export const keyHint = stored => {
	const key = revealKey(stored);
	return key ? key.slice(-4) : null;
};

const trimUrl = url => String(url ?? '').replace(/\/+$/, '');

/**
 * The key to send for a preset at this address. A saved key goes only to the
 * address it was saved for, so changing the address, by hand or by a forged
 * request, can never send it somewhere else. Keys saved before addresses were
 * recorded belong to the address in use then. defaultBaseUrl is the preset's.
 */
export function savedKeyFor(summary, preset, baseUrl, { env = process.env, defaultBaseUrl } = {}) {
	const fromEnv = env[`WORKLOG_${preset.toUpperCase()}_KEY`];
	if (fromEnv) return fromEnv.trim();
	const api = summary?.api ?? {};
	const stored = api.keys?.[preset];
	if (!stored) return '';
	const own = api.keyUrls?.[preset] ?? (api.preset === preset && api.baseUrl ? api.baseUrl : defaultBaseUrl ?? baseUrl);
	return trimUrl(own) === trimUrl(baseUrl) ? revealKey(stored) : '';
}
