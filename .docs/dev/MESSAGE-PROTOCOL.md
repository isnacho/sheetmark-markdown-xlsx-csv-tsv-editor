# Message Protocol: host ⇄ webview

The extension host and each webview communicate **only** by `postMessage`. Every message is typed
in [src/protocol/](../../src/protocol/), and both runtimes import those types (`import type`; the
files hold no runtime code):

| File | Contains |
|---|---|
| [common.ts](../../src/protocol/common.ts) | Messages both editors share (ready, links, history, default editor, feedback, `setTheme`) |
| [spreadsheet.ts](../../src/protocol/spreadsheet.ts) | `SpreadsheetWebviewToHost`, `HostToSpreadsheetWebview`, settings and worksheet payloads |
| [markdown.ts](../../src/protocol/markdown.ts) | `MarkdownWebviewToHost`, `HostToMarkdownWebview`, settings and document payloads |

## What the compiler checks

| Mistake | Caught by |
|---|---|
| Sending an unknown command, or a misspelled one | Every send goes through a typed `post(...)` helper: the providers' `post` in `resolveCustomEditor`, and `post` at the top of each webview entry file |
| Wrong or missing payload field when sending | Object literal checks against the union member |
| Handling a command that doesn't exist, or reading a field it doesn't carry | Handlers receive the union and narrow on `command` |
| A message one side sends that the other side never handles | Exhaustiveness checks at the end of each handler (`const unhandled: never = message` on the host; `HandledByFeedbackModal` on the webviews) |

**To add or change a message:** edit the union in `src/protocol/` first, then run
`npm run check-types`. The errors list every sender and handler to update. Senders: grep the
command string; handlers: the providers' `handleMessage` in `resolveCustomEditor`, the spreadsheet
webview's `window.addEventListener('message', ...)` (an `if` chain near the end of the IIFE), and
the `switch (m.command)` under `// ===== Message Handler =====` in `mdWebview.ts`.

The handlers still validate payloads at runtime (`typeof`, `Array.isArray`): the types describe
what our webview sends, not a guarantee about what arrives.

Dispatch is on `message.command`. **Exception:** `setTheme` is `{ type: 'setTheme', kind }` and is
matched on `type` in `ThemeManager.init`.

## Notes

- **Shared-module messages.** `getSystemDetails` / `submitFeedback` / `systemDetails` /
  `feedbackResult` (feedback flow), the feedback modal's `openExternal`, and `setTheme` (theming)
  are sent or handled inside `src/webviews/shared/**`
  ([feedbackModal.ts](../../src/webviews/shared/feedbackModal.ts),
  [themeManager.ts](../../src/webviews/shared/themeManager.ts)), not the per-editor webview entry
  files. Both editors reuse them, so a change there hits both.
- **Settings** flow one way at init (`initSettings`) and on host-side change (`settingsUpdated`);
  webview edits flow back via `updateSettings`. Shapes are defined in
  [settingsManager.ts](../../src/webviews/shared/settingsManager.ts) and, for the spreadsheet,
  [spreadsheetSettingsComponent.ts](../../src/webviews/spreadsheet/components/spreadsheetSettingsComponent.ts).
- **Disk-vs-editor diff.** The overlay itself is entirely webview-side: the baseline is
  `currentContent` captured in the existing `diskChangedExternally` handler, and the new content
  already arrives in that message's `content` field. The settings payloads gained fields
  (`diffReviewEnabled`, `diffLayout`). `diffLayout` is the one non-boolean setting, so the host's
  `updateSettings` writer validates it against `'inline' | 'sideBySide'` instead of coercing.
  The two exceptions are `acceptAllDiskChanges` / `rejectAllDiskChanges` (see the host to webview
  table above): real `contributes.commands` / `keybindings` in package.json, routed through
  `MDEditorProvider`'s tracked `activePanel` (there is no VS Code API to ask "which custom editor
  is focused") rather than through the webview's own message flow. UX flow: [flow.md](../flow.md).
- **External file watching.** Both providers use `createExternalFileChangeWatcher` from
  [fileExternalChangeWatcher.ts](../../src/shared/fileExternalChangeWatcher.ts) (VS Code watcher +
  `fs.watch` fallback, debounced delete, `onDidRenameFiles` for moves). URI-keyed extension state
  migrates via `migrateFileUriState` ([migrateFileUriState.ts](../../src/shared/migrateFileUriState.ts))
  on move.
