// Shared mutable state of the Markdown webview. Every module reads and writes it through `state`
// rather than through its own copies, so there is one source of truth (currentContent above all:
// it is what save and disk reload work from).
//
// Runtime: WEBVIEW (browser).

import type { ToolbarManager } from '../shared/toolbarManager';
import type { MarkdownSettings } from '../../protocol/markdown';

export const state = {
    isEditMode: false,
    isVersionPreviewMode: false,
    isSaving: false,
    /** Exact text sent with the in-flight `saveMarkdown`: used to stamp `originalContent` on success. */
    pendingSaveContent: null as string | null,
    isReloadingFromDisk: false,
    pendingDiskContent: null as string | null,
    // Set when the watcher reports the file was deleted externally; cleared by a
    // subsequent real disk change, a manual reload, or a save that recreates the file.
    pendingDiskDeleted: false,
    // Outline visibility waits for host `initSettings`: defaults would flash the
    // panel (and peek at the bottom) while "Loading Markdown..." is still shown.
    hostSettingsLoaded: false,

    // Mount CM6 preview edit exactly once on the panel's first `initSettings`.
    hasEnteredPreviewEdit: false,
    // Content the user was last looking at before an external write: the baseline
    // the disk diff compares against. Captured on the FIRST external change and
    // held until the diff is dismissed or the document is saved, so a burst of
    // external writes still diffs against what was actually on screen. Survives
    // applyReloadedContent() on purpose.
    diffBaseline: null as string | null,
    diffVisible: false,
    // Tallied per diff session (reset alongside diffBaseline) so the closing
    // toast can report what actually happened instead of just "resolved".
    diffAcceptedCount: 0,
    diffRejectedCount: 0,
    originalContent: '',
    currentContent: '',
    toolbarManager: null as ToolbarManager | null,
    resolvedImageUriCache: new Map<string, string>(),
    // Set while a CM6 Ctrl/Cmd+Click image lightbox is waiting on an async 'resolveImageUris'
    // round-trip (see handleLivePreviewModifierClick / applyResolvedImageUris).
    pendingCm6LightboxSrc: null as string | null,
    documentUri: '',
    documentDirUri: '',
    workspaceFolderUri: null as string | null,
    // Persisted table column widths (table order-index -> px per column), read
    // once from the host on load and kept in sync locally after every resize:
    // see tableColumnWidths in src/shared/preferenceStore.ts for why this can't
    // live in the .md file's own table syntax.
    currentTableColumnWidths: {} as Record<number, readonly number[]>,
    frontmatterPanelCollapsed: false,
    mermaidPreviewMode: 'diagram' as 'diagram' | 'code',
    calloutDefaultType: 'info',

    currentSettings: {
        stickyToolbar: true,
        wordWrap: true,
        showOutline: true,
        showLineNumbers: true,
        livePreviewReveal: true,
        livePreviewLineNumbers: false,
        autoSave: false,
        isDefaultEditor: true,
        showStats: true,
        statsShowLines: true,
        statsShowWords: true,
        statsShowChars: true,
        statsShowReadingTime: true,
        showCursorPosition: true,
        diffReviewEnabled: false,
        diffLayout: 'inline',
    } as MarkdownSettings,
};
