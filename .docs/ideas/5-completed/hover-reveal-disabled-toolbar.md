---
title: "Hover-Reveal Disabled Toolbar"
slug: "hover-reveal-disabled-toolbar"
status: completed
created: "2026-10-26"
updated: "2026-10-26"
---

# Hover-Reveal Disabled Toolbar

## Idea

For Enable Sticky Toolbar, when it's disabled, the toolbar should disappear just like it does now. When my mouse hovers over the top of the view, the toolbar should show and disappear again when the mouse leaves.

## Brainstorm

When Sticky Toolbar is disabled in Markdown, XLSX, CSV, or TSV editors, preserve the current non-sticky toolbar: it appears in its normal document position and scrolls away with the content. Once that toolbar is out of view, hovering over a shallow, invisible activation area at the top edge reveals the toolbar as an overlay. It must not shift the document or show a persistent handle.

Keep the overlay visible while the pointer or keyboard focus is within the toolbar and while a toolbar-owned menu or settings panel is open. After the pointer leaves and no retained interaction is active, hide it following a short anti-flicker grace period. Use a brief slide/fade transition; users who prefer reduced motion get an immediate reveal and hide. Touch-only use keeps the existing non-sticky behavior because there is no hover gesture.

The existing Sticky Toolbar setting controls this behavior, with no new setting or copy. When Sticky Toolbar is enabled, behavior remains unchanged. This direction makes toolbar actions temporarily reachable without permanently consuming vertical space and keeps the interaction consistent across all Sheetmark editors.

## Plan

1. Extend `ToolbarManager` in `src/webviews/shared/toolbarManager.ts` to observe when the non-sticky toolbar wrapper has fully left the viewport, create and manage one invisible top-edge hover target, reveal the existing toolbar as an overlay, retain it during pointer or keyboard-focus interaction, and dismiss it after a 120 ms grace period. Disable and clean up the hover state whenever sticky or spreadsheet forced-sticky mode is active.
2. Add the shared overlay, hotspot, transition, and `prefers-reduced-motion` rules to `resources/shared/theme.css`. Preserve the current non-sticky vertical scroll behavior and wrapper space so revealing the toolbar does not shift content.
3. Mark the settings panel in `src/webviews/shared/settingsManager.ts` and toolbar-owned spreadsheet popups in `src/webviews/spreadsheet/spreadsheetWebview.ts` and `src/webviews/spreadsheet/interactiveControls.ts` as surfaces that retain the revealed toolbar until they close.
4. Add real-browser coverage in `src/test/webview/markdown.spec.mts` and `src/test/webview/spreadsheet.spec.mts` for arming after scroll, top-edge reveal, delayed dismissal, popup retention, and no hover reveal while sticky mode is enabled.
5. Add a user-facing entry under `## Unreleased` in `CHANGELOG.md`.
6. Run `npm run verify`. Manually smoke-test Markdown, XLSX, CSV, and TSV with Sticky Toolbar disabled when a browser/Extension Development Host is available.

No host, protocol, configuration-key, Markdown formatting-toolbar, or touch-gesture changes are required. Existing spreadsheet edit mode remains forced sticky.

## Implementation Log

- Extended `ToolbarManager` with shared viewport observation, an invisible top-edge hover target, keyboard/pointer retention, popup retention, a delayed hide, and cleanup when sticky mode is active.
- Added shared overlay and reduced-motion styling in `resources/shared/theme.css`.
- Marked the shared settings panel and spreadsheet toolbar popups as reveal-retaining surfaces.
- Added Markdown and spreadsheet real-browser regression coverage and an Unreleased changelog entry.
- After the first smoke test showed only Markdown's main toolbar row, grouped the formatting row with it for non-sticky layout and made both rows reveal, remain interactive, and dismiss together.
- Verification: type checks, lint, unit tests, and bundle passed. Browser tests and manual browser smoke testing were intentionally skipped at the user's request.
- `updateHoverRevealHeight` mirrors `--toolbar-hover-reveal-height` to `:root` so Markdown's fixed outline line rail can step below the revealed toolbar.

## QA

- User smoke test found that Markdown's formatting toolbar row did not appear with the main row.
- The formatting row is now included in the hover overlay, with browser coverage asserting both rows are fixed and visible together.
- Increased the invisible top-edge activation area from 8 px to 16 px after smoke testing.
- Increased the pointer-leave hide delay from the planned 120 ms to 750 ms after smoke testing.
- **2026-10-26:** User smoke-tested Markdown outline rail with non-sticky toolbar (scroll, hover-reveal, rail offset). Marked complete on user request.
