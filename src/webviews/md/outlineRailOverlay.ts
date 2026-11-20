// Viewport-fixed outline line rail (sibling overlay on the preview pane, not CM6 document flow).
// Runtime: WEBVIEW (browser).

import { Icons } from '../shared/icons';
import type { TocItem } from './outlineToc';
import { renderRailLinesHtml, renderTocListHtml } from './outlineToc';

export interface OutlineRailState {
    items: readonly TocItem[];
    activeId: string;
    enabled: boolean;
}

let onPin: (() => void) | undefined;
let onNavigate: ((id: string) => void) | undefined;

let wiredHost: HTMLElement | null = null;
let linesEl: HTMLElement | null = null;
let popoverEl: HTMLElement | null = null;
let popoverBodyEl: HTMLElement | null = null;
let stopTopSync: (() => void) | null = null;

/** Gap between the bottom of whatever toolbar is on screen and the rail. */
const RAIL_TOOLBAR_GAP_PX = 10;

/**
 * Where the rail starts: just under the lowest toolbar bottom that is on screen (the toolbar in the
 * page at the top of the document, part of it while it scrolls away, or the revealed toolbar), or at
 * the gap from the window top when no toolbar shows. Pure, for the unit test.
 */
export function outlineRailTop(toolbarBottoms: readonly number[], gap = RAIL_TOOLBAR_GAP_PX): number {
    return Math.max(0, ...toolbarBottoms) + gap;
}

/**
 * Non-sticky toolbar only (the rail is fixed to the window there; with a sticky toolbar it sits in
 * the editor area, already below the toolbar). Keeps `--outline-rail-top` on the rail in step with the
 * toolbars: on scroll and resize, and every frame for a moment after the reveal state changes, so the
 * rail moves with the toolbar's slide instead of being covered by it.
 */
function startRailTopSync(widget: HTMLElement): () => void {
    const sync = () => {
        if (document.body.classList.contains('sticky-toolbar-enabled')) {
            widget.style.removeProperty('--outline-rail-top');
            return;
        }
        const bottoms: number[] = [];
        for (const id of ['toolbar', 'formattingToolbar']) {
            const el = document.getElementById(id);
            if (!el || getComputedStyle(el).display === 'none') { continue; }
            bottoms.push(el.getBoundingClientRect().bottom);
        }
        widget.style.setProperty('--outline-rail-top', `${outlineRailTop(bottoms)}px`);
    };
    let frameUntil = 0;
    let frame = 0;
    const followForAMoment = () => {
        frameUntil = performance.now() + 300;
        if (frame) { return; }
        const tick = () => {
            sync();
            frame = performance.now() < frameUntil ? requestAnimationFrame(tick) : 0;
        };
        frame = requestAnimationFrame(tick);
    };
    const scroller = document.getElementById('content');
    scroller?.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    const classes = new MutationObserver(followForAMoment);
    classes.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    const sizes = new ResizeObserver(sync);
    for (const id of ['toolbar', 'formattingToolbar']) {
        const el = document.getElementById(id);
        if (el) { sizes.observe(el); }
    }
    sync();
    return () => {
        scroller?.removeEventListener('scroll', sync);
        window.removeEventListener('resize', sync);
        classes.disconnect();
        sizes.disconnect();
        if (frame) { cancelAnimationFrame(frame); }
    };
}

export function setOutlineRailPinHandler(handler: (() => void) | undefined): void {
    onPin = handler;
}

export function setOutlineRailNavigateHandler(handler: ((id: string) => void) | undefined): void {
    onNavigate = handler;
}

