// What the spreadsheet does when its file changes on disk, mirroring the Markdown editor (md/saveSync.ts)
// with one difference: a spreadsheet save writes only the cells you edited into the file as it is on
// disk, so "keep my edits" never overwrites the whole file.
//
//   - The host never reloads on its own. It posts `diskChangedExternally`; a persistent toast offers
//     "Load disk changes" and, when there are unsaved edits, "Keep my edits".
//   - A manual save over a changed file asks first (the host answers `saveConflict`); autosave never
//     shows a dialog: it shows the toast and pauses until the user picks.
//
// Runtime: WEBVIEW (browser).

import { confirmModal } from '../shared/confirmModal';
import { hideToast, showToast } from '../shared/toast';
import { state } from './state';

export interface DiskSyncHooks {
    isDirty(): boolean;
    /** Save the unsaved edits even though the file changed on disk. */
    saveOverChangedFile(): void;
    /** Throw away unsaved edits and ask the host for the file again. */
    reloadFromDisk(): void;
}

let hooks: DiskSyncHooks;
/** Whether the toast on screen was built for unsaved edits (it has a Keep my edits button). */
let toastShownDirty = false;

export function initDiskSync(h: DiskSyncHooks): void {
    hooks = h;
}

/** True while the file on disk differs from what is loaded and the user has not chosen yet. Autosave waits. */
export function isDiskChangePending(): boolean {
    return state.diskChanged;
}

function showDiskChangedToast(): void {
    const dirty = hooks.isDirty();
    toastShownDirty = dirty;
    const actions = [{ label: 'Load disk changes', onClick: () => { void loadDiskChanges(); } }];
    if (dirty) {
        actions.push({ label: 'Keep my edits', onClick: () => { void keepMyEdits(); } });
    }
    showToast('File changed on disk', actions, { persistent: true, hideCloseButton: true, icon: 'warning' });
}

/** The host says the file changed. The toast stays (and Load disk changes loads the latest) if it changes again. */
export function onDiskChangedExternally(): void {
    state.diskChanged = true;
    showDiskChangedToast();
}

/** Called when unsaved edits appear or are gone, so the toast offers Keep my edits exactly when it applies. */
export function refreshDiskChangedToast(): void {
    if (state.diskChanged && hooks.isDirty() !== toastShownDirty) {
        showDiskChangedToast();
    }
}

async function loadDiskChanges(): Promise<void> {
    if (hooks.isDirty()) {
        const outcome = await confirmModal('Reload from Disk', 'Discard unsaved changes and reload from disk?', 'Discard & Reload');
        if (outcome !== 'confirm') {return;}
    }
    state.diskChanged = false;
    hideToast();
    hooks.reloadFromDisk();
}

async function confirmSaveIntoChangedFile(): Promise<boolean> {
    const outcome = await confirmModal(
        'Save your edits into the changed file?',
        'Cells you edited get your values; other changes on disk are kept.',
        'Save my edits'
    );
    return outcome === 'confirm';
}

async function keepMyEdits(): Promise<void> {
    if (!await confirmSaveIntoChangedFile()) {return;}
    state.diskChanged = false;
    hideToast();
    hooks.saveOverChangedFile();
}

/** The host refused a save because the file changed on disk. */
export async function onSaveConflict(wasAutosave: boolean): Promise<void> {
    if (wasAutosave) {
        // Autosave never opens a dialog: say so and wait for the user to choose.
        onDiskChangedExternally();
        return;
    }
    if (await confirmSaveIntoChangedFile()) {
        state.diskChanged = false;
        hideToast();
        hooks.saveOverChangedFile();
        return;
    }
    onDiskChangedExternally();
}
