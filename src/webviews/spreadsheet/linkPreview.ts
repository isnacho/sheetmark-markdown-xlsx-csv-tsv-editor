// Hyperlink tooltip (Open in Browser / Copy Link) shown when hovering a linked cell, and the
// full-size image preview overlay for cell images. Runtime: WEBVIEW (browser).

import { state } from './state';
import { post } from './messaging';
import { writeToClipboardAsync } from './components/spreadsheetCopyComponent';
import { Utils } from '../shared/utils';

const showToast = Utils.showToast;

export function ensureLinkTooltip(): HTMLElement {
    if (state.linkTooltip) {return state.linkTooltip;}
    state.linkTooltip = document.createElement('div');
    state.linkTooltip.id = 'linkTooltip';
    state.linkTooltip.className = 'link-tooltip hidden';
    state.linkTooltip.innerHTML = `
        <div class="link-tooltip-url" id="linkTooltipUrl"></div>
        <div class="link-tooltip-actions">
            <button type="button" id="linkTooltipOpen" class="toggle-button">Open in Browser</button>
            <button type="button" id="linkTooltipCopy" class="toggle-button">Copy Link</button>
        </div>
    `;

    state.linkTooltip.addEventListener('mouseenter', () => {
        if (state.linkTooltipHideTimer) {
            clearTimeout(state.linkTooltipHideTimer);
            state.linkTooltipHideTimer = null;
        }
    });

    state.linkTooltip.addEventListener('mouseleave', () => {
        scheduleHideLinkTooltip();
    });

    document.body.appendChild(state.linkTooltip);
    return state.linkTooltip;
}

export function showLinkTooltipForCell(cellEl: HTMLElement | null) {
    if (!state.currentSettings.hyperlinkPreview) {return;}
    if (!cellEl) {return;}
    const url = cellEl.getAttribute('data-hyperlink') || '';
    if (!url) {return;}

    const tt = ensureLinkTooltip();
    const urlEl = tt.querySelector('#linkTooltipUrl');
    if (urlEl) {urlEl.textContent = url;}

    const openBtn = tt.querySelector('#linkTooltipOpen') as HTMLElement;
    const copyBtn = tt.querySelector('#linkTooltipCopy') as HTMLElement;

    if (openBtn) {
        openBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            post({ command: 'openExternal', url });
            hideLinkTooltip();
        };
    }
    if (copyBtn) {
        copyBtn.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
                await writeToClipboardAsync(url);
                showToast('Copied URL');
                hideLinkTooltip();
            } catch {
                // ignore
            }
        };
    }

    tt.classList.remove('hidden');

    const rect = cellEl.getBoundingClientRect();
    // Measure after showing
    const ttRect = tt.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - ttRect.width - 8);
    const top = Math.min(rect.bottom, window.innerHeight - ttRect.height - 2);
    tt.style.left = left + 'px';
    tt.style.top = top + 'px';
}

export function hideLinkTooltip() {
    if (!state.linkTooltip) {return;}
    state.linkTooltip.classList.add('hidden');
    state.linkTooltip.style.left = '';
    state.linkTooltip.style.top = '';
}

export function scheduleHideLinkTooltip() {
    if (state.linkTooltipHideTimer) {clearTimeout(state.linkTooltipHideTimer);}
    state.linkTooltipHideTimer = setTimeout(() => {
        hideLinkTooltip();
        state.linkTooltipHideTimer = null;
    }, 120);
}

export function ensureImagePreviewOverlay(): HTMLElement {
    if (state.imagePreviewOverlayEl) {return state.imagePreviewOverlayEl;}

    const overlay = document.createElement('div');
    overlay.id = 'xlsxImagePreviewOverlay';
    overlay.className = 'xlsx-image-preview-overlay hidden';
    overlay.innerHTML = `
        <div class="xlsx-image-preview-dialog" role="dialog" aria-modal="true" aria-label="Image preview">
            <button type="button" id="xlsxImagePreviewClose" class="xlsx-image-preview-close" aria-label="Close image preview">Close</button>
            <img id="xlsxImagePreviewImg" class="xlsx-image-preview-image" alt="XLSX cell image preview" />
        </div>
    `;

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            hideImagePreview();
        }
    });

    const closeBtn = overlay.querySelector('#xlsxImagePreviewClose') as HTMLButtonElement | null;
    closeBtn?.addEventListener('click', () => hideImagePreview());

    document.body.appendChild(overlay);
    state.imagePreviewOverlayEl = overlay;
    return overlay;
}

export function showImagePreview(src: string) {
    if (!src) {return;}
    const overlay = ensureImagePreviewOverlay();
    const img = overlay.querySelector('#xlsxImagePreviewImg') as HTMLImageElement | null;
    if (!img) {return;}

    img.src = src;
    overlay.classList.remove('hidden');
    document.body.classList.add('image-preview-open');
}

export function hideImagePreview() {
    if (!state.imagePreviewOverlayEl) {return;}
    const img = state.imagePreviewOverlayEl.querySelector('#xlsxImagePreviewImg') as HTMLImageElement | null;
    if (img) {
        img.removeAttribute('src');
    }
    state.imagePreviewOverlayEl.classList.add('hidden');
    document.body.classList.remove('image-preview-open');
}

export function initializeHyperlinkHover() {
    const table = document.querySelector('table');
    if (!table) {return;}

    table.addEventListener('mouseover', (e) => {
        if (state.isEditMode) {return;}
        const t = e && (e.target as HTMLElement);
        const el = t && t.nodeType === 3 ? t.parentElement : t;
        const cell = el && el.closest ? el.closest('td[data-hyperlink]') : null;
        if (!cell) {return;}
        if (state.linkTooltipHideTimer) {
            clearTimeout(state.linkTooltipHideTimer);
            state.linkTooltipHideTimer = null;
        }
        showLinkTooltipForCell(cell as HTMLElement);
    });

    table.addEventListener('mouseout', (e) => {
        if (state.isEditMode) {return;}
        const toEl = e.relatedTarget as HTMLElement;
        if (!toEl) {
            scheduleHideLinkTooltip();
            return;
        }

        // If we are moving to an element inside the same cell, don't hide
        const fromCell = (e.target as HTMLElement).closest('td[data-hyperlink]');
        const toCell = toEl.closest ? toEl.closest('td[data-hyperlink]') : null;
        if (fromCell && toCell === fromCell) {
            return;
        }

        // If we are moving to the tooltip itself, don't hide
        if (state.linkTooltip && state.linkTooltip.contains(toEl)) {
            return;
        }

        scheduleHideLinkTooltip();
    });
}
