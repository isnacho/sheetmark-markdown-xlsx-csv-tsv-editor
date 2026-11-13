---
title: Markdown expand sections (collapsible blocks with a title)
slug: markdown-expand-sections
status: completed
created: 2026-11-12
updated: 2026-11-12
---

# Markdown expand sections (collapsible blocks with a title)

## Idea

Add "expands" to the extension so long content is easier to read. They would need a title. Example, as the user pasted it (the trailing "Let's brainstorm how a" was cut off in the original message):

```markdown
### 3. Exit conversation guide

<!-- expand -->

Open with 3 entries the teacher wrote: one ordinary entry, one pressure point or interruption, and one involving several tools. Then ask:

1. Walk me through this entry. What was happening?
2. Was that a typical day? What would have been different in a quiet or busy week?
3. You said [tool] was awkward. What do you do instead, and why?
4. Which tasks had to happen at a particular time, place or device, and which could wait?
5. Which part of your week would you most like to get back?
6. What did we not ask that we should have?

Close by explaining the incentive, what happens to the data and when the teacher will hear about the findings.

When an entry differs from something said in an interview or intake, don't challenge the teacher. Ask what was happening and use the difference as context during analysis.

<!-- /expand -->
```

## Brainstorm

**Goal:** long Markdown content is easier to read because sections can be collapsed under a title.

**File format (decided):** the standard HTML `<details>` / `<summary>`. It is portable (GitHub, GitLab, VS Code preview and Obsidian render it). The pasted `<!-- expand -->` comment markers are **not** the format; a file using them is not specially handled. `<details open>` means starts expanded; plain `<details>` means starts collapsed.

```markdown
<details open>
<summary>Exit conversation guide</summary>

Body in normal Markdown: lists, code, tables, nested toggles.

</details>
```

**Title:** the `<summary>` content. Plain text and a heading inside it (`<summary><h3>Title</h3></summary>`) are both accepted. In the editor the title row is styled like a heading, with a chevron.

**Why not `> ### Heading`:** it is already valid Markdown for a blockquote containing a heading (and callouts use `>`), so it would silently change existing files. The block also needs a clear end, which `</details>` gives.

**Editor behavior:**
- **Body stays editable (C1):** the open body is normal editable text. A closed block hides its body lines; if the cursor or a search hit lands inside a closed block, it opens automatically.
- **Tag lines always visible, dimmed (D2):** `<details>`, `<summary>...</summary>` and `</details>` are always shown, dimmed, so block boundaries are obvious.
- **Remembered state (B4):** the open/closed state toggled in the editor is remembered per file in extension state, starting from the file's `open` attribute. The file content is not changed by toggling.
- **Slash menu "Toggle" (E1):** wraps the current paragraph or selection in `<details>` / `<summary>`, with the cursor placed in the title.
- **Heading to toggle:** with the cursor on a heading, the action "Turn heading into toggle" wraps the section below it (until the next heading of the same or higher level) and uses the heading as the summary.
- **Open body style (E2):** a subtle left rule or indent so the body reads as part of the block.

**Fixed outcomes:**
- A `<details>` with no closing `</details>` is treated as plain text, never hides content.
- Nested toggles work; bodies can hold lists, code, tables, images.
- Collapsing never changes file content.
- Word/character stats, spellcheck and search still cover collapsed text.
- Follows the editor theme in light and dark.

**Out of scope (call made, correctable):** folding any heading in the UI with nothing saved in the file (VS Code/Obsidian style). The answer to that question was left blank; treat it as a possible separate idea, not part of this one. "Collapse all / expand all" (E3) and the hidden-line hint (E4) were not picked.

### Revision 2 (Notion-style, markup fully hidden): supersedes the parts of the spec above that conflict

Direction after trying the first build: the user should never see or know about `<details>`, `<summary>` or any tag. It should feel like Notion. Product decisions:

**Hidden markup (A1):** the opener line, the `<summary>` and `</summary>` lines and `</details>` are always hidden, even with the cursor in the title. Anything that does not match the exact shape is shown as raw text and never hides content.

