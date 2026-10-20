# Navigation map: Markdown webview

Everything here runs in the **webview (browser)** runtime and is bundled into `dist/md/mdWebview.js`.
Runtime context, hard rules, and the message protocol are in [AGENTS.md](../../AGENTS.md) and
[MESSAGE-PROTOCOL.md](MESSAGE-PROTOCOL.md).

**How to use this map:** `mdWebview.ts` and several `livePreview/` files are large; do not read them
end-to-end. Find the cluster below, then grep for the listed symbol or section header and read only
around it. This map anchors on names, not line numbers, because names don't drift.

| Area | What lives there |
|---|---|
| [mdWebview.ts](../../src/webviews/md/mdWebview.ts) | Shell: toolbar, TOC, settings, disk diff, search overlay, message handler (routes save/sync messages to `saveSync.ts`), bootstrap |
| [state.ts](../../src/webviews/md/state.ts) | The shared mutable state (`state.currentContent`, `state.isSaving`, `state.currentSettings`, ...). Every module reads and writes it here |
| [saveSync.ts](../../src/webviews/md/saveSync.ts) | Save, autosave, reload from disk, external-change decisions (`onDiskChangedExternally`), save/restore conflicts, version preview. Gets UI callbacks via `initSaveSync(hooks)`. Pinned by `src/test/webview/markdownSaveSync.spec.mts` |
| [toast.ts](../../src/webviews/md/toast.ts), [dialogs.ts](../../src/webviews/md/dialogs.ts), [messaging.ts](../../src/webviews/md/messaging.ts), [copyLinkArtifacts.ts](../../src/webviews/md/copyLinkArtifacts.ts) | `showToast` / `hideToast`; confirm dialogs (`confirmModal`, `confirmDiscardAndReload`, ...); the typed `post` to the host; heading copy-link cleanup |
| [livePreview/](../../src/webviews/md/livePreview/) | CodeMirror 6 (CM6) editor plus widgets and keymaps: the only document surface |
| `frontmatter.ts`, `frontmatterCardUi.ts`, `diffStats.ts`, `markdownStats.ts` | Small pure helpers next to `mdWebview.ts` (see table at the end) |

**Content contract:** `state.currentContent` (in `state.ts`) is the single source of truth. The CM6
editor writes into it from its `updateListener` (the `onDocChanged` callback passed to
`mountLivePreview`); `getActiveEditorContent()` is the only reader. Dirty tracking compares
`currentContent` to `originalContent`. There is no split, raw-textarea, or reading view any more:
CM6 live preview is the single surface (normal edit, plus read-only during version preview).

> The header comment in `livePreviewEditor.ts` still describes a "Split mode `<textarea>`" second
> surface. That is stale; the rules about `currentContent` still hold.

---

## mdWebview.ts: responsibility clusters

Section headers in the file look like `// ===== Name =====`. Grep for the header or the symbols.

