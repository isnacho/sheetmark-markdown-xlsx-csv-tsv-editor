---
title: Toolbar button tooltips
slug: toolbar-button-tooltips
status: completed
created: 2026-07-21
updated: 2026-07-21
---

# Toolbar button tooltips

## Idea

Add tooltips to all the buttons on the toolbar. Each tooltip should appear after a certain delay and describe what the button does or give it a name.

## Brainstorm

Phased delivery per **8a**: QA the v1 implementation as-is first; v2 picks up the
remaining deltas below.

### v1 — implemented, awaiting QA

**Copy (1a):** action name + keyboard shortcut when one exists; name only when no
shortcut (e.g. `Settings`, `Version History`). No descriptive sentences.

**Scope (2a):** icon-only toolbar chrome only — skip controls with a visible text
label (`.btn-label`, edit-strip text buttons like `Merge`/`Borders`, view-mode
select, settings checkbox rows).

**Menus (3a):** no tooltips on items inside open popups/menus (insert-control
popup, etc.) — tooltips on the trigger button only.

**Presentation (4a):** browser-native `title` tooltip (OS look). Defer setting
`title` until hover threshold via shared `data-delayed-title` helper; clear on
mouse leave. Do **not** revive `.tooltiptext` / `.global-tooltip`.

**In-scope surfaces:**

- Main toolbar — `ToolbarManager` icon buttons (MD + spreadsheet).
- Markdown formatting bar — `#formattingToolbar .fmt-btn`.
- Spreadsheet edit strip — `.icon-only` buttons only.
- Search overlay — prev/next/close nav buttons.
- Theme toggle — settings UI cycle button.

Out of scope: in-document controls (code-block copy, heading anchors, hyperlink
popover, cell link tooltip), settings panel rows, popup menu items.

**v1 gap vs final spec:** disabled copy is static (**5a** in shipped code); **5b**
deferred to v2. Shortcut symbols not fully audited (**6c**) — deferred to v2.
**Presentation note:** deferred native `title` does not show in webviews (browser
only tooltips on enter when `title` is already set). Shipped v1 uses a shared
floating `.global-tooltip` element after **500 ms** hover instead.

### v2 — after QA passes

**Disabled state (5b):** when a button is disabled, append a short reason after an
em dash, e.g. `Save Changes (Ctrl+S) — no unsaved changes`. Enabled buttons keep
name + shortcut only. Each button needs a defined reason string when disabled (Plan
must inventory which toolbar buttons can disable and why).

**Shortcut formatting (6c):** audit every tooltip string for platform-aware
modifiers — `⌘` / `Cmd` on macOS, `Ctrl` on Windows/Linux. Single shared
formatter; no mixed `Ctrl` on Mac.

**Show delay (7b):** ~~change `DELAYED_TITLE_DELAY_MS` from 700 → **500 ms**~~ done in
v1 QA fix.

**Explicitly out of v2** (rejected in brainstorm): rich/multi-line tooltips (1b/1c),
settings-row tooltips (2b), labeled-button tooltips (2c), popup menu item tooltips
(3b/3c), custom floating tooltip widget (4b/4c), user-configurable delay (7c).

### Defaults

- Hide immediately on mouse leave / mousedown.
- No extension setting for delay.
- Shared code under `src/webviews/shared/`.

## Plan

Skipped formal plan-mode approval per user request; implemented directly from brainstorm spec.

1. Add `src/webviews/shared/delayedTitleTooltip.ts` — store text in `data-delayed-title`, set native `title` after 700 ms hover, clear on leave/click; `isIconOnlyControl()` enforces 5b.
2. `ToolbarManager` — apply delayed titles on icon-only buttons (no `.btn-label`); drop unused `.tooltiptext` spans.
3. `ThemeManager` — dynamic theme label via `setDelayedTitleText`.
4. Wire batch helper at init in `mdWebview.ts`, `spreadsheetWebview.ts`, `spreadsheetFindComponent.ts`, and after edit-strip creation.
5. Reuse existing tooltip copy from toolbar definitions / HTML `title` attributes (4b).

## Implementation Log

- **Added** `src/webviews/shared/delayedTitleTooltip.ts` — shared delay helper, icon-only detection, batch wiring.
- **Updated** `src/webviews/shared/toolbarManager.ts` — delayed titles on icon-only toolbar buttons; simplified `setButtonTooltip`.
- **Updated** `src/webviews/shared/themeManager.ts` — theme cycle button uses delayed native title.
- **Updated** `src/webviews/md/mdWebview.ts` — wire main toolbar, formatting bar, search overlay buttons.
- **Updated** `src/webviews/spreadsheet/spreadsheetWebview.ts` — wire main toolbar, theme toggle, edit-strip icon buttons.
- **Updated** `src/webviews/spreadsheet/components/spreadsheetFindComponent.ts` — wire find overlay nav buttons.
- Settings checkbox rows skipped (2a — visible labels). Edit-strip text buttons (`Merge`, `Borders`, etc.) skipped (2a).
- **QA fix:** replaced deferred native `title` with shared floating `.global-tooltip`
  (`hideFloatingTooltip` / `showFloatingTooltip`) — native `title` set mid-hover never
  appears in webviews. Delay set to **500 ms** (`DELAYED_TITLE_DELAY_MS`). Styled via
  `.toolbar-floating-tooltip` in `resources/shared/theme.css`.
- `npm run compile` — pass (0 type errors, 0 new lint errors).

## QA

- **2026-07-21 — MD toolbar (user):** hover icon buttons in `samples/test.md` → tooltip
  appears after ~500 ms. **Pass.**
- **2026-07-21 — signed off:** v1 accepted; v2 items (5b disabled reasons, 6c shortcut
  audit) remain optional follow-ups. **QA complete.**
