import type AdvancedSearchPlugin from "../main";
import { SearchModal } from "../ui/search-modal";

export function registerCommands(plugin: AdvancedSearchPlugin): void {
	plugin.addCommand({
		id: "advanced-search-open",
		name: "Advanced search",
		callback: () => {
			new SearchModal(plugin).open();
		},
	});

	plugin.addCommand({
		id: "advanced-search-current-note",
		name: "Advanced search in current note",
		callback: () => {
			new SearchModal(plugin, "current").open();
		},
	});
}
