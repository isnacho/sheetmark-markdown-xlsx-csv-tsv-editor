# Markdown Viewer — Technical Health Review (2026-08-15)

Scope: `src/mdEditorProvider.ts`, `src/webviews/md/mdWebview.ts`, `src/webviews/md/livePreview/**`,
`src/webviews/md/frontmatter.ts`, `src/webviews/md/frontmatterCardUi.ts`. Spreadsheet code excluded.
Review-only — no source files were modified. Findings below were produced by five focused passes
(host provider; webview shell; CM6 core engine; CM6 widgets; frontmatter + full protocol audit),
each reading its files in full and citing real line numbers.

## Summary

The markdown viewer is in reasonable shape overall: the host↔webview message protocol was
audited command-by-command across both directions and **no mismatches were found** — every sender
has a matching handler and payload field names line up everywhere. The legacy split/contentEditable
preview path is confirmed gone in substance (only harmless scaffolding remains). The real risk is
concentrated in three places: (1) a silent data-loss bug in the webview's dirty-tracking around
save completion, (2) an uncaught-exception path in frontmatter parsing that can crash the whole CM6
decoration pipeline on a specific (rare but legal) YAML construct, and (3) a family of "line-regex
treats fenced-code examples as real blocks" bugs shared by the table-boundary-editing keymap and the
callout-fence detector, which can misfire arrow/backspace navigation and, in the worst case, delete
code content. Beyond that, most findings are either performance (unthrottled mousemove handlers,
unscoped per-keystroke rebuilds in a couple of widget StateFields, two leaked observers in the table
widget) or straightforward dead-code cleanup. Nothing here requires renaming `xlsxViewer.*`/
`xlsx-viewer.*` IDs, touching esbuild paths, or CSP/localResourceRoots restructuring.

Several findings below are flagged as **needs manual F5 verification** — this repo has no
extension-host test suite, so timing-dependent races and drag/hover jank can't be confirmed
statically; treat those as hypotheses to smoke-test, not settled bugs.

---

## 1. Correctness / bug risk

