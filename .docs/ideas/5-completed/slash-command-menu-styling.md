---
title: Style slash command menu
slug: slash-command-menu-styling
status: completed
created: 2026-08-12
updated: 2026-08-12
---

# Style slash command menu

## Idea

Style the slash command menu (`/` on an empty line in Preview Edit): add icons to items and match the rest of the editor/document chrome.

(Originally captured as "backspace context menu" — clarified to slash command menu.)

## Brainstorm

**Decided UX direction:**

- **Icons:** reuse existing toolbar `Icons` SVGs; shared `Heading` icon for H1–H4; new `Paragraph` and `Callout` icons for Text and Callout.
- **Panel:** glass panel matching table context menu (`--glass-bg-strong`, blur, 10px radius, `--shadow-lg`).
- **Layout:** icon column + label; selected row uses a neutral darker tint; Notion-style markdown hints on the right.
- **Implementation:** keep CM6 `@codemirror/autocomplete`; custom `addToOptions` render for icons + `tooltipClass`/`optionClass` for styling. No hand-rolled popup.

## Plan

1. **`src/webviews/shared/icons.ts`** — add `Paragraph`, `Callout`.
2. **`src/webviews/md/livePreview/slashMenu.ts`** — `icon` per option; `SLASH_ICON_BY_LABEL`; export `slashMenuAutocompletion()` with `addToOptions` icon render.
3. **`src/webviews/md/livePreview/livePreviewEditor.ts`** — swap inline `autocompletion({...})` for `slashMenuAutocompletion()`.
4. **`src/webviews/md/livePreview/cm6Theme.ts`** — glass tooltip + flex row styles for `.cm-slash-menu-*`.
5. **`src/webviews/md/livePreview/slashMenu.test.mts`** — assert every option has an icon.

## Implementation Log

- **`icons.ts`** — `Paragraph`, `Callout` SVGs.
- **`slashMenu.ts`** — per-option `icon`; `SLASH_ICON_BY_LABEL`; `slashMenuAutocompletion()` extension with `selectOnOpen: false` and `SlashMenuPointerPlugin` (pointer hover syncs to `aria-selected` so keyboard and mouse share one highlight).
- **`slashMenu.ts`** — per-option `hint` mapped to CM6 `detail` for Notion-style markdown shortcuts on the right.
- **`livePreviewEditor.ts`** — uses `slashMenuAutocompletion()`.
- **`cm6Theme.ts`** — glass panel; `li.cm-slash-menu-option` row layout (fixed specificity so row padding applies); neutral `color-mix` selected tint; muted mono hints; final compact spacing (`7px 10px` row padding, flush items, no list gap).
- **`slashMenu.test.mts`** — icon coverage + hint coverage tests.
- `npm run compile` passes (0 type + 0 lint errors).

## QA

**Smoke-tested in Extension Development Host (Preview Edit, sample `.md`):**

| Check | Result |
|---|---|
| `/` on empty line opens styled glass menu with icons | Pass |
| Filter (`/head`) narrows list; selection/highlight behavior intact | Pass |
| No row selected on open; ↓ selects first, ↑ selects last | Pass |
| Keyboard ↑/↓ and pointer hover share one `aria-selected` highlight | Pass |
| Enter applies chosen block transform (heading, table, etc.) | Pass |
| Markdown hints visible on right in muted mono (H1–H4 `#`…`####`, etc.) | Pass |
| Row padding compact, items flush (Notion-style internal inset only) | Pass — user confirmed "good" |

**Outcome:** Pass — moved to completed 2026-08-12.
