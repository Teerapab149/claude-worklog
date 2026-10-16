import { claude } from './claude.js';
import { codex } from './codex.js';

export const ADAPTERS = { claude, codex };

/** Adapters switched on in config.sources, in a fixed order. */
export function enabledAdapters(config) {
	return Object.values(ADAPTERS).filter(a => config.sources?.[a.tool] !== false);
}

export function adapterFor(tool) {
	return ADAPTERS[tool] ?? claude;
}
