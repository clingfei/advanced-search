import { App, PluginSettingTab, Setting } from "obsidian";
import type AdvancedSearchPlugin from "./main";

export interface AdvancedSearchSettings {
	defaultScope: "current" | "vault";
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
			.setName("Match whole word by default")
			.setDesc("Enable the whole-word icon when opening Obsidian search.")
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
			.setDesc("Enable the regex icon when opening Obsidian search.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.defaultUseRegex)
					.onChange(async (value) => {
						this.plugin.settings.defaultUseRegex = value;
						await this.plugin.saveSettings();
					});
			});
	}
}
