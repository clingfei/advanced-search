import type AdvancedSearchPlugin from "../main";
import { SearchModal } from "../ui/search-modal";

export function registerCommands(plugin: AdvancedSearchPlugin): void {
	plugin.addCommand({
		id: "open-search",
		name: "Open search",
		callback: () => {
			new SearchModal(plugin).open();
		},
	});

	plugin.addCommand({
		id: "search-current-note",
		name: "Search in current note",
		callback: () => {
			new SearchModal(plugin, "current").open();
		},
	});
}
