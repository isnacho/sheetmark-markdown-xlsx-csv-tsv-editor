// Markdown editor (xlsxViewer.md) message contract. TYPES ONLY; see common.ts.

import type { CommonHostToWebview, CommonWebviewToHost } from './common';

export type MermaidPreviewMode = 'diagram' | 'code';

export interface MarkdownSettings {
    stickyToolbar: boolean;
    wordWrap: boolean;
    showOutline: boolean;
    showLineNumbers: boolean;
    livePreviewReveal: boolean;
    livePreviewLineNumbers: boolean;
    autoSave: boolean;
    isDefaultEditor: boolean;
    showStats: boolean;
    statsShowLines: boolean;
    statsShowWords: boolean;
    statsShowChars: boolean;
    statsShowReadingTime: boolean;
    showCursorPosition: boolean;
    diffReviewEnabled: boolean;
    diffLayout: 'inline' | 'sideBySide';
}

/** Document payload for `initMarkdown` and `diskChangedExternally`. */
export interface MarkdownDocumentPayload {
    content: string;
    fileName: string;
    documentUri: string;
    documentDirUri: string;
    workspaceFolderUri: string | null;
    /** Per table (document order index), column widths in px. */
    tableColumnWidths: Record<number, readonly number[]>;
    frontmatterPanelCollapsed: boolean;
    mermaidPreviewMode: MermaidPreviewMode;
    calloutDefaultType: string;
}

export type MarkdownWebviewToHost =
    | CommonWebviewToHost
    | { command: 'saveMarkdown'; text: string; force?: boolean; isAutosave: boolean }
    | { command: 'updateSettings'; settings: Partial<MarkdownSettings> }
    | { command: 'resolveImageUris'; sources: string[] }
    | { command: 'openRelativeFile'; href: string; documentUri: string }
    /** versionId defaults to the previewed version; force skips the disk-conflict check. */
    | { command: 'restoreVersion'; versionId?: string; force?: boolean }
    | { command: 'saveTableColumnWidths'; widths: Record<number, readonly number[]> }
    | { command: 'saveFrontmatterPanelCollapsed'; collapsed: boolean }
    | { command: 'saveMermaidPreviewMode'; mode: MermaidPreviewMode }
    | { command: 'saveCalloutDefaultType'; type: string };

export type HostToMarkdownWebview =
    | CommonHostToWebview
    | ({ command: 'initMarkdown' } & MarkdownDocumentPayload)
    | ({ command: 'diskChangedExternally' } & MarkdownDocumentPayload)
    | { command: 'initSettings'; settings: MarkdownSettings }
    | { command: 'settingsUpdated'; settings: MarkdownSettings }
    | { command: 'saveResult'; ok: boolean; isAutosave?: boolean; error?: string }
    | { command: 'saveConflict' }
    | { command: 'restoreConflict'; versionId: string }
    | { command: 'resolvedImageUris'; resolved: Record<string, string> }
    | { command: 'versionPreviewMd'; versionId: string; timestamp: number }
    | { command: 'versionPreviewCancelledMd' }
    | { command: 'versionRestoredMd'; versionId: string; timestamp: number }
    | { command: 'diskMovedExternally'; fileName: string; documentUri: string; documentDirUri: string }
    | { command: 'reloadFromDiskError'; message: string }
    | { command: 'openRelativeFileFailed'; message: string }
    | { command: 'acceptAllDiskChanges' }
    | { command: 'rejectAllDiskChanges' };
