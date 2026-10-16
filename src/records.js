// Readers for single records in a Claude Code session log (.jsonl).
// The log format is not a public API, so every reader tolerates missing
// fields and unknown record types by returning null.

export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// User records that carry text the person did not type.
const NON_HUMAN_PREFIXES = [
	'<command-', '<local-command', '<system-reminder', '<scheduled-task',
	'<task-notification', '<bash-', 'Caveat: ', '[Request interrupted',
];

export function userText(record) {
	const content = record.message?.content;
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return null;
	if (content.some(b => b?.type === 'tool_result')) return null;
	const parts = content.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text);
	return parts.length ? parts.join('\n') : null;
}

export function isScheduledTurn(record) {
	return record.type === 'user' && (record.turnOrigin === 'scheduled' || record.origin?.subkind === 'scheduled-trigger');
}

export function isInterruption(record) {
	if (record.type !== 'user') return false;
	return (userText(record) ?? '').trimStart().startsWith('[Request interrupted');
}

/** Text the person typed, or null for tool results, hooks and automated turns. */
export function humanPrompt(record) {
	if (record.type !== 'user' || record.isMeta || record.isSidechain || record.isCompactSummary) return null;
	if (record.origin && record.origin.kind !== 'human') return null;
	if (record.promptSource === 'system' || isScheduledTurn(record)) return null;
	const text = userText(record)?.trim();
	if (!text || NON_HUMAN_PREFIXES.some(p => text.startsWith(p))) return null;
	return text;
}

export function assistantText(record) {
	if (record.type !== 'assistant' || record.isSidechain || record.isApiErrorMessage) return null;
	const content = record.message?.content;
	if (!Array.isArray(content)) return null;
	const text = content.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n').trim();
	return text || null;
}

export function isRateLimited(record) {
	return record.type === 'assistant' && Boolean(record.isApiErrorMessage)
		&& (record.error === 'rate_limit' || record.apiErrorStatus === 429);
}

/** Files the assistant changed with an edit tool in this record. */
export function fileEdits(record) {
	if (record.type !== 'assistant' || record.isSidechain) return [];
	const content = record.message?.content;
	if (!Array.isArray(content)) return [];
	const edits = [];
	for (const block of content) {
		if (block?.type !== 'tool_use' || !EDIT_TOOLS.has(block.name)) continue;
		const file = block.input?.file_path ?? block.input?.notebook_path;
		if (typeof file === 'string' && file) edits.push({ path: file, tool: block.name });
	}
	return edits;
}
