import type { TFile } from "obsidian";

export type SearchScope = "current" | "vault";

export interface SearchOptions {
	query: string;
	useRegex: boolean;
	wholeWord: boolean;
	matchCase: boolean;
}

export interface SearchResult {
	file: TFile;
	line: number;
	matchStart: number;
	matchEnd: number;
	lineText: string;
}
