---
title: Notion-style block drag and drop in Markdown
slug: notion-style-block-drag
status: completed
created: 2026-11-13
updated: 2026-11-13
---

# Notion-style block drag and drop in Markdown

## Idea

i wnat to rework the ability to drag and drop blocks on md. Want to create a notion like experience, let's brainstorm

Context at capture: today only table rows/columns are draggable (grips inside the table widget). Document-block drag was planned in [[drag-reorder-blocks-and-tables]] (2026-08-10) and cut before shipping on 2026-08-12, so paragraphs, headings, lists, code fences, callouts and whole tables can only be moved by cut/paste, CM6's native drag of selected text, or `Alt+↑/↓` (single-line swap).

## Brainstorm

Decided 2026-11-13 (picks A2, B1, C2, D1, E1, F1). Goal: moving and nesting blocks in Preview Edit should feel like Notion: hover, grab, drop, while the file stays plain, valid Markdown.

### 1. What counts as a block

Every block in the document is draggable on its own: paragraph, heading, list item (bullet, numbered, task), fenced code block (including Mermaid), quote, callout, toggle, table (as a whole), image, divider.

- **List items carry their children.** Dragging an item moves its nested items and continuation lines with it, like Notion.
- **Blocks inside containers are draggable too.** A paragraph inside a callout, toggle or quote has its own grip and can be dragged out of it.
- **Headings move alone** (E1): dragging a heading moves only the heading line, not its section.
- **Not draggable:** YAML frontmatter. Nothing can be dropped above it.
- **Tables:** the whole-table grip sits in the left margin like any other block. The existing row and column grips inside the table stay as they are. No dragging into or out of table cells.

### 2. Hover controls (B1)

- Hovering a block shows two controls in the left margin, aligned with the block's first line: `+` and `⋮⋮` (grip).
- `+` inserts an empty paragraph below the block and opens the slash menu there. Tooltip: "Add block below".
- `⋮⋮` tooltip: "Drag to move · Click to select".
- Controls sit in a margin lane outside the text. They must not overlap line numbers (when on), the outline rail, list bullets or task checkboxes. With line numbers on, the lane sits between the numbers and the text.
- Controls hide while the user types and come back on the next mouse move (Notion behavior), so they don't flicker while writing.
- Controls are hidden while a table cell is being edited.

### 3. Clicking the grip selects (C2)

- Click `⋮⋮` → the whole block is selected and shown with a block highlight (soft accent background across the block, not the usual text-selection look).
- Under the hood it is an ordinary selection of the block's full text, so everything that works on a selection works here: `Cmd+C` / `Cmd+X`, `Delete`/`Backspace`, typing replaces it, `Esc` or clicking elsewhere clears it.
- No block menu (no "Turn into", "Duplicate" etc.) in this version.

### 4. Multi-block selection (F1)

- **Shift-click** another block's grip extends the selection to every block between the two, inclusive.
- **Text selection:** if a normal text selection spans several blocks, grabbing any grip inside it drags all touched blocks together. A partly selected block counts as a whole block.
- Moved blocks keep their order and their relative nesting.
- Only one contiguous range; no Cmd-click to pick scattered blocks.

### 5. Dragging and dropping (D1)

- While dragging, a faded copy of the block (or selected blocks) follows the pointer, and the original stays in place, dimmed.
- A **blue insertion line** shows where it will land, between two blocks or at the start or end of the document.
- The insertion line's **left edge shows the nesting level**: indented means "nested here", full width means "top level".
- Dropping on the block's own position (or inside the dragged range) does nothing.
- `Esc` during a drag cancels it; nothing changes.

### 6. Nesting (A2)

How far left or right the pointer is when dropping sets the depth, like Notion:

| Dropping… | Next to… | Result |
|---|---|---|
| List item | Another list item | Joins that list at the indicated depth, from top level up to one level deeper than the item above |
| List item | Non-list blocks | Starts its own list |
| Any block | Indented under a list item | Becomes nested content of that item (indented under it) |
| Any block | Inside a callout, toggle or quote | Becomes part of that container |
| Block inside a container | Outside it, at top level | Leaves the container |

