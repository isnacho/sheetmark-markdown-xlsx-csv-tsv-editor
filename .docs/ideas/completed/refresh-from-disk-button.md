---
title: Refresh from disk button in Preview Edit
slug: refresh-from-disk-button
status: completed
created: 2026-07-20
updated: 2026-07-20
---

# Refresh from disk button in Preview Edit

## Idea

Add a refresh button next to the Save button in Preview Edit. It refreshes the file from
disk. Motivation: sometimes the AI makes a change to the file on disk, and the editor
doesn't pick it up automatically, so it needs a manual way to reload. Open question: can
the system detect that the file on disk has changed from what's currently loaded in the
editor? Need to work out the use cases — AI updated disk but editor doesn't have it yet;
editor has unsaved changes disk doesn't have (so AI doesn't see them either); and what
happens in the corner cases where both sides have diverged.

## Brainstorm

**Groundwork already exists, and it's the wrong shape.** A `FileSystemWatcher` on the
file already fires on every disk change and pushes fresh content to the webview
(`mdEditorProvider.ts` around the `initMarkdown` push, guarded only by an `isSaving`
flag). But the webview's `initMarkdown` handler only re-renders the read-only preview
DOM — it never touches the Preview Edit / live-preview (CM6) buffer. That's why edits
made on disk (e.g. by an AI tool) don't show up while you're actively editing: plain
read-only Preview already auto-refreshes fine; Preview Edit mode silently doesn't.
There is also currently no dirty-check anywhere — the watcher will happily overwrite
`currentContent`/`originalContent` mid-edit once the CM6 buffer is wired up to it,
unless we add a guard (see below).

**Decided direction:**

- A **manual refresh button** ("Reload from disk") sits next to Save/Cancel in the
  toolbar, visible only in Preview Edit / edit mode (not in plain read-only Preview,
  which doesn't need it).
- **Clean buffer** (no unsaved edits) + click → reload silently from disk into the
  editor buffer, no confirmation. Toast: "Reloaded from disk".
- **Dirty buffer** (unsaved edits) + click → confirm dialog: "Discard unsaved changes
  and reload from disk?" Confirm → discard + reload (same toast as above). Cancel →
  no-op, buffer untouched. This single dirty/clean split covers both "editor has
  changes disk doesn't" and "both sides diverged" — they look identical from the UI's
  perspective, since either way refreshing risks discarding local work.
- **Dirty-guard fix folded into this idea's scope**: the existing watcher-triggered
  auto-refresh must respect the same dirty check once the CM6 buffer is wired up to it.
    - Clean buffer + external disk change detected → auto-refresh as today, but now
      correctly reaching the CM6 buffer too. Toast: "Reloaded from disk" (low-emphasis,
      matches existing `showToast` pattern).
    - Dirty buffer + external disk change detected → do **not** auto-overwrite. Show a
      toast: "File changed on disk" with an action button that routes into the same
      manual-refresh confirm flow above (since the buffer is dirty, it's still a
      discard-confirmation, not a silent reload).
- No auto-snapshotting to Version History on discard — kept out of scope for v1
  (simple confirm dialog is enough; revisit later if discarded work turns out to be a
  real pain point).

**States to design against in Plan:**

| Buffer state | Trigger | Result |
|---|---|---|
| Clean | Manual click | Silent reload, toast "Reloaded from disk" |
| Dirty | Manual click | Confirm dialog → confirm: discard + reload + toast; cancel: no-op |
| Clean | Watcher fires (disk changed externally) | Silent auto-reload, toast "Reloaded from disk" |
| Dirty | Watcher fires (disk changed externally) | No auto-overwrite; toast "File changed on disk" + action button → same confirm-discard flow |

## Plan

Full plan: `/Users/UALLEIG/.claude/plans/sleepy-scribbling-alpaca.md`.

**Root cause found during investigation:** a `FileSystemWatcher` in `mdEditorProvider.ts`
already detects disk changes and pushes fresh content via `initMarkdown`, but the webview's
`initMarkdown` handler only re-renders the read-only preview DOM — it never syncs the CM6
live-preview editor buffer, and has no dirty-check. That's why edits land on disk but don't
show up while actively editing.

**Scope decision:** of the 6 places that push `initMarkdown`, only `requestFreshData`'s
response and the watcher push can fire mid-edit. Only those two move to a new command
(`diskChangedExternally`); `initMarkdown` and its handler stay untouched (minimal diff).

**Host — `src/mdEditorProvider.ts`:**
- `requestFreshData` handler: post `diskChangedExternally` (not `initMarkdown`), drop the
  native `showInformationMessage`, add a `reloadFromDiskError` response on read failure.
- `FileSystemWatcher.onDidChange`: same command-field change, `isSaving` guard unchanged.

**Webview — `src/webviews/md/mdWebview.ts`:**
- New toolbar button `reloadFromDiskButton` (icon `Icons.Refresh`), placed before
  `saveEditsButton`; visibility wired into `setEditMode()`/`setPreviewEditMode()` the same
  way Save/Cancel are.
- New module state: `pendingDiskContent`, `isReloadingFromDisk`; add `reloadFromDiskButton`
  to `setButtonsEnabled()`'s id array (prevents Save/Reload races).
- New `applyReloadedContent(text)` helper — branches on CM6 / legacy Preview Edit / Split /
  read-only, since `isPreviewEditMode` implies `isEditMode` (order matters). CM6 branch uses
  `setLivePreviewContent()` (its first real call site in the codebase — test deliberately).
  Legacy branch re-runs `enhancePreviewTablesForEditing()`/`initializePreviewHistory()`.
- New `requestReloadFromDisk()` — dirty check via `getActiveEditorContent()` vs
  `originalContent`; confirms via `window.confirm()` before discarding.
- New message cases `diskChangedExternally` (dirty → toast with action, routes through the
  same confirm flow; clean → silent `applyReloadedContent` + toast) and `reloadFromDiskError`.
- `showToast()` extended to accept an optional `{label, onClick}` action, with a proper
  clear/reset of its dismiss timer (fixes a latent un-cleared-timer bug).

**CSS — `resources/md/mdWebview.css`:** `.toast-action` button style (`pointer-events: auto`
override on the child only).

**Docs — `.docs/MESSAGE-PROTOCOL.md`:** add `diskChangedExternally` and
`reloadFromDiskError` rows to the Markdown host→webview table.

## Implementation Log

Built exactly per plan, no deviations.

- `src/mdEditorProvider.ts` — `requestFreshData` handler and the `FileSystemWatcher.onDidChange`
  handler now post `diskChangedExternally` (was `initMarkdown`); dropped the native
  `showInformationMessage`; added a `reloadFromDiskError` response on read failure.
- `src/webviews/md/mdWebview.ts` — new `reloadFromDiskButton` toolbar entry (before Save),
  visibility wired into `setEditMode()`/`setPreviewEditMode()`; new state
  `isReloadingFromDisk`/`pendingDiskContent`; `reloadFromDiskButton` added to
  `setButtonsEnabled()`'s id array; new `applyReloadedContent()` helper (CM6 / legacy Preview
  Edit / Split / read-only branches) and `requestReloadFromDisk()`; new `diskChangedExternally`
  / `reloadFromDiskError` message cases; `showToast()` extended with an optional action button
  and a proper dismiss-timer reset; added `setLivePreviewContent` to the livePreview import list
  (previously unused in this file).
