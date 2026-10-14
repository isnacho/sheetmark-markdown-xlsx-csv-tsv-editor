# Shared Webview Components Guide

Modules in this folder run in the **webview (browser)** and are bundled into both webviews:
the spreadsheet webview (xlsx, csv, tsv) and the Markdown webview. A change here affects both.

| File | What it provides |
|---|---|
| `common.ts` | `vscode` (the `acquireVsCodeApi()` wrapper used for every `postMessage`), `VirtualScrollConfig` (`ROW_HEIGHT`, `BUFFER_ROWS`, `CHUNK_SIZE`), `debounce` |
| `virtualLoader.ts` | `VirtualLoader`: request/response bookkeeping for row windows from the host (`getRows` → `rowsData`, `resolveRequest`) |
| `themeManager.ts` | `ThemeManager` (VS Code / Light / Dark; handles the host's `setTheme` message, keyed on `type`), `renderThemeToggleSettingItem` |
| `settingsManager.ts` | `SettingsManager`, `SettingDefinition`: settings panel rendering and change wiring |
| `toolbarManager.ts` | `ToolbarManager`, `ToolbarButton`: toolbar buttons, visibility, sticky layout, header height |
| `toolbarLayout.ts` | `applyToolbarLayout`: applies the sticky/non-sticky toolbar setting via `ToolbarManager` |
| `menuPanel.ts` | Markup helpers for menu-panel rows (settings gear panel, slash menu icons): `renderMenuCheckboxRow`, `renderMenuActionRow`, `renderMenuSelectRow`, `renderMenuSection`, `renderMenuPanelShell` |
| `delayedTitleTooltip.ts` | Delayed hover tooltips for icon-only controls: `wireDelayedToolbarTooltips`, `applyDelayedTitle`, `setDelayedTitleText` |
| `feedbackModal.ts` | `FeedbackModal`: feedback dialog; sends `getSystemDetails`, `submitFeedback`, `openExternal`; handles `systemDetails`, `feedbackResult` |
| `utils.ts` | `Utils` static helpers: `Utils.$` (element by id), `Utils.showToast`, `Utils.writeToClipboardAsync`, `Utils.escapeHtml`, `Utils.normalizeCellText` |
| `icons.ts` | `Icons`: SVG icon strings for toolbars and menus |

Message details for the shared modules are in
[MESSAGE-PROTOCOL.md](../../../.docs/dev/MESSAGE-PROTOCOL.md).
