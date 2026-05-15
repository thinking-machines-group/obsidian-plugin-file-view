# Thinking Machines File Explorer

Obsidian plugin that interleaves files and directories in the File Explorer sort order so identifiers like Johnny Decimal IDs display in true numeric sequence.

By default, Obsidian's File Explorer sorts folders into one bucket and files into another, then displays folders first. A directory of `46.01_PROJECT.md`, `46.02_linkedin-posts/`, `46.03_pilots/`, `46.04_notes.md` ends up rendered as `46.02`, `46.03`, `46.01`, `46.04` — folders first, then files, each group alphabetized. This plugin merges the two buckets into one sorted list so the rendering matches Finder, VS Code, and `ls`.

The plugin patches the per-folder sort method on the existing File Explorer view. No alternative explorer pane, no replacement UI. Disabling the plugin restores default behavior without a restart.

## Scope

Supported sort modes (the ones Obsidian exposes in the File Explorer header):

1. File name (A → Z)
2. File name (Z → A)
3. Modified time (new → old)
4. Modified time (old → new)
5. Created time (new → old)
6. Created time (old → new)

Out of scope for v1: replacement UI, per-folder custom ordering, pinning, drag-to-reorder, configurable sort modes beyond what Obsidian already offers, Community Plugins directory submission, cross-platform testing beyond macOS desktop.

## Install (manual / sideload)

1. Build: `npm install && npm run build` produces `main.js`.
2. Copy `main.js` and `manifest.json` into your vault at `<vault>/.obsidian/plugins/obsidian-plugin-file-view/`.
3. In Obsidian, open Settings → Community plugins, disable Restricted Mode, then toggle this plugin on.

## Private API caveat

The File Explorer's sort surface is not part of Obsidian's documented public API. The plugin monkey-patches `FolderTreeItem.prototype.sort` on the existing File Explorer view. Any Obsidian release can rename or restructure that surface. The patch is small and easy to re-locate — if a future release breaks it, console will log `[interleaved-sort]` diagnostics on plugin load.

Developed against Obsidian desktop **1.12.4** on macOS.

## License

MIT
