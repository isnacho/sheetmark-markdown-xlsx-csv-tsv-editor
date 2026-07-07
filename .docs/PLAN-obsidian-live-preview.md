# Obsidian-style live preview + slash menu for Markdown "Preview Edit" mode

> Revision 2. Changes from r1: corrected the formatting-command port framing
> (rewrite, not accessor-swap); added an explicit dual-surface state-sync
> contract; reordered phases so there is no regression window; added a headless
> test-harness phase; added a kill-switch flag with deferred deletion; slash menu
> now built on `@codemirror/autocomplete`; CSP explicitly verified.

## Context

Today's "Preview Edit" (WYSIWYG) mode renders markdown-it HTML into a
`contentEditable` `#markdownPreview`, and on save/mode-switch converts that
HTML back to markdown via `turndown` (`extractCurrentEditorContent`,
[mdWebview.ts:801](../src/webviews/md/mdWebview.ts#L801)).
That architecture can't cleanly support "show `##`/`**` near the cursor,
hide it otherwise" — the DOM has already thrown the raw syntax away.

Decision made with the user: rebuild "Preview Edit" mode on **CodeMirror 6**,
the same engine class Obsidian's Live Preview uses — raw markdown stays the
single source of truth, and a decoration layer hides/reveals syntax markers
based on cursor position. Split mode (raw textarea) and Reading mode (static
preview) are untouched. This also **removes the turndown round-trip entirely**
for this mode. Verified: turndown has exactly one `.turndown()` call site
([mdWebview.ts:814](../src/webviews/md/mdWebview.ts#L814)) plus its
`new TurndownService(...)` / `.use(gfm)` setup — all three go away once
extraction no longer needs HTML→MD.

Confirmed scope for v1 (from user):
- Reveal-on-cursor covers **headings + bold + italic** first; strikethrough/
  inline-code/links/blockquote/lists follow in a later phase.
- Slash-menu works in **Preview Edit mode only**.
- Slash-menu's "Callout" option reuses the **existing `:::info/warning/error/success`**
  container syntax (already parsed by `markdown-it-container`) — no new syntax.
- Tables become **plain always-visible markdown text** in the new editor —
  today's hover add/remove row/col buttons are dropped for v1 (revisit as a
  follow-up if missed).
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
  [resources/shared/theme.css](../resources/shared/theme.css)
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
([mdWebview.ts:921,932,953](../src/webviews/md/mdWebview.ts#L921)) and
`setEditMode`/`setPreviewEditMode` both seed content from `currentContent`
([mdWebview.ts:686-697,734](../src/webviews/md/mdWebview.ts#L686)). The turndown
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
[mdWebview.ts:2033-2090](../src/webviews/md/mdWebview.ts#L2033): each helper
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
[mdWebview.ts:1993-2414](../src/webviews/md/mdWebview.ts#L1993)):
`wrapSelection`, `toggleLinePrefix`, `insertAtCursor`, `insertLink`,
`insertImage`, `insertTable`, `insertHorizontalRule`, `toggleCodeBlock`,
`toggleCheckboxList`, `toggleBlockquote`, `multiLineIndent`, `duplicateLine`,
`deleteLine`, `moveLineUp`/`moveLineDown`, `selectWord`, `transformCase`,
`sortSelectedLines`, `trimTrailingWhitespace`. Enter-key list continuation +
Tab-indent ([mdWebview.ts:3195-3294](../src/webviews/md/mdWebview.ts#L3195))
become CM6 `keymap` commands using `state.doc.lineAt(range.head)`.

**Not ported (deleted, not migrated):**
- `pushUndoState`/`performUndo`/`performRedo` + `previewUndoStack`/`previewRedoStack`
  — replaced by CM6's `history()` extension.
- `applyWysiwygFormat`, `getPreviewSnapshot`/`restorePreviewSnapshot`, and the
  ~500-line table-hover-editing subsystem (`createTableHoverControls`,
  [mdWebview.ts:2570-3075](../src/webviews/md/mdWebview.ts#L2570)) — all
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

The md webview CSP ([mdEditorProvider.ts:595](../src/mdEditorProvider.ts#L595))
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
  [mdWebview.ts:1252-1290, 3538-3564](../src/webviews/md/mdWebview.ts#L1252)):
  derive the active heading from CM6 viewport/line info; click-to-heading uses
  CM6's scroll effect instead of `Element.scrollIntoView`.
- **Search-in-preview when in Preview Edit mode** (`doSearch`,
  [mdWebview.ts:1371-1464](../src/webviews/md/mdWebview.ts#L1371)): swap the
  TreeWalker+Range trick for a `@codemirror/search` extension. Reading/Split
  search untouched (different DOM).
- **Click handling** inside Preview Edit (`wirePreviewInteractions`,
  [mdWebview.ts:3368-3536](../src/webviews/md/mdWebview.ts#L3368)):
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
   `.docs/MAP-mdWebview.md` line-range table and `.docs/MESSAGE-PROTOCOL.md`
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
