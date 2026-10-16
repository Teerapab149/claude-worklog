// Keeps an installed Worklog up to date from its GitHub releases. While the
// window is open it looks for a newer release, downloads that release's
// installer into the data folder and checks it, and once the window closes
// it runs the installer quietly, so the next start is the new version.
// A copy run from source never updates itself; git pull does that.

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const REPO = 'Teerapab149/claude-worklog';
const ASSET = /^Worklog-Setup-(\d+\.\d+\.\d+)\.exe$/;
const EVERY_MS = 6 * 3600 * 1000;
const DOWNLOAD_MS = 10 * 60 * 1000;

/** True when version a is later than version b (both x.y.z). */
export function isNewer(a, b) {
	const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
	for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
	return false;
}

/** The installer attached to a release, when its name and the tag agree on the version. */
export function pickInstaller(release) {
	const version = String(release?.tag_name ?? '').replace(/^v/, '');
	const asset = (release?.assets ?? []).find(a => ASSET.exec(a.name)?.[1] === version);
	return asset ? { version, asset } : null;
}

async function sha256(file) {
	const hash = crypto.createHash('sha256');
	for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
	return hash.digest('hex');
}

/**
 * dir holds the downloaded installer. enabled() is read before every check,
 * so the switch on the settings page takes effect at once.
 */
export function createUpdater({ dir, current, enabled, fetch = globalThis.fetch, log = () => {}, run = spawn }) {
	let state = { status: 'idle', current, latest: null, checkedAt: null, error: null, last: null };
	let file = null;
	let busy = null;
	let timer = null;
	// Outside dir, which is emptied whenever Worklog is up to date.
	const recordFile = path.join(path.dirname(dir), 'update.json');
	const installLog = path.join(path.dirname(dir), 'update-install.log');
	// What the last start of the installer was meant to do. If this start is
	// still the old version, that install failed: say so, and do not retry it
	// quietly on every close.
	let failedVersion = null;
	try {
		const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
		const ok = record.to === current;
		state.last = { ok, version: record.to, at: record.at };
		if (!ok) failedVersion = record.to;
		log(ok ? `อัปเดตเป็น ${record.to} แล้ว` : `อัปเดตเป็น ${record.to} ไม่สำเร็จ ดูรายละเอียดที่ ${installLog}`);
		fs.rmSync(recordFile, { force: true });
	}
	catch {
		// No install was started last time.
	}

	function runInstaller(visible) {
		fs.writeFileSync(recordFile, JSON.stringify({ from: current, to: state.latest, at: new Date().toISOString() }));
		const args = visible
			? ['/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/relaunch=1', `/LOG=${installLog}`]
			: ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', `/LOG=${installLog}`];
		run(file, args, { detached: true, stdio: 'ignore' }).unref();
		log(`เริ่มติดตั้ง Worklog ${state.latest}`);
	}

	async function download(asset, target) {
		// GitHub publishes each asset's SHA-256. Without one there is nothing to
		// check the file against, so it is never run.
		const digest = String(asset.digest ?? '');
		if (!/^sha256:[0-9a-f]{64}$/i.test(digest)) throw new Error('release นี้ไม่มีค่า SHA-256 ให้ตรวจ จึงไม่ดาวน์โหลด');
		const tmp = `${target}.part`;
		try {
			const res = await fetch(asset.browser_download_url, {
				headers: { 'user-agent': 'worklog-updater' }, signal: AbortSignal.timeout(DOWNLOAD_MS),
			});
			if (!res.ok || !res.body) throw new Error(`ดาวน์โหลดไม่สำเร็จ (HTTP ${res.status})`);
			// Straight to disk, so a 25 MB installer never sits in memory.
			await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
			if (asset.size && fs.statSync(tmp).size !== asset.size) throw new Error('ไฟล์ที่ดาวน์โหลดมาไม่ครบ');
			if ((await sha256(tmp)) !== digest.slice(7).toLowerCase()) throw new Error('ไฟล์ที่ดาวน์โหลดมาไม่ตรงกับที่ GitHub บอกไว้');
			fs.renameSync(tmp, target);
		}
		finally {
			fs.rmSync(tmp, { force: true });
		}
	}

	async function check() {
		if (!enabled()) {
			state = { ...state, status: 'off' };
			return state;
		}
		state = { ...state, status: 'checking', error: null };
		try {
			const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
				headers: { accept: 'application/vnd.github+json', 'user-agent': 'worklog-updater' },
			});
			state.checkedAt = new Date().toISOString();
			// No release yet looks the same as being up to date.
			if (res.status === 404) return (state = { ...state, status: 'latest' });
			if (!res.ok) throw new Error(`ถาม GitHub ไม่สำเร็จ (HTTP ${res.status})`);
			const found = pickInstaller(await res.json());
			if (!found || !isNewer(found.version, current)) {
				fs.rmSync(dir, { recursive: true, force: true });
				return (state = { ...state, status: 'latest', latest: found?.version ?? current });
			}
			fs.mkdirSync(dir, { recursive: true });
			const target = path.join(dir, found.asset.name);
			for (const name of fs.readdirSync(dir)) if (name !== found.asset.name) fs.rmSync(path.join(dir, name), { force: true });
			if (!fs.existsSync(target)) {
				state = { ...state, status: 'downloading', latest: found.version };
				await download(found.asset, target);
				log(`ดาวน์โหลด Worklog ${found.version} แล้ว จะติดตั้งเมื่อปิดหน้าต่าง`);
			}
			file = target;
			return (state = { ...state, status: 'ready', latest: found.version });
		}
		catch (error) {
			log(`ตรวจหาอัปเดตไม่สำเร็จ: ${error.message}`);
			return (state = { ...state, status: 'error', error: error.message });
		}
	}

	return {
		/** Looks now, then every few hours while Worklog stays open. */
		start() {
			this.check();
			timer = setInterval(() => this.check(), EVERY_MS);
			timer.unref?.();
		},
		check() {
			busy ??= check().finally(() => { busy = null; });
			return busy;
		},
		status: () => ({ ...state }),
		/** Runs the downloaded installer quietly once Worklog has closed. Returns true when it started one. */
		installOnExit() {
			clearInterval(timer);
			if (!enabled() || state.status !== 'ready' || !file || !fs.existsSync(file)) return false;
			if (state.latest === failedVersion) return false;
			runInstaller(false);
			return true;
		},
		/** Runs the installer now with its progress showing, then opens Worklog again. For the button on the settings page. */
		installNow() {
			clearInterval(timer);
			if (state.status !== 'ready' || !file || !fs.existsSync(file)) return false;
			runInstaller(true);
			return true;
		},
	};
}
