---
title: Outline hover rail
slug: outline-hover-rail
status: completed
created: 2026-10-22
updated: 2026-10-26
---

# Outline hover rail

## Idea

I want outline hovers — similar to Notion. A minimal strip at the top-left of the page shows short horizontal lines, one per heading; the active heading’s line is a bit darker or grayer. Normally it stays contracted (just those lines). On hover, it expands to show all headings, and you can click to jump to each one.

It’s related to but different from our current outline: one mode is the full expanded outline panel we have today; this one is the contracted “lines only” view. They should look quite similar when expanded, but the default is minimal.

## Brainstorm

**Decision:** Preview Edit gets a Notion-style **heading rail** (collapsed horizontal lines) as the **default** outline experience. Hover opens a compact popover with the full heading list (same look/behavior as today’s outline links). Users can **pin** the rail into the **existing sidebar outline** (current expanded panel). The existing **Show Outline** setting is the master switch — when off, **both** the rail and the sidebar panel are hidden.

**Scope**

- **Preview Edit only** — same surface as live preview scroll spy and heading navigation today.

**Default state (lines)**

- When Show Outline is on and the user has **not** pinned: show only the **line stack** (D1) — one short horizontal bar per heading; active section’s bar is slightly darker/stronger; bar length or weight may hint heading level.
- Rail is anchored at the **top-left of the document content** and **scrolls with the editor** as the user scrolls (not a fixed viewport widget).
- No headings → hide the rail (no empty stack).

**Hover (popover)**

- Hovering the line stack opens a **popover** (E1) beside the rail with the heading list — reuse the same structure/styling as the current `.toc-body` / `.toc-item` links so expanded hover matches the familiar outline.
- Click a heading in the popover → same jump/scroll behavior as the sidebar TOC today.
- Scroll spy keeps the **active line** and popover **active link** in sync while reading.

**Pin (sidebar outline)**

- Provide a clear **pin** control on the rail (or popover) that switches to the **current outline panel** layout (left column, resizable, title/header, full list) — “something like current outline,” not a new third UI.
- Pin state persists per document or globally (implementation choice in Plan; default: match how other Markdown UI prefs persist if one exists, otherwise session or preference store).
- Unpin returns to the default **lines-only** rail.

**Settings**

- **Show Outline** (existing toggle): **off** hides **everything** — rail, popover, and pinned sidebar. **On** shows the rail by default unless pinned open to sidebar.
- No separate “enable rail” toggle unless Plan finds a strong reason; one setting controls outline UI as a whole.

**Fixed constraints**

- One heading data source and navigation path (`buildToc` / scroll spy / click handlers) — rail is presentation + interaction, not a second TOC implementation.
- Popover must not require opening the sidebar column by default (minimal footprint).
- Keyboard/accessibility: pin and popover need a reasonable focus path (details in Plan).

## Plan

**Approach:** Keep one TOC parse path (`markdown-it` tokens + `tocIdToLine` / `tocLineToId` maps in `mdWebview.ts`). Split HTML builders into a small pure module. Default UX: **rail** (block CM6 widget at body start, scrolls with the document). **Pin** flips to today’s **sidebar** (`toc-open` grid + `#tocPanel`). **`showOutline`** remains the master enable. **Pin state** persists **globally** (same pattern as `mermaidPreviewMode`).

No new VS Code `contributes.configuration` key — storage via `preferenceStore` + `saveOutlinePinned` message.

### 1. Protocol + host persistence

| File | Change |
|------|--------|
| `src/protocol/markdown.ts` | Add `outlinePinned: boolean` to `MarkdownDocumentPayload`. Add webview→host `{ command: 'saveOutlinePinned'; pinned: boolean }`. |
| `src/shared/preferenceStore.ts` | `outlinePinned` `globalPreference<boolean>` (key `xlsxViewer.outlinePinned`, default `false`). |
| `src/mdEditorProvider.ts` | Include `outlinePinned` in `buildInitMarkdownPayload`; handle `saveOutlinePinned`. |
| `.docs/dev/MESSAGE-PROTOCOL.md` | Document new field + message. |
| `.docs/dev/ARCHITECTURE.md` | One row in Markdown prefs table. |
| Test fixtures | `markdown.spec.mts`, `markdownSaveSync.spec.mts`, `preferenceStore.test.mts` — defaults + round-trip. |

