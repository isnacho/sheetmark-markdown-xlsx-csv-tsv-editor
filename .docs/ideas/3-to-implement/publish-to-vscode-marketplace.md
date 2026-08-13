---
title: Publish extension to VS Code Marketplace
slug: publish-to-vscode-marketplace
status: to-implement
created: 2026-08-12
updated: 2026-08-13
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

- **Repo:** `github.com/nacho-allendesalazar/vscode-super-viewer`. Update
  `package.json` `repository`/`bugs`/`homepage`, README links/badges/install
  command, and the feedback modal's GitHub-issue URL to point here.
- **Publisher:** `nacho-allendesalazar` (already set in `package.json`).
  Marketplace publisher account itself still needs to be registered/confirmed
  (Azure DevOps org + PAT) — not yet done.
- **Package id (`package.json` "name"):** keep `super-file-viewer` — already
  rebranded away from `xlsx-viewer`, no reason to rename again and risk churn.
- **Marketplace displayName:** `Vibe Editor: Markdown, XLSX, CSV & TSV` — a
  brand ("Vibe", nod to vibe coding) up front for identity, plus the full
  format list after the colon so Marketplace search still surfaces it for
  "xlsx", "csv", "tsv", "markdown" queries (the same keyword-forward pattern
  the current listing already uses, just with a brand added).
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

Target extension ID: **`nacho-allendesalazar.super-file-viewer`**

### Checklist

#### Already done

- [x] Google Form wired to user's form (`own-feedback-google-form` — completed)
- [x] Feedback GitHub-issue URL → `nacho-allendesalazar/vscode-super-viewer`
- [x] `LICENSE` — second copyright line for Nacho Allendesalazar Rivas (2026)
- [x] `publisher` in `package.json` → `nacho-allendesalazar`
- [x] Extension self-lookup → `nacho-allendesalazar.super-file-viewer` (`mdEditorProvider.ts`, `spreadsheetEditorProvider.ts`)
- [x] Projects modal removed from `src/` (no `projectsModal` references remain)

#### A — Publisher account (manual, blocking publish)

- [ ] Create [Azure DevOps](https://dev.azure.com) org (if needed)
- [ ] Create [Marketplace publisher](https://marketplace.visualstudio.com/manage/createpublisher) with ID `nacho-allendesalazar`
- [ ] Generate a Personal Access Token (PAT) with **Marketplace → Manage** scope
- [ ] `npx @vscode/vsce login nacho-allendesalazar` (store PAT)

#### B — `package.json` metadata

File: [package.json](../../../package.json)

- [ ] `displayName` → `Vibe Editor: Markdown, XLSX, CSV & TSV`
- [ ] `version` → `1.0.0`
- [ ] `repository.url` → `https://github.com/nacho-allendesalazar/vscode-super-viewer`
- [ ] Add `bugs.url` → `https://github.com/nacho-allendesalazar/vscode-super-viewer/issues`
- [ ] Add `homepage` → `https://github.com/nacho-allendesalazar/vscode-super-viewer`
- [ ] Review `description` — mention "Vibe Editor" brand if desired (optional polish)
- [ ] Review `keywords` — add `markdown` if missing; keep format-search terms
- [ ] Confirm `categories` (`Other` is fine for v1.0.0)
- [ ] **Do not rename** `name`, `xlsxViewer.*` viewTypes, or `xlsx-viewer.*` command IDs (load-bearing per CLAUDE.md)

#### C — README (Marketplace landing page)

File: [README.md](../../../README.md)

- [ ] Update H1/title to match new `displayName` (or close variant)
- [ ] Install command → `code --install-extension nacho-allendesalazar.super-file-viewer`
- [ ] Marketplace search hint → new display name
- [ ] GitHub links → `nacho-allendesalazar/vscode-super-viewer`
- [ ] Marketplace link → `itemName=nacho-allendesalazar.super-file-viewer` (placeholder URL until live)
- [ ] Open VSX link → update or remove until published there
- [ ] Add short attribution note: fork of upstream MIT project; original copyright retained in LICENSE

#### D — Changelog

File: [CHANGELOG.md](../../../CHANGELOG.md)

- [ ] Prepend `## v1.0.0` entry (do not rewrite history below):
  - Independent republish under `nacho-allendesalazar.super-file-viewer`
  - Rebrand display name to Vibe Editor
  - Removed upstream projects modal; feedback → own Google Form + repo
  - Fork maintained at new GitHub repo

#### E — Internal docs (non-blocking, same PR ok)

- [ ] [.docs/LOCAL-DEV-INSTALL.md](../../../.docs/LOCAL-DEV-INSTALL.md) — update marketplace ID references to `nacho-allendesalazar.super-file-viewer`
- [ ] [.docs/PLAN.md](../../../.docs/PLAN.md) — mark publisher/rename items done or update table (optional housekeeping)

#### F — Build & local smoke test (before publish)

- [ ] `npm run compile` — 0 type + 0 lint errors
- [ ] `npm run package` — production bundle
- [ ] `npx @vscode/vsce package` — produces `.vsix`
- [ ] Install `.vsix` locally (`code --install-extension *.vsix` or Cursor equivalent)
- [ ] Smoke test: open `samples/test.xlsx`, `.csv`, `.tsv`, `.md`
- [ ] Smoke test: Help & Feedback submit → row in Google Form
- [ ] Smoke test: GitHub issue button opens correct repo

#### G — Publish

- [ ] `npx @vscode/vsce publish` (or `publish -p <pat>` in CI later)
- [ ] Confirm listing live at `marketplace.visualstudio.com/items?itemName=nacho-allendesalazar.super-file-viewer`
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

_Not started._

## QA

_Not started._
