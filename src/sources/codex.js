// Codex: one rollout-<time>-<id>.jsonl per thread under <codexDir>/sessions/YYYY/MM/DD/.
// Thread names live in <codexDir>/session_index.jsonl.
//
// The conversation is read from item_completed events, which carry what the
// person typed (UserMessage), what Codex said (AgentMessage) and file edits
// (FileChange). Turns whose id starts with "external-import" are history
// copied in from another tool, so they are left out.

import fs from 'node:fs';
import path from 'node:path';
import { clip, markEvent } from '../session-state.js';

export const CODEX_ACCOUNT = 'codex';
const ID_IN_NAME = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

function itemText(item) {
	return (item?.content ?? [])
		.filter(c => typeof c?.text === 'string' && /^(text|input_text|output_text)$/i.test(c.type ?? ''))
		.map(c => c.text)
		.join('\n')
		.trim();
}

const isImported = r => String(r.payload?.turn_id ?? '').startsWith('external-import');

function completedItem(r) {
	if (r.type !== 'event_msg' || r.payload?.type !== 'item_completed') return null;
	if (isImported(r)) return null;
	return r.payload.item ?? null;
}

function readTitles(config) {
	const file = path.join(config.codexDir, 'session_index.jsonl');
	const titles = new Map();
	if (!fs.existsSync(file)) return titles;
	for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
		if (!line.trim()) continue;
		try {
			const r = JSON.parse(line);
			if (r.id && r.thread_name) titles.set(r.id, r.thread_name);
		}
		catch { /* a line being written */ }
	}
	return titles;
}

export const codex = {
	tool: 'codex',
	label: 'Codex',

	listFiles(config) {
		const root = path.join(config.codexDir, 'sessions');
		if (!fs.existsSync(root)) return [];
		const files = [];
		(function walk(dir) {
			for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
				const full = path.join(dir, entry.name);
				if (entry.isDirectory()) walk(full);
				else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(full);
			}
		})(root);
		return files;
	},

	sessionId: file => file.match(ID_IN_NAME)?.[1] ?? path.basename(file, '.jsonl'),

	prepare: config => ({ titles: readTitles(config) }),

	apply(s, r, { onEdit = () => {} } = {}, ctx = {}) {
		const ts = typeof r.timestamp === 'string' ? r.timestamp : null;
		if (ts) {
			if (!s.first_ts || ts < s.first_ts) s.first_ts = ts;
			if (!s.last_ts || ts > s.last_ts) s.last_ts = ts;
		}
		const p = r.payload ?? {};
		switch (r.type) {
			case 'session_meta':
				if (p.cwd) s.cwd = p.cwd;
				if (p.cli_version) s.version = p.cli_version;
				if (p.originator) s.entrypoint = p.originator;
				if (p.git?.branch) s.git_branch = p.git.branch;
				// Codex has no account id in its log, so every session shares one.
				s.account_uuid = CODEX_ACCOUNT;
				s.account_source = 'tool';
				if (p.source && typeof p.source === 'object' && p.source.subagent) s.is_subagent = 1;
				break;
			case 'turn_context':
				if (p.model) s.model = p.model;
				if (p.cwd && !s.cwd) s.cwd = p.cwd;
				break;
			case 'event_msg':
				if (p.type === 'thread_settings_applied' && p.thread_settings?.model) s.model = p.thread_settings.model;
				if (p.type === 'turn_aborted') markEvent(s, 'interrupted', ts);
				break;
		}
		if (ctx.titles?.has(s.id)) s.custom_title = ctx.titles.get(s.id);
		if (isImported(r)) s.imported_seen = 1;

		const turn = codex.turn(r);
		if (turn?.role === 'user') {
			s.human_turns += 1;
			s.last_human_text = clip(turn.text);
			s.last_human_ts = ts;
			markEvent(s, 'human', ts);
		}
		else if (turn?.role === 'assistant') {
			s.assistant_turns += 1;
			s.last_assistant_text = clip(turn.text);
			s.last_assistant_ts = ts;
			markEvent(s, 'assistant', ts);
		}
		for (const edit of codex.edits(r)) onEdit({ ts, ...edit });
		return s;
	},

	// Sub-agent threads are part of their parent's work, not sessions of their own.
	// A thread holding only history imported from another tool is a copy of
	// work already counted there, until someone continues it in Codex.
	skip(s) {
		if (s.is_subagent) return 'always';
		if (s.imported_seen && s.human_turns === 0) return 'until_changed';
		return false;
	},

	turn(r) {
		const item = completedItem(r);
		if (!item) return null;
		const text = itemText(item);
		if (!text) return null;
		if (item.type === 'UserMessage') return { role: 'user', ts: r.timestamp, text };
		if (item.type === 'AgentMessage' && !text.startsWith('[external_agent')) return { role: 'assistant', ts: r.timestamp, text };
		return null;
	},

	edits(r) {
		const item = completedItem(r);
		if (item?.type !== 'FileChange' || !item.changes || typeof item.changes !== 'object') return [];
		return Object.keys(item.changes).map(p => ({ path: p, tool: 'FileChange' }));
	},
};
