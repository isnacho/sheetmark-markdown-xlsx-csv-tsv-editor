---
title: Code block copy button
slug: code-block-copy-button
status: completed
created: 2026-09-05
updated: 2026-09-05
---

# Code block copy button

## Idea

Add a copy button to code blocks so that the code is copied to the clipboard — the code only, not the block. The button should be within the code block itself (top right). Unsure if that's possible.

Don't like how Mermaid has a different header from the preview, and within the code it also contains a header. Everything should be within the actual code block on the top right — consistent placement for code blocks and Mermaid.

## Brainstorm

### Context

- Markdown editing is **CM6 Preview Edit only** — Reading, Split, and the legacy
  contentEditable engine are gone. **Version preview** is the same CM6 instance in
  read-only mode (banner + Restore/Cancel), not a separate render pipeline.
- **Copy today** exists but is hidden: **Cmd/Ctrl+Click** on a fenced block copies
  the **body only** (no ` ``` ` delimiters) via `livePreviewInteractions.ts` →
  `mdWebview.ts`. No visible affordance.
- **Regular fenced blocks** use line decorations (`cm-md-fenced-code-line`) —
  background + border, no header or action buttons.
- **Mermaid** adds a **separate toolbar** above the block (`cm-md-mermaid-toolbar`).
  In **Code** mode that sits above the opening ` ```mermaid ` fence line — a
  “double header” the user dislikes.

### Product decisions

| # | Decision | Choice |
|---|---|---|
| 1 | **Surface** | CM6 only — covers normal edit and read-only version preview (same widgets). |
| 2 | **Chrome pattern** | **Shared in-block overlay** for every fenced block: controls live **inside** the block border, **top-right** (not a separate bar above the block). |
| 3 | **Copy affordance** | Icon button in the overlay; **visible on hover** (subtle when idle, full opacity on block hover). |
| 4 | **Clipboard payload** | **Code body only** — no opening/closing fence lines, no overlay chrome. In Mermaid **Diagram** mode, copy the **Mermaid source**, not rendered SVG. |
| 5 | **Mermaid unification** | **Remove the external `cm-md-mermaid-toolbar`.** Diagram and Code modes both use the same in-block overlay: **lang label top-left**, actions **top-right** (copy + mode dropdown; zoom controls in Diagram mode stay in the overlay right cluster). |
| 6 | **Language label** | Show in overlay **top-left** (e.g. `js`, `mermaid`) so the control row is the block “header”; opening ` ```lang ` line may remain in the document for editing but is visually de-emphasized or overlaid — implementation detail for Plan. |
| 7 | **Power shortcut** | **Keep Cmd/Ctrl+Click copy** alongside the button. |
| 8 | **Feedback** | Brief **“Copied” toast** on success (same pattern as heading link copy). |
| 9 | **Inline code** | **Out of scope** — fenced blocks only, not `` `inline` ``. |
| 10 | **Interaction** | Button clicks must **not move the caret** or steal typing (`stopPropagation` / `ignoreEvent`, same as existing Mermaid controls). |
| 11 | **Version preview** | Copy works in read-only mode. Mermaid mode dropdown and other edit affordances follow existing read-only guards (`isVersionPreviewMode`). |

### UX sketch

```
┌─ js ──────────────────────────────────────── [⧉] ─┐
│ const x = 1;                                       │
│ console.log(x);                                    │
└────────────────────────────────────────────────────┘
  hover → copy icon fully visible; click → "Copied" toast

Mermaid (Diagram mode):
┌─ mermaid ────────── [−][100%][+][↺][Diagram▾][⧉] ─┐
│  [ rendered diagram ]                               │
└─────────────────────────────────────────────────────┘

Mermaid (Code mode) — same overlay row, source editable below:
┌─ mermaid ─────────────────────── [Diagram▾][⧉] ─┐
│ ```mermaid                                         │
│ graph TD                                           │
│   A --> B                                          │
│ ```                                                │
└────────────────────────────────────────────────────┘
```

### Out of scope (v1)

- Copy on inline code spans.
- Per-block or per-file copy-button settings.
- Changing what Cmd/Ctrl+Click does on non-code constructs.

### Why this direction

One consistent in-block control pattern fixes the Mermaid “double header” problem
and makes copy discoverable without adding a second render pipeline or
mode-specific UI. Reuses existing clipboard extraction (`detectInteractionAtPos`
/ `extractMermaidSource`) and toast patterns.

## Plan

### Overview

Add a shared **in-block fence chrome** overlay (lang left, copy + optional Mermaid
controls right) for every `FencedCode` block in CM6 Preview Edit. Refactor Mermaid
to use the same chrome instead of the external `cm-md-mermaid-toolbar`. No
message-protocol changes.

### Step 1 — Shared fence extractors

**New:** `src/webviews/md/livePreview/fenceExtraction.ts`

- `extractFenceLangName(state, node)` — from `CodeInfo` first token (generalize
  `extractMermaidLangName`).
- `extractFenceBody(state, node)` — from `CodeText` children (same as today’s
  copy path).
- `fenceDisplayLang(state, node)` — lang label or `'text'` when empty.

**Edit:** `mermaidDetection.ts` — re-export or delegate to `fenceExtraction.ts`
so Mermaid helpers stay stable for existing imports/tests.

**Edit:** `livePreviewInteractions.ts` — use `extractFenceBody` in
`detectInteractionAtPos` (Cmd/Ctrl+Click copy unchanged).

**Tests:** `fenceExtraction.test.mts` — lang/body/empty fence; update
`mermaidDetection.test.mts` if delegation changes imports only.

### Step 2 — Fence chrome widget module

**New:** `src/webviews/md/livePreview/fenceChromeWidget.ts`

**DOM structure** (shared builder `createFenceChrome(...)`):

```html
<div class="cm-md-fence-chrome" data-fence-from="…">
  <span class="cm-md-fence-lang">js</span>
  <div class="cm-md-fence-actions">
    <!-- optional: mermaid zoom controls, mode <select> -->
    <button class="cm-md-fence-copy-btn" title="Copy code">…Icons.Copy…</button>
  </div>
</div>
```

- `FenceChromeWidget extends WidgetType` — `ignoreEvent(): true`; copy button
  `mousedown`/`click` → `stopPropagation()`.
- Copy: `navigator.clipboard.writeText(body)` → `onFenceCopyCallback?.()` toast
  hook (same pattern as `setMermaidPreviewModeCallback`).
- Export `setFenceCopyCallback` for `mdWebview.ts` to wire `showToast('Copied')`.

**Decoration strategy:**

| Block type | Mode | Decoration |
|---|---|---|
| Normal fence | — | `Decoration.widget({ block: true, side: -1 })` at `node.from` |
| Mermaid | Code | Same widget chrome (no separate toolbar above fence) |
| Mermaid | Diagram | Keep `Decoration.replace` for body; chrome row is **inside**
  `MermaidDiagramWidget` via shared `createFenceChrome` (not `side: -1` widget) |

- Chrome is **absolutely positioned** inside the first-line padding band
  (`paddingTop: 16px` on `.cm-md-fenced-code-line-first`) so it sits inside
  the block border, not above it.
- Opening ` ```lang ` line: add class `cm-md-fenced-code-line-fence-marker` via
  `codeStyling.ts` on the first line when chrome is present; CSS hides or
  collapses visible lang text (keep chars in document for editing).

**StateField:** `fenceChromeWidgetField` — rebuild on `docChanged` and when
`syntaxTree` length grows (same incremental-parse guard as `mermaidWidgetField`).
Iterate all `FencedCode`; skip Mermaid fences in **diagram** mode (chrome lives
in replace widget).

Register in `livePreviewEditor.ts` **outside `revealCompartment`** (next to
`codeStylingPlugin`, ~line 301) so copy works when reveal is off.

### Step 3 — Refactor Mermaid widgets

**Edit:** `mermaidWidget.ts`

- Remove `MermaidToolbarWidget` and external `Decoration.widget({ side: -1 })` in
  code mode.
- **Code mode:** no extra mermaid-specific decoration — `fenceChromeWidgetField`
  handles chrome + copy + mode select.
- **Diagram mode:** `MermaidDiagramWidget` calls `createFenceChrome(view, {
  langLabel, copyText: source, modeSelect, zoomControls })` as top row inside
  `.cm-md-mermaid-block`; remove standalone `createToolbar`.
- Mode `<select>`: disable when `view.state.readOnly` (version preview).
- Keep `mermaidAtomicRanges`, `adjustSelectionForDiagramMode`, preview mode
  persistence unchanged.

Pass Mermaid mode select + zoom into chrome via optional slots on
`createFenceChrome` (right cluster order: zoom → mode select → copy).

### Step 4 — Styling

**Edit:** `cm6Theme.ts`

- Add `.cm-md-fence-chrome`, `.cm-md-fence-lang`, `.cm-md-fence-actions`,
  `.cm-md-fence-copy-btn` — flex row, absolute top/left/right inside fence,
  idle copy opacity ~0.35, full on `.cm-md-fenced-code-line-first:hover` (or
  parent hover via JS class toggle on fence block if needed).
- Add `.cm-md-fenced-code-line-fence-marker` — `color: transparent` or
  `font-size: 0` with preserved height so caret still lands on opening fence
  line.
- Remove or repurpose `.cm-md-mermaid-toolbar` / `-toolbar-right` rules; keep
  `.cm-md-mermaid-block`, diagram, zoom, error styles.

**Edit:** `resources/md/mdWebview.css` — mirror fence chrome + fence-marker
  rules; drop stale `.cm-md-mermaid-lang` if merged into `.cm-md-fence-lang`.

### Step 5 — Wire toast in mdWebview

**Edit:** `mdWebview.ts` + `livePreviewEditor.ts`

- Import `setFenceCopyCallback` from `fenceChromeWidget.ts`.
- On mount: `setFenceCopyCallback(() => showToast('Copied'))`; clear on unmount
  (alongside existing mermaid/frontmatter callbacks).
- No new `postMessage` commands.

### Step 6 — Tests

| File | What to add |
|---|---|
| `fenceExtraction.test.mts` | Lang/body extraction, empty fence |
| `fenceChromeWidget.test.mts` | Decoration count per fence; skip mermaid diagram fences |
| `livePreviewInteractions.test.mts` | Confirm body still matches `extractFenceBody` |
| `mermaidWidget.test.mts` | No `MermaidToolbarWidget` decoration in code mode |
| `codeBlockBoundaryEditing.test.mts` | Smoke — arrow nav still works with chrome mounted |

### Files touched (summary)

| Action | Path |
|---|---|
| New | `fenceExtraction.ts`, `fenceExtraction.test.mts`, `fenceChromeWidget.ts`, `fenceChromeWidget.test.mts` |
| Edit | `mermaidDetection.ts`, `livePreviewInteractions.ts`, `mermaidWidget.ts`, `codeStyling.ts`, `livePreviewEditor.ts`, `cm6Theme.ts`, `mdWebview.css`, `mdWebview.ts` |
| Tests | `mermaidDetection.test.mts`, `livePreviewInteractions.test.mts`, `mermaidWidget.test.mts` |

### Risks / DO-NOTs

- **Block widgets must be `StateField`** — not `ViewPlugin` (table widget precedent).
- **No margins on fence lines** — overlay uses absolute positioning inside
  existing padding only.
- **Do not mark normal fences atomic** — only diagram-mode Mermaid keeps
  `mermaidAtomicRanges`.
- **Read-only:** copy always enabled; Mermaid mode select disabled in version
  preview (`view.state.readOnly`).
- **Reveal off:** fence chrome stays mounted (outside `revealCompartment`).
- **No message-protocol / CSP / viewType changes.**

### Verification

1. `npm run compile` (0 type + 0 lint errors).
2. Unit tests for new/edited `*.test.mts` in `livePreview/`.
3. Manual F5 smoke on `samples/test.md`: normal fences copy body only; hover
   shows copy; Mermaid code/diagram unified chrome; version preview copy works,
   mode select disabled; Cmd/Ctrl+Click copy still works.

## Implementation Log

- **New:** `fenceExtraction.ts` — shared lang/body extractors; `mermaidPreviewActions.ts` —
  Mermaid mode dispatch + select (extracted from `mermaidWidget.ts`); `fenceChromeWidget.ts` —
  in-block chrome overlay + copy button `StateField`.
- **Edited:** `mermaidWidget.ts` — diagram mode only; chrome via shared `createFenceChrome`;
  `mermaidDetection.ts` — delegates to fence extractors; `livePreviewInteractions.ts` — uses
  `extractFenceBody`; `codeStyling.ts` — hides opening fence line (`fence-marker` class);
  `livePreviewEditor.ts` — registers `fenceChromeWidgetField` outside reveal compartment;
  `cm6Theme.ts` + `mdWebview.css` — fence chrome styles, removed external mermaid toolbar styles;
  `mdWebview.ts` — `onFenceCopied` toast wiring.
- **Tests:** `fenceExtraction.test.mts` (new); `codeStyling.test.mts` updated for fence-marker
  class. `npm run compile` clean; `fenceExtraction` + `codeStyling` unit tests pass.
- **Post-plan iterations (spacing + chrome):** Removed lang overlay (opening ` ```lang ` stays visible). Copy row sits inside the block via `fenceChromeWidget` (`top: 100%` on chrome host). External block gap uses head spacer in chrome block + `FenceTailGapWidget` at fence end (not line padding — avoids in-card bottom gap and `node.from` widget collision). Split `--cm-md-fence-inset` (internal) vs `--cm-md-fence-external-gap` (outside card). Copy button inset `--cm-md-fence-chrome-inset: 6px` (equal top/right).
- **No deviations** from core plan (copy affordance, Mermaid unification, toast, Cmd/Ctrl+Click).

## QA

**Build:** `npm run compile` clean; `codeStyling.test.mts` + `fenceExtraction.test.mts` pass (2026-09-05).

**Manual F5 (`samples/test.md`):**

- [x] Fenced blocks show sunken card; copy icon appears on hover, top-right inside block.
- [x] Click copy → clipboard has body only (no fence lines); “Copied” toast.
- [x] Cmd/Ctrl+Click on fence still copies body.
- [x] Mermaid Code mode: in-block chrome (mode select + copy); no external toolbar.
- [x] Mermaid Diagram mode: zoom/mode/copy overlay inside diagram preview.
- [x] External whitespace below block sits outside card (not on next paragraph line).
- [x] Copy button ~6px from top and right edges.
- [x] Arrow-key navigation through multi-line fences still works.

**Outcome: passed** (2026-09-05).
