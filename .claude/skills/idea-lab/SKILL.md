---
name: idea-lab
description: Take an idea from a raw jot-down through brainstorming, an implementation plan, coding, and QA in five gated phases, tracked in a markdown file any agent can resume. Use when the user wants to capture a new idea, continue/resume an idea file, brainstorm improvements to an idea, plan or implement an idea against this codebase, or archive/complete an idea. Trigger on "/idea", "new idea", "jot down an idea", "let's brainstorm this", or when asked to continue something under .docs/ideas/.
---

# Idea Lab

Five-phase pipeline for turning a raw idea into shipped, QA'd code:
**Capture → Brainstorm → Plan → Implement → QA**.

Statuses are **next-action labels** — the `status` field names what to do when you
open the file, not what was already finished.

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

One folder per status — the folder an idea file sits in always matches its
frontmatter `status`. Active pipeline folders are prefixed `1-` through `5-`
so they sort in pipeline order in a file browser. Abandoned ideas live inside
`5-completed/archived/` (still `status: archived` in frontmatter):

```
.docs/ideas/1-to-brainstorm/        next: sharpen UX/product direction
.docs/ideas/2-to-plan/              next: write implementation plan
.docs/ideas/3-to-implement/         next: build the plan
.docs/ideas/4-to-qa/                next: smoke-test manually
.docs/ideas/5-completed/            terminal — QA passed
.docs/ideas/5-completed/archived/   terminal — abandoned, not being built
```

The number prefix is a display-order convenience only — it plays no role in
the `status` field, which stays a plain value (`to-brainstorm`, `to-plan`,
etc.). Folder name = `<N>-<status>`; strip the `<N>-` to get the status.

Files are named `.docs/ideas/<N>-<status>/<slug>.md` (or
`.docs/ideas/5-completed/archived/<slug>.md` for archived ideas), `<slug>` =
kebab-case of the title (e.g. `sticky-column-headers.md`). If a slug collides
within the target folder, append `-2`, `-3`, etc.

**Folder = status, always** — with one exception: `archived` files sit in
`5-completed/archived/`, not a top-level folder. Whenever a phase changes a
file's `status` field, in that same step `git mv` the file into the matching
`<N>-<status>` folder (plain `mv` if `.docs/ideas/` isn't tracked by git). The
frontmatter `status` is still the source of truth per the core principle above
— the folder is a derived index that must never drift out of sync with it,
since a future agent may list by folder without opening every file first.

## Idea file format

Scaffold new files from
[templates/idea-template.md](templates/idea-template.md). Frontmatter:

```yaml
status: to-brainstorm | to-plan | to-implement | to-qa | completed | archived
```

Get the real current date with `date +%F` (via Bash) when writing `created` /
`updated` — never hardcode or guess a date.

Body has five fixed sections in this order: `## Idea`, `## Brainstorm`,
`## Plan`, `## Implementation Log`, `## QA`. Each phase fills in its own
section via a surgical edit and leaves the others alone. Never delete or
truncate a completed section when writing a later one.

## Entry point — every invocation starts here

1. If the user names a specific idea or points at a file under
   `.docs/ideas/**`, read it and jump straight to the phase matching its
   `status`.
2. If the user is clearly describing a brand-new idea inline, skip to **Phase
   1** with that text.
3. Otherwise (bare invocation), list the files across every non-terminal
   folder (`1-to-brainstorm/`, `2-to-plan/`, `3-to-implement/`, `4-to-qa/` —
   skip `5-completed/` and `5-completed/archived/`) with their `title` and
   `status`, and ask which one to continue, or whether to capture something new.

Only one phase runs per invocation. **Stop after finishing a phase and ask
before continuing to the next one** — e.g. "Idea saved at
`.docs/ideas/1-to-brainstorm/foo.md`. Brainstorm it now, or later?" Don't barrel through
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
3. Copy `templates/idea-template.md` to `.docs/ideas/1-to-brainstorm/<slug>.md`,
   fill in `title`, `slug`, `created`, `updated` (today, via `date +%F`),
   `status: to-brainstorm`, and the `## Idea` section with the raw text.
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
   cases). **Present options in grouped form** (see **Brainstorm option
   layout**, below) — never as one long flat numbered list. Discuss with the
   user: which to keep, drop, or combine. Accept shorthand feedback
   ("A1, B1+B2, D1").
4. Write the finalized outcome into `## Brainstorm` as a product spec: the
   decided UX direction, why, and enough detail (states, defaults, placement,
   copy) that Phase 3 can design against it without re-asking product
   questions. Not the full list of rejected options. Set `status:
   to-plan`, bump `updated`, and `git mv` the file into `2-to-plan/`.
