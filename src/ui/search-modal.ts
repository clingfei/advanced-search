import { MarkdownView, Modal, Notice, Setting } from "obsidian";
import type AdvancedSearchPlugin from "../main";
import type { SearchOptions, SearchResult, SearchScope } from "../types";
import { buildSearchRegex, searchFiles } from "../search/searcher";

const MAX_RESULTS = 500;
const DEBOUNCE_MS = 350;

export class SearchModal extends Modal {
	private plugin: AdvancedSearchPlugin;
	private query = "";
	private searchScope: SearchScope;
	private wholeWord: boolean;
	private useRegex: boolean;
	private matchCase: boolean;
	private resultsEl: HTMLElement;
	private summaryEl: HTMLElement;
	private listEl: HTMLElement;
	private searchId = 0;
	private debounceId: number | null = null;

	constructor(plugin: AdvancedSearchPlugin, initialScope?: SearchScope) {
		super(plugin.app);
		this.plugin = plugin;
		this.searchScope = initialScope ?? plugin.settings.defaultScope;
		this.wholeWord = plugin.settings.defaultWholeWord;
		this.useRegex = plugin.settings.defaultUseRegex;
		this.matchCase = plugin.settings.defaultMatchCase;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText("Advanced search");

		const querySetting = new Setting(contentEl).setName("Search query");
		querySetting.addText((text) => {
			text.setPlaceholder("Type to search");
			text.onChange((value) => {
				this.query = value;
				this.scheduleSearch();
			});
			text.inputEl.addEventListener("keydown", (event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					void this.runSearch();
				}
			});
			window.setTimeout(() => text.inputEl.focus(), 0);
		});

