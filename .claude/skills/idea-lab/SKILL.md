---
name: idea-lab
description: Take an idea from a raw jot-down through brainstorming, an implementation plan, coding, and QA in five gated phases, tracked in a markdown file any agent can resume. Use when the user wants to capture a new idea, continue/resume an idea file, brainstorm improvements to an idea, plan or implement an idea against this codebase, or archive/complete an idea. Trigger on "/idea", "new idea", "jot down an idea", "let's brainstorm this", or when asked to continue something under .docs/ideas/.
---

# Idea Lab

Five-phase pipeline for turning a raw idea into shipped, QA'd code:
**Capture → Brainstorm → Plan → Implement → QA**.

## Core principle: the file is the source of truth

Every idea lives in exactly one markdown file. That file's frontmatter `status`
field says which phase it's in. **A different agent, in a different session, with
zero memory of this conversation, must be able to open the file and correctly
resume it.** Never rely on conversation history to know what phase an idea is
in — always read the file first.

This means:
- Don't ask the user to re-explain context that's already written in the file.
- Don't skip ahead of what the file's `status` says, even if the chat history
  implies more progress happened.
- Every phase, before stopping, must leave the file in a state where the *next*
  phase (run by anyone, anytime) has everything it needs.

## Directory layout

```
.docs/ideas/                  active ideas (any status from captured..in_qa)
.docs/ideas/completed/        finished ideas — moved here automatically on QA pass
.docs/ideas/archive/          abandoned ideas — moved here when the user decides
                               not to implement something
```

Files are named `.docs/ideas/<slug>.md`, `<slug>` = kebab-case of the title
(e.g. `sticky-column-headers.md`). If a slug collides, append `-2`, `-3`, etc.

## Idea file format

Scaffold new files from
[templates/idea-template.md](templates/idea-template.md). Frontmatter:

```yaml
status: captured | brainstormed | planned | implemented | in_qa | completed | archived
```

Get the real current date with `date +%F` (via Bash) when writing `created` /
`updated` — never hardcode or guess a date.

Body has five fixed sections in this order: `## Idea`, `## Brainstorm`,
`## Plan`, `## Implementation Log`, `## QA`. Each phase fills in its own
section via a surgical edit and leaves the others alone. Never delete or
truncate a completed section when writing a later one.

## Entry point — every invocation starts here

1. If the user names a specific idea or points at a file under `.docs/ideas/`,
   read it and jump straight to the phase matching its `status`.
2. If the user is clearly describing a brand-new idea inline, skip to **Phase
   1** with that text.
3. Otherwise (bare invocation), list the files directly under `.docs/ideas/`
   (not `completed/` or `archive/`) with their `title` and `status`, and ask
   which one to continue, or whether to capture something new.

Only one phase runs per invocation. **Stop after finishing a phase and ask
before continuing to the next one** — e.g. "Idea captured at
`.docs/ideas/foo.md`. Brainstorm it now, or later?" Don't barrel through
multiple phases unprompted.

At the start of any phase, ask the user if they want to abandon the idea
instead if that seems to be where the conversation is heading (see
**Archiving**, below) rather than forcing it through the next phase.

## Phase 1 — Capture

Goal: get the idea down in the user's own words, fast, with minimal friction.

1. Ask the user to state the idea in a sentence or two. Accept it as-is —
   don't edit their wording or expand it yet, that's Brainstorm's job.
2. Derive a short title and slug. Confirm the title with the user only if it's
   genuinely ambiguous; otherwise just state what you picked.
3. Copy `templates/idea-template.md` to `.docs/ideas/<slug>.md`, fill in
   `title`, `slug`, `created`, `updated` (today, via `date +%F`), `status:
   captured`, and the `## Idea` section with the raw text.
4. Report the file path. Ask if they want to move to Brainstorm now.

## Phase 2 — Brainstorm

Goal: sharpen the idea as a UX/product decision — what the feature should
feel and behave like for the user — before anyone commits to a plan. This is
a product brainstorm, not a technical design pass.

1. Read the file's `## Idea` section (and `## Brainstorm` if re-entering after
   a QA bounce-back — see **Loops back**, below).
2. Do only enough technical investigation to understand what's actually being
   asked and whether it's in the right ballpark feasibility-wise — confirm
   the surface the user means exists, and a quick grep for whether something
   similar already ships (don't reinvent what's already in
   `src/webviews/shared/**`, or a setting that already does this). Stop
   there — don't map message-protocol wiring or file-by-file implementation;
   that belongs to Phase 3 (Plan).
