---
title: Idea Lab git commits for clean history
slug: idea-lab-git-commits
created: 2026-08-12
updated: 2026-08-12
status: to-plan
---

# Idea Lab git commits for clean history

## Idea

Improve idea-lab skill to use git commits alongside its `git mv` phase transitions, so idea file history stays clean (one commit per phase, not squashed into unrelated work).

## Brainstorm

Decided direction:

- **Scope:** each git-tracked phase transition commits the idea file *only* —
  never bundled with the phase's actual code/content changes. Keeps idea-lab
  history decoupled and greppable; code changes (Implement phase) keep
  committing on their own normal cadence, unaffected.
- **Timing:** commit immediately at the end of every phase, right after the
  existing `git mv` + frontmatter/section edit — Capture, Brainstorm, Plan,
  Implement, QA (both pass *and* fail/bounce-back), and Archive. A QA
  bounce-back (fail → back to Plan/Implement) gets its own commit too, so the
  loop shows up in history instead of being squashed away.
- **Confirmation:** auto-commit, no user confirmation needed — it's a local,
  fully reversible commit scoped to exactly one file, not a push or anything
  touching shared state.
- **Message format:** `idea-lab: <slug> <old-status> → <new-status>`
  (e.g. `idea-lab: sticky-column-headers to-brainstorm → to-plan`). The
  `idea-lab:` prefix doubles as the filter tag for `git log --grep=idea-lab`.
  Capture's first commit has no old status: `idea-lab: <slug> captured`.
  Archive: `idea-lab: <slug> archived`.
- **Safety (non-negotiable):** stage *only* the idea file's path explicitly
  (`git add <path>`), never `git add -A` / `-u` — must not sweep in whatever
  else is dirty in the working tree at the time.
- **Fallback:** when `.docs/ideas/` isn't git-tracked (skill already has a
  plain-`mv` fallback for the file move), skip commit entirely — no git repo
  to commit into.

Not adopted: bundling idea file + phase's code changes into one commit (ties
idea-lab into code history); committing only at terminal states (loses
mid-pipeline granularity); requiring confirmation before each commit (too
much friction for a fully reversible, scoped, local action).

## Plan

_Not started._

## Implementation Log

_Not started._

## QA

_Not started._
