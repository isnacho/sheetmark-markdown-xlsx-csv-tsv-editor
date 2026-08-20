---
title: Diff view — disk vs editor
slug: diff-view-disk-vs-editor
status: to-implement
created: 2026-08-20
updated: 2026-08-20
---

# Diff view — disk vs editor

## Idea

Can we create an optional diff view, that shows the diffs between what's on disk vs
on view, this is so when the AI changes something, I can see the difference. How can
we do this? Open to ideas.

## Brainstorm

### Decided direction

An **optional diff overlay inside Preview Edit** that shows what changed between the
content you were last looking at and what is now on disk — the "what did the AI just
do to my file" view. Read mode is deliberately untouched.

**Product picks:** scope = Preview Edit only · baseline = last-seen vs current disk ·
presentation = unified inline *and* side-by-side (user choice) · activation = setting +
toolbar toggle + toast action · interactions = accept/reject per chunk, change-count
badge, next/prev navigation.

### Why this shape

Sheetmark's view buffer lives in the webview (CM6), disk lives outside it, so the two
genuinely diverge — unlike a normal text editor where VS Code owns both. Today an
external change is either applied silently (read mode, "Reloaded from disk" toast) or
offered behind a persistent "File changed on disk" toast (Preview Edit). In both cases
the *content* of the change is invisible. Diffing where the real editable buffer already
is (CM6) keeps this to a text-level diff with no rendered-block mapping, and CodeMirror's
own merge addon already provides chunked inline/side-by-side views with accept-reject.

### Baseline semantics ("what am I diffing against")

- Baseline = **the content the user was last shown** — i.e. the value of the
  webview's loaded content immediately *before* an external disk change is applied.
- The baseline must be captured on **every** external change, **including while in read
  mode**. Read mode still auto-reloads silently as it does today, but the pre-reload
  content is retained so that entering Preview Edit afterwards can still show the diff.
  Without this, the common case (AI edits while you read) has nothing to diff.
- Baseline is cleared when: the user saves, dismisses the diff, restores a version, or
  accepts/rejects all chunks. It survives Preview Edit ↔ read mode toggles and manual
  reloads-from-disk.
- Only one baseline is kept (last external change wins). If a second external change
  lands while the diff is open, the diff refreshes against the *original* baseline so
  the user still sees the full set of external edits, and the change count updates.
- Out of scope: diffing unsaved local edits against disk (dirty-diff), and diffing
  arbitrary version-history snapshots. Both remain possible later on the same machinery.

### Presentation — two layouts, user's choice

- **Unified inline (default):** changed regions marked in place in the CM6 doc,
  deletions and insertions as adjacent chunks.
- **Side-by-side:** two panes, baseline left / current right.
- Layout is a persisted preference (`diffLayout`, default `inline`), switchable while
  the diff is open — switching must not lose scroll position or pending accept/reject
  state.
- Both layouts are **read-only with respect to the diff decorations** — the user edits
  normally underneath; only the accept/reject affordance mutates content.

### Activation — three entry points, one state

1. **Toolbar toggle** in Preview Edit: turns the diff overlay on/off for this session.
   Disabled (not hidden) with an explanatory tooltip when there is no baseline to diff.
2. **Persisted setting** (`xlsxViewer.md.*`, default **off**) exposed in the settings
   menu panel: decides whether the overlay comes up automatically when an external
   change is detected.
3. **Toast action "See changes"** on the external-change notification. In Preview Edit it
   turns the overlay on directly. In read mode — where the overlay cannot render — it
   switches into Preview Edit with the overlay on.

All three drive the same single "diff visible" state; the toggle reflects it.

### In-diff interactions

- **Accept / reject per chunk.** Accept keeps the disk (AI) version of that chunk;
  reject restores the baseline version. Rejecting writes back — so it is a real edit to
  the document, following the editor's normal save/dirty rules (never a silent disk
  write).
- **Change-count badge** showing added/removed lines (e.g. `+12 −3`) in the status area,
  alongside the existing stats readouts. Also used in the toast copy so the user learns
  the size of the change before opening it.
- **Next / previous change navigation** to step between chunks, scrolling each into view.
- Empty state: if baseline and disk are identical, report "No changes" rather than
  showing an empty diff.

### Copy

- Toast (external change, Preview Edit): existing "File changed on disk" text, plus a
  **See changes** action next to the existing Reload action.
- Toast (external change, read mode): keep today's "Reloaded from disk", extended with
  the change count and a **See changes** action.
- No-baseline toggle tooltip: something to the effect of "No external changes to compare".
- Diff-active indicator: change count badge; no modal, no blocking state.

### Deliberately excluded

- Rendered-output (read mode) diff — needs source-line → rendered-block mapping.
- A separate VS Code native diff tab.
- Gutter-only change bars.
- Spreadsheet editor cell-level diff.

### Feasibility notes for Plan

- `@codemirror/merge` is the official CM 6.x addon covering both layouts plus chunk
  accept/reject, and matches the eleven `@codemirror/*` deps already in use. Adding it is
  the expected route; no diff library is bundled today.
- Baseline plumbing rides on the existing external-change path
  (`fileExternalChangeWatcher` → `diskChangedExternally`), which already has the
  pre-change content in hand before it overwrites it.
- The existing version-history preview pipeline (`versionPreviewMd` /
  `cancelVersionPreview` / `restoreVersion`) is prior art for swapping displayed content
  and must not be broken by the diff state machine.
- Per AGENTS.md rule 2, every new message needs both ends wired plus an entry in
  `.docs/dev/MESSAGE-PROTOCOL.md`.

## Plan

