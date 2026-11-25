// The single toast both webviews share (bottom-center): message, up to three action buttons,
// optional persistence. Styles: `.toast-*` in resources/shared/theme.css. Runtime: WEBVIEW (browser).
// Does not import `Utils` (which wraps this for the spreadsheet), so there is no import cycle.

const $ = (id: string): HTMLElement | null => document.getElementById(id);

let toastDismissTimer: number | null = null;
let toastOnDismiss: (() => void) | null = null;

type ToastOptions = { persistent?: boolean; onDismiss?: () => void; icon?: 'success' | 'warning'; hideCloseButton?: boolean; durationMs?: number };

// The persistent toast that is waiting for the user ("File changed on disk", a notice with buttons).
// There is one toast element, so a short toast ("Saved", "Copied") shown meanwhile takes its place;
// when that one expires the persistent toast comes back. Only hideToast(), the close button, or a
// newer persistent toast clears it.
let persistentToast: { message: string; action: ToastAction | ToastAction[] | undefined; opts: ToastOptions } | null = null;

// Same outline/gray style for both — only the shape differs. Success: plain
// checkmark for positive acknowledgements (Saved, Copied, Reloaded, ...).
// Warning: caution triangle for anything the user should pay attention to
// (disk conflicts/deletions, failures).
const TOAST_ICON_SUCCESS = '<polyline points="20 6 9 17 4 12"></polyline>';
const TOAST_ICON_WARNING = '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>'
    + '<line x1="12" y1="9" x2="12" y2="13"></line>'
    + '<line x1="12" y1="17" x2="12.01" y2="17"></line>';

export function hideToast() {
    persistentToast = null;
    const toast = $('toastNotification');
    if (toastDismissTimer !== null) {
        window.clearTimeout(toastDismissTimer);
        toastDismissTimer = null;
    }
    toast?.classList.remove('show');
    toastOnDismiss = null;
}

/** The thing the persistent toast was about is resolved: do not bring it back, without touching the toast on screen. */
export function forgetPersistentToast() {
    persistentToast = null;
}

export interface ToastAction {
    label: string;
    onClick: () => void;
}

export function showToast(
    message: string,
    action?: ToastAction | ToastAction[],
    opts?: ToastOptions
) {
    if (opts?.persistent) {
        persistentToast = { message, action, opts };
    }
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
                // A persistent toast was waiting behind this one: bring it back.
                if (persistentToast) {
                    showToast(persistentToast.message, persistentToast.action, persistentToast.opts);
                }
            }, opts?.durationMs ?? (actions.length ? 8000 : 6000));
        }
    }
}
