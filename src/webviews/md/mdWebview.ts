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
import { markdownBodyWithoutFrontmatter, frontmatterBodyStartLine } from './frontmatter';
import { stripMarkdownToPlainText, computeTextStats } from './markdownStats';
import type { TextStats } from './markdownStats';
import type { Cm6Match } from './livePreview/livePreviewSearch';
import type { HostToMarkdownWebview } from '../../protocol/markdown';
import type { HandledByFeedbackModal } from '../../protocol/common';
import { state } from './state';
import { post } from './messaging';
import { hideToast, showToast } from './toast';
import { confirmDiscardAndReload } from './dialogs';
import { sanitizeMarkdownCopyLinkArtifacts, stripHeadingCopyLinkArtifacts } from './copyLinkArtifacts';
import {
    applyReloadedContent,
    cancelEdit,
    canReloadFromDisk,
    doSave,
    getActiveEditorContent,
    initSaveSync,
    isEditorDirty,
    onDiskChangedExternally,
    onReloadFromDiskError,
    onRestoreConflict,
    onSaveConflict,
    onSaveResult,
    onVersionPreview,
    onVersionPreviewCancelled,
    onVersionRestored,
    performSave,
    requestReloadFromDisk,
    scheduleAutosave,
} from './saveSync';


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

/** Preview Edit gutter — single user-facing "Line Numbers" toggle (see settings panel). */
function livePreviewGutterLineNumbersEnabled(): boolean {
    return !!state.currentSettings.livePreviewLineNumbers;
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

function updateEditToolbarButtons() {
    if (!state.toolbarManager || !state.isEditMode) {
        return;
    }

    if (state.isVersionPreviewMode) {
        state.toolbarManager.setButtonEnabled('saveEditsButton', false);
        state.toolbarManager.setButtonEnabled('reloadFromDiskButton', false);
        state.toolbarManager.setButtonEnabled('undoEditsButton', false);
        state.toolbarManager.setButtonEnabled('redoEditsButton', false);
        state.toolbarManager.setButtonEnabled('toggleDiffButton', false);
        return;
    }

    const blocked = state.isSaving || state.isReloadingFromDisk;
    const dirty = isEditorDirty();

    state.toolbarManager.setButtonEnabled('saveEditsButton', !blocked && dirty);
    state.toolbarManager.setButtonEnabled('reloadFromDiskButton', !blocked && canReloadFromDisk());
    state.toolbarManager.setButtonEnabled('undoEditsButton', !blocked && isLivePreviewActive() && canLivePreviewUndo());
    state.toolbarManager.setButtonEnabled('redoEditsButton', !blocked && isLivePreviewActive() && canLivePreviewRedo());
    state.toolbarManager.setButtonEnabled(
        'toggleDiffButton',
        !blocked && (state.diffVisible || hasDiskDiffBaseline() || state.pendingDiskContent !== null)
    );
}


function wireImageUriResolver() {
    setImageUriResolver({
        getResolved: (src) => state.resolvedImageUriCache.get(src.trim()),
        requestResolve: (sources) => {
            const pending = sources
                .map(s => s.trim())
                .filter(s => s && !state.resolvedImageUriCache.has(s));
            if (pending.length === 0) { return; }
            post({ command: 'resolveImageUris', sources: pending });
        },
        openLightbox: (src, alt) => showLightbox(src, alt),
        requestLightbox: (src, alt) => {
            state.pendingCm6LightboxSrc = src;
            post({ command: 'resolveImageUris', sources: [src] });
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
        state.resolvedImageUriCache.set(source, uri);
    });

    if (state.pendingCm6LightboxSrc && resolved[state.pendingCm6LightboxSrc]) {
        showLightbox(resolved[state.pendingCm6LightboxSrc], '');
        state.pendingCm6LightboxSrc = null;
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

function normalizeHeadingText(text: string): string {
    const stripped = stripHeadingCopyLinkArtifacts(text);
    return md.utils.unescapeAll(stripped);
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
    state.frontmatterPanelCollapsed = collapsed;
    post({ command: 'saveFrontmatterPanelCollapsed', collapsed });
}

function persistMermaidPreviewMode(mode: 'diagram' | 'code') {
    state.mermaidPreviewMode = mode;
    post({ command: 'saveMermaidPreviewMode', mode });
}

function persistCalloutDefaultType(type: string) {
    state.calloutDefaultType = type;
    post({ command: 'saveCalloutDefaultType', type });
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
    const hideEdit = state.isVersionPreviewMode;
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
    state.isEditMode = true;
    document.body.classList.toggle('edit-mode', true);
    document.body.classList.toggle('preview-edit-mode', true);
    document.body.classList.toggle('cm6-preview-active', true);
    document.body.classList.toggle('cm6-word-wrap', state.currentSettings.wordWrap);

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

    state.originalContent = state.currentContent;

    container?.classList.add('preview-edit');

    if (preview) {
        preview.contentEditable = 'false';
        mountLivePreview({
            parent: preview,
            doc: state.currentContent,
            lineWrapping: state.currentSettings.wordWrap,
            onDocChanged: (doc) => {
                if (state.isVersionPreviewMode) { return; }
                state.currentContent = doc;
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
            reveal: state.currentSettings.livePreviewReveal,
            showLineNumbers: livePreviewGutterLineNumbersEnabled(),
            onSelectionChange: updateStatusInfo,
            onHistoryChange: updateEditToolbarButtons,
            columnWidths: state.currentTableColumnWidths,
            onColumnWidthsChanged: (widths) => {
                state.currentTableColumnWidths = widths;
                post({ command: 'saveTableColumnWidths', widths });
            },
            frontmatterCollapsed: state.frontmatterPanelCollapsed,
            onFrontmatterCollapsedChanged: (collapsed) => {
                persistFrontmatterPanelCollapsed(collapsed);
            },
            mermaidPreviewMode: state.mermaidPreviewMode,
            onMermaidPreviewModeChanged: (mode) => {
                persistMermaidPreviewMode(mode);
            },
            calloutDefaultType: state.calloutDefaultType,
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
        refreshCm6Toc(state.currentContent);
        focusLivePreview();
    }

    applyToolbarLayout(state.toolbarManager, {
        stickyToolbar: state.currentSettings.stickyToolbar,
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
        post({ command: 'openExternal', url: href });
    } else if (href) {
        const hashIdx = href.indexOf('#');
        if (hashIdx >= 0 && href.slice(0, hashIdx).trim() === '') {
            if (!scrollToAnchor(href.slice(hashIdx))) {
                showToast('Section not found', undefined, { icon: 'warning' });
            }
            return;
        }
        post({ command: 'openRelativeFile', href, documentUri: state.documentUri });
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
        const resolved = state.resolvedImageUriCache.get(src);
        if (resolved) {
            showLightbox(resolved, '');
        } else {
            state.pendingCm6LightboxSrc = src;
            post({ command: 'resolveImageUris', sources: [src] });
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

function applyFormat(action: string) {
    if (!isLivePreviewActive() || state.isVersionPreviewMode) {return;}
    applyLivePreviewFormat(action);
}

// ===== Disk-vs-editor diff =====

/** True when there is a captured baseline that actually differs from the document. */
function hasDiskDiffBaseline(): boolean {
    return state.diffBaseline !== null && state.diffBaseline !== state.currentContent;
}

/** Reflects the current diff state onto the badge and the nav buttons. */
function updateDiffChrome() {
    const badge = $('diffBadge');
    if (badge) {
        const stats = state.diffVisible && state.diffBaseline !== null
            ? diffLineStats(state.diffBaseline, state.currentContent)
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
    $('diskDiffBulkActions')?.classList.toggle('show', state.diffVisible);
    const indicator = $('diskDiffChunkIndicator');
    if (indicator) {
        const total = getLivePreviewDiffChunkCount();
        indicator.textContent = state.diffVisible && total > 0 ? `${getLivePreviewDiffChunkIndex()} of ${total}` : '';
    }
    state.toolbarManager?.setButtonTooltip(
        'toggleDiffButton',
        state.diffVisible
            ? 'Hide Changes from Disk'
            : (hasDiskDiffBaseline() || state.pendingDiskContent !== null)
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
    if (!state.diffVisible) {
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
    if (!state.currentSettings.diffReviewEnabled
        || !state.isEditMode || state.isVersionPreviewMode || !isLivePreviewActive() || state.diffBaseline === null) {
        return;
    }
    if (!hasDiskDiffBaseline()) {
        showToast('No changes to compare');
        return;
    }
    state.diffVisible = true;
    setLivePreviewDiff(state.diffBaseline);
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
    state.diffVisible = false;
    if (isLivePreviewActive()) {
        setLivePreviewDiff(null);
    }
    if (forget) {
        state.diffBaseline = null;
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
    if (state.pendingDiskContent === null) {
        showDiskDiff();
        return;
    }

    const applyAndShow = () => {
        if (state.pendingDiskContent === null) { return; }
        applyReloadedContent(state.pendingDiskContent);
        state.pendingDiskContent = null;
        showDiskDiff();
    };

    if (state.isEditMode && getActiveEditorContent() !== state.originalContent) {
        confirmDiscardAndReload().then((decision) => {
            if (decision === 'reload') {
                applyAndShow();
            } else if (decision === 'keepLocal' && !state.isSaving) {
                state.pendingDiskContent = null;
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
    if (!state.diffVisible) {
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
    if (state.diffVisible) {
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
    if (!state.diffVisible) {
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
    if (state.diffVisible) {
        hideDiskDiff(true);
        showToast(`Rejected ${rejected} change${rejected === 1 ? '' : 's'} from disk`);
    }
}

function toggleDiskDiff() {
    if (state.diffVisible) {
        hideDiskDiff();
    } else {
        revealDiskChanges();
    }
}

/** Tallies one chunk resolution — per-chunk clicks and bulk actions both flow through here. */
function handleDiffChunkResolved(kind: 'accept' | 'reject') {
    if (kind === 'accept') { state.diffAcceptedCount++; } else { state.diffRejectedCount++; }
    syncDiskDiffAfterDocChange();
}

/** "3 accepted", "2 rejected", or "1 accepted, 1 rejected" — whichever categories are non-zero. */
function diffResolutionSummary(): string {
    const parts: string[] = [];
    if (state.diffAcceptedCount > 0) { parts.push(`${state.diffAcceptedCount} accepted`); }
    if (state.diffRejectedCount > 0) { parts.push(`${state.diffRejectedCount} rejected`); }
    return parts.length ? `Resolved: ${parts.join(', ')}` : 'All external changes resolved';
}

/**
 * Called after every document change while the overlay is up: refreshes the
 * counts and retires the diff once the last chunk has been accepted/rejected.
 */
function syncDiskDiffAfterDocChange() {
    if (!state.diffVisible) {
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
    if (cachedWholeDocStatsContent !== state.currentContent) {
        cachedWholeDocStatsContent = state.currentContent;
        cachedWholeDocStats = computeTextStats(stripMarkdownToPlainText(state.currentContent));
    }
    return cachedWholeDocStats;
}

function updateStatusInfo() {
    const statusInfo = $('statusInfo');
    if (!statusInfo) {return;}

    if (!state.currentSettings.showStats) {
        statusInfo.textContent = '';
        statusInfo.style.display = 'none';
        return;
    }

    const cursor = state.currentSettings.showCursorPosition ? getCurrentCursorPosition() : null;
    const cursorPrefix = cursor ? `Ln ${cursor.line}, Col ${cursor.col}` : '';

    const parts: string[] = [];
    const stats = getCurrentSelectionStats() ?? getWholeDocumentStats();
    if (state.currentSettings.statsShowLines) {parts.push(`${stats.lines} lines`);}
    if (state.currentSettings.statsShowWords) {parts.push(`${stats.words} words`);}
    if (state.currentSettings.statsShowChars) {parts.push(`${stats.chars} chars`);}
    if (state.currentSettings.statsShowReadingTime && stats.words > 0) {
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
    state.currentSettings = { ...state.currentSettings, ...settings };

    const container = $('markdownContainer');

    // Word wrap
    if (container) {
        container.classList.toggle('word-wrap', state.currentSettings.wordWrap);
    }

    if (isLivePreviewActive()) {
        setLivePreviewReveal(state.currentSettings.livePreviewReveal);
        setLivePreviewLineWrapping(state.currentSettings.wordWrap);
        setLivePreviewLineNumbers(livePreviewGutterLineNumbersEnabled());
    }

    document.body.classList.toggle('cm6-word-wrap', isLivePreviewActive() && state.currentSettings.wordWrap);

    // Sticky toolbar
    applyToolbarLayout(state.toolbarManager, {
        stickyToolbar: state.currentSettings.stickyToolbar,
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

    if (chkWordWrap) {chkWordWrap.checked = state.currentSettings.wordWrap;}
    if (chkStickyToolbar) {chkStickyToolbar.checked = state.currentSettings.stickyToolbar;}
    if (chkShowOutline) {chkShowOutline.checked = state.currentSettings.showOutline;}
    if (chkShowLineNumbers) {chkShowLineNumbers.checked = livePreviewGutterLineNumbersEnabled();}
    if (chkLivePreviewReveal) {chkLivePreviewReveal.checked = state.currentSettings.livePreviewReveal;}
    if (chkAutoSave) {chkAutoSave.checked = state.currentSettings.autoSave;}
    if (chkOpenByDefault) {chkOpenByDefault.checked = !!state.currentSettings.isDefaultEditor;}
    if (chkShowStats) {chkShowStats.checked = !!state.currentSettings.showStats;}
    if (chkShowCursorPosition) {chkShowCursorPosition.checked = !!state.currentSettings.showCursorPosition;}
    if (chkStatsLines) {chkStatsLines.checked = !!state.currentSettings.statsShowLines;}
    if (chkStatsWords) {chkStatsWords.checked = !!state.currentSettings.statsShowWords;}
    if (chkStatsChars) {chkStatsChars.checked = !!state.currentSettings.statsShowChars;}
    if (chkStatsReadingTime) {chkStatsReadingTime.checked = !!state.currentSettings.statsShowReadingTime;}
    if (chkDiffReviewEnabled) {chkDiffReviewEnabled.checked = !!state.currentSettings.diffReviewEnabled;}

    const statsEnabled = !!state.currentSettings.showStats;
    [chkShowCursorPosition, chkStatsLines, chkStatsWords, chkStatsChars, chkStatsReadingTime].forEach((el) => {
        const item = el?.closest('.setting-item') as HTMLElement | null;
        if (item) {item.style.display = statsEnabled ? 'flex' : 'none';}
    });

    // Line numbers
    document.body.classList.toggle('show-line-numbers', livePreviewGutterLineNumbersEnabled());

    const tocPanel = $('tocPanel');
    if (state.hostSettingsLoaded) {
        if (container) {container.classList.toggle('toc-open', !!state.currentSettings.showOutline);}
        if (tocPanel) {tocPanel.classList.toggle('hidden', !state.currentSettings.showOutline);}
    }

    // The whole diff-review affordance (toolbar icon, HUD, overlay) hinges on
    // this setting — hide the entry point and tear down anything already
    // showing rather than leaving an inert button or an overlay the setting
    // says shouldn't exist.
    state.toolbarManager?.setButtonVisibility('toggleDiffButton', !!state.currentSettings.diffReviewEnabled);
    if (!state.currentSettings.diffReviewEnabled && state.diffVisible) {
        hideDiskDiff(true);
    }

    if (persist) {
        post({ command: 'updateSettings', settings: state.currentSettings });
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
            defaultValue: !!state.currentSettings.isDefaultEditor,
            onChange: (val: boolean) => {
                post({ command: val ? 'enableAsDefault' : 'disableDefaultEditor' });
            }
        },
        {
            id: 'chkShowOutline',
            section: 'General',
            label: 'Show Outline',
            tooltip: 'Display the document outline panel for heading navigation.',
            defaultValue: state.currentSettings.showOutline,
            onChange: (val: boolean) => {
                state.currentSettings.showOutline = val;
                applySettings(state.currentSettings, true);
            }
        },
        {
            id: 'chkAutoSave',
            section: 'General',
            label: 'Enable Autosave',
            tooltip: 'Automatically save Markdown edits after a short debounce.',
            defaultValue: state.currentSettings.autoSave,
            onChange: (val: boolean) => {
                state.currentSettings.autoSave = val;
                applySettings(state.currentSettings, true);
            }
        },
        {
            id: 'chkDiffReviewEnabled',
            section: 'General',
            label: 'Review External Changes as a Diff',
            tooltip: 'When the file changes outside the editor, show what changed as a diff you can accept or reject piece by piece. Turn off to just choose between loading the disk version or keeping yours, with no diff view.',
            defaultValue: state.currentSettings.diffReviewEnabled,
            onChange: (val: boolean) => {
                state.currentSettings.diffReviewEnabled = val;
                applySettings(state.currentSettings, true);
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
            defaultValue: state.currentSettings.stickyToolbar,
            onChange: (val: boolean) => {
                state.currentSettings.stickyToolbar = val;
                applySettings(state.currentSettings, true);
            }
        },
        {
            id: 'chkWordWrap',
            section: 'Layout',
            label: 'Enable Line Wrap',
            tooltip: 'Wrap long lines in the editor to the pane width instead of horizontal scrolling.',
            defaultValue: state.currentSettings.wordWrap,
            onChange: (val: boolean) => {
                state.currentSettings.wordWrap = val;
                applySettings(state.currentSettings, true);
            }
        },
        {
            id: 'chkShowLineNumbers',
            section: 'Layout',
            label: 'Show Line Numbers',
            tooltip: 'Show line numbers in the editor gutter. Click a number to select that line.',
            defaultValue: livePreviewGutterLineNumbersEnabled(),
            onChange: (val: boolean) => {
                state.currentSettings.livePreviewLineNumbers = val;
                state.currentSettings.showLineNumbers = val;
                applySettings(state.currentSettings, true);
            }
        },
        {
            id: 'chkLivePreviewReveal',
            section: 'Layout',
            label: 'Enable Live Preview Reveal',
            tooltip: 'In Preview Edit mode, reveal raw markdown syntax (##, **, *) near the cursor and hide it elsewhere.',
            defaultValue: state.currentSettings.livePreviewReveal,
            onChange: (val: boolean) => {
                state.currentSettings.livePreviewReveal = val;
                applySettings(state.currentSettings, true);
            }
        },
        {
            id: 'chkShowStats',
            section: 'Document Stats',
            label: 'Show Document Stats',
            tooltip: 'Show document stats and cursor position in the status bar.',
            defaultValue: state.currentSettings.showStats,
            onChange: (val: boolean) => {
                state.currentSettings.showStats = val;
                applySettings(state.currentSettings, true);
            }
        },
        {
            id: 'chkShowCursorPosition',
            section: 'Document Stats',
            label: 'Show Current Line',
            tooltip: 'Show the current line and column position (Ln X, Col Y) in the status bar.',
            className: 'setting-dependent setting-stats-dependent',
            defaultValue: state.currentSettings.showCursorPosition,
            onChange: (val: boolean) => {
                state.currentSettings.showCursorPosition = val;
                applySettings(state.currentSettings, true);
            }
        },
        {
            id: 'chkStatsLines',
            section: 'Document Stats',
            label: 'Show Lines',
            tooltip: 'Show the line count in the status bar.',
            className: 'setting-dependent setting-stats-dependent',
            defaultValue: state.currentSettings.statsShowLines,
            onChange: (val: boolean) => {
                state.currentSettings.statsShowLines = val;
                applySettings(state.currentSettings, true);
            }
        },
        {
            id: 'chkStatsWords',
            section: 'Document Stats',
            label: 'Show Words',
            tooltip: 'Show the word count in the status bar.',
            className: 'setting-dependent setting-stats-dependent',
            defaultValue: state.currentSettings.statsShowWords,
            onChange: (val: boolean) => {
                state.currentSettings.statsShowWords = val;
                applySettings(state.currentSettings, true);
            }
        },
        {
            id: 'chkStatsChars',
            section: 'Document Stats',
            label: 'Show Characters',
            tooltip: 'Show the character count in the status bar.',
            className: 'setting-dependent setting-stats-dependent',
            defaultValue: state.currentSettings.statsShowChars,
            onChange: (val: boolean) => {
                state.currentSettings.statsShowChars = val;
                applySettings(state.currentSettings, true);
            }
        },
        {
            id: 'chkStatsReadingTime',
            section: 'Document Stats',
            label: 'Show Reading Time',
            tooltip: 'Show estimated reading time in the status bar.',
            className: 'setting-dependent setting-stats-dependent',
            defaultValue: state.currentSettings.statsShowReadingTime,
            onChange: (val: boolean) => {
                state.currentSettings.statsShowReadingTime = val;
                applySettings(state.currentSettings, true);
            }
        }
    ];

    SettingsManager.renderPanel(document.body, 'settingsPanel', 'settingsCancelButton', settingsDefs);

    new SettingsManager('openSettingsButton', 'settingsPanel', 'settingsCancelButton', settingsDefs);

    const versionHistoryBtn = $('openVersionHistorySetting');
    if (versionHistoryBtn) {
        versionHistoryBtn.addEventListener('click', () => {
            post({ command: 'showVersionHistory' });
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

    if (state.currentSettings.stickyToolbar) {
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
    if (state.toolbarManager) {
        state.toolbarManager.updateHeaderHeight();
    } else {
        syncMdHeaderHeight();
    }
}

// ===== Message Handler =====
initSaveSync({
    updateEditToolbarButtons,
    updateVersionPreviewChrome,
    updateStatusInfo,
    refreshOutline: (content) => refreshCm6Toc(content),
    reapplySearch,
    diff: {
        show: showDiskDiff,
        hide: hideDiskDiff,
        hasBaseline: hasDiskDiffBaseline,
        updateChrome: updateDiffChrome,
    },
});

window.addEventListener('message', (event) => {
    const m = event.data as HostToMarkdownWebview;
    if (!m || typeof m !== 'object' || !('command' in m)) { return; }

    switch (m.command) {
        case 'initMarkdown':
            $('content')?.classList.remove('is-loading');
            const loading = $('loadingIndicator');
            if (loading) {loading.style.display = 'none';}

            state.currentContent = m.content || '';
            state.originalContent = state.currentContent;
            state.documentUri = m.documentUri || '';
            state.documentDirUri = m.documentDirUri || '';
            state.workspaceFolderUri = m.workspaceFolderUri || null;
            state.currentTableColumnWidths = m.tableColumnWidths || {};
            state.frontmatterPanelCollapsed = !!m.frontmatterPanelCollapsed;
            state.mermaidPreviewMode = m.mermaidPreviewMode === 'code' ? 'code' : 'diagram';
            state.calloutDefaultType = typeof m.calloutDefaultType === 'string' && /^[\w-]*$/.test(m.calloutDefaultType)
                ? m.calloutDefaultType.toLowerCase()
                : 'info';
            state.resolvedImageUriCache.clear();
            if (isLivePreviewActive()) {
                setLivePreviewMermaidMode(state.mermaidPreviewMode);
                setLivePreviewCalloutDefaultType(state.calloutDefaultType);
                applyReloadedContent(state.currentContent);
            }
            updateStatusInfo();
            updateEditToolbarButtons();
            break;

        case 'diskChangedExternally':
            onDiskChangedExternally(m);
            break;

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
            onReloadFromDiskError(m);
            break;

        case 'openRelativeFileFailed':
            showToast(m.message || 'File not found', undefined, { icon: 'warning' });
            break;

        case 'diskDeletedExternally':
            state.pendingDiskDeleted = true;
            showToast('File deleted from disk', undefined, { persistent: true, icon: 'warning' });
            updateEditToolbarButtons();
            break;

        case 'initSettings':
            state.hostSettingsLoaded = true;
            applySettings(m.settings, false);
            if (!state.hasEnteredPreviewEdit) {
                state.hasEnteredPreviewEdit = true;
                enterPreviewEditMode();
            }
            break;

        case 'settingsUpdated':
            state.hostSettingsLoaded = true;
            applySettings(m.settings, false);
            break;

        case 'saveResult':
            onSaveResult(m);
            break;

        case 'saveConflict':
            onSaveConflict();
            break;

        case 'versionHistoryError':
            showToast(m.message || 'Version history failed', undefined, { icon: 'warning' });
            break;

        case 'versionPreviewMd':
            onVersionPreview(m);
            break;

        case 'versionPreviewCancelledMd':
            onVersionPreviewCancelled();
            break;

        case 'restoreConflict':
            onRestoreConflict(m);
            break;

        case 'versionRestoredMd':
            onVersionRestored();
            break;

        case 'resolvedImageUris':
            applyResolvedImageUris(m.resolved || {});
            break;

        default: {
            // Compile-time check that every host message has a handler: only the feedback modal's
            // messages may reach here. A new HostToMarkdownWebview member fails to compile until handled.
            const handledByFeedbackModal: HandledByFeedbackModal = m;
            void handledByFeedbackModal;
        }
    }
});

// ===== Button Handlers =====
function wireButtons() {
    state.toolbarManager = new ToolbarManager('toolbar');
    state.toolbarManager.setHeaderHeightHook(() => syncMdHeaderHeight());

    state.toolbarManager.setButtons(buildToolbarButtons());
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
        if (state.isEditMode) {
            performSave();
        }
        return;
    }

    if (isCmdOrCtrl && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleSearchOverlay();
        return;
    }

    if (e.key === 'F7' && state.diffVisible) {
        e.preventDefault();
        if (e.shiftKey) {
            goToPrevLivePreviewDiffChunk();
        } else {
            goToNextLivePreviewDiffChunk();
        }
        updateDiffChrome();
        return;
    }

    if (isCmdOrCtrl && e.key.toLowerCase() === 'a' && state.isEditMode && isLivePreviewActive()) {
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
        if (state.isEditMode) {
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
            state.currentSettings.showOutline = false;
            applySettings(state.currentSettings, true);
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
if (state.currentSettings) {
    applySettings(state.currentSettings);
}

post({ command: 'webviewReady' });
