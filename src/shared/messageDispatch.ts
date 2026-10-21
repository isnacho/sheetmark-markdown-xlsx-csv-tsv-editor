// Routes webview messages to a provider's handler. Commands that write the file go through the
// panel's SerialQueue (see serialQueue.ts) so they run one at a time; everything else runs
// immediately. Pure (no `vscode` import) so the routing is unit-tested.

import type { SerialQueue } from './serialQueue';

/** Spreadsheet commands that read-modify-write the file. */
export const SPREADSHEET_FILE_WRITING_COMMANDS: ReadonlySet<string> = new Set(['saveXlsxEdits', 'restoreVersion']);
/** Markdown commands that write the file. */
export const MARKDOWN_FILE_WRITING_COMMANDS: ReadonlySet<string> = new Set(['saveMarkdown', 'restoreVersion']);

export interface MessageDispatcherOptions {
    handle: (message: any) => Promise<void>;
    queue: SerialQueue;
    queuedCommands: ReadonlySet<string>;
    /** Called instead of leaving an unhandled rejection; defaults to console.error. */
    onError?: (command: unknown, error: unknown) => void;
}

/** Returns the listener for `webview.onDidReceiveMessage`. Its promise settles when the message is handled and never rejects. */
export function createMessageDispatcher(options: MessageDispatcherOptions): (message: any) => Promise<void> {
    const onError = options.onError ?? ((command, error) => console.error(`[Sheetmark] '${String(command)}' handler failed:`, error));
    return (message: any) => {
        const run = () => options.handle(message);
        const done = options.queuedCommands.has(message?.command) ? options.queue.run(run) : run();
        return done.catch(error => onError(message?.command, error));
    };
}
