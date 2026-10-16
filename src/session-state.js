// Folds the records of one session log into a single row. A scan may stop
// halfway through a file and resume later, so every field is updated from
// one record at a time and the row can be saved and reloaded in between.

import { assistantText, fileEdits, humanPrompt, isInterruption, isRateLimited, isScheduledTurn } from './records.js';

const TEXT_LIMIT = 2000;

export function clip(text) {
	return text && text.length > TEXT_LIMIT ? text.slice(0, TEXT_LIMIT) + '…' : text;
}

export function emptySession(id, jsonlPath, tool = 'claude') {
	return {
		id,
		tool,
		jsonl_path: jsonlPath,
		project_key: null,
		cwd: null,
		account_uuid: null,
		account_source: null,
		custom_title: null,
		ai_title: null,
		first_ts: null,
		last_ts: null,
		last_prompt: null,
		last_human_text: null,
		last_human_ts: null,
		last_assistant_text: null,
		last_assistant_ts: null,
		human_turns: 0,
		assistant_turns: 0,
		scheduled_turns: 0,
		last_event: null,
		last_event_ts: null,
		is_automated: 0,
		end_state: null,
		model: null,
		git_branch: null,
		version: null,
		entrypoint: null,
		pr_url: null,
	};
}

/**
 * Applies one record. onEdit(edit) and onQuota(quota) receive the side rows
 * that belong in their own tables.
 */
export function applyRecord(s, r, { onEdit = () => {}, onQuota = () => {} } = {}) {
	const ts = typeof r.timestamp === 'string' ? r.timestamp : null;
	if (ts && !r.isSidechain) {
		if (!s.first_ts || ts < s.first_ts) s.first_ts = ts;
		if (!s.last_ts || ts > s.last_ts) s.last_ts = ts;
	}
	if (typeof r.cwd === 'string' && r.cwd && !s.cwd) s.cwd = r.cwd;
	if (r.version) s.version = r.version;
	if (r.entrypoint) s.entrypoint = r.entrypoint;
	if (r.gitBranch) s.git_branch = r.gitBranch;

	switch (r.type) {
		case 'bridge-session':
			if (r.ownerAccountUuid) {
				s.account_uuid = r.ownerAccountUuid;
				s.account_source = 'log';
			}
			break;
		case 'custom-title':
			if (r.customTitle) s.custom_title = r.customTitle;
			break;
		case 'ai-title':
			if (r.aiTitle) s.ai_title = r.aiTitle;
			break;
		case 'last-prompt':
			if (r.lastPrompt) s.last_prompt = clip(r.lastPrompt);
			break;
		case 'relocated':
			if (typeof r.relocatedCwd === 'string' && r.relocatedCwd) s.cwd = r.relocatedCwd;
			break;
		case 'pr-link':
			if (r.prUrl) s.pr_url = r.prUrl;
			break;
		case 'user': {
			if (r.isSidechain) break;
			if (isScheduledTurn(r)) s.scheduled_turns += 1;
			const text = humanPrompt(r);
			if (text) {
				s.human_turns += 1;
				s.last_human_text = clip(text);
				s.last_human_ts = ts;
				markEvent(s, 'human', ts);
			}
			else if (isInterruption(r)) markEvent(s, 'interrupted', ts);
			break;
		}
		case 'assistant': {
			if (r.isSidechain) break;
			if (r.quotaLimits && ts) onQuota({ ts, ...r.quotaLimits });
			if (isRateLimited(r)) {
				markEvent(s, 'rate_limited', ts);
				break;
			}
			const model = r.message?.model;
			if (model && model !== '<synthetic>') s.model = model;
			const text = assistantText(r);
			if (text) {
				s.assistant_turns += 1;
				s.last_assistant_text = clip(text);
				s.last_assistant_ts = ts;
				markEvent(s, 'assistant', ts);
			}
			for (const edit of fileEdits(r)) onEdit({ ts, ...edit });
			break;
		}
	}
	return s;
}

export function markEvent(s, event, ts) {
	if (ts && s.last_event_ts && ts < s.last_event_ts) return;
	s.last_event = event;
	s.last_event_ts = ts;
}

/** Fields derived from the whole session, recomputed after each scan. */
export function finalizeSession(s) {
	s.is_automated = s.human_turns === 0 && s.scheduled_turns > 0 ? 1 : 0;
	s.end_state = {
		rate_limited: 'rate_limited',
		interrupted: 'interrupted',
		assistant: 'replied',
		human: 'no_reply',
	}[s.last_event] ?? 'unknown';
	return s;
}

export function sessionTitle(s) {
	return s.custom_title || s.ai_title || s.last_prompt?.slice(0, 80) || '(ไม่มีชื่อ)';
}