### 2. Extract TOC model / HTML (unit-tested)

| File | Change |
|------|--------|
| `src/webviews/md/outlineToc.ts` (new) | `TocItem` type; `collectTocItems(tokens, bodyStartLine)` (heading walk currently in `buildToc`); `renderTocListHtml(items)` → `.toc-item` markup; `renderRailLinesHtml(items, activeId?)` → line stack; `renderTocEmptyHtml()`. |
| `src/webviews/md/outlineToc.test.mts` (new) | Items from sample tokens; rail active class; empty list. |
| `src/webviews/md/mdWebview.ts` | `buildToc` / `updateToc` call into `outlineToc.ts`; still refresh maps in `updateToc` from collected items. |

### 3. Outline chrome state (webview)

| File | Change |
|------|--------|
| `src/webviews/md/state.ts` | `outlinePinned: false`. |
| `src/webviews/md/mdWebview.ts` | **`applyOutlineChrome()`** (extract from `applySettings`): `showOutline` off → hide sidebar (`toc-open` false, panel hidden), `body` class `outline-rail-mode` off, rail hidden. `showOutline` on + **unpinned** → no `toc-open`, panel stays hidden, `outline-rail-mode` on when Preview Edit active. `showOutline` on + **pinned** → `toc-open` + visible panel, rail off. Call from `applySettings`, `enterPreviewEditMode`, and when pin toggles. |
| `src/webviews/md/mdWebview.ts` | `persistOutlinePinned(pinned)` → post `saveOutlinePinned`. On `initMarkdown`, set `state.outlinePinned`. |
| `src/webviews/md/mdWebview.ts` | **`wireTocPanel`:** close button → **unpin** (not `showOutline = false`). Optional: add **pin** control in sidebar header that sets pinned (redundant with rail pin but helps discoverability). |
| Settings copy | Update **Show Outline** tooltip: rail by default; pin for sidebar; off hides all. |

**Behavior change (intentional):** `showOutline: true` no longer opens the sidebar by default; users pin for the old layout.

### 4. CM6 rail widget (scrolls with document)

| File | Change |
|------|--------|
| `src/webviews/md/livePreview/outlineRailWidget.ts` (new) | `StateField` holding `{ items, activeId, enabled }`. Block `WidgetType` at **`cursorPosAfterFrontmatter(doc)`** (recompute on doc change / TOC refresh). DOM: line stack + pin button + popover container (inner HTML from `renderTocListHtml`). Hover rail → show popover (position with `getBoundingClientRect`, prefer right of stack; clamp to viewport). `mouseenter`/`mouseleave` with short hide delay so moving into popover doesn’t flicker. Pin click → callback to shell. |
| `src/webviews/md/livePreview/livePreviewEditor.ts` | Register `outlineRailWidgetField`; export `syncOutlineRail(view, { items, activeId, enabled })`, `setOutlineRailPinHandler(fn)`. |
| `src/webviews/md/mdWebview.ts` | After `refreshCm6Toc` / `updateScrollSpy`, push items + active id + `enabled` into `syncOutlineRail`. Pin handler sets `state.outlinePinned = true`, persist, `applyOutlineChrome()`. |
| `src/webviews/md/livePreview/outlineRailWidget.test.mts` (optional) | Widget position helper or enabled gating if extracted. |

**Click navigation:** Popover uses same `.toc-item a[data-target]` markup — delegate clicks (shared handler or call existing `scrollToAnchor` path). Sidebar `#tocBody` keeps existing listener.

### 5. Scroll spy

