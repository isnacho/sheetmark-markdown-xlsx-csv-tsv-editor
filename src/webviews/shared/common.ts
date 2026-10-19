 

import type { SpreadsheetWebviewToHost } from '../../protocol/spreadsheet';
import type { MarkdownWebviewToHost } from '../../protocol/markdown';

/** Any message a Sheetmark webview may send. Each editor narrows this with its own `post` helper. */
export type AnyWebviewToHost = SpreadsheetWebviewToHost | MarkdownWebviewToHost;

interface VsCodeWebviewApi {
    postMessage(message: AnyWebviewToHost): void;
    getState(): unknown;
    setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeWebviewApi;

export const vscode: VsCodeWebviewApi = (function () {
    if (typeof acquireVsCodeApi === 'function') {
        return acquireVsCodeApi();
    }
    return { postMessage: () => { }, getState: () => undefined, setState: () => { } };
})();

export const VirtualScrollConfig = {
    ROW_HEIGHT: 28,
    BUFFER_ROWS: 20,
    CHUNK_SIZE: 100
};

export function debounce(func: Function, wait: number) {
    let timeout: any;
    return function (this: any, ...args: any[]) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}
