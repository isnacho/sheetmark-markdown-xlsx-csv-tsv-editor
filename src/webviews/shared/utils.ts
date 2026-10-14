
export class Utils {
    private static toastHideTimer: ReturnType<typeof setTimeout> | null = null;

    static $(id: string): HTMLElement | null {
        return document.getElementById(id);
    }

    /** Escape for HTML text and quoted attribute values. */
    static escapeHtml(text: string): string {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    static showToast(message: string, isAutosave = false, durationMs?: number) {
        let toast = document.getElementById('saveToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'saveToast';
            toast.className = 'toast-notification';
            toast.innerHTML = `
                <div class="toast-icon-wrapper">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                </div>
                <span class="toast-text"></span>
            `;
            document.body.appendChild(toast);
        }
        
        const textSpan = toast.querySelector('.toast-text');
        if (textSpan) {textSpan.textContent = message;}
        
        if (isAutosave) {
            toast.classList.add('autosave-toast');
        } else {
            toast.classList.remove('autosave-toast');
        }
        
        toast.classList.add('show');
        if (Utils.toastHideTimer) {
            clearTimeout(Utils.toastHideTimer);
        }
        Utils.toastHideTimer = setTimeout(() => {
            toast?.classList.remove('show');
            Utils.toastHideTimer = null;
        }, typeof durationMs === 'number' ? durationMs : (isAutosave ? 1000 : 3000));
    }

}
