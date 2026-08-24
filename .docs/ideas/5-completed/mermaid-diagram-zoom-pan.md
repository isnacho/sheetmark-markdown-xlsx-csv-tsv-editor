---
title: Zoom and pan for Mermaid diagrams
slug: mermaid-diagram-zoom-pan
status: completed
created: 2026-08-24
updated: 2026-08-24
---

# Zoom and pan for Mermaid diagrams

## Idea

Add zoom and pan into the mermaid diagrams.

## Brainstorm

Zoom/pan applies only in 'diagram' preview mode (code mode untouched). Default
look stays identical to today until the user interacts — no auto-zoom.

**Trigger:**
- Ctrl/Cmd + wheel zooms centered on cursor. Plain wheel/scroll passes through
  untouched (page/editor scroll still works over a diagram).
- Drag pans, but only once zoomed in above 100% (at fit-to-width, drag does
  nothing — avoids hijacking text selection drags outside the diagram).

**Toolbar controls** (added to the existing mode-select toolbar in
`mermaidWidget.ts`): zoom-out (−), zoom-in (+), and reset/fit buttons. Reset
is also triggered by double-clicking the diagram.

**Range & feedback:** zoom clamped 50%–400%. Cursor becomes grab/grabbing
over the diagram in diagram mode. A small live zoom-% indicator shows in the
toolbar while zoom ≠ 100%, hidden at rest.

**State persistence:** pan/zoom resets to fit on every widget rebuild — i.e.
whenever the source, mode, or theme changes (matches current
`MermaidDiagramWidget.eq()` invalidation). No cross-edit persistence; simplest
and avoids stale transforms on a diagram that just changed shape.

**Implementation approach:** hand-rolled CSS `transform: scale() translate()`
driven by pointer/wheel event listeners — no new dependency, consistent with
how mermaid itself is already bundled rather than CDN-loaded.

## Plan

Skipped by explicit user request (jumped Brainstorm → Implement directly).
User confirmed after being flagged that no codebase-grounded plan would be
written first.

## Implementation Log

Files changed:
- `src/webviews/shared/icons.ts` — added `ZoomIn`, `ZoomOut`, `ZoomReset` icons.
- `src/webviews/md/livePreview/mermaidWidget.ts` — added `attachZoomPan()`
  (Ctrl/Cmd+wheel zoom centered on cursor, drag-to-pan once zoomed >100%,
  zoom-out/zoom-in/reset toolbar buttons, double-click reset, live zoom-%
  label, 50%–400% clamp). `createToolbar()` now takes an optional
  `zoomControls` element, only passed by `MermaidDiagramWidget` (code-mode
  toolbar unaffected). Pan/zoom state lives in local closure vars inside
  `toDOM()`, so it resets to fit on every widget rebuild (source/mode/theme
  change) per the brainstorm spec — no new CM6 state field needed.
- `src/webviews/md/livePreview/cm6Theme.ts` — added
  `.cm-md-mermaid-zoom-controls` / `.cm-md-mermaid-zoom-btn` /
  `.cm-md-mermaid-zoom-pct` rules; changed `.cm-md-mermaid-diagram` overflow
  from `overflowX: auto` to `overflow: hidden` (custom pan replaces native
  scroll — diagrams still fit via existing `max-width:100%` on the svg, so
  default look is unchanged).

No deviation from the brainstorm spec. `npm run compile` (types + lint +
esbuild) passed clean. Implemented on branch `feat/mermaid-diagram-zoom-pan`
(branched off `feat/disk-diff-view`) per user request to isolate this work.

## QA

Manual smoke test: Ctrl/Cmd+wheel zoom, drag-to-pan once zoomed, toolbar
buttons, double-click reset, and reset-on-rebuild all worked as specced.

Feedback: zoom controls floated in the middle of the toolbar (justify-content
space-between with 3 children) instead of sitting next to the mode dropdown.
Fixed in place — wrapped the mode-select and zoom controls in a
`.cm-md-mermaid-toolbar-right` flex group in `createToolbar()`
(`mermaidWidget.ts`) so the lang label stays left and zoom controls now sit
immediately left of the dropdown on the right. `npm run compile` clean.
