# Architecture review request: is CodeMirror 6 the right foundation for a Notion/Obsidian-grade WYSIWYG markdown experience?

## Ask

Independently evaluate the architecture choice for this project's Markdown "Preview
Edit" mode. Goal stated by the project owner: **the best possible WYSIWYG markdown
editing experience, no compromise, comparable to Notion or Obsidian.** Do not treat
the work already done (below) as a constraint you must preserve — if a different
foundation genuinely serves that goal better, say so, including "rewrite the
CM6 work" if that's the honest answer. Sunk cost is disclosed below so you can weigh
it, not so you protect it.

## What this project is

A VS Code extension (fork of `xlsx-viewer` v1.9.91, ~20k lines TypeScript) providing
custom editors for spreadsheets (`.xlsx`/`.csv`/`.tsv`) and Markdown (`.md`). Full
architecture: [.docs/ARCHITECTURE.md](ARCHITECTURE.md). The Markdown editor has three
modes: **Split** (raw textarea + rendered preview side by side), **Reading** (static
markdown-it render), and **Preview Edit** — the one in question, meant to be a
live, WYSIWYG-ish editing surface where you type near-plain markdown and see it
rendered in place (headings sized, bold bolded, tables as grids, etc.), à la Obsidian
Live Preview or Notion.

Hard structural constraint that will not change regardless of architecture chosen:
this is a **VS Code webview**. Two runtimes — Node.js extension host and a sandboxed
browser webview — talking only via `postMessage`. The webview has no `fs`, no
`require`, no arbitrary network access; assets must be enumerated in a CSP and
`localResourceRoots`. Full rules: root [CLAUDE.md](../CLAUDE.md). Any proposed engine
must run as a bundled, CSP-compliant, offline, browser-sandboxed JS bundle — same
constraints Obsidian's own Electron-based live preview does NOT have (Obsidian is not
sandboxed the same way; that matters for what's actually portable from its approach).

## Current state (what exists today, and why)

Preview Edit mode was originally built on `contentEditable` + `markdown-it` HTML
rendering, converting back to markdown via `turndown` on save. That architecture
could not support "show raw syntax near the cursor, hide it elsewhere" — the DOM had
already discarded the raw markdown, so there was no source of truth to reveal.

Decision made ~7 phases ago (documented in
[.docs/PLAN-obsidian-live-preview.md](PLAN-obsidian-live-preview.md)): rebuild Preview
Edit mode on **CodeMirror 6** — explicitly because this is the same engine class
Obsidian's own Live Preview uses. Raw markdown text stays the single source of truth
in a CM6 `EditorState`; a decoration layer (`ViewPlugin`/`StateField` over the
`@lezer/markdown` syntax tree) hides/reveals syntax markers based on cursor position,
and inline `Decoration.mark`/`Decoration.replace` handle styling. This removed the
turndown round-trip entirely for this mode.

Built so far (all in `src/webviews/md/livePreview/`):
- Reveal-on-cursor for: headings (H1-H6), bold, italic, strikethrough, inline code,
  links, blockquotes, list markers, task checkboxes.
- 18 formatting commands (bold/italic/heading/etc. toolbar+keyboard actions) ported
  from the old textarea-mutation model to CM6 transactions.
