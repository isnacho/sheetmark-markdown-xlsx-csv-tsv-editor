---
title: Diff view — disk vs editor
slug: diff-view-disk-vs-editor
status: to-qa
created: 2026-08-20
updated: 2026-08-24
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
3. **Toast action "Review changes"** on the external-change notification. In Preview Edit it
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
  **Review changes** action next to the renamed **Load disk changes** action.
- Toast (external change, read mode): keep today's "Reloaded from disk", extended with
  the change count and a **Review changes** action.
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

### Bounced back to to-plan (2026-08-24)

The shipped v1 (Load disk changes / Review changes, per-chunk + bulk diff) was ready for
QA, but working through a full state diagram of the flow surfaced a genuinely new,
unbuilt piece of scope — the "Keep local version" toast action below. Rather than QA
the shipped part while unplanned scope sits half-described in the same file, the whole
idea bounces back to `to-plan` so the addendum gets a proper Plan-phase pass (own
`EnterPlanMode` round) before Implement/QA resume. The v1 QA checklist further down is
untouched and still valid — it just waits for this addendum to be planned and merged in.

### Addendum (2026-08-24) — third toast action: "Keep local version"

Worked out against a full state-diagram pass of the disk-changed flow (captured in
`.docs/sheetmark-draw.excalidraw`), covering ground the original Brainstorm didn't: what
happens when the user wants to keep *their* version and discard the incoming external
edit, rather than only "load" or "review" it.

- **New toast action, "Keep local version"**, alongside the existing **Load disk
  changes** / **Review changes**. Effect: force-write the current buffer to disk,
  discarding the external change. Gated behind an explicit confirm — **"Overwrite disk
  with your version?"** → **Overwrite disk** / **Cancel**.
- **Cancel is terminal.** Closes quietly, toast stays exactly as it was, no re-prompt
  loop back into the toast flow.
- **This is a real, user-confirmed save, not a silent write** — the concern going in was
  that writing disk outside the normal save command breaks undo history / dirty-flag
  bookkeeping. Resolved: since the user explicitly clicks a confirm button naming the
  effect ("Overwrite disk"), that click *is* the save trigger, same as Cmd+S. Plan
  requirement: it must route through the **same save call** the editor's own Save command
  uses, not a bespoke `fs.writeFile` — see Plan addendum below.
