---
title: Thicker mono font for code style
slug: thicker-mono-code-font
status: completed
created: 2026-08-15
updated: 2026-08-15
---

# Thicker mono font for code style

## Idea

I think that the Mono font by default used in the code style of text is too thin. How can we make it a bit thicker?

## Brainstorm

Decided direction:

- **Scope (A3):** extension-wide — every surface that uses the shared `--font-mono`
  token (markdown live preview inline/fenced code, legacy preview paths, `kbd`,
  frontmatter values, feedback form mono fields, mermaid lang label, etc.). Do
  not change per-cell spreadsheet font picks (user-chosen Consolas/Arial/etc.).
- **Approach (B1):** bump `font-weight` by **100** over browser default (400 →
  **500**). Keep the existing `--font-mono` font stack unchanged — no new
  typefaces, no bundled fonts.
- **Settings (C1):** ship as a better default only; no new Sheetmark setting and
  no VS Code `editor.fontFamily` integration.
- **Centralize:** add a `--font-mono-weight: 500` token in `theme.css` and apply
  it everywhere `--font-mono` is already set, so future mono surfaces pick it
  up automatically.
- **Sizing:** leave font sizes as-is (no compensating size trim) unless QA shows
  lines feel too chunky after the weight bump.

Not adopted: heavier font stack swap (B2/B3); user-configurable weight (C2);
reading VS Code editor font (C3); markdown-only scope (A1/A2).

## Plan

1. Add `--font-mono-weight: 500` to `resources/shared/theme.css` next to `--font-mono`.
2. Apply `font-weight: var(--font-mono-weight)` at every existing `--font-mono` call site:
   - `resources/md/mdWebview.css` — `.inline-code`, `kbd`, `.yaml-frontmatter-textarea`
   - `resources/shared/feedback.css` — readonly textarea
   - `src/webviews/md/livePreview/cm6Theme.ts` — inline code, fenced code, mermaid lang, slash-menu detail
3. Leave `.fmt-text-icon` at `font-weight: 700` (already heavier than 500).
4. Verify with `npm run compile`.

## Implementation Log

- `resources/shared/theme.css` — added `--font-mono-weight: 500`.
- `resources/md/mdWebview.css` — weight on inline code, kbd, YAML frontmatter textarea.
- `resources/shared/feedback.css` — weight on readonly mono textarea.
- `src/webviews/md/livePreview/cm6Theme.ts` — weight on inline/fenced code, mermaid lang, slash-menu completion detail.
- `npm run compile` — passed (0 type/lint errors).
- No deviations from plan.

**QA bounce-back (2026-08-15):** weight 500 looked unchanged on macOS — Menlo/Courier
only ship 400/700, so 500 snaps to Regular. Tried system stack + weight 600; user
chose bundled **JetBrains Mono Medium** for cross-platform consistency instead.

**Bundled font (2026-08-15):**
- `resources/fonts/JetBrainsMono-Medium.woff2` + `OFL.txt` (SIL license).
- `resources/shared/theme.css` — `@font-face` + `--font-mono: 'JetBrains Mono', …` + weight 500.
- `src/spreadsheet/spreadsheetHtmlRenderer.ts` — added `font-src` to CSP (markdown already had it).
- `localResourceRoots` unchanged (`resources/` already allowed).

**Final typography (2026-08-15):** bundled **JetBrains Mono Regular** (`400`) at
**13.5px** (`--font-mono-size`) — user-tuned after Medium/14px iterations.

## QA

**Passed (2026-08-15).** Manual smoke test in Extension Development Host:

- [x] Inline `` `code` `` and fenced blocks use bundled JetBrains Mono (consistent Mac/Windows).
- [x] Weight readable — Regular (400) after Medium felt too heavy at same size.
- [x] Size **13.5px** — user-adjusted from 14px; looks good.
- [x] `npm run compile` clean throughout implementation.

**Shipped tokens:** `--font-mono`, `--font-mono-weight: 400`, `--font-mono-size: 13.5px`
in `resources/shared/theme.css`; applied via `cm6Theme.ts`, `mdWebview.css`, `feedback.css`.
Font asset: `resources/fonts/JetBrainsMono-Regular.woff2` + `OFL.txt`.