| Cluster | Section header | Grep for |
|---|---|---|
| Imports | (top of file) | the `livePreviewEditor` import list is the full public CM6 API used by the shell |
| rAF throttle | `Throttle Utility` | `throttleRAF`, `throttleRAFEvent` |
| Small utilities | `Utilities` | `livePreviewGutterLineNumbersEnabled`, `slugify`, `escapeHtmlAttr`, `isRemoteOrInlineUri`, `shouldResolveLocalImage` |
| markdown-it (TOC only) | `Markdown-it (TOC parse only` | `md`, `addHeadingIds`, `buildToc`, `updateToc`, `refreshCm6Toc`, `tocIdToLine`, `tocLineToId`, `resolveTocLineForAnchor`, `scrollToAnchor`. CM6 renders the document; markdown-it only builds the outline |
| Image URI resolution | (same section) | `wireImageUriResolver`, `applyResolvedImageUris`, `resolvedImageUriCache` (sends `resolveImageUris`) |
| Per-file / global prefs | (same section) | `persistFrontmatterPanelCollapsed`, `persistMermaidPreviewMode`, `persistCalloutDefaultType`, `applyFrontmatterBlockToDocument` |
| Edit toolbar state | (same section) | `updateEditToolbarButtons` (uses `isEditorDirty` / `canReloadFromDisk` from `saveSync.ts`) |
| CM6 mount and link clicks | `Preview Edit Mode (CM6 live preview)` | `enterPreviewEditMode` (calls `mountLivePreview` with all callbacks), `updateVersionPreviewChrome`, `executeLivePreviewLinkAction` (sends `openExternal` / `openRelativeFile`), `handleLivePreviewLinkClick`, `handleLivePreviewModifierClick` |
| Formatting | (before `Disk-vs-editor diff`) | `applyFormat` |
| Disk-vs-editor diff | `Disk-vs-editor diff` | `hasDiskDiffBaseline`, `showDiskDiff`, `hideDiskDiff`, `toggleDiskDiff`, `revealDiskChanges`, `acceptAllDiskChanges`, `rejectAllDiskChanges`, `handleDiffChunkResolved`, `diffResolutionSummary`, `syncDiskDiffAfterDocChange`, `updateDiffChrome`, `updateDiffChunkRuler`, `wireDiskDiffBulkActions`. UX flow: [flow.md](../flow.md) |
| Status bar and stats | (same section) | `getCurrentCursorPosition`, `getCurrentSelectionStats`, `getWholeDocumentStats`, `updateStatusInfo` |
| Progress bar | `Reading Progress Bar` | `updateProgressBar` (the bar is a scroll indicator, not a reading mode) |
| Scroll spy | `Scroll Spy (Active TOC Tracking)` | `updateScrollSpy`, `throttledScrollSpy`, `nearestTocIdForLine`, `initScrollSpy` |
| Lightbox | `Lightbox` | `initLightbox`, `showLightbox`, `closeLightbox` |
| Search overlay | `Search in Preview` | `openSearch`, `closeSearch`, `toggleSearchOverlay`, `doSearch`, `navigateSearch`, `reapplySearch`, `initSearchOverlay` (match finding is delegated to `findLivePreviewMatches`) |
| Settings panel | `Settings` | `applySettings` (sends `updateSettings`), `initializeSettings` (settings definitions, `enableAsDefault` / `disableDefaultEditor`, `showVersionHistory`), `renderVersionHistorySettingItem`, `applyFormattingToolbarLayout` |
| Header height | `Header Height` | `syncMdHeaderHeight`, `updateHeaderHeight` |
| **Message handler (host to webview)** | `Message Handler` | `window.addEventListener('message'` then one `case '<command>'` per message, for example `case 'initMarkdown'`, `case 'diskChangedExternally'` |
| Toolbar buttons | `Button Handlers` | `wireButtons`, `buildToolbarButtons`, `copyMarkdownToClipboard` |
| Keyboard shortcuts | `Keyboard Shortcuts` | the `keydown` listener under that header |
| Resizable panels and TOC | `Resizable Panels` | `initResizeHandles`, `wireResizeHandle`, `wireTocPanel` |
| Toolbar tooltips | `Hover Tooltip` | `wireHoverTooltip` |
| Formatting toolbar | `Formatting Toolbar` | `wireFormattingToolbar` (calls `applyLivePreviewFormat`) |
| Bootstrap | `Initialize` | the init call list, ending with the final `webviewReady` post |

---

## livePreview/: CM6 engine and widgets

Entry point: [livePreviewEditor.ts](../../src/webviews/md/livePreview/livePreviewEditor.ts). It owns
the `EditorView`, the compartments, and every `export function` that `mdWebview.ts` calls
(`mountLivePreview`, `getLivePreviewContent`, `setLivePreviewContent`, `setLivePreviewDiff`,
`applyLivePreviewFormat`, `findLivePreviewMatches`, `scrollLivePreviewToLine`, and so on). Start
here to see how a module is wired in.

Unit tests live beside sources as `*.test.mts` (run with `npm run test:unit`, or one file with
`node --import tsx --test <file>`). `package.json` in this folder only sets `"type": "module"` for those tests.
`typo-js.d.ts` is a type stub for the Typo.js spellcheck library.

### Core

