// The shape of a summary, and what is done to every reply before it is kept,
// whichever AI wrote it: check it, cut it to size and clean its wording.

export const SUMMARY_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['headline', 'status', 'done', 'in_progress', 'next_steps', 'waiting_on', 'deadlines'],
	properties: {
		headline: { type: 'string', description: 'หนึ่งประโยค ไม่เกิน 120 ตัวอักษร ว่างานนี้ทำอะไรและตอนนี้อยู่ตรงไหน' },
		status: { type: 'string', enum: ['done', 'in_progress', 'blocked', 'waiting', 'abandoned'] },
		done: { type: 'array', items: { type: 'string' }, maxItems: 6 },
		in_progress: { type: 'array', items: { type: 'string' }, maxItems: 5 },
		next_steps: { type: 'array', items: { type: 'string' }, maxItems: 5 },
		waiting_on: { type: 'array', items: { type: 'string' }, maxItems: 4 },
		deadlines: {
			type: 'array', maxItems: 4,
			items: {
				type: 'object', additionalProperties: false, required: ['date', 'text'],
				properties: {
					date: { type: ['string', 'null'], description: 'YYYY-MM-DD แบบ ค.ศ. ถ้าระบุวันได้ ไม่งั้น null' },
					text: { type: 'string' },
				},
			},
		},
	},
};

/**
 * The schema as sent to a provider. Some strict providers refuse maxItems,
 * so each limit is written into the description instead, and cleanSummary
 * enforces it on our side.
 */
export function portableSchema(schema = SUMMARY_SCHEMA) {
	const copy = structuredClone(schema);
	(function strip(node) {
		if (!node || typeof node !== 'object') return;
		if (Number.isInteger(node.maxItems)) {
			node.description = `${node.description ? `${node.description} ` : ''}ไม่เกิน ${node.maxItems} ข้อ`;
			delete node.maxItems;
		}
		for (const value of Object.values(node)) strip(value);
	})(copy);
	return copy;
}

// Characters and habits the person never wants to see in generated text,
// written as escapes so this file stays free of them too.
const REPLACEMENTS = [
	[/\s*[—–]\s*/g, ', '],
	[/\s*·\s*/g, ', '],
	[/\s*→\s*/g, ' แล้ว '],
	[/\s*←\s*/g, ' จาก '],
	[/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, ''],
	// "+" standing for "and" between words; a plus inside code or numbers stays.
	[/(?<=[\p{L}\p{M})])\s+\+\s+(?=[\p{L}(])/gu, ' และ '],
	[/\*\*([^*]+)\*\*/g, '$1'],
	[/^(สรุป|โดยสรุป|Summary|Overall|Here's|Here is|แน่นอน(ครับ|ค่ะ)?|ได้เลย(ครับ|ค่ะ)?)\s*[:：,]?\s*/i, ''],
	[/ {2,}/g, ' '],
	[/,\s*,/g, ','],
];

export function cleanText(text) {
	let out = String(text ?? '');
	for (const [pattern, replacement] of REPLACEMENTS) out = out.replace(pattern, replacement);
	return out.trim().replace(/^,\s*/, '').replace(/,$/, '');
}

const limit = key => SUMMARY_SCHEMA.properties[key].maxItems;

export function cleanSummary(raw) {
	const list = key => (Array.isArray(raw?.[key]) ? raw[key].map(cleanText).filter(Boolean).slice(0, limit(key)) : []);
	const status = SUMMARY_SCHEMA.properties.status.enum.includes(raw?.status) ? raw.status : 'in_progress';
	return {
		headline: cleanText(raw?.headline),
		status,
		done: list('done'),
		in_progress: list('in_progress'),
		next_steps: list('next_steps'),
		waiting_on: list('waiting_on'),
		deadlines: Array.isArray(raw?.deadlines)
			? raw.deadlines
				.map(d => ({ date: /^\d{4}-\d{2}-\d{2}$/.test(d?.date ?? '') ? d.date : null, text: cleanText(d?.text) }))
				.filter(d => d.text)
				.slice(0, limit('deadlines'))
			: [],
	};
}

export class SummarizerError extends Error {
	constructor(message, kind, extra = {}) {
		super(message);
		// 'auth' | 'rate_limit' | 'missing_cli' | 'timeout' | 'bad_output' | 'failed' | 'local_only'
		this.kind = kind;
		Object.assign(this, extra);
	}
}

/**
 * A reply that parsed as JSON but is not a summary (no headline, a status
 * outside the list) is refused, so it is never saved as if it were one.
 */
export function checkSummary(raw) {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SummarizerError('AI ตอบกลับมาไม่ใช่ JSON object', 'bad_output');
	if (typeof raw.headline !== 'string' || !raw.headline.trim()) throw new SummarizerError('AI ตอบกลับมาไม่มี headline', 'bad_output');
	if (!SUMMARY_SCHEMA.properties.status.enum.includes(raw.status)) throw new SummarizerError(`AI ตอบ status ที่ไม่รู้จัก (${String(raw.status).slice(0, 30)})`, 'bad_output');
	return cleanSummary(raw);
}

/** Pulls the JSON object out of a reply, even one wrapped in a code fence or a sentence. */
export function parseReply(content) {
	const text = String(content ?? '');
	const start = text.indexOf('{'), end = text.lastIndexOf('}');
	if (start < 0 || end <= start) throw new SummarizerError('AI ตอบกลับมาไม่มี JSON', 'bad_output');
	try { return JSON.parse(text.slice(start, end + 1)); }
	catch { throw new SummarizerError('AI ตอบกลับมาเป็น JSON ที่อ่านไม่ได้', 'bad_output'); }
}
