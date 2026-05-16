# Advanced search

Advanced search extends Obsidian's built-in **Search** view by adding VS Code-like search controls:
- `W` for whole-word matching
- `.*` for regular-expression matching
- **Files to include** and **Files to exclude** inputs under the main search box

## Purpose

This plugin is for users who want more precise filtering in Obsidian global search while keeping the native search workflow.

You can keep using Obsidian's original Search view, but with extra controls for:
- whole-word search
- regex search
- path-based include/exclude filtering

## Usage

1. Open Obsidian's **Search** view.
2. Type your content query in the main search box.
3. Toggle `W` for whole-word mode if needed.
4. Toggle `.*` for regex mode if needed.
5. Optionally fill **Files to include** and **Files to exclude**.
6. Results refresh automatically whenever query or toggle/filter state changes.

### Matching behavior

For include/exclude filters:
- Plain value with no glob (`* ? [ ] { }`):
- If it resolves to an existing file, it matches that file exactly.
- If it resolves to an existing folder, it matches all files under that folder.
- Name-only value expands to both same-name files and same-name folders.
- Value with glob characters uses glob matching.
- To force folder-only behavior, add a trailing slash (for example `test/`).
- To force file-only behavior, use full file name or relative file path.

## Privacy and data access

This plugin only reads files locally inside your Obsidian vault to perform search.

- **What it reads:** file paths and file contents in the active vault, via Obsidian's `vault.getMarkdownFiles()` / `vault.getAllLoadedFiles()` APIs. This is what triggers the "Vault Enumeration" disclosure shown on the community-plugin listing; it is required for global search and include/exclude path filtering to work.
- **No network access:** the plugin makes no HTTP requests and does not load any remote resource. There is no `fetch`, `requestUrl`, or `XMLHttpRequest` call in the source.
- **No telemetry:** nothing about your vault, queries, results, or usage is collected, stored outside the vault, or transmitted anywhere.
- **No file modification:** the plugin is read-only with respect to your notes. The only thing it writes is its own settings via Obsidian's `saveData()` (stored in `data.json` inside the plugin folder).
