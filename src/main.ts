import { Plugin } from "obsidian";
import {
	AdvancedSearchSettingTab,
	DEFAULT_SETTINGS,
	type AdvancedSearchSettings,
} from "./settings";
import { SearchViewIntegration } from "./search/search-view-integration";

export default class AdvancedSearchPlugin extends Plugin {
	settings: AdvancedSearchSettings;
	private searchViewIntegration: SearchViewIntegration | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new AdvancedSearchSettingTab(this.app, this));
		this.searchViewIntegration = new SearchViewIntegration(this);
		this.searchViewIntegration.initialize();
	}

	onunload(): void {
		this.searchViewIntegration?.destroy();
		this.searchViewIntegration = null;
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<AdvancedSearchSettings>
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
