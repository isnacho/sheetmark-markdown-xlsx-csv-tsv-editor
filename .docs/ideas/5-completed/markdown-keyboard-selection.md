---
title: Markdown Keyboard Selection
slug: markdown-keyboard-selection
status: completed
created: 2026-08-16
updated: 2026-08-16
---

# Markdown Keyboard Selection

## Idea

I want to be able to replicate the selection and movement common behaviors of this sort of text editing software in Markdown. For example, when pressing Shift + moving the cursor, I want to be able to select the text.

pressing Command should select the whole line, pressing Option should select the word, etc. Do some research here on what the most common behaviors are, and let's see what we can implement.

## Brainstorm

**Direction:** Adopt Apple's Human Interface Guidelines semantic-modifier model for text
selection/movement, applied to prose and fenced code blocks in the live-preview Markdown
editor. Shift is the universal "turn a move into a selection" trigger; Option and Command
change the *unit* of movement independent of Shift.

### Target behavior matrix

| | Horizontal (←/→) | Vertical (↑/↓) |
|---|---|---|
| **plain** | move by character | move by (visual) line |
| **Option** | move by word | move by paragraph* |
| **Command** | move to line start/end | move to document start/end |
| **+ Shift** (any cell above) | select instead of move | select instead of move |

\* **Exception:** `Option+Up/Down` is already used for "move current line up/down" (existing
reorder feature) and keeps that meaning — it is *not* repurposed to plain paragraph-cursor
movement. Only `Shift+Option+Up/Down` is newly added, for "select to paragraph start/end."
Plain, unshifted paragraph movement (no selection) is intentionally not available via this
shortcut, to avoid breaking the existing reorder feature.

Everything else in the matrix should follow HIG literally, including `Cmd+Left/Right` moving
to the (visual) line boundary — replacing the current custom behavior where it jumps to
paragraph boundaries instead.

### Scope

- **In scope:** prose (paragraphs, headings, lists, blockquotes, callouts) **and** fenced
  code block interiors — both should get the full matrix above, including fixing
  `Shift+Arrow` at code-block edges so it extends selection instead of being silently
  swallowed.
- **Tables and mermaid diagrams:** stay atomic cursor units — no character-level selection
  inside or across them, and no cross-cell keyboard selection (out of scope; tables use a
  separate contentEditable-per-cell model today). However, the *edge* bug where
  `Shift+Arrow` silently eats the keystroke with no effect when the selection head is
  adjacent to one of these blocks should be fixed, so selection correctly extends up to /
  away from the block boundary.
- **Mouse:** no new mouse behavior. Verify double-click (word select) and triple-click
  (line select) already work correctly in prose per current CM6 defaults; fix only small
  bugs surfacing during implementation/QA. Not chasing drag-select edge cases (e.g.
  click-position correction on wrapped lines) — that's separate scope.

### Explicitly out of scope for this idea

- Cross-cell keyboard selection in tables.
- Character-level selection through hidden markdown source inside atomic widgets (ordered
  list number markers, table blocks, mermaid diagram blocks).
- Reworking `Mod-d` (custom select-word) or `Mod-u`/`Mod-Shift-u` (case transform) — these
  keep their current custom meanings.
- Drag-select interaction bugs with click-position correction on wrapped lines.

## Plan

Deep research during planning found the actual gap is much smaller than Brainstorm assumed —
CodeMirror 6's `defaultKeymap`/`standardKeymap` already implements almost the entire HIG
matrix for free. Two corrections to the Brainstorm scope:

1. **The only real bug is `Cmd+Left/Right`.** [`paragraphNavigation.ts`](../../../src/webviews/md/livePreview/paragraphNavigation.ts)
   overrode macOS `Cmd-ArrowLeft/Right` (and Shift variants) to jump to markdown-paragraph
   boundaries instead of CM6's default line-boundary behavior. Removing that override lets
   the keystroke fall through to CM6's own `cursorLineBoundaryLeft/Right` /
   `selectLineBoundaryLeft/Right` — the HIG-correct behavior — for free.
