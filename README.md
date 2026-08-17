# Sheetmark for VS Code

**Free and open source, forever.** Sheetmark gives `.md`, `.xlsx`, `.csv`, and `.tsv` files a polished, visual editing experience—so your specs, notes, data, and code can live in one workspace, without leaving VS Code.

[Install from the VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=iggyinc.sheetmark) · [Install from Open VSX / Cursor](https://open-vsx.org/extension/iggyinc/sheetmark) · [`code --install-extension iggyinc.sheetmark`](#install)

## Why Sheetmark?

As a PM and designer, I increasingly use VS Code as the place where I build with AI. I draft PRDs, analyse user feedback, write product copy, and keep the Markdown docs and spreadsheets that support that work beside the code.

Those files should not mean switching to another app, but the existing extensions fell short. So I built my own.

- **Write Markdown visually.** Work directly in a live rendered document, with Markdown syntax appearing only where you are editing.
- **Use spreadsheets like spreadsheets.** Edit, format, search, sort, filter, and navigate cells in XLSX, CSV, and TSV files.
- **Feel at home in VS Code.** Sheetmark follows your light, dark, and high-contrast theme and offers configurable toolbars, headers, and density.

## Markdown, beautifully editable

See your document as you write it—not as a wall of markers. Click a heading, paragraph, table, or list to edit it in place; move away and the source syntax fades back into the finished document.

- **Edit the document, not its markup.** Write, restructure, and format directly in the rendered view.
- **Keep complex docs readable.** Tables, task lists, callouts, Mermaid diagrams, images, links, code blocks, and footnotes render in context.
- **Find your way around.** Use the outline panel, word wrap, and optional line numbers in code blocks.

## Spreadsheets, right inside your IDE

Spreadsheets are a powerful way to collect, organise, and share information. People send feedback, research, content inventories, requirements, and working data in them—and they often arrive as CSV or Excel files.

Sheetmark lets you work with that information without leaving VS Code. Open an XLSX, CSV, or TSV file in one familiar grid, then shape the data and make it easy to use. Their clear structure also makes spreadsheets excellent context for AI when you want an agent to understand or update a dataset.

- **Make the important things visible.** Edit cells and apply text and background colours, fonts, alignment, borders, wrapping, format painter, and clear formatting.
- **Turn rows into useful working data.** Add checkboxes, dropdowns, star ratings, and dates; XLSX files can also display inline images.
- **Sort, filter, and find the signal.** Search in-grid, then combine per-column filters such as contains, equals, starts with, non-empty, and case-sensitive.
- **Work at spreadsheet speed.** Select ranges, rows, and columns; resize or auto-fit columns; and use full keyboard navigation—even in multi-thousand-row files.
- **Keep data flexible and recoverable.** Convert directly between CSV, TSV, and XLSX, and preview or restore a recent version when needed.

## Install

For VS Code, install Sheetmark from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=iggyinc.sheetmark), or run:

```bash
code --install-extension iggyinc.sheetmark
```

For Cursor and other Open VSX-compatible editors, install it from [Open VSX](https://open-vsx.org/extension/iggyinc/sheetmark), or search for **Sheetmark** in the Extensions view. If a newly released version has not appeared there yet, download its `.vsix` from [GitHub Releases](https://github.com/nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor/releases) and run **Extensions: Install from VSIX...**.

Then open an `.xlsx`, `.csv`, `.tsv`, or `.md` file and choose **Open with Sheetmark** if it is not already selected as the editor.

## Feedback and support

Use **Help & Feedback** in the toolbar of any supported file, or [report a bug / request a feature on GitHub](https://github.com/nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor/issues). If Sheetmark helps your workflow, a [Marketplace review](https://marketplace.visualstudio.com/items?itemName=iggyinc.sheetmark) makes it easier for others to discover.

## License

MIT. See [LICENSE](LICENSE). Sheetmark began as a fork of Muhammad Ahmad’s [XLSX, CSV, TSV & Markdown Editor](https://github.com/Mahmadabid/XLSX-CSV-TSV-MARKDOWN-Editor-Vscode-Extension); the original 2024 copyright notice is preserved alongside the fork’s own.
