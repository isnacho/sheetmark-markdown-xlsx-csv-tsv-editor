---
title: Spell Check
slug: spell-check
status: to-qa
created: 2026-08-17
updated: 2026-08-17
---

# Spell Check

## Idea

I want to have a spell check within the extension.

## Brainstorm

**Finding:** Spell check already exists for Preview Edit prose (Typo.js + `@codemirror/lint`, red underlines, right-click suggestions, exclusions for frontmatter/code — see `src/webviews/md/livePreview/spellcheck.ts`). It never activates because of a bug, not a missing feature.

**Root cause:** the markdown webview's CSP (`src/mdEditorProvider.ts:730`) sets `default-src 'none'` with no `connect-src` directive. `loadSpellDictionary()` calls `fetch()` on the `en_US.aff`/`en_US.dic` webview-resource URIs (`src/mdEditorProvider.ts:721-722`); with no `connect-src`, that falls back to `default-src 'none'` and the fetch is blocked by CSP. The failure is swallowed by `loadSpellDictionary()`'s `.catch()` (`spellcheck.ts:52-54`), so `typo` never initializes and no diagnostics ever fire — this reproduces as "even paragraphs don't show spelling errors."

**Decided scope:** minimal fix only — add `connect-src ${cspSource}` (or equivalent) to the CSP meta tag so the two dictionary files can load, restoring the paragraph spellcheck that was already implemented. Known gaps in table cells (inert native `spellcheck` attribute), spreadsheet grid cells, and the frontmatter textarea (all currently `spellcheck="false"`/not wired) are explicitly out of scope for this idea — left for a future idea if wanted.

## Plan

**Skipped by user request** — fix scoped tightly enough (one CSP directive) that a full plan pass was judged unnecessary. Direct fix:

- `src/mdEditorProvider.ts` — add `connect-src ${cspSource};` to the markdown webview's CSP meta tag (currently missing, falls back to `default-src 'none'`, blocking the `fetch()` calls in `loadSpellDictionary()`).

## Implementation Log

- `src/mdEditorProvider.ts:730` — added `connect-src ${cspSource};` to the markdown webview's CSP meta tag (single CSP template in this file; no other duplicate to fix).
- `npm run compile` (check-types + lint + esbuild) passes clean.
- No deviation from the plan.

## QA

**Not smoke-tested yet — and the CSP fix surfaced a severe latent perf bug that had to be fixed
first.** Enabling the dictionary fetch ran `buildDiagnostics()` for the first time ever, which
called `typo.suggest()` eagerly for every unknown word in the viewport at **100–460 ms per word** —
a measured **20 402 ms** main-thread freeze per lint pass on a 60-line viewport, firing 300 ms after
every keystroke. This presented to the user as "the Markdown viewer got slow" and was initially
misattributed to the Document Stats feature. Diagnosis and fix:
`.docs/ideas/5-completed/document-stats-perf-regression.md`.

A second latent bug in the same file was fixed there too: diagnostics are viewport-scoped but
`linter()` had no `needsRefresh`, so spell check only underlined the viewport visible at the last
keystroke — scrolling into new text showed nothing.

QA for this idea should therefore be run *after* that fix, and its checklist covers the
spell-check behavior (underlines appear while scrolling, hover and right-click suggestions apply
correctly, code spans / fenced blocks / frontmatter stay excluded).
