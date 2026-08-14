---
title: Detect External File Move
slug: detect-external-file-move
status: to-qa
created: 2026-08-14
updated: 2026-08-14
---

# Detect External File Move

## Idea

When the AI (or another tool) moves a file that's open in the extension, the editor shows "File deleted from disk" even though the file still exists at a new path. Detect when a delete is actually a move/rename and offer to follow the file to its new location instead of treating it as deleted.

## Brainstorm

### Scope

Applies to **all custom editors**: Markdown (`.md`), XLSX, CSV, and TSV. Spreadsheets currently have no delete detection; they gain move detection alongside markdown.

### Detection

Two-layer strategy:

1. **Primary — `vscode.workspace.onDidRenameFiles`:** When the open file's URI appears as `oldUri`, treat it as a move and capture `newUri` directly. Covers Explorer renames and `applyEdit`-based moves (common for AI agents).
2. **Race guard — debounced delete:** `FileSystemWatcher.onDidDelete` does **not** immediately show "File deleted from disk". Wait ~200–300 ms; if a rename event for this file arrives in that window, treat it as a move instead. If the window expires with no rename, show the existing delete toast.

No create-heuristic fallback (no B3) — keeps detection reliable and avoids false positives when many files change at once.

### User-facing behavior on move

Show a **persistent informational toast** (same toast component as disk-sync):

- Copy: *"File moved to `relative/new/path.ext`"*
- Dismiss (×) only — no action button. The editor **auto-follows** the move internally; the toast is informational, not a confirmation gate.
- Brief, non-blocking; parallel in tone to the existing "File deleted from disk" toast.

### What "follow the move" updates (automatic, on detection)

All of the following happen without user action:

1. **Host path + watcher (D1):** Repoint internal `filePath` / `document.uri` and dispose + recreate the `FileSystemWatcher` on the new path.
2. **Webview context (D2):** Push updated `documentUri`, `fileName`, and `documentDirUri` to the webview so relative image paths and display name stay correct.
3. **Version history (D3):** Migrate the version-history storage key from old path → new path.
4. **Per-file storage (D4):** Migrate all URI-keyed extension state (table column widths, frontmatter panel collapsed, mermaid preview mode, callout default type for MD; equivalent per-file keys for spreadsheets if any).

### Fixed outcomes

- **True delete** (no rename within debounce window): existing *"File deleted from disk"* toast and `pendingDiskDeleted` behavior unchanged.
- **After a move:** Save writes to the **new** path.
- **Dismiss move toast:** only closes the toast; internal state is already updated — no stale-path mode.
- **Missed detection** (`workspace.fs` / shell `mv` with no rename event): falls through to the debounced delete toast after the window expires — same degraded experience as today, acceptable given B3 was explicitly excluded.

## Plan

### Overview

Add shared move-detection infrastructure, wire it into both providers, migrate
per-file storage on move, and surface informational toasts in both webviews.
`document.uri` and `filePath` are currently immutable `const` closures — both
become `let` and are reassigned on move. Saves already go through
`document.uri` / `filePath`; after reassignment they target the new path.

**Correction from brainstorm:** `MermaidPreviewModeStorageService` and
`CalloutDefaultTypeStorageService` are **global** preferences (not per-file) —
no migration needed.

### Step 1 — Shared move watcher (`src/shared/fileExternalChangeWatcher.ts`)

Refactor the existing unused helper into the single watcher both providers adopt.

**New options interface:**

```ts
onChange: () => void | Promise<void>
onDelete?: () => void | Promise<void>       // fired after debounce, if no move
onMove?: (newUri: vscode.Uri) => void | Promise<void>
deleteDebounceMs?: number                   // default 250
```

**Behavior:**

1. Subscribe to `vscode.workspace.onDidRenameFiles`. When `oldUri.fsPath`
   (case-insensitive) matches the watched `filePath`, call `onMove(newUri)`,
   cancel any pending delete timer, and recreate the internal watcher on the
   new path (expose a `repoint(newFilePath)` method or return a handle).
2. `FileSystemWatcher.onDidDelete` → start `deleteDebounceMs` timer; if a rename
   for this file arrives before expiry, cancel; otherwise call `onDelete`.