| File | Responsibility | Grep for |
|---|---|---|
| livePreviewEditor.ts | EditorView mount, compartments, public API for the shell | `mountLivePreview`, `LivePreviewMountOptions`, `unmountLivePreview`, `setLivePreviewReadOnly` |
| cm6Theme.ts | CM6 theme mapped onto VS Code theme CSS variables | `cm6Theme` |
| revealDecorations.ts | "Reveal on cursor" syntax decorations; list marker, task checkbox, and HR widgets | `computeRevealDecorations`, `livePreviewRevealPlugin`, `TaskCheckboxWidget`, `OrderedMarkerWidget`, `BulletMarkerWidget`, `HorizontalRuleWidget` |
| formatCommands.ts | Source-level format commands (wrap, lists, indent, line ops, case, sort, paste-linkify) | `runFormatCommand`, `computeWrapSelection`, `computeToggleLinePrefix`, `computePasteLink`, `livePreviewFormatKeymap`, `livePreviewTabKeymap` |
| slashMenu.ts | Slash-command autocompletion | `SLASH_OPTIONS`, `slashMenuAutocompletion`, `computeSlashApply` |
| livePreviewSearch.ts | In-document search matches and highlight decorations | `livePreviewSearchField`, `findCm6Matches`, `setCm6SearchHighlights`, `scrollCm6ToMatch` |
| livePreviewInteractions.ts | Ctrl/Cmd-click target detection (links, images, anchors) | `detectInteractionAtPos`, `detectCollapsedLinkAtPos`, `Cm6Interaction` |
| diffView.ts | `@codemirror/merge` unified diff overlay (disk vs editor) and chunk accept/reject/navigate | `buildDiffExtension`, `nextDiffChunk`, `acceptDiffChunkAtCursor`, `acceptAllDiffChunks`, `diffChunkResolutionKind` |

### Pointer, click, and gutter geometry

CM6's height map ignores CSS margins on decorated lines, so these modules map pointer coordinates
from the real DOM.

| File | Responsibility | Grep for |
|---|---|---|
| contentClickPositioning.ts | DOM-accurate click and drag positioning in the content area | `contentClickHandlers`, `resolveContentClickPos`, `computeContentClickCorrection`, `selectionRangeForListLineClick` |
| pointerLineResolution.ts | Screen Y to document line; triple-click line selection | `resolveLinePosAtPointer`, `closestCmLineElement`, `computeTripleClickLineSelection` |
| hoverLineGutter.ts | Hover highlight on the line-number gutter | `hoverLineGutter`, `hoverGutterDomEventHandlers`, `setHoveredLine` |
| headingGutterSync.ts | Heading line decorations so gutter rows align with heading sizes | `headingLineDecorationField` |
| paragraphNavigation.ts | Shift+Option+Arrow paragraph selection | `paragraphSelectionKeymap`, `computeParagraphBounds` |

### Lists and paste

| File | Responsibility | Grep for |
|---|---|---|
| listMarkerEditing.ts | List marker as one atomic unit (arrows, Backspace, Delete); Enter continuation | `listMarkerBoundaryExtensions`, `listMarkerAtomicRanges`, `listMarkerKeymap`, `runLivePreviewEnter`, `livePreviewMarkdownKeymap`, `computeManualListContinuation` |
| listSetextAmbiguity.ts | Detect "paragraph + `- `" being parsed as a Setext heading instead of a list | `isSetextUnderlineListMarker`, `setextListMarkerLineAt` |
| listPaste.ts | Merge pasted lists into empty list items (avoids `- - item`) | `computePasteList`, `clipboardLooksLikeList`, `mergeListPasteIntoEmptyItem` |
| pasteNormalization.ts | Clipboard text normalization for paste | `normalizeClipboardPasteText`, `selectionIncludesTrailingLineBreak` |

### Tables

Product rules: [MARKDOWN-TABLES.md](../product/MARKDOWN-TABLES.md). Any table behavior change must
update that file.

| File | Responsibility | Grep for |
|---|---|---|
| tableWidget.ts | Table widget DOM, column resize, row/column drag, context menu, inline cell editing (large) | `TableWidget`, `tableWidgetField`, `computeTableDecorations`, `computeTableContextMenu`, `computeTableMenuTransaction`, `columnWidthsField`, `setColumnWidthsEffect`, `sanitizeTableCellInput`, `blurActiveTableEditingCell` |
| tableBoundaryEditing.ts | Arrow/Backspace behavior at table edges; cell grid math | `tableBoundaryExtensions`, `tableNavigationKeymap`, `buildCellGrid`, `findActiveCell`, `computeTableBoundaryBackspace`, `tableDeleteArmedField` |

### Code fences and mermaid

