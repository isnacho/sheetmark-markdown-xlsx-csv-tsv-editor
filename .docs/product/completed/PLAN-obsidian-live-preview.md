# Obsidian-style live preview + slash menu for Markdown "Preview Edit" mode

> **Status: completed** (2026-08). All eight phases landed; legacy `contentEditable`/
> turndown path removed in [remove-reading-split-view-modes.md](../../ideas/5-completed/remove-reading-split-view-modes.md).
> Kept for historical context — current architecture is in [ARCHITECTURE.md](../../dev/ARCHITECTURE.md).

> Revision 2. Changes from r1: corrected the formatting-command port framing
> (rewrite, not accessor-swap); added an explicit dual-surface state-sync
> contract; reordered phases so there is no regression window; added a headless
> test-harness phase; added a kill-switch flag with deferred deletion; slash menu
> now built on `@codemirror/autocomplete`; CSP explicitly verified.

## Context

Today's "Preview Edit" (WYSIWYG) mode renders markdown-it HTML into a
`contentEditable` `#markdownPreview`, and on save/mode-switch converts that
HTML back to markdown via `turndown` (`extractCurrentEditorContent`,
[mdWebview.ts:801](../../../src/webviews/md/mdWebview.ts#L801)).
That architecture can't cleanly support "show `##`/`**` near the cursor,
hide it otherwise" — the DOM has already thrown the raw syntax away.

Decision made with the user: rebuild "Preview Edit" mode on **CodeMirror 6**,
the same engine class Obsidian's Live Preview uses — raw markdown stays the
single source of truth, and a decoration layer hides/reveals syntax markers
based on cursor position. Split mode (raw textarea) and Reading mode (static
preview) are untouched. This also **removes the turndown round-trip entirely**
for this mode. Verified: turndown has exactly one `.turndown()` call site
([mdWebview.ts:814](../../../src/webviews/md/mdWebview.ts#L814)) plus its
`new TurndownService(...)` / `.use(gfm)` setup — all three go away once
extraction no longer needs HTML→MD.

Confirmed scope for v1 (from user):
- Reveal-on-cursor covers **headings + bold + italic** first; strikethrough/
  inline-code/links/blockquote/lists follow in a later phase.
- Slash-menu works in **Preview Edit mode only**.
- Slash-menu's "Callout" option reuses the **existing `:::info/warning/error/success`**
  container syntax (already parsed by `markdown-it-container`) — no new syntax.
- ~~Tables become plain always-visible markdown text~~ — **superseded**, see
  "Post-phase-4 fix: tables reopened" below. Tables now render as a real widget
  (`livePreview/tableWidget.ts`); this bullet is kept only so the "revisit as a
  follow-up if missed" line reads as resolved, not forgotten.
- Delivered **phased**, compiling + smoke-testing after each phase, on one branch.

## Architecture

- New CM6 `EditorView` replaces `contentEditable` on `#markdownPreview`,
  *only* when `isPreviewEditMode` is true. The view is **lazily constructed on
  first entry** into Preview Edit mode (see Bundle/perf below), not at webview
  load.
- `@codemirror/lang-markdown` (`@lezer/markdown` parser) gives a syntax tree
  to hang decorations off: heading marks, emphasis/strong marks, code marks,
  link marks, blockquote marks, list markers.
- **Reveal engine**: a `ViewPlugin` recomputed on every doc/selection update,
  **scoped to `view.visibleRanges`** (never the whole doc). For each markup-mark
  node in the visible range: if the selection intersects its enclosing element,
  render the raw marker text with a light-gray style (`Decoration.mark`);
  otherwise hide the marker (`Decoration.replace`) and style the content
  (bold/italic/heading-size class via `Decoration.mark`). This one mechanic is
  Improvement 1. See "Reveal-engine hazards" below for the non-obvious cases.
- **Theme**: read the existing semantic CSS vars from
  [resources/shared/theme.css](../../../resources/shared/theme.css)
  (`--text-color`, `--bg-color`, `--border-color`, `--code-bg`, `--selection-bg`,
  already mapped to `--vscode-*` tokens) via `getComputedStyle` in a CM6
  `EditorView.theme()`/`HighlightStyle`, so the editor matches VS Code's theme
  automatically without hardcoded colors.
- **Settings**:
  - `xlsxViewer.md.livePreviewReveal` (boolean, default `true`) — toggles the
    reveal decorations. Follows the exact existing pattern (`contributes.configuration`
    in `package.json`; the `settings` object in `src/mdEditorProvider.ts` init +
    `settingsUpdated`; a `SettingDefinition` + `currentSettings` field in
    `mdWebview.ts`, per `src/webviews/shared/settingsManager.ts`).
  - `xlsxViewer.md.livePreviewEngine` (enum `"cm6" | "legacy"`, default `"cm6"`) —
    **kill-switch** that falls back to the old `contentEditable`+turndown path.
    Retained until CM6 is proven in the field; removed in the final cleanup phase,
    not before. See "Kill-switch & deletion policy".
  - No message-protocol changes beyond these two settings.

### Dual-surface state-sync contract (the real complexity — make it explicit)

There are now **two editing surfaces**: Split mode owns the `<textarea>`
(`editor.value`); Preview Edit mode owns the CM6 doc. Save/cancel/dirty logic
today reads `editor.value` directly
([mdWebview.ts:921,932,953](../../../src/webviews/md/mdWebview.ts#L921)) and
`setEditMode`/`setPreviewEditMode` both seed content from `currentContent`
([mdWebview.ts:686-697,734](../../../src/webviews/md/mdWebview.ts#L686)). The turndown
removal was meant to kill content drift — a sloppy two-surface handoff would
just reintroduce it. So define one rule set up front:

- **`currentContent` (string) is the single source of truth.** Neither surface
  is authoritative; both are views over it.
- **On entering a mode**, seed that surface *from* `currentContent`
  (`editor.value = currentContent` for Split; `view.dispatch` replace-all for CM6).
- **On leaving a mode / on save / on any read** (`extractCurrentEditorContent`),
  pull the live text *out of the active surface* and write it back to
  `currentContent` **before** the other surface is touched. Introduce a single
  `getActiveEditorContent()` that branches on mode and is the *only* reader.
- **On Split⇄Preview switch**, the sequence is: read active surface → write
  `currentContent` → seed the incoming surface. Never seed the incoming surface
  from the outgoing surface directly.
- **Dirty tracking** compares `currentContent` to `originalContent`, unchanged.
  CM6's own change events feed `currentContent` via the `updateListener` (this
  replaces the `onEditorInput()` side-effect the old helpers relied on).

This contract is the acceptance criterion for Phase 1's spike; write it down as
a comment in `livePreviewEditor.ts`.

### Formatting commands — a **rewrite of each body**, not an accessor swap

Correction to r1, which claimed the Split-mode helpers port "almost 1:1 by
swapping `editor.value`/`selectionStart/End`". They do not. Inspect
[mdWebview.ts:2033-2090](../../../src/webviews/md/mdWebview.ts#L2033): each helper
takes `editor: HTMLTextAreaElement`, **mutates** `editor.value`, sets
`selectionStart/End`, calls `editor.focus()`, and ends with `onEditorInput()`.
That is an imperative mutate-then-read model. CM6 is compute-a-`ChangeSpec`-from-
`state`-then-`dispatch`; the view updates itself and the change event drives
`currentContent`.

So the port is: **keep the regex/string *intent*, rewrite each function body.**
For each command:
- Read from `state.doc`/`state.selection.main`, never a mutable `value`.
- Return/dispatch a `{changes, selection}` transaction; do not assign text.
- Drop the trailing `editor.focus()` + `onEditorInput()` — the view keeps focus
  and the `updateListener` handles the side-effect.
- Unwrap/toggle logic (e.g. `wrapSelection`'s "already wrapped → unwrap") reads
  surrounding chars from `state.sliceDoc(...)` and folds both branches into one
  `ChangeSpec`.

Commands to port (all in
[mdWebview.ts:1993-2414](../../../src/webviews/md/mdWebview.ts#L1993)):
`wrapSelection`, `toggleLinePrefix`, `insertAtCursor`, `insertLink`,
`insertImage`, `insertTable`, `insertHorizontalRule`, `toggleCodeBlock`,
`toggleCheckboxList`, `toggleBlockquote`, `multiLineIndent`, `duplicateLine`,
`deleteLine`, `moveLineUp`/`moveLineDown`, `selectWord`, `transformCase`,
`sortSelectedLines`, `trimTrailingWhitespace`. Enter-key list continuation +
Tab-indent ([mdWebview.ts:3195-3294](../../../src/webviews/md/mdWebview.ts#L3195))
become CM6 `keymap` commands using `state.doc.lineAt(range.head)`.

**Not ported (deleted, not migrated):**
- `pushUndoState`/`performUndo`/`performRedo` + `previewUndoStack`/`previewRedoStack`
  — replaced by CM6's `history()` extension.
- `applyWysiwygFormat`, `getPreviewSnapshot`/`restorePreviewSnapshot`, and the
  ~500-line table-hover-editing subsystem (`createTableHoverControls`,
  [mdWebview.ts:2570-3075](../../../src/webviews/md/mdWebview.ts#L2570)) — all
  `contentEditable`-only, dead once tables are plain text.

### Slash menu — built on `@codemirror/autocomplete` (changed from r1)

r1 hand-rolled a floating DOM popup "for tighter control over the look". That
re-implements positioning, viewport-flip, keyboard nav, filtering, and
Esc/blur/scroll-follow dismissal — every one an edge case to get subtly wrong.
`@codemirror/autocomplete` gives all of that for free, is already CSP-clean and
CM6-integrated, and its custom `render` hook + CSS fully covers the
Notion/Obsidian look. So: trigger completion on a lone `/` at the start of an
otherwise-empty line, supply the option set, and on `apply` dispatch a
transaction that removes the `/`+filter text and runs the matching block
transform: Text (strip block formatting), Heading 1-4, Bulleted/Numbered/To-do
list, Callout (`:::info`), Quote, Table, Divider. `slashMenu.ts` becomes a small
completion source + option table, not a popup subsystem.

### Reveal-engine hazards (address in the reveal phases, not after)

- **Atomic ranges**: `Decoration.replace` on a marker makes it atomic — arrow
  keys skip over it and backspace deletes the whole hidden marker. Confirm this
  is the intended caret behavior; add an `atomicRanges` facet or handle
  cursor-into-marker explicitly.
- **Nested/overlapping marks**: `***bold-italic***` produces overlapping
  emphasis+strong ranges from lezer; reveal logic must handle overlap in the
  very first reveal phase (headings/bold/italic already includes this case), not
  defer it.
- **Block-height reveal**: toggling heading-size on cursor enter/exit changes
  line height and can cause a scroll jump. Style so the revealed and hidden
  states occupy the same block height, or accept and note the jump.

### Bundle / perf

- CM6 core (`state`+`view`+`language`+`lang-markdown`+`lezer`+`commands`+`search`+
  `autocomplete`) is ≈150 KB minified. The webview is a single IIFE bundle with
  **no code-splitting** (esbuild `format: iife`), so CM6 is parsed on *every*
  `.md` open, including Reading-only sessions. Accepted for v1, but:
  - **Do not construct the `EditorView` until first Preview Edit entry** (lazy
    init) so Reading/Split sessions pay only parse cost, not construction.
  - Record the before/after `dist/md/mdWebview.js` size in the Phase 1 notes so
    the growth is a known number, not a surprise.

### CSP — verified, no change needed

The md webview CSP ([mdEditorProvider.ts:595](../../../src/mdEditorProvider.ts#L595))
is `... style-src ${cspSource} https: 'unsafe-inline'; script-src ${cspSource}
'unsafe-inline'`. CM6 injects styles via `style-mod` `<style>` elements, which
`'unsafe-inline'` in `style-src` permits — so **no CSP change is required.**
Confirm during the spike that CM6 uses no `eval`/`new Function` and makes no
network fetch (it does not), then leave the CSP untouched. Called out
explicitly per CLAUDE.md rule 3.

### New files (don't grow `mdWebview.ts` further — already ~3.7k lines, flagged debt)

New directory `src/webviews/md/livePreview/`:
- `livePreviewEditor.ts` — `EditorView`/`EditorState` setup, lazy mount/unmount,
  the `getActiveEditorContent` contract, wires into `setPreviewEditMode`.
- `revealDecorations.ts` — the cursor-aware hide/reveal `ViewPlugin`
  (headings/bold/italic in v1; extensible per-mark-type).
- `formatCommands.ts` — ported formatting commands as CM6 `Command`s (rewritten
  bodies per above).
- `slashMenu.ts` — `@codemirror/autocomplete` completion source + option table.
- `cm6Theme.ts` — `EditorView.theme()` reading `theme.css` CSS vars.

`mdWebview.ts` changes are wiring only: `setPreviewEditMode` mounts/unmounts the
CM6 view (behind `livePreviewEngine`) instead of toggling `contentEditable`;
`extractCurrentEditorContent`'s preview-edit branch routes through
`getActiveEditorContent()` (no turndown); toolbar/keyboard dispatch (`applyFormat`)
routes to the new commands when `isPreviewEditMode`; the undo/redo keydown branch
calls CM6's `undo`/`redo`.

### Needs adaptation, not full rewrite

- **Scroll spy / TOC** (`updateScrollSpy`, `wireTocPanel`,
  [mdWebview.ts:1252-1290, 3538-3564](../../../src/webviews/md/mdWebview.ts#L1252)):
  derive the active heading from CM6 viewport/line info; click-to-heading uses
  CM6's scroll effect instead of `Element.scrollIntoView`.
- **Search-in-preview when in Preview Edit mode** (`doSearch`,
  [mdWebview.ts:1371-1464](../../../src/webviews/md/mdWebview.ts#L1371)): swap the
  TreeWalker+Range trick for a `@codemirror/search` extension. Reading/Split
  search untouched (different DOM).
- **Click handling** inside Preview Edit (`wirePreviewInteractions`,
  [mdWebview.ts:3368-3536](../../../src/webviews/md/mdWebview.ts#L3368)):
  link/image/code-copy/heading-anchor re-wired against the CM6 DOM (reading
  mode's identical handling is unaffected).
- Version-preview banner / focus mode: orchestration-only — call the new
  mount/unmount instead of the old `contentEditable` toggle.

### Dependencies

Add to `package.json`: `@codemirror/state`, `@codemirror/view`,
`@codemirror/commands`, `@codemirror/language`, `@codemirror/lang-markdown`,
`@lezer/markdown`, `@codemirror/search`, `@codemirror/autocomplete`. Verified no
`esbuild.js` change needed — the webview build is already `platform: browser` /
`format: iife` with no `external` list and bundles ESM deps fine; only bundle
size to watch (see Bundle/perf).

## Kill-switch & deletion policy

- Phases 1-8 keep the old `contentEditable`+turndown Preview Edit path intact,
  reachable via `livePreviewEngine: "legacy"`. If CM6 hits a field showstopper,
  users (and we) can fall back with one setting.
- The final cleanup phase deletes the legacy path, the table-hover subsystem,
  and `turndown`/`turndown-plugin-gfm` **only after CM6 has been smoke-verified
  across all checklist items** — not as an assumption baked into an earlier phase.

## Delivery phases (verify after each with `npm run compile` + F5 smoke test)

Reordered from r1 so the mode is never shipped in a knowingly-broken state:
re-integration lands immediately after the spike (r1 deferred it to phase 6,
leaving TOC/search/click broken for four phases), and the test harness lands
before the reveal engine so reveal ships with tests.

1. **Spike + state-sync contract.** Lazily mount a plain CM6 editor (no
   decorations) in Preview Edit mode behind `livePreviewEngine`; implement the
   dual-surface `getActiveEditorContent` contract; wire content in/out,
   save/cancel, undo/redo via CM6 `history()`, theme. Confirm CSP is untouched
   and record bundle-size delta. Old path still default-reachable.
2. **Re-integration (no regression window).** Re-wire scroll-spy/TOC, search
   (`@codemirror/search`), and click-handling to the CM6 DOM. After this phase
   Preview Edit is at functional parity with the old mode minus reveal + WYSIWYG
   formatting — nothing user-visible is broken from here on.
3. **Headless test harness.** Add a minimal node test runner (CM6 `EditorState`
   runs headless — no VS Code host, no DOM). Prove one format command and one
   reveal case round-trip in tests. This is the repo's first automated test
   seed; every subsequent phase adds cases. Wire it into an `npm run test:unit`
   script (leave the existing `npm test` placeholder alone).
4. **Reveal MVP (Improvement 1).** `revealDecorations.ts` for headings + bold +
   italic, including the nested `***` overlap case and the atomic-range caret
   behavior. Ships **with unit tests** for each mark type × cursor-in/out.
5. **Formatting parity.** Port the commands into `formatCommands.ts` (rewritten
   bodies per Architecture); re-wire toolbar buttons + keyboard shortcuts to
   match today's Split-mode behavior. Unit tests per command.
6. **Slash menu (Improvement 2).** `@codemirror/autocomplete` completion source +
   full option list + block transforms.
7. **Extend reveal set.** Strikethrough, inline-code, links, blockquote, lists —
   each with unit tests. Reuse the phase-4 machinery.
8. **Cleanup.** Delete the legacy `contentEditable`/table-WYSIWYG path, the
   `livePreviewEngine` kill-switch, and the `turndown`/`turndown-plugin-gfm`
   deps — **only after** the full smoke checklist passes on CM6. Update
   `.docs/dev/MAP-mdWebview.md` line-range table and `.docs/dev/MESSAGE-PROTOCOL.md`
   (new settings) to match reality.

## Verification

- `npm run compile` after every phase (0 type + 0 lint errors; repo has no
  legacy automated suite per CLAUDE.md §5).
- `npm run test:unit` from Phase 3 on — reveal + format-command cases, growing
  each phase. This is what catches reveal regressions that manual smoke cannot
  (reveal correctness is combinatorial across mark types × cursor positions ×
  nesting).
- Manual smoke via F5 (Extension Development Host) using `samples/test.md`:
  enter Preview Edit mode; reveal-on-cursor for headings/bold/italic; every
  toolbar/keyboard formatting action; undo/redo; slash menu's full option list;
  **Split⇄Preview⇄Reading round-trips with no content drift** (the dual-surface
  contract); save + reopen; toggle light/dark/vscode theme; TOC click-to-scroll;
  in-editor search; version-history preview entering/exiting Preview Edit;
  toggle `livePreviewEngine` back to `legacy` and confirm the old path still
  works (until Phase 8).

---

## Phase 1 — completion notes (spike + state-sync contract)

**Status:** code complete; `npm run compile` clean (0 type + 0 lint errors, lint
warnings still 0). Manual F5 smoke test is the remaining gate before Phase 2.

**What landed**
- Deps added to `package.json`: all 8 CM6/lezer packages (search + autocomplete
  are installed now for later phases but not yet imported).
- Settings `xlsxViewer.md.livePreviewReveal` (bool, default `true`) and
  `xlsxViewer.md.livePreviewEngine` (`"cm6" | "legacy"`, default `"cm6"`) added to
  `contributes.configuration`, plumbed through all three settings objects +
  `updateSettings` persist in `mdEditorProvider.ts`, and added to `currentSettings`
  in `mdWebview.ts`. No settings-panel checkboxes yet (reveal toggle is inert
  until Phase 4; engine is a config-only kill-switch) — deferred, not forgotten.
- New `src/webviews/md/livePreview/`: `livePreviewEditor.ts` (lazy mount/unmount,
  `history()` undo/redo, `getLivePreviewContent`, programmatic-seed guard,
  dual-surface contract as the file header) and `cm6Theme.ts` (theme via `var(--*)`
  refs into `theme.css`, reactive to theme toggle without rebuild).
- `mdWebview.ts` wiring only: `setPreviewEditMode` mounts/unmounts CM6 behind
  `livePreviewEngine`; `extractCurrentEditorContent` renamed to
  `getActiveEditorContent` with a CM6 branch (reads raw markdown, no turndown);
  `setEditMode`/`cancelEdit` tear down CM6 on lateral/exit switches (fixes the
  "CM6 view left mounted in the split preview pane" and "renderMarkdown clobbers a
  live CM6 DOM" hazards); global keydown undo/redo skips the legacy path when CM6
  is active. Legacy `contentEditable`+turndown path fully intact behind `legacy`.

**Bundle-size delta (`dist/md/mdWebview.js`)**
- Dev (unminified): 9,958,253 → 10,971,937 B  (**+1.01 MB**)
- Production (minified): 4,716,506 → 5,228,918 B  (**+512 KB**)
- Note: the minified +512 KB is higher than r1's ~150 KB estimate — that estimate
  undercounted `@codemirror/language` + `@lezer/markdown`/`@lezer/common`. This is
  the phase-1 import set only (no search/autocomplete). Recorded as a known number.

**CSP:** verified untouched. `grep` over `@codemirror/*/dist` + `@lezer/*/dist`
finds no `eval` / `new Function` / `fetch` / `XMLHttpRequest` / `WebSocket`; CM6
injects styles via `style-mod` `<style>` elements permitted by the existing
`style-src ... 'unsafe-inline'`. No change to `mdEditorProvider.ts` CSP.

**Known phase-1 gaps (expected; addressed in later phases per the plan)**
- Ctrl+F search and TOC scroll-spy/click still target the rendered-HTML DOM, so in
  CM6 Preview Edit mode they no-op / mis-target → **Phase 2 (re-integration)**.
- Toolbar formatting buttons + `wordWrap` live-toggle not wired to CM6 → Phases 5 / 2.
- No syntax reveal yet (plain editor with static markdown highlighting) → Phase 4.

**Manual F5 smoke test for Phase 1 was not run** (no GUI/display available in the
agent session that built it) — deferred to a combined Phase 1+2 smoke pass; see the
Phase 2 notes below.

---

## Phase 2 — completion notes (re-integration)

**Status:** code complete; `npm run compile` clean (0 type + 0 lint errors, 0
warnings). Manual F5 smoke test (Phase 1 + Phase 2 together) is still outstanding —
same reason as Phase 1: no VS Code GUI in this session.

**What landed**
- New `livePreview/livePreviewSearch.ts`: a `StateField<DecorationSet>` for search-
  match highlights (`.cm-md-search-match` / `.cm-md-search-current`, themed in
  `cm6Theme.ts` to match the legacy `.search-highlight` look), `SearchCursor`-based
  case-insensitive matching (mirrors the legacy TreeWalker's `.toLowerCase()`
  compare), and scroll-to-match.
- New `livePreview/livePreviewInteractions.ts`: `detectInteractionAtPos` walks the
  `@lezer/markdown` syntax tree at a doc position to answer "what's here" — Link,
  Image, Heading (ATX + Setext), or FencedCode — for link-open / image-lightbox /
  copy-heading-link / copy-code actions. Pure function, no side effects.
- `livePreviewEditor.ts` gained: `onScroll`/`onModifierClick` mount options (backed
  by an `EditorView.domEventHandlers` extension), and exports wrapping the two new
  modules — `getLivePreviewScrollMetrics`, `getLivePreviewTopLine`,
  `scrollLivePreviewToLine`, `resolveLivePreviewInteraction`,
  `findLivePreviewMatches`, `setLivePreviewSearchHighlights`,
  `clearLivePreviewSearchHighlights`, `scrollLivePreviewToMatch`.
- `mdWebview.ts` wiring:
  - **Scroll-spy / progress bar**: both now read `view.scrollDOM` (via
    `getLivePreviewScrollMetrics`/`getLivePreviewTopLine`) instead of
    `#markdownPreview`, which doesn't scroll itself once CM6 is mounted inside it.
    `updateScrollSpy` finds the nearest heading at/above the viewport-top line via
    a new `tocIdToLine`/`tocLineToId` map (see below) instead of `.md-heading`
    DOM elements.
  - **TOC**: `buildToc` now also populates `tocIdToLine`/`tocLineToId` (heading id
    ⇄ 1-indexed CM6 line, from markdown-it's `token.map`). A new `refreshCm6Toc`
    (debounced 300ms off CM6 doc changes, plus once on mode entry) keeps the TOC
    panel live in CM6 mode, since `renderMarkdown`/`updateToc` are legacy-only.
    `wireTocPanel`'s click handler branches: CM6 → `scrollLivePreviewToLine`,
    legacy/reading → the existing `#id` DOM lookup.
  - **Search**: `doSearch`/`clearSearchHighlights`/`highlightCurrentMatch`/
    `navigateSearch`/`updateSearchCount` all branch on `isLivePreviewActive()`,
    parallel state `cm6SearchMatches: Cm6Match[]` alongside the legacy
    `searchMatches: Element[]`. Same UI (input/prev/next/count), CM6-native
    backend when that engine is active.
  - **Click handling**: `handleLivePreviewModifierClick` — see design note below.

**Design decision: Ctrl/Cmd+Click, not hover affordances (adaptation, not a straight port)**

Legacy Preview Edit renders real HTML — `<a>` for links, `<img class="zoomable">`
for images, a small "#" icon after each heading, a hover copy button on fenced
code blocks — so those actions bind to real elements. CM6 (pre-reveal-engine)
shows raw markdown text; none of those elements exist. Building hover-affordance
widgets now would mean building decoration-layer machinery ahead of schedule —
that's what Phase 4 (reveal engine) exists to introduce properly.

Instead, Phase 2 ports the four *actions* (open link, open image lightbox, copy
heading link, copy code) onto **Ctrl/Cmd+Click**, resolved by
`detectInteractionAtPos` at the clicked position:
- Link → `openExternal` (http/https/mailto), `openRelativeFile`, or scroll-to-heading
  for `#anchor` (via `tocIdToLine`).
- Image → lightbox; local paths go through the existing `resolveImageUris`
  round-trip (`pendingCm6LightboxSrc` holds the click until the async resolution
  returns, then `applyResolvedImageUris` opens it).
- Heading → copies `#slug` to the clipboard (slug from `tocLineToId`, so it's
  guaranteed consistent with the TOC's own ids).
- Fenced code → copies the code body (via the lezer `CodeText` children, which
  already exclude the fence delimiter lines) to the clipboard.

Plain click is left alone — it just places the caret, which is *correct* now that
this surface is real editable text (a click-to-navigate binding on plain click
would fight normal text editing). This is a deliberate UX adaptation, not a gap;
it may gain visual hover affordances once Phase 4's decoration machinery exists,
but isn't blocked on it functionally.

**Explicitly deferred (documented, not forgotten)**
- No visual affordance (icon/button) for the four Ctrl/Cmd+Click actions above —
  a widget-decoration nicety, revisit once Phase 4 lands the decoration layer.
- `getLivePreviewTopLine`/scroll-spy nearest-heading lookup is O(n) over
  `tocLineToId` per scroll tick; fine at typical doc/heading-count sizes, revisit
  only if it shows up as a real perf issue.

**Verification**
- `npm run compile`: 0 type errors, 0 lint warnings.
- Manual F5 smoke test **not run** (no GUI in this session) — outstanding before
  Phase 3. Checklist for whoever runs it: Preview Edit TOC populates and updates
  live while typing headings; clicking a TOC entry scrolls CM6 to that heading;
  scrolling CM6 highlights the right TOC entry; Ctrl/Cmd+F search finds matches in
  CM6 mode with working next/prev/count; Ctrl/Cmd+Click a link/image/heading/code
  block performs the right action; toggle `livePreviewEngine` to `legacy` and
  confirm all of the above still works via the old DOM-based paths.

---

## Phase 3 — completion notes (headless test harness)

**Status:** code complete. `npm run test:unit` passes (10/10). `npm run compile`
clean (0 type + 0 lint errors). Manual F5 smoke test still outstanding (same GUI
constraint as Phases 1-2 — unchanged, not re-litigated here).

**What landed**
- Test runner: Node's **built-in** `node --test`, no new devDependency. Node 25
  (this repo's runtime) strips TS types natively for `.mts` files run directly,
  so `.test.mts` files import the real `.ts` sources with an explicit extension
  (`from './livePreviewInteractions.ts'`) and run headlessly — no bundler, no
  DOM, no VS Code host, exactly per the plan's framing ("CM6 EditorState runs
  headless").
- `src/webviews/md/livePreview/package.json` (`{"type":"module"}`) scopes just
  that directory to ESM for Node's loader, silencing a
  `MODULE_TYPELESS_PACKAGE_JSON` perf warning — the repo root stays CommonJS
  (untouched; esbuild's own bundling is unaffected either way, it resolves
  modules itself rather than through Node's runtime loader).
- New script `"test:unit": "node --test \"src/webviews/md/livePreview/**/*.test.mts\""`
  in `package.json` — additive, `"test": "vscode-test"` left untouched per the plan.
- Two test files, 5 cases each:
  - `livePreviewInteractions.test.mts` — link/image/heading/fenced-code detection
    + the null (plain paragraph) case, all via `detectInteractionAtPos`.
  - `livePreviewSearch.test.mts` — `findCm6Matches`: single match, case-
    insensitivity, multiple matches in doc order, empty query, absent query.

**Deviation from the plan's literal wording (documented, not silent)**

The plan says Phase 3 should "prove one format command and one reveal case
round-trip in tests" — but `formatCommands.ts` (Phase 5) and
`revealDecorations.ts` (Phase 4) don't exist yet; there is nothing there yet to
write that specific test against. Substituted the two EditorState-level pure
functions that *do* exist from Phase 2 (`detectInteractionAtPos`,
`findCm6Matches`) as the harness's proof cases instead — same goal (prove the
headless infra works end-to-end before Phase 4 needs it), different subject
matter. Phase 4 adds the real reveal-decoration cases against this now-proven
harness, as planned.

**Explicitly out of scope for this harness (per the plan's own framing)**
- Anything requiring a real `EditorView`/DOM (decoration rendering, `mountLivePreview`,
  the search highlight `StateField`'s actual decoration output) — the plan
  explicitly scopes Phase 3 to headless `EditorState`, "no VS Code host, no DOM."
  Only manual F5 smoke-testing currently covers the DOM-dependent paths.

---

## Phase 4 — completion notes (reveal MVP, Improvement 1)

**Status:** code complete. `npm run test:unit`: 18/18 pass (10 carried over from
Phase 3 + 8 new). `npm run compile`: 0 type + 0 lint errors. Manual F5 smoke test
still outstanding (unchanged constraint from Phases 1-3).

**What landed**
- New `livePreview/revealDecorations.ts`: headings (ATX 1-6 + Setext 1-2) + bold
  (`StrongEmphasis`) + italic (`Emphasis`), scoped to `view.visibleRanges` via
  `syntaxTree(state).iterate({from, to, ...})` per range (never the whole doc).
  Split into a pure `computeRevealDecorations(state, selFrom, selTo, visibleRanges)`
  (no `EditorView`, headlessly testable) and a thin `ViewPlugin` wrapper
  (`livePreviewRevealPlugin`) that feeds it `view.state.selection.main` +
  `view.visibleRanges` and recomputes on doc/selection/viewport updates.
- Wired into `livePreviewEditor.ts` behind a new `revealCompartment`
  (mirrors the existing `wrapCompartment` pattern) — `mountLivePreview({reveal})`
  and a new `setLivePreviewReveal(on)` export toggle it without a remount.
- `mdWebview.ts`: `xlsxViewer.md.livePreviewReveal` (plumbed since Phase 1 but
  inert until now) is passed at mount time and live-applied from `applySettings`
  when CM6 is active. Added the settings-panel checkbox (`chkLivePreviewReveal`,
  "Live Preview Reveal") — this was the one still-missing piece from the Phase 1
  note "no settings-panel checkboxes yet... deferred, not forgotten."
- `cm6Theme.ts` gained the reveal classes: `.cm-md-reveal-mark` (dimmed marker,
  `var(--text-muted)` + opacity, matching the plan's "light-gray style" wording),
  `.cm-md-strong-content` / `.cm-md-em-content` (weight/style), and
  `.cm-md-heading-content` + `.cm-md-h1`..`.cm-md-h6` (font-size ratios lifted
  straight from the legacy `.markdown-preview h1`..`h6` CSS, so reader-mode
  heading sizing matches what the old renderer produced).

**Design decision: marker visibility and content styling are coupled, not independent**

Content styling (heading size, bold weight, italic style) is applied ONLY when
the marker is hidden; when the cursor is in the element, the marker shows dimmed
AND the content reverts to plain, unstyled text (you're editing raw markdown, see
raw markdown). This directly reproduces the plan's own "block-height reveal"
hazard for headings (size toggling on cursor enter/exit can shift scroll
position) — not something this design avoids, since the hazard's wording implies
this coupling is the intended model, not a design flaw to route around.

**Caret-behavior decision (the "atomic ranges" hazard)**

Went with "handle cursor-into-marker explicitly" rather than an `atomicRanges`
facet: because decorations recompute on every selection update, arrow-key/click
navigation toward a hidden marker reveals it the instant the selection touches
the element's range, rather than jumping over the whole marker as one atomic
unit. Backspace at a revealed boundary deletes one real character like normal
text editing. No `atomicRanges` facet was added. Documented here per the plan's
explicit ask to "confirm this is the intended caret behavior."

**Nested/overlapping marks (`***bold-italic***`)**

Verified by dumping the actual parse tree rather than assuming CommonMark's usual
`<strong><em>` nesting order: lezer resolves `***text***` as an **outer 1-char-marked
`Emphasis`** wrapping an **inner 2-char-marked `StrongEmphasis`** (not outer-strong/
inner-em). Since `syntaxTree.iterate` visits every node regardless of nesting depth
and each node's marker/content decorations are computed independently from its own
direct `EmphasisMark` children (not a deep search), both layers reveal correctly
regardless of which is outer — verified by both the "cursor away" case (both
layers' content classes present) and "cursor inside" case (all four marks dim,
zero content classes) in `revealDecorations.test.mts`.

**Explicitly deferred**
- Strikethrough/inline-code/links/blockquote/lists — Phase 7, reusing this same
  `computeRevealDecorations` machinery (new node-type branches + mark/content
  class pairs, same hide-marker/style-content shape).
- Block chrome for headings (the legacy renderer's `border-bottom` + block
  margins under h1/h2) — only font-size/weight is reproduced on the inline
  content span. A `Decoration.line()` companion for the border/margin is a
  visual-parity nicety, not a functional gap; skipped to avoid layout/scroll
  interactions with CM6's line measurement this session couldn't manually verify
  (no GUI).

**Verification**
- `npm run test:unit`: 18/18 (2 cases per mark type x cursor-in/out, plus 2 for
  the nested overlap case).
- `npm run compile`: 0 type errors, 0 lint warnings.
- Manual F5 smoke test **not run** (no GUI in this session). Checklist for
  whoever runs it, in addition to the Phase 1-2 checklist: type a heading and
  confirm it enlarges to reader size and hides `#` once the cursor leaves the
  line; click back into it and confirm `#` reappears dimmed and the size
  reverts; same for `**bold**`/`*italic*`; type `***both***` and confirm both
  mark-pairs hide/reveal together; toggle "Live Preview Reveal" off in Settings
  and confirm all reveal decorations disappear (plain raw markdown, no
  hide/dim/size-styling) without needing to leave and re-enter Preview Edit mode.

**Post-phase-4 fix (real user feedback from a live F5 session, 2026-07-07):
headings must KEEP their size when the cursor is on them**

The "coupled" design above was wrong. Confirmed by testing the actual mode: a
heading shrinking back to plain-text size the moment you click into it reads as
broken, not "reveal." Changed `computeRevealDecorations` so **content styling
(heading-size / bold-weight / italic-style) is now unconditional** — applied
whether or not the selection intersects the element. Only the *marker's*
visibility still toggles (hidden vs. dimmed-visible). This is a strictly simpler
model than what shipped originally, and it retires the "block-height reveal"
hazard for headings outright: since size no longer changes on cursor enter/exit,
there's nothing left to cause the scroll jump the plan warned about. Applied
uniformly to headings, bold, and italic for consistency (the user only flagged
headings; bold/italic get the same treatment on the reasoning that Obsidian's
actual behavior — content stays styled, only the delimiter dims — is the same
shape, and having the marker/content coupling differ per mark-type would be a
confusing inconsistency). All 8 mark-type/cursor-state unit tests updated to
match and still pass (18/18 total). If bold/italic staying styled while editing
turns out to feel wrong in practice, it's an isolated one-line change per mark
type to revert (`handlePairedMarks`/`handleHeading` in `revealDecorations.ts`).

**Post-phase-4 fix: fenced/inline code had zero visual treatment**

Also from the same F5 session: fenced code blocks and inline code rendered as
completely unstyled plain text — no monospace font, no background, unlike the
legacy renderer's `.code-block`/`.inline-code` CSS. Root cause: `@lezer/markdown`
tags both node types `tags.monospace`, but `@codemirror/language`'s
`defaultHighlightStyle` has no rule for that tag, so `syntaxHighlighting(defaultHighlightStyle)`
alone produces no CSS for code. Added a new, deliberately separate module,
`livePreview/codeStyling.ts` (`computeCodeDecorations` + `codeStylingPlugin`) —
separate from `revealDecorations.ts` because this is NOT reveal behavior (no
marker hides, nothing toggles with the cursor, always on): `InlineCode` gets a
`Decoration.mark` (monospace + code background, backticks included and left
visible), `FencedCode` gets a `Decoration.line` on every line it spans (fence
delimiters included) for a background band matching the legacy code-block look.
Backtick/fence marks are deliberately left visible — hiding them is reveal-marker
territory and stays Phase 7 scope ("inline-code... follow in Phase 7, reusing
this machinery"); this fix only adds the missing baseline look, it doesn't reach
into reveal. 3 new headless unit tests (21/21 total).

**Still open, confirmed with the user as expected/by-design, not bugs:**
- Lists/bullets have no marker-hiding or bullet-glyph treatment yet — squarely
  Phase 7 ("...blockquote/lists follow in Phase 7, reusing this machinery").
  `@codemirror/lang-markdown`'s base grammar does parse `BulletList`/`OrderedList`/
  `ListMark` today (confirmed), so Phase 7 has real nodes to hang decorations off
  when it lands — just nothing decorates them yet.

**Post-phase-4 fix: tables reopened — real rendered table widget, not plain text**
(also from the 2026-07-07 F5 session)

The v1 scope decision ("Tables become plain always-visible markdown text...
hover row/col buttons dropped for v1") is reversed: user wants real table
rendering back, chose the full option over two cheaper alternatives (monospace-
aligned raw text; legacy hover row/col buttons only) — explicitly opted into the
larger lift.

CM6 has no built-in table grid, so this needed a different mechanism than the
inline `Decoration.mark`/`Decoration.replace` the rest of the reveal engine uses:
a **block widget**. New `livePreview/tableWidget.ts`:
- `markdown()` is now configured with `{extensions: GFM}` (from `@lezer/markdown`
  — adds `Table`, `TaskList`, `Strikethrough`, `Autolink` node support; bare
  `markdown()` before this only had base CommonMark, so `Table` nodes didn't
  exist in the tree at all). `GFM`'s other three extensions aren't decorated by
  anything yet — enabling them now is free/inert prep for Phase 7 and doesn't
  change current behavior on its own.
- `computeTableDecorations(state, selFrom, selTo, visibleRanges)` — same pure,
  headless-testable shape as `computeRevealDecorations`: for each `Table` node
  in the visible ranges, if the selection does NOT intersect it, replace the
  whole node with a block widget; if it does, no decoration at all (raw pipe
  text, fully editable, exactly the "cursor inside" behavior everywhere else in
  this engine).
- `TableWidget` (a CM6 `WidgetType`) renders the table by feeding its raw source
  text to a **separate, bare `MarkdownIt()` instance** (not the fully-configured
  one in mdWebview.ts — importing that would create a livePreview/ <-> mdWebview.ts
  circular import) through `.render()`, giving pixel-identical output to Reading
  mode's table rendering for free (same `<table>` structure, same inline
  bold/italic/code/link handling inside cells, since those are core markdown-it
  behavior not plugins). Only duplicated: the `table_open` rule that injects the
  `md-table` class, so `resources/md/mdWebview.css`'s existing
  `.markdown-preview table.md-table` rules apply automatically — `#markdownPreview`
  carries the static `.markdown-preview` class regardless of which engine is
  mounted inside it, so no new CSS was needed beyond a one-line `.cm-md-table-widget`
  display/cursor rule in `cm6Theme.ts`.
- Click-to-edit: `TableWidget.ignoreEvent()` only lets `mousedown`/`click` through
  to CM6 (everything else is swallowed so the rendered table's own DOM doesn't do
  native browser text-selection). A click inside the widget places the cursor at
  the nearest CM6-computed position for that block (typically the block's start
  or end, not pixel-exact into a specific cell) — acceptable for v1; the reveal
  then kicks in on the next decoration recompute, same reveal-on-approach pattern
  as everything else in this engine.
- Gated under the same `xlsxViewer.md.livePreviewReveal` setting/compartment as
  the mark/heading reveal engine (`tableWidgetPlugin` bundled alongside
  `livePreviewRevealPlugin`) rather than a separate toggle — one setting, and
  conceptually it's the same "hide raw syntax away from the cursor" feature even
  though the implementation differs (widget replace vs. inline hide).
- Accepted v1 gaps: cell content using emoji/katex/other markdown-it plugin
  syntax won't render specially (the bare instance has no plugins loaded — the
  fully-configured instance isn't reachable from here without the circular-import
  problem above); no hover row/col add/remove buttons (that was one of the two
  alternatives the user explicitly passed on).
- **New constraint discovered for every file under `livePreview/`**: Node's
  native TS type-stripping (what `npm run test:unit` relies on) is *strip-only* —
  it errors on TS syntax that has runtime effect, not just erasable type
  annotations. `constructor(readonly source: string)` (a parameter property)
  broke `node --test` with `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` even though `tsc`
  and `eslint` were both totally fine with it. Fixed by declaring the field and
  assigning it in the constructor body instead. Worth remembering before writing
  more classes in this directory — parameter properties, `enum`, and namespaces
  are the usual TS-syntax-with-runtime-semantics culprits Node's stripping can't
  handle; plain type annotations, interfaces, and `type` aliases are fine.

4 new headless unit tests (widget-decoration range/source, cursor-inside no-op,
no-table no-op, `TableWidget.eq`) — 25/25 total. `npm run compile`: 0 type + 0
lint errors. Manual F5 smoke test still outstanding — add to the checklist:
table renders as a real grid when cursor is elsewhere; clicking into it reveals
raw pipe text; clicking away re-renders the grid; edits to the raw text are
reflected in the re-rendered grid.

---

## Phase 5 — completion notes (formatting parity)

**Status:** code complete. `npm run test:unit`: 55/55 pass (30 new + 25 carried
over). `npm run compile`: 0 type + 0 lint errors. Manual F5 smoke test still
outstanding (same GUI constraint as every prior phase).

**What landed**
- New `livePreview/formatCommands.ts`: rewritten bodies (per the Architecture
  section's explicit "rewrite, not accessor-swap" framing) of all 18 commands
  the plan named — `wrapSelection` (bold/italic/strikethrough/inlineCode),
  `toggleLinePrefix` (heading1-3/bulletList/orderedList/checkbox/blockquote),
  `insertAtCursor`/`insertLink`/`insertImage`/`insertTable`/`insertHorizontalRule`,
  `toggleCodeBlock`, `multiLineIndent`, `duplicateLine`, `deleteLine`,
  `moveLineUp`/`moveLineDown`, `selectWord`, `transformCase`,
  `sortSelectedLines`, `trimTrailingWhitespace` — each split into a pure
  `computeXxx(state, ...) -> TransactionSpec | null` (headlessly testable, same
  shape as `computeRevealDecorations`/`computeTableDecorations`) plus
  `runFormatCommand(view, action)`, one dispatch table shared by the toolbar
  and the keymap. Also added `jumpToLine` (prompt + `scrollIntoView`) — not in
  the plan's literal command list, but the toolbar has a "Go to Line" button
  that's live in both modes, so leaving it CM6-inert would be a silent
  regression for that button specifically in Preview Edit mode.
- `livePreviewFormatKeymap` (`KeyBinding[]`): Tab/Shift-Tab (no CM6 default
  exists — without this, Tab would move focus out of the editor) plus the
  full Split-mode Mod-key shortcut set (`Mod-b/i/k/e/Shift-e/Shift-x/l/Shift-l/
  1/2/3/Shift-d/Shift-k/d/g/Shift-u/u`, `Alt-ArrowUp/Down`). Wired into
  `livePreviewEditor.ts`'s extensions *before* `keymap.of([...defaultKeymap,
  ...historyKeymap])` so it wins over any colliding default binding (e.g.
  defaultKeymap's own `Mod-i` → `selectParentSyntax`).
- `livePreviewEditor.ts` gained `applyLivePreviewFormat(action)` — the one new
  export mdWebview.ts calls; it keeps the module-private `view` singleton from
  leaking out (same encapsulation as every other exported wrapper here),
  branches `undo`/`redo` to the existing `livePreviewUndo`/`livePreviewRedo`,
  and otherwise delegates to `runFormatCommand` + refocuses the view.
- `mdWebview.ts` wiring: `applyFormat` gained a third branch — `isPreviewEditMode
  && isLivePreviewActive()` now gates the four WYSIWYG-only table-structure
  actions behind the existing toast (same as Split mode) and otherwise calls
  `applyLivePreviewFormat`. The legacy `preview.addEventListener('keydown', …)`
  block (Mod+B/I/K/etc. → `applyWysiwygFormat`) now bails immediately when
  `isLivePreviewActive()`, so it no longer double-fires (or no-ops against a
  DOM that no longer exists) once a CM6 keydown bubbles up to `#markdownPreview`.

**Design decision: Enter/Backspace list continuation is NOT hand-rolled**

The plan's Architecture section says Enter-key list continuation should
"become a CM6 keymap command." Before writing one, checked what
`@codemirror/lang-markdown`'s `markdown({ extensions: GFM })` call (already in
`livePreviewEditor.ts` since Phase 1) installs by default: `addKeymap` defaults
to `true`, which installs `markdownKeymap` — `Enter` → `insertNewlineContinueMarkup`,
`Backspace` → `deleteMarkupBackward` — at `Prec.high`. That's already active
and already handles bullet/ordered/checkbox continuation *and* blockquote
continuation, which the legacy regex (`mdWebview.ts`'s old Enter handler) never
supported. Reimplementing it by hand would both duplicate an already-shipped
mechanism and regress the blockquote case. Same reasoning the plan itself
already applied to the slash menu (`@codemirror/autocomplete` over a
hand-rolled popup, r1→r2) — reused rather than re-litigated here. Net effect:
Phase 5 needed zero new code for Enter continuation; it verified the existing
default rather than adding to it.

**Design decision: hand-rolled commands, not CM6's built-in equivalents**

`@codemirror/commands` exports its own `deleteLine`/`moveLineUp`/`moveLineDown`/
`indentMore`/`indentLess` — tempting to reuse instead of porting. Went with a
port anyway: those built-ins are multi-cursor/language-indent-aware and
deliberately don't match the legacy single-cursor, hardcoded-4-space semantics
this phase is required to preserve ("match today's Split-mode behavior" is the
phase's own acceptance bar). `computeTabIndent`/`computeMultiLineIndent` hard-code
4 spaces exactly like the legacy `multiLineIndent`, not the language's
`indentUnit` facet.

**Explicitly deferred / unchanged**
- The four WYSIWYG-only table-structure actions (`tableAddRowBelow` etc.) still
  show "available in WYSIWYG mode" in CM6 mode — unchanged from the Phase 4
  table-widget v1 gap (no hover row/col buttons), just now gated consistently
  instead of silently no-oping.
- `sortLinesDesc` has no toolbar button in either mode (pre-existing); ported
  and unit-tested anyway since it's one line of dispatch-table reuse once
  `sortSelectedLines(state, descending)` exists.

**Bundle-size delta (`dist/md/mdWebview.js`)**
- Dev (unminified): 11,001,672 → 11,018,170 B (**+16.1 KB**)
- Production (minified): 5,242,298 → 5,249,704 B (**+7.2 KB**)
- Small relative to Phases 1/4 — no new dependency, just new source.

**Verification**
- `npm run test:unit`: 55/55 (30 new cases in `formatCommands.test.mts`, one
  wrap/unwrap or boundary pair per ported command).
- `npm run compile`: 0 type errors, 0 lint warnings.
- Manual F5 smoke test **not run** (no GUI in this session). Checklist for
  whoever runs it, in addition to Phases 1-4's: every formatting toolbar button
  in Preview Edit mode (bold/italic/strikethrough/inline-code/code-block/
  headings 1-3/bullet+ordered+checkbox lists/blockquote/link/image/table/hr/
  duplicate+delete+move line/select word/go-to-line/upper+lower+title case/sort
  lines/trim whitespace) against a CM6-mounted document; the four table-structure
  buttons show the "WYSIWYG mode" toast instead of no-op; every Mod-key shortcut
  from the list above plus Tab/Shift-Tab (single line and multi-line selection)
  and Alt+Up/Down; pressing Enter inside a bullet/ordered/checkbox/blockquote
  list continues it; toggle `livePreviewEngine` to `legacy` and confirm the old
  WYSIWYG toolbar/shortcuts still work unchanged.

---

## Phase 6 — completion notes (slash menu, Improvement 2)

**Status:** code complete. `npm run test:unit`: 65/65 pass (10 new + 55 carried
over). `npm run compile`: 0 type + 0 lint errors. Manual F5 smoke test still
outstanding (unchanged constraint from every prior phase).

**What landed**
- New `livePreview/slashMenu.ts`: a 12-entry option table — `Text`, `Heading
  1`-`4`, `Bulleted List`, `Numbered List`, `To-do List`, `Callout`, `Quote`,
  `Table`, `Divider` — covering every block transform the plan named. Split
  the same way as every other module here: a pure `computeSlashApply(option,
  from, to) -> TransactionSpec` (headlessly testable) plus a thin
  `slashMenuCompletions: Completion[]` whose `apply` just calls it and
  `view.dispatch`s. `slashMenuSource` (a `CompletionSource`) fires only when
  the *entire current line* is `/` plus letters — i.e. a lone slash at the
  start of an otherwise-empty line, per the plan's exact wording — and its
  `from` starts right *after* the `/` so CM6's built-in fuzzy filter matches
  against the typed word, not the slash itself; `apply` reaches one position
  further back (`from - 1`) to remove the slash too.
- `livePreviewEditor.ts`: one new extension, `autocompletion({ override:
  [livePreviewSlashSource], icons: false })`. `override` replaces
  `@codemirror/lang-markdown`'s incidental HTML-tag-completion default (an
  unrelated side effect of `markdown({..})`, not something the plan asked to
  keep) — deliberate, since the plan frames autocomplete as *the* slash-menu
  mechanism here, not a shared multi-purpose completer.
- `cm6Theme.ts`: styled `.cm-tooltip.cm-tooltip-autocomplete` and its option
  list off the same `--bg-color`/`--border-color`/`--selection-bg` vars
  everything else here uses. Confirmed this reaches the tooltip DOM despite it
  not being a literal descendant of `.cm-editor`: `@codemirror/view`'s tooltip
  manager re-applies `view.themeClasses` onto the tooltip's own container
  (`this.container.className = this.view.themeClasses`), so `EditorView.theme()`
  rules keep matching it exactly as if it were nested normally — verified by
  reading `TooltipViewManager`/`createContainer` in `@codemirror/view`'s
  source rather than assuming.

**Design decision: no new hand-rolled Enter/Tab handling needed**

`autocompletion()` installs its own keymap (`completionKeymap`) at
`Prec.highest` — above `@codemirror/lang-markdown`'s `Prec.high` Enter/Backspace
binding and above `livePreviewFormatKeymap`'s Tab binding from Phase 5. Its
commands (`acceptCompletion`, `moveCompletionSelection`, etc.) check "is a
completion active" internally and return `false` (falling through to the next
keymap) when it isn't. So while the slash menu is open, Enter/Tab/Arrow keys
pick an option; the moment it closes, those same keys revert to Phase 5's
formatting shortcuts and `markdownKeymap`'s list continuation with no
coordination code of this phase's own — this is exactly the "gives all of
that for free" reasoning the plan's r1→r2 diff already used to justify
`@codemirror/autocomplete` over a hand-rolled popup, now also covering the
precedence question against the keymaps Phase 4/5 added after r2 was written.

**CSP:** re-verified for this specific package (Phase 1's grep predated
`@codemirror/autocomplete` actually being imported): `grep` over
`@codemirror/autocomplete/dist` finds no `eval`/`new Function`/`fetch`/
`XMLHttpRequest`/`WebSocket`. No CSP change.

**Explicitly deferred**
- No slash-menu entry for tables/callouts/etc. carries a preview icon or
  description — `icons: false` was chosen for a plainer, Notion-style text
  list; if a future pass wants icons per type, that's a per-option `type`
  field change plus CSS, not a structural one.

**Bundle-size delta (`dist/md/mdWebview.js`)**
- Dev (unminified): 11,018,170 → 11,081,258 B (**+61.6 KB**)
- Production (minified): 5,249,704 → 5,281,801 B (**+31.3 KB**)
- Larger than Phase 5's delta because `@codemirror/autocomplete` was installed
  since Phase 1 but never actually imported until now — this is the first
  phase paying for that package's parse/bundle cost.

**Verification**
- `npm run test:unit`: 65/65 (10 new cases in `slashMenu.test.mts`: source
  fires/doesn't-fire across 5 trigger-condition cases, the full option-label
  list, and `computeSlashApply` for Heading/Callout/Table/Text).
- `npm run compile`: 0 type errors, 0 lint warnings.
- Manual F5 smoke test **not run** (no GUI in this session). Checklist for
  whoever runs it, in addition to Phases 1-5's: typing `/` at the start of an
  empty line opens the menu; typing more letters filters it; Arrow keys +
  Enter (and Tab) pick an option; Escape closes it without inserting anything;
  typing `/` mid-sentence or after other line content does *not* open it;
  each of the 12 options produces the right block (headings visually resize
  per Phase 4's reveal engine once the cursor leaves the line; Callout renders
  via the existing `:::info` container styling; Table renders via Phase 4's
  `TableWidget` once the cursor leaves it); toggle `livePreviewEngine` to
  `legacy` and confirm the legacy WYSIWYG mode is unaffected (it has no slash
  menu, by design — Preview Edit's CM6 engine only, per the plan's confirmed
  v1 scope).

---

## Phase 7 — completion notes (extend reveal set)

**Status:** code complete. `npm run test:unit`: 75/75 pass (10 new + 65
carried over). `npm run compile`: 0 type + 0 lint errors. Manual F5 smoke test
still outstanding (unchanged constraint from every prior phase).

**What landed** — all in `revealDecorations.ts`/`revealDecorations.test.mts`,
reusing `computeRevealDecorations`'s existing hide-marker/style-content shape,
per the plan's "reusing this machinery" framing:
- **Strikethrough**: `handlePairedMarks` (Phase 4's bold/italic helper)
  generalized to take a mark-node-name parameter instead of a hardcoded
  `'EmphasisMark'`, then reused as-is for `Strikethrough`/`StrikethroughMark` →
  `cm-md-strike-content`. Zero new logic, one parameter.
- **Inline code**: hides/dims the two `CodeMark` backticks only — no content
  span. `codeStylingPlugin` (Phase 4) already owns the always-on monospace/
  background look for `InlineCode`; this phase only layers the marker
  hide/dim on top of it, exactly the split the Phase 4 notes called for
  ("hiding them is reveal-marker territory... stays Phase 7 scope"). The two
  decoration sets are independent `ViewPlugin`s composed by CM6, not merged —
  confirmed no conflict from a `Decoration.mark` (codeStyling) and a
  `Decoration.replace` (reveal) both touching the same backtick position.
- **Links**: verified the real parse tree first (same discipline as Phase 4's
  `***bold-italic***` check) rather than assuming CommonMark's usual shape —
  `Link` → `LinkMark("[")`, `LinkMark("]")`, `LinkMark("(")`, `URL`,
  `LinkMark(")")`, with the label as bare text (no wrapping node). Hides `[`
  alone and `](url)` as one combined span; styles the label text
  `cm-md-link-content` (accent color + underline). Images (`![alt](url)`)
  are untouched — not named in the plan's Phase 7 list.
- **Blockquotes**: hides/dims each line's `QuoteMark` (`>`) and adds a
  `Decoration.line` per line (`cm-md-blockquote-line` — left border + tint,
  mirroring the legacy renderer's `blockquote` CSS) for the indent/border
  look, mixing inline and line decorations in one `Decoration.set` the same
  way `codeStyling.ts` already mixes `InlineCode` marks with `FencedCode`
  lines. "Active" is node-wide — cursor anywhere in the quote dims every
  line's `>` together, not just the line the caret is on — same granularity
  as headings/paired marks, to avoid marks flickering independently as the
  caret moves within one quote.
- **List markers + task checkboxes**: `ListMark` (bullet/number) gets an
  always-on `cm-md-list-mark` accent class; `TaskMarker` (`[ ]`/`[x]`) gets
  `cm-md-task-marker`/`cm-md-task-marker-done`, and a done item's remaining
  text gets `cm-md-task-done-content` (strikethrough + muted) — see the
  design note below for why these never hide. Note this is narrower than
  `codeStyling.ts`'s "always-on": list/task styling still lives inside
  `computeRevealDecorations`, so — like every other content class in this
  file — it disappears if `livePreviewReveal` is switched off. Only the
  *cursor-position* independence (never hides/dims based on where the caret
  is) is the actual claim; independence from the setting is not.

**Design decision: list/task markers are styled, never hidden**

Every other mark this engine touches (`#`, `**`, `*`, `~~`, `` ` ``, `[]()`,
`>`) is pure decoration layered on otherwise-plain text — once the styled
content is visible, the marker itself is redundant clutter, so hiding it on
cursor-away is a pure improvement. A list bullet or number is not decoration
on top of something else; it is the *only* signal that a line is a list item
at all. Hiding it would make list items indistinguishable from indented
paragraphs the moment the cursor leaves — a worse reveal than no reveal, and
not what Obsidian's own Live Preview does either (it restyles bullets, never
hides them). So list/task markers get the same "always-on baseline look"
treatment as `codeStyling.ts`'s monospace/background — restyled, never
`Decoration.replace`d — rather than being folded into the hide/dim branch
alongside everything else in this file.

**Bug caught by testing, not by inspection: blockquote continuation lines
aren't direct children of `Blockquote`**

First implementation called `node.getChildren('QuoteMark')` on the
`Blockquote` node itself, assuming every line's `>` was a direct child
(sibling per-line marks) — modeled on how heading/paired-mark handling already
worked. Wrong: dumping the real tree for a 2-line quote (`node.parent` at each
step, not just node names) showed line 1's `QuoteMark` *is* a direct child of
`Blockquote`, but line 2's is nested **inside the continuing `Paragraph`**
instead — CommonMark's lazy-continuation rule merges un-blank-line-separated
quote lines into one paragraph, and the parser nests the second line's marker
inside that paragraph rather than keeping it a `Blockquote` sibling. The unit
test (2 lines, cursor away, expecting 4 hidden spans) caught this immediately
— got 2, not 4. Fixed by moving mark-handling out of the `Blockquote` node's
handler entirely: `QuoteMark` is now its own top-level dispatch case,
handled wherever `iterate()` finds it regardless of nesting depth, walking
`.parent` up to the enclosing `Blockquote` for the node-wide active check.
`handleBlockquote` itself now only owns the per-line block decoration (which
was never affected by this bug, since it derives from `node.from`/`node.to`
line numbers, not child traversal). Same lesson as Phase 4's nested-emphasis
verification, this time caught by the test rather than by inspection first —
worth remembering for any future per-line block-node child lookup in this
grammar.

**Explicitly out of scope for this phase**
- Fenced-code fence delimiters are unaffected — the plan's Phase 7 list names
  "inline-code," not fenced code; `codeStyling.ts`'s always-visible fences are
  unchanged.
- No interactive checkbox widget (click-to-toggle `[ ]`/`[x]`) — styling only,
  consistent with "extend reveal set," not "build a new widget" (that would be
  Phase-4-table-widget-scale work, not asked for here).
- Image reveal (`![alt](url)`) — not named in the plan's Phase 7 list.

**Bundle-size delta (`dist/md/mdWebview.js`)**
- Dev (unminified): 11,081,258 → 11,085,965 B (**+4.6 KB**)
- Production (minified): 5,281,801 → 5,283,936 B (**+2.1 KB**)
- Smallest delta of any phase so far — no new dependency, and the new logic
  reuses `computeRevealDecorations`'s existing machinery almost entirely.

**Verification**
- `npm run test:unit`: 75/75 (10 new cases: strikethrough/inline-code/link
  cursor-in/out pairs, blockquote away + node-wide-active, list-marker
  always-on across bulleted/ordered, task-marker todo/done).
- `npm run compile`: 0 type errors, 0 lint warnings.
- Manual F5 smoke test **not run** (no GUI in this session). Checklist for
  whoever runs it, in addition to Phases 1-6's: type `~~strike~~`/`` `code` ``/
  `[text](url)` and confirm marks hide away from the cursor and dim (styling
  persists) when the cursor is in them; type a multi-line `>` blockquote and
  confirm the left-border/tint renders on every line and the `>` on ALL lines
  dims together when the cursor is anywhere in the quote; type `- `/`1. `/
  `- [ ]` list items and confirm the bullet/number/checkbox gets the accent
  styling and never disappears regardless of cursor position; check a task
  item (`- [x]`) and confirm its text renders struck-through; toggle
  `livePreviewReveal` off and confirm ALL of the above content styling
  disappears (list/task included — that styling lives in the same
  compartment-gated plugin as headings/bold/italic, unlike `codeStyling.ts`'s
  inline-code/fenced-code look, which is a separate always-on plugin and
  should be the only thing still styled once reveal is off).

**Post-phase-7 fix (real F5 feedback, 2026-07-07): typing a new heading
blanked EVERY heading in the document**

First real manual-testing feedback across all 7 phases (via `samples/test.md`
in the actual Extension Development Host — something this session couldn't
do itself, no GUI available). Reported symptom: create a new heading, and
immediately every existing heading in the document drops to body size and
shows its raw `#`s, recovering only after a save.

Root cause, confirmed by reproducing headlessly rather than guessed: typing
`#` or `# ` is a valid, title-less `ATXHeading` per CommonMark (a heading with
empty content is legal) — for that state, `handleHeading`'s final line pushed
a `Decoration.mark()` over a **zero-length** content span (`gapEnd === node.to`
when there's no title text yet). CM6 throws `"Mark decorations may not be
empty"` for that. Confirmed directly:
```
computeRevealDecorations(stateFor('#'), 0, 0, [{from:0,to:1}])
// -> throws "Mark decorations may not be empty"
```
A `ViewPlugin` that throws inside `update()`/its decorations getter loses its
decorations for the **whole plugin**, not just the node that triggered it — so
every other heading in the document lost its reveal styling simultaneously,
exactly matching the report. It self-heals once the heading gets non-empty
title text (confirmed by typing it character-by-character in a repro script),
which is why it looked save-dependent rather than permanent: by the time you
finish typing a title and reach for Ctrl+S, the exception has usually already
stopped recurring.

The same zero-length-range hazard existed at two more call sites doing the
identical "push a content `Decoration.mark` between two marks" pattern: an
empty link label (`[]()`) in `handleLink`, and (defensively, could not
actually make it throw, but the shape is identical) a done task item with
nothing after the checkbox in `handleTaskMarker`. `handlePairedMarks`
(bold/italic/strikethrough) turned out not to be reachable empty in
practice — lezer doesn't parse `****`/`~~~~` as `StrongEmphasis`/`Strikethrough`
at all when the content would be empty, so the node never exists — but guarded
it anyway rather than leave an unguarded call site relying on "the grammar
happens not to do that," given this whole bug was exactly that kind of
assumption failing.

Fix: guard every content-span push in `revealDecorations.ts` with a
non-empty-range check (`if (from < to) { specs.push(...) }`) before calling
`Decoration.mark()`. Four new regression tests in
`revealDecorations.test.mts`: empty heading/empty link don't throw, a done
task with nothing after the checkbox doesn't throw, and — the one that
actually encodes the reported bug — typing a brand-new heading character by
character never disturbs an *existing* heading elsewhere in the same document
(79/79 total, `npm run compile` clean).

This is also the first concrete payoff of the "no GUI in this session"
caveat repeated in every phase's notes above: a real F5 session found a bug
in under a minute that seven phases of headless testing and code review had
not, because the specific failure mode (an exception silently blanking a
*different* node than the one being edited) only shows up when something is
actually rendering pixels.

**Post-phase-7 fix #2 (same F5 session): dimmed "#" rendered smaller than the
heading text next to it, and headings were underlined**

Two more visual reports from the same manual pass.

*Marker size mismatch.* When the cursor is on a heading, the dimmed `#` used
plain `cm-md-reveal-mark` (color + opacity only, no font-size rule) — at the
base editor font size, next to heading content sitting at up to `2em`. Fixed
by giving the active-state marker decoration a level-matched class,
`cm-md-reveal-mark cm-md-h${level}`, and merging the marker + its trailing gap
space into one combined span (previously two separate pushes) so the space
between them isn't yet a third, unstyled size. Same treatment applied to the
rare `## Title ##` closing-marker form. One existing test's expected shape
changed to match (marker range widened from 1 char to 2, class gained the
`cm-md-hN` suffix) — updated rather than left broken.

*Underline — two attempts, only the second one actually verified working.*
First attempt: added `textDecoration: 'none !important'` to `.cm-md-h1`-`.cm-md-h6`
in `cm6Theme.ts`, reasoning that `@codemirror/language`'s `defaultHighlightStyle`
underlines anything tagged `tags.heading` (`@lezer/markdown` tags ATXHeading1-6
as `heading1`-`heading6`, which fall back to matching the more general
`heading` tag when no specific rule exists) and `!important` should win
regardless of cascade order. **User reported the underline was still there
after that fix.** Rather than keep guessing at *why* `!important` didn't
visibly win (competing hypotheses considered: stale build — ruled out, `grep`
confirmed the change was in `dist/md/mdWebview.js`; CSS's `text-decoration`
historically not being cancelable by a descendant when set on an ancestor —
plausible but unverifiable here, no jsdom/browser available in this session
to inspect actual rendered class lists) — removed the competing rule at its
source instead of continuing to fight it blind: dropped
`syntaxHighlighting(defaultHighlightStyle, { fallback: true })` from
`livePreviewEditor.ts`'s extensions entirely, and reverted the now-pointless
`!important` back to plain `fontSize`-only rules in `cm6Theme.ts`.

Checked this was safe to remove outright, not just for headings: `markdown({
extensions: GFM })` is never given a `codeLanguages` config, so
`defaultHighlightStyle`'s programming-language rules (keyword/string/comment/
regexp/...) were never reachable in the first place; its `heading`/`emphasis`/
`strong`/`strikethrough` rules were always redundant with this file's own
(more capable — hide/reveal, not just static color) decorations; its `meta`/
`link`/`url` colors are hardcoded light-theme hex values that were never
theme-aware to begin with, same as every other rule in it. It was unexamined
Phase-1 boilerplate (the kind of default every CM6 tutorial includes) rather
than a real dependency — its only *observed* effect this whole time was the
bug just reported. If embedded fenced-code language highlighting is ever
added (a `codeLanguages` config for `markdown()`), whoever adds it should
bring back a highlighter scoped to what's actually needed then, not restore
this one blind.

**Lesson for this plan doc going forward:** a fix that "should work" per
static reasoning about a library's internals is not verified until it's
been *seen* to work, or until the competing mechanism has been removed
outright rather than merely out-ranked. The first underline fix is the first
documented instance in this plan of a fix landing, compiling clean, and
still being wrong — worth remembering given every phase above has been
proceeding on code-review + headless-test confidence alone.

**Post-phase-7 fix #3 (same F5 session): inserting a table froze the editor**

The most serious bug of this whole plan, and the clearest illustration yet of
the "no GUI in this session" gap. Reported symptom: type `/table` (or click
the toolbar's Insert Table button) in Preview Edit mode — nothing happens, the
cursor doesn't move, and the editor appears to freeze.

Every layer of this was already covered by an existing passing headless test
(`computeInsertTable`, `computeSlashApply`'s Table case, `computeTableDecorations`
all pass in isolation), which is exactly why it survived 7 phases undetected —
none of those tests ever construct a real `EditorView`. Phase 3 scoped that
out on purpose ("no VS Code host, no DOM"), and no manual F5 smoke test had
been run by anyone until this session.

With no display available in this sandbox either, installed `jsdom` as a
temporary, unsaved dependency (`npm install --no-save jsdom`, never touched
`package.json`/the lockfile) to construct a *real* `EditorView` — the only way
to get past pure code-reading for a bug that only manifests when something
actually renders. First repro attempt (typing "/table" character by character,
then manually invoking the found completion's `apply`) hit the actual failure
immediately:
```
RangeError: Block decorations may not be specified via plugins
    at ... TileUpdate.emit ... at ... DocView.update ...
```
Root cause, confirmed by reading @codemirror/view's actual installed source
(not assumed): a block-level `Decoration.replace({ block: true, widget })` —
what `tableWidget.ts` uses, since there's no inline way to render a real
`<table>` grid — **cannot come from a `ViewPlugin`**. CM6's decorations facet
tracks whether each source is a plain value or a function
(`typeof d == "function"`); `ViewPlugin.fromClass(..., { decorations: v =>
v.decorations })` registers a function, which gets flagged in
`dynamicDecorationMap`/`disallowBlockEffectsFor`, and `TileUpdate.emit` throws
the moment it hits a `block: true` point-decoration from a flagged source. A
`StateField`'s `provide: f => EditorView.decorations.from(f)` registers the
field's plain value instead — not flagged, block decorations allowed. This is
a real, if easy to miss, CM6 API rule: block widgets need a `StateField`,
ordinary mark/replace/line decorations (everything else in this engine,
including the `Decoration.line` blockquote/fenced-code decorations added in
Phases 4 and 7) don't care and work fine from either.

Fix: `tableWidget.ts`'s `tableWidgetPlugin` (`ViewPlugin`) became
`tableWidgetField` (`StateField<DecorationSet>`). The one real cost: a
`StateField` has no `view.visibleRanges` — it only sees `EditorState`/
`Transaction` — so `computeTableDecorations` (unchanged, still takes the same
`visibleRanges` parameter for the headless tests) is now always called with
the whole document as its one "visible range," rather than the true viewport.
Accepted: it's filtered to just `Table` nodes, which are comparatively rare
next to what `revealDecorations.ts` scans for on every keystroke, so full-doc
scope here doesn't carry the same cost the "never the whole doc" rule was
guarding against for the mark-level reveal engine.

Re-ran the same jsdom repro against the fix: insert → renders as a widget →
click away → click back in (reveals raw text) → type inside it, all in single-
digit milliseconds, no throw. `livePreviewEditor.ts` updated at both of
`tableWidgetPlugin`'s two use sites (initial mount, `setLivePreviewReveal`'s
compartment reconfigure). No test changes needed — `computeTableDecorations`'s
signature and behavior are untouched; only *what calls it and how* changed.
79/79 tests still pass, `npm run compile` clean.

**Why this one is worth calling out beyond the other post-phase-7 fixes:** the
heading-empty-range bug earlier in this session was silent (decorations
quietly vanished); the underline bug was cosmetic. This one is an *uncaught
exception inside CM6's synchronous render path* — a category of bug that can
leave the editor in a broken state rather than just looking wrong, and it's
the first bug in this entire plan that pure code review and 79 passing
headless tests were structurally incapable of catching, because the failure
condition is a property of *which CM6 primitive provides a decoration*, not
of what the decoration contains — invisible to any test that never
constructs a real `EditorView`. Recorded here as a flag for Phase 8: if any
future addition to this engine needs a block-level widget, it needs to go
through `EditorView.decorations.from(field)`, not `ViewPlugin`, and there is
currently no test in this repo that would catch it if someone got that wrong
again.