| File | Change |
|------|--------|
| `src/webviews/md/mdWebview.ts` | `updateScrollSpy`: besides sidebar links, set active class on rail lines + popover links (same `current` id from `nearestTocIdForLine`). |

### 6. Styles

| File | Change |
|------|--------|
| `resources/md/mdWebview.css` | `.outline-rail-widget` (in-flow block, top-left padding aligned with content); `.outline-rail-line` (width by level, muted default, `.active` stronger); `.outline-rail-popover` (reuse `.toc-body` padding inside, border/surface tokens); pin button; `body:not(.outline-rail-mode) .outline-rail-widget { display: none }` or don’t mount widget when disabled. Ensure popover `z-index` above CM6 content; no CSP/new asset roots. |

### 7. Docs map

| File | Change |
|------|--------|
| `.docs/dev/MAP-mdWebview.md` | `outlineToc.ts`, `outlineRailWidget.ts`, `applyOutlineChrome`, scroll-spy note. |

### 8. Verification (Implement phase)

1. `npm run verify`
2. Manual F5 on a multi-heading `.md`: default lines at body top scroll away; hover popover + jump; active line tracks scroll; pin → sidebar + resize; close sidebar → rail; Show Outline off → all hidden.
3. Regression entry in `scripts/check-regression-tests.mjs` if we add a focused unit test (rail HTML or chrome gating).

### Order of work

1. Protocol + preferenceStore + host handler + tests  
2. `outlineToc.ts` + refactor `mdWebview` TOC refresh  
3. `applyOutlineChrome` + pin persistence + toc close behavior  
4. `outlineRailWidget.ts` + wire in `livePreviewEditor` + CSS  
5. Scroll spy + settings copy + MAP/MESSAGE-PROTOCOL  
6. Verify + manual QA checklist for Phase 5

## Implementation Log

- **Protocol / host:** `outlinePinned` on `MarkdownDocumentPayload`; `saveOutlinePinned` message; `preferenceStore.outlinePinned` (global).
- **TOC:** `outlineToc.ts` + `outlineToc.test.mts`; `mdWebview` uses shared list/rail HTML and `applyOutlineChrome()` (rail vs pinned sidebar).
- **CM6:** `outlineRailWidget.ts` block widget after frontmatter; hover popover + pin; wired via `syncOutlineRail` / scroll spy.
- **UX:** Show Outline off hides all; sidebar close unpins; settings tooltip updated.
- **Styles:** `mdWebview.css` rail + popover.
- **Docs:** `ARCHITECTURE.md`, `MAP-mdWebview.md`.
- **Tests:** `check-types` + `lint` + `test:unit` + bundle green; webview suite not run here (no Chrome in agent env). Regression: `outline-rail-active-line`.
- **QA fix:** Rail moved from CM6 block widget (scrolled away / hidden under YAML card) to `#outlineRailHost` overlay on `.markdown-preview-stack` — stays fixed top-left over the editor while scrolling.
- **Non-sticky toolbar:** With **Enable Sticky Toolbar** off, `#content` scrolls; pin the rail with `position: fixed` (sticky fails under `overflow: hidden` ancestors). Scroll-spy gutter highlight stays on when the sidebar outline is pinned (`outlineActiveHeadingEnabled`).
- **Hover-reveal toolbar:** When the non-sticky toolbar overlay is visible, the rail’s `top` follows `--toolbar-hover-reveal-height` on `:root` (mirrored from `ToolbarManager`) so it is not covered by the main + formatting rows.

## QA

- **2026-10-26:** User smoke-tested Preview Edit outline rail (lines, popover, pin, spacing, colors, popover height). Iterations on overlay positioning, tick widths, and popover layout confirmed good. Marked complete on user request.
- **2026-10-26:** User confirmed non-sticky scroll (rail + active line stay visible), pinned-sidebar gutter highlight, and rail offset when the hover-revealed toolbar appears. Marked complete on user request.
