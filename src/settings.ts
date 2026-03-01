import { App, PluginSettingTab, Setting } from "obsidian";
import type AdvancedSearchPlugin from "./main";
import type { SearchScope } from "./types";

export interface AdvancedSearchSettings {
	defaultScope: SearchScope;
	defaultWholeWord: boolean;
	defaultUseRegex: boolean;
	defaultMatchCase: boolean;
}

export const DEFAULT_SETTINGS: AdvancedSearchSettings = {
	defaultScope: "vault",
	defaultWholeWord: false,
	defaultUseRegex: false,
	defaultMatchCase: false,
};

export class AdvancedSearchSettingTab extends PluginSettingTab {
	plugin: AdvancedSearchPlugin;

	constructor(app: App, plugin: AdvancedSearchPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Default scope")
			.setDesc("Choose where searches run by default.")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("current", "Current note")
					.addOption("vault", "Whole vault")
					.setValue(this.plugin.settings.defaultScope)
					.onChange(async (value) => {
						this.plugin.settings.defaultScope = value as SearchScope;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Match whole word by default")
			.setDesc("Only match complete words.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.defaultWholeWord)
					.onChange(async (value) => {
						this.plugin.settings.defaultWholeWord = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Use regular expression by default")
			.setDesc("Treat the search query as a regular expression.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.defaultUseRegex)
					.onChange(async (value) => {
						this.plugin.settings.defaultUseRegex = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Match case by default")
			.setDesc("Only match exact casing.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.defaultMatchCase)
					.onChange(async (value) => {
						this.plugin.settings.defaultMatchCase = value;
						await this.plugin.saveSettings();
					});
			});
	}
}