5. Ask if they want to move to Plan now.

### Brainstorm option layout

When presenting brainstorm options to the user, **group by decision type** so
it's obvious what is mutually exclusive vs what stacks. Use lettered groups
(`A`, `B`, `C`…) with numbered items inside each group (`A1`, `B2`, …).

Start with a short legend:

| Label | Meaning |
|---|---|
| **Pick one** | Mutually exclusive within the group — choose one option |
| **Combine** | Stacks with picks from other groups — not either/or |
| **Fixed** | Not optional — required outcome of the idea; no pick needed |

Then present groups in this order:

1. **Scope / where it applies** — pick one (e.g. Preview Edit only vs all modes).
2. **Primary approach** — pick one main strategy; note when sub-options
   combine (e.g. B1 + B2: base CSS rule + conditional application).
3. **Independent toggles** — each group is its own pick-one if relevant
   (e.g. whether a settings toggle affects this feature).
4. **Combine with your picks** — add-ons that layer on regardless (fade edge,
   polish).
5. **Fixed outcomes** — edge-case behaviors that follow from the goal, not
   choices.

End with a **suggested default** shorthand (e.g. `A1 + B1 + B2 + D1`) so the
user can accept quickly or reply with picks per group.

Do **not** write the grouped option list into `## Brainstorm` — only the
finalized product spec goes in the file.

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
   plan-mode transcript). Set `status: to-implement`, bump `updated`, and `git mv`
   the file into `3-to-implement/`.
5. Ask if they want to move to Implement now.

## Phase 4 — Implement

Goal: build exactly what's in `## Plan`, nothing more.

1. Read `## Plan`. Implement it. Follow this repo's engineering conventions
   (no speculative abstraction, no unrequested refactors, wire both sides of
   any message-protocol change).
2. Run `npm run compile` (type-check + lint + bundle) and fix anything it
   flags — this is the repo's baseline verification, per `CLAUDE.md`.
3. Append to `## Implementation Log`: files changed, and any deviation from
   the plan with why. Set `status: to-qa`, bump `updated`, and `git mv`
   the file into `4-to-qa/`.
4. Ask if they want to move to QA now.

## Phase 5 — QA

Goal: confirm it actually works. `CLAUDE.md` is explicit that there's no
automated test suite here — `npm run compile` checks types/lint/bundle, not
behavior. Don't claim "tests pass"; a manual smoke test is required.

1. Confirm the file is at `status: to-qa` in `4-to-qa/` (Implement should have
   placed it there; fix the folder/status if they drifted).
2. Give the user a concrete smoke-test checklist derived from `## Plan` /
   `## Implementation Log`: press F5, open the relevant sample from
   `samples/`, exercise the golden path and the edge cases this idea
   introduced, reload (`Cmd+R`) after any further edits.
3. Record what was tested and the outcome in `## QA`.
4. **If it fails:** fix and re-run QA in place if the bug is small (file
   stays in `4-to-qa/`); if it reveals a plan problem, bump `status` back to
   `to-plan` (or `to-implement` for a smaller fix), `git mv` the file into
   that matching folder (`2-to-plan/` or `3-to-implement/`), and loop back to
   that phase. Note the bounce-back and why in the relevant section — don't
   erase the failed attempt.
5. **If it passes:** set `status: completed`, bump `updated`, and `git mv`
   the file from `4-to-qa/<slug>.md` to `5-completed/<slug>.md` (plain `mv`
   if `.docs/ideas/` isn't tracked by git). Confirm the new path to the user.

## Archiving

At any point before `completed`, the user may decide not to implement an
idea. Don't archive on your own inference — confirm they mean it. Once
confirmed:

1. Ask for a one-line reason (helps future-you understand why later).
2. Append an `**Archived:**` line with the reason and date to the end of
   whichever section was in progress.
3. Set `status: archived`, bump `updated`, `git mv` the file from its
   current status folder to `5-completed/archived/<slug>.md`.

Archiving is terminal — don't offer to resume from a Plan invocation. If the
user later wants to revive it, that's a conscious action: `git mv` it from
`5-completed/archived/` into the status folder matching wherever it realistically
stands, and reset the frontmatter `status` field to match.

## Behavioral guidelines

- **One phase per turn.** Always stop and ask before advancing.
- **File first, chat second.** Re-derive state from the file's `status`, not
  from what you remember saying earlier in the conversation.
- **Never silently skip a phase.** If the user asks to jump straight to
  Implement on a `to-brainstorm` idea, say so and ask if they really want to skip
  Brainstorm/Plan — going straight from a raw idea to code usually produces
  worse code.
- **Surgical edits only.** Never reprint or regenerate the whole idea file;
  edit the one section that changed.
