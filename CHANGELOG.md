# Changelog

## Unreleased

## v1.4.0 — 2026-09-03

### Improvements

- Markdown lists: wrapped and nested list text now hang-indents under the item's own text instead of the editor's left margin, with bullet/number/checkbox markers aligned and cascading consistently across nesting levels.

### Bug fixes

- Markdown lists: drag-to-select on hanging-indent list lines now resolves the caret correctly instead of snapping the anchor to the line start.
- Markdown: the editor and outline no longer flash visible content while the document is still loading.

## v1.3.0 — 2026-08-31

### Improvements

- Markdown: the status bar's Document Stats now update to show word/character/line counts and reading time for the current selection, and count only displayed text (Markdown syntax like `**`/`#`/link URLs is excluded). Individual stats — including the current line indicator — can be toggled on/off in Settings.
- Markdown: Mermaid diagrams support zoom (Ctrl/Cmd+scroll, or the toolbar's +/− buttons) and pan (drag once zoomed in), with a reset button and double-click to fit.
- Markdown lists: Notion-style marker navigation (arrow keys and delete treat bullet/number as one unit) and improved marker inset/spacing in Preview Edit.
- Markdown tables: column resize can make tables wider than the pane with isolated horizontal scroll and a right-edge fade; canonical behavior is documented in `MARKDOWN-TABLES.md`.
- Markdown: spell check dictionary now loads in Preview Edit (CSP fix), with responsive linting while scrolling.
- Markdown: when a file changes on disk, you can now review the change as a diff and accept or reject it piece by piece (or all at once), instead of only choosing to load the disk version or keep yours. Opt in from Settings ("Review External Changes as a Diff"); off by default.

## v1.2.0 — 2026-08-17

### Improvements

- Major Markdown editing improvements, including list navigation, selection behavior, gutters, live preview, and reliability fixes.
- Spreadsheet and file-handling polish, including editor defaults and external file synchronization.
- Sheetmark is now distributed through Open VSX for Cursor, with a GitHub Release VSIX fallback.

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
