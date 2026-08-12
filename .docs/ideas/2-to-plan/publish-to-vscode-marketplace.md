---
title: Publish extension to VS Code Marketplace
slug: publish-to-vscode-marketplace
status: to-plan
created: 2026-08-12
updated: 2026-08-12
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
    to one the user owns. **Open item:** user needs to create their own
    Google Form (or equivalent) and supply the new form action path plus the
    `entry.*` field IDs before this can be wired in — tracked as a blocking
    to-do for the Plan/Implement phase, not resolved yet.
  - Repoint every remaining old-repo/old-Marketplace-id reference (§ above).
- **Versioning:** reset to `1.0.0` for this republish — signals a genuinely
  new, independently-published extension rather than a continuation of the
  old listing.
- **Icon:** deferred by the user ("let's do this later"). The existing
  `icon.png` (generic file/format glyph, no personal branding from the old
  author, so no legal issue reusing it short-term) ships as a placeholder for
  this release. A new icon concept is an explicit follow-up, not part of this
  round's scope.
- **Marketplace submission checklist** (the "anything else" the user asked
  about): publisher account registration/confirmation, README rewrite (drop
  old links/install command, add new repo links), `CHANGELOG.md` entry for
  the rename/republish (append — don't rewrite history), `package.json`
  field updates (displayName, version, repository/bugs/homepage, publisher
  confirmed), `LICENSE` addition, removal of the two old-creator UI/telemetry
  surfaces, keywords/categories review, final `vsce package` +
  `npm run package` build and a local install smoke test before publishing.

## Plan

_Not started._

## Implementation Log

_Not started._

## QA

_Not started._
