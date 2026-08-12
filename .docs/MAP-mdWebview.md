# Navigation map — mdWebview.ts (~3,661 lines)

[src/webviews/md/mdWebview.ts](../src/webviews/md/mdWebview.ts) runs in the **webview (browser)**.
Too large to read whole — jump with `Read(offset, limit)` using this index.

Runtime context, hard rules, and the message protocol are in [CLAUDE.md](../CLAUDE.md) and
[MESSAGE-PROTOCOL.md](MESSAGE-PROTOCOL.md). Line ranges are approximate.

| Lines | Section | Responsibility |
|---|---|---|
| 1–43 | Imports & dependencies | markdown-it + plugins, hljs, turndown, mermaid, shared managers, `vscode` bridge |
| 44–76 | Inline markdown-it Mermaid plugin | Custom `markdownItMermaid(md)` fence renderer (bundled for esbuild) |
| 77–90 | Throttle utility | `throttleRAF` rAF throttle |
| 91–141 | Module state / globals | currentContent, originalContent, edit-mode flags, URIs, caches, undo/redo stacks |
| 142–336 | Utilities | slugify, HTML escape, image-URI predicates, `wrapCodeLines`, button enable, undo/redo snapshots |
| 337–602 | markdown-it setup & plugins | `md` config, plugin registration, `injectLineNumbers`, local-image resolution, heading IDs, `buildToc` |
| 603–659 | Rendering | `renderMermaidFlowcharts`, `renderMarkdown`, `updateToc` |
| 660–739 | Edit mode (split view) | `setEditMode` raw-textarea split editor |
| 740–834 | Preview edit mode (WYSIWYG) | `setPreviewEditMode`, `ensureVersionPreviewBanner` |
| 835–908 | Version preview & save/cancel | `setVersionPreviewMode`, `performSave` (**sends `saveMarkdown`**), `cancelEdit` |
| 909–925 | Live preview | `onEditorInput` debounced re-render |
| 926–1167 | Sync scroll | Line-based proportional scroll sync; anchor/interpolation, line-measure cache |
| 1168–1215 | UI helpers & progress bar | `showToast`, `updateStatusInfo`, `updateProgressBar` |
| 1216–1268 | Scroll spy (outline tracking) | `updateScrollSpy` active-TOC highlight, `initScrollSpy` |
| 1269–1299 | Lightbox | Image lightbox open/show/close |
| 1300–1464 | Search in preview | Search overlay, `doSearch`, highlight/navigate/count |
| 1465–1679 | Settings | `applySettings`, `initializeSettings`, `reorderMdToolbarButtons` |
| 1680–1686 | Header height | `updateHeaderHeight` layout offset |
| 1687–1755 | **Message handler (host→webview)** | `window.addEventListener('message')` `switch (m.command)` — see [MESSAGE-PROTOCOL.md](MESSAGE-PROTOCOL.md) |
| 1756–1940 | Button handlers & toolbar build | `wireButtons`, `buildToolbarButtons` (edit/preview/save/version/view-toggle) |
| 1941–1992 | Keyboard shortcuts | Global keydown bindings |
| 1993–2208 | Formatting utilities (source) | Raw-markdown edits: wrap/prefix/link/image/table/code, indent, undo/redo |
| 2209–2414 | Line operations & format dispatch | Duplicate/delete/move/sort/case line ops, `jumpToLine`, `applyFormat` |
| 2415–3037 | WYSIWYG formatting (preview edit) | Sequence inference, table hover controls & editing, caret/cell helpers, `applyWysiwygFormat` |
| 3038–3133 | Resizable panels | `initResizeHandles`, `wireResizeHandle` (TOC/split drag) |
| 3134–3327 | Editor events | `wireEditor` textarea input/scroll/key wiring |
| 3328–3498 | Preview interactions | `wirePreviewInteractions`: link clicks (**`openExternal`/`openRelativeFile`**), lightbox, code copy |
| 3499–3579 | TOC panel & hover tooltip | `wireTocPanel`, `wireHoverTooltip` |
| 3580–3635 | Formatting toolbar wiring | `wireFormattingToolbar` |
| 3636–3661 | Initialize | Bootstrap init calls; final `webviewReady` post |
