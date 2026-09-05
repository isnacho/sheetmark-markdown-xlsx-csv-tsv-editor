import MarkdownIt from 'markdown-it';

import { ThemeManager, renderThemeToggleSettingItem } from '../shared/themeManager';
import { renderMenuActionRow } from '../shared/menuPanel';
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
    resolveLivePreviewCollapsedLink,
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
    getLivePreviewSelectionStats,
    applyLivePreviewFormat,
    canLivePreviewUndo,
    canLivePreviewRedo,
    refreshLivePreviewImages,
    selectAllLivePreview,
    setLivePreviewDiff,
    isLivePreviewDiffActive,
    getLivePreviewDiffChunkCount,
    getLivePreviewDiffChunkIndex,
    getLivePreviewDiffChunkPositions,
    goToLivePreviewDiffChunkAt,
    goToNextLivePreviewDiffChunk,
    goToPrevLivePreviewDiffChunk,
    acceptAllLivePreviewDiffChunks,
    rejectAllLivePreviewDiffChunks,
} from './livePreview/livePreviewEditor';
import { setImageUriResolver } from './livePreview/imageWidget';
import { diffLineStats, formatDiffLineStats } from './diffStats';
import { markdownBodyWithoutFrontmatter, extractFrontmatter, frontmatterBodyStartLine } from './frontmatter';
import { stripMarkdownToPlainText, computeTextStats } from './markdownStats';
import type { TextStats } from './markdownStats';
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
// Outline visibility waits for host `initSettings` — defaults would flash the
// panel (and peek at the bottom) while "Loading Markdown..." is still shown.
let hostSettingsLoaded = false;

// Mount CM6 preview edit exactly once on the panel's first `initSettings`.
let hasEnteredPreviewEdit = false;
// Content the user was last looking at before an external write — the baseline
// the disk diff compares against. Captured on the FIRST external change and
// held until the diff is dismissed or the document is saved, so a burst of
// external writes still diffs against what was actually on screen. Survives
// applyReloadedContent() on purpose.
let diffBaseline: string | null = null;
let diffVisible = false;
// Tallied per diff session (reset alongside diffBaseline) so the closing
// toast can report what actually happened instead of just "resolved".
let diffAcceptedCount = 0;
let diffRejectedCount = 0;
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
    isDefaultEditor: true,
    showStats: true,
    statsShowLines: true,
    statsShowWords: true,
    statsShowChars: true,
    statsShowReadingTime: true,
    showCursorPosition: true,
    diffReviewEnabled: false,
    diffLayout: 'inline' as 'inline' | 'sideBySide'
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
    const ids = ['openSettingsButton'];
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
        toolbarManager.setButtonEnabled('toggleDiffButton', false);
        return;
    }

    const blocked = isSaving || isReloadingFromDisk;
    const dirty = isEditorDirty();

    toolbarManager.setButtonEnabled('saveEditsButton', !blocked && dirty);
    toolbarManager.setButtonEnabled('reloadFromDiskButton', !blocked && canReloadFromDisk());
    toolbarManager.setButtonEnabled('undoEditsButton', !blocked && isLivePreviewActive() && canLivePreviewUndo());
    toolbarManager.setButtonEnabled('redoEditsButton', !blocked && isLivePreviewActive() && canLivePreviewRedo());
    toolbarManager.setButtonEnabled(
        'toggleDiffButton',
        !blocked && (diffVisible || hasDiskDiffBaseline() || pendingDiskContent !== null)
    );
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

