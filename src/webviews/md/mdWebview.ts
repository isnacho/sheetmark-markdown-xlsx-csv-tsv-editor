import MarkdownIt from 'markdown-it';

import { ThemeManager, renderThemeToggleSettingItem } from '../shared/themeManager';
import { SettingsManager } from '../shared/settingsManager';
import { ToolbarManager, type ToolbarButton } from '../shared/toolbarManager';
import { applyToolbarLayout } from '../shared/toolbarLayout';
import { wireDelayedToolbarTooltips } from '../shared/delayedTitleTooltip';
import { Utils } from '../shared/utils';
import { Icons } from '../shared/icons';
import { vscode, debounce } from '../shared/common';
import { FeedbackModal } from '../shared/feedbackModal';
import {
    mountLivePreview,
    isLivePreviewActive,
    getLivePreviewContent,
    setLivePreviewContent,
    setLivePreviewReadOnly,
    focusLivePreview,
    getLivePreviewScrollMetrics,
    getLivePreviewTopLine,
    scrollLivePreviewToLine,
    resolveLivePreviewInteraction,
    findLivePreviewMatches,
    setLivePreviewSearchHighlights,
    clearLivePreviewSearchHighlights,
    scrollLivePreviewToMatch,
    setLivePreviewReveal,
    setLivePreviewLineWrapping,
    setLivePreviewLineNumbers,
    setLivePreviewMermaidMode,
    setLivePreviewCalloutDefaultType,
    getLivePreviewCursorPosition,
    applyLivePreviewFormat,
    canLivePreviewUndo,
    canLivePreviewRedo,
    refreshLivePreviewImages,
    selectAllLivePreview,
} from './livePreview/livePreviewEditor';
import { setImageUriResolver } from './livePreview/imageWidget';
import { markdownBodyWithoutFrontmatter, extractFrontmatter } from './frontmatter';
import type { Cm6Match } from './livePreview/livePreviewSearch';

// ===== Throttle Utility =====
function throttleRAF(fn: () => void): () => void {
    let ticking = false;
    return () => {
        if (!ticking) {
            ticking = true;
            requestAnimationFrame(() => {
                fn();
                ticking = false;
            });
        }
    };
}

function throttleRAFEvent(fn: (event: MouseEvent) => void): (event: MouseEvent) => void {
    let ticking = false;
    let lastEvent: MouseEvent | null = null;
    return (event: MouseEvent) => {
        lastEvent = event;
        if (!ticking) {
            ticking = true;
            requestAnimationFrame(() => {
                if (lastEvent) { fn(lastEvent); }
                ticking = false;
            });
        }
    };
}

// ===== State =====
let isEditMode = false;
let isVersionPreviewMode = false;
let isSaving = false;
/** Exact text sent with the in-flight `saveMarkdown` — used to stamp `originalContent` on success. */
let pendingSaveContent: string | null = null;
let isReloadingFromDisk = false;
let pendingDiskContent: string | null = null;
// Set when the watcher reports the file was deleted externally; cleared by a
// subsequent real disk change, a manual reload, or a save that recreates the file.
let pendingDiskDeleted = false;
// Mount CM6 preview edit exactly once on the panel's first `initSettings`.
let hasEnteredPreviewEdit = false;
let originalContent = '';
let currentContent = '';
let toolbarManager: ToolbarManager | null = null;
const resolvedImageUriCache = new Map<string, string>();
// Set while a CM6 Ctrl/Cmd+Click image lightbox is waiting on an async 'resolveImageUris'
// round-trip (see handleLivePreviewModifierClick / applyResolvedImageUris).
let pendingCm6LightboxSrc: string | null = null;
let documentUri = '';
let documentDirUri = '';
let workspaceFolderUri: string | null = null;
// Persisted table column widths (table order-index -> px per column), read
// once from the host on load and kept in sync locally after every resize —
// see tableColumnWidthStorageService.ts on the host side for why this can't
// live in the .md file's own table syntax.
let currentTableColumnWidths: Record<number, readonly number[]> = {};
let frontmatterPanelCollapsed = false;
let mermaidPreviewMode: 'diagram' | 'code' = 'diagram';
let calloutDefaultType = 'info';

// Turndown removed — Preview Edit uses CM6 raw markdown only.

// Settings
let currentSettings = {
    stickyToolbar: true,
    wordWrap: true,
    showOutline: true,
    showLineNumbers: true,
    livePreviewReveal: true,
    livePreviewLineNumbers: false,
    autoSave: false,
    isDefaultEditor: true
};

/** Preview Edit gutter — single user-facing "Line Numbers" toggle (see settings panel). */
function livePreviewGutterLineNumbersEnabled(): boolean {
    return !!currentSettings.livePreviewLineNumbers;
}

let cm6SearchMatches: Cm6Match[] = [];
let searchCurrentIndex = -1;

// ===== Utilities =====
const $ = Utils.$;

