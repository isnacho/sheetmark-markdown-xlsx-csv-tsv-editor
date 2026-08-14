# Sheetmark: Markdown, XLSX, CSV & TSV

IDEs like VS Code aren't just to write code anymore.

As a PM and designer, VS Code has become the main way I build and collaborate with AI agents. I create PRDs, analyse user feedback, write copy... and Markdown docs and spreadsheets are as much a part of this work as code is.

But previewing and editing those files inside an IDE leaves a lot to be desired, and it was slowing me down.

So I built Sheetmark for VS Code: proper, thoughtfully-designed editing and preview for exactly the files my agents and I are already using.

I can't imagine collaborating with AI agents without it now.

---

## Markdown editing & preview

It's a great Markdown editing experience, inspired by tools like Notion and built around one idea: what you see is what you edit.

- **Edit right inside the rendered preview.** Click into a table and add a row, tweak a heading and restyle a paragraph.
- **GitHub-Flavored Markdown.** Tables, task lists, fenced code blocks, and footnotes render the way they do on GitHub.
- **Other features.** Table-of-contents outline navigation, line numbers on code blocks, one-click copy of the full document as Markdown, and local images and links that just render.

## Spreadsheet editing: XLSX, CSV, TSV

- **One grid, three formats.** XLSX, CSV, and TSV open in the same spreadsheet webview, so muscle memory transfers between them.
- **Real formatting, not just data entry.** Text and background color, bold/italic/underline/strikethrough, alignment, borders, font family and size, wrapping, format painter, and clear-formatting, all in styled mode.
- **CSV/TSV get styling too.** Delimited files can't store formatting natively, so styled-mode formatting is kept in a local style layer alongside the file, and can be carried forward when you convert to XLSX.
- **Cell types beyond plain text.** Checkboxes, dropdowns, star ratings, and dates work as interactive controls across XLSX, CSV, and TSV; XLSX also renders embedded images inline.
- **Find, sort, filter.** In-grid find, plus per-column sort and filters (contains, equals, starts-with, non-empty, case-sensitive) from the column header's right-click menu, combined across columns.
- **Convert formats.** Save a CSV, TSV, or XLSX copy of the file in another format straight from the toolbar, without reaching for an external tool.
- **Version history.** Every autosaved or manual save is archived; preview and roll back to an earlier version from inside the editor.
- **Handles large files.** Rows are windowed and fetched on demand, so multi-thousand-row sheets scroll smoothly instead of loading everything into memory at once.
- **Spreadsheet-grade navigation.** Multi-cell and range selection, row/column selection, column resize and auto-fit, and full keyboard navigation.
- **Plain view when you just want the data.** Drop styling and inspect raw values without visual noise.

## Built to feel native

- **Theme-aware.** Matches your active VS Code light, dark, or high-contrast theme automatically.
- **Layout is yours to configure.** Toggle sticky toolbars, sticky headers, spacious cells, header rows, and hyperlink previews per format.

---

## Getting started

**Spreadsheets**

1. Open a `.xlsx`, `.csv`, or `.tsv` file. It opens in the spreadsheet editor by default.
2. Click a cell to select or edit it directly in plain mode.
3. Switch to styled mode (CSV/TSV) or stay in it (XLSX), then click **Edit Table** to bring up the formatting toolbar.
4. Select a range and use the toolbar for color, borders, alignment, wrapping, or fonts.
5. Right-click a column header to sort or filter it.
6. Use **Convert** on the toolbar to save a copy in another format.
7. Open the history icon to preview or restore a previous version.

**Markdown**

1. Open a `.md` file. It opens directly in the live-preview editor, no mode switch needed.
2. Click anywhere in the rendered view and start typing to edit it directly.
3. If VS Code opened the file in its plain text editor instead, use **Open in Preview** from the editor title bar or Command Palette to switch to this editor.

---

## Installation

Open the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`), search for **Sheetmark**, and click **Install**, or install from the command line:

```bash
code --install-extension iggyinc.sheetmark
```

Or install directly from the [VS Code Marketplace listing](https://marketplace.visualstudio.com/items?itemName=iggyinc.sheetmark).

---

## Feedback & support

- **In-editor:** use **Help & Feedback** in the toolbar of any supported file type.
- **GitHub:** file bugs and feature requests at [nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor](https://github.com/nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor/issues).
- **Marketplace review:** a rating on the [Marketplace listing](https://marketplace.visualstudio.com/items?itemName=iggyinc.sheetmark) helps other people find the extension.

## License

MIT. See [LICENSE](LICENSE): the original 2024 copyright notice is preserved alongside the fork's own. Sheetmark started as a fork of Muhammad Ahmad's [XLSX, CSV, TSV & Markdown Editor](https://github.com/Mahmadabid/XLSX-CSV-TSV-MARKDOWN-Editor-Vscode-Extension), credit to the original project for the foundation.

## Links

- GitHub: [nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor](https://github.com/nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor)
- VS Code Marketplace: [iggyinc.sheetmark](https://marketplace.visualstudio.com/items?itemName=iggyinc.sheetmark)

## Publishing updates

Publishing is automated by GitHub Actions. Bump the version in `package.json`, commit it with the changelog update, then create and publish a GitHub Release from that commit. The release workflow publishes the matching version to the VS Code Marketplace.

The repository requires a `VSCE_PAT` Actions secret containing an Azure DevOps PAT with the `Marketplace > Manage` scope. This is a transitional authentication method: Microsoft will retire global PATs on December 1, 2026, so the workflow should be migrated to Microsoft Entra workload identity before then.
