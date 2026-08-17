---
title: Publish Sheetmark to Cursor
slug: publish-sheetmark-to-cursor
status: to-qa
created: 2026-08-17
updated: 2026-08-17
---

# Publish Sheetmark to Cursor

## Idea

Make Sheetmark available in Cursor (publish to Open VSX registry, and/or support VSIX install) so users on Cursor editor can install the extension.

## Brainstorm

**UX goal:** Make Sheetmark easy to find and install in Cursor, while retaining a reliable manual path if marketplace indexing is delayed or unavailable.

**Distribution:** Treat Open VSX as a first-class second marketplace. Publish Sheetmark under the existing `iggyinc.sheetmark` extension identity, making it discoverable in Cursor as well as other Open VSX-compatible editors. The VS Code Marketplace remains supported.

**Release experience:** A GitHub Release publishes the same release version to both marketplaces. The release also includes the generated `.vsix` package as a downloadable fallback, so a Cursor user can install it through **Extensions: Install from VSIX...** if Open VSX or Cursor has not indexed the release yet.

**Discoverability:** The README presents both install paths: VS Code Marketplace and Open VSX/Cursor. It clearly describes the VSIX route as a fallback rather than the primary experience.

**Publisher setup and verification:** Before enabling automated publishing, create and verify the `iggyinc` Open VSX namespace, establish an appropriately scoped Open VSX token as a GitHub Actions secret, and verify the published listing’s metadata, Cursor search/install flow, and VSIX install flow. Preserve the extension identity and existing protected command/view-type IDs unchanged.

## Plan

1. **One-time publisher setup (already supplied by the user):** keep `OVSX_PAT` solely as an environment secret alongside `VSCE_PAT`, and use it only in GitHub Actions. The `iggyinc` Open VSX namespace must exist before the first automated release. No token appears in source, documentation examples, or command output.

2. **[.github/workflows/publish-marketplace.yml](../../../.github/workflows/publish-marketplace.yml):** turn the existing release workflow into a two-registry pipeline while retaining its name and GitHub Release trigger. Add a required `release_tag` input for controlled manual retries, check out that exact tag, package Sheetmark once with `@vscode/vsce`, and upload that exact versioned `.vsix` to the corresponding GitHub Release using `contents: write`. Pass the same VSIX unchanged to parallel Marketplace and Open VSX publishing jobs. The jobs use the protected `marketplace` environment and read only `VSCE_PAT` and `OVSX_PAT`; Open VSX publishes through `npx ovsx publish <vsix> -p "$OVSX_PAT"`. This leaves the extension runtime and the protected `xlsxViewer.*` / `xlsx-viewer.*` IDs untouched.

3. **[README.md](../../../README.md):** expose both normal installation routes near the opening install link and in the Install section: VS Code Marketplace for VS Code, and Open VSX/Cursor for Cursor and other compatible editors. Link the Open VSX listing (`iggyinc.sheetmark`) and GitHub Releases; describe **Extensions: Install from VSIX...** as the fallback when marketplace discovery is delayed.

4. **[.agents/skills/publish-vscode-marketplace/SKILL.md](../../../.agents/skills/publish-vscode-marketplace/SKILL.md):** broaden the release skill to make Open VSX a required part of Sheetmark’s release flow. Update its preflight, dispatch command (including the release-tag input), run selection, success criteria, post-publish verification, and troubleshooting so it checks the single VSIX release asset plus both registry listings. It continues to refuse token sharing and treats publication as complete only after both publishing jobs succeed.

5. **Verification:** run `npm run compile`, package a local VSIX, review its contents with `vsce ls --tree`, and install it in Cursor through the VSIX path. The next new-version GitHub Release is the end-to-end check: confirm the attached versioned VSIX, the Marketplace listing, the Open VSX listing, Cursor search/install, and manual VSIX installation. Do not trigger the production workflow against an already-published version merely to test it.

## Implementation Log

**2026-08-17 — Release automation and Cursor distribution:**

- [.github/workflows/publish-marketplace.yml](../../../.github/workflows/publish-marketplace.yml) now packages Sheetmark once from the exact release tag, attaches its versioned VSIX to the GitHub Release, and gives that same artifact to independent VS Code Marketplace and Open VSX publishing jobs. Manual retries require the release tag explicitly; credentials remain GitHub environment secrets only.
- [README.md](../../../README.md) now links the Open VSX/Cursor listing and GitHub Release VSIX fallback alongside the existing VS Code Marketplace path.
- [.agents/skills/publish-vscode-marketplace/SKILL.md](../../../.agents/skills/publish-vscode-marketplace/SKILL.md) now owns both-registry release publishing and verification, including the required release asset and Open VSX/Cursor indexing checks.
- Verification passed: workflow YAML parses; `npm run compile` completed with no type or lint errors; `@vscode/vsce` packaged a 1.91 MB VSIX and its tree contains only the expected production files (no source, docs, skills, or CI directories).

No deviation from the approved plan. Manual Cursor installation and a new-version release remain the QA gate.

## QA

_Not started._