function slugify(text: string) {
    return text
        .toLowerCase()
        .trim()
        .replace(/[`~!@#$%^&*()+=\[\]{}|\\;:'",.<>/?]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-');
}

function escapeHtmlAttr(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function isRemoteOrInlineUri(value: string): boolean {
    return /^(https?:|data:|mailto:|#)/i.test(value);
}

function shouldResolveLocalImage(value: string): boolean {
    const src = (value || '').trim();
    if (!src) {
        return false;
    }
    return !isRemoteOrInlineUri(src);
}

// ===== Markdown-it (TOC parse only — CM6 renders the document) =====
const md = new MarkdownIt({
    html: true,
    linkify: true,
});

function setButtonsEnabled(enabled: boolean) {
    const ids = ['openSettingsButton', 'versionHistoryButton'];
    ids.forEach((id) => {
        const el = $(id) as HTMLButtonElement;
        if (el) {el.disabled = !enabled;}
    });
    updateEditToolbarButtons();
}

function isEditorDirty(): boolean {
    return currentContent !== originalContent;
}

function canReloadFromDisk(): boolean {
    if (!isEditMode || isSaving || isReloadingFromDisk) {
        return false;
    }
    return pendingDiskContent !== null || pendingDiskDeleted || isEditorDirty();
}

function updateEditToolbarButtons() {
    if (!toolbarManager || !isEditMode) {
        return;
    }

    if (isVersionPreviewMode) {
        toolbarManager.setButtonEnabled('saveEditsButton', false);
        toolbarManager.setButtonEnabled('reloadFromDiskButton', false);
        toolbarManager.setButtonEnabled('undoEditsButton', false);
        toolbarManager.setButtonEnabled('redoEditsButton', false);
        return;
    }

    const blocked = isSaving || isReloadingFromDisk;
    const dirty = isEditorDirty();

    toolbarManager.setButtonEnabled('saveEditsButton', !blocked && dirty);
    toolbarManager.setButtonEnabled('reloadFromDiskButton', !blocked && canReloadFromDisk());
    toolbarManager.setButtonEnabled('undoEditsButton', !blocked && isLivePreviewActive() && canLivePreviewUndo());
    toolbarManager.setButtonEnabled('redoEditsButton', !blocked && isLivePreviewActive() && canLivePreviewRedo());
}


function wireImageUriResolver() {
    setImageUriResolver({
        getResolved: (src) => resolvedImageUriCache.get(src.trim()),
        requestResolve: (sources) => {
            const pending = sources
                .map(s => s.trim())
                .filter(s => s && !resolvedImageUriCache.has(s));
            if (pending.length === 0) { return; }
            vscode.postMessage({ command: 'resolveImageUris', sources: pending });
        },
        openLightbox: (src, alt) => showLightbox(src, alt),
        requestLightbox: (src, alt) => {
            pendingCm6LightboxSrc = src;
            vscode.postMessage({ command: 'resolveImageUris', sources: [src] });
            void alt;
        },
    });
}

function applyResolvedImageUris(resolved: Record<string, string>) {
    if (!resolved || typeof resolved !== 'object') {
        return;
    }

    Object.entries(resolved).forEach(([source, uri]) => {
        if (!source || !uri) {
            return;
        }
        resolvedImageUriCache.set(source, uri);
    });

    if (pendingCm6LightboxSrc && resolved[pendingCm6LightboxSrc]) {
        showLightbox(resolved[pendingCm6LightboxSrc], '');
        pendingCm6LightboxSrc = null;
    }

    refreshLivePreviewImages();
}

function addHeadingIds(tokens: any[]) {
    const slugCounts: Record<string, number> = {};
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.type === 'heading_open') {
            const inline = tokens[i + 1];
            const text = inline && inline.type === 'inline' ? normalizeHeadingText(inline.content) : '';
            const baseSlug = slugify(text);
            if (!baseSlug) {continue;}

            const count = (slugCounts[baseSlug] || 0) + 1;
            slugCounts[baseSlug] = count;
            const id = count > 1 ? `${baseSlug}-${count}` : baseSlug;
            token.attrSet('id', id);
            token.attrJoin('class', 'md-heading');
        }
    }
}

function stripHeadingCopyLinkArtifacts(text: string): string {
    if (!text) {
        return '';
    }

    return text
        .replace(/\s*\[#\]\(#[^)\s]+(?:\s+"Copy link")?\)/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeHeadingText(text: string): string {
    const stripped = stripHeadingCopyLinkArtifacts(text);
    return md.utils.unescapeAll(stripped);
}

function sanitizeMarkdownCopyLinkArtifacts(markdown: string): string {
    if (!markdown) {
        return '';
    }

    return markdown.split('\n').map((line) => {
        if (!/^\s{0,3}#{1,6}\s+/.test(line)) {
            return line;
        }
        return stripHeadingCopyLinkArtifacts(line);
    }).join('\n');
}

// id <-> CM6 line number (1-indexed), refreshed every buildToc() call.
const tocIdToLine = new Map<string, number>();
const tocLineToId = new Map<number, string>();

function buildToc(tokens: any[]) {
    tocIdToLine.clear();
    tocLineToId.clear();

    const items: Array<{ id: string; level: number; text: string }> = [];
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.type === 'heading_open') {
            const inline = tokens[i + 1];
            const text = inline && inline.type === 'inline' ? normalizeHeadingText(inline.content) : '';
            const id = token.attrGet('id');
            const level = parseInt((token.tag || 'h2').replace('h', ''), 10);
            if (id && text) {
                items.push({ id, level, text });
                if (Array.isArray(token.map)) {
                    const line = token.map[0] + 1;
                    tocIdToLine.set(id, line);
                    tocLineToId.set(line, id);
                }
            }
        }
    }

    if (!items.length) {
        return '<div class="toc-empty">No headings found</div>';
    }

    return items.map(item => {
        const safeText = md.utils.escapeHtml(item.text);
        return `<div class="toc-item toc-level-${item.level}"><a href="#${item.id}" data-target="${item.id}">${safeText}</a></div>`;
    }).join('');
}

/** Re-derive the TOC + its id<->line map from live CM6 content. */
function refreshCm6Toc(content: string) {
    const body = markdownBodyWithoutFrontmatter(content || '');
    const tokens = md.parse(sanitizeMarkdownCopyLinkArtifacts(body), {});
    addHeadingIds(tokens);
    updateToc(tokens);
}

const debouncedCm6TocRefresh = debounce((content: string) => refreshCm6Toc(content), 300);


function persistFrontmatterPanelCollapsed(collapsed: boolean) {
    frontmatterPanelCollapsed = collapsed;
    vscode.postMessage({ command: 'saveFrontmatterPanelCollapsed', collapsed });
}

function persistMermaidPreviewMode(mode: 'diagram' | 'code') {
    mermaidPreviewMode = mode;
    vscode.postMessage({ command: 'saveMermaidPreviewMode', mode });
}

function persistCalloutDefaultType(type: string) {
    calloutDefaultType = type;
    vscode.postMessage({ command: 'saveCalloutDefaultType', type });
}

function applyFrontmatterBlockToDocument(newBlock: string) {
    const extracted = extractFrontmatter(currentContent);
    if (!extracted) { return; }
    currentContent = newBlock + extracted.body;
    if (isLivePreviewActive()) {
        setLivePreviewContent(currentContent);
        refreshCm6Toc(currentContent);
    }
    updateStatusInfo();
}


function updateToc(tokens: any[]) {
    const tocBody = $('tocBody');
    if (!tocBody) {return;}
    tocBody.innerHTML = buildToc(tokens);
}

// ===== Preview Edit Mode (CM6 live preview) =====
function updateVersionPreviewChrome() {
    const hideEdit = isVersionPreviewMode;
    const saveBtn = $('saveEditsButton');
    const undoBtn = $('undoEditsButton');
    const redoBtn = $('redoEditsButton');
    const reloadBtn = $('reloadFromDiskButton');
    const fmtToolbar = $('formattingToolbar');

    const saveTarget = (saveBtn?.closest('.tooltip') as HTMLElement | null) || saveBtn;
    const undoTarget = (undoBtn?.closest('.tooltip') as HTMLElement | null) || undoBtn;
    const redoTarget = (redoBtn?.closest('.tooltip') as HTMLElement | null) || redoBtn;
    const reloadTarget = (reloadBtn?.closest('.tooltip') as HTMLElement | null) || reloadBtn;

    if (saveTarget) { saveTarget.classList.toggle('hidden', hideEdit); }
    if (undoTarget) { undoTarget.classList.toggle('hidden', hideEdit); }
    if (redoTarget) { redoTarget.classList.toggle('hidden', hideEdit); }
    if (reloadTarget) { reloadTarget.classList.toggle('hidden', hideEdit); }
    if (fmtToolbar) { fmtToolbar.classList.toggle('hidden', hideEdit); }
    updateEditToolbarButtons();
}

function enterPreviewEditMode() {
    isEditMode = true;
    document.body.classList.toggle('edit-mode', true);
    document.body.classList.toggle('preview-edit-mode', true);
    document.body.classList.toggle('cm6-preview-active', true);
    document.body.classList.toggle('cm6-word-wrap', currentSettings.wordWrap);

    const saveBtn = $('saveEditsButton');
    const undoBtn = $('undoEditsButton');
    const redoBtn = $('redoEditsButton');
    const reloadBtn = $('reloadFromDiskButton');
    const container = $('markdownContainer');
    const preview = $('markdownPreview');

    const saveTarget = (saveBtn?.closest('.tooltip') as HTMLElement | null) || saveBtn;
    const undoTarget = (undoBtn?.closest('.tooltip') as HTMLElement | null) || undoBtn;
    const redoTarget = (redoBtn?.closest('.tooltip') as HTMLElement | null) || redoBtn;
    const reloadTarget = (reloadBtn?.closest('.tooltip') as HTMLElement | null) || reloadBtn;

    if (saveTarget) {saveTarget.classList.toggle('hidden', false);}
    if (undoTarget) {undoTarget.classList.toggle('hidden', false);}
    if (redoTarget) {redoTarget.classList.toggle('hidden', false);}
    if (reloadTarget) {reloadTarget.classList.toggle('hidden', false);}

    // Show formatting toolbar in preview edit mode
    const fmtToolbar = $('formattingToolbar');
    if (fmtToolbar) {fmtToolbar.classList.toggle('hidden', false);}

    originalContent = currentContent;

    container?.classList.add('preview-edit');

    if (preview) {
        preview.contentEditable = 'false';
        mountLivePreview({
            parent: preview,
            doc: currentContent,
            lineWrapping: currentSettings.wordWrap,
            onDocChanged: (doc) => {
                if (isVersionPreviewMode) { return; }
                currentContent = doc;
                updateStatusInfo();
                debouncedCm6TocRefresh(doc);
                debouncedReapplySearch();
                scheduleAutosave();
                updateEditToolbarButtons();
            },
            onScroll: throttledScrollSpy,
            onModifierClick: handleLivePreviewModifierClick,
            reveal: currentSettings.livePreviewReveal,
            showLineNumbers: livePreviewGutterLineNumbersEnabled(),
            onSelectionChange: updateStatusInfo,
            onHistoryChange: updateEditToolbarButtons,
            columnWidths: currentTableColumnWidths,
            onColumnWidthsChanged: (widths) => {
                currentTableColumnWidths = widths;
                vscode.postMessage({ command: 'saveTableColumnWidths', widths });
            },
            frontmatterCollapsed: frontmatterPanelCollapsed,
            onFrontmatterCollapsedChanged: (collapsed) => {
                persistFrontmatterPanelCollapsed(collapsed);
            },
            mermaidPreviewMode,
            onMermaidPreviewModeChanged: (mode) => {
                persistMermaidPreviewMode(mode);
            },
            calloutDefaultType,
            onCalloutDefaultTypeChanged: (type) => {
                persistCalloutDefaultType(type);
            },
        });
        // mountLivePreview unmounts first and clears the resolver — wire after mount.
        wireImageUriResolver();
        refreshLivePreviewImages();
        refreshCm6Toc(currentContent);
        focusLivePreview();
    }

    applyToolbarLayout(toolbarManager, {
        stickyToolbar: currentSettings.stickyToolbar,
        scrollTarget: '#content'
    });
    applyFormattingToolbarLayout();
    updateHeaderHeight();
    requestAnimationFrame(() => updateHeaderHeight());
    updateEditToolbarButtons();

    updateStatusInfo();
}

// Ctrl/Cmd+Click actions inside CM6 Preview Edit.
function handleLivePreviewModifierClick(pos: number) {
    const interaction = resolveLivePreviewInteraction(pos);
    if (!interaction) {return;}

    if (interaction.kind === 'link') {
        const href = interaction.href;
        if (href.startsWith('#')) {
            const line = tocIdToLine.get(href.slice(1));
            if (line !== undefined) {scrollLivePreviewToLine(line);}
        } else if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
            vscode.postMessage({ command: 'openExternal', url: href });
        } else if (href) {
            vscode.postMessage({ command: 'openRelativeFile', href, documentUri });
        }
        return;
    }

    if (interaction.kind === 'image') {
        const src = interaction.src.trim();
        if (!src) {return;}
        if (!shouldResolveLocalImage(src)) {
            showLightbox(src, '');
            return;
        }
        const resolved = resolvedImageUriCache.get(src);
        if (resolved) {
            showLightbox(resolved, '');
        } else {
            pendingCm6LightboxSrc = src;
            vscode.postMessage({ command: 'resolveImageUris', sources: [src] });
        }
        return;
    }

    if (interaction.kind === 'heading') {
        const id = tocLineToId.get(interaction.line);
        if (id && navigator.clipboard) {
            navigator.clipboard.writeText(`#${id}`).then(() => showToast('Link copied')).catch(() => showToast('Copy failed', undefined, { icon: 'warning' }));
        }
        return;
    }

    if (interaction.kind === 'code' && navigator.clipboard) {
        navigator.clipboard.writeText(interaction.text).then(() => showToast('Copied')).catch(() => showToast('Copy failed', undefined, { icon: 'warning' }));
    }
}

