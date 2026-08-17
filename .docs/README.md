# Documentation index

Two kinds of docs live here. Pick the folder that matches your job.

## `dev/` — Developer reference

Reference material for coding agents and contributors. Load on demand when editing
the codebase — not product roadmap or feature ideas.

| File | Purpose |
|------|---------|
| [ARCHITECTURE.md](dev/ARCHITECTURE.md) | Runtime boundary, providers, data model |
| [MESSAGE-PROTOCOL.md](dev/MESSAGE-PROTOCOL.md) | Host ⇄ webview `postMessage` inventory |
| [MAP-spreadsheetWebview.md](dev/MAP-spreadsheetWebview.md) | Line-range map for `spreadsheetWebview.ts` |
| [MAP-mdWebview.md](dev/MAP-mdWebview.md) | Line-range map for `mdWebview.ts` + `livePreview/` |
| [CHANGELOG.md](../CHANGELOG.md) | Release notes (upstream history + fork **Unreleased**) |

Entry point for agents: [AGENTS.md](../AGENTS.md) at the repo root.

## `product/` — Product documentation

Roadmap, publishing, and local-dev workflow. Not architecture reference.

| File | Status |
|------|--------|
| [PLAN.md](product/PLAN.md) | **Active** — fork → publish roadmap (Phase 1 partially done) |
| [LOCAL-DEV-INSTALL.md](product/LOCAL-DEV-INSTALL.md) | **Active** — symlink install & reversal |
| [completed/PLAN-obsidian-live-preview.md](product/completed/PLAN-obsidian-live-preview.md) | **Done** — CM6 live-preview rebuild (phases 1–8) |
| [completed/REVIEW-wysiwyg-architecture.md](product/completed/REVIEW-wysiwyg-architecture.md) | **Done** — one-time architecture review brief |

## `ideas/` — Idea Lab pipeline

Feature ideas tracked through brainstorm → plan → implement → QA → completed.
See [.claude/skills/idea-lab/SKILL.md](../.claude/skills/idea-lab/SKILL.md).