function buildToc(tokens: any[], bodyStartLine: number) {
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
                    const line = token.map[0] + bodyStartLine;
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
    const bodyStartLine = frontmatterBodyStartLine(content || '');
    const body = markdownBodyWithoutFrontmatter(content || '');
    const tokens = md.parse(sanitizeMarkdownCopyLinkArtifacts(body), {});
    addHeadingIds(tokens);
    updateToc(tokens, bodyStartLine);
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


function updateToc(tokens: any[], bodyStartLine: number) {
    const tocBody = $('tocBody');
    if (!tocBody) {return;}
    tocBody.innerHTML = buildToc(tokens, bodyStartLine);
}

function resolveTocLineForAnchor(href: string): number | undefined {
    const raw = href.startsWith('#') ? href.slice(1) : href;
    if (!raw) { return undefined; }
    try {
        return tocIdToLine.get(decodeURIComponent(raw).toLowerCase());
    } catch {
        return tocIdToLine.get(raw.toLowerCase());
    }
}

function scrollToAnchor(href: string): boolean {
    const line = resolveTocLineForAnchor(href);
    if (line === undefined) { return false; }
    scrollLivePreviewToLine(line);
    return true;
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

    // Diff chrome follows the same rule as the edit buttons — a version preview
    // owns the displayed content, so there is nothing to compare against.
    const diffBtn = $('toggleDiffButton');
    const diffTarget = (diffBtn?.closest('.tooltip') as HTMLElement | null) || diffBtn;
    if (diffTarget) { diffTarget.classList.toggle('hidden', hideEdit); }

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
                syncDiskDiffAfterDocChange();
                debouncedCm6TocRefresh(doc);
                debouncedReapplySearch();
                scheduleAutosave();
                updateEditToolbarButtons();
            },
            onScroll: throttledScrollSpy,
            onDiffChunkResolved: handleDiffChunkResolved,
            onModifierClick: handleLivePreviewModifierClick,
            onLinkClick: handleLivePreviewLinkClick,
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
            onFenceCopied: (success) => {
                showToast(success ? 'Copied' : 'Copy failed', undefined, success ? undefined : { icon: 'warning' });
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

function executeLivePreviewLinkAction(href: string): void {
    if (href.startsWith('#')) {
        if (!scrollToAnchor(href)) {
            showToast('Section not found', undefined, { icon: 'warning' });
        }
    } else if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
        vscode.postMessage({ command: 'openExternal', url: href });
    } else if (href) {
        const hashIdx = href.indexOf('#');
        if (hashIdx >= 0 && href.slice(0, hashIdx).trim() === '') {
            if (!scrollToAnchor(href.slice(hashIdx))) {
                showToast('Section not found', undefined, { icon: 'warning' });
            }
            return;
        }
        vscode.postMessage({ command: 'openRelativeFile', href, documentUri });
    }
}

function handleLivePreviewLinkClick(pos: number): boolean {
    const link = resolveLivePreviewCollapsedLink(pos);
    if (!link) { return false; }
    executeLivePreviewLinkAction(link.href);
    return true;
}

// Ctrl/Cmd+Click actions inside CM6 Preview Edit.
function handleLivePreviewModifierClick(pos: number) {
    const interaction = resolveLivePreviewInteraction(pos);
    if (!interaction) {return;}

    if (interaction.kind === 'link') {
        executeLivePreviewLinkAction(interaction.href);
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
    // Version preview swaps displayed content through its own pipeline; running
    // the diff overlay at the same time would leave two systems fighting over
    // the same document.
    if (enabled && diffVisible) {
        hideDiskDiff(true);
    }
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
type ModalOutcome = 'confirm' | 'secondary' | 'cancel';

function confirmModal(
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
                <h2>${escapeHtmlAttr(title)}</h2>
            </div>
            <div class="feedback-body" style="padding: 20px 24px 24px 24px; gap: 20px;">
                <p style="margin: 0; font-size: 13.5px; color: var(--color-text-primary); line-height: 1.5;">
                    ${escapeHtmlAttr(message)}
                </p>
                <div style="display: flex; justify-content: flex-end; gap: 8px;">
                    <button class="reload-confirm-cancel" type="button" style="background: none; border: 1px solid var(--color-border-default); border-radius: 6px; color: var(--color-text-primary); font-size: 13px; font-weight: 500; padding: 6px 14px; cursor: pointer;">${escapeHtmlAttr(secondaryLabel ?? 'Cancel')}</button>
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

type ReloadDecision = 'reload' | 'keepLocal' | 'cancel';

// 'keepLocal' is a real action (force-write to disk) distinct from 'cancel', which
// stays the passive backdrop/click-outside no-op it always was.
function confirmDiscardAndReload(): Promise<ReloadDecision> {
    return confirmModal(
        'Reload from Disk',
        'Discard unsaved changes and reload from disk?',
        'Discard & Reload',
        'Keep mine, ignore disk'
    ).then((r) => (r === 'confirm' ? 'reload' : r === 'secondary' ? 'keepLocal' : 'cancel'));
}

function confirmOverwriteConflict(): Promise<boolean> {
    return confirmModal(
        'File Changed on Disk',
        'This file changed on disk since you opened it. Overwrite it with your local changes anyway?',
        'Overwrite'
    ).then((r) => r === 'confirm');
}

function confirmRestoreConflict(): Promise<boolean> {
    return confirmModal(
        'File Changed on Disk',
        'This file changed on disk since you opened it. Restore the selected version anyway? Your disk changes will be lost.',
        'Restore Anyway'
    ).then((r) => r === 'confirm');
}

function confirmOverwriteWithLocal(): Promise<boolean> {
    return confirmModal('Keep Local Version', 'Overwrite disk with your version?', 'Overwrite disk')
        .then((r) => r === 'confirm');
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
    if (dirty) {
        const decision = await confirmDiscardAndReload();
        if (decision === 'cancel') {return;}
        if (decision === 'keepLocal') {
            if (isSaving) {return;}
            pendingDiskContent = null;
            hideToast();
            doSave(true);
            return;
        }
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

interface ToastAction {
    label: string;
    onClick: () => void;
}

function showToast(
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

// ===== Disk-vs-editor diff =====

/** True when there is a captured baseline that actually differs from the document. */
function hasDiskDiffBaseline(): boolean {
    return diffBaseline !== null && diffBaseline !== currentContent;
}

/** Reflects the current diff state onto the badge and the nav buttons. */
function updateDiffChrome() {
    const badge = $('diffBadge');
    if (badge) {
        const stats = diffVisible && diffBaseline !== null
            ? diffLineStats(diffBaseline, currentContent)
            : null;
        const label = stats ? formatDiffLineStats(stats) : null;
        if (stats && label) {
            // Numeric-only interpolation — no user text reaches innerHTML.
            badge.innerHTML = `<span class="diff-badge-added">+${stats.added}</span>`
                + `<span class="diff-badge-removed">\u2212${stats.removed}</span>`;
            badge.classList.remove('hidden');
            $('diffBadgeSep')?.classList.remove('hidden');
        } else {
            badge.textContent = '';
            badge.classList.add('hidden');
            $('diffBadgeSep')?.classList.add('hidden');
        }
    }

    // Uses .toast-notification's own opacity/visibility transition (the
    // "show" class), not the generic .hidden utility — same fade as every
    // other toast, since this element now IS one, just externally driven.
    $('diskDiffBulkActions')?.classList.toggle('show', diffVisible);
    const indicator = $('diskDiffChunkIndicator');
    if (indicator) {
        const total = getLivePreviewDiffChunkCount();
        indicator.textContent = diffVisible && total > 0 ? `${getLivePreviewDiffChunkIndex()} of ${total}` : '';
    }
    toolbarManager?.setButtonTooltip(
        'toggleDiffButton',
        diffVisible
            ? 'Hide Changes from Disk'
            : (hasDiskDiffBaseline() || pendingDiskContent !== null)
                ? 'Show Changes from Disk'
                : 'No external changes to compare'
    );
    updateDiffChunkRuler();
}

/**
 * Renders one tick per remaining chunk along the right edge of the preview
 * pane, at its proportional scroll position — a map of where the changes
 * are, since "3 of 12" alone doesn't say whether they're clustered near the
 * top or spread across the whole document. Rebuilt wholesale on every call;
 * there are at most a few dozen chunks, so diffing the DOM isn't worth it.
 */
function updateDiffChunkRuler() {
    const ruler = $('diskDiffChunkRuler');
    if (!ruler) {return;}
    if (!diffVisible) {
        ruler.classList.add('hidden');
        ruler.innerHTML = '';
        return;
    }
    const positions = getLivePreviewDiffChunkPositions();
    ruler.classList.toggle('hidden', positions.length === 0);
    ruler.innerHTML = positions
        .map((fraction, index) => {
            const percent = (fraction * 100).toFixed(2);
            // data-index, not a closure per tick — innerHTML is rebuilt wholesale above.
            return `<div class="disk-diff-chunk-tick" style="top:${percent}%" data-chunk-index="${index}"></div>`;
        })
        .join('');
}

/**
 * Mount the diff overlay against the captured baseline. The single choke
 * point for every entry path (toast, toolbar toggle, F7 nav, auto-open) —
 * gating diffReviewEnabled here means none of those callers need their own
 * check.
 */
function showDiskDiff() {
    if (!currentSettings.diffReviewEnabled
        || !isEditMode || isVersionPreviewMode || !isLivePreviewActive() || diffBaseline === null) {
        return;
    }
    if (!hasDiskDiffBaseline()) {
        showToast('No changes to compare');
        return;
    }
    diffVisible = true;
    setLivePreviewDiff(diffBaseline);
    updateDiffChrome();
    updateEditToolbarButtons();
    // The decision toast (Load/Review/Keep local) has served its purpose once
    // the diff is actually on screen — leaving it up just occludes the editor
    // while the user works through chunks.
    hideToast();
}

/**
 * Take the overlay down. `forget` also drops the baseline, so the toggle goes
 * inert until the next external change — used once the comparison is spent
 * (saved, all chunks resolved, version preview taking over).
 */
function hideDiskDiff(forget = false) {
    diffVisible = false;
    if (isLivePreviewActive()) {
        setLivePreviewDiff(null);
    }
    if (forget) {
        diffBaseline = null;
    }
    updateDiffChrome();
    updateEditToolbarButtons();
}

/**
 * "Review changes": the merge view diffs the baseline against the LIVE document,
 * so the incoming disk content has to be in the buffer first — otherwise the
 * diff would read backwards and accept/reject would be meaningless. Reloading
 * goes through the same discard confirmation as the plain Reload action.
 */
function revealDiskChanges() {
    if (pendingDiskContent === null) {
        showDiskDiff();
        return;
    }

    const applyAndShow = () => {
        if (pendingDiskContent === null) { return; }
        applyReloadedContent(pendingDiskContent);
        pendingDiskContent = null;
        showDiskDiff();
    };

    if (isEditMode && getActiveEditorContent() !== originalContent) {
        confirmDiscardAndReload().then((decision) => {
            if (decision === 'reload') {
                applyAndShow();
            } else if (decision === 'keepLocal' && !isSaving) {
                pendingDiskContent = null;
                hideToast();
                doSave(true);
            }
        });
        return;
    }
    applyAndShow();
}

/**
 * Keep every incoming change in one go. The document already holds the disk
 * version (Review changes reloads before diffing), so this resolves the chunk set
 * rather than editing text — except where chunks were individually rejected,
 * which stay rejected because those chunks are already gone from the set.
 */
function acceptAllDiskChanges() {
    if (!diffVisible) {
        return;
    }
    const accepted = acceptAllLivePreviewDiffChunks();
    if (accepted === 0) {
        // Nothing resolvable left — retire the overlay rather than leaving a
        // dead badge on screen.
        hideDiskDiff(true);
        return;
    }
    // Accepting produces no document change, so syncDiskDiffAfterDocChange only
    // runs via the onDiffChunkResolved hook; call through explicitly so the
    // retire-and-toast path is guaranteed even if the hook is ever detached.
    syncDiskDiffAfterDocChange();
    if (diffVisible) {
        hideDiskDiff(true);
        showToast(`Accepted ${accepted} change${accepted === 1 ? '' : 's'} from disk`);
    }
}

/**
 * Reject every incoming change in one go, restoring the local version
 * throughout. Deliberately does NOT force-save afterward — a misclick here
 * is a one-way trip to disk if it did, whereas leaving the buffer merely
 * dirty (same as accept) means the normal save flow and Ctrl+Z still protect
 * against it.
 */
function rejectAllDiskChanges() {
    if (!diffVisible) {
        return;
    }
    const rejected = rejectAllLivePreviewDiffChunks();
    if (rejected === 0) {
        hideDiskDiff(true);
        return;
    }
    // Reject produces a real document change, so the update listener's
    // onDocChanged already routed through syncDiskDiffAfterDocChange per
    // chunk during the loop above — this call is a safety net in case that
    // hook is ever detached.
    syncDiskDiffAfterDocChange();
    if (diffVisible) {
        hideDiskDiff(true);
        showToast(`Rejected ${rejected} change${rejected === 1 ? '' : 's'} from disk`);
    }
}

function toggleDiskDiff() {
    if (diffVisible) {
        hideDiskDiff();
    } else {
        revealDiskChanges();
    }
}

/** Tallies one chunk resolution — per-chunk clicks and bulk actions both flow through here. */
function handleDiffChunkResolved(kind: 'accept' | 'reject') {
    if (kind === 'accept') { diffAcceptedCount++; } else { diffRejectedCount++; }
    syncDiskDiffAfterDocChange();
}

/** "3 accepted", "2 rejected", or "1 accepted, 1 rejected" — whichever categories are non-zero. */
function diffResolutionSummary(): string {
    const parts: string[] = [];
    if (diffAcceptedCount > 0) { parts.push(`${diffAcceptedCount} accepted`); }
    if (diffRejectedCount > 0) { parts.push(`${diffRejectedCount} rejected`); }
    return parts.length ? `Resolved: ${parts.join(', ')}` : 'All external changes resolved';
}

/**
 * Called after every document change while the overlay is up: refreshes the
 * counts and retires the diff once the last chunk has been accepted/rejected.
 */
function syncDiskDiffAfterDocChange() {
    if (!diffVisible) {
        return;
    }
    if (isLivePreviewDiffActive() && getLivePreviewDiffChunkCount() === 0) {
        hideDiskDiff(true);
        showToast(diffResolutionSummary());
        return;
    }
    updateDiffChrome();
}

/** Current cursor position in CM6. null when live preview is not mounted. */
function getCurrentCursorPosition(): { line: number; col: number } | null {
    if (isLivePreviewActive()) {
        return getLivePreviewCursorPosition();
    }
    return null;
}

/** Stats for the active non-trivial selection. null when there is none (falls back to whole-doc). */
function getCurrentSelectionStats() {
    return isLivePreviewActive() ? getLivePreviewSelectionStats() : null;
}

// Stripping + counting the whole document is far more expensive than the
// raw counts this replaced. updateStatusInfo() runs on every cursor move
// (not just real selections) as well as every keystroke, so without this
// cache a plain cursor move would re-strip the entire document for no
// reason — memoize on the exact `currentContent` reference/value so only an
// actual content change triggers a recompute.
let cachedWholeDocStatsContent: string | null = null;
let cachedWholeDocStats: TextStats = { lines: 0, words: 0, chars: 0 };
function getWholeDocumentStats(): TextStats {
    if (cachedWholeDocStatsContent !== currentContent) {
        cachedWholeDocStatsContent = currentContent;
        cachedWholeDocStats = computeTextStats(stripMarkdownToPlainText(currentContent));
    }
    return cachedWholeDocStats;
}

function updateStatusInfo() {
    const statusInfo = $('statusInfo');
    if (!statusInfo) {return;}

    if (!currentSettings.showStats) {
        statusInfo.textContent = '';
        statusInfo.style.display = 'none';
        return;
    }

    const cursor = currentSettings.showCursorPosition ? getCurrentCursorPosition() : null;
    const cursorPrefix = cursor ? `Ln ${cursor.line}, Col ${cursor.col}` : '';

    const parts: string[] = [];
    const stats = getCurrentSelectionStats() ?? getWholeDocumentStats();
    if (currentSettings.statsShowLines) {parts.push(`${stats.lines} lines`);}
    if (currentSettings.statsShowWords) {parts.push(`${stats.words} words`);}
    if (currentSettings.statsShowChars) {parts.push(`${stats.chars} chars`);}
    if (currentSettings.statsShowReadingTime && stats.words > 0) {
        const readingTime = Math.max(1, Math.ceil(stats.words / 200));
        parts.push(`~${readingTime} min read`);
    }

    const combined = [cursorPrefix, parts.join(' \u00B7 ')].filter(Boolean).join(' \u00B7 ');
    statusInfo.textContent = combined;
    statusInfo.style.display = combined ? 'block' : 'none';
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

function wireDiskDiffBulkActions() {
    const prevBtn = $('diffPrevButton');
    const nextBtn = $('diffNextButton');
    // Up/down, not left/right — chunks are ordered top-to-bottom in the
    // document, so the arrows follow that flow rather than reading direction.
    if (prevBtn) {prevBtn.innerHTML = Icons.DiffPrev;}
    if (nextBtn) {nextBtn.innerHTML = Icons.DiffNext;}
    prevBtn?.addEventListener('click', () => { goToPrevLivePreviewDiffChunk(); updateDiffChrome(); });
    nextBtn?.addEventListener('click', () => { goToNextLivePreviewDiffChunk(); updateDiffChrome(); });

    $('diffAcceptAllButton')?.addEventListener('click', () => acceptAllDiskChanges());
    $('diffRejectAllButton')?.addEventListener('click', () => rejectAllDiskChanges());

    // Delegated: ticks are rebuilt wholesale on every updateDiffChunkRuler() call,
    // so a per-tick listener would just be discarded along with the element.
    $('diskDiffChunkRuler')?.addEventListener('click', (e) => {
        const tick = (e.target as HTMLElement)?.closest('[data-chunk-index]') as HTMLElement | null;
        const index = tick ? Number(tick.dataset.chunkIndex) : NaN;
        if (Number.isInteger(index)) {
            goToLivePreviewDiffChunkAt(index);
            updateDiffChrome();
        }
    });
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
    const chkShowStats = $('chkShowStats') as HTMLInputElement;
    const chkShowCursorPosition = $('chkShowCursorPosition') as HTMLInputElement;
    const chkStatsLines = $('chkStatsLines') as HTMLInputElement;
    const chkStatsWords = $('chkStatsWords') as HTMLInputElement;
    const chkStatsChars = $('chkStatsChars') as HTMLInputElement;
    const chkStatsReadingTime = $('chkStatsReadingTime') as HTMLInputElement;
    const chkDiffReviewEnabled = $('chkDiffReviewEnabled') as HTMLInputElement;

    if (chkWordWrap) {chkWordWrap.checked = currentSettings.wordWrap;}
    if (chkStickyToolbar) {chkStickyToolbar.checked = currentSettings.stickyToolbar;}
    if (chkShowOutline) {chkShowOutline.checked = currentSettings.showOutline;}
    if (chkShowLineNumbers) {chkShowLineNumbers.checked = livePreviewGutterLineNumbersEnabled();}
    if (chkLivePreviewReveal) {chkLivePreviewReveal.checked = currentSettings.livePreviewReveal;}
    if (chkAutoSave) {chkAutoSave.checked = currentSettings.autoSave;}
    if (chkOpenByDefault) {chkOpenByDefault.checked = !!currentSettings.isDefaultEditor;}
    if (chkShowStats) {chkShowStats.checked = !!currentSettings.showStats;}
    if (chkShowCursorPosition) {chkShowCursorPosition.checked = !!currentSettings.showCursorPosition;}
    if (chkStatsLines) {chkStatsLines.checked = !!currentSettings.statsShowLines;}
    if (chkStatsWords) {chkStatsWords.checked = !!currentSettings.statsShowWords;}
    if (chkStatsChars) {chkStatsChars.checked = !!currentSettings.statsShowChars;}
    if (chkStatsReadingTime) {chkStatsReadingTime.checked = !!currentSettings.statsShowReadingTime;}
    if (chkDiffReviewEnabled) {chkDiffReviewEnabled.checked = !!currentSettings.diffReviewEnabled;}

    const statsEnabled = !!currentSettings.showStats;
    [chkShowCursorPosition, chkStatsLines, chkStatsWords, chkStatsChars, chkStatsReadingTime].forEach((el) => {
        const item = el?.closest('.setting-item') as HTMLElement | null;
        if (item) {item.style.display = statsEnabled ? 'flex' : 'none';}
    });

    // Line numbers
    document.body.classList.toggle('show-line-numbers', livePreviewGutterLineNumbersEnabled());

    const tocPanel = $('tocPanel');
    if (hostSettingsLoaded) {
        if (container) {container.classList.toggle('toc-open', !!currentSettings.showOutline);}
        if (tocPanel) {tocPanel.classList.toggle('hidden', !currentSettings.showOutline);}
    }

    // The whole diff-review affordance (toolbar icon, HUD, overlay) hinges on
    // this setting — hide the entry point and tear down anything already
    // showing rather than leaving an inert button or an overlay the setting
    // says shouldn't exist.
    toolbarManager?.setButtonVisibility('toggleDiffButton', !!currentSettings.diffReviewEnabled);
    if (!currentSettings.diffReviewEnabled && diffVisible) {
        hideDiskDiff(true);
    }

    if (persist) {
        vscode.postMessage({ command: 'updateSettings', settings: currentSettings });
    }

    updateStatusInfo();
    updateDiffChrome();
}

function renderVersionHistorySettingItem(buttonId: string): string {
    return renderMenuActionRow({
        id: buttonId,
        label: 'Open Version History',
        title: 'Browse and restore previous saved versions of this file',
        trailingHtml: `<span class="menu-row__trailing setting-action-chevron" aria-hidden="true">${Icons.ChevronRight}</span>`
    });
}

function initializeSettings() {
    const settingsDefs = [
        {
            id: 'chkOpenByDefault',
            section: 'General',
            label: 'Open .md files with Sheetmark by default',
            tooltip: 'When enabled, VS Code opens .md files in Sheetmark automatically.',
            defaultValue: !!currentSettings.isDefaultEditor,
            onChange: (val: boolean) => {
                vscode.postMessage({ command: val ? 'enableAsDefault' : 'disableDefaultEditor' });
            }
        },
        {
            id: 'chkShowOutline',
            section: 'General',
            label: 'Show Outline',
            tooltip: 'Display the document outline panel for heading navigation.',
            defaultValue: currentSettings.showOutline,
            onChange: (val: boolean) => {
                currentSettings.showOutline = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkAutoSave',
            section: 'General',
            label: 'Enable Autosave',
            tooltip: 'Automatically save Markdown edits after a short debounce.',
            defaultValue: currentSettings.autoSave,
            onChange: (val: boolean) => {
                currentSettings.autoSave = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkDiffReviewEnabled',
            section: 'General',
            label: 'Review External Changes as a Diff',
            tooltip: 'When the file changes outside the editor, show what changed as a diff you can accept or reject piece by piece. Turn off to just choose between loading the disk version or keeping yours, with no diff view.',
            defaultValue: currentSettings.diffReviewEnabled,
            onChange: (val: boolean) => {
                currentSettings.diffReviewEnabled = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'openVersionHistorySetting',
            section: 'General',
            label: 'Version History',
            html: renderVersionHistorySettingItem('openVersionHistorySetting'),
            onChange: () => {}
        },
        {
            id: 'themeSelect',
            section: 'General',
            label: 'Theme',
            html: renderThemeToggleSettingItem('themeSelect'),
            onChange: () => {}
        },
        {
            id: 'chkStickyToolbar',
            section: 'Layout',
            label: 'Enable Sticky Toolbar',
            tooltip: 'Keep the Markdown toolbar pinned at the top while you scroll.',
            defaultValue: currentSettings.stickyToolbar,
            onChange: (val: boolean) => {
                currentSettings.stickyToolbar = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkWordWrap',
            section: 'Layout',
            label: 'Enable Line Wrap',
            tooltip: 'Wrap long lines in the editor to the pane width instead of horizontal scrolling.',
            defaultValue: currentSettings.wordWrap,
            onChange: (val: boolean) => {
                currentSettings.wordWrap = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkShowLineNumbers',
            section: 'Layout',
            label: 'Show Line Numbers',
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
            section: 'Layout',
            label: 'Enable Live Preview Reveal',
            tooltip: 'In Preview Edit mode, reveal raw markdown syntax (##, **, *) near the cursor and hide it elsewhere.',
            defaultValue: currentSettings.livePreviewReveal,
            onChange: (val: boolean) => {
                currentSettings.livePreviewReveal = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkShowStats',
            section: 'Document Stats',
            label: 'Show Document Stats',
            tooltip: 'Show document stats and cursor position in the status bar.',
            defaultValue: currentSettings.showStats,
            onChange: (val: boolean) => {
                currentSettings.showStats = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkShowCursorPosition',
            section: 'Document Stats',
            label: 'Show Current Line',
            tooltip: 'Show the current line and column position (Ln X, Col Y) in the status bar.',
            className: 'setting-dependent setting-stats-dependent',
            defaultValue: currentSettings.showCursorPosition,
            onChange: (val: boolean) => {
                currentSettings.showCursorPosition = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkStatsLines',
            section: 'Document Stats',
            label: 'Show Lines',
            tooltip: 'Show the line count in the status bar.',
            className: 'setting-dependent setting-stats-dependent',
            defaultValue: currentSettings.statsShowLines,
            onChange: (val: boolean) => {
                currentSettings.statsShowLines = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkStatsWords',
            section: 'Document Stats',
            label: 'Show Words',
            tooltip: 'Show the word count in the status bar.',
            className: 'setting-dependent setting-stats-dependent',
            defaultValue: currentSettings.statsShowWords,
            onChange: (val: boolean) => {
                currentSettings.statsShowWords = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkStatsChars',
            section: 'Document Stats',
            label: 'Show Characters',
            tooltip: 'Show the character count in the status bar.',
            className: 'setting-dependent setting-stats-dependent',
            defaultValue: currentSettings.statsShowChars,
            onChange: (val: boolean) => {
                currentSettings.statsShowChars = val;
                applySettings(currentSettings, true);
            }
        },
        {
            id: 'chkStatsReadingTime',
            section: 'Document Stats',
            label: 'Show Reading Time',
            tooltip: 'Show estimated reading time in the status bar.',
            className: 'setting-dependent setting-stats-dependent',
            defaultValue: currentSettings.statsShowReadingTime,
            onChange: (val: boolean) => {
                currentSettings.statsShowReadingTime = val;
                applySettings(currentSettings, true);
            }
        }
    ];

    SettingsManager.renderPanel(document.body, 'settingsPanel', 'settingsCancelButton', settingsDefs);

    new SettingsManager('openSettingsButton', 'settingsPanel', 'settingsCancelButton', settingsDefs);

    const versionHistoryBtn = $('openVersionHistorySetting');
    if (versionHistoryBtn) {
        versionHistoryBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'showVersionHistory' });
        });
    }

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
            $('content')?.classList.remove('is-loading');
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

            const incomingContent = m.content || '';

            // Own-save echoes and other redundant watcher ticks — disk matches what
            // is already in the editor, so there is nothing to reload or diff.
            if (!wasManualReload && incomingContent === getActiveEditorContent()) {
                break;
            }

            // Capture what is on screen right now as the diff baseline, but only
            // if no comparison is already pending — a burst of external writes
            // should still diff against what the user last actually saw.
            if (diffBaseline === null) {
                diffBaseline = currentContent;
                diffAcceptedCount = 0;
                diffRejectedCount = 0;
            }
            const incomingLabel = formatDiffLineStats(diffLineStats(diffBaseline, incomingContent));

            // An explicit reload request applies directly — the persistent toast
            // below is only for unprompted watcher-detected changes.
            if (wasManualReload || !isEditMode) {
                pendingDiskContent = null;
                applyReloadedContent(incomingContent);
                showToast(
                    incomingLabel ? `Reloaded from disk \u00B7 ${incomingLabel}` : 'Reloaded from disk',
                    hasDiskDiffBaseline() && currentSettings.diffReviewEnabled
                        ? { label: 'Review changes', onClick: () => showDiskDiff() }
                        : undefined
                );
                updateEditToolbarButtons();
                updateDiffChrome();
                break;
            }

            // Diffing is non-destructive — local edits become the rejectable
            // side of the comparison rather than being discarded — so this path
            // never needs a "you have unsaved edits" confirm. It replaces the
            // toast decision entirely: the diff HUD (itself a toast — "File
            // changed on disk" header, Accept All/Reject All in its actions
            // row) is what the old "Load disk changes"/"Keep local version"
            // toast used to be.
            if (currentSettings.diffReviewEnabled) {
                applyReloadedContent(incomingContent);
                pendingDiskContent = null;
                showDiskDiff();
                updateEditToolbarButtons();
                break;
            }

            // Diff review disabled: the only two ways to resolve are a full
            // reload or a full overwrite, each with its own confirm dialog
            // since — unlike the diff — either one can genuinely discard work.
            pendingDiskContent = incomingContent;

            const applyPending = () => {
                if (pendingDiskContent === null) {return;}
                applyReloadedContent(pendingDiskContent);
                pendingDiskContent = null;
                showToast('Reloaded from disk');
            };
            const reloadPending = () => {
                // Never dead-end: if the queued content was already consumed (a
                // second watcher event) ask the host for a fresh read instead of
                // silently doing nothing.
                if (pendingDiskContent === null) {
                    void requestReloadFromDisk();
                    return;
                }
                const dirty = isEditMode && getActiveEditorContent() !== originalContent;
                if (dirty) {
                    confirmDiscardAndReload().then((decision) => {
                        if (decision === 'reload') {
                            applyPending();
                        } else if (decision === 'keepLocal' && !isSaving) {
                            pendingDiskContent = null;
                            hideToast();
                            doSave(true);
                        }
                    });
                } else {
                    applyPending();
                }
            };
            const keepLocalVersion = () => {
                confirmOverwriteWithLocal().then((confirmed) => {
                    if (!confirmed || isSaving) {return;}
                    pendingDiskContent = null;
                    hideToast();
                    doSave(true);
                });
            };

            showToast(
                incomingLabel ? `File changed on disk \u00B7 ${incomingLabel}` : 'File changed on disk',
                [
                    { label: 'Load disk changes', onClick: reloadPending },
                    { label: 'Keep local version', onClick: keepLocalVersion },
                ],
                // No close button: the user has to make a decision, not dismiss it.
                { persistent: true, icon: 'warning', hideCloseButton: true }
            );
            updateEditToolbarButtons();
            updateDiffChrome();
            break;
        }

        // From the xlsx-viewer.md.{accept,reject}AllDiskChanges commands (package.json
        // keybindings / Command Palette) — no-ops via the guard already in each function
        // if there's no diff open.
        case 'acceptAllDiskChanges':
            acceptAllDiskChanges();
            break;

        case 'rejectAllDiskChanges':
            rejectAllDiskChanges();
            break;

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

        case 'openRelativeFileFailed':
            showToast(m.message || 'File not found', undefined, { icon: 'warning' });
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
            hostSettingsLoaded = true;
            applySettings(m.settings, false);
            if (!hasEnteredPreviewEdit) {
                hasEnteredPreviewEdit = true;
                enterPreviewEditMode();
            }
            break;

        case 'settingsUpdated':
            hostSettingsLoaded = true;
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
                // The saved document is the new reference point; the old baseline
                // no longer describes anything the user can act on.
                hideDiskDiff(true);
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
            id: 'toggleDiffButton',
            icon: Icons.Diff,
            tooltip: 'No external changes to compare',
            cls: 'icon-only',
            onClick: () => toggleDiskDiff()
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

    if (e.key === 'F7' && diffVisible) {
        e.preventDefault();
        if (e.shiftKey) {
            goToPrevLivePreviewDiffChunk();
        } else {
            goToNextLivePreviewDiffChunk();
        }
        updateDiffChrome();
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
            if (!scrollToAnchor(`#${id}`)) {
                showToast('Section not found', undefined, { icon: 'warning' });
            }
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
wireDiskDiffBulkActions();
initScrollSpy();
initResizeHandles();
updateHeaderHeight();

// Ensure settings are applied once toolbar is ready
if (currentSettings) {
    applySettings(currentSettings);
}

vscode.postMessage({ command: 'webviewReady' });
