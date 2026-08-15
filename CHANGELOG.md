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
- Markdown tables: fixed bordered outline staying full width after column resize.

## v1.0.0

Initial release of **Sheetmark: XLSX, CSV, TSV & Markdown** (`iggyinc.sheetmark`).

- Unified spreadsheet editor for XLSX, CSV, and TSV with formatting, sorting, filtering, conversion, and version history.
- Markdown live-preview editing with tables, callouts, Mermaid, outline panel, and disk sync.
- Help & Feedback via in-app form and [GitHub issues](https://github.com/nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor/issues).

Fork of the MIT-licensed [xlsx-viewer](https://github.com/Mahmadabid/XLSX-CSV-TSV-MARKDOWN-Editor-Vscode-Extension) project; original copyright retained in [LICENSE](LICENSE).
