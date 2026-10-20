// Saving, autosave, reloading from disk, external-change decisions and version preview for the
// Markdown webview. Host messages for these flows are routed here from mdWebview.ts's message
// handler. Pinned by src/test/webview/markdownSaveSync.spec.mts. Runtime: WEBVIEW (browser).

import { Utils } from '../shared/utils';
import {
    getLivePreviewContent,
    isLivePreviewActive,
    refreshLivePreviewImages,
    setLivePreviewCalloutDefaultType,
    setLivePreviewContent,
    setLivePreviewMermaidMode,
    setLivePreviewReadOnly,
} from './livePreview/livePreviewEditor';
import { diffLineStats, formatDiffLineStats } from './diffStats';
import { sanitizeMarkdownCopyLinkArtifacts } from './copyLinkArtifacts';
import { confirmDiscardAndReload, confirmOverwriteConflict, confirmOverwriteWithLocal, confirmRestoreConflict } from './dialogs';
import { post } from './messaging';
import { state } from './state';
import { hideToast, showToast } from './toast';
import type { MessageOf } from '../../protocol/common';
import type { HostToMarkdownWebview } from '../../protocol/markdown';

const $ = Utils.$;

/** What saveSync needs from the rest of the webview (outline, search, status bar, diff, toolbar). */
export interface SaveSyncHooks {
    updateEditToolbarButtons(): void;
    updateVersionPreviewChrome(): void;
    updateStatusInfo(): void;
    refreshOutline(content: string): void;
    reapplySearch(): void;
    diff: {
        show(): void;
        hide(forget?: boolean): void;
        hasBaseline(): boolean;
        updateChrome(): void;
    };
}

let hooks: SaveSyncHooks;

/** Call once at startup, before any host message is handled. */
export function initSaveSync(h: SaveSyncHooks): void {
    hooks = h;
}

export function setButtonsEnabled(enabled: boolean) {
    const ids = ['openSettingsButton'];
    ids.forEach((id) => {
        const el = $(id) as HTMLButtonElement;
        if (el) {el.disabled = !enabled;}
    });
    hooks.updateEditToolbarButtons();
}

export function isEditorDirty(): boolean {
    return state.currentContent !== state.originalContent;
}

export function canReloadFromDisk(): boolean {
    if (!state.isEditMode || state.isSaving || state.isReloadingFromDisk) {
        return false;
    }
    return state.pendingDiskContent !== null || state.pendingDiskDeleted || isEditorDirty();
}


// The single reader over the editing surfaces.
export function getActiveEditorContent(): string {
    if (isLivePreviewActive()) {
        const cm6 = getLivePreviewContent();
        if (cm6 !== null) {
            return sanitizeMarkdownCopyLinkArtifacts(cm6);
        }
    }
    return state.currentContent;
}

export function cancelEdit() {
    state.currentContent = state.originalContent;
    if (isLivePreviewActive()) {
        setLivePreviewContent(state.originalContent);
        hooks.refreshOutline(state.originalContent);
        hooks.reapplySearch();
        hooks.updateStatusInfo();
    }
    hooks.updateEditToolbarButtons();
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
            post({ command: 'restoreVersion' });
        });
        cancelBtn?.addEventListener('click', () => {
            post({ command: 'cancelVersionPreview' });
        });
    }

    return banner;
}

export function setVersionPreviewMode(enabled: boolean, label?: string) {
    // Version preview swaps displayed content through its own pipeline; running
    // the diff overlay at the same time would leave two systems fighting over
    // the same document.
    if (enabled && state.diffVisible) {
        hooks.diff.hide(true);
    }
    state.isVersionPreviewMode = enabled;
    document.body.classList.toggle('version-preview-mode', enabled);
    if (enabled) {
        setLivePreviewReadOnly(true);
        hooks.updateVersionPreviewChrome();
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
        hooks.updateVersionPreviewChrome();
    }
}

export function performSave(isAutosave = false) {
    if (state.isSaving || !state.isEditMode || state.isVersionPreviewMode) {return;}
    if (!isEditorDirty()) {return;}
    if (state.pendingDiskContent !== null) {
        // Autosave never interrupts with a dialog over an unresolved conflict — it
        // just skips this tick; the next edit reschedules and tries again.
        if (isAutosave) {return;}
        confirmOverwriteConflict().then((confirmed) => {
            if (!confirmed) {return;}
            state.pendingDiskContent = null;
            hideToast();
            doSave(false, isAutosave);
        });
        return;
    }
    doSave(false, isAutosave);
}

let lastSaveWasAutosave = false;