		new Setting(contentEl)
			.setName("Scope")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("current", "Current note")
					.addOption("vault", "Whole vault")
					.setValue(this.searchScope)
					.onChange((value) => {
						this.searchScope = value as SearchScope;
						this.persistOptions();
						this.scheduleSearch();
					});
			});

		new Setting(contentEl)
			.setName("Match whole word")
			.setDesc("Only match complete words.")
			.addToggle((toggle) => {
				toggle.setValue(this.wholeWord).onChange((value) => {
					this.wholeWord = value;
					this.persistOptions();
					this.scheduleSearch();
				});
			});

		new Setting(contentEl)
			.setName("Use regular expression")
			.setDesc("Treat the search query as a regular expression.")
			.addToggle((toggle) => {
				toggle.setValue(this.useRegex).onChange((value) => {
					this.useRegex = value;
					this.persistOptions();
					this.scheduleSearch();
				});
			});

		new Setting(contentEl)
			.setName("Match case")
			.setDesc("Only match exact casing.")
			.addToggle((toggle) => {
				toggle.setValue(this.matchCase).onChange((value) => {
					this.matchCase = value;
					this.persistOptions();
					this.scheduleSearch();
				});
			});

		new Setting(contentEl).addButton((button) => {
			button.setButtonText("Search").setCta().onClick(() => {
				void this.runSearch();
			});
		});

		this.resultsEl = contentEl.createDiv({ cls: "advanced-search-results" });
		this.summaryEl = this.resultsEl.createDiv({
			cls: "advanced-search-summary",
		});
		this.listEl = this.resultsEl.createDiv({ cls: "advanced-search-list" });
		this.summaryEl.setText("Type a query to start searching.");
	}

	onClose(): void {
		this.searchId += 1;
		if (this.debounceId !== null) {
			window.clearTimeout(this.debounceId);
			this.debounceId = null;
		}
		this.contentEl.empty();
	}

	private scheduleSearch(): void {
		if (this.debounceId !== null) {
			window.clearTimeout(this.debounceId);
		}
		this.debounceId = window.setTimeout(() => {
			this.debounceId = null;
			void this.runSearch();
		}, DEBOUNCE_MS);
	}

	private getSearchFiles(): { files: SearchResult["file"][]; error?: string } {
		if (this.searchScope === "current") {
			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view?.file) {
				return { files: [], error: "No active note to search." };
			}
			return { files: [view.file] };
		}
		return { files: this.app.vault.getMarkdownFiles() };
	}

	private buildOptions(query: string): SearchOptions {
		return {
			query,
			useRegex: this.useRegex,
			wholeWord: this.wholeWord,
			matchCase: this.matchCase,
		};
	}

	private async runSearch(): Promise<void> {
		const query = this.query.trim();
		this.listEl.empty();

		if (!query) {
			this.summaryEl.setText("Type a query to start searching.");
			return;
		}

		const options = this.buildOptions(query);
		let regex: RegExp;

		try {
			regex = buildSearchRegex(options);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Unknown error";
			this.summaryEl.setText("Invalid regular expression.");
			new Notice(`Invalid regular expression: ${message}`);
			return;
		}

		const { files, error } = this.getSearchFiles();
		if (error) {
			this.summaryEl.setText(error);
			return;
		}

		if (files.length === 0) {
			this.summaryEl.setText("No files to search.");
			return;
		}

		const searchToken = ++this.searchId;
		this.summaryEl.setText(`Searching 0/${files.length} files...`);

		const { results, truncated } = await searchFiles(
			this.app.vault,
			files,
			regex,
			{
				maxResults: MAX_RESULTS,
				shouldCancel: () => searchToken !== this.searchId,
				onProgress: (processed, total) => {
					if (searchToken === this.searchId) {
						this.summaryEl.setText(`Searching ${processed}/${total} files...`);
					}
				},
			}
		);

		if (searchToken !== this.searchId) {
			return;
		}

		this.renderResults(results, truncated);
	}

	private renderResults(results: SearchResult[], truncated: boolean): void {
		this.listEl.empty();

		if (results.length === 0) {
			this.summaryEl.setText("No matches found.");
			return;
		}

		const fileSet = new Set(results.map((result) => result.file.path));
		const matchLabel = results.length === 1 ? "match" : "matches";
		const fileLabel = fileSet.size === 1 ? "file" : "files";
		const truncatedNote = truncated
			? ` Showing first ${results.length} matches.`
			: "";

		this.summaryEl.setText(
			`Found ${results.length} ${matchLabel} in ${fileSet.size} ${fileLabel}.${truncatedNote}`
		);

		for (const result of results) {
			this.renderResultItem(result);
		}
	}

	private renderResultItem(result: SearchResult): void {
		const itemEl = this.listEl.createDiv({ cls: "advanced-search-item" });
		itemEl.addEventListener("click", () => {
			void this.openResult(result);
		});

		itemEl.createDiv({
			cls: "advanced-search-item-header",
			text: `${result.file.path}:${result.line}`,
		});

		const preview = itemEl.createDiv({ cls: "advanced-search-item-preview" });
		const before = result.lineText.slice(0, result.matchStart);
		const match = result.lineText.slice(result.matchStart, result.matchEnd);
		const after = result.lineText.slice(result.matchEnd);
		preview.createSpan({ text: before });
		preview.createSpan({ text: match, cls: "advanced-search-match" });
		preview.createSpan({ text: after });
	}

	private async openResult(result: SearchResult): Promise<void> {
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(result.file, { active: true });
		const view = leaf.view;
		if (view instanceof MarkdownView) {
			const line = result.line - 1;
			const from = { line, ch: result.matchStart };
			const to = { line, ch: result.matchEnd };
			view.editor.setSelection(from, to);
			view.editor.scrollIntoView({ from, to }, true);
		}
		this.close();
	}

	private persistOptions(): void {
		this.plugin.settings.defaultScope = this.searchScope;
		this.plugin.settings.defaultWholeWord = this.wholeWord;
		this.plugin.settings.defaultUseRegex = this.useRegex;
		this.plugin.settings.defaultMatchCase = this.matchCase;
		void this.plugin.saveSettings();
	}
}
