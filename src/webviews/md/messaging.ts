// Typed send to the extension host: the compiler checks every webview-to-host message against
// src/protocol/markdown.ts. Runtime: WEBVIEW (browser).

import { vscode } from '../shared/common';
import type { MarkdownWebviewToHost } from '../../protocol/markdown';

export const post = (message: MarkdownWebviewToHost) => vscode.postMessage(message);
