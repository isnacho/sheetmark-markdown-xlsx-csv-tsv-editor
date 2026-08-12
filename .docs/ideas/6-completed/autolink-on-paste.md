---
title: Auto-hyperlink on paste
slug: autolink-on-paste
status: completed
created: 2026-07-21
updated: 2026-07-21
---

# Auto-hyperlink on paste

## Idea

When pasting a link into the Markdown document, it should automatically become a formatted hyperlink rather than staying as plain text. Two use cases so far:
- Pasting a link with no selection should turn the pasted URL itself into a hyperlink.
- Selecting some text first, then pasting a link, should turn the selected text into a hyperlink pointing to the pasted URL.

Open question raised by the user: are there more use cases worth covering beyond these two?

## Brainstorm

**Scope:** CM6 "Preview Edit" editor only. The legacy `<textarea>`-based "Split" mode editor is untouched — no existing paste handling there either, but out of scope for this idea. (Could be a follow-up idea if wanted later.)

**Behavior — no selection, paste a URL:**
Wrap the pasted URL as a markdown link with itself as the label: `[url](url)`.

**Behavior — selection active, paste a URL:**
Replace the selected text with `[selectedText](url)`, i.e. the selection becomes the link label and the pasted clipboard content becomes the target. This mirrors the existing `computeInsertLink` transaction shape in `formatCommands.ts`.

**Link detection (when does paste trigger this vs. a plain paste):**
Clipboard content must be a single line matching a URL pattern — `http://`, `https://`, or `www.`-prefixed. Multi-line clipboard content always falls through to a normal, untouched paste.

**Skip-transform edge cases (fall through to plain paste, no linkify):**
- Clipboard content is multi-line.
- Cursor/selection is currently inside an existing markdown link's URL or label portion.
- Cursor/selection is inside inline code (`` `code` ``) or a fenced code block.

**Undo:**
The whole linkify (text insertion + wrap) must be a single CM6 transaction, so one Cmd+Z undoes it completely — not two separate undo steps.

**Why this shape:** matches how Slack/Notion/Google Docs handle paste-to-link (silent, default-on, single-undo-reversible) rather than needing a settings toggle. Keeps the feature additive on top of the existing `computeInsertLink`/`computeWrapSelection` primitives already in the CM6 live-preview editor rather than inventing a new pattern.

## Plan

1. Add pure helpers in `formatCommands.ts`: `isPasteableUrl`, `isPasteLinkifyBlocked`, `computePasteLink` (single CM6 transaction).
2. Wire a `paste` handler in `livePreviewEditor.ts` via `EditorView.domEventHandlers` — dispatch spec or fall through to default paste.
3. Unit tests in `formatCommands.test.mts` for URL detection, both paste shapes, and skip cases (code, link, multi-line).

## Implementation Log

- `src/webviews/md/livePreview/formatCommands.ts` — `isPasteableUrl`, `isPasteLinkifyBlocked`, `computePasteLink`.
- `src/webviews/md/livePreview/livePreviewEditor.ts` — paste handler on existing `domEventHandlers` extension.
- `src/webviews/md/livePreview/formatCommands.test.mts` — 8 new tests.
- `npm run compile` clean; `npm run test:unit` 165/165 pass.
- Follow-up: `revealDecorations.ts` `isActive` — collapsed caret at a node's exclusive `to` no longer counts as inside (fixes paste leaving the link expanded); 2 regression tests added (170/170 pass).

## QA

**2026-07-21 — passed (manual smoke test, Extension Development Host)**

- Paste URL with no selection → `[url](url)`, collapsed blue underline (not expanded syntax).
- Paste URL over selected text → `[label](url)`, collapsed styling.
- Click into pasted link → syntax expands (reveal-on-cursor).
- Paste inside inline code / fenced block / existing link → plain paste, no linkify.
- Multi-line clipboard → plain paste.
- Cmd+Z after linkify → single-step undo.
- Automated: `npm run compile` clean; `npm run test:unit` 170/170 pass.
