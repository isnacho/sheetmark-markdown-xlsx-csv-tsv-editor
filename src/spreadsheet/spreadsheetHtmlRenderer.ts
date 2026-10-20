import * as vscode from 'vscode';
import { renderSpreadsheetHtml } from '../shared/webviewHtml';

export function getWebviewContent(webviewPanel: vscode.WebviewPanel, context: vscode.ExtensionContext): string {
    const webview = webviewPanel.webview;
    return renderSpreadsheetHtml({
        cspSource: webview.cspSource,
        asset: (relativePath) => webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, ...relativePath.split('/'))).toString(),
    });
}
