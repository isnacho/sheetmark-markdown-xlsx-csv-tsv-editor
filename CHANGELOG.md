# Changelog

## Unreleased

- Markdown: the status bar's Document Stats now update to show word/character/line counts and reading time for the current selection, and count only displayed text (Markdown syntax like `**`/`#`/link URLs is excluded). Individual stats — including the current line indicator — can be toggled on/off in Settings.

## v1.1.0 — 2026-08-15

### Improvements

- Code-style text (inline code, fenced blocks, and other mono surfaces) now uses bundled **JetBrains Mono Regular** for consistent rendering across macOS and Windows, with centralized `--font-mono-size` (13.5px) and `--font-mono-weight` tokens.
- Markdown: the Preview Edit line-number gutter now highlights whichever row your mouse is hovering, alongside the existing active-line (cursor) indicator.
- Markdown: keyboard selection now follows standard Mac text-editing conventions — Cmd+Left/Right jumps to the line boundary, and Shift+Option+Up/Down selects to the start/end of the current paragraph.

### Bug fixes

- Markdown tables: clicking a cell now places the caret at the click position on the first click instead of always jumping to the end of the cell.
- Markdown: local images in Preview Edit now render after fixing URI resolver wiring order on editor mount.
- Markdown: Mermaid diagrams in longer documents now render once background parsing finishes (widget decorations previously only rebuilt on edits).
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
- Markdown fenced code blocks: ↑↓ arrow keys now move one line at a time without skipping or jumping out of the block; clicks land on the intended line instead of the row below.

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
