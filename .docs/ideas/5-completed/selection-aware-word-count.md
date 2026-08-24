---
title: Selection-Aware Word/Char Count
slug: selection-aware-word-count
status: completed
created: 2026-08-20
updated: 2026-08-20
---

# Selection-Aware Word/Char Count

## Idea

The status bar indicator that shows line/word count should update when text is selected. When a paragraph or any range is selected, it should show the character count, word count, and maybe reading time for the selection instead of (or alongside) the whole-document count. Important: counts must reflect rendered/displayed text only, not raw Markdown syntax — e.g. bold `**text**` should count `text`, not the asterisks.

## Brainstorm

**Feature name:** "Document Stats" — used in the settings panel label and any docs/changelog copy.

**Selection behavior (replace, not append):** The existing status-bar stats row (`#statusInfo`, currently lines/words/chars/reading-time + a `Ln X, Col Y` cursor prefix) shows whole-document stats normally. When there is a non-trivial selection (see edge cases), the stats portion is *replaced* entirely by stats for the selected text — not shown alongside the whole-document numbers. When the selection is cleared, it reverts to whole-document stats. If multiple selection ranges exist (multi-cursor), sum the counts across all ranges and treat it as one selection for display purposes.

The `Ln X, Col Y` cursor-position prefix is unaffected by selection-replace/master-toggle-off behavior, but per user follow-up gets its own independent visibility toggle (see Settings below) — distinct from the "Lines" stat (total line count).

**Amendment (post-implementation, pre-QA):** add a "Current Line" checkbox that shows/hides the `Ln X, Col Y` prefix. Default: on (preserves today's behavior).

**Correction:** "Current Line" is nested *inside* "Document Stats" (an indented dependent row, gated by the master toggle like the other four) — not independent as first implemented. All settings-panel rows for this group are ordered to match the rendered status-bar string left-to-right: Current Line, Lines, Words, Characters, Reading time.

**Displayed-text counting (fixes whole-document too):** Build one shared "strip to displayed text" helper and use it for *both* whole-document and selection counts — not just selection. It strips Markdown syntax that isn't part of what's rendered: `**bold**`/`*italic*`/`_italic_` markers, `` `code` `` backticks, `#` heading markers, `[text](url)` link syntax (keep `text`, drop the URL), etc. This deliberately changes today's whole-document word/char numbers (currently raw, including syntax) — a correctness fix, not a regression to preserve.

Reading time keeps the existing formula (`ceil(words / 200)`, min 1) applied to whichever word count is currently displayed (whole-doc or selection), and is omitted entirely when that word count is 0.

**Settings — new checkboxes in the existing gear/settings panel** (`SettingsManager`-rendered panel, same as Word Wrap / Sticky Toolbar / Show Outline today):
- Master checkbox **"Document Stats"** — shows/hides the entire stats row (cursor prefix stays visible either way). Default: on.
- Four independent per-stat checkboxes — **Lines**, **Words**, **Characters**, **Reading time** — each toggles whether that metric appears in the rendered string. Default: all on. Order in the string stays fixed (Lines · Words · Characters · reading time) regardless of which are enabled; omitted metrics don't leave a dangling separator.
- When the master toggle is off, stat computation is skipped entirely on selection/content-change events (not just hidden), to avoid wasted work.
- Persisted as new config keys under the `xlsxViewer.md.stats.*` namespace (mirrors the existing `xlsxViewer.md.*` pattern): `xlsxViewer.md.stats.enabled` (master) plus `showLines` / `showWords` / `showCharacters` / `showReadingTime`, wired through the existing `updateSettings` message round-trip (webview → `mdEditorProvider.ts` → `cfg.update(..., ConfigurationTarget.Global)`).

**Edge cases (fixed):**
- An empty or whitespace-only selection counts as "no selection" — falls back to whole-document stats, no stray "0 selected" state.
- Reading time is omitted whenever the relevant word count is 0.
- Turning the master toggle off stops the underlying computation, not just the rendering.

## Plan

**Config key naming note:** the brainstorm's `xlsxViewer.md.stats.*` namespace is conceptual — `package.json`'s existing `xlsxViewer.md.*` keys are all flat (no nested dotted keys anywhere), so the actual keys are flat to match: `xlsxViewer.md.showStats`, `md.statsShowLines`, `md.statsShowWords`, `md.statsShowChars`, `md.statsShowReadingTime`.

**No new host↔webview message types** — this feature is fully webview-computed (CM6 selection state never leaves the webview); persistence reuses the existing `updateSettings` / `initSettings` / `settingsUpdated` trio.

1. **New file `src/webviews/md/markdownStats.ts`** (+ colocated `markdownStats.test.mts`, same pattern as `frontmatter.ts`/`frontmatter.test.mts`) — pure functions, no DOM/CM6:
   - `stripMarkdownToPlainText(source)`: regex passes (inline code → images → links → bold → strikethrough → italic, then per-line heading/blockquote/list-marker stripping) tolerant of invalid/partial fragments (a selection substring may not be valid standalone Markdown).
   - `computeTextStats(text)`: `{ lines, words, chars }`, same formula `updateStatusInfo()` uses today, just parameterized on stripped text instead of raw `currentContent`.
   - Test coverage: each syntax type, combined cases, an unterminated fragment (proves no throw/hang), empty-string word count = 0.

2. **`src/webviews/md/livePreview/livePreviewEditor.ts`** — new export colocated with `getLivePreviewCursorPosition` (~line 420):
   - `getLivePreviewSelectionStats(): TextStats | null` — filters `view.state.selection.ranges` to non-empty ranges, returns `null` if none or all are whitespace-only (checked on raw sliced text, before stripping — simplest predictable rule), else strips + sums stats across all ranges (multi-cursor summed, no de-dup).

3. **`src/webviews/md/mdWebview.ts`**:
   - Import `stripMarkdownToPlainText`, `computeTextStats` from `./markdownStats`; add `getLivePreviewSelectionStats` to the existing `livePreviewEditor` import.
   - `currentSettings` defaults (~line 107): add `showStats: true, statsShowLines: true, statsShowWords: true, statsShowChars: true, statsShowReadingTime: true`.
   - New `getCurrentSelectionStats()` next to `getCurrentCursorPosition()` (~line 862), mirroring its `isLivePreviewActive()` guard.
   - Rewrite `updateStatusInfo()` (~line 869): cursor prefix computed first (always, unaffected by master toggle) → if `!showStats`, set text to cursor-prefix-only (or hide div if empty) and return before any stats math → else `stats = getCurrentSelectionStats() ?? computeTextStats(stripMarkdownToPlainText(currentContent))` (this `??` is the entire "replace, not append" behavior) → build `parts[]` via conditional push per per-stat toggle → reading time pushed only if enabled AND `stats.words > 0` → join with `·`, prefixed by cursor prefix, no dangling separators. All existing call sites of `updateStatusInfo()` stay untouched.
   - `applySettings()` (~line 1110): sync the 5 new checkboxes' `.checked`, show/hide the 4 per-stat rows based on master toggle (`.setting-item` display toggle, same pattern as spreadsheet's autosave-dependent rows), and call `updateStatusInfo()` once at the end so any settings-change path refreshes the bar.
   - `initializeSettings()` (~line 1172): append 5 `settingsDefs` entries — master `chkShowStats` ("Document Stats") + 4 dependent entries (`chkStatsLines`/`Words`/`Chars`/`ReadingTime`, each `className: 'setting-dependent setting-stats-dependent'`) — same shape as existing entries, no HTML template changes needed (`SettingsManager.renderPanel` generates markup from the array).

