// Summarizes a session or a project, either through the claude CLI in print
// mode on the person's own subscription, or through an AI API (see
// providers.js). This file holds the prompts and the claude CLI path; the
// shape and cleaning of a summary live in summary-format.js.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { apiSettings, runApi } from './providers.js';
import { SUMMARY_SCHEMA, SummarizerError, checkSummary } from './summary-format.js';

export { API_PRESETS, apiSettings, digestChars, isLocalUrl, runApi, testApi } from './providers.js';
export { SUMMARY_SCHEMA, SummarizerError, cleanSummary, cleanText } from './summary-format.js';
export { savedKeyFor } from './secrets.js';

const STYLE_RULES = `กฎการเขียน (สำคัญมาก):
- เขียนภาษาไทยธรรมดา ประโยคสั้น ชัด แบบที่คนเขียนโน้ตให้ตัวเอง ถ้าบทสนทนาเป็นภาษาอังกฤษ ก็สรุปเป็นภาษาไทย
- headline ไม่เกิน 120 ตัวอักษร แต่ละข้อในรายการยาวไม่เกินหนึ่งบรรทัด ขึ้นต้นด้วยคำกริยา เช่น "แก้", "เพิ่ม", "ตรวจ"
- ห้ามใช้จุดกึ่งกลาง (\u00B7) ลูกศร (\u2192 \u2190) em dash (\u2014) อีโมจิ ตัวหนา หรือสัญลักษณ์ตกแต่ง
- ห้ามใช้เครื่องหมาย + แทนคำว่า "และ"
- ห้ามขึ้นต้นด้วยคำเกริ่น เช่น "สรุป:" "โดยสรุป" "แน่นอน" "Here's"
- วันที่ใช้ปี ค.ศ. เสมอ
- ชื่อไฟล์ ชื่อโค้ด และศัพท์เทคนิค เขียนตามต้นฉบับได้

ตัวอย่าง headline ที่ดี: แก้หน้า login ให้จำบัญชีได้แล้ว เหลือทดสอบบนมือถือ
ตัวอย่างที่ไม่ควรเขียน: **สรุป:** ทำงานหลายอย่าง \u2014 login + ทดสอบ`;

export const SESSION_PROMPT = `คุณช่วยจดบันทึกงานที่ผู้ใช้ทำร่วมกับผู้ช่วย AI เขียนโค้ด (Claude Code, Codex หรือเครื่องมืออื่น) เพื่อให้ผู้ใช้กลับมาทำต่อได้ทันทีหลังจากหยุดไปหลายวัน
อ่านบทสนทนาของหนึ่ง session แล้วสรุปตาม schema:
- headline: ประโยคเดียว บอกว่า session นี้ทำงานอะไร และจบที่ตรงไหน
- status: done ถ้างานที่ขอเสร็จแล้ว, in_progress ถ้ายังทำค้าง, blocked ถ้าติดปัญหาที่ต้องแก้ก่อน, waiting ถ้ารอคนอื่นหรือรอผู้ใช้ตัดสินใจ, abandoned ถ้าเลิกทำไปแล้ว
- done: สิ่งที่ทำเสร็จจริงใน session นี้ (ไม่ใช่สิ่งที่วางแผนไว้)
- in_progress: สิ่งที่เริ่มแล้วแต่ยังไม่เสร็จ
- next_steps: สิ่งที่ควรทำต่อเป็นลำดับ เขียนให้ลงมือได้ทันที
- waiting_on: สิ่งที่รอจากคนอื่นหรือรอผู้ใช้ตอบ
- deadlines: กำหนดส่งหรือวันสอบที่ถูกพูดถึง แปลงเป็นวันที่จริงโดยอิงวันที่สรุปและเวลาในบทสนทนา
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

// The claude CLI's own wording when it is not signed in or out of quota.
function classify(message) {
	if (/not logged in|please run \/login|invalid api key|authentication_error|oauth token|credentials? (expired|invalid|not found)|401/i.test(message)) return 'auth';
	if (/rate.?limit|usage limit|limit reached|quota|overloaded/i.test(message)) return 'rate_limit';
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
			try {
				resolve({
					summary: checkSummary(raw),
					costUsd: Number(data.total_cost_usd) || 0,
					usage: { in: (data.usage?.input_tokens ?? 0) + (data.usage?.cache_read_input_tokens ?? 0), out: data.usage?.output_tokens ?? 0 },
				});
			}
			catch (error) { reject(error); }
		});
		child.stdin.end(input);
	});
}


/** Runs a summary with whichever summarizer the settings name right now. */
export function runSummary(args) {
	const summary = args.config.summary;
	if (summary.provider === 'api') return runApi(args);
	// The claude CLI always sends the conversation to Anthropic.
	if (summary.localOnly) return Promise.reject(new SummarizerError('เปิดโหมดในเครื่องเท่านั้นอยู่ จึงไม่ส่งบทสนทนาให้ claude CLI', 'local_only'));
	return runClaude(args);
}

/** The model name stored with a summary. */
export const summaryModel = summary => (summary.provider === 'api' ? apiSettings(summary).model : summary.model);

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

/**
 * Starts `claude auth login` in a window of its own, which takes the person
 * through signing in in their browser. Nothing has to be typed. Returns
 * false when there is no claude CLI to start.
 */
export function claudeLogin(config, { run = spawn } = {}) {
	const bin = resolveClaudeBin(config.summary.claudeBin);
	try {
		if (process.platform === 'win32') {
			// start opens a console the person can see; its first quoted argument is the window title.
			run('cmd', ['/c', `start "Worklog: เข้าสู่ระบบ Claude" "${bin}" auth login`], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' }).unref();
		}
		else run(bin, ['auth', 'login'], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
		return true;
	}
	catch {
		return false;
	}
}
