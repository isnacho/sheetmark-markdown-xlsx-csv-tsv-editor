// The Markdown webview's single toast (bottom-center): message, up to three action buttons,
// optional persistence. Runtime: WEBVIEW (browser).

import { Utils } from '../shared/utils';

const $ = Utils.$;

let toastDismissTimer: number | null = null;
let toastOnDismiss: (() => void) | null = null;

// Same outline/gray style for both — only the shape differs. Success: plain
// checkmark for positive acknowledgements (Saved, Copied, Reloaded, ...).
// Warning: caution triangle for anything the user should pay attention to
// (disk conflicts/deletions, failures).
const TOAST_ICON_SUCCESS = '<polyline points="20 6 9 17 4 12"></polyline>';
const TOAST_ICON_WARNING = '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>'
    + '<line x1="12" y1="9" x2="12" y2="13"></line>'
    + '<line x1="12" y1="17" x2="12.01" y2="17"></line>';

export function hideToast() {
    const toast = $('toastNotification');
    if (toastDismissTimer !== null) {
        window.clearTimeout(toastDismissTimer);
        toastDismissTimer = null;
    }
    toast?.classList.remove('show');
    toastOnDismiss = null;
}

export interface ToastAction {
    label: string;
    onClick: () => void;
}

export function showToast(
    message: string,
    action?: ToastAction | ToastAction[],
    opts?: { persistent?: boolean; onDismiss?: () => void; icon?: 'success' | 'warning'; hideCloseButton?: boolean }
) {
    // Three slots: the disk-change toast carries Load disk changes, Review changes,
    // and Keep local version.
    const actions = action ? (Array.isArray(action) ? action : [action]) : [];
    let toast = $('toastNotification');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toastNotification';
        toast.className = 'toast-notification';
        toast.innerHTML = `
            <div class="toast-header">
                <div class="toast-icon-wrapper">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></svg>
                </div>
                <span class="toast-text"></span>
                <button class="toast-close" type="button" aria-label="Dismiss">&times;</button>
            </div>
            <div class="toast-actions">
                <button class="toast-action hidden" type="button"></button>
                <button class="toast-action hidden" type="button"></button>
                <button class="toast-action hidden" type="button"></button>
            </div>
        `;
        document.body.appendChild(toast);

        toast.querySelector('.toast-close')?.addEventListener('click', () => {
            const onDismiss = toastOnDismiss;
            hideToast();
            onDismiss?.();
        });
    }
    if (toast) {
        const toastText = toast.querySelector('.toast-text') || $('toastText');
        if (toastText) {toastText.textContent = message;}

        const iconSvg = toast.querySelector('.toast-icon-wrapper svg');
        if (iconSvg) {iconSvg.innerHTML = opts?.icon === 'warning' ? TOAST_ICON_WARNING : TOAST_ICON_SUCCESS;}

        const actionBtns = Array.from(toast.querySelectorAll('.toast-action')) as HTMLButtonElement[];
        actionBtns.forEach((btn, i) => {
            const slot = actions[i];
            if (slot) {
                btn.textContent = slot.label;
                btn.classList.remove('hidden');
                btn.onclick = slot.onClick;
            } else {
                btn.textContent = '';
                btn.classList.add('hidden');
                btn.onclick = null;
            }
        });
        // The row itself still takes up a flex gap even with every button hidden.
        toast.querySelector('.toast-actions')?.classList.toggle('hidden', actions.length === 0);

        toastOnDismiss = opts?.onDismiss || null;

        toast.querySelector('.toast-close')?.classList.toggle('hidden', !!opts?.hideCloseButton);

        toast.classList.add('show');
        if (toastDismissTimer !== null) {window.clearTimeout(toastDismissTimer);}
        if (opts?.persistent) {
            toastDismissTimer = null;
        } else {
            toastDismissTimer = window.setTimeout(() => {
                toast!.classList.remove('show');
                toastDismissTimer = null;
                toastOnDismiss = null;
            }, actions.length ? 8000 : 6000);
        }
    }
}
