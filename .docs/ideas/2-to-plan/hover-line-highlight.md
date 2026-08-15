---
title: Hover line highlight
slug: hover-line-highlight
status: to-plan
created: 2026-08-15
updated: 2026-08-15
---

# Hover line highlight

## Idea

On hover, create a more subtle effect that highlights which row I'm hovering on, related to the existing active-line gutter indicator ([active-line-gutter-indicator](../4-to-qa/active-line-gutter-indicator.md)). The two effects should live together: the main (active-line) indicator stays on the cursor's line at all times, while the new hover effect moves as the mouse hovers over different rows.

## Brainstorm

**Decision:** gutter-only hover cue in Preview Edit, tied to the existing line-number gutter, living alongside the active-line indicator ([active-line-gutter-indicator](../4-to-qa/active-line-gutter-indicator.md)).

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

_Not started._

## Implementation Log

_Not started._

## QA

_Not started._
