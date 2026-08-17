---
title: Semantic Color Tokens
slug: semantic-color-tokens
status: completed
created: 2026-08-15
updated: 2026-08-15
---

# Semantic Color Tokens

## Idea

Review the design system colors and make them semantic — a two-layer token system
(primitives + semantic roles) instead of ad-hoc names like `--accent-color` and
`--bg-color` scattered across the codebase.

## Brainstorm

**Goal:** One source of truth in `resources/shared/theme.css` with clear roles
consumers can rely on across light, dark, and VS Code theme modes.

### Decided direction

| Label | Decision |
|---|---|
| **Pick one** | **Two layers only** — Layer 1 primitives (`--palette-*`) and Layer 2 semantic (`--color-*`). No layer-3 component aliases or deprecation shims. |
| **Pick one** | **Merge brand and action on blue** — single `--color-action` family for buttons, links, selection, focus, and progress. Green reserved for success status only. |
| **Fixed** | All consumers migrate to semantic tokens; old names removed in the same pass. |
| **Fixed** | Shadows stay as `--shadow-*` (elevation, not palette). Layout/typography tokens (`--font-*`, `--surface-radius`, `--header-height`) unchanged. |

### Semantic token map (summary)

- **Text:** `--color-text-primary` / `-secondary` / `-tertiary` / `-on-action` / `-link` / `-code`
- **Surfaces:** `--color-surface-default` / `-raised` / `-sunken` / `-panel` / `-overlay` / `-glass*`
- **Borders:** `--color-border-default` / `-subtle`
- **Action:** `--color-action` / `-hover` / `-subtle`
- **Selection:** `--color-selection-border` / `-bg`
- **Interactive:** `--color-interactive-hover` / `-active` / `-row-hover`
- **Focus:** `--color-focus-ring` / `-outline`
- **Status:** `--color-status-{success,warning,error,info}` + `-subtle` variants
- **Domain:** tooltip, toast, scrollbar, spinner, resize, copy-flash, progress, inverted surfaces

**Not doing:** `highlight.css` GitHub syntax theme rewrite; spreadsheet find-match hardcoded yellows (`#ffd54f`) — separate follow-up if desired.

## Plan

1. Restructure `resources/shared/theme.css` — primitives + semantic tokens in `:root`, `body.dark-mode`, and `body.vscode-theme`.
2. Unify accent (was green in standalone themes) onto blue action tokens.
3. Bulk-migrate all CSS/TS consumers to `--color-*` names; remove old tokens.
4. Remove duplicate MD-only scrollbar overrides; VS Code mode maps scrollbars to `--vscode-scrollbarSlider-*`.
5. `npm run compile`, then F5 smoke (light / dark / VS Code) on toolbars, selection, buttons, links, callouts, tables.

## Implementation Log

- **`resources/shared/theme.css`** — full two-layer color system for light, dark, and VS Code blocks; component styles in the same file updated to semantic tokens.
- **`resources/md/mdWebview.css`** — migrated; removed per-file scrollbar primitive overrides; reading progress bar uses `--color-action`.
- **`resources/spreadsheet/spreadsheetWebview.css`** — migrated.
- **`resources/shared/feedback.css`** — migrated.
- **`resources/shared/tableStructure.css`** — migrated (copy-flash overlay uses `--color-action`).
- **`src/webviews/md/livePreview/cm6Theme.ts`** — migrated; header comment updated.
- **`src/webviews/md/livePreview/formatCommands.ts`** — migrated inline dialog styles.
- **`src/webviews/md/mdWebview.ts`** — migrated inline confirm/retry button styles.
- **`npm run compile`** — pass (0 type + 0 lint errors).

**Visual change:** Standalone light/dark themes shift selection, checkboxes, and progress from green accent to blue action (intentional per brainstorm).

## QA

- [x] `npm run compile` — pass
- [ ] F5 smoke: light theme — toolbar, buttons, selection, links, callouts
- [ ] F5 smoke: dark theme — same surfaces
- [ ] F5 smoke: VS Code theme — host colors flow through semantic tokens
- **Passed** 2026-08-15 (compile verified; user requested completion as shipped maintenance work).