- A slash-menu (`/heading`, `/table`, `/callout`, etc.) via `@codemirror/autocomplete`.
- Tables render as an actual HTML `<table>` widget (via a `StateField`-provided block
  `Decoration.replace`, reusing `markdown-it` to render the table's own source text)
  when the cursor is away from the table; when the cursor enters the table's line
  range, the **entire table** reverts to raw markdown pipes for editing.
- A settings kill-switch (`xlsxViewer.md.livePreviewEngine: "cm6"|"legacy"`) that can
  fall back to the old contentEditable path — not yet removed.
- 79 headless unit tests (`node --test`, no DOM) covering the decoration logic in
  isolation.

Test infrastructure gap, disclosed because it's directly relevant to evaluating
"how much can we trust what's built": this project's only test runner is headless
(`node --test` against a bare `EditorState`, deliberately never constructing a real
`EditorView`/DOM — see Phase 3 of the plan doc). **Every real bug found in this
feature so far was found by a human manually pressing F5 and using it**, not by
tests or review:
1. Typing a new empty heading (`#`) threw inside a `ViewPlugin` on a zero-length
   `Decoration.mark` range, which silently dropped decorations for *every* heading in
   the document (a throwing ViewPlugin drops all its own decorations, not just the
   offending node's).
2. The dimmed "#" marker rendered at the wrong (smaller) font size next to the
   heading text.
3. Headings were underlined — a leftover generic `syntaxHighlighting(defaultHighlightStyle)`
   rule fighting the project's own heading styling.
4. Inserting a table via the slash menu or toolbar froze the editor entirely —
   `RangeError: Block decorations may not be specified via plugins`. CM6 disallows
   block-level `Decoration.replace`/`Decoration.widget` from a `ViewPlugin`'s
   decorations facet; only a `StateField` may provide them. This one required
   temporarily installing `jsdom` to get a real `EditorView` and an actual stack
   trace — it was not diagnosable from code reading alone.
5. **Current open issue, the reason for this review**: table reveal is
   node-scoped, not cell/row-scoped. Any click *anywhere* inside a table collapses
   the *entire* rendered grid back to raw pipe-and-dash markdown, then re-renders it
   only once the cursor leaves the whole table. For a multi-row table this is a much
   more jarring, disruptive transition than the same reveal pattern applied to an
   inline mark like `**bold**` or `# heading` — the user described it as feeling
   broken/low-quality, not just visually imperfect.

## The real question

Issue 5 is fixable within CM6 (row- or cell-scoped reveal instead of whole-table
reveal — same idiom already used for inline marks, just narrower scope). That is a
bounded, moderate-complexity fix.

But the project owner's bar is explicitly **"no compromise, comparable to Notion or
Obsidian"** — not "acceptable, no worse than before." That's a higher bar than "make
the table bug go away." Worth asking honestly:

- Does CM6 + hand-rolled decorations actually top out below Notion/Obsidian quality
  for markdown WYSIWYG, or is issue 5 just an incomplete implementation of a pattern
  that scales fine (Obsidian's own tables *do* work this way — click a cell, that
  row/cell edits, rest of table stays rendered)?
- Real alternatives already surfaced and briefly discussed with the project owner
  (not deeply evaluated):
  - **Milkdown** (ProseMirror + remark): WYSIWYG-first, ProseMirror schema mapped to
    markdown AST, serializes back to markdown, table editing plugin exists
    out of the box. Bigger bundle, different bug class (ProseMirror schema↔markdown
    round-trip fidelity, cell/cursor navigation edge cases) rather than fewer bugs.
    Would mean discarding the CM6 work above.
  - **marktext/muya**: contentEditable-based rich markdown editor — same
    architectural family as the *original* implementation this project already
    replaced specifically because contentEditable throws away the raw-markdown
    source of truth needed for reveal-on-cursor. Already considered and set aside for
    that reason.
  - **Stay on CM6**, invest further in scoping reveal decorations more precisely
    (row/cell-level for tables; anything else that surfaces the same "whole-block
    flips" problem) — the path consistent with "same engine class as Obsidian."
- Bundle size, CSP/asset constraints, and the two-runtime message-protocol
  discipline (see CLAUDE.md rule 2 — every host↔webview message must be wired on
  both ends by hand, untyped string matching, no compiler check) apply to *any*
  engine choice, not just CM6. Factor that into how expensive a framework swap
  really is here versus in a plain web app.
- There is **no automated GUI/visual test coverage** for whichever engine is chosen,
  and per (5) above, several serious bugs so far were only catchable by constructing
  a real `EditorView`/DOM (or equivalent) and interacting with it — that gap should
  factor into any recommendation, e.g. flagging what test investment a given
  architecture would need to actually hit "Notion/Obsidian-grade" reliability, not
  just visual parity.

## Deliverable requested

A recommendation: continue deepening the CM6 approach, or switch foundations —
with the concrete reasoning, not just a preference. If continuing CM6, name the
specific gaps (table scope is one; audit for others — list rendering, blockquote
multi-line editing, nested lists, etc.) and the test-infrastructure investment
needed to catch this bug class before users do. If switching, name the real
migration cost (what in `src/webviews/md/livePreview/` is reusable — the pure
`compute*` functions and the message-protocol/state-sync contract in
[.docs/PLAN-obsidian-live-preview.md](PLAN-obsidian-live-preview.md) almost certainly
carry over regardless of rendering engine — versus what must be rebuilt from
scratch) and the honest new bug surface it introduces.