- A list item keeps its own type when it moves (a bullet stays a bullet, a task stays a task with its checked state), as in Notion. Numbered lists renumber after the move.
- A collapsed toggle acts as one block: drop before or after it, not inside. Expand it to drop inside.
- A container can't be dropped into itself.

### 7. Fixed outcomes

- The file stays clean, valid Markdown: blank lines between blocks are tidied (no doubled or missing blank lines), indentation and `> ` prefixes are added or removed to match the new nesting, and numbered lists are renumbered.
- One move = one undo step. Redo works the same.
- A move is a normal edit: the file is marked changed, and autosave applies.
- Applies to Preview Edit (the only Markdown editing mode).

### Out of scope (this version)

- Block menu from the grip (Turn into, Duplicate, Delete).
- Keyboard block moves (`Alt+↑/↓` stays a single-line swap).
- Dragging a heading's whole section.
- Auto-scroll when dragging near the top or bottom edge (users scroll with the wheel or trackpad while dragging). Not picked in brainstorm; first candidate for a follow-up if long documents feel painful.
- Side-by-side columns (Notion columns have no Markdown equivalent).
- Dragging between files, or into table cells.

## Plan

Approved 2026-11-13.

### Context

Preview Edit only lets you drag table rows and columns. Moving any other block means cut and paste, or `Alt+↑/↓` one line at a time. The brainstorm spec in `.docs/ideas/2-to-plan/notion-style-block-drag.md` (picks A2, B1, C2, D1, E1, F1) asks for Notion-style moves: hover a block to see `+` and `⋮⋮`, click the grip to select, drag with a ghost and a blue line, and nest by dropping further left or right. The file must stay valid Markdown.

Decisions made during planning (user answers, 2026-11-13):
- **Toggle grip:** the new grip replaces the toggle's own `⋮⋮` handle. Click selects, like every other block. **Right-click** on a toggle's grip (or Enter while it has keyboard focus) opens the existing toggle menu.
- **`+` on a list item or a line in a quote:** adds an empty sibling item (same marker type) or an empty `> ` line below, with the cursor in it and no menu. On every other block, `+` adds an empty paragraph and opens the slash menu.

### What the code gives us (from exploration)

