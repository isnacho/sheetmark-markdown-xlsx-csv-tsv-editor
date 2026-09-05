---
title: Clickable Markdown file links
slug: clickable-markdown-file-links
status: completed
created: 2026-09-05
updated: 2026-09-05
---

# Clickable Markdown file links

## Idea

Markdown file links within documents should be clickable. Currently, they look like hyperlinks, but I cannot click on them as if it was a link. I want to be able to navigate files by clicking on this.

## Brainstorm

**Scope:** CM6 Preview Edit only. All markdown link types get plain-click navigation: relative file paths, in-document anchors (`#heading`), external URLs (`http://`, `https://`), and `mailto:`. Images, heading "copy link", and fenced-code "copy" actions stay on modifier-click only — unchanged.

**Primary interaction — navigate when collapsed, edit when expanded:**
When a link is in its collapsed/revealed state (brackets and URL hidden; only the styled label shows), a plain left-click on the link label runs the link action instead of placing the caret. When the caret is inside the link (expanded state — `[`, `]`, and `(url)` visible for editing), plain click keeps today's caret-placement behavior so inline link editing still works normally.

**Link actions (same targets as today's modifier-click handler):**
- `#anchor` → scroll to the matching heading line in the current document.
- `http://`, `https://`, `mailto:` → open externally via the existing `openExternal` message.
- Any other non-empty relative href → open the resolved file via the existing `openRelativeFile` message (`vscode.open`, respects the user's default editor association for that file type).

**Modifier-click:** Ctrl/Cmd+Click continues to work exactly as today for links (and for images, headings, code blocks). Plain-click navigation is additive, not a replacement.

**Visual affordance:** Collapsed link labels show `cursor: pointer` on hover so they read as clickable. Expanded (editing) link syntax keeps the normal text cursor.

**Edge cases (fixed):**
- Unsaved document changes do not block navigation — same as opening a file from the Explorer.
- Failed file open continues to surface the existing host-side error toast.
- Empty/malformed links (`[]()` with no URL) remain non-navigable.

## Plan

1. **`livePreviewInteractions.ts`** — add `detectCollapsedLinkAtPos(state, pos)` using the same half-open `isConstructActive` rule as `revealDecorations.ts` (caret at link end = outside). Skip image alt text. No new message-protocol changes — reuse existing `openExternal`, `openRelativeFile`, and scroll-to-heading.
2. **`livePreviewEditor.ts`** — extend the existing `mousedown` dom handler: Ctrl/Cmd+Click unchanged; plain click calls new `onLinkClick(pos)` when `detectCollapsedLinkAtPos` matches, `preventDefault` to suppress caret placement. Use `resolveContentClickPos` for accurate hit testing.
3. **`mdWebview.ts`** — extract `executeLivePreviewLinkAction(href)` from the modifier-click link branch; wire `onLinkClick: handleLivePreviewLinkClick` that delegates to it. Modifier-click link path calls the same helper.
4. **`cm6Theme.ts`** — add `cursor: pointer` on `.cm-md-link-content`.
5. **`livePreviewInteractions.test.mts`** — unit tests for collapsed vs expanded link detection, post-link caret, and image skip.

## Implementation Log

- **`livePreviewInteractions.ts`** — added `detectCollapsedLinkAtPos` with shared `isConstructActive` / image guard; updated module header comment.
- **`livePreviewEditor.ts`** — added `onLinkClick` mount option, `resolveLivePreviewCollapsedLink` export, unified mousedown handler for modifier + plain link clicks.
- **`mdWebview.ts`** — extracted `executeLivePreviewLinkAction`; wired `handleLivePreviewLinkClick` + `onLinkClick`.
- **`cm6Theme.ts`** — pointer cursor on collapsed link labels.
- **`livePreviewInteractions.test.mts`** — five new cases for plain-click link detection.
- **`frontmatter.ts` / `mdWebview.ts` / `mdEditorProvider.ts`** — follow-up: frontmatter-aware anchor line offset; "Section not found" toast; pre-open file existence check + `openRelativeFileFailed` toast; link label-only hit target (hidden `](url)` no longer clickable).
- **`MESSAGE-PROTOCOL.md`** — documented `openRelativeFileFailed`.
- `npm run compile` — pass (0 type + 0 lint errors). Unit tests added in `livePreviewInteractions.test.mts` and `frontmatter.test.mts` (same runner constraints as existing CM6 tests in this repo).

## QA

**Build:** `npm run compile` — pass (0 type + 0 lint errors).

**Manual F5 verification (user-confirmed):**

| Check | Result |
|---|---|
| Plain click on collapsed link label opens file / external URL / mailto | Pass |
| Plain click when caret inside link (expanded) places caret for editing | Pass |
| Ctrl/Cmd+Click still opens links and non-link actions | Pass |
| Pointer cursor on collapsed link labels only | Pass |
| In-document `#anchor` scrolls to heading (with YAML frontmatter) | Pass |
| Unknown section anchor → "Section not found" toast | Pass |
| Missing relative file → "File not found" toast, no blank editor tab | Pass |
| Plain click to the right of link label (same line) does not open link | Pass |