// ===== Active editor content =====
// The single reader over the editing surfaces.
function getActiveEditorContent(): string {
    if (isLivePreviewActive()) {
        const cm6 = getLivePreviewContent();
        if (cm6 !== null) {
            return sanitizeMarkdownCopyLinkArtifacts(cm6);
        }
    }
    return currentContent;
}

function cancelEdit() {
    currentContent = originalContent;
    if (isLivePreviewActive()) {
        setLivePreviewContent(originalContent);
        refreshCm6Toc(originalContent);
        reapplySearch();
        updateStatusInfo();
    }
    updateEditToolbarButtons();
}

function ensureVersionPreviewBanner(): HTMLElement {
    let banner = $('versionPreviewBanner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'versionPreviewBanner';
        banner.className = 'version-preview-banner hidden';
        banner.innerHTML = `
            <span id="versionPreviewText" class="version-preview-text"></span>
            <div class="version-preview-actions">
                <button id="restoreVersionButton" class="toggle-button" type="button">Restore</button>
                <button id="cancelVersionPreviewButton" class="toggle-button" type="button">Cancel</button>
            </div>
        `;

        const target = $('content') || document.body;
        target.insertBefore(banner, target.firstChild || null);

        const restoreBtn = $('restoreVersionButton') as HTMLButtonElement | null;
        const cancelBtn = $('cancelVersionPreviewButton') as HTMLButtonElement | null;
        restoreBtn?.addEventListener('click', () => {
            vscode.postMessage({ command: 'restoreVersion' });
        });
        cancelBtn?.addEventListener('click', () => {
            vscode.postMessage({ command: 'cancelVersionPreview' });
        });
    }

    return banner;
}

function setVersionPreviewMode(enabled: boolean, label?: string) {
    isVersionPreviewMode = enabled;
    document.body.classList.toggle('version-preview-mode', enabled);
    if (enabled) {
        setLivePreviewReadOnly(true);
        updateVersionPreviewChrome();
        const banner = ensureVersionPreviewBanner();
        const text = $('versionPreviewText');
        if (text) {
            text.textContent = label || 'Previewing selected version (read-only)';
        }
        banner.classList.remove('hidden');
    } else {
        setLivePreviewReadOnly(false);
        const banner = $('versionPreviewBanner');
        if (banner) {
            banner.classList.add('hidden');
        }
        updateVersionPreviewChrome();
    }
}

function performSave(isAutosave = false) {
    if (isSaving || !isEditMode || isVersionPreviewMode) {return;}
    if (!isEditorDirty()) {return;}
    if (pendingDiskContent !== null) {
        // Autosave never interrupts with a dialog over an unresolved conflict — it
        // just skips this tick; the next edit reschedules and tries again.
        if (isAutosave) {return;}
        confirmOverwriteConflict().then((confirmed) => {
            if (!confirmed) {return;}
            pendingDiskContent = null;
            hideToast();
            doSave(false, isAutosave);
        });
        return;
    }
    doSave(false, isAutosave);
}

let lastSaveWasAutosave = false;

function doSave(force = false, isAutosave = false) {
    isSaving = true;
    lastSaveWasAutosave = isAutosave;
    setButtonsEnabled(false);
    currentContent = getActiveEditorContent();
    pendingSaveContent = currentContent;
    vscode.postMessage({ command: 'saveMarkdown', text: currentContent, force, isAutosave });
}

let autoSaveTimer: number | null = null;

function scheduleAutosave() {
    if (!currentSettings.autoSave || !isEditMode || isVersionPreviewMode) {return;}
    if (autoSaveTimer !== null) {window.clearTimeout(autoSaveTimer);}
    autoSaveTimer = window.setTimeout(() => {
        autoSaveTimer = null;
        if (!currentSettings.autoSave || !isEditMode || isSaving) {return;}
        if (getActiveEditorContent() === originalContent) {return;}
        performSave(true);
    }, 1200);
}

// Pushes freshly-read disk content into whichever surface is currently active.
function applyReloadedContent(text: string) {
    currentContent = text;
    originalContent = text;
    resolvedImageUriCache.clear();

    if (isLivePreviewActive()) {
        setLivePreviewContent(text);
        refreshLivePreviewImages();
        refreshCm6Toc(text);
        reapplySearch();
    }

    updateStatusInfo();
    updateEditToolbarButtons();
}

