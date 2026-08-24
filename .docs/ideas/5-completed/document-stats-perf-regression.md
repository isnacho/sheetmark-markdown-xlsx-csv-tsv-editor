---
title: Document Stats Performance Regression
slug: document-stats-perf-regression
status: completed
created: 2026-08-20
updated: 2026-08-20
---

# Document Stats Performance Regression

## Idea

After the "Document Stats" status-bar feature was added (`.docs/ideas/5-completed/selection-aware-word-count.md`), the Markdown editor got noticeably slower: opening a `.md` file takes longer to load, scrolling gets blocked, the cursor turns into a magnifying glass, and typing lags then appears in bursts instead of live. A first fix attempt — memoizing whole-document stats in `src/webviews/md/mdWebview.ts` (`getWholeDocumentStats()`) so cursor-only moves don't re-strip the whole document — was applied but did **not** resolve it, so the real root cause is still unknown.

Full diagnostic write-up handed to a separate session for profiling-based investigation (preserved here verbatim so it isn't lost when the session-temp copy is cleaned up):

> ### Diagnose Markdown editor perf regression in sheetmark-vscode
>
> **Repo & required reading:** Read `AGENTS.md` at the repo root fully before touching anything — two-runtime split (extension host vs. webview), untyped string message protocol, hard DO-NOTs. Also read `.docs/ideas/5-completed/selection-aware-word-count.md` for the full history of the feature that caused this (brainstorm → plan → implementation log → QA → a post-completion fix that did NOT fully resolve it).
>
> **What the feature changed:**
> - New file `src/webviews/md/markdownStats.ts`: `stripMarkdownToPlainText(source)` (8 sequential regex `.replace()` passes, plus a per-line pass with 3 more regex operations per line) and `computeTextStats(text)`.
> - `src/webviews/md/livePreview/livePreviewEditor.ts`: new `getLivePreviewSelectionStats()`, reads CM6 `view.state.selection.ranges`.
> - `src/webviews/md/mdWebview.ts`: `updateStatusInfo()` (~line 900) now calls `getCurrentSelectionStats() ?? getWholeDocumentStats()` instead of the old cheap raw `.length`/`.split()` counts. This function is called from two places per keystroke — `onDocChanged` (~line 447) and `onSelectionChange: updateStatusInfo` (~line 457) — and CM6 fires `update.selectionSet` (triggering `onSelectionChange`) on every cursor move, not just real text selections (`EditorView.updateListener` in `livePreviewEditor.ts` ~line 175-192).
>
> **Fix already attempted (insufficient — problem persists):** memoization in `mdWebview.ts` (~line 884-898):
> ```ts
> let cachedWholeDocStatsContent: string | null = null;
> let cachedWholeDocStats: TextStats = { lines: 0, words: 0, chars: 0 };
> function getWholeDocumentStats(): TextStats {
>     if (cachedWholeDocStatsContent !== currentContent) {
>         cachedWholeDocStatsContent = currentContent;
>         cachedWholeDocStats = computeTextStats(stripMarkdownToPlainText(currentContent));
>     }
>     return cachedWholeDocStats;
> }
> ```
> Reasoning was that `onSelectionChange`-triggered calls happen before `currentContent` is reassigned (only done inside `onDocChanged`, later in the same update listener), so a cursor move should hit cache and a real edit should recompute once instead of twice. `npm run compile` was clean; `npm run test:unit` passed aside from 3 pre-existing unrelated failures. **This did not fix the reported slowness.** Don't re-derive/re-apply this same fix — find what's actually still slow.
>
> **Complicating factor:** this working tree has unrelated uncommitted changes in files the Document Stats work never touched: `cm6Theme.ts`, `listMarkerEditing.ts`, `mermaidDetection.ts`, `mermaidWidget.ts`, `slashMenu.ts`, `tableBoundaryEditing.ts` (all under `src/webviews/md/livePreview/`), `src/spreadsheet/spreadsheetHtmlRenderer.ts`, `src/webviews/shared/icons.ts`, `src/webviews/shared/settingsManager.ts`, `src/webviews/shared/themeManager.ts`, `samples/test.md`. Don't assume Document Stats is the root cause just because it's the most-discussed change — the real regression may live in one of these instead (or in addition). Investigate causation directly (`git diff <file>` each against HEAD; use `git stash push -- <specific paths>` rather than a blanket `git stash`, which failed this session with a symlink error unrelated to this bug).
>
> **What to actually do:**
> 1. Profile, don't just re-read code — open the Extension Dev Host, use "Developer: Open Webview Developer Tools" with the Sheetmark Markdown editor focused, record CPU profile while typing/moving the cursor, find the actual hot function by wall-clock time.
> 2. Verify the bundle is fresh (`npm run watch` picked up edits, `Cmd+R` reloaded) before profiling.
> 3. Confirm or refute with evidence, not inspection: the memoization might not actually be preventing recomputation (grep all call sites of `stripMarkdownToPlainText`/`computeTextStats`); the horizontal-rule regex `^\s{0,3}([*_-] ?){3,}$` in `markdownStats.ts` was reasoned to probably not be a ReDoS risk but wasn't empirically fuzzed; the real hot path might be pre-existing CM6 decoration plugins or `refreshCm6Toc`'s markdown-it parse, or one of the unrelated uncommitted files above; the "magnifying glass cursor" detail specifically doesn't fit a typical main-thread-block symptom (usually a spinning busy cursor) and might be a separate CSS/interaction bug, not the same root cause; "opening a file takes longer" suggests something synchronous and O(doc size) runs once at mount, independent of typing.
> 4. Fix the actual root cause found, verify with the profiler again plus `npm run compile` and a manual F5 retest (type continuously, move the cursor without typing, confirm scrolling stays responsive).
> 5. Update `selection-aware-word-count.md`'s `## QA` section with findings (surgical append).
>
> **Constraints (AGENTS.md):** don't rename `xlsxViewer.*`/`xlsx-viewer.*` IDs; wire both sides of any message-protocol change and update `.docs/dev/MESSAGE-PROTOCOL.md`; don't change esbuild entry points; verification = `npm run compile` (0 errors) + manual F5 smoke test.

## Brainstorm

**Root cause: `typo.suggest()` in the spell-check lint pass. Not Document Stats.**

Document Stats was a red herring — the most-discussed change, but exonerated by measurement.
The regression was introduced by the uncommitted one-line CSP fix from
`.docs/ideas/4-to-qa/spell-check.md`, which added `connect-src ${cspSource}` to the markdown
webview's CSP (`src/mdEditorProvider.ts:755`). That directive is the *only* thing in the working
tree that changes what the webview can `fetch()`, and `loadSpellDictionary()` holds the only
`fetch()` calls in `src/webviews/**`. Before it, the dictionary fetch was CSP-blocked, the failure
was swallowed by `loadSpellDictionary()`'s `.catch()`, `typo` stayed `null`, and `buildDiagnostics()`
returned `[]` on its first line forever. **The spell checker had never actually run.** The CSP fix
woke up a code path that had been dead since it was written.

**Measured, against the bundled `resources/spell/en_US.dic` (551KB):**

| Operation | Cost |
|---|---|
| `new Typo('en_US', aff, dic)` | ~50 ms, once |
| `typo.check(word)` | ~0.02 ms |
| `typo.suggest(word)` | **100–460 ms** |

`buildDiagnostics()` called `typo.suggest()` **eagerly for every unknown word in the viewport**, to
prefill each diagnostic's `actions` array. Typo.js `suggest()` generates edit-distance candidates
across the alphabet and dictionary-checks every one, so it is four orders of magnitude more
expensive than `check()`. A technical Markdown file is full of words no dictionary knows —
identifiers, filenames, product names — so the unknown-word count per viewport is high, not rare.

Replaying a lint pass over a 60-line viewport of this repo's own `AGENTS.md` (481 words,
113 unknown):

