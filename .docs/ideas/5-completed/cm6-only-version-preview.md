---
title: CM6-only Markdown — drop static version preview render
slug: cm6-only-version-preview
status: completed
created: 2026-08-12
updated: 2026-08-13
---

# CM6-only Markdown — drop static version preview render

## Idea

Reading mode was removed, but version history preview still unmounts CM6 and renders static HTML via `renderMarkdown()`. We should have a single editing surface only: CM6 for normal edit **and** for browsing old versions (read-only CM6 + banner). Delete the static render pipeline and slim markdown-it down to what CM6 still needs (TOC parse).

## Brainstorm

**Context:** Phase 3 of `remove-reading-split-view-modes` deliberately kept `renderMarkdown()` for version preview. That left two visual pipelines and stale "reading mode" terminology in CSS/comments.

**Decided UX:**

| State | Surface | User can |
|---|---|---|
| Normal edit | CM6, editable | Edit, save, undo, format, autosave |
| Version preview | Same CM6 instance, **read-only** | Scroll, search, TOC; **Restore** or **Cancel** via banner only |
| Exit version preview | CM6, editable again | Disk content (Cancel) or restored snapshot (Restore) — host already drives this via `initMarkdown` + cancel/restore messages |

**Fixed outcomes:**

- Version preview looks identical to edit mode (same live-preview widgets: tables, callouts, mermaid, images).
- No view-mode toggle returns — CM6 never unmounts after first `initSettings`.
- markdown-it **renderer** customizations (fence/code-block HTML, table wrapper, heading anchors, mermaid DOM, hljs) are deleted; **parse** stays for TOC (`refreshCm6Toc`).
- `tableWidget.ts` keeps its own minimal `MarkdownIt` instance (unchanged).
- katex/footnotes/deflist/emoji plugins only applied on static render today — dropping render means version preview matches edit mode for those (already unrendered in CM6). Acceptable; consistent.

**Out of scope:**

- Spreadsheet version preview (`spreadsheetWebview.ts`) — separate surface.
- Adding CM6 widgets for katex/footnotes/etc.
- Removing markdown-it dependency entirely.

## Plan

### Goal

One Markdown surface (CM6). Version history preview = load snapshot into CM6 + read-only + banner. Delete `renderMarkdown()` and legacy static-HTML helpers.

### Step 1 — CM6 read-only API

**File:** `src/webviews/md/livePreview/livePreviewEditor.ts`

1. Add `readOnlyCompartment = new Compartment()`.
2. Export `setLivePreviewReadOnly(on: boolean)` — reconfigure compartment with `EditorState.readOnly.of(true)` or `[]`.
3. Include read-only compartment in initial extensions (default off).
4. When read-only: CM6 still allows selection, scroll, search highlights; typing/format keymaps blocked by CM6 readOnly state. Verify slash menu / table cell editing / frontmatter edit widgets respect readOnly (may need guards in widgets if any bypass CM6 doc edits).

### Step 2 — Version preview stays on CM6

**File:** `src/webviews/md/mdWebview.ts`

Refactor `setVersionPreviewMode(enabled, label?)`:

**Enter (`enabled: true`):**

- Do **not** call `setPreviewEditMode(false)` (stop unmounting CM6).
- Set `isVersionPreviewMode = true`; toggle `version-preview-mode` body class + banner (unchanged UX).
- `setLivePreviewContent(currentContent)` — host already sent version text via `initMarkdown` before `versionPreviewMd`.
- `setLivePreviewReadOnly(true)`.
- Hide/disable edit chrome: save, undo, redo, reload-from-disk, formatting toolbar (`performSave`, `scheduleAutosave`, `applyFormat` early-return when `isVersionPreviewMode`).
- Optionally add `body.version-preview-mode` CSS to dim or pointer-block widget edit affordances (table grips, callout type select) if readOnly alone isn't enough.

**Exit (`enabled: false`):**