Approved 2026-08-20. Full plan file: `~/.claude/plans/recursive-nibbling-quokka.md`.

### Spec corrections found while planning

1. **There is no "read mode."** `enterPreviewEditMode()` runs unconditionally on
   `initSettings` (`src/webviews/md/mdWebview.ts:1606-1611`) and `isEditMode` is never set
   back to `false` — the CM6 view is the only view. The Brainstorm section's "read mode
   untouched" scope and the `!isEditMode` silent-reload branch (`mdWebview.ts:1544`) are
   effectively dead paths, reachable only in the pre-boot window. Scope is just "the editor".
   The real pain is that **Reload** replaces the whole document with no visibility.
2. **No host-side diff state needed.** At toast time the webview already holds both sides:
   `currentContent` (what the user sees) and `m.content` (new disk content). Baseline capture
   is webview-local; the diff itself adds no new host↔webview commands.

### Decisions taken with the user

- **"See changes" = reload + diff.** Disk content is applied to the buffer and diffed against
  the retained baseline, so external insertions read as additions. Only direction in which
  accept/reject is meaningful.
- **Inline (unified) only this pass.** Side-by-side needs a second `EditorView` while
  `livePreviewEditor.ts:127` owns a module-level singleton `view` — deferred to its own idea
  file after this ships and passes QA. The `diffLayout` setting is added but only `inline` is
  honored.

### Steps

1. **Dependency** — `npm install @codemirror/merge` (^6.12.2, verified available). Bundled by
   the browser esbuild pass; no new asset file, so no CSP / `localResourceRoots` change.
2. **New `livePreview/diffView.ts`** — `buildDiffExtension(original)` wrapping
   `unifiedMergeView({ original, mergeControls: true })`; pure `diffLineStats(baseline,
   current)` → `{ added, removed }` for toast copy and badge before the extension mounts;
   thin wrappers over merge's chunk get/next/prev exports.
3. **`livePreviewEditor.ts`** — add `diffCompartment` alongside the existing four (`:128-131`),
   included in the mount extension list (`:239-263`); new setters modeled on
   `setLivePreviewReveal` (`:367`): `setLivePreviewDiff`, `isLivePreviewDiffActive`,
   `getLivePreviewDiffStats`, `goToNext/PrevLivePreviewDiffChunk`. Verify merge decorations
   against the reveal/widget layer (tables, mermaid, list markers); fallback is to
   reconfigure `revealCompartment` off while the diff is on. Suppress the diff during
   `isVersionPreviewMode`.
4. **Baseline lifecycle in `mdWebview.ts`** — `diffBaseline` / `diffVisible` module state;
   set baseline in `diskChangedExternally` (`:1519`) only when currently `null` so bursts
   still diff against what the user last saw; `applyReloadedContent` (`:663`) must not clear
   it; clear on successful save, dismiss, all chunks resolved, and version-preview
   transitions.
5. **Activation (all three)** — `toggleDiffButton` in `buildToolbarButtons` (`:1701`) + icon
   in `shared/icons.ts`, enabled via `updateEditToolbarButtons` (`:194-213`) guarded on
   `diffBaseline !== null`; settings `md.autoShowDiskDiff` (bool, default false) and
   `md.diffLayout` (enum, default `inline`) threaded through
   `buildMdWebviewSettings()` / the `updateSettings` writer (needs a validated string branch
   — it is all-boolean today) / `applySettings` / `SettingsManager`; `showToast`
   (`:810-853`) widened from one action to an array so the disk-change toast can offer
   **Reload** and **See changes**, the latter going through the existing dirty/discard
   confirm (`:1562`).
6. **Accept/reject, badge, nav** — merge's own chunk commands mutate the CM6 doc, so changes
   flow through `onDocChanged` (`:447-456`) into `currentContent` and the normal dirty/save
   path; never a direct disk write. `+N −M` badge needs its own element because
   `updateStatusInfo` (`:900`) returns early when `showStats` is off. Next/prev buttons and
   keybindings in the toolbar/shortcut section (`:1442-1591`).
7. **Docs** — `.docs/dev/MESSAGE-PROTOCOL.md` for the new settings payload fields (AGENTS.md
   §2); `.docs/dev/MAP-mdWebview.md` gains `diffView.ts`.

### Files

| File | Change |
|---|---|
| `package.json` | dep + 2 config keys |
| `src/webviews/md/livePreview/diffView.ts` | **new** — merge extension + stats helper |
| `src/webviews/md/livePreview/diffView.test.mts` | **new** — `diffLineStats` units |
| `src/webviews/md/livePreview/livePreviewEditor.ts` | `diffCompartment` + setters |
| `src/webviews/md/mdWebview.ts` | baseline state, toast actions, toggle, badge, nav |
| `src/webviews/shared/icons.ts` | diff icon |
| `src/mdEditorProvider.ts` | settings read + write |
| `resources/shared/*.css` | two-action toast, diff chunk styling |
| `.docs/dev/MESSAGE-PROTOCOL.md`, `.docs/dev/MAP-mdWebview.md` | docs |

### Verification

`npm run compile` (0 type errors, 0 lint errors; the 5 pre-existing eslint `curly` warnings
must not grow) and `npm test` for the co-located `*.test.mts` units. Neither proves the
feature works — there is no extension-host test suite, so the manual smoke test in QA is the
real verification.

### Risks

1. Merge decorations vs. the reveal/widget layer — main unknown.
2. `diffLayout` enum through boolean-only settings plumbing.
3. Baseline lifetime vs. version preview — must be mutually exclusive.
4. Working tree already carries ~20 uncommitted modified files, several near `mdWebview.ts`.

## Implementation Log

_Not started._

## QA

_Not started._
