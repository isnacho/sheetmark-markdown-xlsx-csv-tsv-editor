# Changelog

## Unreleased

- Markdown and spreadsheet editors: text now uses Inter instead of the system font. Inter is bundled with the extension, so it looks the same on macOS and Windows; if it cannot load, the editors fall back to the system font. Spreadsheet cells that carry their own font from the file (such as Calibri) keep it.
- Markdown and spreadsheet editors: a new Font choice in each editor's Settings panel (next to Theme) switches the font at once. Pressing it opens a list you can search by typing ("hel neue" finds Helvetica Neue) and move through with the arrow keys, Enter and Escape. It offers Inter, System and Serif, then every font installed on your computer. It is one shared setting (`xlsxViewer.fontFamily`), so a pick in one editor applies to every open Sheetmark editor, and a font that is missing on another machine falls back to the system font. Spreadsheet columns widen if the new font needs more room. In a remote window (SSH, WSL, Dev Containers) the list shows the remote machine's fonts.
- Spreadsheet: the toolbar now matches the Markdown editor's. Find, Version history, Convert, Help and Settings sit together at the right end, with Settings last; before, Settings sat in the middle of the row and Find near the left.
- Markdown Preview Edit: toggles work from the keyboard. Cmd/Ctrl+Enter in a toggle's title opens or closes it, as in Notion; the toggle arrow and its handle can be reached with Tab and used with Enter or Space. These and other small controls (copy, diagram zoom, callout type, table menu, find and toast buttons) now show a clear focus ring in VS Code's focus colour.
- Markdown Preview Edit: tables, images and Mermaid diagrams inside a toggle are now indented with the toggle's text, like everything else in it. Before, they sat at the toggle's left edge and looked as if they were outside it.
- Markdown and spreadsheet toolbars: every toolbar icon now has the same colour, a little darker in light themes and lighter in dark ones. The small text buttons (H1, H2, H3, AB, ab, Ab) used to be a different shade, and are now easy to read (they were below the 4.5:1 contrast that small text needs).
- Markdown Preview Edit: in a narrow window the formatting toolbar stays on one row and scrolls sideways, with a thin scrollbar that shows there is more. Before, the scrollbar was hidden, so the last button looked cut in half and the rest seemed missing.
- Markdown Preview Edit: a Mermaid diagram with a syntax error now keeps its Diagram/Code switch and copy button, shows Mermaid's own error message, and has an Edit code button that opens the code. Before, the card only told you to switch to Code and showed no way to do it.
- Markdown editor, light themes: code blocks, inline code, the YAML card, table headers and the formatting toolbar use lighter, flatter grays (on VS Code's Light Modern theme: #F5F5F5 surfaces, #FAFAFA for the YAML body and table stripes, #EBEBEB lines). Before, the page mixed six grays and the code blocks were the darkest. Dark and high-contrast themes are unchanged.
- Markdown Preview Edit: the callout type menu now moves with the cursor. Clicking from one callout into another shows the menu for the one you are in; before, it stayed on the first callout until you typed something.
- Markdown Preview Edit: a callout with a title on its first line (`::: warning Before you start`) now shows that title in bold at the top of the callout instead of hiding it. The info, warning, error and success icons are now matching drawn icons in their colours (the info icon used to be a plain letter i).
- Markdown and spreadsheet editors: if your system is set to reduce motion, nothing in either editor animates any more (before, only three things respected it). Toasts now fade in over 120ms without the zoom, and images no longer grow when you hover them.
- Markdown Preview Edit: when you type or move down near the bottom of the window, the page now scrolls early enough that the cursor stays above the word count pill instead of disappearing behind it.
- Markdown Preview Edit: level 1 to 3 headings get extra space above them (16, 12 and 8px), so each heading sits with the section it starts, as in Notion. Level 6 headings are now a little smaller than body text instead of the same size.
- Markdown Preview Edit: spellcheck no longer underlines web addresses, email addresses, link targets or HTML tags, and accepts common technical words such as Markdown, callout, blockquote, frontmatter, URL and GFM.
- Markdown Preview Edit: table headers now line up with the cells below them. They used to be centred even when the column was left-aligned; a column aligned in the Markdown (`:-:` or `--:`) still aligns its header the same way.
- Markdown Preview Edit: selecting text over several lines no longer paints the highlight into the empty margins on both sides, and selecting just a line break no longer draws a box in the left margin.
- Markdown Preview Edit: the handle that appears when you hover a toggle is now six drawn dots, as in Notion, centred on the title next to the arrow (it used to sit a few pixels low).
- Markdown Preview Edit: the find box (Cmd/Ctrl+F) now says "Find in document" instead of "Search in preview...", and screen readers announce it by that name.
- Markdown Preview Edit: code blocks show a small language label instead of their ``` lines, as in Notion. Click the label to edit the language; the ``` marks show, dimmed, only while the cursor is on that line, and nothing moves when they appear.
- Markdown Preview Edit: clicking into a heading no longer pushes its text to the right. The `#` marks now appear in the margin to the left of the heading (except in toggle titles, where the arrow sits).
- Markdown Preview Edit: an image whose file is missing or not loaded yet shows only its placeholder, without the browser's broken-picture icon above it.
- Markdown Preview Edit: even spacing between blocks. Code blocks, callouts, tables, images and the YAML card no longer add extra empty space around themselves, so they sit as close to the text as paragraphs do; one-line callouts are about 20px shorter, and dividers sit exactly halfway between the lines around them.
- Markdown Preview Edit: lists and quotes now indent in the same 20px steps as toggles. Bullets and checkboxes line up with the edge of the text, nested items sit exactly under their parent's text, quote text lines up with list text, and numbered items keep their text in one column past item 9.
- Markdown Preview Edit: code blocks, callouts, tables, images, dividers and the YAML card now line up exactly with the left edge of the text (they used to sit a few pixels further left), and every line in a callout starts after its icon.
- Markdown Preview Edit: adding the first toggle to a file no longer shifts all its text to the right. Every file now keeps the same margins on both sides of the text, with room for the toggle handle.
- Markdown Preview Edit: the `/` menu lists commands in their intended order (Text, headings, lists, then blocks) instead of alphabetically, and Quote now shows its real shortcut, `"`.
- Markdown Preview Edit: scrolling past tables no longer makes the text jump a few pixels.
- Markdown Preview Edit: images no longer show a grey bar with their alt text underneath once they load.
- Markdown Preview Edit: selected text is readable again in dark themes. The selection now uses your VS Code theme's selection colour instead of a fixed light lavender.
- Markdown Preview Edit: the `/` menu no longer opens under the toolbar when the cursor is low in the window. It stays inside the editor and scrolls if there is not enough room.
- Markdown Preview Edit: `Cmd/Ctrl+F` now puts the cursor in the search box, so what you type searches the document. Before, the box opened but your typing went into the text.
- Markdown Preview Edit: in long files, headings further down now show at heading size as soon as the file opens. Before, they could look like plain text until you typed something.
- Markdown Preview Edit: Notion-style toggles. Type `> ` and a space at the start of a paragraph or heading to turn it into a collapsible toggle (a heading takes everything below it up to the next heading of the same or higher level); `Cmd/Ctrl+Z` right after undoes it. Click the arrow to open or close it (remembered per file), hover for a menu to turn it back into text or delete it, or pick **Toggle** in the `/` menu. The markup stays standard `<details>`/`<summary>` in the file but is never shown. The title can be any formatted text or a heading.
- Markdown Preview Edit: type `"` and a space at the start of a line to make a quote. Typing `> ` now makes a toggle instead; the toolbar and `/` menu Quote still insert a normal quote.
- Markdown and spreadsheets: when Sticky Toolbar is off and the toolbar has scrolled away, hover at the top edge to reveal it temporarily without moving the document.
- Markdown and spreadsheets: with autosave on, successful background saves no longer show an "Autosaved" toast; manual saves still show "Saved", and failed autosaves still warn.
- Markdown tables: editing a header cell no longer clips typed text at the right edge. Header cells now wrap like body cells while you edit, and the column-resize grip is omitted from the active header so it does not crowd the text.
- Markdown tables: drag-to-select and double-click word select work in header cells again. Column reorder drag only starts from the top grip strip, not from presses on header text while you edit.
- Markdown Preview Edit: double- or triple-clicking a list item now selects the item's text without its marker (`-`, `1.`, `[ ]`), and triple-clicking a heading selects its text without the `#`. Bold or italic applied to that selection no longer breaks the list or heading.
- Markdown tables: while editing one cell, clicking another cell in the same table moves the caret there instead of leaving focus on the first cell.
- YAML frontmatter: lists of objects (e.g. `{ name, role }` entries) now expand as indented rows instead of showing `[object Object]` pills; string-only lists still render as chips.
- Security: opening an untrusted spreadsheet or Markdown file can no longer run script inside the editor. Cell text and Markdown table cells keep their formatting (bold, italic, colors, line breaks) but anything executable is stripped, and links from file content only open if they are `http`, `https` or `mailto` (others show a warning instead).
- Spreadsheets: fast consecutive edits no longer lose changes. Autosaves now run one after another, so a second save can't overwrite the first one's edits.
- Spreadsheets: copying cells that contain line breaks (Shift+Enter) and pasting them back, or into Excel or Google Sheets, keeps each multi-line cell as one cell instead of splitting it into extra rows. Copied rich-text cells paste as plain text, without HTML tags.
- CSV/TSV: "Convert to XLSX" from the Command Palette now keeps font size and text wrap, matching the toolbar's Convert button.
- CSV/TSV: every save is now kept in version history, so you can roll back edits; before, history only held the file as it was when opened.
- Renaming or moving a file in VS Code now keeps its Markdown column widths and YAML card state, CSV/TSV styling and view mode, and version history. Before, the editor VS Code reopens at the new path loaded too early and showed the defaults.
- Requires VS Code 1.67 or newer (the previous "1.60" minimum was never accurate).

## v1.5.0 — 2026-09-05

### Improvements

- Markdown: copy button on fenced code blocks. In Preview Edit, hover any fenced code block and a copy icon appears in the top-right corner inside the block border. Click it to copy just the code (no ` ``` ` fences). A brief “Copied” toast confirms success. Cmd/Ctrl+Click still works as a shortcut. Mermaid blocks use the same in-block chrome — language label top-left, actions top-right — instead of a separate toolbar sitting above the fence.
- Markdown: click links to navigate. When a link is collapsed (you see only the styled label, not `[text](url)`), a plain click opens it: relative paths open the file in VS Code, `#heading` anchors scroll within the document, and `http://`, `https://`, and `mailto:` links open externally. Click when the caret is inside the link (expanded for editing) still places the caret as before. Collapsed labels show a pointer cursor on hover. Missing files and unknown section anchors now show a clear warning toast instead of failing silently or opening a blank tab.

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