```
OLD lint pass (eager suggest): 20402 ms
NEW lint pass (cold cache):        0.28 ms
NEW lint pass (warm cache):        0.03 ms
```

**A 20-second main-thread freeze per lint pass**, fired 300 ms after every keystroke and once at
mount via `forceLinting()`. That single number explains every reported symptom, including the two
the brief flagged as not fitting:

- *"opening a `.md` file takes longer"* — the `forceLinting()` pass right after the dictionary resolves.
- *"typing lags then appears in bursts"* — keystrokes queue during the freeze and flush when it ends.
- *"scrolling gets blocked"* — nothing repaints for 20 s.
- *"cursor turns into a magnifying glass"* — not a separate CSS bug. `cursor: zoom-in` on
  `.markdown-preview .zoomable` (`resources/md/mdWebview.css:1754`) is the image-hover cursor; with
  the main thread wedged the browser cannot update it away. Re-verify at QA rather than treating it
  as its own fix.

**Refuted by measurement, so no change made:**

- *Document Stats / `stripMarkdownToPlainText`* — 0.13 ms on the real 6 KB `samples/test.md`,
  0.96 ms at 60 KB, 5.4 ms at 300 KB. Never the regression at any realistic document size. The
  earlier memoization in `getWholeDocumentStats()` was fixing a non-problem, which is exactly why
  it did not help. It is harmless and correct, so it stays.