- `resources/md/mdWebview.css` — `.toast-action` / `.toast-action.hidden` styles.
- `.docs/MESSAGE-PROTOCOL.md` — added `diskChangedExternally` and `reloadFromDiskError` rows to
  the Markdown host→webview table.
- `npm run compile` — 0 type errors, 0 lint errors, bundle built clean.

**Bounce-back from QA (2026-07-20):** user reported the reload button "did not work when
the disk file has changes" — i.e. the dirty-buffer/discard-confirm path. Root cause:
`window.confirm()` is silently blocked in VS Code webviews (sandboxed iframe, no
`allow-modals` — confirmed via search of VS Code's own issue tracker). `!window.confirm(...)`
always evaluated to a no-op cancel, so the discard-and-reload path never proceeded whenever
the buffer was dirty. Fixed by adding `confirmDiscardAndReload()` — an in-webview modal
reusing the existing `.feedback-overlay`/`.feedback-modal` shared CSS (the same pattern
`ProjectsModal`/`FeedbackModal` use, no new CSS needed) — and swapping out both
`window.confirm()` call sites (`requestReloadFromDisk()` and the "File changed on disk"
toast action) for it. `requestReloadFromDisk()` is now `async`. `npm run compile` re-run
clean after the fix.

Note: `src/webviews/md/livePreview/formatCommands.ts`'s `runJumpToLine()` also calls
`window.prompt()` (pre-existing, unrelated to this idea) — likely hits the same sandboxing
restriction. Flagging for a separate fix, out of scope here.

## QA

Initial smoke test surfaced a bug: the discard-confirmation dialog (dirty-buffer path, both
the manual button and the "File changed on disk" toast action) silently did nothing —
`window.confirm()` is blocked in VS Code's sandboxed webviews. Fixed with an in-webview modal
(`confirmDiscardAndReload()`, see Implementation Log); `npm run compile` clean after the fix.
User retested and confirmed working — marked complete.
