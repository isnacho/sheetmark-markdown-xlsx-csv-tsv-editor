---
title: Context menu placement for discoverability
slug: context-menu-placement
status: completed
created: 2026-08-12
updated: 2026-08-13
---

# Context menu placement for discoverability

## Idea

Make the plugin more accessible in Cursor by improving where its context-menu entries appear.

**Explorer / file viewer right-click:** The extension's "Open with …" entry currently appears at the very top of the context menu when right-clicking a Markdown file. It should appear *below* the built-in default options (Open Preview, Open to the Side, Open in Browser, etc.) but *above* "Open Integrated Terminal". It will compete with other extensions (e.g. Mark Chart) that also contribute here — we want to appear first among extension entries, but never above VS Code's own defaults. If that slot can't be guaranteed, falling back to the very top of the whole list is acceptable.

**Editor "More Actions" (⋯ menu):** When previewing a file in the middle editor panel, there is a three-dot "More Actions" overflow menu (same surface where Claude Code and Mark Chart already show options). The extension should appear there too.

## Brainstorm

**Decided UX direction:**

- **Approach:** keep all four "Open with …" entries in the `navigation` group but raise their sort order to `navigation@100` so they land after VS Code's built-in navigation items (Open, Open to the Side, Open Preview, etc., which use lower `@` values like `@10`/`@20`/`@40`).
- **Surfaces:** `explorer/context` and `editor/title/context` only — same two surfaces as today, placement change only.
- **Scope:** all four file types (`.md`, `.xlsx`, `.csv`, `.tsv`) keep their existing per-type `when` clauses and `displayName` labels; no new commands or handlers.
- **Competing extensions:** among items sharing the `navigation` group, lower `@` wins. Built-ins stay below us; other extensions at `navigation@0` (e.g. Mark Chart) sort above `@100` — accept this trade-off. If `@100` doesn't land in the right spot in practice (known VS Code quirk: ordering can differ slightly by file vs. folder context), tune the number during QA rather than switching group strategy.
- **Hide when already open:** no change — entries only appear when right-clicking a file from Explorer or its editor tab, not when already viewing in our custom editor (existing behavior via context, not menu `when`).

**Explicitly out of scope (dropped):**

- Editor title **⋯ More Actions** overflow (`editor/title`) — not pursuing in this idea.
- Dedicated `1_openwith` group, submenu, title-prefix hacks, and `editor/context` in-document right-click.
- Fallback to top-of-list (`navigation@0`) unless QA proves `@100` is unusable — then revisit in a follow-up, not as part of this change.

## Plan

1. **`package.json`** — change `"group": "navigation"` → `"group": "navigation@100"` on all eight `openWith*` entries in `explorer/context` and `editor/title/context`. Leave `editor/title` (`goBackTo*`) entries unchanged.

## Implementation Log

- **`package.json`** — updated group to `navigation@100` on all eight `openWith*` menu contributions (`explorer/context` + `editor/title/context`, four file types each). No code or command changes.
- **QA bounce-back:** More Actions (⋯) in preview window missing — added four `openWith*` entries to `editor/title` in group `3_open@100` (overflow menu). When clauses use `activeCustomEditorId != 'xlsxViewer.*'` (hides only when already in our custom editor); markdown also accepts `resourceLangId == markdown` for built-in preview.
- `npm run compile` passes (0 type + 0 lint errors).

## QA

**Build:** `npm run compile` — pass (0 type + 0 lint errors, 2026-08-13).

**Static verification (manifest):**

| Check | Result |
|---|---|
| Explorer + tab context menus use `navigation@100` on all eight `openWith*` entries | Pass |
| More Actions overflow (`editor/title`) has four `openWith*` entries in `3_open@100` | Pass |
| `goBackTo*` entries unchanged (not regressed) | Pass |
| Per-type `when` clauses preserved | Pass |

**Manual F5 spot-check recommended:** right-click `samples/test.md` in Explorer — "Open with …" appears below built-in Open/Preview entries; open built-in Markdown preview and confirm More Actions (⋯) shows the extension entry.
