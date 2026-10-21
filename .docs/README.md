# Documentation index

Two kinds of docs live here. Pick the folder that matches your job.

## `dev/`: Developer reference

Reference material for coding agents and contributors. Load on demand when editing
the codebase; not product roadmap or feature ideas.

| File | Purpose |
|------|---------|
| [ARCHITECTURE.md](dev/ARCHITECTURE.md) | Runtime boundary, providers, commands, data flows |
| [MESSAGE-PROTOCOL.md](dev/MESSAGE-PROTOCOL.md) | Host ⇄ webview `postMessage` inventory |
| [MAP-spreadsheetWebview.md](dev/MAP-spreadsheetWebview.md) | Symbol map for `spreadsheetWebview.ts` and its components |
| [MAP-mdWebview.md](dev/MAP-mdWebview.md) | Symbol map for `mdWebview.ts` + every `livePreview/` module |
| [flow.md](flow.md) | Mermaid flowchart of the Markdown external-disk-change UX (toast vs diff review) |
| [CHANGELOG.md](../CHANGELOG.md) | Release notes |

Entry point for agents: [AGENTS.md](../AGENTS.md) at the repo root. Shared webview modules:
[src/webviews/shared/guide.md](../src/webviews/shared/guide.md).

## `product/`: Product documentation

Product rules, roadmap, and history. Not architecture reference.

| File | Status |
|------|--------|
| [MARKDOWN-TABLES.md](product/MARKDOWN-TABLES.md) | **Active**: canonical product rules for Markdown tables; update it with any table behavior change |
| [PLAN.md](product/PLAN.md) | **Historical, partly stale**: original fork → publish plan. Its checklists predate publishing (the extension now ships via GitHub Actions); use for background only |
| [completed/PLAN-obsidian-live-preview.md](product/completed/PLAN-obsidian-live-preview.md) | **Done**: CM6 live-preview rebuild (phases 1 to 8) |
| [completed/REVIEW-wysiwyg-architecture.md](product/completed/REVIEW-wysiwyg-architecture.md) | **Done**: one-time architecture review brief |

Publishing and local dev install live in the publish skill, not here:
[publish-sheetmark/SKILL.md](../.agents/skills/publish-sheetmark/SKILL.md) (local symlink install and
reversal: [references/local-install.md](../.agents/skills/publish-sheetmark/references/local-install.md)).

## `ideas/`: Idea Lab pipeline

Feature ideas tracked through brainstorm → plan → implement → QA → completed
(folders `1-to-brainstorm` to `5-completed`).
See [.agents/skills/mii-idea-lab/SKILL.md](../.agents/skills/mii-idea-lab/SKILL.md).
