import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULTS = {
	// Where Claude Code keeps its state. null means CLAUDE_CONFIG_DIR, then ~/.claude.
	claudeDir: null,
	// Where Codex keeps its state. null means CODEX_HOME, then ~/.codex.
	codexDir: null,
	// Which tools to read. A tool whose folder does not exist is skipped anyway.
	sources: { claude: true, codex: true },
	// Folders whose direct children count as projects (E:\Research, E:\shop ...).
	// A session outside every root is grouped by its own folder.
	roots: [],
	// Sessions whose working folder starts with one of these are ignored.
	exclude: [],
	// Display names keyed by folder name.
	projectNames: {},
	// Display names keyed by account uuid.
	accounts: {},
	// A session with no account in its log borrows the account of the closest
	// session in time, but only when the gap is at most this many hours.
	inferAccountWindowHours: 6,
	dataDir: 'data',
	overlap: {
		// Two sessions editing one file this close together count as overlapping.
		windowMinutes: 30,
		// What the PreToolUse hook does when it finds one:
		// deny_once stops the first edit and tells Claude why, the retry goes through.
		// ask hands the decision to the person. context only adds a note,
		// which Claude reads after the edit. off does nothing.
		preToolUse: 'deny_once',
	},
	summary: {
		enabled: true,
		model: 'haiku',
		// Sessions with new messages in this many days are summarized on their own.
		// Older ones only when asked from the page.
		autoDays: 7,
		maxChars: 24000,
		timeoutMs: 180000,
		// Path to the claude executable, when it is not on PATH.
		claudeBin: null,
	},
};

export const configFile = () => process.env.WORKLOG_CONFIG || path.join(APP_ROOT, 'config.local.json');

/** What the person set in the file, without the defaults filled in. */
export function readLocalConfig(file = configFile()) {
	return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

/** Writes the file through a temporary one, so a crash never leaves it half written. */
export function writeLocalConfig(local, file = configFile()) {
	const tmp = `${file}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(local, null, 2) + '\n');
	fs.renameSync(tmp, file);
}

export function loadConfig(file = configFile()) {
	let local = {};
	if (fs.existsSync(file)) local = JSON.parse(fs.readFileSync(file, 'utf8'));
	return resolveConfig(local);
}

export function resolveConfig(overrides = {}) {
	const config = {
		...DEFAULTS,
		...overrides,
		overlap: { ...DEFAULTS.overlap, ...overrides.overlap },
		summary: { ...DEFAULTS.summary, ...overrides.summary },
	};
	config.claudeDir = config.claudeDir || process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
	config.codexDir = config.codexDir || process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
	config.sources = { ...DEFAULTS.sources, ...overrides.sources };
	config.dataDir = path.resolve(APP_ROOT, config.dataDir);
	return config;
}
