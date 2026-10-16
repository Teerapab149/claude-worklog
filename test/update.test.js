import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createUpdater, isNewer, pickInstaller } from '../src/update.js';

test('versions compare part by part', () => {
	assert.equal(isNewer('0.2.0', '0.1.9'), true);
	assert.equal(isNewer('0.10.0', '0.9.0'), true);
	assert.equal(isNewer('0.1.0', '0.1.0'), false);
	assert.equal(isNewer('0.1.0', '1.0.0'), false);
});

test('only an installer named for the tag is picked', () => {
	const assets = [{ name: 'Worklog-Setup-0.2.0.exe' }, { name: 'notes.txt' }];
	assert.equal(pickInstaller({ tag_name: 'v0.2.0', assets }).version, '0.2.0');
	assert.equal(pickInstaller({ tag_name: 'v0.3.0', assets }), null);
});

function fakeGitHub(release, body) {
	const calls = [];
	const fetch = async url => {
		calls.push(url);
		if (url.includes('/releases/latest')) return release ? { ok: true, status: 200, json: async () => release } : { ok: false, status: 404 };
		return { ok: true, status: 200, arrayBuffer: async () => body };
	};
	return { fetch, calls };
}

test('a newer release is downloaded, checked, and run quietly once Worklog closes', async t => {
	const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-upd-')), 'updates');
	t.after(() => fs.rmSync(path.dirname(dir), { recursive: true, force: true }));
	const body = Buffer.from('installer bytes');
	const digest = `sha256:${crypto.createHash('sha256').update(body).digest('hex')}`;
	const asset = { name: 'Worklog-Setup-0.2.0.exe', size: body.length, digest, browser_download_url: 'https://example.invalid/x.exe' };
	const { fetch } = fakeGitHub({ tag_name: 'v0.2.0', assets: [asset] }, body);
	const ran = [];
	const run = (file, args) => { ran.push([file, args]); return { unref() {} }; };
	const updater = createUpdater({ dir, current: '0.1.0', enabled: () => true, fetch, run });

	const state = await updater.check();
	assert.equal(state.status, 'ready');
	assert.equal(state.latest, '0.2.0');
	assert.deepEqual(fs.readFileSync(path.join(dir, asset.name)), body);
	assert.equal(updater.installOnExit(), true);
	assert.equal(ran[0][0], path.join(dir, asset.name));
	assert.ok(ran[0][1].includes('/VERYSILENT'));
});

test('a download that does not match its digest is thrown away', async t => {
	const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'worklog-upd-')), 'updates');
	t.after(() => fs.rmSync(path.dirname(dir), { recursive: true, force: true }));
	const body = Buffer.from('tampered');
	const asset = { name: 'Worklog-Setup-0.2.0.exe', size: body.length, digest: 'sha256:' + '0'.repeat(64), browser_download_url: 'https://example.invalid/x.exe' };
	const { fetch } = fakeGitHub({ tag_name: 'v0.2.0', assets: [asset] }, body);
	const updater = createUpdater({ dir, current: '0.1.0', enabled: () => true, fetch, run: () => assert.fail('must not run') });
	assert.equal((await updater.check()).status, 'error');
	assert.deepEqual(fs.readdirSync(dir), []);
	assert.equal(updater.installOnExit(), false);
});

test('nothing is asked or run when switched off, up to date, or without a release', async () => {
	const off = fakeGitHub(null);
	assert.equal((await createUpdater({ dir: 'x', current: '0.1.0', enabled: () => false, fetch: off.fetch }).check()).status, 'off');
	assert.equal(off.calls.length, 0);
	const none = createUpdater({ dir: path.join(os.tmpdir(), 'worklog-none'), current: '0.1.0', enabled: () => true, fetch: fakeGitHub(null).fetch });
	assert.equal((await none.check()).status, 'latest');
	const same = createUpdater({ dir: path.join(os.tmpdir(), 'worklog-same'), current: '0.2.0', enabled: () => true,
		fetch: fakeGitHub({ tag_name: 'v0.2.0', assets: [{ name: 'Worklog-Setup-0.2.0.exe' }] }).fetch });
	assert.equal((await same.check()).status, 'latest');
	assert.equal(same.installOnExit(), false);
});
