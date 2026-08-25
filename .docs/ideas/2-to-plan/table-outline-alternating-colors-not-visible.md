---
title: Table outline and alternating row colors not visible
slug: table-outline-alternating-colors-not-visible
status: to-plan
created: 2026-08-23
updated: 2026-08-23
---

# Table outline and alternating row colors not visible

## Idea

On a different machine, rendered Markdown tables show no visible outline/border and no alternating row background colors — both styling features are missing/invisible. User flagged this may be unrelated to the glass-effect issue seen on the same machine.

## Brainstorm

**Decided direction:** fix table border/zebra-stripe visibility so both render with reliable contrast in every VS Code theme (light, dark, high-contrast), without adding a user-facing setting.

**Root cause:** border and stripe currently derive from `--color-border-default` / `--color-surface-raised`, which map to `--vscode-panel-border` / `--vscode-editorWidget-background`. Many themes — including VS Code's own built-in light theme — set these close to the base background by design, making both imperceptible. User confirmed the failure reproduces in light theme too, ruling out a dark-theme-only cause.

**Fix approach:** derive both the table border and the zebra-stripe background from a low-alpha overlay of the current foreground/text color (e.g. `color-mix` or rgba blend against `--vscode-foreground`) instead of the theme's "raised surface" token. Foreground and background always differ, so this guarantees contrast in any theme.

**Zebra stripe vs header row:** give the stripe its own distinct tone, separate from the header row background (today both reuse `--color-surface-raised`) — header stays visually "elevated," stripe stays a subtler alternate-row tint.

**No new setting:** styling stays always-on; no toggle for border/stripe.

**Constraints:** no visible regression in themes where it currently renders fine; must hold up in built-in Light, Dark, and High Contrast themes.

## Plan

_Not started._

## Implementation Log

_Not started._

## QA

_Not started._