// VS Code webviews are sandboxed without `allow-modals` — window.confirm()/alert()/
// prompt() are silently blocked, so a real dialog is built here reusing the shared
// .feedback-overlay/.feedback-modal pattern (same one FeedbackModal uses).
function confirmModal(title: string, message: string, confirmLabel: string): Promise<boolean> {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'feedback-overlay reload-confirm-overlay';
        const modal = document.createElement('div');
        modal.className = 'feedback-modal';
        modal.innerHTML = `
            <div class="feedback-header">
                <h2>${escapeHtmlAttr(title)}</h2>
            </div>
            <div class="feedback-body" style="padding: 20px 24px 24px 24px; gap: 20px;">
                <p style="margin: 0; font-size: 13.5px; color: var(--color-text-primary); line-height: 1.5;">
                    ${escapeHtmlAttr(message)}
                </p>
                <div style="display: flex; justify-content: flex-end; gap: 8px;">
                    <button class="reload-confirm-cancel" type="button" style="background: none; border: 1px solid var(--color-border-default); border-radius: 6px; color: var(--color-text-primary); font-size: 13px; font-weight: 500; padding: 6px 14px; cursor: pointer;">Cancel</button>
                    <button class="reload-confirm-ok" type="button" style="background: var(--color-status-warning); border: none; border-radius: 6px; color: var(--color-text-on-action); font-size: 13px; font-weight: 600; padding: 6px 14px; cursor: pointer;">${escapeHtmlAttr(confirmLabel)}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        document.body.appendChild(modal);
        requestAnimationFrame(() => {
            overlay.classList.add('active');
            modal.classList.add('active');
        });

        const finish = (result: boolean) => {
            overlay.remove();
            modal.remove();
            resolve(result);
        };
        overlay.addEventListener('click', () => finish(false));
        modal.querySelector('.reload-confirm-cancel')?.addEventListener('click', () => finish(false));
        modal.querySelector('.reload-confirm-ok')?.addEventListener('click', () => finish(true));
    });
}

function confirmDiscardAndReload(): Promise<boolean> {
    return confirmModal('Reload from Disk', 'Discard unsaved changes and reload from disk?', 'Discard & Reload');
}

function confirmOverwriteConflict(): Promise<boolean> {
    return confirmModal(
        'File Changed on Disk',
        'This file changed on disk since you opened it. Overwrite it with your local changes anyway?',
        'Overwrite'
    );
}

function confirmRestoreConflict(): Promise<boolean> {
    return confirmModal(
        'File Changed on Disk',
        'This file changed on disk since you opened it. Restore the selected version anyway? Your disk changes will be lost.',
        'Restore Anyway'
    );
}

function showInitialLoadError(message: string): void {
    const loading = $('loadingIndicator');
    if (!loading) { return; }
    loading.style.display = 'flex';
    loading.style.flexDirection = 'column';
    loading.style.gap = '12px';
    loading.replaceChildren();

    const text = document.createElement('p');
    text.style.margin = '0';
    text.style.textAlign = 'center';
    text.style.maxWidth = '420px';
    text.style.lineHeight = '1.5';
    text.textContent = message;

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.textContent = 'Retry';
    retryBtn.style.cssText = 'background:var(--color-action);border:none;border-radius:6px;color:var(--color-text-on-action);font-size:13px;font-weight:600;padding:6px 14px;cursor:pointer;';
    retryBtn.addEventListener('click', () => {
        loading.textContent = 'Loading Markdown...';
        loading.style.flexDirection = '';
        loading.style.gap = '';
        vscode.postMessage({ command: 'webviewReady' });
    });

    loading.append(text, retryBtn);
}

// Manual "Reload from disk" toolbar button handler.
async function requestReloadFromDisk() {
    if (isSaving || isReloadingFromDisk || !isEditMode || !canReloadFromDisk()) {return;}
    currentContent = getActiveEditorContent();
    const dirty = currentContent !== originalContent;
    if (dirty && !(await confirmDiscardAndReload())) {
        return;
    }
    isReloadingFromDisk = true;
    setButtonsEnabled(false);
    vscode.postMessage({ command: 'requestFreshData' });
}

function applyFormat(action: string) {
    if (!isLivePreviewActive() || isVersionPreviewMode) {return;}
    applyLivePreviewFormat(action);
}

// ===== UI Helpers =====
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

function hideToast() {
    const toast = $('toastNotification');
    if (toastDismissTimer !== null) {
        window.clearTimeout(toastDismissTimer);
        toastDismissTimer = null;
    }
    toast?.classList.remove('show');
    toastOnDismiss = null;
}

function showToast(
    message: string,
    action?: { label: string; onClick: () => void },
    opts?: { persistent?: boolean; onDismiss?: () => void; icon?: 'success' | 'warning' }
) {
    let toast = $('toastNotification');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toastNotification';
        toast.className = 'toast-notification';
        toast.innerHTML = `
            <div class="toast-icon-wrapper">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></svg>
            </div>
            <span class="toast-text"></span>
            <button class="toast-action hidden" type="button"></button>
            <button class="toast-close" type="button" aria-label="Dismiss">&times;</button>
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

        const actionBtn = toast.querySelector('.toast-action') as HTMLButtonElement | null;
        if (actionBtn) {
            if (action) {
                actionBtn.textContent = action.label;
                actionBtn.classList.remove('hidden');
                actionBtn.onclick = action.onClick;
            } else {
                actionBtn.classList.add('hidden');
                actionBtn.onclick = null;
            }
        }

        toastOnDismiss = opts?.onDismiss || null;

        toast.classList.add('show');
        if (toastDismissTimer !== null) {window.clearTimeout(toastDismissTimer);}
        if (opts?.persistent) {
            toastDismissTimer = null;
        } else {
            toastDismissTimer = window.setTimeout(() => {
                toast!.classList.remove('show');
                toastDismissTimer = null;
                toastOnDismiss = null;
            }, action ? 8000 : 6000);
        }
    }
}

/** Current cursor position in CM6. null when live preview is not mounted. */
function getCurrentCursorPosition(): { line: number; col: number } | null {
    if (isLivePreviewActive()) {
        return getLivePreviewCursorPosition();
    }
    return null;
}

function updateStatusInfo() {
    const statusInfo = $('statusInfo');
    if (!statusInfo) {return;}

    const lines = currentContent.split('\n').length;
    const chars = currentContent.length;
    const words = currentContent.trim().split(/\s+/).filter(w => w).length;
    const readingTime = Math.max(1, Math.ceil(words / 200));
    const cursor = getCurrentCursorPosition();
    const cursorPrefix = cursor ? `Ln ${cursor.line}, Col ${cursor.col} \u00B7 ` : '';
    statusInfo.textContent = `${cursorPrefix}${lines} lines \u00B7 ${words} words \u00B7 ${chars} chars \u00B7 ~${readingTime} min read`;
    statusInfo.style.display = 'block';
}

// ===== Reading Progress Bar =====
function updateProgressBar() {
    const bar = $('readingProgressBar');
    if (!bar) {return;}

    const cm6Metrics = getLivePreviewScrollMetrics();
    if (!cm6Metrics) {return;}
    const usableHeight = cm6Metrics.scrollHeight - cm6Metrics.clientHeight;
    const progress = usableHeight > 0 ? (cm6Metrics.scrollTop / usableHeight) * 100 : 0;
    bar.style.width = progress + '%';
}

