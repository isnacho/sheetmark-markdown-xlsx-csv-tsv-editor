---
title: Line numbers in live preview
slug: line-numbers-in-live-preview
status: completed
created: 2026-07-20
updated: 2026-07-20
---

# Line numbers in live preview

## Idea

On the preview edit, want a toggle to show the line number next to the actual markdown lines. Important so I can tell the AI the specific line number where errors are. Should be subtle — some sort of grey, appearing to the left of the text.

Also want to change the existing bottom-right preview that shows number of lines and number of characters (one-minute read) to also include the line number where my cursor is currently.

## Brainstorm

**Feature A — line-number gutter (Preview Edit mode only)**
- New toggle lives in the Settings panel (matches where wordWrap/reveal/theme
  toggles already live). Off by default — most editing doesn't need it; the
  user turns it on specifically when about to reference a line to the AI.
- Scope: Preview Edit engine only. Not Split mode's textarea, not Reading
  mode.
- Visual: subtle grey numbers to the left of each line. Reuses the look
  `.cm-gutters` already defines (opacity 0.5) — no new visual language.
- Interaction: clicking a line number selects that line (VS Code gutter-click
  convention) — not just a static label.

**Feature B — cursor position in status bar**
- The existing status bar ("N lines · N words · N chars · ~N min read")
  gains a leading segment with the live cursor position: `Ln 12, Col 5`.
- Full format: `Ln 12, Col 5 · 45 lines · 320 words · 1,840 chars · ~2 min
  read`.
- Both line and column (VS Code convention), not line-only.
- Live-updates on cursor move (click/arrow keys), not just on content edits.
- Active whenever there's a cursor — Preview Edit and Split. In Reading mode
  (no cursor), the `Ln, Col` segment is omitted entirely rather than frozen
  at a stale value.

## Plan

Full plan on disk at `/Users/UALLEIG/.claude/plans/vivid-swinging-orbit.md`
(approved). Summary:

**Feature A — line-number gutter (Preview Edit only)**
- New setting `xlsxViewer.md.livePreviewLineNumbers` (boolean, default
  `false`) — distinct from the existing unrelated `md.showLineNumbers`
  (code-block line numbers).
- `package.json`: add the config entry.
- `src/mdEditorProvider.ts`: read/forward it in the 3 settings-payload sites
  and persist it in the `updateSettings` handler.
- `src/webviews/md/livePreview/livePreviewEditor.ts`: new `gutterCompartment`,
  `showLineNumbers` mount option, `setLivePreviewLineNumbers(on)` export
  (mirrors `revealCompartment`/`setLivePreviewReveal`). Gutter built via CM6's
  `lineNumbers({ domEventHandlers: { click: ... } })` — click selects that
  line's text (`EditorSelection.range(line.from, line.to)`). No new CSS —
  `.cm-gutters` in `cm6Theme.ts` already dims it to 0.5 opacity.
- `src/webviews/md/mdWebview.ts`: add to `currentSettings`, pass into
  `mountLivePreview({...})`, live-wire in `applySettings()` next to the
  `livePreviewReveal` call, add `chkLivePreviewLineNumbers` settings-panel
  entry mirroring `chkLivePreviewReveal`.

**Feature B — cursor position in status bar**
- `updateStatusInfo()` in `mdWebview.ts` prepends `Ln X, Col Y`, gated by
  `getCurrentViewMode()`: omitted in `'reading'`, computed from
  `editor.selectionStart` (new `lineColFromOffset` helper) in `'split'`,
  from a new `getLivePreviewCursorPosition()` export in
  `livePreviewEditor.ts` in `'preview'` (only when `isLivePreviewActive()` —
  legacy contentEditable engine has no cursor source, stays omitted).
- Live-update on cursor move (not just edits): new `onSelectionChange` mount
  option firing on CM6's `update.selectionSet`; new `click`/`keyup`
  listeners on the Split-mode textarea in `wireEditor()`.

No `.docs/MESSAGE-PROTOCOL.md` changes needed (adds a field to existing
generic settings messages, not a new message).

## Implementation Log

Implemented per plan, no deviations. Files changed:
- `package.json` — new `xlsxViewer.md.livePreviewLineNumbers` config (boolean,
  default `false`).
- `src/mdEditorProvider.ts` — read/forward it in the 3 settings-payload sites
  (`webviewReady`, `enableMdEditor`, config-change listener) and persist it
  in the `updateSettings` handler.
- `src/webviews/md/livePreview/livePreviewEditor.ts` — `lineNumbers` +
  `EditorSelection` imports, `gutterCompartment`, `buildLineNumbersGutter()`
  (click selects the line's text), `showLineNumbers` mount option,
  `setLivePreviewLineNumbers()` export, `onSelectionChange` mount option
  (fires on `update.selectionSet`), `getLivePreviewCursorPosition()` export.
- `src/webviews/md/mdWebview.ts` — `currentSettings.livePreviewLineNumbers`,
  new import of `setLivePreviewLineNumbers`/`getLivePreviewCursorPosition`,
  `showLineNumbers`/`onSelectionChange` passed into `mountLivePreview({...})`,
  live-wire + checkbox reflect in `applySettings()`, new `settingsDefs` entry
  `chkLivePreviewLineNumbers` ("Line Numbers (Preview Edit)"), new
  `lineColFromOffset()` + `getCurrentCursorPosition()` helpers,
  `updateStatusInfo()` now prepends `Ln X, Col Y` when a cursor position is
  available, and `wireEditor()` gained `click`/`keyup` listeners on the Split
  textarea to keep it live on cursor-only moves.

`npm run compile` — 0 type errors, 0 lint issues, bundle built clean.

## QA

Tested live via F5 in the Extension Development Host, iterating in real time:
- Gutter toggle in Settings panel: off by default, confirmed.
- Gutter styling iterated to final look: `var(--text-faint)` (new shared
  token, see below), 12px font.
- Click-to-select-line: confirmed working.
- Cursor position in status bar (`Ln X, Col Y`): confirmed live-updating in
  both Split and Preview Edit.
- Found and investigated: no gutter number shown over tables. Root cause:
  `tableWidget.ts` replaces a table's whole source range with one atomic
  block widget (`Decoration.replace({block: true, widget})`), and CM6's
  stock `lineNumbers()` gutter only numbers `BlockType.Text` blocks —
  widget blocks are skipped by design. Numbering resumes correctly right
  after the table. Decided: leave as-is, matches standard CM6/editor
  behavior for non-text blocks, not worth the custom-gutter work.

Side effect during QA: added a new shared design token `--text-faint`
(`resources/shared/theme.css`, light/dark/vscode-theme blocks) — a lighter
gray step between `--text-muted` and background, used for the gutter and
reusable elsewhere. Light-mode value hardcoded to `#d2d2d7` (matches
`--border-color`); dark/vscode values use
`color-mix(in srgb, var(--text-muted) 55%, var(--bg-color))`.

Outcome: **passed.**
