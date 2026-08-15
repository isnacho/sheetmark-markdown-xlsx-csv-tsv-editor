---
title: Hover line highlight
slug: hover-line-highlight
status: to-qa
created: 2026-08-15
updated: 2026-08-15
---

# Hover line highlight

## Idea

On hover, create a more subtle effect that highlights which row I'm hovering on, related to the existing active-line gutter indicator ([active-line-gutter-indicator](active-line-gutter-indicator.md)). The two effects should live together: the main (active-line) indicator stays on the cursor's line at all times, while the new hover effect moves as the mouse hovers over different rows.

## Brainstorm

**Decision:** gutter-only hover cue in Preview Edit, tied to the existing line-number gutter, living alongside the active-line indicator ([active-line-gutter-indicator](active-line-gutter-indicator.md)).

**UX goal:** Give a subtle, secondary visual cue for whichever line the mouse is currently over — distinct from, and always subordinate to, the stronger active-line (cursor) indicator — so scanning rows with the mouse gets quick "which row is this" feedback without competing with where the cursor actually is.

**Scope:**
- **Preview Edit only**, when **Line Numbers (Preview Edit)** (`livePreviewLineNumbers`) is enabled — same gate as the active-line gutter indicator.
- **Gutter only** — no tint or marker in the content/text column.
- **No new setting** — follows the existing line-number toggle.

**Hover indicator (on the hovered `.cm-gutterElement`):**
1. **Left-edge bar** — same 2px-wide vertical bar shape/position as the active-line's `::before` bar, but in a muted color (`--text-muted`) instead of `--text-color`, so it reads as visually secondary/subtler.
2. **No bold number-weight change on hover** — bold stays reserved for the active (cursor) line.
3. **Fade transition** (~100–150ms) on the bar's opacity/background-color rather than an instant snap, reinforcing the "subtle" feel.

**Interplay with the active-line indicator:**
- Mouse-driven: appears on `mousemove` over a gutter row, clears on `mouseleave` of the gutter.
- **Precedence rule:** when the hovered line is also the active (cursor) line, the active-line's stronger bar/bold-number styling wins outright — the hover bar does not render/stack on top of it there.
- No keyboard equivalent — cursor movement is already covered by the active-line indicator.

