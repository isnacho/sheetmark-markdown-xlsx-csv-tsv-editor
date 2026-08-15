# Changelog

## Unreleased

### Improvements

- Code-style text (inline code, fenced blocks, and other mono surfaces) now uses bundled **JetBrains Mono Regular** for consistent rendering across macOS and Windows, with centralized `--font-mono-size` (13.5px) and `--font-mono-weight` tokens.

### Bug fixes

- Markdown: fixed silent data loss when typing during an in-flight save/autosave (`originalContent` now tracks the text actually written).
- Markdown: circular YAML frontmatter no longer crashes live preview.
- Markdown: pipe-table and callout syntax inside fenced code blocks is no longer misinterpreted as real tables/callouts.
- Markdown: clicking a cell in a second table after editing the first table no longer lands the cursor at stale positions.
- Markdown: table widget `ResizeObserver`/`MutationObserver` instances are disconnected when the widget is destroyed.
- Markdown: restoring a version now warns when the file changed on disk externally, instead of silently overwriting.
- Markdown: initial file read failures show an in-tab error with retry instead of a stuck loading screen.
- Markdown: Go to Line (Ctrl/Cmd+G) uses an in-webview dialog — `window.prompt` was blocked by the sandbox.
- Markdown: list/heading/blockquote toggles now apply to every line in a multi-line selection.
- Markdown: spellcheck context menu and active view are torn down when the live preview unmounts.
- Markdown tables: fixed bordered outline staying full width after column resize.

### Performance

- Markdown live preview: reduced per-keystroke work (dirty-state checks, debounced search reapply, TOC resize throttling, widget rebuild gating, viewport-scoped spellcheck exclusions).
- Markdown tables: row/column drag and hover grips are rAF-throttled with cached geometry during drags.
- Markdown version history: append-only NDJSON snapshots avoid rewriting the full history file on every save.

### Maintenance

- Design system colors refactored to a two-layer token model (`--palette-*` primitives, `--color-*` semantic roles) in `theme.css`; brand and action unified on blue across light/dark themes.
- Removed dead markdown scaffolding (redundant edit-mode flags, unused frontmatter render helpers, vestigial KaTeX CDN link).
- Toolbar icons use a subtler muted gray at rest (`#86868b`) and brighten on hover/focus; main toolbar and formatting bar aligned.

## v1.0.0

Initial release of **Sheetmark: XLSX, CSV, TSV & Markdown** (`iggyinc.sheetmark`).

- Unified spreadsheet editor for XLSX, CSV, and TSV with formatting, sorting, filtering, conversion, and version history.
- Markdown live-preview editing with tables, callouts, Mermaid, outline panel, and disk sync.
- Help & Feedback via in-app form and [GitHub issues](https://github.com/nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor/issues).

Fork of the MIT-licensed [xlsx-viewer](https://github.com/Mahmadabid/XLSX-CSV-TSV-MARKDOWN-Editor-Vscode-Extension) project; original copyright retained in [LICENSE](LICENSE).
