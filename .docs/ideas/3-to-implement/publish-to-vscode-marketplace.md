---
title: Publish extension to VS Code Marketplace
slug: publish-to-vscode-marketplace
status: to-implement
created: 2026-08-12
updated: 2026-08-14
---

# Publish extension to VS Code Marketplace

## Idea

Publish this extension to the VS Code Marketplace. Remove all references to
the previous library and previous creator (check first that this is legal),
and replace attribution with the current user. Need to come up with a new
name, an icon, and anything else required for marketplace submission.

## Brainstorm

**Legal check (done):** repo is MIT-licensed, `Copyright (c) 2024 Muhammad Ahmad`.
MIT is permissive — rebranding, renaming, and republishing is legal. The one
hard constraint: the original copyright notice must stay in the `LICENSE`
file's text (can't be deleted), though a second line can be added for the
fork's own copyright. No other legal blocker found.

**Previous-creator surfaces found in the code** (beyond just text/branding):
1. A whole **"Other Open Source Projects" modal**
   ([projectsModal.ts](../../../src/webviews/shared/projectsModal.ts)) that
   advertises the old author's unrelated repos (`openpart`, `vibed-puppet`)
   inside the product UI — unrelated to this extension, should be deleted
   entirely (component + wherever it's triggered).
2. The **feedback form silently POSTs to the old author's private Google
   Form** (`docs.google.com/forms/.../formResponse` in
   [mdEditorProvider.ts](../../../src/mdEditorProvider.ts) and
   [spreadsheetEditorProvider.ts](../../../src/spreadsheetEditorProvider.ts))
   — a real privacy issue, not just branding.
3. `package.json` `repository.url`, README install command/badges/links, and
   the Marketplace/Open VSX links all still point at the old repo
   (`Mahmadabid/...`) and old Marketplace id (`muhammad-ahmad.xlsx-viewer`).
4. The feedback GitHub-issue button URL also points at the old repo.

**Decisions:**

- **Repo:** `github.com/nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor`. Update
  `package.json` `repository`/`bugs`/`homepage`, README links/badges/install
  command, and the feedback modal's GitHub-issue URL to point here.
- **Publisher:** `nacho-allendesalazar` (already set in `package.json`).
  Marketplace publisher account still needs to be registered — auth via
  **Microsoft Entra ID** (`vsce publish --azure-credential`), not a global PAT
  (global PATs retired Dec 1, 2026).
- **Package id (`package.json` "name"):** `sheetmark` → extension ID
  `nacho-allendesalazar.sheetmark`.
- **Marketplace displayName:** `Sheetmark: XLSX, CSV, TSV & Markdown` — short brand
  **Sheetmark** up front for identity, plus the full format list after the colon so
  Marketplace search still surfaces it for "xlsx", "csv", "tsv", "markdown" queries.
- **License:** keep the existing MIT `LICENSE` file and its
  `Copyright (c) 2024 Muhammad Ahmad` line as-is (legally required). Add a
  second line below it: `Copyright (c) 2026 Nacho Allendesalazar Rivas` for
  the fork's own changes.
- **Old-creator UI/telemetry removal:**
  - Delete the "Other Open Source Projects" modal and its call sites.
  - Feedback form: swap the Google Form endpoint from the old author's form
    to one the user owns.
  - Repoint every remaining old-repo/old-Marketplace-id reference (§ above).
- **Versioning:** reset to `1.0.0` for this republish — signals a genuinely
  new, independently-published extension rather than a continuation of the
  old listing.
- **Icon:** deferred — ship existing `icon.png` as placeholder for v1.0.0.

## Plan

Target extension ID: **`nacho-allendesalazar.sheetmark`**

### Checklist

#### Already done

- [x] Google Form wired to user's form (`own-feedback-google-form` — completed)
- [x] Feedback GitHub-issue URL → `nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor`
- [x] `LICENSE` — second copyright line for Nacho Allendesalazar Rivas (2026)
- [x] `publisher` in `package.json` → `nacho-allendesalazar`
- [x] Extension self-lookup → `nacho-allendesalazar.sheetmark` (`mdEditorProvider.ts`, `spreadsheetEditorProvider.ts`)
- [x] Projects modal removed from `src/` (no `projectsModal` references remain)

#### A — Publisher account (manual, blocking publish)

- [ ] Create [Marketplace publisher](https://marketplace.visualstudio.com/manage/createpublisher) with ID `nacho-allendesalazar` (same Microsoft account you'll use to publish)
- [ ] **Entra ID (recommended):** install [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli), then:
  ```bash
  az login
  npx @vscode/vsce publish --no-dependencies --azure-credential
  ```
  See [VS Code publishing docs — secure automated publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#_secure-automated-publishing-to-visual-studio-marketplace).
- [ ] **Legacy fallback (until Dec 1, 2026):** org-scoped PAT with **Marketplace → Manage** only — **not** a global PAT (`All accessible organizations`). `npx @vscode/vsce login nacho-allendesalazar` then `npx @vscode/vsce publish --no-dependencies`.

#### B — `package.json` metadata

File: [package.json](../../../package.json)

- [x] `displayName` → `Sheetmark: XLSX, CSV, TSV & Markdown`
- [x] `version` → `1.0.0`
- [x] `repository.url` → `https://github.com/nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor`
- [x] Add `bugs.url` → `https://github.com/nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor/issues`
- [x] Add `homepage` → `https://github.com/nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor`
- [x] Review `description` — mention "Sheetmark" brand if desired (optional polish)
- [x] Review `keywords` — add `markdown` if missing; keep format-search terms
- [x] Confirm `categories` (`Other` is fine for v1.0.0)
- [x] **Do not rename** `xlsxViewer.*` viewTypes or `xlsx-viewer.*` command IDs (load-bearing per CLAUDE.md)

#### C — README (Marketplace landing page)

File: [README.md](../../../README.md)

- [x] Update H1/title to match new `displayName` (or close variant)
- [x] Install command → `code --install-extension nacho-allendesalazar.sheetmark`
- [x] Marketplace search hint → new display name
- [x] GitHub links → `nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor`
- [x] Marketplace link → `itemName=nacho-allendesalazar.sheetmark` (placeholder URL until live)
- [x] Open VSX link → update or remove until published there
- [x] Add short attribution note: fork of upstream MIT project; original copyright retained in LICENSE

#### D — Changelog

File: [CHANGELOG.md](../../../CHANGELOG.md)

- [x] Prepend `## v1.0.0` entry (do not rewrite history below):

#### E — Internal docs (non-blocking, same PR ok)

- [x] [.docs/product/LOCAL-DEV-INSTALL.md](../../../.docs/product/LOCAL-DEV-INSTALL.md) — update marketplace ID references to `nacho-allendesalazar.sheetmark`
- [x] [.docs/product/PLAN.md](../../../.docs/product/PLAN.md) — mark publisher/rename items done or update table (optional housekeeping)

#### F — Build & local smoke test (before publish)

- [x] `npm run compile` — 0 type + 0 lint errors
- [x] `npm run package` — production bundle
- [x] `npx @vscode/vsce package` — produces `.vsix` (added `.vscodeignore`; `sheetmark-1.0.0.vsix` ~1.75 MB)
- [x] Install `.vsix` locally (`code --install-extension *.vsix` or Cursor equivalent) — user confirmed works
- [x] Smoke test: open `samples/test.xlsx`, `.csv`, `.tsv`, `.md`
- [x] Smoke test: Help & Feedback submit → row in Google Form
- [x] Smoke test: GitHub issue button opens correct repo

#### G — Publish

- [ ] `npx @vscode/vsce publish --no-dependencies --azure-credential` (or legacy PAT login; see section A)
- [ ] Confirm listing live at `marketplace.visualstudio.com/items?itemName=nacho-allendesalazar.sheetmark`
- [ ] Update README Marketplace link with live URL if placeholder was used

#### H — Post-publish (optional, out of scope for code PR)

- [ ] Open VSX publish (`ovsx publish`) — separate registry, optional
- [ ] New icon design — follow-up idea
- [ ] Announce / star repo / first Marketplace review

### Implementation order

1. **B + C + D** — metadata and docs (one focused PR)
2. **F** — build + local `.vsix` smoke test
3. **A + G** — publisher login + publish (manual, after PR merged or from release branch)

### Out of scope (this round)

- Renaming internal `xlsxViewer.*` / `xlsx-viewer.*` IDs
- New `icon.png`
- Open VSX (unless user wants it in same session)
- Automated CI publish pipeline

## Implementation Log

**2026-08-14 — Step 1 (B + C + D):** metadata and docs for v1.0.0 marketplace publish.

- `package.json` — `displayName`, `description`, `version` 1.0.0, `repository`/`bugs`/`homepage` → `nachosdesign/sheetmark-markdown-xlsx-csv-tsv-editor`; added `markdown` keyword.
- `README.md` — Sheetmark title, install command, Marketplace search hint, GitHub/Marketplace links, upstream fork attribution; removed stale Open VSX link.
- `CHANGELOG.md` — prepended `## v1.0.0` republish entry (upstream history below unchanged).

**2026-08-14 — Rebrand:** display name **Vibe Editor** → **Sheetmark** (`Sheetmark: XLSX, CSV, TSV & Markdown`) in `package.json`, `README.md`, `CHANGELOG.md`, and related docs.

**2026-08-14 — Changelog:** cleared upstream history; fresh `v1.0.0` entry only.

**2026-08-14 — Step 2 (F):** production package + `.vscodeignore` added; `sheetmark-1.0.0.vsix` built; user smoke-tested OK.

**2026-08-14 — Step 3 (G) attempt:** `vsce publish` blocked — no valid Marketplace PAT on this machine (`TF400813` auth error). User must complete publisher login, then re-run publish.

## QA

_Not started._
