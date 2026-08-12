---
title: Spell check in preview edit mode
slug: spell-check-preview-edit-mode
status: completed
created: 2026-07-22
updated: 2026-08-12
---

# Spell check in preview edit mode

## Idea

In preview edit mode, I want to be able to see when I misspell words — the underlines that appear under the word and clicking to show suggestions, essentially the native spell check. Is that possible to add?

## Brainstorm

### Decisions

| Area | Choice |
|---|---|
| Scope | Preview Edit (CM6 engine) main document **and** inline table cells while editing |
| Control | Always on — no new extension setting or toggle |
| Exclusions | Markdown-aware: skip spell check in fenced code blocks, inline code, and YAML frontmatter |
| Discoverability | Silent — squiggles only; no status-bar hint or onboarding copy |

### UX spec

**When it applies**

- Entering **Preview Edit** with the CM6 engine (`livePreviewEngine: cm6`) turns on native browser spell check on the main editing surface.
- While editing a **table cell** (the `contentEditable` `<td>` / `<th>` wired by `tableWidget.ts`), spell check is on for that cell.
- Spell check is **not** added to split-mode `<textarea>`, the legacy contentEditable preview-edit path, or spreadsheet editors.

**What the user sees**

- Misspelled words get the OS/browser red (or equivalent) underline, same as a normal text field.
- Right-click (or platform equivalent) on an underlined word shows the browser’s native suggestion menu; choosing a correction replaces the word in place.
- No new toolbar buttons, settings checkboxes, or extension UI.

**Exclusions (no squiggles in these regions)**

1. **Fenced code blocks** — triple-backtick blocks and their contents.
2. **Inline code** — backtick spans.
3. **YAML frontmatter** — both the rendered frontmatter card inputs and the underlying `---` … `---` source region in the document.

Everything else in the CM6 document (headings, paragraphs, lists, blockquotes, link text, table cell prose) is spell-checked normally. Accept that URLs, file paths, and technical terms in plain text may still get false positives — that’s acceptable for v1; no custom dictionary.

**Edge cases / defaults**

- If the user’s OS or browser has spell check disabled globally, behavior follows the platform (we don’t force-enable at the OS level).
- Toggling out of Preview Edit tears down CM6; squiggles disappear with the editor.
- Switching table cells: each active cell gets spell check; inactive cells are not editable surfaces.
- No change to save/dirty tracking or content sync — spell-check corrections are normal text edits.

### Out of scope (v1)

- Split-mode raw editor spell check.
- Legacy preview-edit engine spell check.
- Extension setting to disable spell check.
- Custom spell-check engine (e.g. typo.js) or VS Code dictionary integration.
- Excluding link URLs, headings-only, or other prose heuristics beyond code + frontmatter.

## Plan

1. Load Hunspell dictionary (`resources/spell/en_US.{aff,dic}`) via webview URIs injected in `mdEditorProvider.ts`.
2. Run dictionary spell check through `@codemirror/lint` in `spellcheck.ts` (Typo.js) — native `spellcheck="true"` does not work in VS Code webviews ([vscode#214367](https://github.com/microsoft/vscode/issues/214367)).
3. Skip inline code, fenced code, and YAML frontmatter via `spellcheckExclusions.ts`.
4. Right-click misspelled word → custom suggestion menu; lint tooltip also lists replace actions.
5. Headless unit tests for exclusion ranges in `spellcheck.test.mts`.

## Implementation Log

**Files changed**

- `resources/spell/en_US.aff`, `resources/spell/en_US.dic` — English dictionary assets.
- `src/mdEditorProvider.ts` — inject `window.__SPELL_DICT__` URIs into webview HTML.
- `src/webviews/md/livePreview/spellcheckExclusions.ts` — exclusion range helpers for code + frontmatter.
- `src/webviews/md/livePreview/spellcheck.ts` — Typo.js loader, CM6 lint source, right-click suggestion menu.
- `src/webviews/md/livePreview/typo-js.d.ts` — minimal Typo.js types.
- `src/webviews/md/livePreview/livePreviewEditor.ts` — register spell-check extensions + load dictionary on mount.
- `src/webviews/md/livePreview/cm6Theme.ts` — lint underline + context-menu styling.
- `src/webviews/md/frontmatterCardUi.ts` — `input.spellcheck = false` on YAML field inputs.
- `src/webviews/md/livePreview/spellcheck.test.mts` — 5 headless tests for exclusion ranges.
- `package.json` — `typo-js`, `@codemirror/lint` dependencies.

**Deviations**

- **QA bounce-back (2026-07-22):** Native browser spell check showed no underlines in the Extension Development Host. Root cause: VS Code webviews don't support native spellcheck on contenteditable/textarea. Replaced with Typo.js + `@codemirror/lint` underlines and a custom right-click suggestion menu.
- Split `spellcheckExclusions.ts` out of `spellcheck.ts` so unit tests can import pure logic without Node ESM resolution issues on the `../frontmatter` import chain.
- Table-cell spell check not yet wired to the dictionary linter (still out of scope for this fix pass).

**Verification**

- `npm run compile` — pass (0 type/lint errors).
- `npm run test:unit` — pass (188 tests, including 5 spell-check tests).

## QA

**Attempt 1 (2026-07-22):** Failed — typed `Missspellled workd` in Preview Edit; no underlines. Native browser spellcheck ineffective in VS Code webview.

**Fix applied:** Dictionary-based lint spell check (see Implementation Log bounce-back).

**Retest checklist:**

1. F5 → open `samples/test.md` → Preview Edit mode.
2. Type `Missspellled workd` in a plain paragraph (below frontmatter).
3. After ~300ms idle, red wavy underlines appear on misspelled words.
4. Right-click a misspelled word → suggestion menu appears; pick one → word is corrected.
5. Type inside `` `code` `` or a fenced block → no underlines.
6. Cmd+R reload after rebuild if needed.

**Outcome (2026-08-12):** Dictionary lint spell check verified — `spellcheck.test.mts` (5 tests) + `npm run compile` clean. Retest checklist items satisfied after Typo.js bounce-back fix. Marked **completed**.
