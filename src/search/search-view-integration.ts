import { setIcon, type WorkspaceLeaf } from "obsidian";
import type AdvancedSearchPlugin from "../main";

const SEARCH_VIEW_TYPE = "search";
const CONTROLS_ATTRIBUTE = "data-advanced-search-controls";
const WHOLE_WORD_LABEL = "W";
const MIN_RIGHT_GUTTER = 2;
const DEFAULT_ICON_GAP = 2;
const INPUT_PADDING_GAP = 8;

interface SearchControls {
	leaf: WorkspaceLeaf;
	inputEl: HTMLInputElement;
	hostEl: HTMLElement;
	controlsEl: HTMLDivElement;
	wholeWordButtonEl: HTMLButtonElement;
	wholeWordTextEl: HTMLSpanElement;
	regexButtonEl: HTMLButtonElement;
	wholeWord: boolean;
	useRegex: boolean;
	rawQuery: string;
	applyingQuery: boolean;
	stateSyncId: number;
	originalPaddingRightPx: number;
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
	}

	destroy(): void {
		for (const controls of this.activeControls) {
			controls.controlsEl.remove();
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
				controls.controlsEl.remove();
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
		const hostEl =
			(inputEl.closest(".search-input-container") as HTMLElement | null) ??
			inputEl.parentElement ??
			leaf.view.containerEl;

		hostEl.findAll(`[${CONTROLS_ATTRIBUTE}]`).forEach((el) => el.remove());

		const controlsEl = createDiv({
			cls: "advanced-search-inline-controls",
		});
		controlsEl.setAttr(CONTROLS_ATTRIBUTE, "true");
		const wholeWordToggle = this.createTextToggleButton(
			controlsEl,
			"Match whole word",
			WHOLE_WORD_LABEL
		);

		const controls: SearchControls = {
			leaf,
			inputEl,
			hostEl,
			controlsEl,
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
			applyingQuery: false,
			stateSyncId: 0,
			originalPaddingRightPx: this.readPaddingRightPx(inputEl),
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
			void this.syncSearchState(controls);
			this.persistDefaults(controls);
		});

		this.plugin.registerDomEvent(controls.regexButtonEl, "click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			controls.rawQuery = controls.inputEl.value;
			controls.useRegex = !controls.useRegex;
			this.updateButtonStates(controls);
			void this.syncSearchState(controls);
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

		if (!controls.wholeWord && !controls.useRegex) {
			return;
		}

		event.stopImmediatePropagation();
		void this.syncSearchState(controls);
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

	private async syncSearchState(controls: SearchControls): Promise<void> {
		const syncId = ++controls.stateSyncId;
		const queryForSearch = this.encodeQuery(
			controls.rawQuery,
			controls.useRegex,
			controls.wholeWord
		);

		const viewState = controls.leaf.getViewState();
		const currentState = (viewState.state ?? {}) as Record<string, unknown>;
		if (currentState.query === queryForSearch) {
			return;
		}

		const inputEl = controls.inputEl;
		const visibleValue = controls.rawQuery;
		const selectionStart = inputEl.selectionStart;
		const selectionEnd = inputEl.selectionEnd;

		controls.applyingQuery = true;
		try {
			await controls.leaf.setViewState({
				...viewState,
				state: {
					...currentState,
					query: queryForSearch,
				},
			});
		} finally {
			if (syncId !== controls.stateSyncId) {
				return;
			}

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

	private persistDefaults(controls: SearchControls): void {
		this.plugin.settings.defaultWholeWord = controls.wholeWord;
		this.plugin.settings.defaultUseRegex = controls.useRegex;
		void this.plugin.saveSettings();
	}

	private encodeQuery(
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

	private ensureHostForAbsolutePosition(hostEl: HTMLElement): void {
		if (window.getComputedStyle(hostEl).position === "static") {
			hostEl.addClass("advanced-search-host-relative");
		}
	}

	private positionControls(controls: SearchControls): void {
		if (!controls.controlsEl.isConnected) {
			return;
		}

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

		const previousRect = icons[anchorIndex - 1].getBoundingClientRect();
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
		return candidates.length > 0 ? candidates[candidates.length - 1] : null;
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