- **The existing reload-confirm gets a second resolution.** Today (per QA §4), triggering
  "Load disk changes" with a dirty buffer shows "Discard unsaved changes and reload from
  disk?" and Cancel just leaves the buffer dirty (a no-op). New scope: Cancel on *that*
  dialog is reframed as **"Keep mine, ignore disk"** and now performs the same
  force-write-to-disk as the new toast action, rather than leaving the buffer hanging
  dirty. Two entry points (top-level toast button, and the reload confirm's cancel path)
  converging on the same effect — intentional, not a duplicate.
- **Per-chunk accept/reject is unchanged** — still never a direct disk write, still flows
  through `onDocChanged` into the normal dirty/save path exactly as shipped.
- Confirmed already covered, no new scope: the diagram pass flagged what looked like a
  missing "last chunk resolved → done" exit edge on the per-chunk diff view, but that's
  already handled by the shipped `onDiffChunkResolved` hook (see Implementation Log,
  "Post-implementation fixes"). Also confirmed the bulk (**Accept all**/**Reject all**)
  and per-chunk actions are correctly a single `unifiedMergeView`, not two separate
  dialogs — the diagram's two boxes were a documentation artifact, not a real gap.

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

- **"Review changes" = reload + diff.** Disk content is applied to the buffer and diffed against
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
   **Load disk changes** and **Review changes**, the latter going through the existing dirty/discard
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

### Addendum (2026-08-24) — "Keep local version": approved plan

Approved 2026-08-24. Full plan file: `~/.claude/plans/stateless-whistling-cocoa.md`.
New scope on top of the shipped v1 (not built or QA'd yet — see Brainstorm addendum
above for the product decision). All changes are webview-side; no new host↔webview
message and no `mdEditorProvider.ts` change — `doSave(true, false)` already posts
`saveMarkdown` with `force: true`, which the host handler (`mdEditorProvider.ts:351-374`)
already honors, skipping its conflict re-check and writing straight through
`vscode.workspace.fs.writeFile`. Mirrors the existing `confirmOverwriteConflict` →
`doSave` precedent in `performSave` (`mdWebview.ts:662-667`).

1. **Generalize `confirmModal`** (`mdWebview.ts:717-753`, today `Promise<boolean>`) to take
   an optional 4th param `secondaryLabel` and resolve `'confirm' | 'secondary' | 'cancel'`.
   Omitted `secondaryLabel` keeps today's exact behavior (Cancel button + backdrop both →
   `'cancel'`). The 3 existing wrappers (`confirmOverwriteConflict`, `confirmRestoreConflict`)
   keep exposing `Promise<boolean>` via `.then(r => r === 'confirm')` — no call-site changes.
2. **`confirmDiscardAndReload`** (:755-757) exposes the 3-way result directly as
   `ReloadDecision = 'reload' | 'keepLocal' | 'cancel'`, passing `'Keep mine, ignore disk'`
   as the new secondary label. Its 3 call sites — `requestReloadFromDisk` (:805-815),
   `revealDiskChanges` (:993-1013), and the `reloadPending` closure inside
   `diskChangedExternally` (:1788-1802) — each branch on the 3-way result: `'reload'` keeps
   today's path, `'cancel'` is unchanged (no-op), `'keepLocal'` clears `pendingDiskContent`,
   calls `hideToast()`, then `doSave(true)`. Guarded on `isSaving` to avoid a concurrent
   double-save.
3. **New `confirmOverwriteWithLocal()`** wrapper (same file, alongside the other three) for
   "Overwrite disk with your version?" (Overwrite disk / Cancel) — plain boolean, no
   secondary label needed since Cancel here is already the "closes quietly" no-op.
4. **New toast action** "Keep local version" added to the `diskChangedExternally` call site
   (:1820-1828) via a `keepLocalVersion` handler (same clear-pending/hide-toast/`doSave(true)`
   sequence as step 2's `'keepLocal'` branch).
5. **`showToast` template** (:850-914) gains a 3rd hardcoded `<button class="toast-action
   hidden">` — the existing positional mapping loop (:887-898) needs no change.
6. **CSS** (`resources/md/mdWebview.css`): the `.toast-action + .toast-action` gap rule is
   already adjacency-generic for N slots; the close-button bridging rule (~:2010-2012) needs
   2 new selector variants to cover "only 1st visible" and "1st+2nd visible, 3rd hidden" now
   that a 3rd slot always exists in the DOM.
7. **Not needed**: no `.docs/dev/MESSAGE-PROTOCOL.md` / `MAP-mdWebview.md` changes (no new
   message, no new module); no changes to per-chunk accept/reject or bulk accept/reject-all
   (both already correct — see Brainstorm addendum). Existing QA §4 checklist item
   ("cancelling keeps your edits") will need re-verification once this lands — cancelling via
   the *button* now writes to disk; only backdrop-dismiss stays a true no-op.

## Implementation Log

Implemented 2026-08-20 (inline layout only, per the Plan decision).

### Files changed

| File | Change |
|---|---|
| `package.json` | `@codemirror/merge` ^6.12.2; config keys `md.autoShowDiskDiff`, `md.diffLayout` |
| `src/webviews/md/diffStats.ts` | **new** — pure line-diff counts + `formatDiffLineStats` |
| `src/webviews/md/diffStats.test.mts` | **new** — 14 unit tests |
| `src/webviews/md/livePreview/diffView.ts` | **new** — `unifiedMergeView` wrapper, chunk accept/reject/navigate |
| `src/webviews/md/livePreview/livePreviewEditor.ts` | `diffCompartment` + `setLivePreviewDiff` / `isLivePreviewDiffActive` / `getLivePreviewDiffChunkCount` / next-prev / accept-reject |
| `src/webviews/md/mdWebview.ts` | baseline lifecycle, `showToast` multi-action, diff chrome, toolbar buttons, F7 nav, settings row |
| `src/mdEditorProvider.ts` | settings read/write (+ `normalizeDiffLayout`), `#statusBar` / `#diffBadge` markup |
| `src/webviews/shared/icons.ts` | `Diff`, `DiffNext`, `DiffPrev` |
| `resources/md/mdWebview.css` | merge-view theming, badge, status-bar wrapper, two-action toast |
| `.docs/dev/MESSAGE-PROTOCOL.md`, `.docs/dev/MAP-mdWebview.md` | docs |

### Deviations from the plan

1. **Split into two modules.** The plan put the stats helper inside
   `livePreview/diffView.ts`; it now lives in `src/webviews/md/diffStats.ts` with zero
   CodeMirror imports. Importing `@codemirror/view` into a `.test.mts` risks DOM-at-import
   failures under `node --test`, and `markdownStats.ts` already sets the pure-module
   precedent. Test file is therefore `diffStats.test.mts`, not `diffView.test.mts`.
2. **No `diffLayout` UI control.** The setting exists in `package.json` and both settings
   payloads, and the host validates it, but nothing in the panel switches it and only
   `inline` is honored — side-by-side is a separate idea. Its `enumDescriptions` says so.
3. **Badge needed a layout change.** `updateStatusInfo` bails out when `showStats` is off,
   so the badge got its own element inside a new `#statusBar` flex row; `.status-info` gave
   up its own `position: fixed` to that wrapper. Badge now survives stats being disabled.
4. **Auto-show is dirty-guarded.** `autoShowDiskDiff` applies the disk content and opens the
   diff immediately only when there are no unsaved local edits; with a dirty buffer it falls
   back to the toast so nothing is discarded without a prompt. Not spelled out in the plan.
5. **`showToast` widened to an action array** (was a single action). Added a CSS rule so the
   close-button spacing still tightens correctly when only one slot is filled.
6. **Diff retires on save.** `hideDiskDiff(true)` runs on a successful save, clearing the
   baseline — the saved document is the new reference point. Note the interaction with
   autosave: with `md.autoSave` on, typing after an external change clears the comparison.
7. **Version preview retires the diff** (`setVersionPreviewMode`), and the diff toggle is
   hidden/disabled during it, so the two content-swapping systems never overlap.
8. **Toast labels are `Load disk changes` / `Review changes`** (the plain action was `Reload`
   before this feature). Both actions load the incoming disk content — reviewing requires it
   in the buffer — so the labels differentiate on the verb, *load* vs *review*, rather than
   implying one applies and one only looks. The `md.autoShowDiskDiff` description and the
   settings-panel tooltip use the same wording.

### Post-implementation fixes (same session)

- **Accept-all button** (`diffAcceptAllButton`) resolves every remaining chunk, stopping if a
  pass fails to shrink the set so it cannot spin.
- **Bug this exposed:** accepting a chunk produces *no* document change — only an
  `updateOriginalDoc` effect — so the badge refresh and auto-retire, which hung off
  `onDocChanged`, never ran for accepts (rejects edit text and did work). Added the
  `onDiffChunkResolved` mount hook driven by `isDiffChunkResolution`.
- **Toast overflowed the pane (QA finding).** `.toast-notification` is centered with
  `left: 50%; translateX(-50%)` and had no `max-width`, while `.toast-text` was `nowrap`.
  Adding the change count plus two action labels pushed the pill wider than a narrow editor
  pane, so both ends were clipped — and the leading action button could sit at negative x,
  visible but unclickable. That single bug explains both reported symptoms ("toast cuts
  content" and "Load disk changes does not work"). Fixed with
  `max-width: min(92vw, 620px)`, `flex-wrap: wrap`, and a wrapping `.toast-text`.
- **No silent dead-end on reload.** If the queued disk content was already consumed (second
  watcher event, or the review path applying it first), the action now falls back to
  `requestReloadFromDisk()` instead of returning silently.
- **Chunk button contrast:** Accept/Reject labels now render white
  (`--color-text-on-action`) on solid success/error fills at
  `.cm-deletedChunk .cm-chunkButtons button[name=...]` specificity, which wins regardless of
  stylesheet injection order. Note the first root cause proposed for the reported invisible
  text was wrong — `style-mod` inserts its `<style>` at `head.firstChild`, so this stylesheet
  already won specificity ties; the fix removes the failure mode rather than confirming it,
  and whether this was the reported symptom is still unverified in QA.

### Bug found and fixed while testing

`diffLineStats` initially treated an empty document as one empty line (`''.split('\n')`
returns `['']`), reporting a phantom removal on the first write into an empty file. Empty
input is now zero lines, matching what git reports.

### Verification

- `npm run compile` — clean: 0 type errors, 0 lint errors, 0 warnings.
- `npm run test:unit` — 225 pass, including all 14 new `diffStats` tests.
- 3 pre-existing failures remain (`slashMenu`, `revealDecorations`, `tableWidget`): those
  files fail to *load*, not assert, because Node 25's `--test` strip-only mode rejects TS
  parameter properties (`slashMenu.ts:137`, `calloutWidget.ts:69`). Neither line is touched
  by this work and both fail on `HEAD` too. Worth its own fix (a real TS loader, or
  converting those two constructors to explicit field assignment).
- Confirmed the merge extension actually reached `dist/md/mdWebview.js` (bundled, not
  tree-shaken away) rather than trusting a clean compile.

### Not yet verified — the main QA risk

The reveal/widget precedence question from the plan is **untested**: nobody has yet looked at
the merge decorations rendering over tables, mermaid fences, callouts and list markers. The
documented fallback (reconfigure `revealCompartment` off while the diff is on) has not been
needed or implemented. This needs eyes in the Extension Development Host.

### Addendum (2026-08-24) — "Keep local version" implemented

Per the approved plan (`~/.claude/plans/stateless-whistling-cocoa.md`, see Plan addendum
above). All changes webview-side, no host or protocol changes, per plan.

#### Files changed

| File | Change |
|---|---|
| `src/webviews/md/mdWebview.ts` | `confirmModal` gains an optional `secondaryLabel` param and now resolves `ModalOutcome` ('confirm'/'secondary'/'cancel') instead of a plain boolean; `confirmDiscardAndReload` exposes the 3-way `ReloadDecision` ('reload'/'keepLocal'/'cancel') directly; `confirmOverwriteConflict`/`confirmRestoreConflict` adapted via `.then(r => r === 'confirm')`; new `confirmOverwriteWithLocal()`; new `keepLocalVersion` handler; 3 call sites (`requestReloadFromDisk`, `revealDiskChanges`, the `reloadPending` closure) branch on the 3-way decision and force-write via `doSave(true)` on `'keepLocal'`; 3rd toast action wired at the `diskChangedExternally` call site; `showToast` template gains a 3rd `.toast-action` button |
| `resources/md/mdWebview.css` | 2 new close-button bridging selectors for the 3-slot toast (only 1st visible; 1st+2nd visible, 3rd hidden); comment updates |

#### Deviations from the plan

None — implemented exactly as planned. The plan's sketch code matched what actually
landed at every call site.

#### Verification

- `npm run compile` — clean: 0 type errors, 0 lint errors, 0 warnings.
- `npm run test:unit` — 225 pass, same 3 pre-existing Node-25 load failures as `HEAD`
  (`slashMenu`, `revealDecorations`, `tableWidget` — unrelated, documented above). No new
  test file per plan (no new pure module was introduced).
- Confirmed the new strings (`Keep local version`, `Keep mine, ignore disk`, `Overwrite
  disk with your version`) actually reached `dist/md/mdWebview.js`, not just compiled.
- **Not yet done — manual smoke test.** Nothing below has been exercised in the Extension
  Development Host yet; see QA section for the checklist.

## QA

Branch: `feat/disk-diff-view` (`f1299c5`). Automated state: `npm run compile` clean,
`npm run test:unit` 225 pass / 3 pre-existing Node-25 load failures. **Nothing below has been
executed yet** — a clean build is not evidence this works.

### Launch

1. `npm run watch` (or just press **F5**, which uses it) → Extension Development Host opens.
2. Open `samples/test.md` in Sheetmark.
3. After any source edit, **Cmd+R** in the host window to pick up the rebuild.

External changes are made from a second process, e.g. from the repo root:

```bash
printf '\n## Added externally\n\nA new paragraph.\n' >> samples/test.md   # append
sed -i '' 's/^# Sheetmark/# Sheetmark (edited)/' samples/test.md            # modify a line
```

### 1. Golden path

- [ ] External append → toast reads `File changed on disk · +N −M` with **Load disk
      changes**, **Review changes**, and **Keep local version**.
- [ ] **Review changes** → content loads and the inline diff appears: added lines tinted,
      deleted text shown in a chunk widget above.
- [ ] Chunk **Accept** / **Reject** labels are legible (white on green / red).
- [ ] Accept one chunk → it stops being highlighted, badge count drops.
- [ ] Reject one chunk → that text reverts to the pre-change version, badge updates.
- [ ] Accept-all button → overlay retires, toast confirms.
- [ ] `+N −M` badge sits next to the status pill, bottom-right.

### 2. The two reported bugs (re-test)

- [ ] Narrow the editor pane (split it, or drag the sidebar wide) → toast **wraps** inside the
      pill; nothing is clipped at either edge; both action buttons fully visible.
- [ ] **Load disk changes** actually loads: document updates, toast becomes "Reloaded from
      disk", no diff opens. This is the one that did nothing before.
- [ ] After that reload, the toolbar diff toggle still opens the diff (baseline is retained).

### 3. The main untested risk — reveal/widget layer

Needs a document containing a table, a mermaid fence, a callout and a task list.

- [ ] External edit **inside a table** → diff renders without corrupting the table widget;
      the table is still interactive after the diff is dismissed.
- [ ] External edit **inside a mermaid fence** → diagram/code widget survives; deleted-chunk
      widget doesn't land inside the rendered diagram.
- [ ] External edit **inside a callout** and **in a list** → markers and decorations intact.
- [ ] If any of these break: the documented fallback is reconfiguring `revealCompartment` off
      while the diff is on (`livePreviewEditor.ts`). Not implemented — only needed if this
      fails.

### 4. Dirty-buffer safety

- [ ] Type something, then trigger an external change → **Load disk changes** shows the
      "Discard unsaved changes and reload from disk?" confirm, now with buttons **Discard &
      Reload** / **Keep mine, ignore disk** (behavior changed — see §8: clicking the
      button now force-writes, only a click outside the modal is a true no-op).
- [ ] Same with **Review changes** → same confirm, no silent discard.
- [ ] Enable `md.autoShowDiskDiff`, keep the buffer **clean**, trigger a change → diff opens
      by itself.
- [ ] With the setting on and the buffer **dirty** → does NOT auto-apply; falls back to the toast.

### 5. Interactions

- [ ] Turn **Document Stats off** in settings → the `+N −M` badge still shows (its own element).
- [ ] With the diff open, **save** (Cmd+S) → overlay retires and the toggle goes inert.
- [ ] With `md.autoSave` on, typing after an external change clears the comparison — known and
      accepted, confirm it isn't jarring in practice.
- [ ] Open **Version History** while the diff is up → diff retires, diff toggle hidden; cancel
      the preview → editor back to normal, no leftover diff state.
- [ ] **F7** / **Shift+F7** step forward and back through chunks.
- [ ] Reject a chunk then **Cmd+Z** → undo behaves sanely (rejection is a normal doc edit).

### 6. Edge cases

- [ ] Empty file → external write adds content → badge reads `+N −0`, no phantom removal
      (this was the bug found in `diffLineStats`).
- [ ] Large external rewrite (a few thousand changed lines) → editor stays responsive.
- [ ] Delete the file externally → existing "File deleted from disk" behaviour unaffected.
- [ ] Rename/move the file externally → existing move handling unaffected.
- [ ] A toast with a **single** action (e.g. "Reloaded from disk · +N −M" → Review changes)
      still has correct close-button spacing.

### 7. Themes

- [ ] Light, dark, and VS Code theme → chunk button labels, changed-line tints and the badge
      are all readable in each.

### 8. Keep local version (2026-08-24 addendum)

- [ ] External change, **clean** buffer → click **Keep local version** → confirm dialog
      "Overwrite disk with your version?" (Overwrite disk / Cancel) → **Overwrite disk** →
      toast becomes "Saved"; `cat` the file from a second terminal to confirm disk now holds
      the buffer's content, not the external edit.
- [ ] Same dialog, click **Cancel** (or click outside the modal) → toast stays exactly as it
      was (still showing all 3 actions), disk unchanged, no re-prompt loop.
- [ ] External change, **dirty** buffer → click **Load disk changes** → reload-confirm shows
      **Discard & Reload** / **Keep mine, ignore disk** → click **Keep mine, ignore disk** →
      disk now holds the buffer's content (verify via `cat`), toast becomes "Saved", buffer's
      `originalContent` updates (no longer shows dirty).
- [ ] Same dirty-buffer case, click **outside the modal** (backdrop) → true no-op: buffer
      stays dirty exactly as before, disk unchanged, no write happens.
- [ ] Repeat the "Keep mine, ignore disk" check via **Review changes** (dirty buffer) and via
      the toolbar **Reload from disk** button (dirty buffer) — all three entry points into
      `confirmDiscardAndReload` should behave identically.
- [ ] Narrow the editor pane with all 3 toast actions visible → toast wraps correctly, no
      clipped buttons, close-button spacing stays tight.
- [ ] Trigger the single-action "Reloaded from disk" toast (auto-reload path) → close-button
      spacing still correct with only 1 of 3 slots filled (regression check for the new CSS
      bridging rules).

### Results

_Pending — record outcomes here, and bounce the status back to `to-plan` / `to-implement` if
something structural fails._