function wireOutlineRailHost(host: HTMLElement) {
    if (wiredHost === host) { return; }
    wiredHost = host;
    host.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'outline-rail-widget';
    root.setAttribute('aria-label', 'Document outline');

    const lines = document.createElement('div');
    lines.className = 'outline-rail-lines';
    linesEl = lines;

    const popover = document.createElement('div');
    popover.className = 'outline-rail-popover hidden';
    popover.setAttribute('role', 'navigation');
    popoverEl = popover;

    const header = document.createElement('div');
    header.className = 'outline-rail-popover-header';
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'outline-rail-pin';
    pin.title = 'Pin outline panel';
    pin.setAttribute('aria-label', 'Pin outline panel');
    pin.innerHTML = Icons.Expand;
    pin.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        popover.classList.add('hidden');
        onPin?.();
    });
    header.appendChild(pin);

    const body = document.createElement('div');
    body.className = 'toc-body outline-rail-popover-body';
    popoverBodyEl = body;
    popover.append(header, body);

    let hideTimer: ReturnType<typeof setTimeout> | undefined;

    const applyPopoverMaxHeight = () => {
        if (!popoverEl) { return; }
        const margin = 8;
        const top = popoverEl.getBoundingClientRect().top;
        const avail = window.innerHeight - top - margin;
        popoverEl.style.setProperty('--outline-rail-popover-max-h', `${Math.max(120, avail)}px`);
    };

    const showPopover = () => {
        if (!linesEl || !popoverEl) { return; }
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = undefined;
        }
        const rect = linesEl.getBoundingClientRect();
        popoverEl.classList.remove('hidden');
        popoverEl.style.position = 'fixed';
        const margin = 8;
        let left = rect.right + margin;
        let top = rect.top;
        popoverEl.style.left = `${left}px`;
        popoverEl.style.top = `${top}px`;
        applyPopoverMaxHeight();
        requestAnimationFrame(() => {
            if (!popoverEl) { return; }
            const popRect = popoverEl.getBoundingClientRect();
            if (popRect.right > window.innerWidth - margin) {
                left = Math.max(margin, rect.left - popRect.width - margin);
                popoverEl.style.left = `${left}px`;
            }
            if (popRect.bottom > window.innerHeight - margin) {
                top = Math.max(margin, window.innerHeight - margin - popRect.height);
                popoverEl.style.top = `${top}px`;
            }
            applyPopoverMaxHeight();
        });
    };

    const scheduleHide = () => {
        if (hideTimer) { clearTimeout(hideTimer); }
        hideTimer = setTimeout(() => {
            popoverEl?.classList.add('hidden');
            hideTimer = undefined;
        }, 120);
    };

    const cancelHide = () => {
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = undefined;
        }
    };

    lines.addEventListener('mouseenter', () => {
        cancelHide();
        showPopover();
    });
    lines.addEventListener('mouseleave', scheduleHide);
    popover.addEventListener('mouseenter', cancelHide);
    popover.addEventListener('mouseleave', scheduleHide);

    popover.addEventListener('click', (event) => {
        const target = event.target as HTMLElement;
        if (target.closest('.outline-rail-pin')) { return; }
        const link = target.closest('a[data-target]') as HTMLAnchorElement | null;
        if (!link) { return; }
        event.preventDefault();
        const id = link.getAttribute('data-target') || '';
        if (id) { onNavigate?.(id); }
        popover.classList.add('hidden');
    });

    root.append(lines, popover);
    host.appendChild(root);
    stopTopSync?.();
    stopTopSync = startRailTopSync(root);
}

export function syncOutlineRailOverlay(rail: OutlineRailState): void {
    const host = document.getElementById('outlineRailHost');
    if (!host) { return; }

    if (!rail.enabled || !rail.items.length) {
        host.classList.add('hidden');
        host.setAttribute('aria-hidden', 'true');
        return;
    }

    host.classList.remove('hidden');
    host.setAttribute('aria-hidden', 'false');
    wireOutlineRailHost(host);
    if (linesEl) { linesEl.innerHTML = renderRailLinesHtml(rail.items, rail.activeId); }
    if (popoverBodyEl) { popoverBodyEl.innerHTML = renderTocListHtml(rail.items); }
}

export function teardownOutlineRailOverlay(): void {
    stopTopSync?.();
    stopTopSync = null;
    wiredHost = null;
    linesEl = null;
    popoverEl = null;
    popoverBodyEl = null;
    const host = document.getElementById('outlineRailHost');
    if (host) {
        host.innerHTML = '';
        host.classList.add('hidden');
        host.setAttribute('aria-hidden', 'true');
    }
}