- *The horizontal-rule regex `^\s{0,3}([*_-] ?){3,}$`* — fuzzed with adversarial inputs
  (`'*' * n + 'x'`, forcing the group to match then fail on `$`); flat 0.00–0.05 ms up to n=30, no
  backtracking blowup. `[*_-]` is mandatory per iteration, so the only ambiguity is the optional
  space. **Not a ReDoS risk** — the brief's un-verified suspicion is now empirically closed.
- *The other unrelated uncommitted files* (`cm6Theme.ts`, `listMarkerEditing.ts`, `mermaidWidget.ts`,
  `slashMenu.ts`, `tableBoundaryEditing.ts`, `settingsManager.ts`, …) — not implicated; causation was
  established directly at the spellcheck call site rather than by elimination.

**Second bug found in the same code, fixed alongside:** diagnostics are built from
`view.visibleRanges`, but `linter()` only re-runs on `docChanged` (no `needsRefresh` was set). So
spell check only ever underlined the viewport that was visible when you last typed — scrolling into
new text showed nothing. That could not be fixed before the perf fix (it would have added 20-second
freezes to scrolling); it is cheap now.

## Plan

Keep the feature and its UX; move the expensive call off the hot path.

1. `src/webviews/md/livePreview/spellcheck.ts`
   - Remove `typo.suggest()` from `buildDiagnostics()` entirely. Diagnostics carry a plain
     `Unknown word: x` message and a lazy `renderMessage`.
   - Render suggestions in `renderMessage`, which `@codemirror/lint` calls only when building the
     hover tooltip for one specific diagnostic — so `suggest()` is paid per deliberate hover, not
     per word per pass. Defer the call behind `setTimeout(0)` so the tooltip paints first.
   - Resolve the live word range at apply time with the public `forEachDiagnostic()` (matching by
     diagnostic identity), since `renderMessage` — unlike `Diagnostic.actions` — is handed no
     positions and the captured ones may have shifted.
   - Memoize `check()` and `suggest()` per word.
   - Stop calling `view.state.doc.toString()` per pass (and per right-click); slice only what is read.
   - Add `needsRefresh: (u) => u.viewportChanged` so scrolling re-lints.
