# Navigation map — Markdown webview

Markdown UI spans two layers in the **webview (browser)** runtime:

| File | Lines (approx.) | Role |
|---|---|---|
| [mdWebview.ts](../../src/webviews/md/mdWebview.ts) | ~1,805 | Shell: toolbar, TOC, settings, disk-sync toasts, message handler, bootstrap |
| [livePreview/](../../src/webviews/md/livePreview/) | ~6,900 | CodeMirror 6 live-preview engine + widgets (tables, callouts, mermaid, …) |
| [frontmatter.ts](../../src/webviews/md/frontmatter.ts) | ~289 | YAML frontmatter parse/extract (TOC + CM6 widget seed) |
| [diffStats.ts](../../src/webviews/md/diffStats.ts) | ~92 | Pure line-diff counts for the disk-vs-editor badge and toast (no CM imports, unit-tested) |
| [frontmatterCardUi.ts](../../src/webviews/md/frontmatterCardUi.ts) | ~178 | Frontmatter card DOM helpers |

Bundled together into `dist/md/mdWebview.js`. Too large to read whole — jump with `Read(offset, limit)` using the indexes below.

Runtime context, hard rules, and the message protocol are in [AGENTS.md](../../AGENTS.md) and
[MESSAGE-PROTOCOL.md](MESSAGE-PROTOCOL.md). Line ranges are approximate.

---

## mdWebview.ts

| Lines | Section | Responsibility |
|---|---|---|
| 1–41 | Imports | Shared managers, `livePreviewEditor` API, frontmatter helpers, `vscode` bridge |
| 42–54 | Throttle utility | `throttleRAF` rAF throttle |
| 56–99 | Module state | `currentContent` / `originalContent`, edit-mode flags, disk-sync state, URIs, TOC map, settings |
| 101–139 | Utilities | Line-number preference, slugify, HTML escape, image-URI predicates |
| 140–356 | markdown-it (TOC only) | `md` instance for outline parsing — **CM6 renders the document** |
| 357–519 | Preview edit mode (CM6) | `setPreviewEditMode`, version-preview chrome, modifier-click / lightbox |
| 520–731 | Content & save | `getActiveEditorContent`, version preview banner, `performSave` (**`saveMarkdown`**), disk reload |
| 732–849 | UI helpers | Confirm modals, toast, status bar, reading progress bar |
| 850–905 | Scroll spy | Active TOC highlight via CM6 top-line metrics |
| 906–935 | Lightbox | Image lightbox open/show/close |
| 936–1059 | Search in preview | Overlay UI; delegates match/highlight/scroll to CM6 search API |
| 1060–1277 | Settings & layout | `applySettings`, toolbar layout, header height sync |
| 1279–1451 | **Message handler (host→webview)** | `diskChangedExternally`, `diskMovedExternally`, `diskDeletedExternally`, init/save/version — see [MESSAGE-PROTOCOL.md](MESSAGE-PROTOCOL.md) |
| 1442–1591 | Toolbar & shortcuts | `wireButtons`, `buildToolbarButtons`, keyboard bindings |
| 1593–1666 | Resizable panels & TOC | TOC resize handle, TOC click → `scrollLivePreviewToLine` |
| 1668–1719 | Hover tooltip | Toolbar help tooltip wiring |
| 1721–1773 | Formatting toolbar | `wireFormattingToolbar` → `applyLivePreviewFormat` |
| 1775–1805 | Initialize | Bootstrap init calls; final **`webviewReady`** post |

**Content contract:** `currentContent` is the single source of truth. Split/raw textarea mode and CM6
live preview are views over it — see the state-sync contract in
[livePreviewEditor.ts](../../src/webviews/md/livePreview/livePreviewEditor.ts) header.

---

## livePreview/ — CM6 engine & widgets

Entry point: [livePreviewEditor.ts](../../src/webviews/md/livePreview/livePreviewEditor.ts) (~426 lines) —
mount/unmount, read/write doc, scroll metrics, search, format dispatch.

| File | Lines (approx.) | Responsibility |
|---|---|---|
| livePreviewEditor.ts | ~426 | EditorView mount, compartments, public API used by mdWebview |
| cm6Theme.ts | ~547 | VS Code–aware CM6 theme |
| formatCommands.ts | ~770 | Source-level format commands (wrap, lists, indent, line ops, paste-linkify) |
| tableWidget.ts | ~1,753 | Table widget DOM, resize/drag, context menu, inline cell editing — product rules in [MARKDOWN-TABLES.md](../../product/MARKDOWN-TABLES.md) |
| tableBoundaryEditing.ts | ~560 | Table arrow/backspace boundaries, cell grid math |
| revealDecorations.ts | ~674 | Live-preview “reveal” syntax decorations |
| diffView.ts | ~60 | `@codemirror/merge` unified diff overlay (disk vs editor) + chunk accept/reject/navigate |
| codeStyling.ts + codeStylingPlugin.ts | ~104 | Fenced-code presentation |
| mermaidWidget.ts | ~232 | Mermaid fence widget + diagram/code toggle |
| mermaidPreviewMode.ts | ~21 | Mermaid mode state field |
| mermaidDetection.ts | ~58 | Fence language detection |
| imageWidget.ts | ~280 | Local image widgets + URI resolver hook |
| frontmatterWidget.ts | ~128 | Collapsible YAML card widget |
| calloutWidget.ts | ~109 | Callout block widgets |
| calloutDecorations.ts | ~98 | Callout syntax highlighting |
| calloutEditing.ts | ~31 | Callout type editing |
| calloutTypes.ts | ~138 | Callout type registry |
| calloutDefaultType.ts | ~27 | Default callout type state |
| headingGutterSync.ts | ~48 | Heading gutter line decorations |
| livePreviewInteractions.ts | ~59 | Ctrl/Cmd-click target detection (links, images) |
| livePreviewSearch.ts | ~77 | In-document search matches + highlight decorations |
| slashMenu.ts | ~191 | Slash-command autocompletion |
| paragraphNavigation.ts | ~65 | Paragraph-level navigation keymap |
| spellcheck.ts + spellcheckExclusions.ts | ~300 | Typo.js spellcheck integration |

Unit tests for livePreview live beside sources as `*.test.mts`.