**Creating a toggle by typing `> ` (replaces slash-only creation and `Cmd/Ctrl+Alt+T`, which is dropped):**
- Typing `>` then a space turns the block into a toggle. Only **paragraphs and headings** convert; list items, tables, code, frontmatter and fences just type `> ` as normal.
- Only typed input triggers it (never paste, never reopening a file). No conversion when the line already starts with `>` (nested quote).
- A paragraph becomes a toggle titled with its text, opened, with the cursor moved into an empty body.
- A heading becomes a toggle heading of the same level, and **everything below it up to the next heading of the same or higher level goes inside** (smaller headings stay inside as real headings). Model borrowed from Anytype's toggled headings; Notion itself does not document this, so it is our own behavior.
- For headings the `>` works typed **before the `#` signs** (at the start of the line) **or after them** (`### > `): both give the same result.
- Undo (`Cmd+Z`) right after a conversion restores the literal `> `.
- Cost accepted by the user: typing `> ` no longer makes a plain blockquote. Existing `>` quotes in files are untouched. New quotes: type `"` then a space (Notion's shortcut), or the slash-menu Quote.
- Slash menu keeps a "Toggle" entry (my call: add Toggle Heading 1, 2, 3 entries too).

**The title is the first block of the toggle, whatever it is (decided by the user):** it is a normal Markdown block, so inline formatting (bold, italic, code, links) works, and typing `## ` in the title makes it a heading like anywhere else. No plain-text-only restriction. Enter at the end of the title moves into the body (opening it); Backspace at the start of the title unwraps the toggle back to a normal block.

**Storage consequence:** `<summary>` cannot hold Markdown on one line, so Sheetmark writes the title as Markdown between blank lines inside the summary:

```markdown
<details open>
<summary>

### Title with **bold**

</summary>

Body in normal Markdown.

</details>
```

Sheetmark still **reads** the common one-line form `<summary>Title</summary>` (plain text title) written by other tools. Open risk to check before shipping: how GitHub and other renderers show Markdown inside `<summary>`; verify on GitHub in the plan phase.

**Also decided:** hover handle with a block menu (Turn into text, Start open/closed, Delete toggle) plus the keyboard behaviors above (D1+D2); Notion look with the chevron in the left margin and an indented body, no left rule (E1); open/closed clicks stay remembered per file outside the file (F1). Outline panel reads headings inside toggle titles for free, since they are real Markdown headings now.

**Fixed outcomes carried over:** file stays standard HTML; version preview and disk diff show raw text; copy across a toggle copies the markup; deleting a selection across a block removes it whole; spellcheck and word counts skip hidden tags.

## Plan

### Current plan (revision 2, approved)

#### Context
Idea file: `.docs/ideas/2-to-plan/markdown-expand-sections.md` (spec = `## Brainstorm`, "Revision 2"). The first build (uncommitted: `detailsTypes.ts`, `detailsEditing.ts`, `detailsExtension.ts` + tests, wiring in `livePreviewEditor.ts`, `slashMenu.ts`, `cm6Theme.ts`, prefs/protocol/host) showed dimmed tag lines and a one-line plain `<summary>`. New direction: tags never visible, `> ` + space converts a paragraph/heading into a toggle, the title is a real Markdown block (heading or inline formatting), Notion look. Reuse the first build's plumbing (open-state field/effect/callback, prefs, protocol, host, slash entry, tests harness); rewrite the detector, decorations and editing functions.

#### Format
Written by Sheetmark:
```
<details open>
<summary>

### Title **bold**

</summary>

body

</details>
```
Also read the legacy one-line `<summary>Title</summary>` (other tools, GitHub style). Detector rule for the new form: `<summary>` alone on its line, then a blank line, 1+ title lines (may be one empty line), a blank line, `</summary>`, then a blank line, then body lines up to `</details>`. Anything else is not a block (shown raw, never hides). Known cost to note in docs and test manually: on GitHub and other renderers the chevron may sit on its own line above the title (sources report this; unverified).

#### Steps
1. **Detector rewrite** (`detailsTypes.ts`): `findDetailsBlocks` returns per block: `titleFrom/titleTo` (editable title span), `legacy`, `hiddenRuns` (`{from,to}` offsets, each run from a tag line start to the next visible line start, so the line break is included and no ghost cursor spot remains), body range and line count, closer line, depth, id. Block id from `plainTitle(title)` (strip `#`, `*_~\``, link syntax, tags) + occurrence index. Closed state adds one run: body start through the closer line. New pure helpers: `toggleTagRanges(state)` (all runs, for exclusions) and `stripToggleTags(text)` (for stats). Keep fenced-code skipping.
2. **Decorations** (`detailsExtension.ts`): replace the dimmed tag-line classes with block `Decoration.replace({block:true, widget})` over each hidden run (zero-height `div`, `estimatedHeight 0`, `ignoreEvent true`, `eq` on range), in the existing `StateField` (outside `revealCompartment`). Legacy summary tags hide with inline replaces. All runs go into `atomicRanges`. Notion look: chevron widget at the title line with depth-based left offset (CSS var `--d`, 24px per level), title line padding `calc(var(--d)*24px + 22px)`, body lines indented `(depth+1)*24px`, no left rule; remove `cm-md-details-tag*` and `border-left` styles from `cm6Theme.ts`. Closed-body widget ("N hidden lines") stays. Line-number gutter gaps accepted.
3. **Typed shortcuts** (new `toggleInputRules.ts`, pure `computeXxx` + an `EditorView.inputHandler`): on a single typed space, (a) line before cursor is exactly `>` at column 0, or `#{1,6} >` after a heading marker, and the line is a paragraph or ATX heading (not list/table/fence/frontmatter/already `>`) converts to a toggle; heading swallows its section up to the next heading of the same or higher level (reuse the heading-section scan from `detailsEditing.ts`, fence-aware); paragraph becomes an open toggle with the cursor in the empty body (empty paragraph: cursor in the empty title); heading: cursor at end of title. (b) `"` alone at column 0 + space becomes `> `. Apply as two transactions (typed space first, then conversion with `isolateHistory.of('before')`) so one `Cmd+Z` restores the literal `> ` / `"`. Never fires for paste, slash menu or programmatic dispatch.
4. **Keys and structure guard** (`detailsExtension.ts`, `Prec.highest`, listed before `revealCompartment`; return false outside toggles): Enter in a title moves the cursor to the body start (opens it). Backspace at the start of a title unwraps the toggle (title and body stay as normal blocks); Backspace/Delete that would eat a hidden run just moves the caret across it without deleting. Remove `Mod-Alt-t`. An `EditorState.changeFilter` rejects any user change that deletes or overlaps hidden-run characters unless it covers the whole block (protects Alt+Arrow move line, duplicate/delete line, partial selections). Seed the initial cursor out of any hidden run (`cursorPosAfterFrontmatter` case).
5. **Hover handle and menu**: a handle widget at the left of the title line, visible on line hover (CSS), opening a singleton menu on `document.body` (copy the `ensureTableContextMenu` pattern in `tableWidget.ts`: outside-mousedown and Escape close, items re-resolve the block at click time). Items: Turn into text (unwrap), Start open / Start closed (writes the `open` attribute, the only action that edits the attribute), Delete toggle. Pure compute functions in `detailsEditing.ts`: `computeUnwrapToggle`, `computeDeleteToggle`, `computeSetStartOpen`, plus `computeToggleFromMarker`. Delete the now-unused `computeWrapInToggle`, `computeHeadingToToggle`, `computeToggleAtCursor`.
6. **Slash menu** (`slashMenu.ts`): Toggle inserts the new format; add Toggle Heading 1/2/3 (insert `# `/`## `/`### ` title). Quote entry unchanged. Add a bypass for the chevron/handle in the `mousedown` DOM handler in `livePreviewEditor.ts` if clicks misplace the cursor.
7. **Features that read raw text**: `markdownStats.ts` callers (`getWholeDocumentStats` in `mdWebview.ts`, selection stats in `livePreviewEditor.ts`) use `stripToggleTags`; `spellcheckExclusions.ts` excludes `toggleTagRanges`; `livePreviewSearch.ts` `findCm6Matches` drops matches inside hidden runs. Outline needs no change (markdown-it already parses a heading in the title; verified with lezer and markdown-it).
8. **Docs**: rewrite the CHANGELOG bullet (no slash/`Cmd+Alt+T` text; describe `> `, `"`, title formatting), `MAP-mdWebview.md` (new `toggleInputRules.ts`, updated detail rows), idea file Implementation Log.

#### Tests
- Unit: detector (new form, legacy, empty title, multi-line title, nested, closed runs, fence, malformed shapes stay raw), `computeToggleFromMarker` (paragraph, empty line, heading before/after `#`, section end, fences, rejects list/table/`>`), unwrap/delete/set-open, `"` rule, change guard (rejects partial overlap, allows whole-block delete and typing in title/body), `stripToggleTags`, spellcheck exclusion, slash entries.
- Webview spec (`markdown.spec.mts`): typing `> ` converts a paragraph and a heading in the real editor and no `details`/`summary` text is visible; `Cmd+Z` restores `> `; typing `"` + space gives a quote; Enter in title moves to body; Backspace at title start unwraps; chevron and menu actions; `problems()` clean. Update existing toggle specs for the new look.
- Integration: existing rename test stays valid (state keys by title id); re-run.

#### Risks and notes
- Cursor and hidden-line handling is the hardest part: arrow keys, Backspace/Delete, click, select-all, search auto-open; test each in the browser spec.
- `> ` no longer produces a plain blockquote when typed (accepted); slash and toolbar Quote still do.
- Block ids now come from the plain title text, so renaming a title resets its remembered open/closed state (same as the first build).
- Unverified: how GitHub renders the multi-line summary; check manually before release.
- Do not stage unrelated files (tree has other uncommitted work); commit only my files by path.

#### Verification
`npm run verify` green; `npm run test:integration` green (touches `src/*.ts`, `src/shared/**`). Known flaky existing webview test ("non-sticky toolbar reveals...") may fail intermittently; report it as such. Manual smoke (F5 on `samples/`): type `> ` on a paragraph and on `## Heading` (before and after the `##`) with sections below; confirm tags never appear; edit/bold the title; arrows, Backspace, Delete, Enter around blocks; handle menu items; nested toggles; closed body + search; light/dark; paste the file into a GitHub gist and view it.

### Previous plan (first build, superseded)

> **Superseded in part (revision 2 in Brainstorm, 2026-11-12):** the plan below describes the first build (visible dimmed tags, one-line summary, slash and `Cmd+Alt+T` creation). It must be re-planned against revision 2.

Approved plan (design facts and steps). Key facts: Lezer `HTMLBlock` cannot delimit a toggle, so use a line-based nesting-aware detector like `findCalloutBlocks`; hiding closed bodies lives in its own `StateField` (block replace + atomic ranges), independent of the reveal setting; per-file state copies `tableColumnWidths` and the callout default-type wiring; `sanitizeHtml.ts` is not touched.

### Steps (in order)
1. **Protocol first** (`src/protocol/markdown.ts`): add `detailsOpenState` (`Record<string, boolean>`) to `MarkdownDocumentPayload`; add `saveDetailsState` to `MarkdownWebviewToHost`. Run `npm run check-types` and fix every reported error.
2. **Host prefs**: `src/shared/preferenceStore.ts` new `filePreference` (new key prefix, never rename keys), add to `perFile` so renames migrate; `mdEditorProvider.ts` include in `buildInitMarkdownPayload` and add `case 'saveDetailsState'` with runtime validation (object, string keys, boolean values, capped size) in try/catch.
3. **Detector (pure)**: `src/webviews/md/livePreview/detailsTypes.ts`: `findDetailsBlocks(doc, state?)` returning `openLine`, `summaryLine`, `closeLine | null`, body range, `initiallyOpen`, depth; unclosed block = not a toggle (never hides). Block id = hash of summary text + occurrence count (stable across edits elsewhere).
4. **State**: `detailsState.ts` following `calloutDefaultType.ts`: effect + `StateField` of open/closed map, `seedDetailsState()`, auto-open rule (selection head inside a closed body opens it, which also covers search jumps).
5. **Decorations**: `detailsDecorations.ts`: a `StateField` that (a) replaces body lines (summary line end to line before `</details>`) with a block widget showing a chevron-free "N hidden lines" hint when closed, (b) adds `cm-md-details-*` line classes (dim tag lines, summary title style, left rule on open body); `atomicRanges` for the hidden range. Chevron is a small widget on the summary line that dispatches the toggle effect; disabled when read-only / version preview.
6. **Editing (pure)**: `detailsEditing.ts`: `computeToggleBlock(state, block)`; `computeWrapSelectionInToggle(state)`; `computeHeadingToToggle(state, pos)` (wraps the heading and its section up to the next heading of same or higher level; heading text becomes `<summary>text</summary>` and the `###` marker is dropped; the editor styles the summary like a heading. A summary that already contains `<h1-6>` is also accepted when reading).
7. **Slash menu**: `slashMenu.ts` add "Toggle" entry (insert `<details open>\n<summary></summary>\n\n</details>`, cursor inside summary); add icon key to `SlashIconKey` and `Icons` in `src/webviews/shared/icons.ts`.
8. **Heading to toggle entry point** (my call, correctable): a CM6 command with keybinding `Mod-Alt-T` that, on a heading line, runs `computeHeadingToToggle`; on any other line, wraps the selection/paragraph. Listed in the slash/help text. No new context-menu machinery.
9. **Wiring**: `livePreviewEditor.ts` mount options (`detailsOpenState`, `onDetailsStateChanged`), extensions list, exported setter; `mdWebview.ts` (`enterPreviewEditMode`, persist function posting `saveDetailsState`, `initMarkdown` seed); `state.ts` field; `saveSync.ts` applies payload on `diskChangedExternally`.
10. **Theme**: `cm6Theme.ts` add `.cm-md-details-*` classes; `resources/md/mdWebview.css` hide chevron in version-preview mode.
11. **Tests**: `detailsTypes.test.mts` (nested, unclosed, inside fenced code, `open` attr + casing, missing summary, blank line after summary, unclosed never hides); `detailsEditing.test.mts`; slash test update; `preferenceStore.test.mts` case (incl. rename migration); webview spec in `markdown.spec.mts` (closed toggle hides body, chevron click posts `saveDetailsState`, search/cursor opens) and update `initMarkdown` fixtures in `markdown.spec.mts` / `markdownSaveSync.spec.mts`; integration test next to `fileMove.test.ts` for rename migration of the new pref.
12. **Docs**: `.docs/dev/MAP-mdWebview.md` (new Toggles table), `.docs/dev/MESSAGE-PROTOCOL.md` if it lists messages, `AGENTS.md` §4 prefs row, `CHANGELOG.md` bullet under `### Unreleased`.

### AGENTS.md risks checked
- No cross-runtime imports; only `import type` from `src/protocol/`.
- No new webview assets, so CSP / `localResourceRoots` unchanged; no HTML inserted into the DOM from file content (summary text rendered via CM6 text/escaped widget text).
- No viewType / command ID renames; no esbuild path changes.
- Do not stage files not changed by this work (tree already has unrelated uncommitted changes, including `AGENTS.md`, `CHANGELOG.md`, `mdWebview.ts`, `livePreviewEditor.ts`, `state.ts`, `saveSync.ts`, `preferenceStore.ts`, `protocol/markdown.ts`, `mdEditorProvider.ts`: edit surgically and commit by path only).

### Open risks to test
- `scrollIntoView` to a replaced (hidden) range may misbehave: auto-open before scroll.
- Auto-open from search should not persist the open state unless the user toggles (decide in impl: treat as temporary).
- Nested toggles: closing an outer hides inner.

### Verification
- `npm run verify` (types for all projects, lint zero warnings, unit, bundle, webview) must be green.
- `npm run test:integration` (touches `src/*.ts`, `src/shared/**`).
- Manual smoke (F5 on `samples/`): add a `.md` with open/closed/nested toggles; click chevron; reload and confirm remembered state; type in an open body; search for text in a closed body; slash "Toggle"; `Mod-Alt-T` on a heading; rename the file and confirm state follows; light and dark themes; version preview hides the chevron.
- Report exactly what ran.


## Implementation Log

### Revision 2 build (Notion-style, markup hidden)

**Rewritten** (all in `src/webviews/md/livePreview/`): `detailsTypes.ts` (new multi-line title shape plus legacy one-line shape, hidden-run ranges, `stripToggleTags`), `detailsExtension.ts` (hidden runs as block replaces, atomic ranges, Notion look, hover handle and menu, structure guard, Enter/Backspace/Delete keys), `detailsEditing.ts` (build, unwrap, delete, set `open`, section scan; removed the wrap and `Cmd+Alt+T` functions). **New:** `toggleInputRules.ts` (typed `> ` and `" ` shortcuts). **Changed:** `slashMenu.ts` (Toggle and Toggle Heading 1 to 3 entries), `cm6Theme.ts` (new look, old dimmed-tag styles removed), `livePreviewEditor.ts` (cursor moved out of hidden runs on mount), `markdownStats.ts` (`stripToggleTags`), `spellcheckExclusions.ts`, `livePreviewSearch.ts` (hidden tags excluded), tests (unit and browser, plus the rename integration test from the first build), `CHANGELOG.md`, `.docs/dev/MAP-mdWebview.md`.

**Deviations from the plan:**
- Block replaces end at the last hidden line's end, not the next line's start: CodeMirror drops line decorations and widgets that sit exactly where a block replace ends. The cursor still skips cleanly because the atomic ranges span from the previous line's end to the next line's start.
- The structure guard treats selecting a block from its first tag to its last tag as a whole-block edit (allowed).
- Stats strip the tags inside `stripMarkdownToPlainText` itself, so both callers are covered without touching `mdWebview.ts`.
- Not done: line-number gutter keeps real line numbers, so numbers skip across hidden lines (accepted in the plan). Alt+Arrow and duplicate-line commands are covered by the guard (they are refused if they would touch hidden tags) but have no dedicated browser test.

**Verification run:** `npm run verify` green (509 unit, 45 webview tests, lint, types, bundle) and `npm run test:integration` green (11). The existing webview test "non-sticky toolbar reveals from the top edge..." fails intermittently in this working tree (opacity read mid-transition) but passed on a clean checkout of HEAD; it covers toolbar code this work did not touch, and the working tree has other uncommitted toolbar changes, so the cause is not confirmed. Not verified: how GitHub renders the multi-line summary, and the visual look (chevron, indent, hover handle, light and dark themes).

### QA feedback round 1 (fixed in place)

User feedback from first manual look: (1) the arrow must scale with the title (big for H2, a bit less for H3), prominent like Notion; (2) content inside a toggle must be clearly indented, including bullets (they were left behind because list lines set their own inline `padding-left`); (3) drop the "N hidden lines" label. Changes: indentation now uses `margin-left` with a doubled selector (beats list, callout and blockquote line rules), the arrow sizes in `em` of its line with extra scale on H1 to H3 and full-strength colour, and the closed body is now a plain zero-height hidden run (`HiddenBodyWidget` removed). Browser test added for bullet indent and arrow size. Known limit: tables and other block widgets inside a toggle body are not indented (they are not lines).

### QA feedback round 2 (fixed in place)

User feedback: the heading title was indented too far from normal text, the arrow sat too far from the title and moved when it turned, and it was too small on a Heading 2. Changes: the title is now flush with normal text (only the body is indented, 28px per level), the arrow hangs in the left margin close to the title, the arrow is a drawn SVG centred in a box as tall as the title line (so it sits on the title line and does not shift when rotated), and its height is `--chev` times the line font (1.4 for H1/H2, 1.25 for H3, 1.2 for H4, 1.15 otherwise). A document with toggles gets extra left padding on the editor (`.cm-md-has-toggles`) so the arrows are not clipped in a narrow window. Browser tests now assert: title left edge equals normal text, arrow centre stays on the title line and does not move between open and closed, gap to the title is small, and H2 arrow height is at least 1.6x body text.

### QA feedback round 3 (fixed in place, follows the user's own design in `.docs/product/designs.pen`)

Direction from the design: the arrow is a filled triangle (not a chevron), flush with the text of blocks that are not in a toggle; the title text starts right after it with a small gap; the body (text and bullets) starts at the same x as the title text. Sizes snap to a 4px grid: one 20px step per level (arrow slot, title offset, body indent are the same step), arrow sits in the first step. Triangle height is 0.5em of the title font (plain, H4), 0.55em (H3), 0.6em (H1, H2); it is a drawn SVG rotated about its centre, so it does not move when it turns. The hover handle hangs 36px left of the arrow; a document with toggles reserves 40px of left padding for it. Browser tests assert arrow flush with normal text, title x equals body x, bullets indented, small gap, arrow size relative to title, and no movement between open and closed.

### QA feedback round 4 (fixed in place): arrow alignment

Report: the arrow sat too low next to the heading (user screenshot: arrow about half a text height below the title, and 6px left of normal text). Causes: (1) the arrow box was `inline-flex`, whose baseline comes from its child (the small triangle), which pushed the box down; (2) it lined up with the line's edge, not with the text, which starts after the line's 6px left padding. Fix in `cm6Theme.ts`: `.cm-md-details-chevron` is an `inline-block` 1em tall with `vertical-align: -0.16em` (box middle 0.34em above the baseline, the middle of capital letters), a block `svg` centred inside by a margin, `margin-left: -20px` and zero net advance, so its left edge equals the start of normal text. The hover handle uses the same approach. The browser test now measures against the real capital-letter middle (baseline from a zero-size probe, cap height from canvas `measureText('H')`), tolerance 2px, for H2, H3 and plain titles, and checks the arrow does not move between open and closed. A headless screenshot (H2, H3, plain) was read and looked aligned.

Lesson: a Range text box (`getBoundingClientRect` of the text node) is not a reliable stand-in for where text looks centred; it gave different numbers depending on which tests ran first and let the bug through. For anything visual, take a screenshot and look at it before writing assertions.

### Handoff notes for the next session (read this before continuing QA)

- **Design reference:** `.docs/product/designs.pen` (Pencil). The user edited it by hand after the first version; the code was matched to the user's description (triangle arrow flush with normal text, small gap, title and body start at the same x, 20px step on a 4px grid), not to the file's exact numbers. Do not rewrite the design without being asked. Light theme is the reference.
- **Current state:** all code changes are uncommitted in the working tree, together with other uncommitted work by the user (toolbar, slash menu, outline rail). Commit only my files by path, never stage the rest. Files of this idea: `src/webviews/md/livePreview/details*.ts(mts)`, `toggleInputRules.ts(mts)`, plus edits in `slashMenu.ts`, `cm6Theme.ts`, `livePreviewEditor.ts`, `livePreviewSearch.ts`, `spellcheckExclusions.ts`, `markdownStats.ts`, `mdWebview.ts`, `saveSync.ts`, `state.ts`, `protocol/markdown.ts`, `mdEditorProvider.ts`, `shared/preferenceStore.ts`(+test), `webviews/shared/icons.ts`, tests, `CHANGELOG.md`, `AGENTS.md`, docs.
- **Last checks run (2026-11-12):** `npm run verify` green except the known flaky webview test "non-sticky toolbar reveals from the top edge..." (fails intermittently in this working tree, passed on a clean checkout of HEAD, covers toolbar code this work did not touch; cause not confirmed). `npm run test:integration` green (11). Toggle browser tests green in repeated runs.
- **Still not verified:** how it looks in the user's real VS Code (theme colours, fonts, dark theme); how GitHub renders the multi-line `<summary>`; Alt+Arrow / duplicate-line behaviour near hidden tags (guarded, no browser test); tables inside a toggle body are not indented (they are block widgets, not lines); line numbers skip across hidden lines (accepted).
- **Tooling findings:** headless screenshots work: load a document in the webview harness (`src/test/webview/harness.mts`), `page.screenshot` to the scratchpad, then Read the PNG. Pencil MCP `Export` can render the design board to PNG for side-by-side comparison (reconnect with `/mcp` if it times out). The user may enable computer use in the Claude app / Claude Code (needs v2.1.85+, screen-recording permission on macOS), which would allow checking the real VS Code window; the plan is: launch the Extension Development Host on a sample `.md`, screenshot, compare to the design. Suggested follow-ups (not done): an `npm run shot` script, a `samples/` file covering H1 to H3, plain, nested, closed and bulleted toggles, and an `AGENTS.md` rule to screenshot visual changes before calling them done.
- **Next steps:** (1) user looks at the arrow alignment and spacing in the real editor, light and dark; (2) fix anything off with a screenshot first; (3) when the user says it is right, fill in `## QA` with what was tested and the outcome, set `status: completed`, move this file to `5-completed/`, and confirm the CHANGELOG entry under `## Unreleased` (already written; re-read it so it matches the final behaviour: `> ` creates a toggle, `"` makes a quote, arrow, hover menu, remembered open state).

### First build (superseded)

**Files added** (all under `src/webviews/md/livePreview/`): `detailsTypes.ts` (+ test), `detailsEditing.ts` (+ test), `detailsExtension.ts`.

**Files changed:** `src/protocol/markdown.ts` (`detailsOpenState` payload field, `saveDetailsOpenState`), `src/shared/preferenceStore.ts` (+ test; new per-file pref and `sanitizeDetailsOpenState`), `src/mdEditorProvider.ts`, `src/webviews/md/state.ts`, `saveSync.ts`, `mdWebview.ts`, `livePreview/livePreviewEditor.ts`, `livePreview/slashMenu.ts` (+ test), `livePreview/cm6Theme.ts`, `src/webviews/shared/icons.ts`, webview spec fixtures and two new webview tests (`markdown.spec.mts`, `markdownSaveSync.spec.mts`), a rename test in `src/test/integration/fileMove.test.ts`, `CHANGELOG.md`, `AGENTS.md`, `.docs/dev/MAP-mdWebview.md`, `.docs/dev/ARCHITECTURE.md`.

**Deviations from the plan:**
- The chevron is not hidden in version preview; toggling is view-only state, so it stays usable (a closed toggle could otherwise hide content someone wants to read in an old version). No `mdWebview.css` change.
- The hidden-body hint ("N hidden lines") is also a click target that opens the block.
- Auto-open when the cursor or a search hit is inside a closed body is temporary (not saved); the chevron choice is what is persisted. Only choices that differ from the file's `open` attribute are stored.
- No `scripts/check-regression-tests.mjs` entry: this is a feature, not a bug fix.

**Verification run:** `npm run check-types`, lint, unit tests (487 pass), bundle, webview tests (new toggle tests pass), and `npm run test:integration` (11 pass, including the new rename test). The existing webview test "non-sticky toolbar reveals from the top edge..." failed intermittently (opacity read mid-transition, `0.33 !== 1`) in 3 of 4 runs and passed once; it does not touch toggles, but was not confirmed against a clean tree.


## QA

Status: **passed (2026-11-12).** The user signed off on the look in the real editor after four rounds of feedback and the two follow-up fixes (Enter in a title, extra space around toggles). Bounced back to brainstorm once earlier (markup fully hidden, Notion-style `> ` trigger, Markdown title; see Brainstorm, Revision 2).

Final checks: `npm run verify` green (511 unit; webview 45 of 46, the one failure is the known flaky "non-sticky toolbar reveals from the top edge..." test, unrelated to toggles); `npm run test:integration` green (11); `npm run test:ui` green (8) in real VS Code 1.146, light and dark.

Not verified, accepted for release: how GitHub renders the multi-line `<summary>` (the chevron may sit on its own line above the title); Alt+Arrow and duplicate-line near hidden tags (guarded, no browser test); search auto-opening a closed toggle in the real window; tables inside a toggle body are not indented; line numbers skip across hidden lines.

**Automated check in real VS Code (2026-11-12, by Claude; now the repo script `npm run test:ui`, spec in `src/test/ui/vscodeUi.spec.mts`, screenshots in `.vscode-test/ui-shots/`, 7 tests pass):** `playwright-core` (already a devDependency) can drive the VS Code downloaded for the integration tests (`.vscode-test/vscode-darwin-arm64-1.146.0/.../Contents/MacOS/Code`) through `_electron.launch` with `--extensionDevelopmentPath=<repo>`, a temp `--user-data-dir` whose `User/settings.json` sets `workbench.editorAssociations` `*.md` to `xlsxViewer.md` and a colour theme, and a fixture `.md`. The editor lives in the iframe that contains `.cm-content` (find it in `page.frames()`); `page.keyboard` and `page.screenshot` work against it, Cmd+S saves, and the saved file gives the raw Markdown to assert on. Results, real VS Code 1.146, light and dark:
- Pass: `> ` on a paragraph converts (arrow flush with text, cursor in empty body, no tag text visible); Cmd+Z restores `> `; `> ` before `##` and after `##` give identical files, section stops at the next same-or-higher heading and keeps `### Sub` inside; Enter at end of title moves into the body; Backspace at title start unwraps; hover handle opens the menu (Turn into text, Start closed, Delete toggle); `" ` makes a quote; clicking the arrow on a closed toggle reveals its body; dark theme looks right.
- Findings: (1) Enter in a title puts the cursor at the start of the existing first body line, so typing glues onto it ("NEWBODYtext under A"); Notion would open a new empty line. (2) Vertical gaps around toggles are large (about 100 to 170px between a body's last line and the next toggle) because the blank lines around the hidden tags still render. Not checked yet: Alt+Arrow near tags, search auto-open, tables in a body, GitHub rendering.
**Both findings fixed (2026-11-12):** Enter in a title now puts the cursor on a new empty line above the existing body (`enterInTitle` in `detailsExtension.ts`), so typing never joins the first body line. The blank line a body keeps before `</details>` is now hidden together with the closing tag (`closerAndBody` in `detailsTypes.ts`), so a toggle no longer adds a blank line of space; a body that is just one empty line (a fresh toggle) keeps it. Covered by unit tests, a webview spec and the `test:ui` spacing test (fails without the fix: 51px vs 25.5px for the same text as plain Markdown). `verify` green except the known flaky toolbar test; integration green (11).

Smoke-test checklist (F5 on `samples/`, light and dark theme):
1. Type `> ` at the start of a paragraph, of `## Heading` (before the `##`), and after the `##`; no tag text ever shows; `Cmd+Z` right after restores the literal `> `.
2. Arrow: flush with normal text, level with the title for H1, H2, H3 and plain titles, bigger on headings, same position open and closed, small gap to the title.
3. Content (text and bullets) starts at the same x as the title; nested toggles step in once more.
4. Bold or link in the title; Enter in the title moves into the body; Backspace at the title start unwraps.
5. Hover handle and its menu (Turn into text, Start open/closed, Delete toggle).
6. Closed toggle shows only its title (no count); search inside a closed toggle opens it.
7. `"` plus a space makes a quote; slash menu Toggle and Toggle Heading 1 to 3.
8. Paste a sample into a GitHub gist and look at the multi-line summary.