// ===== Scroll Spy (Active TOC Tracking) =====
function nearestTocIdForLine(line: number): string {
    let bestLine = -1;
    let id = '';
    tocLineToId.forEach((headingId, headingLine) => {
        if (headingLine <= line && headingLine > bestLine) {
            bestLine = headingLine;
            id = headingId;
        }
    });
    return id;
}

function updateScrollSpy() {
    const tocBody = $('tocBody');
    if (!tocBody || !isLivePreviewActive()) {return;}

    const topLine = getLivePreviewTopLine();
    const current = topLine !== null ? nearestTocIdForLine(topLine) : '';

    const links = tocBody.querySelectorAll('.toc-item a');
    let activeLink: HTMLElement | null = null;
    links.forEach(a => {
        const isActive = a.getAttribute('data-target') === current;
        a.classList.toggle('active', isActive);
        if (isActive) {activeLink = a as HTMLElement;}
    });

    // Auto-scroll TOC body to keep active item visible
    if (activeLink && tocBody) {
        const tocRect = tocBody.getBoundingClientRect();
        const linkRect = (activeLink as HTMLElement).getBoundingClientRect();
        const linkTop = linkRect.top - tocRect.top;
        const linkBot = linkRect.bottom - tocRect.top;
        const tocHeight = tocBody.clientHeight;

        if (linkTop < 0) {
            tocBody.scrollTop += linkTop - 16;
        } else if (linkBot > tocHeight) {
            tocBody.scrollTop += linkBot - tocHeight + 16;
        }
    }
}

const throttledScrollSpy = throttleRAF(() => {
    updateScrollSpy();
    updateProgressBar();
});

function initScrollSpy() {
    const preview = $('markdownPreview');
    if (!preview) {return;}

    preview.addEventListener('scroll', throttledScrollSpy, { passive: true });
}

// ===== Lightbox =====
function initLightbox() {
    const overlay = $('lightboxOverlay');
    const closeBtn = $('lightboxClose');
    if (!overlay) {return;}

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {closeLightbox();}
    });
    if (closeBtn) {
        closeBtn.addEventListener('click', () => closeLightbox());
    }
}

function showLightbox(src: string, alt: string) {
    const overlay = $('lightboxOverlay');
    const img = $('lightboxImage') as HTMLImageElement;
    if (!overlay || !img) {return;}
    img.src = src;
    img.alt = alt || '';
    overlay.classList.add('active');
    document.body.classList.add('lightbox-open');
}

function closeLightbox() {
    const overlay = $('lightboxOverlay');
    if (!overlay) {return;}
    overlay.classList.remove('active');
    document.body.classList.remove('lightbox-open');
}

// ===== Search in Preview =====
const debouncedSearch = debounce((query: string) => {
    doSearch(query);
}, 200);

const debouncedReapplySearch = debounce(() => {
    reapplySearch();
}, 200);

function toggleSearchOverlay() {
    const overlay = $('searchOverlay');
    if (!overlay) {return;}
    if (overlay.classList.contains('active')) {
        closeSearch();
    } else {
        openSearch();
    }
}

function openSearch() {
    const overlay = $('searchOverlay');
    const input = $('searchInput') as HTMLInputElement;
    if (!overlay) {return;}
    overlay.classList.add('active');
    if (input) {
        input.focus();
        input.select();
    }
}

function closeSearch() {
    const overlay = $('searchOverlay');
    if (!overlay) {return;}
    overlay.classList.remove('active');
    clearSearchHighlights();
    cm6SearchMatches = [];
    searchCurrentIndex = -1;
    updateSearchCount();
}

function doSearch(query: string) {
    clearSearchHighlights();
    cm6SearchMatches = [];
    searchCurrentIndex = -1;

    if (!query || query.length < 2 || !isLivePreviewActive()) {
        updateSearchCount();
        return;
    }

    cm6SearchMatches = findLivePreviewMatches(query);
    if (cm6SearchMatches.length > 0) {
        searchCurrentIndex = 0;
        highlightCurrentMatch();
    }
    updateSearchCount();
}

function clearSearchHighlights() {
    clearLivePreviewSearchHighlights();
}

function highlightCurrentMatch() {
    setLivePreviewSearchHighlights(cm6SearchMatches, searchCurrentIndex);
    const match = cm6SearchMatches[searchCurrentIndex];
    if (match) {scrollLivePreviewToMatch(match);}
}

function navigateSearch(direction: 'next' | 'prev') {
    const count = cm6SearchMatches.length;
    if (count === 0) {return;}
    if (direction === 'next') {
        searchCurrentIndex = (searchCurrentIndex + 1) % count;
    } else {
        searchCurrentIndex = (searchCurrentIndex - 1 + count) % count;
    }
    highlightCurrentMatch();
    updateSearchCount();
}

function updateSearchCount() {
    const countEl = $('searchCount');
    if (!countEl) {return;}
    const count = cm6SearchMatches.length;
    if (count === 0) {
        countEl.textContent = 'No results';
    } else {
        countEl.textContent = `${searchCurrentIndex + 1} / ${count}`;
    }
}

function reapplySearch() {
    const overlay = $('searchOverlay');
    const input = $('searchInput') as HTMLInputElement;
    if (overlay && overlay.classList.contains('active') && input && input.value.length >= 2) {
        doSearch(input.value);
    }
}

function initSearchOverlay() {
    const input = $('searchInput') as HTMLInputElement;
    const prevBtn = $('searchPrev');
    const nextBtn = $('searchNext');
    const closeBtn = $('searchClose');

    if (input) {
        input.addEventListener('input', () => {
            debouncedSearch(input.value);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                navigateSearch(e.shiftKey ? 'prev' : 'next');
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                closeSearch();
            }
        });
    }
    if (prevBtn) {prevBtn.addEventListener('click', () => navigateSearch('prev'));}
    if (nextBtn) {nextBtn.addEventListener('click', () => navigateSearch('next'));}
    if (closeBtn) {closeBtn.addEventListener('click', () => closeSearch());}

    wireDelayedToolbarTooltips($('searchOverlay') || document);
}

// ===== Settings =====
function applySettings(settings: any, persist = false) {
    if (!settings) {return;}
    currentSettings = { ...currentSettings, ...settings };

    const container = $('markdownContainer');

    // Word wrap
    if (container) {
        container.classList.toggle('word-wrap', currentSettings.wordWrap);
    }

    if (isLivePreviewActive()) {
        setLivePreviewReveal(currentSettings.livePreviewReveal);
        setLivePreviewLineWrapping(currentSettings.wordWrap);
        setLivePreviewLineNumbers(livePreviewGutterLineNumbersEnabled());
    }

    document.body.classList.toggle('cm6-word-wrap', isLivePreviewActive() && currentSettings.wordWrap);

    // Sticky toolbar
    applyToolbarLayout(toolbarManager, {
        stickyToolbar: currentSettings.stickyToolbar,
        scrollTarget: '#content'
    });

    applyFormattingToolbarLayout();
    updateHeaderHeight();

    // Update checkbox UI
    const chkWordWrap = $('chkWordWrap') as HTMLInputElement;
    const chkStickyToolbar = $('chkStickyToolbar') as HTMLInputElement;
    const chkShowOutline = $('chkShowOutline') as HTMLInputElement;
    const chkShowLineNumbers = $('chkShowLineNumbers') as HTMLInputElement;
    const chkLivePreviewReveal = $('chkLivePreviewReveal') as HTMLInputElement;
    const chkAutoSave = $('chkAutoSave') as HTMLInputElement;
    const chkOpenByDefault = $('chkOpenByDefault') as HTMLInputElement;

    if (chkWordWrap) {chkWordWrap.checked = currentSettings.wordWrap;}
    if (chkStickyToolbar) {chkStickyToolbar.checked = currentSettings.stickyToolbar;}
    if (chkShowOutline) {chkShowOutline.checked = currentSettings.showOutline;}
    if (chkShowLineNumbers) {chkShowLineNumbers.checked = livePreviewGutterLineNumbersEnabled();}
    if (chkLivePreviewReveal) {chkLivePreviewReveal.checked = currentSettings.livePreviewReveal;}
    if (chkAutoSave) {chkAutoSave.checked = currentSettings.autoSave;}
    if (chkOpenByDefault) {chkOpenByDefault.checked = !!currentSettings.isDefaultEditor;}

    // Line numbers
    document.body.classList.toggle('show-line-numbers', livePreviewGutterLineNumbersEnabled());

    const tocPanel = $('tocPanel');
    if (container) {container.classList.toggle('toc-open', !!currentSettings.showOutline);}
    if (tocPanel) {tocPanel.classList.toggle('hidden', !currentSettings.showOutline);}

    if (toolbarManager) {
        const btn = toolbarManager.getButton('toggleTocButton');
        if (btn) {btn.classList.toggle('active', !!currentSettings.showOutline);}
    }

    if (persist) {
        vscode.postMessage({ command: 'updateSettings', settings: currentSettings });
    }
}