3. Generate options across UX/product angles: stronger/simpler versions of
   the interaction, scope cuts (what's the smallest version that's still
   worth doing?), where it lives in the UI, sensible defaults, discoverability,
   and edge cases as the *user* would hit them (not implementation edge
   cases). Number the options.
4. Discuss with the user: which to keep, drop, or combine. Accept shorthand
   feedback ("keep 1,3, drop 2").
5. Write the finalized outcome into `## Brainstorm` as a product spec: the
   decided UX direction, why, and enough detail (states, defaults, placement,
   copy) that Phase 3 can design against it without re-asking product
   questions. Not the full list of rejected options. Set `status:
   brainstormed`, bump `updated`.
6. Ask if they want to move to Plan now.

## Phase 3 — Plan

Goal: a concrete, codebase-grounded implementation plan.

1. Read `## Idea` and `## Brainstorm`.
2. Explore the codebase for what the idea touches. For anything beyond a
   quick targeted lookup, delegate to the `Explore` agent rather than
   grepping manually in this conversation. This repo has two runtimes
   (extension host vs. webview) and an untyped string message protocol
   between them — both are explained in `CLAUDE.md`, which is already loaded;
   apply its rules (don't rename `xlsxViewer.*`/`xlsx-viewer.*` IDs, wire both
   sides of any new message, watch CSP/`localResourceRoots` for new assets,
   don't touch esbuild output paths).
3. Enter plan mode (`EnterPlanMode`) and draft the plan: files to touch, in
   what order, message-protocol changes needed on both ends, and anything
   from the hard DO-NOTs in `CLAUDE.md` that's at risk. Present it via
   `ExitPlanMode` for real user approval before writing any code.
4. Once approved, write the plan into `## Plan` (steps + files, not the whole
   plan-mode transcript). Set `status: planned`, bump `updated`.
5. Ask if they want to move to Implement now.

## Phase 4 — Implement

Goal: build exactly what's in `## Plan`, nothing more.

1. Read `## Plan`. Implement it. Follow this repo's engineering conventions
   (no speculative abstraction, no unrequested refactors, wire both sides of
   any message-protocol change).
2. Run `npm run compile` (type-check + lint + bundle) and fix anything it
   flags — this is the repo's baseline verification, per `CLAUDE.md`.
3. Append to `## Implementation Log`: files changed, and any deviation from
   the plan with why. Set `status: implemented`, bump `updated`.
4. Ask if they want to move to QA now.

## Phase 5 — QA

Goal: confirm it actually works. `CLAUDE.md` is explicit that there's no
automated test suite here — `npm run compile` checks types/lint/bundle, not
behavior. Don't claim "tests pass"; a manual smoke test is required.

1. Set `status: in_qa`.
2. Give the user a concrete smoke-test checklist derived from `## Plan` /
   `## Implementation Log`: press F5, open the relevant sample from
   `samples/`, exercise the golden path and the edge cases this idea
   introduced, reload (`Cmd+R`) after any further edits.
3. Record what was tested and the outcome in `## QA`.
4. **If it fails:** fix and re-run QA if the bug is small; if it reveals a
   plan problem, bump `status` back to `planned` (or `implemented` for a
   smaller fix) and loop back to that phase. Note the bounce-back and why in
   the relevant section — don't erase the failed attempt.
5. **If it passes:** set `status: completed`, bump `updated`, and move the
   file to `.docs/ideas/completed/<slug>.md` (`git mv` if the repo tracks
   `.docs/ideas/`, otherwise a plain move). Confirm the new path to the user.

## Archiving

At any point before `completed`, the user may decide not to implement an
idea. Don't archive on your own inference — confirm they mean it. Once
confirmed:

1. Ask for a one-line reason (helps future-you understand why later).
2. Append an `**Archived:**` line with the reason and date to the end of
   whichever section was in progress.
3. Set `status: archived`, bump `updated`, move the file to
   `.docs/ideas/archive/<slug>.md`.

Archiving is terminal — don't offer to resume from a Plan invocation. If the
user later wants to revive it, that's a conscious action: move it back to
`.docs/ideas/` and reset `status` to wherever it realistically stands.

## Behavioral guidelines

- **One phase per turn.** Always stop and ask before advancing.
- **File first, chat second.** Re-derive state from the file's `status`, not
  from what you remember saying earlier in the conversation.
- **Never silently skip a phase.** If the user asks to jump straight to
  Implement on a `captured` idea, say so and ask if they really want to skip
  Brainstorm/Plan — going straight from a raw idea to code usually produces
  worse code.
- **Surgical edits only.** Never reprint or regenerate the whole idea file;
  edit the one section that changed.