- `setLivePreviewReadOnly(false)`.
- Hide banner; `ensurePreviewEditMode()` becomes a no-op if CM6 never unmounted (simplify to just re-enable chrome).
- Host already posts `initMarkdown` with restored/cancelled disk content before `versionPreviewCancelledMd` / `versionRestoredMd` — keep using `applyReloadedContent` on those paths.

**Simplify `setPreviewEditMode`:**

- Remove the `else` branch that calls `unmountLivePreview()` + `renderMarkdown()` — CM6 stays mounted for app lifetime after first init.
- Function may shrink to toolbar/class toggles only, or merge into init if `enabled` is always true post-init (audit callers; only `ensurePreviewEditMode` and first `initSettings` should enable).

### Step 3 — Delete static render pipeline

**File:** `src/webviews/md/mdWebview.ts`

Delete (grep to catch all references):

| Remove | Notes |
|---|---|
| `renderMarkdown()` | ~659–687 |
| `renderMermaidFlowcharts()` | only called from renderMarkdown |
| `mountPreviewFrontmatterCard()` usage in render path | CM6 uses `frontmatterWidget` |
| `refreshDataLineCache()`, `cachedDataLineElements`, `cachedPreviewLineMap`, `normalizeLineMap` | static `[data-line]` scroll sync |
| `wirePreviewInteractions()` + bottom `wirePreviewInteractions()` call | static click handlers; CM6 uses `handleLivePreviewModifierClick` |
| Legacy search DOM path (`searchMatches` mark elements in preview HTML) | keep `cm6SearchMatches` only |
| Legacy scroll-spy branch in `updateScrollSpy` / `updateProgressBar` (non-CM6 `else`) | CM6 paths only |
| `injectLineNumbers` renderer rules | only served static render + data-line cache |
| Custom `md.renderer.rules.*` (fence, table_open/close wrapper, heading_close anchors, image zoomable, code_inline class, containers plugins output) | keep parse path |

**Slim markdown-it setup:**

- Keep `const md = new MarkdownIt({ ... })` minimal config OR strip to defaults needed for `md.parse()` heading tokens.
- Keep `addHeadingIds`, `buildToc`, `refreshCm6Toc`, `sanitizeMarkdownCopyLinkArtifacts`, `markdownBodyWithoutFrontmatter`.
- Remove hljs import if only used by fence renderer.
- Remove markdown-it plugins only used for HTML render (taskLists, container, katex, emoji, mermaid plugin on `md`, etc.) **if** TOC parse doesn't need them — headings parse without plugins. Drop unused imports.

**Update message handlers:**

- `initMarkdown`: always `applyReloadedContent` when CM6 active; remove `renderMarkdown` fallback branch.
- `applyReloadedContent` / `applyFrontmatterBlockToDocument`: remove `else { renderMarkdown(...) }` branches.
- `diskChangedExternally`: CM6-only path.

### Step 4 — CSS cleanup

**File:** `resources/md/mdWebview.css`

Remove static-render-only rules (audit before deleting — CM6 may not use these classes):

- `.code-block`, `.code-block-header`, `.code-copy`, `.code-lang`, static `pre code` line numbers
- `.md-table-scroll` wrapper rules added for markdown-it tables (CM6 uses `.cm-md-table-scroll`)
- `.markdown-preview h1/h2` GitHub-style rules if CM6 headings styled via `cm6Theme.ts` only
- `.heading-anchor` hide rule may stay for CM6 if anchors not used in live preview
- `.zoomable` / lightbox triggers from static images (CM6 has `imageWidget`)
- Container callout classes (`.warning`, `.info`, …) if only markdown-it-container output

Keep:

- `.version-preview-banner` and `body.version-preview-mode` (add read-only affordance styles if needed)
- `.markdown-preview` layout shell, TOC, toolbar, CM6 container rules (`body.cm6-preview-active`, `body.preview-edit-mode`)
- Shared tokens (`--surface-radius`, etc.)

