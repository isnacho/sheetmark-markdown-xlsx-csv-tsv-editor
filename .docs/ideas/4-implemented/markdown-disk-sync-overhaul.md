---
title: Markdown disk sync overhaul (reload, save conflicts, autosave)
slug: markdown-disk-sync-overhaul
status: brainstormed
created: 2026-07-22
updated: 2026-08-12
---

# Auto-reload on disk change

## Idea

We've already worked on how to reload information from the disk when the AI changes something so that the preview edit mode updates by clicking on the reload button. What I want now is, I wonder if we can add functionality that, if there are no changes in the documents (so if I haven't made any changes to the doc that are unsaved), then if the document in the disk changes, the document in the preview edit should change automatically. Maybe with a little toast at the bottom of the page saying it has changed and it has been updated.

I think that we should use a sem toast for when there is something that has been changed in the document by the user, and then the document in the disk changes. That toast should appear and should say, "The disk document has changed. Do you want to reload?" or something like that.

## Brainstorm

**Note:** research during brainstorming found that auto-reload-on-clean-disk-change and
a "reload?" prompt-on-dirty already exist in the codebase (`mdEditorProvider.ts` file
watcher + `mdWebview.ts` `diskChangedExternally` handler). This brainstorm refines/unifies
that existing behavior rather than designing it from scratch.

### Decided direction

One unified rule across save/reload, instead of ad-hoc per-button logic: **no
disk↔editor sync ever happens silently** when it could lose something, and any
disk-changed notification is a persistent, user-driven toast rather than a
timed one.

- **External disk change (file-system watcher):** always show a persistent
  bottom toast — *"File changed on disk"* with a **Reload** action and an
  explicit **×** dismiss button. It never auto-dismisses on a timer, and
  nothing is applied without a click.
  - Click **Reload** while there are unsaved local edits → discard-confirmation
    modal ("Discard unsaved changes and reload from disk?") appears first;
    confirming applies the disk content, cancelling returns to the toast.
  - Click **Reload** while clean (no unsaved edits) → applies immediately, no
    modal (nothing to lose).
  - Click **×** → toast closes, nothing is applied. The fact that disk has
    diverged is still remembered for the Save check below (dismissing the
    toast does not waive it).
  - If disk changes again while the toast is already showing and un-acted-on →
    silently update the pending content behind the toast; the toast itself
    doesn't change, so Reload always applies whatever is latest when clicked.
- **Manual reload button:** stays a direct, explicit action — it does **not**
  route through the toast. Clicking it goes straight to the discard-confirm
  modal if dirty, or applies immediately if clean. (Matches existing
  `reloadFromDiskButton` behavior already; no change needed there.)
- **Manual save:** if disk hasn't changed since the editor's last known
  baseline, Save just writes, no prompt (common case). If disk *has* changed
  externally since that baseline — i.e. saving now would silently clobber an
  external edit — show an overwrite-conflict confirmation before writing. This
  check is independent of whether the external-change toast was shown or
  dismissed.
- Short, non-actionable acknowledgement toasts ("Saved", "Reloaded from disk"
  after a successful apply) keep their existing brief auto-dismiss timer —
  only the *actionable* "file changed on disk" toast becomes
  persistent-until-dismissed.

### Flow

```mermaid
flowchart TD
    subgraph AB["External disk change (file watcher)"]
        A1[Disk change detected] --> A2["Persistent toast:<br/>'File changed on disk' — Reload / x"]
        A2 -->|"disk changes again<br/>before user acts"| A2n[Silently update pending<br/>content behind the toast]
        A2n --> A2
        A2 -->|"click x"| A3["Toast closes, no apply.<br/>Divergence still remembered for Save check"]
        A2 -->|"click Reload"| A4{Unsaved local edits?}
        A4 -->|No| A5[Apply disk content immediately]
        A4 -->|Yes| A7["Discard-confirm modal:<br/>'Discard unsaved changes and reload?'"]
        A7 -->|Cancel| A2
        A7 -->|Confirm| A5
        A5 --> A6["Brief 'Reloaded from disk' toast<br/>(auto-dismiss, as today)"]
    end

    subgraph C["Manual reload button (direct action, skips toast)"]
        C1[User clicks reload button] --> C2{Unsaved local edits?}
        C2 -->|No| C3[Apply disk content immediately]
        C2 -->|Yes| C4["Discard-confirm modal:<br/>'Discard unsaved changes and reload?'"]
        C4 -->|Cancel| C5[No change]
        C4 -->|Confirm| C3
        C3 --> C6["Brief 'Reloaded from disk' toast"]
    end

    subgraph D["Manual save (Cmd+S / Save button)"]
        D1[User saves] --> D2{Disk changed since<br/>editor's last known baseline?}
        D2 -->|No| D3[Write to disk]
        D2 -->|Yes| D5["Overwrite-conflict confirmation:<br/>'File changed on disk since you<br/>opened it — overwrite anyway?'"]
        D5 -->|Cancel| D6[Save aborted, local edits kept]
        D5 -->|Confirm| D3
        D3 --> D4["Brief 'Saved' toast"]
    end
```

### Additional scope: autosave, file deletion, race hardening

All three confirmed in scope for this idea.

**Autosave for Markdown** (doesn't exist today):

- New setting `xlsxViewer.markdown.autoSave` (boolean), default **`false`** —
  mirrors XLSX's cautious opt-in default (prose documents, like structured
  XLSX data, warrant an explicit opt-in) rather than CSV/TSV's default-on.
- When enabled, saves fire after a short debounce following the last edit
  (same "short debounce" language as the existing CSV/TSV setting
  descriptions).
- Autosave defers while there's an unresolved external-disk-conflict (the
  persistent "file changed on disk" toast is still showing) — it never fires
  an automatic overwrite over an unresolved conflict. It resumes once the
  user reloads or manually confirms the overwrite via the Save conflict
  dialog.

**File deleted externally** (watcher today only listens for `onDidChange`):

- Watcher also listens for `onDidDelete`.
- Shows a persistent toast — *"File deleted from disk"* — informational
  only, dismiss (×) only, no Reload action (nothing to reload). The user's
  content stays safe in the editor.
- A later Save just recreates the file at that path; this is **not** treated
  as an overwrite conflict (there's no content on disk to lose).
- Edge case for Plan to verify: if the file reappears later with different
  content, does the watcher's `onDidChange` still fire on recreation, so the
  normal A/B flow picks it up?

**Save/watcher race hardening:**

- Adopt the same guard the spreadsheet watcher already uses: skip the
  watcher's `onDidChange` handler if `isSaving` is true **or** less than
  ~1s has passed since our own last save (time-based `lastSaveTime` check),
  not just the `isSaving` flag alone.

```mermaid
flowchart TD
    subgraph E["File deleted externally"]
        E1[Delete detected] --> E2["Persistent toast:<br/>'File deleted from disk' — x only"]
        E2 -->|"click x"| E3[Toast closes. Content stays in editor.]
        E1 -.-> E4["Later Save recreates the file<br/>(no overwrite-conflict prompt)"]
    end
```

## Plan

_Not started._

## Implementation Log

_Not started._

## QA

_Not started._
