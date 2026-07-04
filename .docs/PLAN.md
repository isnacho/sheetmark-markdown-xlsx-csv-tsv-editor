# vscode-super-viewer — Development & Publishing Plan

> Working plan for taking this project from "downloaded fork" to "my own
> published, actively-developed VS Code extension."
> Last updated: 2026-07-03

---

## 1. What this project is

A fork of the open-source extension **`xlsx-viewer`** by Muhammad Ahmad
([upstream repo](https://github.com/Mahmadabid/XLSX-CSV-TSV-MARKDOWN-Editor-Vscode-Extension)),
imported at version **1.9.91**. Folder renamed to `vscode-super-viewer`.

- ~20k lines of TypeScript.
- **Two custom editors**:
  - **Spreadsheet** — one shared webview for `.xlsx` / `.csv` / `.tsv`
    (`src/webviews/spreadsheet/`, provider `src/spreadsheetEditorProvider.ts`).
  - **Markdown** — split-view preview/editor for `.md`
    (`src/webviews/md/`, provider `src/mdEditorProvider.ts`).
- Entry point: `src/extension.ts` — registers 4 custom-editor providers +
  commands (`convertFile`, `goBackTo*`, association toggles).
- Build: **esbuild** (`esbuild.js`) bundles the extension (node target) and the
  two webviews (browser target) into `dist/`. TypeScript strict, ESLint 9.

### License / attribution (non-negotiable)
Upstream is **MIT © 2024 Muhammad Ahmad**. MIT permits rebranding and
republishing **only if** the original copyright + license text are retained.
- `LICENSE` keeps his copyright — do **not** remove it.
- Add a fork-attribution note to `README.md`.

---

## 2. Decisions made

| Decision | Choice |
|----------|--------|
| End goal | **Publish my own version** to the VS Code Marketplace |
| Git strategy | **Standalone** history; original kept as a fetch-only `upstream` remote |
| Internal IDs (`xlsxViewer.*`, `xlsx-viewer.*`) | **Keep for now** — users never see them; renaming touches many files. Revisit later. |

---

## 3. Phase 0 — Dev environment  ✅ DONE

- [x] `npm install` — dependencies installed.
- [x] Build verified: `npm run compile` → 0 type errors, 0 lint errors, 5 lint
      warnings (pre-existing `curly` style), `dist/` bundles produced.
- [x] `.gitignore` (excludes `node_modules/`, `dist/`, `out/`, `*.vsix`, etc.).
- [x] `.vscode/launch.json` — "Run Extension" config (Extension Development Host).
- [x] `.vscode/tasks.json` — watch build (`watch:esbuild` + `watch:tsc`).
- [x] `.vscode/extensions.json` — recommends `esbuild-problem-matchers` + `eslint`.
- [x] `git init` + baseline commit `5ab50af` (pristine upstream + scaffolding).
- [x] `upstream` remote added, **push disabled** (`git fetch upstream` to sync).

### The core dev loop (how to work day-to-day)
1. Open this folder in VS Code.
2. Press **F5** → launches Extension Development Host with a live watch build.
   (Accept the prompt to install `connor4312.esbuild-problem-matchers`.)
3. Edit any `.ts` → reload the host window (`Cmd+R`) → change is live.
4. `git fetch upstream` occasionally to review upstream changes.

---

## 4. Phase 1 — Rebrand  ⏳ NEXT (blocked on inputs)

**Blocking inputs needed:**
- **Marketplace publisher ID** — created at
  <https://marketplace.visualstudio.com/manage> (needs an Azure DevOps org +
  a Personal Access Token, scope *Marketplace → Manage*). Required only to
  *publish*, not to build/test. The `package.json` `publisher` field must match
  it exactly.
- Final `name`, `displayName`, `version`, `repository.url`, icon choice.

**`package.json` fields to change** (defaults proposed):

| Field | Current | Proposed |
|-------|---------|----------|
| `publisher` | `muhammad-ahmad` | _your publisher ID_ |
| `name` | `xlsx-viewer` | `super-viewer` |
| `displayName` | `XLSX, CSV, TSV & Markdown Editor` | _TBD_ |
| `version` | `1.9.91` | `1.0.0` (reset to signal new lineage) |
| `repository.url` | upstream | _your repo, or blank for now_ |
| `icon` | `icon.png` (his) | keep for now, swap later |

**Also in this phase:**
- [ ] Add `@vscode/vsce` as a devDependency (for packaging).
- [ ] Add a fork-attribution note to `README.md`.
- [ ] Keep upstream copyright in `LICENSE`; optionally add a `NOTICE`.
- [ ] Commit as #2 (clean rebrand diff on top of the baseline).

---

## 5. Phase 2 — First local package & sideload

- [ ] `npm run package` (production build) then `npx vsce package` → `.vsix`.
- [ ] Install the `.vsix` in real VS Code (`Extensions: Install from VSIX…`).
- [ ] Smoke-test all four editors (xlsx, csv, tsv, md) on sample files.

## 6. Phase 3 — Publish (when ready)

- [ ] `npx vsce login <publisher>` with the PAT.
- [ ] `npx vsce publish` (or publish the `.vsix` via the marketplace UI).
- [ ] Verify listing, icon, README render on the marketplace.

---

## 7. Phase 4 — Feature work (the point of all this)

_Backlog — fill in as ideas land. Candidates:_
- [ ] _(your first feature / change goes here)_

### Where to make changes (map)
| Want to change… | Look in… |
|-----------------|----------|
| Spreadsheet grid UI / behavior | `src/webviews/spreadsheet/` (+ `components/`) |
| Spreadsheet save / file I/O | `src/spreadsheetEditorProvider.ts` |
| Markdown preview / editor | `src/webviews/md/mdWebview.ts`, `src/mdEditorProvider.ts` |
| File conversion (csv↔tsv↔xlsx) | `src/shared/fileConversionService.ts` |
| Commands / activation / providers | `src/extension.ts` |
| Settings (marketplace-visible) | `contributes.configuration` in `package.json` |
| Styling | `resources/**/*.css` |

---

## 8. Known gaps / tech debt

- **No tests.** `package.json` references `vscode-test` + `mocha`, but there are
  no test files and no `.vscode-test` config. `npm test` is currently dead.
  Add a `test/` suite if development gets serious.
- **5 ESLint `curly` warnings** in `versionHistory.ts` and
  `spreadsheetUtilities.ts` — auto-fixable with `eslint --fix`.
- Two very large files (`spreadsheetWebview.ts` ~7.7k lines,
  `mdWebview.ts` ~3.7k) — expect slow navigation; consider splitting if touched heavily.

---

## 9. Quick command reference

```bash
npm install            # deps (done)
npm run compile        # type-check + lint + build once
npm run watch          # watch build (F5 uses this automatically)
npm run package        # production build (pre-publish)
npx vsce package       # produce a .vsix (after adding @vscode/vsce)
git fetch upstream     # pull in original author's latest (review, then merge/cherry-pick)
```
