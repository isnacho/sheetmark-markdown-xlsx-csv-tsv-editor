---
title: Right-click "Open with" context menu entry
slug: context-menu-open-with
status: completed
created: 2026-07-21
updated: 2026-08-10
---

# Right-click "Open with" context menu entry

## Idea

When right-clicking a Markdown document, this plugin should appear as one of the options in the first section of the context menu — the same way the Marksharp extension already shows up there.

## Brainstorm

**Decided UX direction:**

- **Where:** entry appears in both the Explorer sidebar right-click menu (on the file) and the editor tab right-click menu — full parity, not just one surface.
- **Scope:** all four supported types get their own entry, not just `.md` — `.xlsx`, `.csv`, `.tsv`, `.md`. Each file type shows only its own matching entry (e.g. right-clicking a `.csv` shows "Open with CSV Viewer & Editor", not the others).
- **Label:** reuse each type's existing `customEditors[].displayName` verbatim (e.g. "Markdown Viewer & Editor", "CSV Viewer & Editor") so the label is consistent with what already shows in the native "Open With…" picker.
- **Position:** first/top section of the menu (`navigation` group), next to "Open" / "Open to the Side" — same placement pattern as the reference extension (Marksharp) that prompted this idea.
- **Click behavior:** closes whatever editor is currently showing the file and reopens it with this extension's custom editor for that type — same behavior as the existing `xlsx-viewer.goBackToMdPreview`/`goBackToTableView`/`goBackToXlsxView` commands when given a `uri`. Not a side-by-side second tab.
- **Multi-select edge case:** if multiple files are selected in the Explorer and the user right-clicks, the action applies only to the single file that was clicked (VS Code's primary URI arg), not to the whole selection.

**Rejected/not pursued:** in-editor (right-click inside document body) placement — out of scope, sidebar + tab context menus cover the ask.

## Plan

1. **`package.json`** — add four commands whose `title` matches each `customEditors[].displayName`; contribute them to `explorer/context` and `editor/title/context` in the `navigation` group with per-extension `when` clauses (`resourceExtname == '.xlsx'` etc.).
2. **`src/extension.ts`** — add `reopenWithCustomEditor(uri, viewType)` helper that closes only tabs for the target URI (not the active editor), then calls `vscode.openWith`; register the four new commands; refactor existing `goBackTo*` handlers to use the helper when a `uri` arg is supplied (explorer/tab context menus pass it automatically).

## Implementation Log

- **`package.json`** — added `xlsx-viewer.openWith{Xlsx,Csv,Tsv,Md}` commands with displayName titles; menu entries in `explorer/context` and `editor/title/context`.
- **`src/extension.ts`** — added `getTabUri`, `closeEditorsForUri`, `reopenWithCustomEditor`; registered four open-with commands; updated `goBackTo*` uri-path to use `reopenWithCustomEditor` so explorer context menu doesn't close unrelated active editors.
- `npm run compile` passes (0 type + 0 lint errors).

## QA

**Build:** `npm run compile` — pass (0 type + 0 lint errors).

**Static verification (code + manifest):**

| Check | Result |
|---|---|
| Explorer context menu — four file types, `navigation` group | Pass — `explorer/context` entries with per-ext `when` clauses |
| Tab context menu — same four entries | Pass — `editor/title/context` mirrors explorer |
| Labels match `customEditors[].displayName` | Pass — titles identical in `commands` and `displayName` |
| Per-type scoping (only matching entry shown) | Pass — separate command + `when` per extension |
| Click closes target file's tab(s), reopens custom editor | Pass — `reopenWithCustomEditor` closes matching tabs only, then `vscode.openWith` |
| Multi-select uses primary URI only | Pass — VS Code passes single `uri` arg; handler uses it directly |
| Unrelated active editor not closed | Pass — `closeEditorsForUri` scoped to target URI, not `closeActiveEditor` |

**Manual F5 spot-check recommended:** press F5 → right-click `samples/test.md` in Explorer and on its tab → confirm "Markdown Viewer & Editor" appears in the top menu section and opens the custom editor. Repeat for `.csv`/`.xlsx`/`.tsv` samples if desired.
