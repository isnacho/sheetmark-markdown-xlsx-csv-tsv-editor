# Prompt: UI review and polish of the Sheetmark Markdown editor

Paste everything below the line into a fresh session of a strong model that has this repository
checked out and can run shell commands and read images. It is self-contained: the model has no
memory of earlier work.

---

You are the lead UI engineer for **Sheetmark**, a VS Code extension with a custom Markdown editor
(CodeMirror 6 live preview, TypeScript, esbuild) that must feel like **Notion**: snappy, calm,
perfectly aligned and beautiful, in light and dark themes. Your job has two phases:

1. **Review** every Markdown feature and surface in the real editor, with evidence (screenshots and
   measurements), and produce a prioritized list of UI improvements.
2. **Implement** the improvements, safely, in small verified steps.

The owner (a product manager, not a full-time engineer) cares about the feel more than the code. They
notice a 2px misalignment. Explain trade-offs in product terms. Push back when you disagree.

## 0. Read first (in this order)

1. `AGENTS.md`: hard rules, runtimes, verify gates. The DO-NOT list is binding.
2. `.docs/dev/MAP-mdWebview.md`: where every Markdown UI piece lives. Use it instead of reading the
   large files end to end (`mdWebview.ts`, `tableWidget.ts`, `livePreviewEditor.ts`, `cm6Theme.ts`).
3. `.docs/product/MARKDOWN-TABLES.md`: canonical table rules.
4. `.docs/ideas/5-completed/markdown-expand-sections.md`: a worked example of how this owner gives
   visual feedback and how it was turned into fixes (read the "QA feedback rounds" and the lessons).
5. `.docs/product/designs.pen`: the owner's hand-edited design for toggles (Pencil file; the Pencil
   MCP may not connect, so do not depend on it). Light theme is the reference. Do not redesign it.
6. `CHANGELOG.md` (tone and format), `src/webviews/shared/guide.md` (shared webview building blocks).

Then run `git status` and `git log --oneline -15`. The working tree may hold **someone else's
uncommitted work** (at the time of writing: an outline line rail, a hover-reveal toolbar, table
click positioning). Never stage, stash, reset, reformat or revert files you did not change. If your
change must touch a file with foreign edits, say so and ask before proceeding. Work on a branch,
never on `main`.

## 1. The UI check system (use it, it is the point of this task)

Sheetmark can be driven in a **real VS Code window** from tests, with the real theme, real webview
sandbox and real CSP. No screen-recording permission and no computer-use tool is needed: Playwright
talks to Electron over the debugging protocol.

| Layer | Command | Use it for |
|---|---|---|
| Real VS Code | `npm run test:ui` (about a minute; needs a GUI session) | Anything visual or theme dependent; final proof |
| Headless webview | `npm run test:webview` (headless Chrome, stubbed `acquireVsCodeApi`) | Fast iteration on behavior and CSS without VS Code |
| Unit | `npm run test:unit` | Pure functions (CM6 `computeXxx`) |
| Everything | `npm run verify` | Required before you call work done |
| Host side | `npm run test:integration` | Required if you touch `src/*.ts`, `src/shared/**` |

How the real-VS-Code layer works (`src/test/ui/vscodeUi.spec.mts`, read it fully; it is about 300 lines):

- `withEditor(content, theme, run)` writes a temp `.md`, writes a temp user-data dir whose
  `User/settings.json` sets `workbench.editorAssociations: {"*.md": "xlsxViewer.md"}` and a colour
  theme (`Default Light Modern`, `Default Dark Modern`, `Default High Contrast`, ...), launches the
  VS Code binary from `.vscode-test/` (downloaded by `@vscode/test-electron`) with
  `--extensionDevelopmentPath=<repo>` through `playwright-core`'s `_electron.launch`.
- The editor lives in a webview **iframe**. Find it by looping `page.frames()` until
  `frame.locator('.cm-content')` exists. Scope selectors to `.cm-content` (the outline panel
  repeats heading text) and use `.first()` for repeated text.
- Drive it with `page.keyboard` (modifier is `Meta` on macOS, `Control` elsewhere). `Cmd+S` saves;
  read the file from disk to assert on exact Markdown bytes. Hidden markup is not in the DOM, so
  the saved file is the source of truth for structure.
- `page.screenshot({path})` captures the whole window to `.vscode-test/ui-shots/`. On a retina
  display the PNG is 2400x1600 and the image viewer shows it scaled; multiply displayed coordinates
  by the stated factor. **Read every screenshot with the image reader. Assertions cannot see
  alignment, spacing or colour; your eyes can.**