### Step 5 — Docs & comments

- Update stale "reading mode" comments in `cm6Theme.ts`, `tableWidget.ts`, `imageWidget.ts`, `mdWebview.css`.
- Append note to `.docs/ideas/5-completed/remove-reading-split-view-modes.md` Implementation Log (optional cross-ref) or `.docs/MAP-mdWebview.md` — remove `renderMarkdown` from MAP sections.

No message-protocol changes expected (host flow unchanged: `initMarkdown` → `versionPreviewMd` → cancel/restore messages).

### Step 6 — Verification

```bash
npm run compile
```

Manual smoke (F5, sample `.md`):

1. File opens in CM6 edit — edit/save/autosave work.
2. Version history → pick old version → same CM6 view, read-only, banner visible, cannot type/save.
3. Cancel → returns to disk content, editable again.
4. Version history → Restore → file saved, editable, banner gone.
5. TOC, search, scroll progress still work in both normal and version preview.
6. Tables/code blocks/callouts look correct (single pipeline).

### Risk notes

- Widgets with `contentEditable` cells (`tableWidget`) or dropdowns may need explicit `isVersionPreviewMode` guards if `EditorState.readOnly` doesn't block them.
- First-load race: host sends `initMarkdown` then `versionPreviewMd` — ensure read-only applies after content seed (order in handler may need tightening).
- Bundle size should shrink (fewer markdown-it plugins + hljs usage in mdWebview if removed).

### Files touched (expected)

| File | Change |
|---|---|
| `src/webviews/md/livePreview/livePreviewEditor.ts` | read-only compartment + export |
| `src/webviews/md/mdWebview.ts` | version preview refactor, delete render pipeline |
| `resources/md/mdWebview.css` | remove dead static-render CSS |
| `src/webviews/md/livePreview/tableWidget.ts` | comment only (unless grip guard needed) |
| `src/webviews/md/livePreview/cm6Theme.ts` | comment only |
| `.docs/MAP-mdWebview.md` | optional MAP trim |

## Implementation Log

- **`livePreviewEditor.ts`**: Added `readOnlyCompartment` + `setLivePreviewReadOnly()` / `isLivePreviewReadOnly()`; format keymaps skip when read-only.
- **`mdWebview.ts`**: Version preview keeps CM6 mounted (`setLivePreviewReadOnly(true)` + banner); removed `renderMarkdown()`, static HTML pipeline, `wirePreviewInteractions`, legacy DOM search/scroll paths; slim markdown-it to TOC parse only; `initMarkdown` always seeds CM6 via `applyReloadedContent`.
- **`mdWebview.css`**: Removed static-render rules (code blocks, markdown-it table wrapper, container callouts, task lists); added `body.version-preview-mode` widget affordance guards.
- **`tableWidget.ts`**: Read-only guards on resize/drag/cell mousedown when `view.state.readOnly`.
- **Comments**: Updated stale "reading mode" references in `cm6Theme.ts`, `imageWidget.ts`, `tableWidget.ts`, `mdWebview.ts`.
- **`npm run compile`**: passes (2026-08-12).

## QA

**Build:** `npm run compile` — pass (0 type + 0 lint errors, 2026-08-13).

**Static verification (code):**

| Check | Result |
|---|---|
| `renderMarkdown()` removed from `mdWebview.ts` | Pass |
| `setLivePreviewReadOnly()` / `readOnlyCompartment` in `livePreviewEditor.ts` | Pass |
| Version preview sets read-only + banner without unmounting CM6 | Pass |
| Static-render CSS removed; `body.version-preview-mode` widget guards added | Pass |
| `tableWidget.ts` read-only guards on resize/drag/cell mousedown | Pass |
| markdown-it slimmed to TOC parse path only | Pass |

**Manual F5 spot-check recommended:** open `samples/test.md` → Version history → preview old version (read-only CM6 + banner) → Cancel and Restore paths return to editable mode with correct content.