| File | Responsibility | Grep for |
|---|---|---|
| fenceExtraction.ts | Read fence language and body from the syntax tree | `extractFenceLangName`, `extractFenceBody`, `fenceDisplayLang` |
| fenceChromeWidget.ts | Fence card chrome: language label, copy button, extra controls slot | `fenceChromeWidgetField`, `createFenceChrome`, `setFenceCopyCallback` |
| codeStyling.ts | Always-on inline code and fenced code styling (not part of reveal) | `computeCodeDecorations`, `fenceExternalGapFlags` |
| codeStylingPlugin.ts | ViewPlugin wrapper for `codeStyling.ts` | `codeStylingPlugin` |
| codeBlockBoundaryEditing.ts | Logical up/down arrows inside fenced code | `codeBlockNavigationKeymap`, `computeFencedCodeArrow`, `isPosInsideFencedCode` |
| mermaidDetection.ts | Is this fence mermaid? Find mermaid fence ranges | `isMermaidFence`, `findMermaidFenceRanges`, `extractMermaidSource` |
| mermaidPreviewMode.ts | Diagram vs code mode state field | `mermaidPreviewModeField`, `setMermaidPreviewModeEffect`, `seedMermaidPreviewMode` |
| mermaidPreviewActions.ts | Diagram/code mode select control and its dispatch | `createMermaidModeSelect`, `dispatchMermaidPreviewMode`, `setMermaidPreviewModeCallback` |
| mermaidWidget.ts | Rendered mermaid diagram widget with zoom and pan | `mermaidWidgetField`, `mermaidAtomicRanges`, `attachZoomPan` |

### Callouts, images, frontmatter, spellcheck

| File | Responsibility | Grep for |
|---|---|---|
| calloutTypes.ts | Callout type registry and opener-line parsing | `BUILTIN_CALLOUT_TYPES`, `parseCalloutOpener`, `findCalloutBlocks`, `buildCalloutSnippet` |
| calloutDecorations.ts | Callout line decorations (wired into `revealDecorations.ts`) | `appendCalloutDecorationSpecs` |
| calloutWidget.ts | Callout type picker widget | `calloutWidgetField`, `CalloutTypeWidget`, `setCalloutDefaultTypeCallback` |
| calloutEditing.ts | Change a callout's type | `computeSetCalloutType` |
| calloutDefaultType.ts | Default callout type state | `calloutDefaultTypeField`, `setCalloutDefaultTypeEffect`, `seedCalloutDefaultType` |
| imageWidget.ts | Local image previews; URI resolution delegated to the shell | `imageWidgetField`, `setImageUriResolver`, `refreshImageWidgetsEffect`, `computeImageDecorations` |
| frontmatterWidget.ts | Collapsible, editable YAML frontmatter card | `frontmatterWidgetField`, `frontmatterCollapsedField`, `frontmatterEditingField`, `blurActiveFrontmatterEditing` |
| spellcheck.ts | Typo.js spellcheck via `@codemirror/lint` | `spellcheckExtensions`, `spellcheckLint`, `loadSpellDictionary`, `spellcheckSuggestionMenu` |
| spellcheckExclusions.ts | Ranges to skip (code and frontmatter); pure | `computeSpellcheckExclusions`, `isSpellcheckExcluded` |

---

## Helpers next to mdWebview.ts

| File | Responsibility | Grep for |
|---|---|---|
| [frontmatter.ts](../../src/webviews/md/frontmatter.ts) | YAML frontmatter parse/extract for the TOC, the CM6 card, and spellcheck | `extractFrontmatter`, `parseFrontmatter`, `resolveFrontmatterWidgetData`, `frontmatterBodyStartLine`, `markdownBodyWithoutFrontmatter` |
| [frontmatterCardUi.ts](../../src/webviews/md/frontmatterCardUi.ts) | Frontmatter card DOM (used by `frontmatterWidget.ts`) | `createFrontmatterCardElement` |
| [diffStats.ts](../../src/webviews/md/diffStats.ts) | Pure line-diff counts for the diff badge and toast (no CM imports) | `diffLineStats`, `formatDiffLineStats` |
| [markdownStats.ts](../../src/webviews/md/markdownStats.ts) | Strip Markdown to plain text; word/char/line counts for the status bar | `stripMarkdownToPlainText`, `computeTextStats`, `TextStats` |
