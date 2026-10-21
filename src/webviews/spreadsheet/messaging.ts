// Typed send to the extension host: the compiler checks every webview-to-host message against
// src/protocol/spreadsheet.ts. Runtime: WEBVIEW (browser).

import { vscode } from '../shared/common';
import type { SpreadsheetWebviewToHost } from '../../protocol/spreadsheet';

export const post = (message: SpreadsheetWebviewToHost) => vscode.postMessage(message);