export function doSave(force = false, isAutosave = false) {
    state.isSaving = true;
    lastSaveWasAutosave = isAutosave;
    setButtonsEnabled(false);
    state.currentContent = getActiveEditorContent();
    state.pendingSaveContent = state.currentContent;
    post({ command: 'saveMarkdown', text: state.currentContent, force, isAutosave });
}

let autoSaveTimer: number | null = null;

export function scheduleAutosave() {
    if (!state.currentSettings.autoSave || !state.isEditMode || state.isVersionPreviewMode) {return;}
    if (autoSaveTimer !== null) {window.clearTimeout(autoSaveTimer);}
    autoSaveTimer = window.setTimeout(() => {
        autoSaveTimer = null;
        if (!state.currentSettings.autoSave || !state.isEditMode || state.isSaving) {return;}
        if (getActiveEditorContent() === state.originalContent) {return;}
        performSave(true);
    }, 1200);
}

// Pushes freshly-read disk content into whichever surface is currently active.
export function applyReloadedContent(text: string) {
    state.currentContent = text;
    state.originalContent = text;
    state.resolvedImageUriCache.clear();

    if (isLivePreviewActive()) {
        setLivePreviewContent(text);
        refreshLivePreviewImages();
        hooks.refreshOutline(text);
        hooks.reapplySearch();
    }

    hooks.updateStatusInfo();
    hooks.updateEditToolbarButtons();
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
        post({ command: 'webviewReady' });
    });

    loading.append(text, retryBtn);
}

// Manual "Reload from disk" toolbar button handler.
export async function requestReloadFromDisk() {
    if (state.isSaving || state.isReloadingFromDisk || !state.isEditMode || !canReloadFromDisk()) {return;}
    state.currentContent = getActiveEditorContent();
    const dirty = state.currentContent !== state.originalContent;
    if (dirty) {
        const decision = await confirmDiscardAndReload();
        if (decision === 'cancel') {return;}
        if (decision === 'keepLocal') {
            if (state.isSaving) {return;}
            state.pendingDiskContent = null;
            hideToast();
            doSave(true);
            return;
        }
    }
    state.isReloadingFromDisk = true;
    setButtonsEnabled(false);
    post({ command: 'requestFreshData' });
}

// ===== Host messages =====

