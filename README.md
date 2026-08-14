# Sheetmark: XLSX, CSV, TSV & Markdown

This open-source extension lets you view and edit XLSX, CSV, TSV, and GitHub Flavored Markdown files directly in VS Code. XLSX, CSV, and TSV now share one unified spreadsheet editor, one webview, and one editing pipeline, so selection, virtualization, sorting, filtering, conversion, settings, and save behavior stay consistent across tabular formats.

## Overview

The extension turns VS Code into a practical spreadsheet and Markdown workspace. You can inspect large datasets, edit tabular files, format spreadsheet content, convert between CSV/TSV/XLSX, and author Markdown with a synchronized preview without leaving the editor.

> **Notice:** This extension has evolved from separate XLSX, CSV, and TSV editors into a unified spreadsheet webview backed by a single custom editor provider.

---

## Key Features

### Full-Featured Spreadsheet Editor (XLSX, CSV, TSV)

- **Unified spreadsheet webview:** XLSX, CSV, and TSV are handled by one shared grid implementation.
- **Google Sheets-style editing:** Rich text formatting, text/background colors, strikethrough, alignment, borders, font size, font family, wrapping, clear formatting, and format painter in styled mode.
- **CSV/TSV styled mode:** CSV and TSV can use temporary local style persistence for formatting that delimited files cannot store directly.
- **Advanced cell controls:** Checkboxes, dropdowns, ratings, dates, and images are supported in the spreadsheet grid where the underlying format supports them.
- **Find, sort, and filter:** Built-in find plus column header sorting and filters for contains, equals, starts-with, non-empty, and case-sensitive matching.
- **Cross-format conversion:** Convert files between CSV, TSV, and XLSX from the editor toolbar.
- **Version history and rollback:** Recent states are archived so you can preview and restore prior file versions.
- **Autosave and persistence:** Configurable autosave for text, controls, formatting, and structure changes.
- **Large file virtualization:** Windowed rendering keeps CSV, TSV, and XLSX responsive on large datasets.
- **Excel-like selection and navigation:** Multi-cell selection, row/column selection, resizing, auto-fit, and keyboard navigation.
- **Plain view mode:** Hide styling for a simpler data-first view.

### Advanced Markdown Viewer & Editor

- **CM6 live preview editing:** Obsidian-style live preview — edit formatted Markdown directly in a CodeMirror 6 surface (tables, callouts, mermaid, frontmatter widgets).
- **GitHub-Flavored Markdown:** Tables, task lists, code blocks, footnotes, and callouts.
- **Interactive outline panel:** Navigate long documents with an auto-scrolling table of contents.
- **Local asset support:** Render relative links and local images.
- **Disk sync:** Detect external changes, moves, and deletions; reload from disk with conflict handling.
- **Code block enhancements:** Copy buttons, optional line numbers, and Mermaid diagram/code preview toggle.
- **Spellcheck** in live preview (Typo.js dictionary bundled).

### Native VS Code Experience

- **Theme integration:** The UI follows the active VS Code light, dark, or high-contrast theme.
- **Configurable layout:** Toggle headers, sticky toolbars, sticky headers, spacious cells, and hyperlink previews.
- **In-editor feedback:** Use Help & Feedback from the toolbar to report issues or suggestions.

---

## Usage Guide

### Working with Spreadsheets

1. Open any `.xlsx`, `.csv`, or `.tsv` file from the VS Code explorer.
2. Click a cell to select or edit it. CSV/TSV plain mode supports direct table editing.
3. Toggle styled mode when you need formatting for CSV/TSV, or work directly in styled mode for XLSX.
4. Select cells and use the toolbar to apply colors, borders, alignment, wrapping, fonts, or clear formatting.
5. Right-click a column header to sort or filter. Multiple column filters are combined.
6. Click **Convert** to convert between CSV, TSV, and XLSX.
7. Click the history icon to preview or restore previous file versions.

### Unified Spreadsheet Architecture

The tabular editor is now merged into a single implementation:

- `SpreadsheetEditorProvider` handles XLSX/CSV/TSV file IO, virtual row requests, saves, style persistence, conversion, settings, and version history.
- `spreadsheetWebview.ts` handles the shared grid UI, selection, edit modes, toolbar actions, sorting, filtering, and virtualization.
- CSV/TSV plain mode writes directly to the delimited file.
- CSV/TSV styled mode stores formatting in local extension state and can carry that formatting into XLSX conversion.

### Working with Markdown

1. Open a `.md` file — the custom editor opens in live preview edit mode.
2. Type and format directly in the rendered document (toolbar, slash menu, keyboard shortcuts).
3. Use the outline panel to jump between headings.
4. **Reload from disk** when external tools change the file; the editor surfaces change/move/delete toasts.
5. Toggle word wrap, outline, line numbers, and live-preview reveal in Settings.

---

## Settings & Configuration

Key settings include:

- **Autosave (`xlsxViewer.*.autoSave`):** Enable or disable automatic saving for supported file types.
- **Sticky elements (`xlsxViewer.*.stickyToolbar`, `xlsxViewer.*.stickyHeader`):** Keep toolbars and headers visible while scrolling.
- **Spacious cells (`xlsxViewer.*.spaciousCells`):** Increase cell padding for a more readable grid.
- **Spreadsheet controls (`xlsxViewer.xlsx.allowInteractiveControlsOutsideEditMode`):** Allow interactive controls outside table edit mode.
- **Markdown layout (`xlsxViewer.md.wordWrap`, `xlsxViewer.md.showOutline`, `xlsxViewer.md.livePreviewReveal`, `xlsxViewer.md.livePreviewLineNumbers`):** Control wrap, outline, syntax reveal, and gutter line numbers in live preview.

Open VS Code Settings and search for `xlsxViewer` to see all options.

See [CHANGELOG.md](CHANGELOG.md) for release history.

---

## Installation

1. Open VS Code.
2. Go to the Extensions Marketplace with `Ctrl+Shift+X`.
3. Search for `Sheetmark`.
4. Click **Install**.

You can also install it from the command line:

```bash
code --install-extension nacho-allendesalazar.sheetmark
```

---

## Feedback & Support

- **In-app feedback:** Use the Help & Feedback button in the extension toolbar.
- **Marketplace review:** Rate the extension on the VS Code Marketplace if it is useful for your workflow.
- **GitHub:** Submit issues, feature requests, or pull requests at [nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor](https://github.com/nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor).

## License

This project is licensed under the MIT License. It is a fork of the upstream MIT-licensed [xlsx-viewer](https://github.com/Mahmadabid/XLSX-CSV-TSV-MARKDOWN-Editor-Vscode-Extension) project; the original copyright notice is retained in [LICENSE](LICENSE).

## Links

- GitHub: [nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor](https://github.com/nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor)
- VS Code Marketplace: [Download Extension](https://marketplace.visualstudio.com/items?itemName=nacho-allendesalazar.sheetmark)