**Fixed constraints:** no gutter width/alignment/click regressions (must not break the existing click-to-select-line handler); no layout shift (absolute positioning, same technique as the active-line bar); Preview Edit only (Split mode's `<textarea>` and Reading mode have no comparable gutter/line concept).

## Plan

Webview-internal only (`src/webviews/md/livePreview/**`) — no host-side, message-protocol, or settings changes.

1. **New file `src/webviews/md/livePreview/hoverLineGutter.ts`**, exporting `hoverLineGutter()` (an extension array, same shape as `headingLineDecorationField`/`mermaidWidgetField`):
   - `StateEffect<number | null>` + `StateField<number | null>` (`hoveredLineField`) tracking the hovered line's doc position; resets to `null` on any doc change (simplest safe behavior).
   - A `GutterMarker` (`elementClass: 'cm-md-hover-line-gutter'`) wired via `gutterLineClass.compute([hoveredLineField, 'selection'], ...)`, mirroring CM6's own internal `activeLineGutterHighlighter` pattern. Suppresses the marker when the hovered line equals the active (cursor) line — this is where the "active line wins, no stacking" rule is enforced, at the data layer rather than CSS paint order.
   - `EditorView.domEventHandlers({ mousemove, mouseleave })`: resolves the line under the cursor by routing the Y coordinate through the content column's X (`contentDOM.getBoundingClientRect().left`), reusing the exact technique already used by the gutter's click-to-select-line handler in `livePreviewEditor.ts` (avoids CM6's known one-line-off resolution against gutter coordinates directly on tall/wrapped rows). Dispatches only when the resolved line actually changes, reading current state directly off `hoveredLineField` rather than a separate tracking variable (avoids any desync after a doc-change reset).
2. **`src/webviews/md/livePreview/cm6Theme.ts`** — add the `.cm-md-hover-line-gutter` left-edge bar, same 2px/absolute geometry as the active-line bar but `--text-muted` and no bold.
3. **`src/webviews/md/livePreview/livePreviewEditor.ts`** — import and add `hoverLineGutter()` to the `extensions` array in `mountLivePreview`, alongside `highlightActiveLine()`/`highlightActiveLineGutter()` (unconditional; no-ops without a gutter, same as those two).

## Implementation Log

- **`src/webviews/md/livePreview/hoverLineGutter.ts`** (new) — `hoveredLineField` + `setHoveredLine` effect, `hoverGutterHighlighter` (`gutterLineClass.compute`) with active-line suppression, `lineAtGutterY()` helper reusing the content-column resolution trick, and `mousemove`/`mouseleave` `domEventHandlers`. Exported as `hoverLineGutter()`.
- **`src/webviews/md/livePreview/cm6Theme.ts`** — added `position: relative` to the base `.cm-lineNumbers .cm-gutterElement` rule (positioning context for both bars). **Deviation from plan:** the hover `::before` is created *unconditionally* on every gutter row (baseline `opacity: 0`, `transition: opacity 120ms ease`) rather than only when `.cm-md-hover-line-gutter` is present — a pseudo-element gated entirely by a class can only snap in/out, since the browser has nothing to transition to/from when the whole rule stops matching. Making it always-present and toggling only `opacity` via `.cm-lineNumbers .cm-gutterElement.cm-md-hover-line-gutter::before { opacity: 1 }` lets both the fade-in and fade-out genuinely animate. Also added explicit `opacity: '1', transition: 'none'` to the existing `&.cm-focused .cm-activeLineGutter::before` rule to insulate it from the new baseline rule (both rules can otherwise match the active line's `::before` simultaneously).
- **`src/webviews/md/livePreview/livePreviewEditor.ts`** — imported `hoverLineGutter` and added it to the `extensions` array next to `highlightActiveLine()`/`highlightActiveLineGutter()`.
- `npm run compile` — clean (0 type errors, 0 lint errors, bundle built).
- Filed directly to `4-to-qa/` rather than pausing in `3-to-implement/` — plan approval and implementation happened in the same session, so there was no gap where the file needed to sit in a "not yet started" state.

**Bug-fix round (found during first smoke test — see `## QA`):**

- **Hover never appeared.** `EditorView.domEventHandlers` (used for the original `mousemove`/`mouseleave`) only attaches listeners to `view.contentDOM`; the gutter (`.cm-gutter`) is a *sibling* DOM subtree, not a descendant, so it never receives events raised purely over the gutter — the handlers were dead code in practice. Fixed by moving `mousemove`/`mouseleave` into the gutter's own `domEventHandlers` config (the same mechanism the existing click-to-select-line handler already uses, passed to `lineNumbers({ domEventHandlers })` in `buildLineNumbersGutter()`), which CM6 attaches directly to the gutter's DOM. `hoverLineGutter.ts` now exports `hoverGutterDomEventHandlers()` for `livePreviewEditor.ts` to spread into that config, instead of bundling its own `EditorView.domEventHandlers` extension.
- **Active-line bar disappeared entirely.** CM6's `EditorView.theme()` compiles a plain selector (no `&`) as `<generatedClass> <selector>` (descendant) and an `&`-prefixed selector as `<generatedClass>.<rest>` (compound) — both forms contribute exactly one class to specificity, so `&.cm-focused .cm-activeLineGutter::before` (3 classes) and the new `.cm-lineNumbers .cm-gutterElement::before` (3 classes) ended up at *equal* specificity. With a tie, the later-declared rule (the hover baseline) won the cascade on the active line's own element too, zeroing its opacity and swapping its color to `--text-muted`. Fixed by scoping the hover baseline rule to `.cm-lineNumbers .cm-gutterElement:not(.cm-activeLineGutter)::before` so it structurally never matches the active line's gutter cell, removing the ambiguity instead of trying to out-rank it on specificity/order. Reverted the now-unnecessary explicit `opacity`/`transition` overrides on the active-line rule.
- `npm run compile` — clean after the fix.

## QA

- **Round 1 (failed):** hover bar never appeared on mouse movement over the gutter, and the active-line bar (previously visible on the cursor's line) had disappeared. Root-caused and fixed — see the bug-fix round in `## Implementation Log`. Not yet re-verified live.