export function onDiskChangedExternally(m: MessageOf<HostToMarkdownWebview, 'diskChangedExternally'>) {
    state.documentUri = m.documentUri || state.documentUri;
    state.documentDirUri = m.documentDirUri || state.documentDirUri;
    state.workspaceFolderUri = m.workspaceFolderUri || state.workspaceFolderUri;
    state.currentTableColumnWidths = m.tableColumnWidths || state.currentTableColumnWidths;
    state.mermaidPreviewMode = m.mermaidPreviewMode === 'code' ? 'code' : state.mermaidPreviewMode;
    if (typeof m.calloutDefaultType === 'string' && /^[\w-]*$/.test(m.calloutDefaultType)) {
        state.calloutDefaultType = m.calloutDefaultType.toLowerCase();
    }
    if (isLivePreviewActive()) {
        setLivePreviewMermaidMode(state.mermaidPreviewMode);
        setLivePreviewCalloutDefaultType(state.calloutDefaultType);
    }

    const wasManualReload = state.isReloadingFromDisk;
    if (state.isReloadingFromDisk) {
        state.isReloadingFromDisk = false;
        setButtonsEnabled(true);
    }

    // A real change supersedes any prior "deleted" notification.
    state.pendingDiskDeleted = false;

    const incomingContent = m.content || '';

    // Own-save echoes and other redundant watcher ticks — disk matches what
    // is already in the editor, so there is nothing to reload or diff.
    if (!wasManualReload && incomingContent === getActiveEditorContent()) {
        return;
    }

    // Capture what is on screen right now as the diff baseline, but only
    // if no comparison is already pending — a burst of external writes
    // should still diff against what the user last actually saw.
    if (state.diffBaseline === null) {
        state.diffBaseline = state.currentContent;
        state.diffAcceptedCount = 0;
        state.diffRejectedCount = 0;
    }
    const incomingLabel = formatDiffLineStats(diffLineStats(state.diffBaseline, incomingContent));

    // An explicit reload request applies directly — the persistent toast
    // below is only for unprompted watcher-detected changes.
    if (wasManualReload || !state.isEditMode) {
        state.pendingDiskContent = null;
        applyReloadedContent(incomingContent);
        showToast(
            incomingLabel ? `Reloaded from disk \u00B7 ${incomingLabel}` : 'Reloaded from disk',
            hooks.diff.hasBaseline() && state.currentSettings.diffReviewEnabled
                ? { label: 'Review changes', onClick: () => hooks.diff.show() }
                : undefined
        );
        hooks.updateEditToolbarButtons();
        hooks.diff.updateChrome();
        return;
    }

    // Diffing is non-destructive — local edits become the rejectable
    // side of the comparison rather than being discarded — so this path
    // never needs a "you have unsaved edits" confirm. It replaces the
    // toast decision entirely: the diff HUD (itself a toast — "File
    // changed on disk" header, Accept All/Reject All in its actions
    // row) is what the old "Load disk changes"/"Keep local version"
    // toast used to be.
    if (state.currentSettings.diffReviewEnabled) {
        applyReloadedContent(incomingContent);
        state.pendingDiskContent = null;
        hooks.diff.show();
        hooks.updateEditToolbarButtons();
        return;
    }

    // Diff review disabled: the only two ways to resolve are a full
    // reload or a full overwrite, each with its own confirm dialog
    // since — unlike the diff — either one can genuinely discard work.
    state.pendingDiskContent = incomingContent;

    const applyPending = () => {
        if (state.pendingDiskContent === null) {return;}
        applyReloadedContent(state.pendingDiskContent);
        state.pendingDiskContent = null;
        showToast('Reloaded from disk');
    };
    const reloadPending = () => {
        // Never dead-end: if the queued content was already consumed (a
        // second watcher event) ask the host for a fresh read instead of
        // silently doing nothing.
        if (state.pendingDiskContent === null) {
            void requestReloadFromDisk();
            return;
        }
        const dirty = state.isEditMode && getActiveEditorContent() !== state.originalContent;
        if (dirty) {
            confirmDiscardAndReload().then((decision) => {
                if (decision === 'reload') {
                    applyPending();
                } else if (decision === 'keepLocal' && !state.isSaving) {
                    state.pendingDiskContent = null;
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
            if (!confirmed || state.isSaving) {return;}
            state.pendingDiskContent = null;
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
    hooks.updateEditToolbarButtons();
    hooks.diff.updateChrome();
}

export function onReloadFromDiskError(m: MessageOf<HostToMarkdownWebview, 'reloadFromDiskError'>) {
    if (state.isReloadingFromDisk) {
        state.isReloadingFromDisk = false;
        setButtonsEnabled(true);
        showToast('Error reloading from disk', undefined, { icon: 'warning' });
    } else if (!state.hasEnteredPreviewEdit) {
        showInitialLoadError(m.message || 'Failed to load Markdown file');
    } else {
        showToast(m.message || 'Error reloading from disk', undefined, { icon: 'warning' });
    }
}

export function onSaveResult(m: MessageOf<HostToMarkdownWebview, 'saveResult'>) {
    state.isSaving = false;
    setButtonsEnabled(true);
    if (m.ok) {
        showToast(m.isAutosave ? 'Autosaved' : 'Saved');
        if (state.pendingSaveContent !== null) {
            state.originalContent = state.pendingSaveContent;
        }
        state.pendingSaveContent = null;
        // A successful save recreates the file if it had been deleted externally.
        state.pendingDiskDeleted = false;
        // The saved document is the new reference point; the old baseline
        // no longer describes anything the user can act on.
        hooks.diff.hide(true);
    } else {
        state.pendingSaveContent = null;
        showToast(m.isAutosave ? 'Autosave failed' : 'Error saving', undefined, { icon: 'warning' });
    }
    hooks.updateEditToolbarButtons();
}

export function onSaveConflict() {
    state.isSaving = false;
    state.pendingSaveContent = null;
    setButtonsEnabled(true);
    if (lastSaveWasAutosave) {
        // Autosave never interrupts with a dialog; the file watcher will
        // independently surface the usual "file changed on disk" toast.
        return;
    }
    confirmOverwriteConflict().then((confirmed) => {
        if (confirmed) {doSave(true);}
    });
}

export function onVersionPreview(m: MessageOf<HostToMarkdownWebview, 'versionPreviewMd'>) {
    setVersionPreviewMode(true, m.timestamp ? `Previewing ${new Date(m.timestamp).toLocaleString()} (read-only)` : 'Previewing selected version (read-only)');
    showToast('Previewing version');
}

export function onVersionPreviewCancelled() {
    setVersionPreviewMode(false);
    showToast('Preview canceled');
}

export function onRestoreConflict(m: MessageOf<HostToMarkdownWebview, 'restoreConflict'>) {
    confirmRestoreConflict().then((confirmed) => {
        if (confirmed) {
            post({ command: 'restoreVersion', versionId: m.versionId, force: true });
        }
    });
}

export function onVersionRestored() {
    setVersionPreviewMode(false);
    showToast('Version restored');
}