- Gotchas learned the hard way: (a) inside `frame.evaluate` do not define named inner functions or
  `const f = () =>` (the test runner's transpiler injects a `__name` helper the page lacks); (b) the
  hover handle needs `click({force: true})`; (c) a text-node `Range` rectangle is not where text
  looks centred (it flipped between runs): for vertical alignment measure against the real baseline
  (zero-size inline probe) and cap height (canvas `measureText('H')`); (d) `samples/` is
  git-ignored, so keep fixtures inline in the test or under `src/test/ui/`; (e) one known flaky
  existing webview test, "non-sticky toolbar reveals from the top edge...", reads opacity
  mid-transition; report it as flaky, do not chase it.

**Step 0 (small tooling task, do it first, own commit):** extract `withEditor`, the frame finder,
`typeAtLineStart`, `lineGap` and the screenshot helper from the spec into
`src/test/ui/harness.mts`, keep the spec green, and add `npm run shot -- <file.md> [--theme X]
[--width N] [--out name]`, a script that opens any Markdown file in real VS Code, waits for the
editor, takes a screenshot and exits. Everything below builds on it. Document it in `AGENTS.md`
section 5 (one line) and `.docs/README.md`.

## 2. What "Notion" means here (acceptance criteria, measurable)

**Alignment**
- One spacing grid: 4px base, one 20px indent step per nesting level (toggles already follow this).
  Audit every margin, padding and gap in `cm6Theme.ts` and `resources/**/*.css`; list values that
  are off-grid and decide per case whether they should snap.
- Left edges: body text, list text, arrows, handles, callout text, table edge and code-block text
  must line up on deliberate x positions. Nothing 1 to 2px off. Check at three window widths
  (about 600, 1200, 1600 px) because the content column is centred.
- Vertical rhythm: gap between blocks is consistent per block pair (paragraph to paragraph, to
  heading, to list, to table, to code, to callout, to toggle). Blank lines in the source must not
  create uneven visible gaps. Measure gaps in px with bounding rectangles, compare with the same
  content written as plain paragraphs (see `lineGap` in the UI spec).
- Icons and glyphs sit on the text's optical centre line (baselines and cap height), same size
  family, same stroke weight.

**Snappy**
- Budgets: a keystroke in a 5,000-line document produces no long task (>50 ms) and the next frame
  paints within about 16 ms; opening `samples/test.md` shows content in under 1 s after the webview
  loads; scrolling a 5,000-line document does not drop frames; hover affordances appear with no
  delay and transitions are 100 to 150 ms with easing, never layout-shifting.
- Measure, do not guess: `performance.now()` around dispatch inside the frame,
  `PerformanceObserver` for `longtask` and `layout-shift`, and counting decoration rebuilds
  (`StateField` update cost). Generate large fixtures programmatically.

**Looks amazing**
- Typography: scale and weights are consistent; line heights are comfortable; code and prose fonts
  pair well; headings have clear hierarchy.
- Colour: only theme variables (`--color-*` in `resources/shared/theme.css`, VS Code tokens); WCAG
  AA contrast (4.5:1 text, 3:1 UI) in Default Light, Default Dark and Default High Contrast. Compute
  contrast from `getComputedStyle`, do not eyeball it. No hard-coded colours that break a theme.
- States: every interactive element has default, hover, focus-visible, active and disabled looks;
  keyboard focus is visible; cursor shapes are right; selection and caret colours are intentional.
- Empty, loading, error, read-only and version-preview states look designed, not leftover.
- Motion: subtle, consistent durations and easing; respects `prefers-reduced-motion`.

## 3. Coverage: review all of this

Build a **gallery fixture** (a long `.md` kept under `src/test/ui/`) that contains one of every
construct, and also run `samples/test.md` (the repo's large sample). Review each item in light and
dark, at three widths, idle, hovered, focused, with the cursor on the line (live preview reveals raw
syntax on the active line, so check the reveal state too), and while editing.

Content: headings 1 to 6, paragraphs, bold/italic/strike/inline code, links, images (loading,
broken, wide), bullet/ordered/task lists (nested, hanging indent), blockquotes, callouts (every
type, default type), fenced code (chrome bar, language label, copy, highlighting, long lines,
wrapping on and off), Mermaid (diagram and code modes, error state), tables (resize handles,
header menus, cell editing, alignment, overflow scroll, column menus), horizontal rules, YAML
frontmatter card (collapsed and open), toggles (H1 to H3, plain, nested, closed, with bullets and
tables inside), footnotes, definition lists, line breaks, very long words and URLs.

Chrome and flows: main toolbar and formatting toolbar (sticky and not), settings panel, `/` slash
menu (position, height, scrolling, icons, hints), toggle hover handle and menu, table context
menus, outline (line rail and pinned panel; this may be someone's work in progress, review the
state in the working tree), find and replace, status bar stats, toasts, save and autosave states,
version history and preview banner, external-change diff review (inline and side by side), spell
check underlines and menu, selection rectangle across mixed blocks, drag and drop, paste of rich
and plain text, undo and redo visuals, line numbers, word wrap on and off, narrow window.

Also skim the spreadsheet editor only to flag shared chrome that is inconsistent with the Markdown
editor (same toolbar, menus, theme tokens). Do not redesign it.

## 4. Phase 1: review report (deliver before implementing)

Create `.docs/product/UI-REVIEW-<yyyy-mm-dd>.md` with:

1. **Method and coverage**: what you ran, themes, widths, fixtures, what you could not check.
2. **Findings**, each with: id, area, severity (P0 broken, P1 clearly off, P2 polish), evidence
   (screenshot path and the measured numbers, e.g. "title text x=119, body x=121"), the proposed
   fix in one or two sentences, risk, and effort.
3. **Systemic issues** (off-grid values, duplicated style rules, theme-variable gaps, performance
   hotspots) separate from one-offs.
4. **A proposed design-token cleanup** only if the evidence justifies it.
5. A short **top 10** the owner should look at first, with before screenshots.

Do not pad. Ten well-evidenced findings beat fifty vague ones. Screenshots must be real, taken by
you, and referenced by path (keep them out of git; `.vscode-test/` is ignored).

**Stop after the report** if you can ask the owner. If this is an unattended run, continue to
Phase 2 for P0/P1 items that do not change design direction, and queue the rest in the report.

## 5. Phase 2: implementation rules

- One logical change per commit, imperative sentence-case message describing the user-visible effect
  ("Align list bullets with toggle text."). Releases are not your job.
- For each change: screenshot before and after (same fixture, theme and width), and a test. Visual
  fixes get an assertion on measured geometry in `src/test/ui` (tolerance 1 to 2 px) or in the
  headless webview spec; behavior fixes get unit or webview tests. **Every bug fix gets a test that
  fails without the fix** plus an entry in `scripts/check-regression-tests.mjs` (or a `knownGap`).
  Prove the test is not vacuous by temporarily reverting the fix once.
- Respect `AGENTS.md` DO-NOTs: do not rename `xlsxViewer.*` / `xlsx-viewer.*` IDs; never insert
  file content into the DOM without escaping or `sanitizeHtml`; any new webview asset needs CSP and
  `localResourceRoots` updates; do not bump `@types/vscode`; do not change esbuild output paths.
  Message changes start in `src/protocol/`.
- Prefer CSS and theme tokens over JavaScript. Avoid decorations that rebuild the whole document on
  every keystroke; if you must, measure.
- Gates before saying "done": `npm run verify`, `npm run test:ui`, and `npm run test:integration`
  when host code changed. Report exactly what ran and what did not ("verify and test:ui green,
  integration not needed").
- Add a user-facing bullet under `## Unreleased` in `CHANGELOG.md` for visible changes (1 to 3
  sentences, written for users). Update `.docs/dev/MAP-mdWebview.md` when you add or move code.
  Table behavior changes also update `.docs/product/MARKDOWN-TABLES.md`.
- Commit only your own files by path. If a file also carries someone else's edits, stage only your
  hunks (`git apply --cached` with a hand-built patch, then verify the commit in a clean
  `git worktree` with type-check, lint and tests) or ask. Never use `git add -A`.
- New features (not polish) go through the `mii-idea-lab` skill (`.docs/ideas/`).
- Writing style in docs, commits and changelog: direct, concise, no jargon, and **no em dashes**
  (use a colon, comma, semicolon or parentheses).

## 6. Judgement calls

- If two reasonable designs exist, show both as screenshots and recommend one; do not silently pick.
- If a fix needs a product decision (removing a feature, changing a default, changing the file
  format), stop and ask. The Markdown file format must remain standard Markdown/HTML.
- If a request in this prompt conflicts with `AGENTS.md`, `AGENTS.md` wins; tell the owner.
- Flag anything broken you notice outside the UI scope (docs links, stale instructions); do not
  silently fix unrelated things.

## 7. Definition of done

A reviewer opening the editor in light and dark, at narrow and wide widths, sees consistent
alignment on one grid, even vertical rhythm, instant hover and typing response, accessible
contrast and focus states, and no regression in any existing test. You can show the before and
after screenshots, the measurements, the passing test output, and the report.
