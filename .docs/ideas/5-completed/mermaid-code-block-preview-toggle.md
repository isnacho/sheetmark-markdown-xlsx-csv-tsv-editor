---
title: Mermaid code block preview toggle
slug: mermaid-code-block-preview-toggle
status: completed
created: 2026-08-12
updated: 2026-08-12
---

# Mermaid code block preview toggle

## Idea

Within the markdown editor, code blocks that contain Mermaid should be detected automatically. A small dropdown to the right of each such code block lets the user choose between "preview as diagram" and "preview as code". Diagram preview is the default, but the user's choice should be remembered so that when any file opens next time, that preference is kept.

## Brainstorm

### Context

- **Preview Edit (CM6)** is the only normal editing surface; fenced code blocks (including ` ```mermaid `) currently render as styled raw markdown text — no diagram.
- **Version preview** still uses markdown-it + `renderMermaidFlowcharts()` and already renders Mermaid fences as diagrams only (no toggle). Out of scope unless we later want parity.
- Mermaid is already bundled (`mermaid` ^11) with detection heuristics in the legacy fence renderer: language `mermaid` / `flowchart`, or an unlabeled fence whose first non-empty line looks like `gantt`, `sequenceDiagram`, or `graph TB|BT|RL|LR|TD`.

### Product decisions

| # | Decision | Choice |
|---|---|---|
| 1 | **Where it lives** | Preview Edit (CM6) only — that's the gap. Version preview stays diagram-only. |
| 2 | **Which blocks qualify** | Same detection rules as today (table above). Non-Mermaid fences unchanged. |
| 3 | **Two modes (mutually exclusive)** | **Diagram** (default): block widget shows rendered SVG. **Code**: current fenced-code appearance (syntax-highlighted source, fences visible). |
| 4 | **Editing workflow** | Diagram mode is view-only for the block body; user switches to **Code** to edit Mermaid source. Toggling back to **Diagram** re-renders from current source. |
| 5 | **Control placement** | Compact `<select>` (or styled dropdown) in a small header bar on the **top-right** of the Mermaid block — visually aligned with legacy `.code-block-header` (lang label left, control right). Visible in **both** modes so the user can switch without hunting. |
| 6 | **Control labels** | **Diagram** · **Code** (short; tooltips optional: “Preview as diagram” / “Preview as source”). |
| 7 | **Preference scope** | **Global** — one remembered choice for all Mermaid blocks in all Markdown files. Changing the dropdown updates the global default immediately; every Mermaid block in the open file re-layouts to match. |
| 8 | **Default** | **Diagram** on first use (no stored preference yet). |
| 9 | **Persistence** | Extension **globalState** (survives reload; not per-file). Persist on change via host message (same pattern as frontmatter-panel collapse). No new Settings-panel entry in v1 — the dropdown is the control surface. |
| 10 | **Theme** | Diagram theme follows editor light/dark (same logic as `renderMermaidFlowcharts`). |
| 11 | **Render errors** | Inline message inside the diagram widget (“Mermaid syntax error — switch to Code to edit”) plus console log; do not crash the editor or block typing elsewhere. |
| 12 | **Multiple blocks** | All Mermaid blocks in a file share the global mode simultaneously (consistent with #7). |

### UX sketch

```
┌───────────────────────────────────────────── [Diagram ▾] ┐
│  ┌───────────────────────────────────────────────────┐  │
│  │     [ rendered flowchart / sequence / gantt ]     │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘

  ↔ user picks "Code" ↔

┌─────────────────────────────────────────────── [Code ▾] ┐
│ ```mermaid                                              │
│ graph TD                                                │
│   A --> B                                               │
│ ```                                                     │
└─────────────────────────────────────────────────────────┘
```

### Out of scope (v1)

- Per-block remembered mode (file-scoped or block-scoped).
- A VS Code setting duplicate of the dropdown (can add later for discoverability).
- Mermaid in inline code or non-fence contexts.
- Live re-render on every keystroke while in Diagram mode (re-render on mode switch and when entering Diagram after editing in Code is enough).

### Why this direction

Matches the stated goal (detect Mermaid, toggle diagram vs source, default diagram, remember globally) while fitting the existing CM6 block-widget pattern (`tableWidget.ts`) and reusing bundled Mermaid + detection rules instead of inventing parallel logic.

## Plan

### Overview

Add CM6 block decorations for Mermaid fences in Preview Edit: **Diagram** mode replaces the fence with a rendered widget (view-only); **Code** mode keeps editable source with a toolbar above the fence. One **global** mode (default **Diagram**) persisted in extension `globalState`.

### Step 1 — Shared detection helper

**New:** `src/webviews/md/livePreview/mermaidDetection.ts`

- Export `isMermaidFence(state, node: SyntaxNode): boolean` and `extractMermaidSource(state, node): string`.
- Mirror existing fence heuristics from `mdWebview.ts` (~391–401): lang `mermaid` / `flowchart`, or empty lang with first non-empty line matching `gantt`, `sequenceDiagram`, or `graph (TB|BT|RL|LR|TD)`.
- Read lang from `CodeInfo` child; body from `CodeText` children.

### Step 2 — CM6 widget module

**New:** `src/webviews/md/livePreview/mermaidWidget.ts`

**State:**
- `MermaidPreviewMode = 'diagram' | 'code'`
- `mermaidPreviewModeField` + `setMermaidPreviewModeEffect` — lives **outside** `revealCompartment` (survives reveal toggle, like `columnWidthsField`).
- `seedMermaidPreviewMode(mode)` for mount init.

**Decorations** (`buildFromState`, scan all `FencedCode` where `isMermaidFence`):

| Mode | Decorations |
|---|---|
| **Code** | `Decoration.widget({ block: true, side: -1 })` at `node.from` → `MermaidToolbarWidget` (header: lang label left, `<select>` right). Source stays visible/editable below. |
| **Diagram** | Same toolbar widget **plus** `Decoration.replace({ block: true })` over full fence → `MermaidDiagramWidget` (header duplicated inside replace widget OR toolbar-only above + diagram replace without header — pick single replace widget with header + `<div class="mermaid">` body to avoid double header). |

**Prefer:** one `MermaidBlockWidget` in diagram mode (header + diagram body, full replace). In code mode, toolbar-only block widget at `side: -1` above fence.

**`MermaidBlockWidget` / toolbar:**
- `<select>` options: **Diagram** · **Code**; `change` → dispatch `setMermaidPreviewModeEffect` + call persist callback.
- `ignoreEvent(): false` on the `<select>` only (stop propagation on mousedown/change so CM6 doesn't steal focus incorrectly).
- `eq()` keyed on mode, source text hash/range, theme class.

**Rendering:**
- Import `mermaid` in widget module (already bundled via esbuild).
- `mermaid.initialize({ startOnLoad: false, theme })` using same dark/light body-class check as `renderMermaidFlowcharts`.
- `mermaid.run({ nodes })` in `toDOM` / after `updateDOM` when source or mode changes; `.catch` → inline error div (“Mermaid syntax error — switch to Code to edit”).
- No live re-render on every keystroke while in diagram mode (source hidden anyway). Re-render when entering diagram mode or after doc change while staying in code mode then switching back.

**Cursor / atomic ranges:**
- **New** `mermaidAtomicRanges` (or extend existing): when mode is `diagram`, treat each mermaid fence range as atomic (pattern from `orderedListAtomicRanges` in `revealDecorations.ts`).
- On switch **code → diagram**: if selection intersects a mermaid fence, dispatch selection to line after the fence.
- Diagram body is view-only (`ignoreEvent(): true` on diagram area); edits only in code mode.

**Registration in `livePreviewEditor.ts`:**
- Import `mermaidWidgetField`, `mermaidPreviewModeField`, `seedMermaidPreviewMode`, `setMermaidPreviewModeCallback`.
- `seedMermaidPreviewMode` outside reveal compartment.
- `mermaidWidgetField` **inside** `revealCompartment` (consistent with tables — raw fences when reveal off).
- Extend `LivePreviewMountOptions`: `mermaidPreviewMode?`, `onMermaidPreviewModeChanged?`.
- `updateListener`: persist on `setMermaidPreviewModeEffect` (effects-only transaction, like column widths).

### Step 3 — Code styling skip

**Edit:** `src/webviews/md/livePreview/codeStyling.ts`

- When global mode is `diagram`, skip `FencedCode` nodes that pass `isMermaidFence` (avoid ghost line styling under hidden source).
- Code mode: existing fenced styling unchanged.

### Step 4 — Host persistence (globalState)

**New:** `src/shared/mermaidPreviewModeStorageService.ts`

- Key: `xlsxViewer.mermaidPreviewMode`
- `getMode(): 'diagram' | 'code'` — default `'diagram'`
- `saveMode(mode)` via `context.globalState.update`

**Edit:** `src/mdEditorProvider.ts`

- Instantiate service in constructor (alongside frontmatter/table storage).
- `buildInitMarkdownPayload`: add `mermaidPreviewMode: this.mermaidPreviewModeStorage.getMode()`.
- Message handler case `saveMermaidPreviewMode`: read `mode`, validate, `saveMode`.

**Edit:** `src/webviews/md/mdWebview.ts`

- Module var `mermaidPreviewMode: 'diagram' | 'code' = 'diagram'`.
- `initMarkdown` / `diskChangedExternally`: read `m.mermaidPreviewMode`, seed on mount.
- `persistMermaidPreviewMode(mode)` → `postMessage({ command: 'saveMermaidPreviewMode', mode })`.
- Pass through `mountLivePreview({ mermaidPreviewMode, onMermaidPreviewModeChanged: persist })`.
- If mode changes while editor mounted: dispatch effect via new export `setLivePreviewMermaidMode(mode)` in `livePreviewEditor.ts`.

### Step 5 — CSS

**Edit:** `resources/md/mdWebview.css` (and/or `cm6Theme.ts` for CM6-scoped rules)

- `.cm-md-mermaid-toolbar` — flex header, lang label, select aligned right (mirror legacy `.code-block-header`).
- `.cm-md-mermaid-diagram` — padding, max-width 100%, overflow auto for large diagrams.
- `.cm-md-mermaid-error` — muted error text.

No CSP / `localResourceRoots` changes (mermaid already bundled).

### Step 6 — Message protocol doc

**Edit:** `.docs/MESSAGE-PROTOCOL.md`

| Direction | Command | Payload |
|---|---|---|
| host → webview | `initMarkdown` / `diskChangedExternally` | extend with `mermaidPreviewMode: 'diagram' \| 'code'` |
| webview → host | `saveMermaidPreviewMode` | `{ mode: 'diagram' \| 'code' }` |

### Step 7 — Tests (headless where cheap)

**New:** `src/webviews/md/livePreview/mermaidDetection.test.mts` — fence heuristics (mermaid lang, flowchart, unlabeled graph/gantt/sequence, negative cases).

Optional: decoration builder smoke test if pattern exists elsewhere.

### Implementation order

1. `mermaidDetection.ts` + tests  
2. `mermaidPreviewModeStorageService.ts` + host wiring + protocol doc  
3. `mermaidWidget.ts` + CSS  
4. `livePreviewEditor.ts` + `codeStyling.ts` + `mdWebview.ts` glue  
5. `npm run compile`

### Risks / mitigations

| Risk | Mitigation |
|---|---|
| Cursor inside hidden fence in diagram mode | Atomic ranges + selection move on mode switch |
| Async `mermaid.run` errors | Inline error UI; never throw into CM6 update cycle |
| Detection drift vs legacy renderer | Single shared helper; optionally refactor `mdWebview.ts` fence rule to call shared function (minimal import path — may duplicate as pure string helpers to avoid webview/host split) |
| Reveal off hides widgets | Accept same as tables; diagrams revert to raw fences |
| Widget rebuild churn | Strict `eq()`; render diagram only when source/mode/theme changes |

### Out of scope (unchanged from brainstorm)

Version preview toggle, per-block memory, VS Code settings panel entry, hljs in CM6 code mode, live diagram updates while typing in code mode.

## Implementation Log

**2026-08-12:** Implemented CM6 Mermaid diagram/code toggle with global persistence.

- `src/webviews/md/livePreview/mermaidDetection.ts` — shared fence heuristics (+ tests)
- `src/webviews/md/livePreview/mermaidPreviewMode.ts` — global mode StateField
- `src/webviews/md/livePreview/mermaidWidget.ts` — toolbar + diagram block widgets, atomic ranges
- `src/webviews/md/livePreview/codeStylingPlugin.ts` — skip fenced styling for hidden diagram blocks
- `src/shared/mermaidPreviewModeStorageService.ts` — `globalState` persistence
- `src/mdEditorProvider.ts` — init payload + `saveMermaidPreviewMode` handler
- `src/webviews/md/mdWebview.ts` — mount/persist glue; fence rule uses shared detection
- `src/webviews/md/livePreview/livePreviewEditor.ts` — register fields/compartments
- `src/webviews/md/livePreview/cm6Theme.ts` — mermaid widget styles
- `.docs/MESSAGE-PROTOCOL.md` — new message documented

No plan deviations. `npm run compile` clean; `mermaidDetection` + `codeStyling` unit tests pass.

## QA

**2026-08-12 — passed (user sign-off)**

Manual smoke test in Extension Development Host:

- [x] Mermaid fence renders as diagram by default
- [x] **Diagram · Code** dropdown switches modes; code mode editable, diagram view-only
- [x] Global mode persists across file reopen
- [x] Multiple mermaid blocks follow the same global mode
- [x] Overall UX approved — "looks good"

Automated: `npm run compile` clean; `mermaidDetection` + `codeStyling` unit tests pass.
