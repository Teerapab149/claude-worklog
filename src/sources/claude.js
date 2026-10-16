// Claude Code: one .jsonl per session under <claudeDir>/projects/<folder>/.

import fs from 'node:fs';
import path from 'node:path';
import { assistantText, fileEdits, humanPrompt } from '../records.js';
import { applyRecord } from '../session-state.js';

export const claude = {
	tool: 'claude',
	label: 'Claude',

	listFiles(config) {
		const projectsDir = path.join(config.claudeDir, 'projects');
		if (!fs.existsSync(projectsDir)) return [];
		const files = [];
		for (const dir of fs.readdirSync(projectsDir, { withFileTypes: true })) {
			if (!dir.isDirectory()) continue;
			const dirPath = path.join(projectsDir, dir.name);
			for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
				if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path.join(dirPath, entry.name));
			}
		}
		return files;
	},

	sessionId: file => path.basename(file, '.jsonl'),

	prepare: () => ({}),

	apply: (s, r, hooks) => applyRecord(s, r, hooks),

	/** "always" to never read the file again, "until_changed" to drop it until it grows, or false. */
	skip: () => false,

	turn(r) {
		const human = humanPrompt(r);
		if (human) return { role: 'user', ts: r.timestamp, text: human };
		const reply = assistantText(r);
		return reply ? { role: 'assistant', ts: r.timestamp, text: reply } : null;
	},

	edits: r => fileEdits(r),
};
