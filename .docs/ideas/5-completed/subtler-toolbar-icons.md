---
title: Subtler Toolbar Icons
slug: subtler-toolbar-icons
status: completed
created: 2026-08-15
updated: 2026-08-15
---

# Subtler Toolbar Icons

## Idea

Make the icons in the toolbar a little bit subtler.

## Brainstorm

**Goal:** Toolbar icons should feel quieter at rest without hurting discoverability or
active-state clarity.

**Key finding:** The Markdown formatting bar (`.fmt-btn`) already uses the desired
pattern — `color: var(--text-secondary)` at rest, `var(--text-primary)` on hover.
Main toolbar buttons (`.toggle-button`) still use full `var(--text-color)` always.
This change brings them in line.

### Decided UX

**Scope:** All shared main-toolbar icon buttons — `.toggle-button` in
`resources/shared/theme.css` (covers Markdown + spreadsheet main toolbars, search
overlay nav, theme toggle, settings trigger, etc.). **Out of scope:**
- `.fmt-btn` formatting bar (already muted)
- Spreadsheet edit-strip text buttons (`Merge`, `Borders`, color `A`/`■` labels)
- `.toggle-button-primary` (version-preview actions — intentional emphasis)
- `.toggle-button.active` accent treatment (unchanged)
- Disabled buttons (already `opacity: 0.5` in `mdWebview.css`)

**Default (rest):** `color: var(--text-secondary)` — one step down on the text ladder
(same token the formatting bar uses; alias of `--text-muted`).

**Hover / focus-visible:** `color: var(--text-primary)` so icons brighten on intent.
Background hover (`--hover-bg`) stays as-is.

**Active / toggled:** No change — keep existing `.toggle-button.active` rules
(`--accent-color` + `--accent-bg` border) in `mdWebview.css`.

**Themes:** Must work in light, dark, and VS Code theme modes (tokens already mapped
in `theme.css`).

**No new setting** — purely visual polish, not user-configurable.

**Not doing:** opacity-only dimming (less crisp than token shift), `--text-faint`
(too washed out), or a new `--icon-color` token (unnecessary when the ladder exists).


## Plan

1. In `resources/shared/theme.css`, change `.toggle-button` default `color` from
   `--text-color` to `--text-secondary`.
2. On `.toggle-button:hover` and `:focus-visible`, set `color: --text-primary`
   (match `.fmt-btn` behavior).
3. Add `color` to the existing transition.
4. Leave `.toggle-button.active` rules in `mdWebview.css` untouched.
5. `npm run compile`, then manual smoke in F5 (light/dark/vscode themes).

## Implementation Log

- **`resources/shared/theme.css`** — `--color-toolbar-icon` via `--palette-icon-muted`
  (`#86868b`); `.toggle-button` + `.fmt-btn` at rest; hover/focus → `--color-text-primary`;
  `stroke: currentColor` on toolbar SVGs. Pinned palette primitive so VS Code host
  `--vscode-icon-foreground` (`#3b3b3b`) does not override muted icons.
- **`resources/md/mdWebview.css`** — `.fmt-btn` uses `--color-toolbar-icon`; `:focus-visible`
  hover parity.
- **QA iterations:** bg-mix and primary-mix rejected; host theme tokens too dark in Cursor.

## QA

- [x] `npm run compile` — pass
- [x] F5 smoke: Markdown main + formatting toolbar icons rest at `#86868b`, brighten on hover/focus
- [x] F5 smoke: Spreadsheet main toolbar — same behavior
- [x] F5 smoke: `.toggle-button.active` accent treatment unchanged
- [x] F5 smoke: VS Code theme mode (Cursor) — confirmed fixed after `--palette-icon-muted`
- **Passed** 2026-08-15 (user sign-off).