3. Keep existing `onDidChange` / `onDidCreate` + `fs.watch` fallback + 150 ms
   change debounce unchanged.

Export a small helper `urisMatch(a, b)` (case-insensitive `fsPath` compare).

### Step 2 — Storage migration helpers

Add `migrateUri(oldUri, newUri)` to each per-file storage service (copy value to
new key, clear old key):

| Service | File |
|---|---|
| `TableColumnWidthStorageService` | `src/shared/tableColumnWidthStorageService.ts` |
| `FrontmatterPanelStorageService` | `src/shared/frontmatterPanelStorageService.ts` |
| `StyleStorageService` | `src/shared/styleStorageService.ts` — migrate styles key, viewMode key, and update `styleIndex[].path` |

Add to `src/shared/versionHistory.ts`:

```ts
migrateVersionHistory(globalStoragePath, oldPath, newPath, kind, extension?)
```

- MD (`kind: 'md'`): rename `{kind}-{sha1(old)}.json` → `{kind}-{sha1(new)}.json`
- Spreadsheet (`kind: xlsx|csv|tsv`): rename history **directory**
  `{kind}-{sha1(old)}` → `{kind}-{sha1(new)}`
- Use `fs.promises.rename`; if destination exists, skip (don't overwrite)
- No-op if source doesn't exist

Add orchestrator `src/shared/migrateFileUriState.ts`:

```ts
migrateFileUriState(context, oldUri, newUri, opts: { kind, isSpreadsheet })
```

Calls the four migrations above in sequence.

### Step 3 — Message protocol

Add to `.docs/dev/MESSAGE-PROTOCOL.md` (and `.docs/ads/MESSAGE-PROTOCOL.md` if
kept in sync):

| command | direction | payload | purpose |
|---|---|---|---|
| `diskMovedExternally` | host → webview | `fileName`, `documentUri?`, `documentDirUri?` | File moved; auto-follow already done on host |
| `diskDeletedExternally` | host → webview | — | **Spreadsheet only (new)**; MD already has this |

`documentUri` / `documentDirUri` are MD-only (spreadsheet webview has no URI
state today). `fileName` is `vscode.workspace.asRelativePath(newUri)`.

### Step 4 — Markdown provider (`src/mdEditorProvider.ts`)

1. Replace inline watcher (**L552–579**) with `createExternalFileChangeWatcher`.
2. Change `const filePath` → `let filePath`; add `let currentUri = document.uri`.
   Use `currentUri` everywhere `document.uri` was used for I/O.
3. **`handleMove(newUri)`** (called from watcher `onMove`):
   - `const oldUri = currentUri`
   - `currentUri = newUri`; `filePath = newUri.fsPath`
   - `migrateFileUriState(…, oldUri, newUri, { kind: 'md' })`
   - Watcher `repoint(filePath)`
   - `webview.postMessage({ command: 'diskMovedExternally', fileName: asRelativePath(newUri), documentUri: newUri.toString(), documentDirUri: dirname })`
4. **`onDelete`** (debounced): existing `diskDeletedExternally` post unchanged.
5. Update `getHistoryFilePath()` to read `filePath` (already does via closure —
   reassignment is enough).
6. `buildInitMarkdownPayload` / `buildMarkdownLocalResourceRoots`: use `currentUri`.

### Step 5 — Markdown webview (`src/webviews/md/mdWebview.ts`)

Add `case 'diskMovedExternally':`:

- Update `documentUri`, `documentDirUri` from payload
- Clear `pendingDiskDeleted` if set (move cancels a pending delete)
- `showToast('File moved to ' + m.fileName, …, { persistent: true, icon: 'info' })`
- `updateEditToolbarButtons()` (dirty state unchanged)

No new state flag needed — move is not a conflict.

### Step 6 — Spreadsheet provider (`src/spreadsheetEditorProvider.ts`)

1. Replace inline watcher (**L2321–2338**) with `createExternalFileChangeWatcher`
   (add `onDelete` + `onMove` — currently change-only).
2. `const filePath` → `let filePath`; `let currentUri = document.uri`; use
   `currentUri` for all `document.uri` I/O.
3. **`handleMove(newUri)`**: same pattern as MD but
   `migrateFileUriState(…, { kind: currentFileType, isSpreadsheet: true })`,
   watcher repoint, post `diskMovedExternally` with `fileName` only.
4. **`onDelete`** (debounced): post `diskDeletedExternally` (new for spreadsheets).
5. `getHistoryDir()` already closes over `filePath` — reassignment is enough.

### Step 7 — Spreadsheet webview (`src/webviews/spreadsheet/spreadsheetWebview.ts`)

Add message handlers:

- `diskMovedExternally` → `showToast('File moved to ' + m.fileName)` (persistent, info icon)
- `diskDeletedExternally` → `showToast('File deleted from disk', …)` (persistent, warning) — parity with MD

No URI state to update on spreadsheet side.

### Step 8 — Verify

```bash
npm run compile
```

Manual smoke (F5):

| # | Action | Expected |
|---|---|---|
| 1 | Open `samples/*.md`, rename in Explorer | Toast "File moved to …"; save writes new path; image refs still resolve |
| 2 | Open `.md`, delete in Explorer | After ~250 ms, "File deleted from disk" toast |
| 3 | Open `.md`, AI-style rename via `applyEdit` | Move toast, not delete |
| 4 | Repeat 1–2 with `samples/test.xlsx` and a `.csv` | Same toasts; styles/view-mode persist after move |
| 5 | Resize MD table column, move file, reopen | Column widths preserved (storage migrated) |
| 6 | Style a CSV cell, move file, reopen | Styles preserved |

### Files touched (expected)

| File | Change |
|---|---|
| `src/shared/fileExternalChangeWatcher.ts` | Move detection, debounced delete, repoint |
| `src/shared/migrateFileUriState.ts` | **new** orchestrator |
| `src/shared/versionHistory.ts` | `migrateVersionHistory` |
| `src/shared/tableColumnWidthStorageService.ts` | `migrateUri` |
| `src/shared/frontmatterPanelStorageService.ts` | `migrateUri` |
| `src/shared/styleStorageService.ts` | `migrateUri` |
| `src/mdEditorProvider.ts` | Adopt shared watcher, `handleMove` |
| `src/spreadsheetEditorProvider.ts` | Adopt shared watcher, `handleMove` + delete |
| `src/webviews/md/mdWebview.ts` | `diskMovedExternally` handler |
| `src/webviews/spreadsheet/spreadsheetWebview.ts` | `diskMovedExternally` + `diskDeletedExternally` |
| `.docs/dev/MESSAGE-PROTOCOL.md` | New message row |

## Implementation Log

Built per plan. `npm run compile` passes (0 type errors, 0 new lint errors).

**Files changed:**
- `src/shared/fileExternalChangeWatcher.ts` — `onDidRenameFiles`, debounced delete, `repoint()`, `urisMatch()`
- `src/shared/migrateFileUriState.ts` — **new** orchestrator
- `src/shared/versionHistory.ts` — `migrateVersionHistory()`
- `src/shared/tableColumnWidthStorageService.ts` — `migrateUri()`
- `src/shared/frontmatterPanelStorageService.ts` — `migrateUri()`
- `src/shared/styleStorageService.ts` — `migrateUri()` (styles, view mode, index)
- `src/mdEditorProvider.ts` — shared watcher, `handleMove`, mutable `currentUri`/`filePath`
- `src/spreadsheetEditorProvider.ts` — same + new `diskDeletedExternally` for spreadsheets
- `src/webviews/md/mdWebview.ts` — `diskMovedExternally` handler
- `src/webviews/spreadsheet/spreadsheetWebview.ts` — `diskMovedExternally` + `diskDeletedExternally`
- `.docs/dev/MESSAGE-PROTOCOL.md` — new message rows

**Deviations:** Spreadsheet toasts use `Utils.showToast` with 10 s duration (no persistent/close-button toast in spreadsheet webview). Mermaid/callout storage confirmed global — not migrated (per plan correction).

## QA

_Not started._
