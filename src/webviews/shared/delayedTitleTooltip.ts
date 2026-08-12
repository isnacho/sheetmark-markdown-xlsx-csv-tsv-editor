export const DELAYED_TITLE_ATTR = 'data-delayed-title';
export const DELAYED_TITLE_DELAY_MS = 500;

let floatingTipEl: HTMLElement | null = null;
let floatingTipAnchor: HTMLElement | null = null;

export function plainTooltipText(html: string): string {
    const div = document.createElement('div');
    div.innerHTML = html;
    return (div.textContent || '').replace(/\s+/g, ' ').trim();
}

export function isIconOnlyControl(element: HTMLElement): boolean {
    if (element.classList.contains('fmt-btn')) {
        return true;
    }
    if (element.classList.contains('search-nav-btn') || element.classList.contains('search-close-btn')) {
        return true;
    }
    if (element.classList.contains('theme-toggle-pill')) {
        return true;
    }
    if (element.classList.contains('icon-only')) {
        return true;
    }

    if (element.tagName !== 'BUTTON') {
        return false;
    }

    if (element.querySelector('.btn-label')) {
        return false;
    }

    const clone = element.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('svg').forEach((node) => node.remove());
    const visibleText = (clone.textContent || '').trim();
    return visibleText.length === 0;
}

function ensureFloatingTooltip(): HTMLElement {
    if (!floatingTipEl) {
        floatingTipEl = document.createElement('div');
        floatingTipEl.className = 'global-tooltip toolbar-floating-tooltip';
        floatingTipEl.setAttribute('role', 'tooltip');
        floatingTipEl.style.position = 'fixed';
        floatingTipEl.style.opacity = '0';
        floatingTipEl.style.visibility = 'hidden';
        floatingTipEl.style.pointerEvents = 'none';
        document.body.appendChild(floatingTipEl);

        window.addEventListener('scroll', hideFloatingTooltip, true);
    }
    return floatingTipEl;
}

function positionFloatingTooltip(anchor: HTMLElement): void {
    const tip = ensureFloatingTooltip();
    const rect = anchor.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();

    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    let top = rect.bottom + 6;

    left = Math.max(8, Math.min(window.innerWidth - tipRect.width - 8, left));
    if (top + tipRect.height > window.innerHeight - 8) {
        top = Math.max(8, rect.top - tipRect.height - 6);
    }

    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
}

function showFloatingTooltip(anchor: HTMLElement, text: string): void {
    const tip = ensureFloatingTooltip();
    tip.textContent = text;
    floatingTipAnchor = anchor;
    tip.style.visibility = 'visible';
    tip.style.opacity = '1';
    requestAnimationFrame(() => {
        if (floatingTipAnchor === anchor) {
            positionFloatingTooltip(anchor);
        }
    });
}

export function hideFloatingTooltip(): void {
    if (floatingTipEl) {
        floatingTipEl.style.opacity = '0';
        floatingTipEl.style.visibility = 'hidden';
        floatingTipEl.textContent = '';
    }
    floatingTipAnchor = null;
}

export function applyDelayedTitle(element: HTMLElement, text?: string): void {
    const raw = text ?? element.getAttribute('title') ?? element.getAttribute(DELAYED_TITLE_ATTR) ?? '';
    const plain = plainTooltipText(raw);
    if (!plain) {
        return;
    }

    element.setAttribute(DELAYED_TITLE_ATTR, plain);
    element.setAttribute('aria-label', plain);
    element.removeAttribute('title');

    if (element.dataset.delayedTitleWired === '1') {
        return;
    }
    element.dataset.delayedTitleWired = '1';

    let showTimer: ReturnType<typeof setTimeout> | null = null;

    const clearShowTimer = () => {
        if (showTimer) {
            clearTimeout(showTimer);
            showTimer = null;
        }
    };

    const hideForElement = () => {
        clearShowTimer();
        if (floatingTipAnchor === element) {
            hideFloatingTooltip();
        }
    };

    element.addEventListener('mouseenter', () => {
        clearShowTimer();
        const tip = element.getAttribute(DELAYED_TITLE_ATTR);
        if (!tip) {
            return;
        }
        if (floatingTipAnchor && floatingTipAnchor !== element) {
            hideFloatingTooltip();
        }
        showTimer = setTimeout(() => {
            showFloatingTooltip(element, tip);
            showTimer = null;
        }, DELAYED_TITLE_DELAY_MS);
    });

    element.addEventListener('mouseleave', hideForElement);
    element.addEventListener('mousedown', hideForElement);
}

export function setDelayedTitleText(element: HTMLElement, text: string): void {
    const plain = plainTooltipText(text);
    if (!plain) {
        element.removeAttribute(DELAYED_TITLE_ATTR);
        element.removeAttribute('aria-label');
        element.removeAttribute('title');
        return;
    }
    applyDelayedTitle(element, plain);
}

const TOOLBAR_TOOLTIP_SELECTORS = [
    '#toolbar button',
    '#formattingToolbar .fmt-btn',
    '.xlsx-edit-strip button.icon-only',
    '.search-nav-btn',
    '.search-close-btn',
    '#toggleBackgroundButton',
];

export function wireDelayedToolbarTooltips(root: ParentNode = document): void {
    const seen = new WeakSet<HTMLElement>();

    for (const selector of TOOLBAR_TOOLTIP_SELECTORS) {
        root.querySelectorAll<HTMLElement>(selector).forEach((element) => {
            if (seen.has(element) || !isIconOnlyControl(element)) {
                return;
            }
            seen.add(element);
            applyDelayedTitle(element);
        });
    }
}
