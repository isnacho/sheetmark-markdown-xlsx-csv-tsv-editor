// Confirm dialogs for the Markdown webview. Runtime: WEBVIEW (browser).

import { Utils } from '../shared/utils';

// VS Code webviews are sandboxed without `allow-modals` — window.confirm()/alert()/
// prompt() are silently blocked, so a real dialog is built here reusing the shared
// .feedback-overlay/.feedback-modal pattern (same one FeedbackModal uses).
export type ModalOutcome = 'confirm' | 'secondary' | 'cancel';

export function confirmModal(
    title: string,
    message: string,
    confirmLabel: string,
    secondaryLabel?: string
): Promise<ModalOutcome> {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'feedback-overlay reload-confirm-overlay';
        const modal = document.createElement('div');
        modal.className = 'feedback-modal';
        modal.innerHTML = `
            <div class="feedback-header">
                <h2>${Utils.escapeHtml(title)}</h2>
            </div>
            <div class="feedback-body" style="padding: 20px 24px 24px 24px; gap: 20px;">
                <p style="margin: 0; font-size: 13.5px; color: var(--color-text-primary); line-height: 1.5;">
                    ${Utils.escapeHtml(message)}
                </p>
                <div style="display: flex; justify-content: flex-end; gap: 8px;">
                    <button class="reload-confirm-cancel" type="button" style="background: none; border: 1px solid var(--color-border-default); border-radius: 6px; color: var(--color-text-primary); font-size: 13px; font-weight: 500; padding: 6px 14px; cursor: pointer;">${Utils.escapeHtml(secondaryLabel ?? 'Cancel')}</button>
                    <button class="reload-confirm-ok" type="button" style="background: var(--color-status-warning); border: none; border-radius: 6px; color: var(--color-text-on-action); font-size: 13px; font-weight: 600; padding: 6px 14px; cursor: pointer;">${Utils.escapeHtml(confirmLabel)}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        document.body.appendChild(modal);
        requestAnimationFrame(() => {
            overlay.classList.add('active');
            modal.classList.add('active');
        });

        const finish = (result: ModalOutcome) => {
            overlay.remove();
            modal.remove();
            resolve(result);
        };
        overlay.addEventListener('click', () => finish('cancel'));
        modal.querySelector('.reload-confirm-cancel')?.addEventListener('click', () => finish(secondaryLabel ? 'secondary' : 'cancel'));
        modal.querySelector('.reload-confirm-ok')?.addEventListener('click', () => finish('confirm'));
    });
}

export type ReloadDecision = 'reload' | 'keepLocal' | 'cancel';

// 'keepLocal' is a real action (force-write to disk) distinct from 'cancel', which
// stays the passive backdrop/click-outside no-op it always was.
export function confirmDiscardAndReload(): Promise<ReloadDecision> {
    return confirmModal(
        'Reload from Disk',
        'Discard unsaved changes and reload from disk?',
        'Discard & Reload',
        'Keep mine, ignore disk'
    ).then((r) => (r === 'confirm' ? 'reload' : r === 'secondary' ? 'keepLocal' : 'cancel'));
}

export function confirmOverwriteConflict(): Promise<boolean> {
    return confirmModal(
        'File Changed on Disk',
        'This file changed on disk since you opened it. Overwrite it with your local changes anyway?',
        'Overwrite'
    ).then((r) => r === 'confirm');
}

export function confirmRestoreConflict(): Promise<boolean> {
    return confirmModal(
        'File Changed on Disk',
        'This file changed on disk since you opened it. Restore the selected version anyway? Your disk changes will be lost.',
        'Restore Anyway'
    ).then((r) => r === 'confirm');
}

export function confirmOverwriteWithLocal(): Promise<boolean> {
    return confirmModal('Keep Local Version', 'Overwrite disk with your version?', 'Overwrite disk')
        .then((r) => r === 'confirm');
}
