import { setIcon, TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import type AdvancedSearchPlugin from "../main";

const SEARCH_VIEW_TYPE = "search";
const CONTROLS_ATTRIBUTE = "data-advanced-search-controls";
const PATH_FILTERS_ATTRIBUTE = "data-advanced-search-path-filters";
const WHOLE_WORD_LABEL = "W";
const MIN_RIGHT_GUTTER = 2;
const DEFAULT_ICON_GAP = 2;
const INPUT_PADDING_GAP = 8;

interface SearchControls {
	leaf: WorkspaceLeaf;
	inputEl: HTMLInputElement;
	hostEl: HTMLElement;
	filtersAnchorEl: HTMLElement;
	controlsEl: HTMLDivElement;
	pathFiltersEl: HTMLDivElement;
	includeInputEl: HTMLInputElement;
	excludeInputEl: HTMLInputElement;
	wholeWordButtonEl: HTMLButtonElement;
	wholeWordTextEl: HTMLSpanElement;
	regexButtonEl: HTMLButtonElement;
	wholeWord: boolean;
	useRegex: boolean;
	rawQuery: string;
	includeGlob: string;
	excludeGlob: string;
	applyingQuery: boolean;
	stateSyncId: number;
	originalPaddingRightPx: number;
	resizeObserver: ResizeObserver | null;
}

export class SearchViewIntegration {
	private plugin: AdvancedSearchPlugin;
	private controlsByInput = new WeakMap<HTMLInputElement, SearchControls>();
	private activeControls = new Set<SearchControls>();

	constructor(plugin: AdvancedSearchPlugin) {
		this.plugin = plugin;
	}

	initialize(): void {
		this.plugin.app.workspace.onLayoutReady(() => {
			this.injectControls();
		});

		this.plugin.registerEvent(
			this.plugin.app.workspace.on("layout-change", () => {
				this.injectControls();
			})
		);

		this.plugin.registerEvent(
			this.plugin.app.workspace.on("active-leaf-change", () => {
				this.injectControls();
			})
		);

		this.plugin.registerEvent(
			this.plugin.app.workspace.on("resize", () => {
				this.relayoutAllControls();
			})
		);
	}

	destroy(): void {
		for (const controls of this.activeControls) {
			controls.resizeObserver?.disconnect();
			controls.resizeObserver = null;
			controls.controlsEl.remove();
			controls.pathFiltersEl.remove();
		}
		this.activeControls.clear();
	}

	private injectControls(): void {
		const leaves = this.plugin.app.workspace.getLeavesOfType(SEARCH_VIEW_TYPE);
		const liveInputs = new Set<HTMLInputElement>();

		for (const leaf of leaves) {
			const inputEl = this.findSearchInput(leaf);
			if (!inputEl) {
				continue;
			}

			liveInputs.add(inputEl);
			const existingControls = this.controlsByInput.get(inputEl);
			if (existingControls) {
				this.ensurePathFiltersPlacement(existingControls);
				this.positionControls(existingControls);
				this.syncWholeWordTypography(existingControls);
				continue;
			}

			const controls = this.createControls(leaf, inputEl);
			this.controlsByInput.set(inputEl, controls);
			this.activeControls.add(controls);
		}

		for (const controls of [...this.activeControls]) {
			if (!controls.inputEl.isConnected || !liveInputs.has(controls.inputEl)) {
				controls.resizeObserver?.disconnect();
				controls.resizeObserver = null;
				controls.controlsEl.remove();
				controls.pathFiltersEl.remove();
				this.activeControls.delete(controls);
			}
		}
	}

	private findSearchInput(leaf: WorkspaceLeaf): HTMLInputElement | null {
		const containerEl = leaf.view.containerEl;
		const selectors = [
			".search-input-container input",
			"input.search-input",
			"input[type='search']",
			"input[type='text']",
		];

		for (const selector of selectors) {
			const inputEl = containerEl.querySelector(selector);
			if (inputEl instanceof HTMLInputElement) {
				return inputEl;
			}
		}

		return null;
	}

	private createControls(
		leaf: WorkspaceLeaf,
		inputEl: HTMLInputElement
	): SearchControls {
		const nearestSearchContainer = inputEl.closest(".search-input-container");
		const hostEl =
			nearestSearchContainer instanceof HTMLElement
				? nearestSearchContainer
				: inputEl.parentElement ?? leaf.view.containerEl;
		const filtersAnchorEl =
			nearestSearchContainer instanceof HTMLElement ? nearestSearchContainer : hostEl;

		hostEl.findAll(`[${CONTROLS_ATTRIBUTE}]`).forEach((el) => el.remove());
		leaf.view.containerEl
			.findAll(`[${PATH_FILTERS_ATTRIBUTE}]`)
			.forEach((el) => el.remove());

		const controlsEl = hostEl.createDiv({
			cls: "advanced-search-inline-controls",
		});
		controlsEl.setAttr(CONTROLS_ATTRIBUTE, "true");

		const pathFiltersEl = hostEl.ownerDocument.createElement("div");
		pathFiltersEl.addClass("advanced-search-path-filters");
		pathFiltersEl.setAttribute(PATH_FILTERS_ATTRIBUTE, "true");
		this.appendPathFiltersAfterHost(hostEl, pathFiltersEl);

		const includeInputEl = this.createPathFilterInput(
			pathFiltersEl,
			"Files to include",
			"e.g. src/**, **/*.ts"
		);
		const excludeInputEl = this.createPathFilterInput(
			pathFiltersEl,
			"Files to exclude",
			"e.g. **/node_modules/**, **/*.min.js"
		);

		const wholeWordToggle = this.createTextToggleButton(
			controlsEl,
			"Match whole word",
			WHOLE_WORD_LABEL
		);

		const controls: SearchControls = {
			leaf,
			inputEl,
			hostEl,
			filtersAnchorEl,
			controlsEl,
			pathFiltersEl,
			includeInputEl,
			excludeInputEl,
			wholeWordButtonEl: wholeWordToggle.buttonEl,
			wholeWordTextEl: wholeWordToggle.textEl,
			regexButtonEl: this.createIconToggleButton(
				controlsEl,
				"Use regular expression",
				"regex",
				".*"
			),
			wholeWord: this.plugin.settings.defaultWholeWord,
			useRegex: this.plugin.settings.defaultUseRegex,
			rawQuery: inputEl.value,
			includeGlob: "",
			excludeGlob: "",
			applyingQuery: false,
			stateSyncId: 0,
			originalPaddingRightPx: this.readPaddingRightPx(inputEl),
			resizeObserver: null,
		};

		this.ensureHostForAbsolutePosition(hostEl);
		hostEl.appendChild(controlsEl);
		this.positionControls(controls);
		this.syncWholeWordTypography(controls);

		this.plugin.registerDomEvent(controls.wholeWordButtonEl, "click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			controls.rawQuery = controls.inputEl.value;
			controls.wholeWord = !controls.wholeWord;
			this.updateButtonStates(controls);
			void this.syncSearchState(controls, true);
			this.persistDefaults(controls);
		});

		this.plugin.registerDomEvent(controls.regexButtonEl, "click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			controls.rawQuery = controls.inputEl.value;
			controls.useRegex = !controls.useRegex;
			this.updateButtonStates(controls);
			void this.syncSearchState(controls, true);
			this.persistDefaults(controls);
		});

		this.plugin.registerDomEvent(
			controls.inputEl,
			"input",
			(event) => {
				this.onInput(controls, event);
			},
			{
				capture: true,
			}
		);

		this.plugin.registerDomEvent(controls.includeInputEl, "input", () => {
			controls.includeGlob = controls.includeInputEl.value;
			void this.syncSearchState(controls, true);
		});

		this.plugin.registerDomEvent(controls.excludeInputEl, "input", () => {
			controls.excludeGlob = controls.excludeInputEl.value;
			void this.syncSearchState(controls, true);
		});

		this.plugin.registerDomEvent(window, "resize", () => {
			this.positionControls(controls);
		});
		this.plugin.registerDomEvent(controls.hostEl, "transitionend", () => {
			this.positionControls(controls);
		});
		this.plugin.registerDomEvent(controls.hostEl, "animationend", () => {
			this.positionControls(controls);
		});
		this.plugin.registerDomEvent(controls.inputEl, "focus", () => {
			this.positionControls(controls);
		});
		this.plugin.registerDomEvent(controls.inputEl, "blur", () => {
			this.positionControls(controls);
		});
		this.attachResizeObserver(controls);

		this.updateButtonStates(controls);
		void this.syncSearchState(controls);

		return controls;
	}

	private onInput(controls: SearchControls, event: Event): void {
		if (controls.applyingQuery && !event.isTrusted) {
			return;
		}

		controls.rawQuery = controls.inputEl.value;
		this.positionControls(controls);

		if (!this.hasCustomQueryModifiers(controls)) {
			return;
		}

		event.stopImmediatePropagation();
		void this.syncSearchState(controls);
	}

	private hasCustomQueryModifiers(controls: SearchControls): boolean {
		return (
			controls.wholeWord ||
			controls.useRegex ||
			controls.includeGlob.trim().length > 0 ||
			controls.excludeGlob.trim().length > 0
		);
	}

	private createPathFilterInput(
		parentEl: HTMLElement,
		label: string,
		placeholder: string
	): HTMLInputElement {
		const rowEl = parentEl.createDiv({
			cls: "advanced-search-path-filter-row",
		});
		rowEl.createDiv({
			cls: "advanced-search-path-filter-label",
			text: label,
		});
		return rowEl.createEl("input", {
			cls: "advanced-search-path-filter-input",
			attr: {
				type: "text",
				placeholder,
			},
		});
	}

	private attachResizeObserver(controls: SearchControls): void {
		if (typeof ResizeObserver === "undefined") {
			return;
		}

		const observer = new ResizeObserver(() => {
			this.positionControls(controls);
			this.syncWholeWordTypography(controls);
		});

		observer.observe(controls.inputEl);
		observer.observe(controls.filtersAnchorEl);
		observer.observe(controls.leaf.view.containerEl);
		controls.resizeObserver = observer;
		this.plugin.register(() => {
			observer.disconnect();
		});
	}

	private createIconToggleButton(
		parentEl: HTMLElement,
		label: string,
		iconId: string,
		fallbackText: string
	): HTMLButtonElement {
		const buttonEl = parentEl.createEl("button", {
			cls: "advanced-search-toggle-button clickable-icon",
			attr: {
				type: "button",
				"aria-label": label,
				"aria-pressed": "false",
			},
		});
		buttonEl.title = label;
		setIcon(buttonEl, iconId);
		if (!buttonEl.querySelector("svg")) {
			buttonEl.setText(fallbackText);
		}
		return buttonEl;
	}

	private createTextToggleButton(
		parentEl: HTMLElement,
		label: string,
		text: string
	): { buttonEl: HTMLButtonElement; textEl: HTMLSpanElement } {
		const buttonEl = parentEl.createEl("button", {
			cls: "advanced-search-toggle-button advanced-search-toggle-button-text clickable-icon",
			attr: {
				type: "button",
				"aria-label": label,
				"aria-pressed": "false",
			},
		});
		buttonEl.title = label;
		const textEl = buttonEl.createSpan({
			cls: "advanced-search-toggle-text",
			text,
		});
		return { buttonEl, textEl };
	}

	private updateButtonStates(controls: SearchControls): void {
		controls.wholeWordButtonEl.toggleClass(
			"is-active",
			controls.wholeWord
		);
		controls.regexButtonEl.toggleClass("is-active", controls.useRegex);
		controls.wholeWordButtonEl.setAttr(
			"aria-pressed",
			String(controls.wholeWord)
		);
		controls.regexButtonEl.setAttr("aria-pressed", String(controls.useRegex));
		this.positionControls(controls);
	}

	private async syncSearchState(
		controls: SearchControls,
		forceRefresh = false
	): Promise<void> {
		const syncId = ++controls.stateSyncId;
		const queryForSearch = this.buildSearchQuery(controls);

		const viewState = controls.leaf.getViewState();
		const currentState = viewState.state ?? {};
		const sameQuery = currentState.query === queryForSearch;
		if (sameQuery && !forceRefresh) {
			return;
		}

		const inputEl = controls.inputEl;
		const visibleValue = controls.rawQuery;
		const selectionStart = inputEl.selectionStart;
		const selectionEnd = inputEl.selectionEnd;

		controls.applyingQuery = true;
		try {
			if (sameQuery && forceRefresh) {
				await controls.leaf.setViewState({
					...viewState,
					state: {
						...currentState,
						query: this.buildRefreshProbeQuery(queryForSearch),
					},
				});

				const refreshedViewState = controls.leaf.getViewState();
				const refreshedState = refreshedViewState.state ?? {};
				await controls.leaf.setViewState({
					...refreshedViewState,
					state: {
						...refreshedState,
						query: queryForSearch,
					},
				});
			} else {
				await controls.leaf.setViewState({
					...viewState,
					state: {
						...currentState,
						query: queryForSearch,
					},
				});
			}
		} finally {
			if (syncId === controls.stateSyncId) {
				if (inputEl.isConnected) {
					inputEl.value = visibleValue;
					if (selectionStart !== null && selectionEnd !== null) {
						inputEl.setSelectionRange(selectionStart, selectionEnd);
					}
				}
				controls.applyingQuery = false;
				this.positionControls(controls);
			}
		}
	}

	private buildRefreshProbeQuery(targetQuery: string): string {
		return `__advanced_search_refresh_${targetQuery.length}_${Date.now()}__`;
	}

	private persistDefaults(controls: SearchControls): void {
		this.plugin.settings.defaultWholeWord = controls.wholeWord;
		this.plugin.settings.defaultUseRegex = controls.useRegex;
		void this.plugin.saveSettings();
	}

	private buildSearchQuery(controls: SearchControls): string {
		const contentQuery = this.encodeContentQuery(
			controls.rawQuery,
			controls.useRegex,
			controls.wholeWord
		);
		const includeQuery = this.buildIncludePathQuery(controls.includeGlob);
		const excludeQuery = this.buildExcludePathQuery(controls.excludeGlob);
		return [contentQuery, includeQuery, excludeQuery]
			.filter((part) => part.length > 0)
			.join(" ");
	}

	private encodeContentQuery(
		rawQuery: string,
		useRegex: boolean,
		wholeWord: boolean
	): string {
		if (!rawQuery) {
			return "";
		}

		if (useRegex) {
			const source = this.unwrapRegexLiteral(rawQuery) ?? rawQuery;
			if (!wholeWord) {
				return `/${source}/`;
			}
			const boundedSource = `\\b(?:${source})\\b`;
			return `/${boundedSource}/`;
		}

		if (!wholeWord) {
			return rawQuery;
		}

		const escaped = this.escapeRegExp(rawQuery);
		return `/\\b${escaped}\\b/`;
	}

	private buildIncludePathQuery(globText: string): string {
		const patterns = this.parseGlobList(globText);
		if (patterns.length === 0) {
			return "";
		}

		const clauses = patterns.flatMap((pattern) =>
			this.buildPathIncludeClauses(pattern)
		);
		if (clauses.length === 0) {
			return "";
		}
		if (clauses.length === 1) {
			return clauses[0] ?? "";
		}
		return `(${clauses.join(" OR ")})`;
	}

	private buildExcludePathQuery(globText: string): string {
		const patterns = this.parseGlobList(globText);
		if (patterns.length === 0) {
			return "";
		}

		return patterns
			.flatMap((pattern) => this.buildPathExcludeClauses(pattern))
			.map((clause) => `-${clause}`)
			.join(" ");
	}

	private buildPathExcludeClauses(rawPattern: string): string[] {
		const normalized = this.normalizePathPattern(rawPattern);
		if (!normalized) {
			return [];
		}

		const hasGlobMeta = /[*?[\]{}]/.test(normalized);
		if (hasGlobMeta) {
			return [`path:/${this.globToPathRegex(normalized)}/`];
		}

		const explicitDirectoryHint = normalized.endsWith("/");
		const literalPattern = explicitDirectoryHint
			? normalized.replace(/\/+$/, "")
			: normalized;

		if (explicitDirectoryHint) {
			return [this.buildDirectoryPathClause(literalPattern)];
		}

		// Name-only patterns should exclude both same-name files and folders.
		if (!literalPattern.includes("/")) {
			const byNameClauses = this.resolveNameOnlyPathClauses(literalPattern);
			if (byNameClauses.length > 0) {
				return byNameClauses;
			}
		}

		const resolvedPath = this.resolveLiteralPatternPath(literalPattern);
		if (resolvedPath instanceof TFile) {
			return [this.buildExactFilePathClause(resolvedPath.path)];
		}
		if (resolvedPath instanceof TFolder) {
			return [this.buildDirectoryPathClause(resolvedPath.path)];
		}

		if (literalPattern.includes("/")) {
			return [this.buildExactFilePathClause(literalPattern)];
		}

		return [this.buildExactFilePathClause(literalPattern)];
	}

	private buildPathIncludeClauses(rawPattern: string): string[] {
		const normalized = this.normalizePathPattern(rawPattern);
		if (!normalized) {
			return [];
		}

		const hasGlobMeta = /[*?[\]{}]/.test(normalized);
		if (hasGlobMeta) {
			return [`path:/${this.globToPathRegex(normalized)}/`];
		}

		const explicitDirectoryHint = normalized.endsWith("/");
		const literalPattern = explicitDirectoryHint
			? normalized.replace(/\/+$/, "")
			: normalized;

		// Name-only patterns should include both same-name files and folders.
		if (!explicitDirectoryHint && !literalPattern.includes("/")) {
			const byNameClauses = this.resolveNameOnlyPathClauses(literalPattern);
			if (byNameClauses.length > 0) {
				return byNameClauses;
			}
		}

		const resolvedPath = this.resolveLiteralPatternPath(literalPattern);
		if (resolvedPath instanceof TFile) {
			return [this.buildExactFilePathClause(resolvedPath.path)];
		}
		if (resolvedPath instanceof TFolder) {
			return [this.buildDirectoryPathClause(resolvedPath.path)];
		}

		if (explicitDirectoryHint) {
			return [this.buildDirectoryPathClause(literalPattern)];
		}

		if (literalPattern.includes("/")) {
			return [this.buildExactFilePathClause(literalPattern)];
		}

		return [this.buildExactFilePathClause(literalPattern)];
	}

	private resolveNameOnlyPathClauses(name: string): string[] {
		const clauses = new Set<string>();
		const matchesByName = name.includes(".");

		for (const abstractFile of this.plugin.app.vault.getAllLoadedFiles()) {
			if (abstractFile instanceof TFile) {
				const fileMatch = matchesByName
					? abstractFile.name === name
					: abstractFile.basename === name;
				if (fileMatch) {
					clauses.add(this.buildExactFilePathClause(abstractFile.path));
				}
				continue;
			}
			if (abstractFile instanceof TFolder && abstractFile.path.length > 0) {
				if (abstractFile.name === name) {
					clauses.add(this.buildDirectoryPathClause(abstractFile.path));
				}
			}
		}

		return [...clauses];
	}

	private buildExactFilePathClause(path: string): string {
		return `path:"${this.escapeSearchQueryValue(path)}"`;
	}

	private buildDirectoryPathClause(path: string): string {
		const normalized = path.replace(/\/+$/, "");
		return `path:"${this.escapeSearchQueryValue(`${normalized}/`)}"`;
	}

	private parseGlobList(value: string): string[] {
		const text = value.trim();
		if (!text) {
			return [];
		}

		const patterns: string[] = [];
		let current = "";
		let braceDepth = 0;
		let classDepth = 0;

		for (let i = 0; i < text.length; i++) {
			const ch = text[i] ?? "";
			if (ch === "{" && classDepth === 0) {
				braceDepth++;
				current += ch;
				continue;
			}
			if (ch === "}" && classDepth === 0 && braceDepth > 0) {
				braceDepth--;
				current += ch;
				continue;
			}
			if (ch === "[") {
				classDepth++;
				current += ch;
				continue;
			}
			if (ch === "]" && classDepth > 0) {
				classDepth--;
				current += ch;
				continue;
			}
			if (ch === "," && braceDepth === 0 && classDepth === 0) {
				const trimmed = current.trim();
				if (trimmed.length > 0) {
					patterns.push(trimmed);
				}
				current = "";
				continue;
			}
			current += ch;
		}

		const tail = current.trim();
		if (tail.length > 0) {
			patterns.push(tail);
		}

		return patterns;
	}

	private globToPathRegex(rawPattern: string): string {
		let pattern = this.normalizePathPattern(rawPattern);
		if (!pattern) {
			return "^$";
		}

		const hasGlobMeta = /[*?[\]{}]/.test(pattern);
		const explicitDirectoryHint = pattern.endsWith("/");
		if (explicitDirectoryHint) {
			pattern = pattern.replace(/\/+$/, "");
		}

		if (!hasGlobMeta) {
			const resolvedPath = this.resolveLiteralPatternPath(pattern);
			if (resolvedPath instanceof TFile) {
				return `^${this.escapeRegexQueryLiteral(resolvedPath.path)}$`;
			}
			if (resolvedPath instanceof TFolder) {
				return `^${this.escapeRegexQueryLiteral(resolvedPath.path)}\\/.*$`;
			}

			if (explicitDirectoryHint) {
				return `^${this.escapeRegexQueryLiteral(pattern)}\\/.*$`;
			}

			// Explicit relative path without glob is treated as a single file path.
			if (pattern.includes("/")) {
				return `^${this.escapeRegexQueryLiteral(pattern)}$`;
			}

			// Bare name falls back to exact file-name match anywhere.
			return `^(?:.*\\/)?${this.escapeRegexQueryLiteral(pattern)}$`;
		}

		if (explicitDirectoryHint) {
			pattern = `${pattern}/**`;
		}

		const source = this.convertGlobToRegexSource(pattern);
		return `^${source}$`;
	}

	private normalizePathPattern(rawPattern: string): string {
		let pattern = rawPattern.trim().replace(/\\/g, "/");
		while (pattern.startsWith("./")) {
			pattern = pattern.slice(2);
		}
		pattern = pattern.replace(/^\/+/, "");
		return pattern;
	}

	private resolveLiteralPatternPath(pattern: string): TFile | TFolder | null {
		const normalized = pattern.replace(/\/+$/, "");
		if (!normalized) {
			return null;
		}

		const exact = this.plugin.app.vault.getAbstractFileByPath(normalized);
		if (exact instanceof TFile || exact instanceof TFolder) {
			return exact;
		}

		const hasExtension = /\.[^./]+$/.test(normalized.split("/").pop() ?? "");
		if (hasExtension) {
			return null;
		}

		const markdownFile = this.plugin.app.vault.getAbstractFileByPath(
			`${normalized}.md`
		);
		if (markdownFile instanceof TFile) {
			return markdownFile;
		}

		return null;
	}

	private convertGlobToRegexSource(pattern: string): string {
		let result = "";
		let index = 0;

		while (index < pattern.length) {
			const ch = pattern[index] ?? "";
			if (ch === "*") {
				const next = pattern[index + 1] ?? "";
				if (next === "*") {
					result += ".*";
					index += 2;
					continue;
				}
				result += "[^/]*";
				index++;
				continue;
			}
			if (ch === "?") {
				result += "[^/]";
				index++;
				continue;
			}
			if (ch === "[") {
				const end = pattern.indexOf("]", index + 1);
				if (end > index + 1) {
					const classSource = pattern.slice(index, end + 1);
					result += classSource;
					index = end + 1;
					continue;
				}
				result += "\\[";
				index++;
				continue;
			}
			if (ch === "{") {
				const end = this.findClosingBrace(pattern, index);
				if (end !== -1) {
					const inner = pattern.slice(index + 1, end);
					const parts = this.splitBraceAlternatives(inner).map((part) =>
						this.convertGlobToRegexSource(part)
					);
					result += `(?:${parts.join("|")})`;
					index = end + 1;
					continue;
				}
				result += "\\{";
				index++;
				continue;
			}

			result += this.escapeRegexChar(ch);
			index++;
		}

		return result;
	}

	private findClosingBrace(pattern: string, start: number): number {
		let depth = 0;
		for (let i = start; i < pattern.length; i++) {
			const ch = pattern[i] ?? "";
			if (ch === "{") {
				depth++;
				continue;
			}
			if (ch === "}") {
				depth--;
				if (depth === 0) {
					return i;
				}
			}
		}
		return -1;
	}

	private splitBraceAlternatives(value: string): string[] {
		const parts: string[] = [];
		let current = "";
		let depth = 0;

		for (let i = 0; i < value.length; i++) {
			const ch = value[i] ?? "";
			if (ch === "{") {
				depth++;
				current += ch;
				continue;
			}
			if (ch === "}" && depth > 0) {
				depth--;
				current += ch;
				continue;
			}
			if (ch === "," && depth === 0) {
				parts.push(current);
				current = "";
				continue;
			}
			current += ch;
		}
		parts.push(current);
		return parts.map((part) => part.trim()).filter((part) => part.length > 0);
	}

	private escapeRegexChar(ch: string): string {
		if (/[-/\\^$*+?.()|[\]{}]/.test(ch)) {
			return `\\${ch}`;
		}
		return ch;
	}

	private escapeRegexQueryLiteral(value: string): string {
		let result = "";
		for (const ch of value) {
			result += this.escapeRegexChar(ch);
		}
		return result;
	}

	private escapeSearchQueryValue(value: string): string {
		return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
	}

	private ensureHostForAbsolutePosition(hostEl: HTMLElement): void {
		if (window.getComputedStyle(hostEl).position === "static") {
			hostEl.addClass("advanced-search-host-relative");
		}
	}

	private ensurePathFiltersPlacement(controls: SearchControls): void {
		if (!controls.pathFiltersEl.isConnected) {
			this.appendPathFiltersAfterHost(
				controls.filtersAnchorEl,
				controls.pathFiltersEl
			);
		}
		this.syncPathFiltersGeometry(controls);
	}

	private appendPathFiltersAfterHost(
		hostEl: HTMLElement,
		pathFiltersEl: HTMLElement
	): void {
		const anchorEl = this.resolvePathFiltersInsertionAnchor(hostEl);
		const parentEl = anchorEl.parentElement;
		if (!parentEl) {
			anchorEl.appendChild(pathFiltersEl);
			return;
		}
		if (
			pathFiltersEl.parentElement === parentEl &&
			anchorEl.nextSibling === pathFiltersEl
		) {
			return;
		}
		parentEl.insertBefore(pathFiltersEl, anchorEl.nextSibling);
	}

	private syncPathFiltersGeometry(controls: SearchControls): void {
		const parentEl = controls.pathFiltersEl.parentElement;
		if (!parentEl || !controls.filtersAnchorEl.isConnected) {
			return;
		}

		const anchorRect = controls.filtersAnchorEl.getBoundingClientRect();
		const parentRect = parentEl.getBoundingClientRect();
		const widthPx = Math.round(anchorRect.width);
		const offsetPx = Math.round(anchorRect.left - parentRect.left);

		controls.pathFiltersEl.style.width = `${Math.max(0, widthPx)}px`;
		controls.pathFiltersEl.style.maxWidth = `${Math.max(0, widthPx)}px`;
		controls.pathFiltersEl.style.marginLeft = `${Math.max(0, offsetPx)}px`;
	}

	private resolvePathFiltersInsertionAnchor(hostEl: HTMLElement): HTMLElement {
		let anchorEl = hostEl;
		let parentEl = anchorEl.parentElement;
		while (parentEl) {
			const style = window.getComputedStyle(parentEl);
			const isHorizontalFlex =
				style.display.includes("flex") &&
				!style.flexDirection.startsWith("column");
			if (!isHorizontalFlex) {
				break;
			}
			anchorEl = parentEl;
			parentEl = anchorEl.parentElement;
		}
		return anchorEl;
	}

	private positionControls(controls: SearchControls): void {
		if (!controls.controlsEl.isConnected) {
			return;
		}
		this.ensurePathFiltersPlacement(controls);
		this.syncPathFiltersGeometry(controls);

		let rightOffset = MIN_RIGHT_GUTTER;
		const matchCaseAnchor = this.findMatchCaseAnchor(controls);
		if (matchCaseAnchor) {
			this.moveControlsToCommonHost(controls, matchCaseAnchor);
		}

		const hostRect = controls.hostEl.getBoundingClientRect();
		if (hostRect.width <= 0 || hostRect.height <= 0) {
			return;
		}

		if (matchCaseAnchor) {
			const matchRect = matchCaseAnchor.getBoundingClientRect();
			const iconGap = this.getNativeIconGap(controls, matchCaseAnchor);
			const desiredRightEdge = matchRect.left - iconGap;
			rightOffset = Math.max(
				MIN_RIGHT_GUTTER,
				Math.round(hostRect.right - desiredRightEdge)
			);
			controls.controlsEl.style.gap = `${iconGap}px`;
		} else {
			controls.controlsEl.style.gap = `${DEFAULT_ICON_GAP}px`;
		}

		controls.controlsEl.style.right = `${Math.round(rightOffset)}px`;

		const controlsRect = controls.controlsEl.getBoundingClientRect();
		let leftBoundary = controlsRect.left;
		for (const iconEl of this.collectIconsFrom(controls, controlsRect.left - 1)) {
			const rect = iconEl.getBoundingClientRect();
			leftBoundary = Math.min(leftBoundary, rect.left);
		}

		const minPaddingRight = Math.ceil(hostRect.right - leftBoundary + INPUT_PADDING_GAP);
		const nextPaddingRight = Math.max(
			controls.originalPaddingRightPx,
			minPaddingRight
		);
		controls.inputEl.style.paddingRight = `${nextPaddingRight}px`;
	}

	private getNativeIconGap(
		controls: SearchControls,
		anchorEl: HTMLElement
	): number {
		const icons = this.collectIconsFrom(
			controls,
			controls.inputEl.getBoundingClientRect().left +
				controls.inputEl.getBoundingClientRect().width * 0.5
		);
		const anchorIndex = icons.indexOf(anchorEl);
		if (anchorIndex <= 0) {
			return DEFAULT_ICON_GAP;
		}

		const previousIcon = icons[anchorIndex - 1];
		if (!previousIcon) {
			return DEFAULT_ICON_GAP;
		}

		const previousRect = previousIcon.getBoundingClientRect();
		const anchorRect = anchorEl.getBoundingClientRect();
		const measuredGap = Math.round(anchorRect.left - previousRect.right);
		if (!Number.isFinite(measuredGap) || measuredGap < 0) {
			return DEFAULT_ICON_GAP;
		}

		return Math.max(0, Math.min(12, measuredGap));
	}

	private moveControlsToCommonHost(
		controls: SearchControls,
		anchorEl: HTMLElement
	): void {
		const commonHost = this.findCommonHost(
			controls.inputEl,
			anchorEl,
			controls.hostEl
		);
		if (commonHost === controls.hostEl) {
			return;
		}

		controls.hostEl = commonHost;
		this.ensureHostForAbsolutePosition(commonHost);
		commonHost.appendChild(controls.controlsEl);
	}

	private findCommonHost(
		inputEl: HTMLElement,
		anchorEl: HTMLElement,
		fallbackHost: HTMLElement
	): HTMLElement {
		const ancestors = new Set<HTMLElement>();
		let current: HTMLElement | null = inputEl;
		while (current) {
			ancestors.add(current);
			current = current.parentElement;
		}

		current = anchorEl;
		while (current) {
			if (ancestors.has(current)) {
				return current;
			}
			current = current.parentElement;
		}

		return fallbackHost;
	}

	private collectIconsFrom(
		controls: SearchControls,
		leftLimit: number
	): HTMLElement[] {
		const candidates = controls.leaf.view.containerEl.findAll(
			"button, .clickable-icon, .search-input-clear-button"
		);

		const inputRect = controls.inputEl.getBoundingClientRect();
		const inputCenterY = inputRect.top + inputRect.height / 2;
		const rowTolerance = Math.max(inputRect.height * 1.5, 40);
		const maxRightZone = inputRect.right + 480;

		const filtered = candidates.filter((candidate) => {
			if (!(candidate instanceof HTMLElement)) {
				return false;
			}
			if (controls.controlsEl.contains(candidate)) {
				return false;
			}
			if (!candidate.isConnected) {
				return false;
			}
			const rect = candidate.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) {
				return false;
			}
			const centerY = rect.top + rect.height / 2;
			if (Math.abs(centerY - inputCenterY) > rowTolerance) {
				return false;
			}
			if (rect.left > maxRightZone) {
				return false;
			}
			return rect.left >= leftLimit;
		});

		return filtered.sort(
			(a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left
		);
	}

	private readPaddingRightPx(inputEl: HTMLInputElement): number {
		const parsed = Number.parseFloat(
			window.getComputedStyle(inputEl).paddingRight
		);
		return Number.isFinite(parsed) ? parsed : 0;
	}

	private findMatchCaseAnchor(controls: SearchControls): HTMLElement | null {
		const candidates = this.collectIconsFrom(
			controls,
			controls.inputEl.getBoundingClientRect().left +
				controls.inputEl.getBoundingClientRect().width * 0.5
		);

		for (const candidate of candidates) {
			const labelText = `${
				candidate.getAttr("aria-label") ?? ""
			} ${candidate.getAttr("title") ?? ""}`
				.trim()
				.toLowerCase();
			const iconText = (candidate.textContent ?? "")
				.replace(/\s+/g, "")
				.trim()
				.toLowerCase();
			const classText = (candidate.className ?? "").toString().toLowerCase();
			if (
				iconText === "aa" ||
				labelText.includes("match case") ||
				labelText.includes("matching case") ||
				labelText.includes("\u533a\u5206\u5927\u5c0f\u5199") ||
				classText.includes("match-case")
			) {
				return candidate;
			}
		}

		// Fallback: use the right-most icon on the same row to avoid overlapping built-in icons.
		const lastCandidate = candidates[candidates.length - 1];
		return lastCandidate ?? null;
	}

	private syncWholeWordTypography(
		controls: SearchControls,
		matchCaseButton: HTMLElement | null = this.findMatchCaseAnchor(controls)
	): void {
		if (!matchCaseButton) {
			return;
		}

		const typographySource = this.getTypographySource(matchCaseButton);
		const style = window.getComputedStyle(typographySource);
		const target = controls.wholeWordTextEl;
		target.style.fontFamily = style.fontFamily;
		target.style.fontSize = style.fontSize;
		target.style.fontWeight = style.fontWeight;
		target.style.fontStyle = style.fontStyle;
		target.style.letterSpacing = style.letterSpacing;
		target.style.lineHeight = style.lineHeight;
	}

	private getTypographySource(buttonEl: HTMLElement): HTMLElement {
		for (const span of buttonEl.findAll("span")) {
			if ((span.textContent ?? "").trim().length > 0) {
				return span;
			}
		}
		return buttonEl;
	}

	private relayoutAllControls(): void {
		for (const controls of this.activeControls) {
			if (!controls.inputEl.isConnected) {
				continue;
			}
			this.positionControls(controls);
			this.syncWholeWordTypography(controls);
		}
	}

	private unwrapRegexLiteral(value: string): string | null {
		if (value.length < 2 || !value.startsWith("/") || !value.endsWith("/")) {
			return null;
		}
		return value.slice(1, -1);
	}

	private escapeRegExp(value: string): string {
		return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}
}

