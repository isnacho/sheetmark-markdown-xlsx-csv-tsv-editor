
import { showToast } from './toast';

export class Utils {
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

    /**
     * Short confirmation toast (the shared toast in `./toast.ts`). `isAutosave` makes it brief (1 s),
     * the default is 3 s; `durationMs` overrides both.
     */
    static showToast(message: string, isAutosave = false, durationMs?: number) {
        showToast(message, undefined, { durationMs: typeof durationMs === 'number' ? durationMs : (isAutosave ? 1000 : 3000) });
    }

}