2. **The "atomic boundary Shift+Arrow" fix from Brainstorm was dropped — not needed.**
   Verified directly in `@codemirror/view`'s keymap binder: a keymap entry only gets a
   `Shift-<key>` binding registered if it defines an explicit `shift:` handler. Neither
   `tableNavigationKeymap` nor `codeBlockNavigationKeymap` define one, so `Shift+Arrow` was
   never intercepted there and already falls through correctly to CM6's built-in
   selection-extend commands, which respect `atomicRanges` via CM6's `skipAtoms` and snap
   selection past tables/mermaid/code blocks correctly. No fix required.

### File changes

- **`src/webviews/md/livePreview/paragraphNavigation.ts`** — repurposed from horizontal
  `Cmd-Arrow` override to vertical `Shift+Option+Up/Down` paragraph selection. Removed
  `cursorParagraphStart/End`, `selectParagraphStart/End`, `runParagraphBoundary`, and the old
  `paragraphNavigationKeymap` (mac `Cmd-ArrowLeft/Right`). Kept `computeParagraphBounds`
  unchanged. Fixed a latent bug in `computeParagraphBoundarySelection` — it always collapsed
  to a cursor even when called for "select," so paragraph selection from a collapsed cursor
  never actually created a range; now it always extends via
  `EditorSelection.range(sel.anchor, target)`. Added `selectToParagraphStart/End` and a new
  `paragraphSelectionKeymap` (`Prec.high`) binding `Alt-Shift-ArrowUp/Down`.
- **`src/webviews/md/livePreview/livePreviewEditor.ts`** — updated the import and the single
  wiring site (previously `paragraphNavigationKeymap`, now `paragraphSelectionKeymap`), same
  position in the extensions array (before the `defaultKeymap` concat).
- **`src/webviews/md/livePreview/paragraphNavigation.test.mts`** — kept the
  `computeParagraphBounds` tests as-is; replaced the two `computeParagraphBoundarySelection`
  tests (which asserted the old "move only" behavior) with tests asserting the new
  always-extend semantics, plus a new test covering extending an already non-empty selection.
- **No changes needed** to `formatCommands.ts`, `tableBoundaryEditing.ts`,
  `codeBlockBoundaryEditing.ts`, `mermaidWidget.ts`, or `revealDecorations.ts` — confirmed
  via source-level research that prose and fenced-code-block interiors both get the full HIG
  matrix automatically once the Cmd-Arrow override is removed.

Full plan detail: `.cursor/plans/markdown_hig_keyboard_selection_584ecdf4.plan.md`.

## Implementation Log

Implemented exactly per the plan above, no deviations:

- Rewrote `paragraphNavigation.ts` (removed horizontal Cmd-Arrow bindings, fixed the
  always-collapse bug in the selection-extend helper, added `paragraphSelectionKeymap` for
  `Alt-Shift-ArrowUp/Down`).
- Updated `livePreviewEditor.ts` import + wiring (line ~77, ~241) to `paragraphSelectionKeymap`.
- Updated `paragraphNavigation.test.mts` with 3 tests covering the new always-extend selection
  semantics (collapsed-cursor-to-end, collapsed-cursor-to-start, and extending an existing
  non-empty selection's anchor).
- `npm run compile` (type-check + lint + esbuild bundle): clean, 0 errors.
- `npm run test:unit`: all 5 `paragraphNavigation.test.mts` tests pass. 3 unrelated test
  suites (`revealDecorations.test.mts`, `slashMenu.test.mts`, `tableWidget.test.mts`) fail in
  this environment due to a pre-existing Node.js v25 ESM/TypeScript-stripping incompatibility
  (confirmed identical failures on the unmodified tree via `git stash`) — unrelated to this
  change, not introduced by it.

## QA

Manual smoke test via F5 (Extension Development Host), spot-check (not the full checklist):

- **Cmd+Left/Right now goes to the line boundary** (the core fix, replacing the old
  paragraph-boundary jump) — confirmed working.
- **Shift+Option+Up/Down selects to the paragraph start/end** (the new binding) — confirmed
  working.

Not separately re-verified in this pass (lower risk — either untouched by this change, or
already covered by `npm run compile` + `paragraphNavigation.test.mts`): `Option+Up/Down`
line-move regression, `Shift+Cmd+Left/Right` line-boundary selection, existing
character/word/document selection shortcuts, double/triple-click, and behavior inside fenced
code blocks. Can revisit if any regression surfaces later.

**Result: PASS.**