4. **`src/mdEditorProvider.ts`**:
   - `buildMdWebviewSettings()` (~line 14): add the 5 `cfg.get('md.X', true)` reads.
   - `case 'updateSettings':` (~line 271): add 5 guarded `if (typeof s.X === 'boolean') { await cfg.update(...) }` blocks, matching the existing newer-settings guard style.
   - No other changes needed — `initSettings`/`settingsUpdated` posts already call `buildMdWebviewSettings()` fresh each time.

5. **`package.json`** — add 5 `contributes.configuration` entries after `xlsxViewer.md.autoSave` (~line 381), matching the existing boolean-setting shape (type/default/description).

6. **`.docs/dev/MESSAGE-PROTOCOL.md`** — append the 5 new keys to the existing `updateSettings`/`initSettings`/`settingsUpdated` row descriptions (wording only, no new rows).

**Order:** (1) stats helper + unit tests → (2) selection-stats export → (3) `mdWebview.ts` core behavior (whole-doc fix + selection-replace live with hardcoded-true toggles, a good manual checkpoint) → (3 cont'd) settings UI wiring → (4)+(5) host persistence + package.json schema → (6) docs.

**Verification:** `npm run compile` (0 type/lint errors) + `npm run test:unit` (new `markdownStats.test.mts` alongside existing `livePreview/*.test.mts`). Manual F5 smoke test covers: whole-doc count drop on a syntax-heavy doc, selection replacing whole-doc stats (including across a link, and across a whitespace-only drag which should NOT switch), multi-cursor summing, reading-time omission at 0 words, all 16 on/off combinations of the 4 per-stat checkboxes never showing a dangling separator, master-toggle-off hiding stats but keeping `Ln/Col`, and settings persisting across a reload.

**AGENTS.md compliance:** no `xlsxViewer.*`/`xlsx-viewer.*` ID renames; no new webview assets (CSP/localResourceRoots unaffected); no esbuild entry-point changes; both sides of the settings round-trip (webview + host + `package.json` schema) land together.

**Amendment — "Current Line" toggle:** new checkbox, `showCursorPosition` (default true), nested under "Document Stats" (`setting-dependent setting-stats-dependent` className, included in the master's show/hide sync array in `applySettings()`) — so master-off now hides the cursor prefix too, not just the 4 stat metrics. `settingsDefs` order and the `applySettings()` checkbox declarations/sync are all ordered to match the rendered string: Current Line, Lines, Words, Characters, Reading time.

## Implementation Log

Built per plan, no deviations. Files changed:
- `src/webviews/md/markdownStats.ts` (new) — `stripMarkdownToPlainText()`, `computeTextStats()`.
- `src/webviews/md/markdownStats.test.mts` (new) — 16 unit tests, all passing.
- `src/webviews/md/livePreview/livePreviewEditor.ts` — new `getLivePreviewSelectionStats()` export.
- `src/webviews/md/mdWebview.ts` — `currentSettings` defaults; `getCurrentSelectionStats()`; rewrote `updateStatusInfo()`; `applySettings()` checkbox sync + dependent-row show/hide + trailing `updateStatusInfo()` call; 5 new `settingsDefs` entries in `initializeSettings()`.
- `src/mdEditorProvider.ts` — 5 new keys in `buildMdWebviewSettings()`; 5 new guarded blocks in the `updateSettings` handler.
- `package.json` — 5 new `xlsxViewer.md.*` config entries (flat naming, matching existing convention — see plan note on why this differs from the brainstorm's conceptual `stats.*` namespace).
- `resources/shared/theme.css` — `.setting-stats-dependent` cosmetic rule (font-size), mirroring the existing autosave-dependent pattern.
- `.docs/dev/MESSAGE-PROTOCOL.md` — wording update on the 3 existing settings rows, no new rows.

Verification: `npm run compile` — 0 type/lint errors. `npm run test:unit` — all 16 new tests pass; 3 pre-existing unrelated failures (`revealDecorations`/`slashMenu`/`tableWidget` — missing module `tableBoundaryEditing`) confirmed unrelated before touching anything. No manual F5 smoke test yet — needs a human pass (see QA section).

**Amendment (before QA started):** added the "Current Line" toggle (see Brainstorm/Plan amendments above) — `showCursorPosition` setting, independent top-level checkbox (not indented under "Document Stats"), default true. Changed: `mdWebview.ts` (`currentSettings` default, `cursorPrefix` gated in `updateStatusInfo()`, checkbox sync in `applySettings()`, new `settingsDefs` entry), `mdEditorProvider.ts` (`buildMdWebviewSettings()` + `updateSettings` handler), `package.json` (`xlsxViewer.md.showCursorPosition`), `.docs/dev/MESSAGE-PROTOCOL.md` (wording). Re-ran `npm run compile` — clean.

## QA

Manual F5 smoke test passed. Confirmed:
- Whole-document word/char counts reflect displayed text (Markdown syntax no longer counted).
- Selecting text replaces whole-document stats with selection-only stats; deselecting reverts.
- Settings panel: "Document Stats" master + nested Current Line / Lines / Words / Characters / Reading time checkboxes, ordered to match the status bar.
- Toggles persist across reload.

**Post-completion regression + fix:** user reported opening a Markdown file got noticeably slower, scrolling froze, and typing lagged then appeared in bursts. Root cause: `updateStatusInfo()` fires twice per keystroke (`onDocChanged` and `onSelectionChange` in `mdWebview.ts`), and CM6 fires `onSelectionChange` on every plain cursor move too, not just real selections — previously that recompute was cheap raw string ops, but now it re-ran the full `stripMarkdownToPlainText` + `computeTextStats` pipeline (8 regex passes + a per-line pass) over the *entire document* on every cursor move and keystroke. Fixed by memoizing whole-document stats keyed on `currentContent` (new `getWholeDocumentStats()` in `mdWebview.ts`, replacing the direct `computeTextStats(stripMarkdownToPlainText(currentContent))` call in `updateStatusInfo()`) — cursor-only moves now hit the cache with zero recompute, and an actual content change recomputes once instead of twice. `npm run compile` clean; `npm run test:unit` unaffected (same pre-existing unrelated failures as before).


**Correction — Document Stats was not the cause.** The slowness persisted after the memoization
above, and a profiling pass traced it elsewhere: `typo.suggest()` in the spell-check lint pass
(`src/webviews/md/livePreview/spellcheck.ts`), newly reachable because the uncommitted CSP fix from
`.docs/ideas/4-to-qa/spell-check.md` added `connect-src` and let the dictionary load for the first
time. A lint pass over a 60-line viewport measured **20 402 ms**. Full write-up and fix:
`.docs/ideas/5-completed/document-stats-perf-regression.md`.

Document Stats was measured and cleared: `stripMarkdownToPlainText` + `computeTextStats` costs
0.13 ms on the real 6 KB `samples/test.md`, 0.96 ms at 60 KB, 5.4 ms at 300 KB — never enough to
freeze the editor. The reasoning above about `updateStatusInfo()` firing on every cursor move is
accurate, but the per-call cost it was worried about is ~0.1 ms, not the regression. The
`getWholeDocumentStats()` memoization is kept anyway: it is correct and avoids redundant work. It
simply was not the fix.
