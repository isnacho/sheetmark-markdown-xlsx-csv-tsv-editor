// Keyboard and focus behaviour for popups (menus and dialogs). Runtime: WEBVIEW (browser).
//
// Follows the WAI-ARIA menu and dialog patterns (the ones Radix / shadcn implement): focus moves
// into a popup when it opens, arrow keys move between menu items, Escape closes, Tab stays inside a
// modal dialog, and focus goes back to where it was when the popup closes.

/** The item a menu key moves to, wrapping at both ends. `null` when the key is not a menu key. */
export function nextMenuIndex(current: number, count: number, key: string): number | null {
    if (count <= 0) { return null; }
    switch (key) {
        case 'ArrowDown': return current < 0 ? 0 : (current + 1) % count;
        case 'ArrowUp': return current < 0 ? count - 1 : (current - 1 + count) % count;
        case 'Home': return 0;
        case 'End': return count - 1;
        default: return null;
    }
}

/** Where Tab should move inside a modal dialog: `'first'`/`'last'` to wrap, `null` to let the browser move. */
export function tabWrapTarget(index: number, count: number, shiftKey: boolean): 'first' | 'last' | null {
    if (count === 0) { return null; }
    if (shiftKey) { return index <= 0 ? 'last' : null; }
    return index === -1 || index >= count - 1 ? 'first' : null;
}

const FOCUSABLE = [
    'button:not([disabled])',
    'a[href]',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Controls inside `root` that Tab can reach, in document order. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => !el.closest('.hidden') && el.getClientRects().length > 0);
}

/** Remembers what has focus now; the returned function sends focus back there if it can still take it. */
export function captureFocus(): () => void {
    const previous = document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
    return () => {
        if (previous && previous.isConnected && previous.getClientRects().length > 0) {
            previous.focus({ preventScroll: true });
        }
    };
}

/** True when `target` is inside an open menu or dialog (keys there belong to the popup, not the page). */
export function isInsidePopup(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest('[role="menu"], [role="dialog"]') !== null;
}

function hasCommandModifier(event: KeyboardEvent): boolean {
    return event.metaKey || event.ctrlKey || event.altKey;
}

function isTextField(el: Element | null): boolean {
    return !!el && el.matches('input, textarea, select, [contenteditable="true"]');
}

/**
 * Menu keyboard support for a singleton menu element that is rebuilt on each open.
 * Construct once; call `opened()` after the items are built and shown, and `closed()` from the
 * menu's hide function. `itemSelector` picks the rows that are menu items (other controls inside,
 * such as a filter field, keep their normal keys).
 */
export class MenuKeyboard {
    private restoreFocus: (() => void) | null = null;

    constructor(
        private readonly menu: HTMLElement,
        private readonly itemSelector: string,
        private readonly requestClose: () => void,
    ) {
        menu.setAttribute('role', 'menu');
        menu.tabIndex = -1;
        menu.addEventListener('keydown', this.onKeyDown);
    }

    /** Marks up the items and moves focus in: to the first item when opened from the keyboard, else to the menu. */
    opened(options: { focusFirstItem?: boolean } = {}): void {
        this.menu.querySelectorAll<HTMLElement>(this.itemSelector).forEach((item) => {
            if (!item.hasAttribute('role')) { item.setAttribute('role', 'menuitem'); }
        });
        this.menu.querySelectorAll<HTMLElement>('[class*="separator"]').forEach((sep) => sep.setAttribute('role', 'separator'));
        if (!this.restoreFocus) { this.restoreFocus = captureFocus(); }
        const first = this.items()[0];
        (options.focusFirstItem && first ? first : this.menu).focus({ preventScroll: true });
    }

    /**
     * Sends focus back to where it was before the menu opened, unless the user has already put it
     * somewhere else (clicked into the page). Safe to call when the menu is not open.
     */
    closed(): void {
        const restore = this.restoreFocus;
        this.restoreFocus = null;
        if (!restore) { return; }
        const active = document.activeElement;
        if (!active || active === document.body || this.menu.contains(active)) { restore(); }
    }

    private items(): HTMLElement[] {
        return Array.from(this.menu.querySelectorAll<HTMLElement>(this.itemSelector))
            .filter((item) => !(item as HTMLButtonElement).disabled && item.getClientRects().length > 0);
    }

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        if (hasCommandModifier(event)) { return; }
        const target = event.target as Element | null;
        if (event.key === 'Escape') {
            event.preventDefault();
            this.requestClose();
        } else if (event.key === 'Tab') {
            // Tab leaves a menu (WAI-ARIA), except between the fields of a form inside it.
            if (isTextField(target)) { return; }
            event.preventDefault();
            this.requestClose();
        } else if (!isTextField(target)) {
            const items = this.items();
            const next = nextMenuIndex(items.indexOf(target as HTMLElement), items.length, event.key);
            if (next === null) {
                // Enter/Space activate the focused button natively; keep them from the page's own shortcuts.
                if (event.key !== 'Enter' && event.key !== ' ') { return; }
            } else {
                event.preventDefault();
                items[next].focus({ preventScroll: true });
            }
        }
        // Keys handled here must not reach document-level shortcuts (grid arrows, cell editing).
        event.stopPropagation();
    };
}

/**
 * Dialog keyboard support. `modal` dialogs keep Tab inside; non-modal panels close when focus
 * leaves them. Call `opened()` once the dialog is visible and `closed()` when it hides.
 */
export class DialogKeyboard {
    private restoreFocus: (() => void) | null = null;

    constructor(
        private readonly dialog: HTMLElement,
        private readonly options: { modal: boolean; labelledBy?: string; requestClose: () => void },
    ) {
        dialog.setAttribute('role', 'dialog');
        if (options.modal) { dialog.setAttribute('aria-modal', 'true'); }
        if (options.labelledBy) { dialog.setAttribute('aria-labelledby', options.labelledBy); }
        dialog.tabIndex = -1;
        dialog.addEventListener('keydown', this.onKeyDown);
    }

    /**
     * Moves focus to the dialog itself rather than a button, so a keystroke meant for the page
     * behind cannot press one by accident. Tab then reaches the first control.
     */
    opened(): void {
        if (!this.restoreFocus) { this.restoreFocus = captureFocus(); }
        this.dialog.focus({ preventScroll: true });
    }

    /** `restore: false` when the user closed it by clicking elsewhere: focus stays where they clicked. */
    closed(options: { restore?: boolean } = {}): void {
        const restore = this.restoreFocus;
        this.restoreFocus = null;
        if (restore && options.restore !== false) { restore(); }
    }

    private readonly onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape' && !hasCommandModifier(event)) {
            event.preventDefault();
            event.stopPropagation();
            this.options.requestClose();
            return;
        }
        if (event.key !== 'Tab' || !this.options.modal) { return; }
        const controls = focusableIn(this.dialog);
        const wrap = tabWrapTarget(controls.indexOf(document.activeElement as HTMLElement), controls.length, event.shiftKey);
        if (controls.length === 0) {
            event.preventDefault();
        } else if (wrap) {
            event.preventDefault();
            controls[wrap === 'first' ? 0 : controls.length - 1].focus();
        }
    };
}
