---
title: Mermaid diagrams on large documents (incremental parse)
slug: mermaid-incremental-parse-widgets
status: completed
created: 2026-08-15
updated: 2026-08-15
---

# Mermaid diagrams on large documents (incremental parse)

## Idea

Mermaid diagram in `samples/test.md` did not render. Diagram syntax was valid; the widget field never rebuilt after CM6's background markdown parse extended the syntax tree past the first chunk.

## Brainstorm

**Root cause:** On large markdown files, CodeMirror parses incrementally. `samples/test.md` (~6000 chars) had an initial syntax tree covering only ~3524 chars; the mermaid fence starts at char 4583. `mermaidWidgetField` rebuilt only on `docChanged` or mermaid mode toggle — not when the parse worker dispatched `Language.setState` after extending the tree. `tableWidgetField` already rebuilds on every transaction and was unaffected.

**Fix:** Rebuild mermaid decorations when `syntaxTree(state).length` grows between `startState` and `state`.

## Plan

1. Add `shouldRebuildMermaidWidgets(tr)` in `mermaidWidget.ts` — gate on doc change, mode effect, or syntax-tree growth.
2. Regression test in `mermaidWidget.test.mts` documenting partial vs full parse on `samples/test.md`.

## Implementation Log

- `src/webviews/md/livePreview/mermaidWidget.ts` — `shouldRebuildMermaidWidgets()`; `mermaidWidgetField.update` uses it.
- `src/webviews/md/livePreview/mermaidWidget.test.mts` — new regression test.
- `npm run compile` — pass. Unit tests (`mermaidDetection`, `mermaidWidget`) — pass.

## QA

- [x] `samples/test.md` mermaid fence syntax validated in browser (mermaid 11).
- [x] Confirmed initial `syntaxTree` length < doc length; full tree includes one mermaid fence.
- [x] `npm run compile` — pass (2026-08-15).
- [x] Unit tests — pass (`mermaidWidget.test.mts`, `mermaidDetection.test.mts`).
- [x] Manual F5: open `samples/test.md`, scroll to ## Mermaid — diagram renders after background parse (user confirmed via completion request).