function initializeSettings() {
    const settingsDefs = [
        {
            id: 'chkOpenByDefault',
            label: 'Open .md files with Sheetmark by default',
            tooltip: 'When enabled, VS Code opens .md files in Sheetmark automatically.',
            defaultValue: !!currentSettings.isDefaultEditor,
            onChange: (val: boolean) => {
                vscode.postMessage({ command: val ? 'enableAsDefault' : 'disableDefaultEditor' });
            }
        },
        {
            id: 'chkWordWrap',
            label: 'Word Wrap',
            tooltip: 'Wrap long lines in the Markdown preview/editor instead of horizontal scrolling.',
            defaultValue: currentSettings.wordWrap,
            onChange: (val: boolean) => {
                currentSettings.wordWrap = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkStickyToolbar',
            label: 'Sticky Toolbar',
            tooltip: 'Keep the Markdown toolbar pinned at the top while you scroll.',
            defaultValue: currentSettings.stickyToolbar,
            onChange: (val: boolean) => {
                currentSettings.stickyToolbar = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkShowOutline',
            label: 'Show Outline',
            tooltip: 'Display the document outline panel for heading navigation.',
            defaultValue: currentSettings.showOutline,
            onChange: (val: boolean) => {
                currentSettings.showOutline = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkShowLineNumbers',
            label: 'Line Numbers',
            tooltip: 'Show line numbers in the editor gutter. Click a number to select that line.',
            defaultValue: livePreviewGutterLineNumbersEnabled(),
            onChange: (val: boolean) => {
                currentSettings.livePreviewLineNumbers = val;
                currentSettings.showLineNumbers = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkLivePreviewReveal',
            label: 'Live Preview Reveal',
            tooltip: 'In Preview Edit mode, reveal raw markdown syntax (##, **, *) near the cursor and hide it elsewhere.',
            defaultValue: currentSettings.livePreviewReveal,
            onChange: (val: boolean) => {
                currentSettings.livePreviewReveal = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkAutoSave',
            label: 'Autosave',
            tooltip: 'Automatically save Markdown edits after a short debounce.',
            defaultValue: currentSettings.autoSave,
            onChange: (val: boolean) => {
                currentSettings.autoSave = val;
                applySettings(currentSettings, true);
            }
        }
    ];

    // Render panel
    SettingsManager.renderPanel(document.body, 'settingsPanel', 'settingsCancelButton', settingsDefs);

    const settingsGroup = document.querySelector('#settingsPanel .settings-group');
    if (settingsGroup) {
        settingsGroup.insertAdjacentHTML('beforeend', renderThemeToggleSettingItem('themeSelect'));
    }

    // Initialize manager
    new SettingsManager('openSettingsButton', 'settingsPanel', 'settingsCancelButton', settingsDefs);

    // Theme manager
    new ThemeManager('themeSelect', {
        onBeforeCycle: () => true
    }, vscode);
}

// ===== Header Height =====
function applyFormattingToolbarLayout() {
    const fmtToolbar = $('formattingToolbar');
    const contentArea = $('content');
    const mainToolbar = $('toolbar');
    if (!fmtToolbar || !contentArea) {return;}

    if (currentSettings.stickyToolbar) {
        const toolbarWrapper = mainToolbar?.closest('.toolbar-wrapper') as HTMLElement | null;
        const anchor = toolbarWrapper && toolbarWrapper.parentNode === document.body
            ? toolbarWrapper
            : mainToolbar;
        if (anchor?.parentNode === document.body) {
            document.body.insertBefore(fmtToolbar, anchor.nextSibling);
        } else {
            document.body.insertBefore(fmtToolbar, contentArea);
        }
        return;
    }

    if (mainToolbar && mainToolbar.parentNode === contentArea) {
        contentArea.insertBefore(fmtToolbar, mainToolbar.nextSibling);
    } else {
        contentArea.insertBefore(fmtToolbar, contentArea.firstChild);
    }
}

function syncMdHeaderHeight() {
    if (!document.body.classList.contains('sticky-toolbar-enabled')) {
        return;
    }

    const mainToolbar = $('toolbar');
    const fmtToolbar = $('formattingToolbar');
    const headerBg = document.querySelector('.header-background') as HTMLElement | null;
    const maxHeight = parseInt(
        getComputedStyle(document.documentElement).getPropertyValue('--header-height-max'),
        10
    ) || 96;

    const mainHeight = Math.min(
        maxHeight,
        Math.max(6, Math.ceil(mainToolbar?.getBoundingClientRect().height || 0))
    );
    document.documentElement.style.setProperty('--main-toolbar-height', mainHeight + 'px');

    let totalHeight = mainHeight;
    if (fmtToolbar && !fmtToolbar.classList.contains('hidden')) {
        totalHeight += Math.ceil(fmtToolbar.getBoundingClientRect().height);
    }

    document.documentElement.style.setProperty('--header-height', totalHeight + 'px');
    if (headerBg) {
        headerBg.style.height = totalHeight + 'px';
    }
}

function updateHeaderHeight() {
    if (toolbarManager) {
        toolbarManager.updateHeaderHeight();
    } else {
        syncMdHeaderHeight();
    }
}

// ===== Message Handler =====
window.addEventListener('message', (event) => {
    const m = event.data;

    switch (m.command) {
        case 'initMarkdown':
            const loading = $('loadingIndicator');
            if (loading) {loading.style.display = 'none';}

            currentContent = m.content || '';
            originalContent = currentContent;
            documentUri = m.documentUri || '';
            documentDirUri = m.documentDirUri || '';
            workspaceFolderUri = m.workspaceFolderUri || null;
            currentTableColumnWidths = m.tableColumnWidths || {};
            frontmatterPanelCollapsed = !!m.frontmatterPanelCollapsed;
            mermaidPreviewMode = m.mermaidPreviewMode === 'code' ? 'code' : 'diagram';
            calloutDefaultType = typeof m.calloutDefaultType === 'string' && /^[\w-]*$/.test(m.calloutDefaultType)
                ? m.calloutDefaultType.toLowerCase()
                : 'info';
            resolvedImageUriCache.clear();
            if (isLivePreviewActive()) {
                setLivePreviewMermaidMode(mermaidPreviewMode);
                setLivePreviewCalloutDefaultType(calloutDefaultType);
                applyReloadedContent(currentContent);
            }
            updateStatusInfo();
            updateEditToolbarButtons();
            break;

        case 'diskChangedExternally': {
            documentUri = m.documentUri || documentUri;
            documentDirUri = m.documentDirUri || documentDirUri;
            workspaceFolderUri = m.workspaceFolderUri || workspaceFolderUri;
            currentTableColumnWidths = m.tableColumnWidths || currentTableColumnWidths;
            mermaidPreviewMode = m.mermaidPreviewMode === 'code' ? 'code' : mermaidPreviewMode;
            if (typeof m.calloutDefaultType === 'string' && /^[\w-]*$/.test(m.calloutDefaultType)) {
                calloutDefaultType = m.calloutDefaultType.toLowerCase();
            }
            if (isLivePreviewActive()) {
                setLivePreviewMermaidMode(mermaidPreviewMode);
                setLivePreviewCalloutDefaultType(calloutDefaultType);
            }

            const wasManualReload = isReloadingFromDisk;
            if (isReloadingFromDisk) {
                isReloadingFromDisk = false;
                setButtonsEnabled(true);
            }

            // A real change supersedes any prior "deleted" notification.
            pendingDiskDeleted = false;

            // An explicit reload request applies directly — the persistent toast
            // below is only for unprompted watcher-detected changes.
            if (wasManualReload || !isEditMode) {
                pendingDiskContent = null;
                applyReloadedContent(m.content || '');
                showToast('Reloaded from disk');
                break;
            }

            pendingDiskContent = m.content || '';
            showToast('File changed on disk', {
                label: 'Reload',
                onClick: () => {
                    if (pendingDiskContent === null) {return;}
                    const applyPending = () => {
                        if (pendingDiskContent === null) {return;}
                        applyReloadedContent(pendingDiskContent);
                        pendingDiskContent = null;
                        showToast('Reloaded from disk');
                    };
                    const dirty = isEditMode && getActiveEditorContent() !== originalContent;
                    if (dirty) {
                        confirmDiscardAndReload().then((confirmed) => {
                            if (confirmed) {applyPending();}
                        });
                    } else {
                        applyPending();
                    }
                }
            }, { persistent: true, icon: 'warning' });
            updateEditToolbarButtons();
            break;
        }

        case 'reloadFromDiskError':
            if (isReloadingFromDisk) {
                isReloadingFromDisk = false;
                setButtonsEnabled(true);
                showToast('Error reloading from disk', undefined, { icon: 'warning' });
            } else if (!hasEnteredPreviewEdit) {
                showInitialLoadError(m.message || 'Failed to load Markdown file');
            } else {
                showToast(m.message || 'Error reloading from disk', undefined, { icon: 'warning' });
            }
            break;

        case 'diskDeletedExternally':
            pendingDiskDeleted = true;
            showToast('File deleted from disk', undefined, { persistent: true, icon: 'warning' });
            updateEditToolbarButtons();
            break;

        case 'diskMovedExternally':
            pendingDiskDeleted = false;
            if (typeof m.documentUri === 'string') {
                documentUri = m.documentUri;
            }
            if (typeof m.documentDirUri === 'string') {
                documentDirUri = m.documentDirUri;
            }
            showToast(`File moved to ${m.fileName || 'new location'}`, undefined, { persistent: true });
            updateEditToolbarButtons();
            break;

        case 'initSettings':
            applySettings(m.settings, false);
            if (!hasEnteredPreviewEdit) {
                hasEnteredPreviewEdit = true;
                enterPreviewEditMode();
            }
            break;

        case 'settingsUpdated':
            applySettings(m.settings, false);
            break;

        case 'saveResult':
            isSaving = false;
            setButtonsEnabled(true);
            if (m.ok) {
                showToast(m.isAutosave ? 'Autosaved' : 'Saved');
                if (pendingSaveContent !== null) {
                    originalContent = pendingSaveContent;
                }
                pendingSaveContent = null;
                // A successful save recreates the file if it had been deleted externally.
                pendingDiskDeleted = false;
            } else {
                pendingSaveContent = null;
                showToast(m.isAutosave ? 'Autosave failed' : 'Error saving', undefined, { icon: 'warning' });
            }
            updateEditToolbarButtons();
            break;

        case 'saveConflict':
            isSaving = false;
            pendingSaveContent = null;
            setButtonsEnabled(true);
            if (lastSaveWasAutosave) {
                // Autosave never interrupts with a dialog; the file watcher will
                // independently surface the usual "file changed on disk" toast.
                break;
            }
            confirmOverwriteConflict().then((confirmed) => {
                if (confirmed) {doSave(true);}
            });
            break;

        case 'versionHistoryError':
            showToast(m.message || 'Version history failed', undefined, { icon: 'warning' });
            break;

        case 'versionPreviewMd':
            setVersionPreviewMode(true, m.timestamp ? `Previewing ${new Date(m.timestamp).toLocaleString()} (read-only)` : 'Previewing selected version (read-only)');
            showToast('Previewing version');
            break;

        case 'versionPreviewCancelledMd':
            setVersionPreviewMode(false);
            showToast('Preview canceled');
            break;

        case 'restoreConflict':
            confirmRestoreConflict().then((confirmed) => {
                if (confirmed) {
                    vscode.postMessage({ command: 'restoreVersion', versionId: m.versionId, force: true });
                }
            });
            break;

        case 'versionRestoredMd':
            setVersionPreviewMode(false);
            showToast('Version restored');
            break;

        case 'resolvedImageUris':
            applyResolvedImageUris(m.resolved || {});
            break;
    }
});

// ===== Button Handlers =====
function wireButtons() {
    toolbarManager = new ToolbarManager('toolbar');
    toolbarManager.setHeaderHeightHook(() => syncMdHeaderHeight());

    toolbarManager.setButtons(buildToolbarButtons());
}

function copyMarkdownToClipboard() {
    if (!navigator.clipboard) {
        showToast('Copy failed', undefined, { icon: 'warning' });
        return;
    }
    navigator.clipboard.writeText(getActiveEditorContent())
        .then(() => showToast('Markdown copied'))
        .catch(() => showToast('Copy failed', undefined, { icon: 'warning' }));
}

function buildToolbarButtons(): ToolbarButton[] {
    return [
        {
            id: 'reloadFromDiskButton',
            icon: Icons.Refresh,
            tooltip: 'Reload from Disk',
            cls: 'icon-only',
            hidden: true,
            onClick: () => requestReloadFromDisk()
        },
        {
            id: 'saveEditsButton',
            icon: Icons.Save,
            tooltip: 'Save Changes (Ctrl+S)',
            cls: 'icon-only',
            hidden: true,
            onClick: () => performSave()
        },
        {
            id: 'undoEditsButton',
            icon: Icons.Undo,
            tooltip: 'Undo (Ctrl+Z)',
            cls: 'icon-only',
            hidden: true,
            onClick: () => applyFormat('undo')
        },
        {
            id: 'redoEditsButton',
            icon: Icons.Redo,
            tooltip: 'Redo (Ctrl+Shift+Z)',
            cls: 'icon-only',
            hidden: true,
            onClick: () => applyFormat('redo')
        },
        {
            id: 'toggleTocButton',
            icon: Icons.Outline,
            tooltip: 'Toggle Outline',
            cls: 'icon-only',
            section: 'end',
            onClick: () => {
                currentSettings.showOutline = !currentSettings.showOutline;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'searchButton',
            icon: Icons.Search,
            tooltip: 'Search in Preview (Ctrl/Cmd+F)',
            cls: 'icon-only',
            section: 'end',
            onClick: () => toggleSearchOverlay()
        },
        {
            id: 'copyMarkdownButton',
            icon: Icons.Copy,
            tooltip: 'Copy as Markdown',
            cls: 'icon-only',
            section: 'end',
            onClick: () => copyMarkdownToClipboard()
        },
        {
            id: 'versionHistoryButton',
            icon: Icons.VersionHistory,
            tooltip: 'Version History',
            cls: 'icon-only',
            section: 'end',
            onClick: () => {
                vscode.postMessage({ command: 'showVersionHistory' });
            }
        },
        {
            id: 'helpButton',
            icon: Icons.Help,
            tooltip: 'Help & Feedback',
            cls: 'icon-only',
            section: 'end',
            onClick: () => {
                FeedbackModal.show();
            }
        },
        {
            id: 'openSettingsButton',
            icon: Icons.Settings,
            tooltip: 'Settings',
            cls: 'icon-only',
            section: 'end',
            onClick: () => { /* Handled by wireSettingsUI */ }
        },
    ];
}

// ===== Keyboard Shortcuts =====
document.addEventListener('keydown', (e) => {
    const isCmdOrCtrl = e.ctrlKey || e.metaKey;

    if (isCmdOrCtrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (isEditMode) {
            performSave();
        }
        return;
    }

    if (isCmdOrCtrl && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleSearchOverlay();
        return;
    }

    if (isCmdOrCtrl && e.key.toLowerCase() === 'a' && isEditMode && isLivePreviewActive()) {
        const target = e.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
            return;
        }
        e.preventDefault();
        selectAllLivePreview();
        return;
    }

    if (e.key === 'Escape') {
        // Close lightbox first, then search, then edit mode
        const lightbox = $('lightboxOverlay');
        if (lightbox && lightbox.classList.contains('active')) {
            e.preventDefault();
            closeLightbox();
            return;
        }
        const searchOverlay = $('searchOverlay');
        if (searchOverlay && searchOverlay.classList.contains('active')) {
            e.preventDefault();
            closeSearch();
            return;
        }
        if (isEditMode) {
            e.preventDefault();
            cancelEdit();
            return;
        }
    }
}, true);

// ===== Resizable Panels =====
function initResizeHandles() {
    const container = $('markdownContainer');
    if (!container) {return;}

    const tocHandle = document.createElement('div');
    tocHandle.className = 'resize-handle resize-handle-toc';
    tocHandle.id = 'resizeHandleToc';

    const tocPanel = $('tocPanel');
    if (tocPanel) {tocPanel.after(tocHandle);}

    wireResizeHandle(tocHandle);
}

function wireResizeHandle(handle: HTMLElement) {
    let startX = 0;
    let startLeftWidth = 0;

    function onMouseDown(e: MouseEvent) {
        e.preventDefault();
        startX = e.clientX;

        const tocPanel = $('tocPanel');
        if (tocPanel) {startLeftWidth = tocPanel.getBoundingClientRect().width;}

        document.body.classList.add('resizing');
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    const onMouseMove = throttleRAFEvent((e: MouseEvent) => {
        const dx = e.clientX - startX;
        const container = $('markdownContainer');
        if (!container) {return;}

        const newWidth = Math.max(120, Math.min(500, startLeftWidth + dx));
        container.style.setProperty('--toc-width', newWidth + 'px');
    });

    function onMouseUp() {
        document.body.classList.remove('resizing');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }

    handle.addEventListener('mousedown', onMouseDown);
}


function wireTocPanel() {
    const tocBody = $('tocBody');
    const closeBtn = $('tocCloseButton');

    if (tocBody) {
        tocBody.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            const link = target.closest('a[data-target]') as HTMLAnchorElement | null;
            if (!link) {return;}
            e.preventDefault();
            const id = link.getAttribute('data-target') || '';
            if (!id) {return;}
            const line = tocIdToLine.get(id);
            if (line !== undefined) {scrollLivePreviewToLine(line);}
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            currentSettings.showOutline = false;
            applySettings(currentSettings, true);
        });
    }
}

// ===== Hover Tooltip =====
 
let hoverHideTimer: any = null;

function wireHoverTooltip() {
    const trigger = $('hoverPicTrigger');
    const tooltip = $('hoverTooltip');
    if (!trigger || !tooltip) {return;}

    function showTooltip() {
        if (hoverHideTimer) {
            clearTimeout(hoverHideTimer);
            hoverHideTimer = null;
        }
        const rect = trigger!.getBoundingClientRect();
        const tooltipWidth = tooltip!.offsetWidth || 300;
        const left = Math.max(8, Math.min(window.innerWidth - tooltipWidth - 8, rect.left - 100));
        const top = rect.bottom + 8;
        tooltip!.style.top = top + 'px';
        tooltip!.style.left = left + 'px';
        tooltip!.classList.remove('hidden');
        tooltip!.classList.add('visible');
    }

    function hideTooltip() {
        if (hoverHideTimer) {
            clearTimeout(hoverHideTimer);
        }
        tooltip!.classList.remove('visible');
        tooltip!.classList.add('hidden');
    }

    function hideTooltipDelayed() {
        if (hoverHideTimer) {
            clearTimeout(hoverHideTimer);
        }
        hoverHideTimer = setTimeout(() => hideTooltip(), 250);
    }

    trigger.addEventListener('mouseenter', showTooltip);
    trigger.addEventListener('mouseleave', hideTooltipDelayed);
    trigger.addEventListener('focus', showTooltip);
    trigger.addEventListener('blur', hideTooltip);

    tooltip!.addEventListener('mouseenter', () => {
        if (hoverHideTimer) {
            clearTimeout(hoverHideTimer);
            hoverHideTimer = null;
        }
    });
    tooltip!.addEventListener('mouseleave', hideTooltipDelayed);
}

// ===== Formatting Toolbar =====
const formatIconMap: Record<string, string> = {
    bold: Icons.Bold,
    italic: Icons.Italic,
    strikethrough: Icons.Strikethrough,
    inlineCode: Icons.InlineCode,
    heading1: '<span class="fmt-text-icon">H1</span>',
    heading2: '<span class="fmt-text-icon">H2</span>',
    heading3: '<span class="fmt-text-icon">H3</span>',
    bulletList: Icons.ListBullet,
    orderedList: Icons.ListOrdered,
    checkbox: Icons.Checkbox,
    blockquote: Icons.Quote,
    link: Icons.Link,
    image: Icons.Image,
    table: Icons.TableInsert,
    tableAddRowBelow: Icons.TableAddRowBelow,
    tableRemoveRow: Icons.TableRemoveRow,
    tableAddColumnRight: Icons.TableAddColumnRight,
    tableRemoveColumn: Icons.TableRemoveColumn,
    codeBlock: Icons.CodeBlock,
    hr: Icons.HorizontalRule,
    duplicateLine: Icons.DuplicateLine,
    deleteLine: Icons.DeleteLine,
    moveUp: Icons.MoveUp,
    moveDown: Icons.MoveDown,
    uppercase: '<span class="fmt-text-icon">AB</span>',
    lowercase: '<span class="fmt-text-icon">ab</span>',
    titlecase: '<span class="fmt-text-icon">Ab</span>',
    sortLines: Icons.SortLines,
    trimWhitespace: Icons.Trim,
    jumpToLine: Icons.GoToLine,
};

function wireFormattingToolbar() {
    const fmtToolbar = $('formattingToolbar');
    if (!fmtToolbar) {return;}

    const buttons = fmtToolbar.querySelectorAll('.fmt-btn');
    buttons.forEach(btn => {
        const format = btn.getAttribute('data-format');
        if (!format) {return;}

        // Set icon
        const icon = formatIconMap[format];
        if (icon) {btn.innerHTML = icon;}

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            applyFormat(format);
        });
    });
}

// ===== Initialize =====
wireButtons();
initializeSettings();
wireFormattingToolbar();
wireDelayedToolbarTooltips();
wireHoverTooltip();
wireTocPanel();
initLightbox();
initSearchOverlay();
initScrollSpy();
initResizeHandles();
updateHeaderHeight();

// Ensure settings are applied once toolbar is ready
if (currentSettings) {
    applySettings(currentSettings);
}

vscode.postMessage({ command: 'webviewReady' });
