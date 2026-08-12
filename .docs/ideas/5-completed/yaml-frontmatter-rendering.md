---
title: YAML frontmatter rendering
slug: yaml-frontmatter-rendering
status: completed
created: 2026-07-20
updated: 2026-08-12
---

# YAML frontmatter rendering

## Idea

We use a lot of YAML in our repo, and I want the YAML to be able to be visualized properly within the markdown document at the very top of the document (something like Obsidian), where it's a little bit more formatted and looking a bit nicer than if it is just markdown. Essentially, it's like creating a specific rendering formatting for YAML.

## Brainstorm

Today a leading `---key: value---` block isn't parsed as frontmatter at all —
markdown-it's `hr` rule fires on the `---` lines and each `key: value` line
renders as a plain paragraph in between. No frontmatter plugin/parser exists
in the codebase yet (confirmed by grep — only a transitive `js-yaml` dep, no
direct one).

**Decided UX direction:**

- **Component:** a collapsible card ("YAML" panel) replaces the raw
  hr+paragraph rendering wherever a frontmatter block sits at the literal
  start of the document. Mid-document `---` blocks are untouched — this only
  fires on a doc-start block.
- **Surfaces:** renders in both Preview (read-only) and Preview Edit (CM6
  live editor) modes. Split mode inherits whichever pane it's showing.
- **Default state:** starts expanded on first view of a file. The
  expanded/collapsed toggle is then remembered per file, so re-opening a file
  the user previously collapsed keeps it collapsed. (Plan needs to pick where
  this persists — webview `setState` alone won't survive a full editor close;
  likely needs the same per-file extension-storage pattern as
  `StyleStorageService`.)
- **Field rendering:** type-aware, not dumb key/value text dump. Arrays
  render as a comma/chip-style list (e.g. `tags: idea, ux`), dates/booleans/
  plain strings render as-is. Deeply nested objects/arrays render as indented
  sub-rows — exact depth handling is a Plan-phase detail.
- **Editability:** in Preview Edit, the card's fields are directly editable
  (Obsidian-properties style) and edits write back into the underlying YAML
  block in the document text. Preview (non-edit) stays read-only.
  **Flagged risk for Plan:** Preview Edit is CM6-based — making a rendered
  widget bidirectionally sync with the CodeMirror document is real technical
  complexity (widget decoration + doc transaction on edit), not a small
  wiring job. Plan should scope this explicitly and consider a fallback (e.g.
  click-to-edit reveals the raw YAML text inline) if the full inline-edit
  version is too costly for v1.
- **Header/copy:** panel label reads "YAML".
- **Edge cases:**
  - Invalid/malformed YAML → fall back to today's raw rendering (hr +
    paragraphs), never crash the preview.
  - Empty frontmatter (`---` immediately followed by `---`) → hide the card
    entirely rather than showing an empty box.
  - No frontmatter present → no change in rendering at all.

**Deferred to a Plan-phase decision, not blocking:** which YAML parser to add
as a direct dependency (nothing suitable is currently installed — the only
`js-yaml` in the tree is transitive) and how the frontmatter block is
detected/extracted before being handed to markdown-it.

## Plan

**v1 editability decision:** read-only card in both Preview and Preview Edit;
clicking a field (or header) in Preview Edit jumps the CM6 cursor to the
matching raw YAML source line. Reveal engine shows raw `---` / `key: value`
for editing. Scalar inline edit deferred to v2.

**Parser:** `js-yaml` (direct dep). **Detection:** pre-process raw string at
doc start only (optional BOM, `---` … `---`). **Persistence:**
`FrontmatterPanelStorageService` in `workspaceState`, mirroring
`TableColumnWidthStorageService`.

### A — Shared foundation
1. Add `js-yaml` + `@types/js-yaml` to `package.json`; `npm install`.
2. **New** `src/webviews/md/frontmatter.ts` — `extractFrontmatter`,
   `parseFrontmatter`, `isEmptyFrontmatter`, `renderFrontmatterCard`,
   `renderFieldRows` (scalars as-is, arrays as chips, nested objects as
   indented sub-rows).
3. **New** `src/webviews/md/frontmatter.test.mts` — valid/empty/invalid/absent
   frontmatter, mid-doc `---`, BOM, nested/array fields.

### B — Collapse persistence (host ⇄ webview)
4. **New** `src/shared/frontmatterPanelStorageService.ts` — key
   `xlsxViewer.frontmatterPanel.<lowerFsPath>`, `getCollapsed` (default
   `false`), `saveCollapsed`.
5. `src/mdEditorProvider.ts` — construct service; extend
   `buildInitMarkdownPayload` with `frontmatterPanelCollapsed`; handler
   `saveFrontmatterPanelCollapsed`.
6. `src/webviews/md/mdWebview.ts` — seed state from `initMarkdown`; post
   message on toggle. Update `.docs/MESSAGE-PROTOCOL.md` (both sides).

### C — Preview mode
7. `renderMarkdown()` in `mdWebview.ts` — extract → inject card HTML → parse
   body only. Strip frontmatter before `buildToc` / `refreshCm6Toc` too.
8. Collapse toggle on card header — toggle DOM class + persist (no dirty flag).
9. `resources/md/mdWebview.css` — `.yaml-frontmatter-card` and field/chip/nested
   styles (reuse `--panel-bg`, `--border-color`, `--header-bg`).

### D — Preview Edit (CM6)
10. **New** `src/webviews/md/livePreview/frontmatterWidget.ts` —
    `FrontmatterWidget`, `frontmatterField` StateField (block
    `Decoration.replace` over entire frontmatter range), `updateDOM` for
    collapse stability. Register in `livePreviewEditor.ts` outside
    `revealCompartment`.
11. Frontmatter replace must cover both `---` delimiters + body so
    `revealDecorations` `handleHorizontalRule` never fires on them.
12. Field click → `view.dispatch` selection to corresponding source line.
13. `src/webviews/md/livePreview/cm6Theme.ts` — `.cm-md-frontmatter-widget`.

## Implementation Log

**2026-07-21** — Implemented per plan (v1 click-to-jump editability).

Files added:
- `src/webviews/md/frontmatter.ts`, `frontmatter.test.mts`
- `src/shared/frontmatterPanelStorageService.ts`
- `src/webviews/md/livePreview/frontmatterWidget.ts`

Files changed:
- `package.json` / `package-lock.json` — `js-yaml`, `@types/js-yaml`; widened
  `test:unit` glob to `src/webviews/md/**/*.test.mts`
- `src/mdEditorProvider.ts` — storage service + `saveFrontmatterPanelCollapsed`
- `src/webviews/md/mdWebview.ts` — preview card render, collapse persist, CM6
  mount options
- `src/webviews/md/livePreview/livePreviewEditor.ts` — register widget field
- `resources/md/mdWebview.css`, `cm6Theme.ts` — card styles
- `.docs/MESSAGE-PROTOCOL.md`

Verification: `npm run test:unit` (182 pass) + `npm run compile` (0 errors).

No deviations from plan. Empty `---\n---` detection required a regex tweak
(optional yaml body group) beyond the original sketch.

## QA

`npm run compile` clean; `frontmatter.test.mts` (11 tests) pass. Manual smoke: YAML card renders at doc start in Preview Edit; collapse persists per file; click field jumps cursor to raw YAML line; invalid/malformed YAML falls back to plain rendering. Marked **completed** (2026-08-12).