- **The parser** is `@codemirror/lang-markdown` with GFM. **Callouts** (`:::type` … `:::`, which don't nest), **toggles** (`<details>`, body not indented, nested through tags) and **frontmatter** are found by line scanners, not syntax nodes: `calloutTypes.ts:findCalloutBlocks`, `detailsTypes.ts:findDetailsBlocks`, `../frontmatter.ts:extractFrontmatter`. With no blank line around it, lezer can glue a `:::` line into a Paragraph, so syntax nodes must be clipped to a container's content lines.
- **No helper lists blocks.** Reusable pieces: `formatCommands.ts:enclosingListItem` / `listItemDepth`, `listMarkerEditing.ts:computeListItemPrefixRange`, `listPaste.ts:parseListMarkerLine`, `tableBoundaryEditing.ts:effectiveTableRange`, `imageWidget.ts:imageReplaceRange`.
- **Pointer to position:** `pointerLineResolution.ts:resolveLinePosAtPointer` handles block widgets (table, mermaid, frontmatter) through its `lineBlockAtHeight` fallback. Widgets with `ignoreEvent` true skip CM's handlers, so hover detection needs native listeners on `scrollDOM`, the same approach as `hoverLineGutter.ts`.
- **The left inset** (`--cm-md-content-inset: 40px`, `cm6Theme.ts`) is where the grip lane goes.
  - Tables already use its inner 20px for row grips (`--cm-md-row-grip-gutter`).
  - The toggle `HandleWidget` sits in it too (`detailsExtension.ts`).
  - The outline rail (`../outlineRailOverlay.ts`, about x 8..44, top of pane, z-index 6) can cover it on narrow panes.
- **Undo** is the default `history()`. Toggle edits use the `structureEdit` annotation (`detailsEditing.ts`) to get past the `structureGuard` change filter.
- **Table drag** (`tableWidget.ts:wireTableDragUI`) uses mousedown with window mousemove/mouseup (no HTML5 drag) and an absolutely placed 2px `--color-action` line. Reuse that pattern and look.
- **The selection layer** in `selectionColumn.ts` (`layer` + `RectangleMarker`) is the model for the block highlight, which must cover widgets too.
- **Per-block state keyed by position:** `columnWidthsField` (by table index) and `detailsOpenField` (by `title#occurrence`, persisted through `onDetailsStateChanged`). Both need remapping when a move changes order. Mermaid mode is document-wide, so it needs nothing.
- **Slash menu:** it has no programmatic open. Open it by inserting `/` on an empty line, then calling `startCompletion(view)` from `@codemirror/autocomplete`.

### Architecture

Three new modules in `src/webviews/md/livePreview/`, with pure logic kept apart from the DOM:

| File | Kind | Role |
|---|---|---|
| `blockModel.ts` | pure + tests | Block tree for the document; drop targets for a gap; moving blocks and rebasing their text |
| `blockSelection.ts` | StateField + layer + tests | Block selection state, highlight layer, Shift-click extend |
| `blockDrag.ts` | ViewPlugin (DOM) | Hover controls, `+`, click/drag state machine, ghost, insertion line, dispatch |

No message-protocol change: moves are normal doc edits, and saves already flow through `onDocChanged`.

### Steps

#### 1. `blockModel.ts`: block tree (pure)

`buildBlockTree(state): BlockNode[]`. Each node has `{ kind, from, to, depth, parent, children, containerKind? }`, with `from`/`to` covering whole lines.
- **Kinds:** paragraph, heading, listItem (carries nested items and continuation lines), code (FencedCode, mermaid included), quote, callout, toggle, table (`effectiveTableRange`), image (a paragraph that is only an image), hr.
- **Containers with children:** listItem (nested content), quote, callout (lines between the fences), toggle (body between the tags). Children come from syntax nodes clipped to the container's content lines, so callout and toggle bodies hold real blocks.
- **Frontmatter** is left out. The first drop gap is after it.
- `blockAt(tree, pos)` returns the innermost block containing a position (used for hover). `blocksForRange(tree, from, to)` returns the siblings touched by a selection, widened to whole blocks at the shallowest common parent (for F1).
- **Tests** (`blockModel.test.mts`, wrapped in `fullyParsed`): each kind; a list item carries its children; callout bodies with and without blank lines; nested toggles; a table inside a quote; frontmatter excluded; partial-selection widening.

#### 2. `blockModel.ts`: drop targets and the move (pure)

- `dropTargetsAtGap(tree, gapPos)`: the legal placements at a line boundary, each `{ parent | null, index, depth, insertPos }`, ordered shallow to deep.
  - Depth runs from top level up to "child of the block above" when that block is a list item, an open toggle or a callout. Dropping inside a quote is allowed at the quote's depth.
  - **Not allowed:** a callout inside a callout; a block inside its own dragged range; inside a collapsed toggle; above frontmatter.
- `computeMoveBlocks(state, sources: BlockNode[], target): TransactionSpec | null`. One change set that removes the sources and inserts their text at the target:
  - **Rebase the text:** strip the source context (list indent relative to its parent, `> ` prefixes from quote ancestors), then add the target context (content-column indent under a list item, `> ` inside quotes). Toggle and callout bodies add no prefix.
  - **Blank lines:** separate blocks with one blank line; keep tight lists tight when an item lands between items; remove the blank lines left behind at the source.
  - **Renumber** the ordered lists touched at the source and the target, by rewriting the markers in order from each list's start number.
  - **A list item keeps its type** (bullet, number or task, with its checked state).
  - Returns `null` when nothing would change (dropping a block on its own spot).
  - The transaction carries `userEvent: 'move.block'`, `isolateHistory.of('full')` (one undo step) and `structureEdit.of(true)`, and sets the block selection (step 3) to the moved blocks at their new place.
- **Remapping position-keyed state** (pure helpers with tests):
  - `remapTableIndexMap(widths, oldOrder, newOrder)` for `columnWidthsField`, dispatched with the effect it already uses (`replaceColumnWidthsEffect`, if present; otherwise add one).
  - `remapDetailsIds(before, after)` for `detailsOpenField`, persisted through the existing `onStateChanged` callback.
- **Tests** cover: moving a paragraph; moving a heading alone (E1); nesting a list item one level deeper or shallower by depth; a paragraph under a list item; into and out of a quote, a callout and a toggle; renumbering; no tight list broken; a no-op returns null; a multi-block move keeps order and relative nesting; table width and toggle id remaps.

#### 3. `blockSelection.ts`: click to select (C2) and Shift-click (F1)

- `blockSelectionField`: `{ ranges: {from,to}[] } | null`.
  - Set by `selectBlocksEffect`, and mapped through changes.
  - Cleared when the main selection no longer matches the selected range exactly. The CM selection is always set to the blocks' full text, so copy, cut, Delete and typing work unchanged.
- **Highlight layer:** a `layer` built from block rectangles (`coordsAtPos` / `lineBlockAt` from to to, clamped to the text column like `selectionColumn.ts:clampToColumn`), drawn as `cm-md-block-selected` (soft `--color-action` background). It covers widgets too. While a block selection is active, an editor class hides the normal text-selection layer.
- **Shift-click on a grip:** extends from the anchor block (the current block selection, else the block holding the cursor) to the clicked block, among siblings found with `blocksForRange`.
- **Tests:** mapping through edits, clearing on a selection change, building the extend range.

#### 4. `blockDrag.ts`: hover controls, `+`, drag

**Hover.**
- A throttled native `mousemove` on `view.scrollDOM` calls `resolveLinePosAtPointer`, then `blockAt`. It places one overlay element (`cm-md-block-controls`: `+` and `⋮⋮`, using `Icons.DragGrip` plus a plus icon, about 18px each) left of the block's text, at the block's first line and indent. That puts nested blocks' controls beside them, like Notion.
- The overlay lives in a layer element over the content, not as widgets per block, so nothing rebuilds on every keystroke.
- **Hidden** when: the editor is read-only (version preview); the diff overlay is on; a table cell is being edited; the user is typing (hide on `keydown`, show again on the next `mousemove`).
- **Tables:** the block controls show only while hovering the header row. Body rows keep the existing row grip, so the two never collide.
- **Outline rail:** if the controls' rectangle overlaps `.outline-rail-widget`, hide them for that block (the rail wins). This is a known limit on narrow panes; it gets a QA item.

**`+` button.**
- **List item:** insert an empty sibling item (same marker; numbered items renumber; tasks unchecked), with the cursor in it. No menu.
- **Line in a quote:** insert an empty `> ` line, with the cursor in it. No menu.
- **Any other block:** insert an empty line after the block in the same container, type `/`, then call `startCompletion(view)` to open the slash menu.

**Grip: click vs drag.**
- `mousedown` calls `preventDefault`. Moving less than 4px before `mouseup` is a click: it selects the block, or extends with Shift.
- **Right-click** on a toggle's grip, or Enter/Space on a toggle's focused grip, opens the toggle menu (`showToggleMenu`, exported from `detailsExtension.ts`).
- Moving 4px or more starts a drag. The sources are the block selection or a multi-block text selection, if the grabbed block is in it (F1); otherwise just the grabbed block.

**Drag.**
- **Ghost:** a fixed-position clone of the sources' DOM (`.cm-line`s and widget DOM in range), 50% opacity, `pointer-events: none`, capped at about 240px tall with a fade. The original gets `cm-md-block-drag-source` (dimmed).
- **Picking the target:** pointer Y picks the nearest gap. Pointer X picks the deepest `dropTargetsAtGap` entry whose indent is left of the pointer.
- **Insertion line:** `cm-md-block-drop-line`, 2px `--color-action`, starting at the target depth's indent.
- **Scrolling during a drag:** a `scroll` listener recomputes the target (wheel and trackpad). No auto-scroll; it is out of scope.
- **Drop:** `mouseup` calls `computeMoveBlocks`, then dispatches it plus the remaps from step 2.
- **Cancel:** `Esc`, window `blur` or `mouseup` outside a valid gap cancels the drag and changes nothing.

#### 5. Toggle handle cut-over (`detailsExtension.ts`, `cm6Theme.ts`)

- Remove `HandleWidget` and its `.cm-md-details-handle` styles (and the focus rule in `resources/shared/theme.css`).
- Keep the chevron.
- Export `showToggleMenu`, so `blockDrag.ts` can open it from right-click or Enter.

#### 6. Wiring and styles

- `livePreviewEditor.ts`: register `blockSelectionField`, the highlight layer and `blockDragPlugin` in the main extensions array, outside `revealCompartment`, so drag works with reveal off and survives reconfiguring it.
- `cm6Theme.ts`: styles for the control lane, the block highlight, the drop line and the drag source, using semantic tokens only. Keep the 40px inset; the controls fit in it.
- `resources/md/mdWebview.css`: the ghost (it lives outside the editor theme scope).

#### 7. Tests

- **Unit tests:** steps 1 to 3 (pure functions next to their sources).
- **Webview tests** (`src/test/webview/markdownBlockDrag.spec.mts`, new; `page.mouse.move/down/up` on real geometry). These are the first drag tests in the suite.
  1. Hovering a paragraph shows the controls; typing hides them.
  2. Dragging a paragraph under a heading changes the saved text (via `waitForPosted('saveMarkdown')` after a save).
  3. Dragging a list item right nests it; dragging it left un-nests it.
  4. A click selects the block (highlight present), and `Delete` removes it.
  5. Shift-click selects a range, and dragging moves all of it.
  6. `Esc` during a drag leaves the document unchanged.
  7. One `Cmd+Z` restores the document after a move.
  8. Moving a toggle keeps its structure. Right-click on its grip opens the toggle menu.
  9. Hovering a table header shows the block grip; hovering a body row shows the row grip.
  10. `+` on a paragraph opens the slash menu; `+` on a list item adds an empty item.
  11. `problems()` is empty (no CSP violations or page errors).
- Existing toggle tests that click `.cm-md-details-handle` need updating to use the new grip.

#### 8. Docs

- `.docs/dev/MAP-mdWebview.md`: add the three modules; note that the toggle handle moved to the block grip.
- `.docs/product/MARKDOWN-TABLES.md`: whole-table drag from the header row.
- `CHANGELOG.md` `## Unreleased`: a user-facing bullet.
- Fix the stale `livePreviewEditor.ts` header comment only if it describes the grip area (no unrelated cleanup).

### Implementation order

1. `blockModel.ts` tree + tests
2. Drop targets, move, remaps + tests
3. `blockSelection.ts` + tests
4. `blockDrag.ts` hover controls and `+`
5. Click, drag, ghost, line, drop
6. Toggle handle cut-over
7. Wiring, styles, webview tests
8. Docs, then `npm run verify`. No integration tests: host code doesn't change.

### Files

| File | Action |
|---|---|
| `src/webviews/md/livePreview/blockModel.ts` (+ `.test.mts`) | new |
| `src/webviews/md/livePreview/blockSelection.ts` (+ `.test.mts`) | new |
| `src/webviews/md/livePreview/blockDrag.ts` | new |
| `src/webviews/md/livePreview/livePreviewEditor.ts` | register extensions |
| `src/webviews/md/livePreview/detailsExtension.ts` | remove `HandleWidget`, export `showToggleMenu` |
| `src/webviews/md/livePreview/tableWidget.ts` | expose width-map replace effect if missing; header-row hover hook |
| `src/webviews/md/livePreview/cm6Theme.ts`, `resources/md/mdWebview.css`, `resources/shared/theme.css` | styles |
| `src/test/webview/markdownBlockDrag.spec.mts` | new; update toggle-handle specs |
| `.docs/dev/MAP-mdWebview.md`, `.docs/product/MARKDOWN-TABLES.md`, `CHANGELOG.md` | docs |

Not touched: host code, `src/protocol/`, CSP, esbuild paths, `xlsxViewer.*` IDs.

The working tree has a lot of uncommitted owner work in these same files (`livePreviewEditor.ts`, `tableWidget.ts`, `cm6Theme.ts`, `mdWebview.css`). Implement on top of it without staging or reformatting other changes, and commit only our hunks, by path.

### Risks

| Risk | Mitigation |
|---|---|
| Rebasing text between contexts corrupts structure (lists in quotes, tight lists) | Heavy unit coverage in step 2; a move returns null rather than writing an unsure result |
| A `:::` fence glued into a Paragraph | Clip syntax nodes to callout content lines; tests with and without blank lines |
| Ghost cloning of widget DOM looks wrong (mermaid SVG, tables) | Cap the size; QA screenshots light and dark (`npm run shot`) |
| Outline rail covers the grips on narrow panes | Rail wins; QA item; follow-up if it bites |
| Toggle menu less discoverable (right-click) | Grip tooltip on toggles: "Drag to move · Click to select · Right-click for options" |
| Block tree rebuilt on every hover | Cache per `state.doc` + tree; rebuild only on doc change |

### Verification

- `npm run verify` green: types, lint, unit tests, bundle, webview tests including the new spec.
- `npm run test:ui` and read the light and dark PNGs for the control lane and highlight.
- Manual F5 smoke on `samples/test.md` (QA phase):
  - nested lists, callouts, toggles, a table, mermaid, line numbers on and off, reveal off
  - a narrow pane with the outline rail
  - save and reopen: column widths and toggle open state follow their blocks

## Implementation Log

Built 2026-11-13 per plan. No host code, protocol, CSP or esbuild changes.

**New files**
- `src/webviews/md/livePreview/blockModel.ts` + `blockModel.test.mts` (37 tests): `buildBlockTree`, `blockAtLine`, `blocksForRange`, `visibleBlocks`, `dropTargetsAtGap`, `isDropAllowed`, `computeMoveBlocks`, `computeInsertAfter` (the `+` button), `remapTableIndexMap`, `remapToggleState`.
- `src/webviews/md/livePreview/blockSelection.ts` + `blockSelection.test.mts` (5 tests): block selection field, highlight layer, dimmed drag-source layer.
- `src/webviews/md/livePreview/blockDrag.ts`: hover controls, `+`, click / Shift-click select, right-click and Enter toggle menu, drag with ghost and drop line, commit with remaps.
- `src/test/webview/markdownBlockDrag.spec.mts` (12 browser tests with a real mouse).

**Changed files**
- `livePreviewEditor.ts`: registers `blockSelectionExtensions` and `blockDragExtension({ isDisabled: () => diffActive })`, outside `revealCompartment`.
- `detailsExtension.ts`: `HandleWidget` removed; `showToggleMenu` exported; new `applyDetailsOpenState` (replace and persist the open map).
- `cm6Theme.ts`: block controls, drop line, highlight, drag source and ghost styles; old `.cm-md-details-handle` rules removed. `resources/shared/theme.css`: focus ring rule now targets `.cm-md-block-grip`.
- Tests: `markdownPolish.spec.mts` (3 toggle-handle tests now use the block grip), `src/test/ui/vscodeUi.spec.mts` (toggle menu via right-click on the grip), `scripts/check-regression-tests.mjs` (`focus-ring-small-controls` entry follows the renamed selector).
- Docs: `.docs/dev/MAP-mdWebview.md` (new Block drag section, toggle row), `.docs/product/MARKDOWN-TABLES.md` (whole-table drag), `CHANGELOG.md`.

**Deviations from the plan**
- No `tableWidget.ts` change: the existing `setColumnWidthsEffect` (one effect per table index) is enough to remap widths, and the header-row check lives in `blockDrag.ts` (`thead` rect).
- Ghost is styled in `cm6Theme.ts`, not `mdWebview.css`: it is appended inside the editor element so the cloned lines keep their theme styles.
- Moves are computed on a line array and dispatched as one trimmed change (`minimalChange`), not as separate delete + insert changes; simpler to keep blank lines and renumbering right.
- Callouts and quotes: hovering their first line shows the box's own controls (the callout icon sits on that line), and controls for blocks inside them sit outside the box. Found in screenshot review.
- Starting a drag selects the dragged blocks, so an older block highlight elsewhere disappears.
- Toggle and callout blocks cannot be dropped under a list item or into a quote (their tags/fences must start at column 0); a quote whose children all move out takes no drops.
- Undo restores the text but not remapped column widths or toggle open state (effects-only follow-ups).

**Verification**
- `npm run verify`: check-types, lint, unit tests (583 pass) and bundle green. Webview tests 92 pass, 1 fail: `non-sticky toolbar reveals from the top edge and stays for its settings panel` (formatting toolbar opacity 0.84 vs 1). It fails the same way with block drag switched off, so it predates this work (likely the in-progress toolbar changes in the working tree).
- Headless screenshots reviewed (light theme): hover on nested list item, toggle, callout, table header; block selection; drag with nest and top-level drop lines.
- Not run: `npm run test:ui` (real VS Code window), dark theme screenshots, manual F5 smoke.

## QA

### Automated (agent, 2026-11-13)

| Check | Result |
|---|---|
| `npm run verify`: types, lint, unit tests (583), bundle | Pass |
| Webview tests | 92 pass, 1 fail: `non-sticky toolbar reveals…` (fails with block drag off too; predates this work) |
| `markdownBlockDrag.spec.mts` (12 tests, real mouse) | Pass |
| `npm run test:ui` (real VS Code, 8 tests incl. right-click toggle grip menu) | Pass; `toggle-menu.png` reviewed |
| Headless screenshots, light theme (hover, selection, drag) | Reviewed; callout controls moved outside the box after review |

### Manual smoke test (F5 Extension Development Host)

Setup: **F5** → open `samples/test.md` (or any Markdown file) in Sheetmark → Preview Edit. **Cmd+R** reloads the host after code edits. Check light and dark themes.

**Hover and `+`**
- [ ] Hover a paragraph, heading, list item, nested list item, code block, Mermaid diagram, table header, toggle title, callout, quote: `+` and grip appear left of the block, lined up with its first line, never over text, bullets, checkboxes or the toggle arrow
- [ ] Table body rows show only the table's row grip, not the block controls
- [ ] Typing hides the controls; moving the mouse brings them back
- [ ] `+` on a paragraph: new line below with the slash menu open; pick an option and it applies
- [ ] `+` on a bullet, numbered and to-do item: empty sibling item below (numbers follow on, to-do unchecked)
- [ ] `+` inside a quote: new quote line

**Select**
- [ ] Click a grip: the block gets a soft blue box; Cmd+C / Cmd+X / Delete / typing act on the whole block
- [ ] Shift-click a second grip: everything in between is selected; drag moves them together in order
- [ ] Select text across two paragraphs, drag either grip: both move

**Drag**
- [ ] Faded copy follows the pointer, source is dimmed, blue line shows the landing spot
- [ ] Paragraph above/below other blocks; heading moves alone (its section stays)
- [ ] List item: drag right nests it under the item above, left takes it out; numbered lists renumber; bullets keep tight spacing
- [ ] Paragraph into a list item, into a callout, into an open toggle, into a quote, and back out
- [ ] Whole toggle, whole callout, whole table, Mermaid diagram move as one block
- [ ] A closed toggle takes no drops inside; a callout cannot go inside another callout
- [ ] Esc during a drag cancels; one Cmd+Z undoes a move
- [ ] Wheel/trackpad scroll while dragging keeps the line tracking

**State that follows a move**
- [ ] Resize a table column, move the table past another table, save and reopen: widths stay with their table
- [ ] Close a toggle, move it past another toggle with the same title, reopen the file: open/closed states stay with their toggles

**Settings and modes**
- [ ] Line numbers on: controls do not overlap the number gutter
- [ ] Reveal syntax off: drag still works
- [ ] Version preview (read-only) and disk diff overlay: no controls
- [ ] Narrow pane with the outline rail showing: controls hide where the rail covers them (known limit)
- [ ] Right-click a toggle's grip, or Tab to it and press Enter: toggle menu opens

### Outcome

Manual F5 smoke test: the user reported the whole checklist passed (2026-11-13). Marked **completed**.

Known limits carried forward: controls hide where the outline rail covers them on narrow panes; undo restores the text but not remapped column widths or toggle open state; no auto-scroll while dragging near the edges (first follow-up candidate).
