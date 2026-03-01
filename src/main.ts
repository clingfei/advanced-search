import { Plugin } from "obsidian";
import {
	AdvancedSearchSettingTab,
	DEFAULT_SETTINGS,
	type AdvancedSearchSettings,
} from "./settings";
import { registerCommands } from "./commands";

export default class AdvancedSearchPlugin extends Plugin {
	settings: AdvancedSearchSettings;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new AdvancedSearchSettingTab(this.app, this));
		registerCommands(this);
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
