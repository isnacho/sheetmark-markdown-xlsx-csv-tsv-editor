// Host ⇄ webview message contract, shared by both runtimes. TYPES ONLY: import it with
// `import type`, never put runtime code here (the extension host and the webviews are separate
// bundles). Adding or changing a message means editing the union here; the compiler then flags
// every sender and handler that no longer matches.

/**
 * Fonts built into Sheetmark. The CSS stack for each lives in resources/shared/theme.css
 * (`:root[data-font=...]`); a new one also needs a label in src/webviews/shared/fontManager.ts and an
 * entry in src/shared/fontChoice.ts.
 */
export type BuiltInFont = 'inter' | 'system' | 'serif';

/**
 * What the `xlsxViewer.fontFamily` setting holds, shared by both editors: a `BuiltInFont` id, or the
 * family name of a font installed on the computer (for example "Helvetica Neue"), picked from the
 * list the host sends in `localFonts`.
 */
export type FontChoice = string;

/** Messages any Sheetmark webview may send (feedback modal, settings, history, links). */
export type CommonWebviewToHost =
    | { command: 'webviewReady' }
    | { command: 'setFontFamily'; font: FontChoice }
    | { command: 'requestLocalFonts' }
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
    | { command: 'fontFamilyChanged'; font: FontChoice }
    /** Family names of the fonts installed on the machine the extension runs on, sorted; empty when they cannot be listed. */
    | { command: 'localFonts'; fonts: string[] }
    | { command: 'systemDetails'; vscodeVersion: string; extensionVersion: string; osInfo: string; editorName: string }
    | { command: 'feedbackResult'; ok: boolean }
    | { command: 'versionHistoryError'; message: string }
    | { command: 'diskDeletedExternally' };

/** `{ command: 'x', ... }` member of union `M` for command `C`. */
export type MessageOf<M, C extends string> = Extract<M, { command: C }>;

/** Host messages that FeedbackModal (src/webviews/shared/feedbackModal.ts) handles, not the editor's main listener. */
export type HandledByFeedbackModal = MessageOf<CommonHostToWebview, 'systemDetails' | 'feedbackResult'>;
