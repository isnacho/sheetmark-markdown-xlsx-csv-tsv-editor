---
title: Default Markdown Open & Editor Title Icon
slug: default-markdown-open-and-title-icon
status: to-qa
created: 2026-08-14
updated: 2026-08-14
---

# Default Markdown Open & Editor Title Icon

## Idea

I want to have a setting that opens Sheetmark by default when opening a markdown file, so I don't have to right-click on the context menu to open it that way. I also see that some extensions have a little icon within the editor window at the top right, next to more actions that will open the extension too. Can we look into adding that? I think it's a nice way for non-technical people to discover Sheetmark.

## Brainstorm

**Codebase context (investigation):**

- Markdown already contributes an `editor/title` icon via `xlsx-viewer.goBackToMdPreview` (`resources/md/logo.svg`, `navigation` group). User may not see it because built-in Markdown Preview uses different when-clause keys (`editorLangId` vs `resourceLangId`), `activeEditor` may not match custom-editor contexts (`activeCustomEditorId` is more reliable), and the green-filled SVG may have poor contrast on some themes.
- Default-open **machinery already exists** for all four types: `xlsx-viewer.toggleAssociation` supports `{ type: 'md' }` and writes `workbench.editorAssociations`. Spreadsheets expose this via an in-editor ⚡ toolbar button + `isDefaultEditor` in settings payloads; **Markdown has neither** — no `xlsxViewer.md.*` default setting and no toolbar/settings-panel toggle.
- `customEditors[].priority` for `.md` is `"option"` (correct — VS Code won't override the built-in editor until an association is set).

**Decided UX direction (user picks: per-type settings in VS Code + in-editor panels; C1 only for title icon):**

- **Default open — VS Code settings (four independent toggles):** add `xlsxViewer.md.openByDefault`, `xlsxViewer.xlsx.openByDefault`, `xlsxViewer.csv.openByDefault`, and `xlsxViewer.tsv.openByDefault` (each boolean, **default `false`**). Markdown and each spreadsheet type are configured separately — turning on `.md` does not affect `.xlsx`/`.csv`/`.tsv`. Each setting writes the matching `workbench.editorAssociations` entry via the existing `toggleAssociation` command. Turning off removes that type's association only (confirmation + reopen prompt when disabling from in-editor). On extension activation, reconcile each setting against current associations (apply if setting is `true` but association missing).
- **Default open — in-editor settings panels:** each editor gets its own toggle in its existing settings panel (not a shared/global UI):
  - **Markdown settings panel:** “Open `.md` files with Sheetmark by default” → syncs `xlsxViewer.md.openByDefault`.
  - **Spreadsheet settings panel:** “Open `.{xlsx|csv|tsv}` files with Sheetmark by default” (label reflects **current file type**) → syncs the matching `xlsxViewer.{xlsx|csv|tsv}.openByDefault`.
  - Keep the existing ⚡ toolbar shortcut on both editors (hidden when already default); settings-panel toggle and VS Code setting stay in sync via the host.
- **Editor title icon (C1 only):** fix the visible title-bar icon (`goBackTo*` in `navigation` group) for all four types — update when-clauses to use `activeCustomEditorId != 'xlsxViewer.*'`; markdown also accepts `editorLangId == markdown`. Use a theme-aware icon so the button is visibly clickable. **Do not** add `openWith*` entries to the ⋯ More Actions overflow (`3_open@100`).
- **Scope:** default-open UX for all four types; title-icon fix for all four. No first-run modal, no change to viewType IDs, no default-on without explicit opt-in.
- **Edge cases:** disabling default for one type does not affect others. Setting applies globally (`ConfigurationTarget.Global`). Icon hidden when already viewing in Sheetmark for that type.

## Plan

1. **`src/shared/editorAssociationUtils.ts`** (new) — extract `isSheetmarkDefaultEditor(associations, type: 'xlsx'|'csv'|'tsv'|'md')` and a small `syncOpenByDefaultSetting(type, enabled)` helper that reads/writes both the `xlsxViewer.{type}.openByDefault` config key and `workbench.editorAssociations` (skip no-op updates to avoid duplicate toasts).

2. **`package.json`**
   - Add four settings: `xlsxViewer.md.openByDefault`, `xlsxViewer.xlsx.openByDefault`, `xlsxViewer.csv.openByDefault`, `xlsxViewer.tsv.openByDefault` (boolean, default `false`; descriptions name the file extension).
   - Fix all four `editor/title` `goBackTo*` when-clauses: `activeCustomEditorId != 'xlsxViewer.*'`; markdown adds `editorLangId == markdown`.
   - Improve command icons if needed (theme-aware light/dark paths or codicon) for visible title-bar buttons.
   - **No** `3_open@100` overflow menu entries.

3. **`src/extension.ts`**
   - On `activate`, reconcile all four `openByDefault` settings against associations.
   - `onDidChangeConfiguration`: when any `xlsxViewer.*.openByDefault` changes, call shared sync helper for that type.

4. **`src/spreadsheetEditorProvider.ts`**
   - Replace inline association check with shared util.
   - On `enableAsDefault` / `disableDefaultEditor` messages: use **current file type** (`xlsx`|`csv`|`tsv`) for `toggleAssociation` and update the matching `xlsxViewer.{type}.openByDefault` config to stay in sync.
   - Include per-type `isDefaultEditor` in settings payloads (already partially there — ensure it reflects the **current** file type's association, not a global flag).

5. **`src/mdEditorProvider.ts`**
   - Include `isDefaultEditor` in `initSettings` / `settingsUpdated` (md association only).
   - Handle `enableAsDefault` / `disableDefaultEditor` → sync md association + `xlsxViewer.md.openByDefault`.
   - React to `workbench.editorAssociations` and `xlsxViewer.md.openByDefault` config changes → push updated settings to webview.

6. **`src/webviews/spreadsheet/components/spreadsheetSettingsComponent.ts`** + **`spreadsheetWebview.ts`**
   - Add **“Open by default”** toggle to spreadsheet settings definitions; label/tooltip names the current extension (`.xlsx`, `.csv`, or `.tsv`).
   - On toggle: post `enableAsDefault` or `disableDefaultEditor` (existing messages); sync checkbox from `isDefaultEditor` in settings payload.

7. **`src/webviews/md/mdWebview.ts`**
   - Add `isDefaultEditor` to settings state.
   - Add ⚡ toolbar button (spreadsheet parity) + **“Open by default”** toggle in markdown settings panel.
   - Show/hide ⚡ based on `isDefaultEditor`.

8. **Message protocol** — reuse existing `enableAsDefault` / `disableDefaultEditor`; wire md provider; document md path in `.docs/dev/MESSAGE-PROTOCOL.md` if missing.

9. **Verify** — `npm run compile`. Manual F5: toggle each type independently in VS Code settings and in-editor settings panel; confirm `.md` default does not affect `.xlsx`; confirm title-bar Sheetmark icon visible when viewing built-in text editor for each type.

## Implementation Log

- **`src/shared/editorAssociationUtils.ts`** (new) — shared read/write for `workbench.editorAssociations` and `xlsxViewer.{type}.openByDefault` sync.
- **`package.json`** — four `openByDefault` settings; fixed `editor/title` when-clauses (`activeCustomEditorId`, `editorLangId`); theme-aware codicons for title-bar commands.
- **`src/extension.ts`** — activation reconcile + config listener; `toggleAssociation` delegates to shared util.
- **`src/spreadsheetEditorProvider.ts`** — uses shared util; enable/disable updates both association and setting.
- **`src/mdEditorProvider.ts`** — `isDefaultEditor` in settings payloads; `enableAsDefault` / `disableDefaultEditor` handlers.
- **`src/webviews/spreadsheet/components/spreadsheetSettingsComponent.ts`** + **`spreadsheetWebview.ts`** — “Open by default” toggle per current file type.
- **`src/webviews/md/mdWebview.ts`** — ⚡ toolbar button + settings-panel toggle.
- **`.docs/dev/MESSAGE-PROTOCOL.md`** — documented md default-editor messages.
- `npm run compile` passes (0 type + 0 lint errors).

**QA bounce-back (title icon not visible):** Broadened markdown `when` clause to cover text editor (`workbench.editors.files.textFileEditor` + `resourceLangId`), built-in preview (`vscode.markdown.preview.editor`, `markdown.preview` webview), and extension-based fallbacks. Added `3_open@100` overflow entries (⋯ menu). Switched md icon to theme-aware `logo-title.svg` (`currentColor`). Note: icon is intentionally hidden when already in Sheetmark — with default-open enabled, user must reopen with built-in editor to see it.

**Root cause found (not a code bug):** the icon was registered correctly all along. Cursor 2.1 changed the default UI behavior for *every* extension's `editor/title` icon — they now collapse into the "⋯" (More Actions) overflow by default, and the user must open "⋯" → **Configure Icon Visibility** and check the box once to pin an icon into the visible title bar. Confirmed by the Cursor team on their forum as an intentional change ("Editor Title menu entries have been compressed into the show more menu"), not a bug — see [forum.cursor.com/t/editor-actions-icon-disappear/143854](https://forum.cursor.com/t/editor-actions-icon-disappear/143854). In stock VS Code this step isn't needed; the icon shows directly. There is no package.json/when-clause workaround for Cursor's default — it applies to all extensions equally.

**Cleanup done:** removed the invented/undocumented `modalEditor/editorTitle` menu contribution (not a real VS Code contribution point — dead code). Removed the `3_open@100` `openWith*` overflow entries added during the bounce-back, restoring the originally decided direction (no overflow entries for these commands). De-duplicated the two `goBackToMdPreview` entries (`navigation@1` + `1_run@1`) down to the single `navigation@1` entry. `editor/title` now has exactly one clean entry per file type, all in the `navigation` group.

## QA

Manual: in stock VS Code, F5 → open each sample type with the built-in editor → confirm the Sheetmark icon shows directly in the title bar (no extra step). In Cursor, confirm it appears after pinning via "⋯" → "Configure Icon Visibility" (one-time per workspace/user) — this is expected Cursor behavior, not something the extension can bypass.
