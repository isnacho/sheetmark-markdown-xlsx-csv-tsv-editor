// Host-side handling for the webview messages both editors share (src/protocol/common.ts):
// links, feedback, and the "open by default" toggle. Each provider routes these here from its
// handleMessage, so the two editors can't drift apart.

import * as vscode from 'vscode';
import type { IncomingMessage } from 'http';
import type { CommonHostToWebview, CommonWebviewToHost, MessageOf } from '../protocol/common';
import { isAllowedExternalUrl } from './externalLinks';
import { disableOpenByDefault, enableOpenByDefault, SheetmarkAssociationType } from './editorAssociationUtils';

const SHARED_COMMANDS = ['openExternal', 'getSystemDetails', 'submitFeedback', 'enableAsDefault', 'disableDefaultEditor'] as const;
export type SharedHostMessage = MessageOf<CommonWebviewToHost, typeof SHARED_COMMANDS[number]>;

/** True for messages handleSharedHostMessage owns; narrows the editor's union for its own handlers. */
export function isSharedHostMessage<M extends { command: string }>(message: M): message is Extract<M, SharedHostMessage> {
    return (SHARED_COMMANDS as readonly string[]).includes(message?.command);
}

export interface SharedHostContext {
    post(message: CommonHostToWebview): void;
    /** File type whose "open by default" association the toggle changes. */
    associationType(): SheetmarkAssociationType;
    /** Re-send settings after the default-editor association changed. */
    sendSettings(): void;
}

const FEEDBACK_FORM_PATH = '/forms/d/e/1FAIpQLSc0rQ232X2rAI-gyLeACwaFsgN_UKf5LMt3ENd8WYtNVCCp7w/formResponse';

export async function handleSharedHostMessage(message: SharedHostMessage, ctx: SharedHostContext): Promise<void> {
    switch (message.command) {
        case 'openExternal': {
            const url = typeof message.url === 'string' ? message.url : '';
            if (url && isAllowedExternalUrl(url)) {
                await vscode.env.openExternal(vscode.Uri.parse(url));
            } else if (url) {
                void vscode.window.showWarningMessage(`Sheetmark only opens http, https and mailto links. Blocked: ${url.slice(0, 200)}`);
            }
            return;
        }

        case 'getSystemDetails': {
            const ext = vscode.extensions.getExtension('iggyinc.sheetmark');
            ctx.post({
                command: 'systemDetails',
                vscodeVersion: vscode.version,
                extensionVersion: ext?.packageJSON?.version ?? 'unknown',
                osInfo: `${process.platform} ${process.arch}`,
                editorName: vscode.env.appName || 'VS Code',
            });
            return;
        }

        case 'submitFeedback': {
            ctx.post({ command: 'feedbackResult', ok: await submitFeedbackForm(message.data) });
            return;
        }

        case 'enableAsDefault': {
            try {
                await enableOpenByDefault(ctx.associationType());
                ctx.sendSettings();
            } catch (err) {
                vscode.window.showErrorMessage(`Error enabling default editor: ${err}`);
            }
            return;
        }

        case 'disableDefaultEditor': {
            try {
                const type = ctx.associationType();
                const choice = await vscode.window.showWarningMessage(
                    `Are you sure you want to disable Sheetmark for all .${type} files? You will be prompted to select a new default editor.`,
                    'Yes, Disable',
                    'Cancel',
                );
                if (choice === 'Yes, Disable') {
                    await disableOpenByDefault(type);
                    await vscode.commands.executeCommand('workbench.action.reopenWithEditor');
                    ctx.sendSettings();
                }
            } catch (err) {
                vscode.window.showErrorMessage(`Error disabling editor: ${err}`);
            }
            return;
        }
    }
}

async function submitFeedbackForm(formData: Record<string, string>): Promise<boolean> {
    try {
        const https = await import('https');
        const body = Object.entries(formData && typeof formData === 'object' ? formData : {})
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v ?? '')}`)
            .join('&');
        return await new Promise<boolean>((resolve) => {
            const req = https.request({
                hostname: 'docs.google.com',
                path: FEEDBACK_FORM_PATH,
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
            }, (res: IncomingMessage) => resolve((res.statusCode ?? 0) < 400));
            req.on('error', () => resolve(false));
            req.write(body);
            req.end();
        });
    } catch {
        return false;
    }
}

/** Push the VS Code color theme to the webview now and whenever it changes, until the panel closes. */
export function syncColorTheme(panel: vscode.WebviewPanel, post: (message: CommonHostToWebview) => void): () => void {
    const send = () => {
        try { post({ type: 'setTheme', kind: vscode.window.activeColorTheme.kind }); } catch { /* panel gone */ }
    };
    const subscription = vscode.window.onDidChangeActiveColorTheme(send);
    panel.onDidDispose(() => subscription.dispose());
    return send;
}