### 1.1 `originalContent` is stamped from live `currentContent`, not from what was actually saved — silent data loss
**File:** [mdWebview.ts:612-618](../../src/webviews/md/mdWebview.ts#L612) (`doSave`), [mdWebview.ts:419-431](../../src/webviews/md/mdWebview.ts#L419) (`onDocChanged`, no `isSaving` guard), [mdWebview.ts:1405-1416](../../src/webviews/md/mdWebview.ts#L1405) (`saveResult` handler: `originalContent = currentContent`)

`doSave()` sends the current text as `saveMarkdown`, but CM6 keeps accepting edits while the
save is in flight (the host round-trip does an `await readFile` conflict-check then
`await writeFile` — [mdEditorProvider.ts:266-294](../../src/mdEditorProvider.ts#L266)). If the
user types more between the send and the `saveResult` reply, the handler sets
`originalContent = currentContent` — the *newer* value, not the text that was actually written to
disk. `isEditorDirty()` then reports clean and autosave's dirty check also short-circuits, so the
extra keystrokes are never persisted and no dirty indicator warns the user.

**Why it matters:** silent data loss on an everyday timing window (type while a save/autosave is
in flight), with no error surfaced. This directly violates the "currentContent is the single source
of truth" contract's intent.

**Suggested direction:** capture the exact text sent in `doSave` (e.g. `pendingSaveContent`) and on
successful `saveResult` set `originalContent` from that captured value, not from live `currentContent`.

**Severity/Effort:** L / S.

---

### 1.2 Frontmatter parsing crashes on self-referential YAML — uncaught throw inside a CM6 StateField
**File:** [frontmatter.ts:107-163](../../src/webviews/md/frontmatter.ts#L107) (`flattenFieldRows`/`buildFieldRows`), consumed unguarded by [frontmatterWidget.ts:99-101](../../src/webviews/md/livePreview/frontmatterWidget.ts#L99) inside `frontmatterWidgetField`'s `create`/`update`

A legal one-line YAML anchor/alias self-reference (`a: &x\n  b: *x`) makes `js-yaml`'s `load()`
return a circular object (verified — `js-yaml` doesn't reject this). `flattenFieldRows` recurses
into `Object.entries(value)` with no visited-set or depth cap, so it recurses forever and throws
`RangeError: Maximum call stack size exceeded`. This happens in `resolveFrontmatterWidgetData`
([frontmatter.ts:274-289](../../src/webviews/md/frontmatter.ts#L274)), called directly from the
`frontmatterWidgetField` StateField with no try/catch around it — the only try/catch in the file
wraps just the `loadYaml` call inside `parseFrontmatter`
([frontmatter.ts:60-71](../../src/webviews/md/frontmatter.ts#L60)), not the flatten step.

**Why it matters:** this is exactly the sharp edge called out in the review brief — a throw inside
a CM6 decoration/StateField builder silently drops decorations for the *entire* plugin, not just
this widget. Any file containing this frontmatter shape (accidental copy-paste of a YAML anchor
example, or intentionally crafted) breaks live preview rendering.

**Suggested direction:** add a `WeakSet`-based visited-guard or depth cap in `flattenFieldRows`,
and/or wrap the `buildFieldRows` call sites in try/catch with the same graceful "show as plain text"
fallback already used for parse failures.

**Severity/Effort:** H / S. **High-confidence — reproduced by the reviewing agent standalone.**

---

### 1.3 Table-boundary-editing keymap treats any pipe-shaped line as a real table, including inside fenced code
**File:** [tableBoundaryEditing.ts:198-217](../../src/webviews/md/livePreview/tableBoundaryEditing.ts#L198) (`isTableRowLine`/`tableBlockRangeForLine`), fallback at [tableBoundaryEditing.ts:345-357](../../src/webviews/md/livePreview/tableBoundaryEditing.ts#L345) (`resolveTableAtLine`), delete-arm path at [tableBoundaryEditing.ts:274-282](../../src/webviews/md/livePreview/tableBoundaryEditing.ts#L274)

`isTableRowLine`/`tableBlockRangeForLine` are pure text-regex heuristics. `resolveTableAtLine` tries
a syntax-tree `Table` ancestor first, but **falls back** to fabricating a table grid from raw text
when no `Table` node is found — e.g. when the pipe-shaped line is actually inside a fenced code
block showing example table syntax. This is inconsistent with `tableWidget.ts`'s own decoration
path, which only renders a widget for genuine syntax-tree `Table` nodes, and with
`codeStyling.ts`'s `shouldSkipFencedCode` guard, which this file doesn't reuse.

**Why it matters:** arrow-key navigation inside a fenced code example gets hijacked into cell-to-cell
table navigation, and worse — two backspaces at the boundary can trigger `deleteTableSpec`
([tableBoundaryEditing.ts:274](../../src/webviews/md/livePreview/tableBoundaryEditing.ts#L274)),
actually deleting the code lines. This is a real data-loss path, not just a UX glitch, and it's
plausible content (this repo's own docs contain pipe-table examples in fenced code).

**Suggested direction:** guard the fallback with a syntax-tree check — skip if the line's ancestor
node is `FencedCode`/`CodeText`, mirroring `codeStyling.ts`'s existing `shouldSkipFencedCode` pattern.

**Severity/Effort:** M / M. **Recommend manual F5 verification:** put a pipe-table example inside a
fenced code block, press Backspace/arrows at its edges.

---

### 1.4 Callout fence detection has the same fenced-code blind spot
**File:** [calloutTypes.ts:82-118](../../src/webviews/md/livePreview/calloutTypes.ts#L82) (`findCalloutBlocks`), consumed by [calloutDecorations.ts:59-97](../../src/webviews/md/livePreview/calloutDecorations.ts#L59) and [calloutWidget.ts:90-101](../../src/webviews/md/livePreview/calloutWidget.ts#L90)

Same bug class as 1.3: `findCalloutBlocks` scans raw lines for `:::` fences with regex only, no
syntax-tree check — unlike `mermaidDetection.ts`, which correctly requires a lezer `FencedCode`
node. A markdown doc showing example callout syntax inside a code fence gets its `:::` lines
dimmed/hidden and a live type-select widget injected into the code sample.

**Why it matters:** lower blast radius than 1.3 (no delete-arm path here), but it's rendering
corruption of legitimate content, and worth fixing together with 1.3 since the fix pattern is
identical (reuse `shouldSkipFencedCode`-style guard).

**Suggested direction:** same as 1.3, applied per-line before treating a line as an open/close fence.

**Severity/Effort:** M / M.

---

### 1.5 Stale absolute cell positions survive across `eq()`-preserved table widget instances
**File:** [tableWidget.ts:1551-1557](../../src/webviews/md/livePreview/tableWidget.ts#L1551) (`TableWidget.eq()`), click handling at [tableWidget.ts:1571-1588](../../src/webviews/md/livePreview/tableWidget.ts#L1571)

`eq()` compares `source`/`activeCell`/`widths`/`deleteArmed`, not absolute document positions. When
it returns `true`, CM6 keeps the old JS `TableWidget` instance — including `this.grid` and cached
cell ranges whose offsets were captured at the last `toDOM()`. With two tables in one document,
editing table 1 shifts table 2's real document offsets, but table 2's widget/grid is never rebuilt
(its own inputs didn't change), so the plain-click handler on an inactive cell in table 2 dispatches
a selection at a now-stale offset. Note: the context-menu path already re-resolves `tableNode`/`grid`
fresh from `view.state` at click time — the plain-click/drag-close paths don't follow that pattern.

**Why it matters:** multi-table documents are an everyday case, not exotic; the failure is either a
silently misplaced cursor or (if the doc shrank enough) a CM6 `RangeError`. No test exists for this
(`tableWidget.test.mts` has no multi-table positional-drift case).

**Suggested direction:** re-derive the clicked cell's position from current `view.state` at click
time, same as the context-menu handler already does, instead of trusting the widget-captured grid.

**Severity/Effort:** M / S-M. **Recommend manual F5 verification:** two tables in one doc, edit
table 1, click an untouched cell in table 2.

---

### 1.6 `ResizeObserver`/`MutationObserver` leak on every table widget rebuild
**File:** [tableWidget.ts:1006-1030](../../src/webviews/md/livePreview/tableWidget.ts#L1006) (`wireTableScrollUI`), called from [tableWidget.ts:1611](../../src/webviews/md/livePreview/tableWidget.ts#L1611)

Each call creates a `new ResizeObserver(update)` and `new MutationObserver(update)` with no
`.disconnect()` and no `TableWidget.destroy()` override to clean them up. `toDOM()` reruns on every
cell-to-cell navigation (any `activeCell` change fails `eq()`) and every structural row/column edit
— each rebuild leaks a fresh observer pair watching now-detached DOM.

**Why it matters:** given `retainContextWhenHidden: true`, this accumulates over a long single-tab
editing session — exactly the "growing caches/observers never pruned" risk called out in the brief.

**Suggested direction:** add a `destroy(dom)` override on `TableWidget` that disconnects both
observers (track them via a `WeakMap` keyed on the wrapper element, or attach handles on the DOM
node for `destroy` to read).

**Severity/Effort:** M-L / S.

---

### 1.7 `restoreVersion` writes to disk with no conflict check, unlike `saveMarkdown`
**File:** [mdEditorProvider.ts:410-451](../../src/mdEditorProvider.ts#L410) (write at :428), contrast [mdEditorProvider.ts:266-294](../../src/mdEditorProvider.ts#L266) (`saveMarkdown`'s fresh-read comparison at :274-281)

`saveMarkdown` re-reads disk and bails with `saveConflict` if it changed since the in-memory
snapshot. `restoreVersion` performs the same kind of write but has no equivalent check — it blindly
overwrites current disk content with a historical snapshot.

**Why it matters:** an external change landing between opening the version picker and clicking
Restore is silently clobbered with no warning — the exact race `saveMarkdown`'s guard exists to
prevent, just not applied to its sibling write path.

**Suggested direction:** apply the same fresh-disk-read comparison (or at minimum a confirmation)
before the `writeFile` in `restoreVersion`.

**Severity/Effort:** M / S.

---

### 1.8 `webviewReady` read failure leaves the webview stuck on the loading screen forever
**File:** [mdEditorProvider.ts:172-194](../../src/mdEditorProvider.ts#L172), catch at :191-193

If the initial `fs.promises.readFile` throws (file deleted before boot, permission error), the
catch only shows a native VS Code toast — it never posts anything to the webview, and only
`initMarkdown` hides the loading overlay. Contrast `requestFreshData`'s catch
([mdEditorProvider.ts:257-262](../../src/mdEditorProvider.ts#L257)), which correctly posts
`reloadFromDiskError` for the identical failure mode.

**Why it matters:** user sees a permanently frozen tab with no in-webview error or retry affordance.

**Suggested direction:** reuse `reloadFromDiskError` (or a dedicated init-failed message) on this
catch path too.

**Severity/Effort:** M / S.

---

### 1.9 `formatCommands.ts` "Go to Line" is a dead feature — `window.prompt()` is sandbox-blocked
**File:** [formatCommands.ts:694](../../src/webviews/md/livePreview/formatCommands.ts#L694)

Uses `window.prompt()`, which `mdWebview.ts:662` already documents as silently blocked by the
webview sandbox (no `allow-modals`). Reachable via `Mod-g` and a toolbar button — both are dead
clicks today.

**Why it matters:** shipped, discoverable, non-functional feature; low risk but confusing to users
who try it.

**Suggested direction:** replace with an in-webview modal/input (matching the pattern used
elsewhere for confirms), or remove the binding/button until one exists.

**Severity/Effort:** L (UX) / S. **Confirmed**, not speculative — the blocking behavior is
self-documented in this codebase.

---

### 1.10 `spellcheck.ts` context menu and module-level `activeView` aren't torn down
**File:** [spellcheck.ts:128](../../src/webviews/md/livePreview/spellcheck.ts#L128) (menu attached to `document.body`, global listeners; module-level `activeView`)

Not cleaned up by `unmountLivePreview()`. Under `retainContextWhenHidden: true`, this risks stale
`activeView` references and leaked global listeners across tab switches.

**Suggested direction:** tear down the menu/listeners and clear `activeView` from the same unmount
path other CM6 subsystems use.

**Severity/Effort:** M / S.

---

### 1.11 `formatCommands.ts` line-prefix toggle only touches the first line of a multi-line selection
**File:** [formatCommands.ts:62](../../src/webviews/md/livePreview/formatCommands.ts#L62) (`computeToggleLinePrefix`)

Backs list/heading/blockquote/checkbox toolbar actions. On a multi-line selection it appears to
prefix only the first line, not each line — needs manual confirmation (reviewer flagged
medium-confidence, not reproduced end-to-end).

**Severity/Effort:** M / M. **Needs manual F5 verification:** select 3+ lines, toggle a list/quote
format, confirm all lines get the prefix.

---

### 1.12 Minor / low-confidence items worth a look but not urgent
- **[mdWebview.ts:1310-1364](../../src/webviews/md/mdWebview.ts#L1310) / [mdEditorProvider.ts:252-263](../../src/mdEditorProvider.ts#L252)** — possible duplicate "file changed on disk" toast after a manual reload, since `requestFreshData` doesn't set `isSaving`/`lastSaveTime` to suppress the independent file watcher. UX-only, unconfirmed. S-M / M. **Needs F5 verification.**
- **[mdEditorProvider.ts:266-294](../../src/mdEditorProvider.ts#L266) & [mdEditorProvider.ts:371](../../src/mdEditorProvider.ts#L371)** — narrow race window between the fresh-disk read and `isSaving = true`; `showVersionHistory` swaps `currentContent` without any `isSaving` check at all. Code already shows awareness of this class of race elsewhere; real-world reachability unconfirmed. S-M / M-L. **Needs F5 timing test.**
- **[mdEditorProvider.ts:58](../../src/mdEditorProvider.ts#L58)** — `workspaceFolders` snapshotted once; if folders change mid-session, local image `localResourceRoots` go stale until the tab is reopened. S / S-M.
- **[tableBoundaryEditing.ts:392](../../src/webviews/md/livePreview/tableBoundaryEditing.ts#L392)** — `pickCellInRow` throws on an empty grid row; looks unreachable today given how grids are built, but it's inside a `Prec.highest` keymap handler, not a decoration builder, so if ever reachable it would swallow one arrow-keypress rather than break the whole plugin. S / S.

---

## 2. Simplification

### 2.1 Dead scaffolding from the removed split/preview-toggle mode
**File:** [mdWebview.ts:380-471](../../src/webviews/md/mdWebview.ts#L380) (`setPreviewEditMode`) — only ever called with `true` (call sites at :536, :1397); the `!enabled` branches throughout are unreachable. `isEditMode`/`isPreviewEditMode` ([mdWebview.ts:57-58](../../src/webviews/md/mdWebview.ts#L57)) are always set identically together — fully redundant. Stale comment at :645-646 references a "split-textarea branch" that no longer exists in `applyReloadedContent`. Dead `preview-left` class toggle at :414 has no matching CSS anywhere.

**Suggested direction:** collapse to a parameterless `enterPreviewEditMode()`, merge the two flags, delete the stale comment and `preview-left` remnant.

**Severity/Effort:** S / S.

### 2.2 Dead state: `previewVersionTimestamp`/`previewVersionContent` written but never read
**File:** [mdEditorProvider.ts:76-77](../../src/mdEditorProvider.ts#L76), assigned at :368-370, :395-397, :431-433. `restoreVersion` re-fetches from the history file by id instead of using the cached content — the cache is inert. **Severity/Effort:** S / S.

### 2.3 Vestigial, version-mismatched external KaTeX stylesheet
**File:** [mdEditorProvider.ts:679](../../src/mdEditorProvider.ts#L679) — links `katex@0.6.0` from a CDN. `package.json` pins `katex ^0.16.45`/`markdown-it-katex ^2.0.3`, but no import of either exists anywhere under `src/webviews/**` — no math pipeline is wired up. This is also the one crack in an otherwise fully-local CSP model in this file (required opening `style-src` to `https:` broadly). **Suggested direction:** remove the link, or if math rendering is planned, serve the bundled local `katex.min.css` instead. **Severity/Effort:** S-M / S.

### 2.4 Dead `'enableDefaultEditor'` case never sent for markdown
**File:** [mdEditorProvider.ts:491-499](../../src/mdEditorProvider.ts#L491) — `mdWebview.ts` only ever sends `enableAsDefault`. Harmless but copy-pasted dead symmetry with the spreadsheet provider. **Severity/Effort:** S / S.

### 2.5 Frontmatter dead code and a latent bug in unused click-to-jump plumbing
**File:** [frontmatter.ts:12-20,74-89](../../src/webviews/md/frontmatter.ts#L12) — `sourceLine`/`yamlLineIndexForKey` are computed for every field row but nothing reads `row.sourceLine` (grepped `frontmatterCardUi.ts`/`frontmatterWidget.ts` — no click handler exists). If ever wired up, the indent-depth assumption is already wrong (hardcodes 2-space indentation; 4-space or tab-indented frontmatter falls back to line 0 for every nested field). **Suggested direction:** delete until actually used, or fix the indent assumption first. **Severity/Effort:** L-M / L.

### 2.6 Frontmatter per-field-edit code path is dead (superseded by whole-block raw-text editing)
**File:** [frontmatter.ts:190-223](../../src/webviews/md/frontmatter.ts#L190) (`applyRowEditsToParsed`, `setNestedValue`, `parseEditableScalar`, `formatFrontmatterBlock`) — zero production callers; only referenced from `frontmatter.test.mts`. The shipped "Edit" UI ([frontmatterCardUi.ts:100-112](../../src/webviews/md/frontmatterCardUi.ts#L100)) only edits the whole block as raw text via a different, simpler function. **Severity/Effort:** L / L.

### 2.7 Duplicate near-identical frontmatter render-resolution function
**File:** [frontmatter.ts:225-250](../../src/webviews/md/frontmatter.ts#L225) (`resolveFrontmatterForRender`) — zero production callers (test-only), near-duplicate of the actually-used `resolveFrontmatterWidgetData` ([frontmatter.ts:274-289](../../src/webviews/md/frontmatter.ts#L274)); looks like a leftover from the removed static-preview render path. **Suggested direction:** delete, fold any useful test coverage into the widget-data tests. **Severity/Effort:** L / L.

### 2.8 `overlaps()` duplicated verbatim between spellcheck files
**File:** [spellcheckExclusions.ts:41](../../src/webviews/md/livePreview/spellcheckExclusions.ts#L41) and its twin in `spellcheck.ts`. **Severity/Effort:** S / S.

### 2.9 `dimMark`/`hiddenMark` recreated per-call instead of module-scoped
**File:** [revealDecorations.ts:335](../../src/webviews/md/livePreview/revealDecorations.ts#L335) — inconsistent with sibling marks in the same file that are module-scoped singletons. **Severity/Effort:** S / S.

### 2.10 Version history persistence is a full read/parse/rewrite on every save settle
**File:** [mdEditorProvider.ts:90-136](../../src/mdEditorProvider.ts#L90) (`loadHistory`/`saveHistory`/`pruneHistory`/`persistVersionSnapshot`) — see §3.1 (grouped there since it's primarily a performance concern, but the append-only/diff-based redesign would also simplify this code).

---

## 3. Performance

### 3.1 Version history rewrites the entire history file (with full document content) on every save
**File:** [mdEditorProvider.ts:90-136](../../src/mdEditorProvider.ts#L90), invoked from the debounced autosave path (:287) and directly from `restoreVersion` (:435)

Each settle: read the whole history JSON, parse, filter by 48h retention, push one entry holding
the **full markdown content** (not a diff), reserialize, rewrite the entire array. With autosave on
over a long session, this is O(history-size × file-size) work repeated on essentially every pause
in typing.

**Suggested direction:** append-only storage (e.g. NDJSON) or diff-based snapshots; at minimum skip
the rewrite when nothing was pruned and only an append happened.

**Severity/Effort:** M/L (scales with usage) / M.

### 3.2 Every keystroke double-serializes the document and re-scans it, just to refresh toolbar button state
**File:** [mdWebview.ts:430](../../src/webviews/md/mdWebview.ts#L430) (`updateEditToolbarButtons()` called from `onDocChanged`) → [mdWebview.ts:156-158](../../src/webviews/md/mdWebview.ts#L156) (`isEditorDirty`) → [mdWebview.ts:522-532](../../src/webviews/md/mdWebview.ts#L522) (`getActiveEditorContent`) → `getLivePreviewContent()` ([livePreviewEditor.ts:287-289](../../src/webviews/md/livePreview/livePreviewEditor.ts#L287), a full `doc.toString()`) → `sanitizeMarkdownCopyLinkArtifacts` ([mdWebview.ts:264-275](../../src/webviews/md/mdWebview.ts#L264), a `split`/regex/`join` over every line)

`onDocChanged` already has the new document as a string (`doc`) and assigns it to `currentContent`
right before this call — `updateEditToolbarButtons` then independently redoes a full
materialization + full-document regex pass on the *same* content, unthrottled, every keystroke.

**Suggested direction:** compare the already-available `doc`/`currentContent` directly against
`originalContent` instead of round-tripping through CM6 again; reserve the sanitize step for actual
save/read paths.

**Severity/Effort:** M / S.

### 3.3 Un-debounced full-document search re-run on every keystroke while search overlay is open
**File:** [mdWebview.ts:428](../../src/webviews/md/mdWebview.ts#L428) (`reapplySearch`, called synchronously from `onDocChanged`) → [mdWebview.ts:974-990](../../src/webviews/md/mdWebview.ts#L974) (`doSearch`) → [livePreviewSearch.ts:53-62](../../src/webviews/md/livePreview/livePreviewSearch.ts#L53) (`findCm6Matches`, a full-document `SearchCursor` scan)

Typing in the *document* while the search overlay is open bypasses the 200ms debounce that
correctly gates typing in the *search box itself* ([mdWebview.ts:939-941](../../src/webviews/md/mdWebview.ts#L939)).

**Suggested direction:** route document-edit-triggered re-search through the same debounce.

**Severity/Effort:** M / S.

### 3.4 TOC-resize drag writes a CSS custom property on every raw `mousemove`
**File:** [mdWebview.ts:1637-1644](../../src/webviews/md/mdWebview.ts#L1637) — no `throttleRAF` (the file's own utility, used elsewhere for scroll) applied here. **Severity/Effort:** S / S.

### 3.5 Table hover/drag handlers force layout reads in a loop on every raw `mousemove`
**File:** helpers at [tableWidget.ts:965-998](../../src/webviews/md/livePreview/tableWidget.ts#L965), hover at :1092-1112, row-drag `onMove` at :1162-1180, column-drag `onMove` at :1216-1234

Each does `querySelectorAll` + `getBoundingClientRect()` (forces sync layout) in a loop over every
row/header cell, directly inside `mousemove` — no rAF gate anywhere in this file's drag/hover code,
unlike `wireTableScrollUI`'s own `update()` which at least defers via one `requestAnimationFrame`.

**Suggested direction:** gate these handlers behind an rAF (compute once per frame, not per event);
cache row/column rects at drag-start and refresh only on scroll, as the grip-position code already
does.

**Severity/Effort:** M / S-M. **Recommend manual F5 verification:** drag a row/column on a table
with 20+ rows/columns and watch for jank.

### 3.6 `headingGutterSync.ts` rebuilds via a full unbounded syntax-tree walk on every transaction
**File:** [headingGutterSync.ts:44](../../src/webviews/md/livePreview/headingGutterSync.ts#L44) — no `docChanged` guard or viewport scoping, unlike `revealDecorations.ts` and `livePreviewSearch.ts` in the same folder. **Severity/Effort:** M / S.

### 3.7 Spellcheck exclusion computation is unscoped while the diagnostics loop it feeds is properly viewport-scoped
**File:** [spellcheck.ts:72](../../src/webviews/md/livePreview/spellcheck.ts#L72) — exclusion ranges computed over the whole document even though the actual per-word diagnostics loop correctly uses `view.visibleRanges`. **Severity/Effort:** M / S.

### 3.8 Ordered-marker atomic-range decoration rescans the whole document on every cursor motion
**File:** [revealDecorations.ts:662](../../src/webviews/md/livePreview/revealDecorations.ts#L662) — the file's own comment acknowledges this as a deliberate tradeoff; flagging for profiling on large documents rather than as an outright bug. **Severity/Effort:** M / M.

### 3.9 Widget StateFields ignore the transaction and rebuild unconditionally every keystroke, anywhere in the document
**File:** [mermaidWidget.ts:214-220](../../src/webviews/md/livePreview/mermaidWidget.ts#L214), [calloutWidget.ts:103-109](../../src/webviews/md/livePreview/calloutWidget.ts#L103), [frontmatterWidget.ts:99-101,114-118](../../src/webviews/md/livePreview/frontmatterWidget.ts#L99)

All three `update(_value, tr)` implementations discard `tr` and rebuild from full state on every
transaction anywhere in the doc. `tableWidgetField` does the same but is explicitly documented as an
accepted tradeoff (tables are rare); that reasoning doesn't extend to callouts/frontmatter, which can
appear on every keystroke's rebuild path regardless of edit location. `frontmatterWidget.ts` is the
worst case: `resolveFrontmatterWidgetData(state.doc.toString())` materializes the **entire document**
into a string and runs a full `js-yaml` parse, even though frontmatter (if present) only ever
occupies the first few lines. By contrast, `imageWidgetField` ([imageWidget.ts:271-278](../../src/webviews/md/livePreview/imageWidget.ts#L271)) and `codeStylingPlugin` correctly gate on
`docChanged`/`viewportChanged`/explicit effects — the right template to copy.

**Suggested direction:** gate callout/frontmatter rebuilds the same way `imageWidgetField` does;
additionally, since frontmatter always starts at offset 0, use `state.doc.sliceString(0, N)` with a
generous bound instead of materializing the whole document.

**Severity/Effort:** M / S-M (low real-world urgency today since frontmatter blocks are small and
documents in this workflow are typically modest, but the frontmatter full-doc-string cost scales
badly for large files and is a one-line-ish fix).

### 3.10 `yamlLineIndexForKey` re-splits the document text on every call
**File:** [frontmatter.ts:74-84](../../src/webviews/md/frontmatter.ts#L74) — called once per field row inside `flattenFieldRows`, each call re-splitting the same YAML text. Trivial fix: split once and thread the array down. **Severity/Effort:** L / S. (Only matters if 2.5's dead-code path is ever revived — otherwise this is unreachable in practice today.)

---

## If I could only do 5 things

Ordered by bug-risk-reduced per unit of effort:

1. **Fix `originalContent` desync on save completion** (§1.1, `mdWebview.ts:612-618`/`:1405-1416`)
   — silent data loss on a common timing window, S effort, highest real-world severity found.
2. **Guard `flattenFieldRows` against circular YAML** (§1.2, `frontmatter.ts:107-163`) — a
   reproducible crash of the entire live-preview decoration pipeline, S effort.
3. **Add the fenced-code guard to table-boundary-editing and callout-fence detection** (§1.3/§1.4,
   `tableBoundaryEditing.ts:198-357`, `calloutTypes.ts:82-118`) — one fix pattern applied twice,
   closes an actual data-loss path (backspace deleting code content) plus a rendering-corruption
   path, M effort.
4. **Disconnect the table widget's leaked `ResizeObserver`/`MutationObserver`** (§1.6,
   `tableWidget.ts:1006-1030`) — unbounded observer growth over long sessions in the app's biggest,
   most-touched widget file, S effort.
5. **Add the missing conflict check to `restoreVersion`** (§1.7, `mdEditorProvider.ts:410-451`) —
   closes a silent-overwrite race that `saveMarkdown` already guards against elsewhere in the same
   file, S effort.

Runner-up worth calling out even though it didn't make the top 5: the stale-cell-position bug in
multi-table documents (§1.5) is a genuinely common scenario, but its fix (re-resolving position at
click time, mirroring the context-menu path) is S-M effort and slightly less certain than the top 5
without live verification.
