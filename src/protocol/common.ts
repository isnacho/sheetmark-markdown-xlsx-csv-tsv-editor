// Host ⇄ webview message contract, shared by both runtimes. TYPES ONLY: import it with
// `import type`, never put runtime code here (the extension host and the webviews are separate
// bundles). Adding or changing a message means editing the union here; the compiler then flags
// every sender and handler that no longer matches.

/** Messages any Sheetmark webview may send (feedback modal, settings, history, links). */
export type CommonWebviewToHost =
    | { command: 'webviewReady' }
    | { command: 'requestFreshData' }
    | { command: 'openExternal'; url: string }
    | { command: 'showVersionHistory' }
    | { command: 'cancelVersionPreview' }
    | { command: 'enableAsDefault' }
    | { command: 'disableDefaultEditor' }
    | { command: 'getSystemDetails' }
    | { command: 'submitFeedback'; data: Record<string, string> };

/** Messages the host sends to every Sheetmark webview. `setTheme` keys on `type`, not `command`. */
export type CommonHostToWebview =
    | { type: 'setTheme'; kind: number }
    | { command: 'systemDetails'; vscodeVersion: string; extensionVersion: string; osInfo: string; editorName: string }
    | { command: 'feedbackResult'; ok: boolean }
    | { command: 'versionHistoryError'; message: string }
    | { command: 'diskDeletedExternally' };

/** `{ command: 'x', ... }` member of union `M` for command `C`. */
export type MessageOf<M, C extends string> = Extract<M, { command: C }>;

/** Host messages that FeedbackModal (src/webviews/shared/feedbackModal.ts) handles, not the editor's main listener. */
export type HandledByFeedbackModal = MessageOf<CommonHostToWebview, 'systemDetails' | 'feedbackResult'>;