2. `src/webviews/md/livePreview/spellcheckExclusions.ts`
   - Scope `isSpellcheckExcluded()`'s syntax-tree walk to the queried word instead of the whole
     document, and hoist `syntaxTree(state)` out of the per-range loop.
3. No message-protocol change, so no `.docs/dev/MESSAGE-PROTOCOL.md` update needed.

## Implementation Log

- `src/webviews/md/livePreview/spellcheck.ts` — rewritten per plan:
  - `buildDiagnostics()` is now `check()`-only; the eager `actions` array is gone, replaced by
    `renderMessage: (v) => renderSuggestionTooltip(v, diagnostic, word)`.
  - New `renderSuggestionTooltip()` / `fillSuggestionTooltip()` / `applySuggestion()` render
    clickable suggestion buttons (`cm-diagnosticAction`, lint's own class, so styling is unchanged)
    and deferred `suggestionsFor()` behind `setTimeout(0)` with a "finding suggestions…" placeholder;
    a cached word fills synchronously.
  - New `currentDiagnosticRange()` uses `forEachDiagnostic()` to get the diagnostic's mapped
    position before dispatching a fix.
  - New `isSpelledCorrectly()` / `suggestionsFor()` memoize on `checkCache` / `suggestCache`
    (flush-when-full at 20 000 entries; both cleared when a dictionary loads).
  - `wordRangeAt()` takes `EditorState` instead of a whole-document string and scans only
    `doc.lineAt(pos).text` — a word cannot span lines.
  - New `frontmatterRange()` uses `doc.sliceString(0, 16384)` instead of `doc.toString()`.
  - `spellcheckLint` gained `needsRefresh: (update) => update.viewportChanged`.
  - File-header comment now states the check/suggest cost asymmetry as the rule for the file, with
    the measured numbers, so this does not get reintroduced.
- `src/webviews/md/livePreview/spellcheckExclusions.ts` — `isSpellcheckExcluded()` iterates
  `[{ from, to }]` instead of `[{ from: 0, to: docLen }]` (`iterate` still enters overlapping nodes,
  so an enclosing code span is still found); `syntaxTree(state)` hoisted out of the loop in
  `collectSpellcheckExclusionRanges()`.
- No deviation from the plan. Nothing reverted in `mdWebview.ts` — the Document Stats memoization
  is correct, just not the fix.

**Verification run:**

- `npm run compile` — clean: 0 type errors, 0 lint errors.
- `npm run test:unit` — 202/205 pass, including all 5 `spellcheck.test.mts` exclusion tests. The
  3 failures (`revealDecorations`, `slashMenu`, `tableWidget`) are pre-existing: confirmed by
  `git stash push`-ing only the two files touched here and re-running, which reproduces the same
  3 failures at the same 202/205.
- Lint-pass benchmark before/after: 20402 ms → 0.28 ms cold, 0.03 ms warm.

## QA

**Passed.** Manual smoke test confirmed by the user — the Markdown editor is fast and responsive
again (opening, typing, and scrolling all fluid; no burst-flush, no stall).

Checks covered:

1. Open `samples/test.md`. It should open with no perceptible delay and scroll smoothly immediately.
2. Type continuously in a prose paragraph — characters appear live, no burst-flush, no stall ~300 ms
   after stopping.
3. Move the cursor with arrow keys without typing — no lag, status bar line/col keeps up.
4. Scroll to text far below the initial viewport — misspelled words there should now be underlined
   (this was broken before; it is the `needsRefresh` fix).
5. Hover a red-underlined word — tooltip appears immediately showing "finding suggestions…", then
   fills with clickable suggestions. Click one; the word is replaced correctly.
6. Hover the same word again — suggestions appear instantly from cache.
7. Right-click a misspelled word — context menu with suggestions; clicking one replaces it.
8. Confirm code spans, fenced code blocks, and YAML frontmatter are still not underlined.
9. Hover an image, then type — confirm the cursor no longer sticks as a magnifying glass.
