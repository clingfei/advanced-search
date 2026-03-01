import type { TFile, Vault } from "obsidian";
import type { SearchOptions, SearchResult } from "../types";

export interface SearchRunOptions {
	maxResults: number;
	shouldCancel: () => boolean;
	onProgress?: (processed: number, total: number) => void;
}

export function buildSearchRegex(options: SearchOptions): RegExp {
	const source = options.useRegex
		? options.query
		: escapeRegExp(options.query);
	const boundedSource = options.wholeWord ? `\\b${source}\\b` : source;
	const flags = `g${options.matchCase ? "" : "i"}`;
	return new RegExp(boundedSource, flags);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface LineMatch {
	line: number;
	matchStart: number;
	matchEnd: number;
	lineText: string;
}

export function findMatchesInContent(
	content: string,
	regex: RegExp
): LineMatch[] {
	const lines = content.split(/\r?\n/);
	const matches: LineMatch[] = [];

	for (const [lineIndex, line] of lines.entries()) {
		regex.lastIndex = 0;
		let match: RegExpExecArray | null;

		while ((match = regex.exec(line)) !== null) {
			const matchText = match[0];
			const start = match.index;
			const end = start + matchText.length;
			matches.push({
				line: lineIndex + 1,
				matchStart: start,
				matchEnd: end,
				lineText: line,
			});

			if (matchText.length === 0) {
				regex.lastIndex = start + 1;
			}
		}
	}

	return matches;
}

export async function searchFiles(
	vault: Vault,
	files: TFile[],
	regex: RegExp,
	options: SearchRunOptions
): Promise<{ results: SearchResult[]; truncated: boolean; processed: number }> {
	const results: SearchResult[] = [];
	let truncated = false;

	for (let index = 0; index < files.length; index++) {
		if (options.shouldCancel()) {
			break;
		}

		const file = files[index];
		const content = await vault.cachedRead(file);
		const matches = findMatchesInContent(content, regex);

		for (const match of matches) {
			results.push({ file, ...match });
			if (results.length >= options.maxResults) {
				truncated = true;
				break;
			}
		}

		options.onProgress?.(index + 1, files.length);

		if (truncated) {
			return { results, truncated, processed: index + 1 };
		}
	}

	return { results, truncated, processed: files.length };
}
