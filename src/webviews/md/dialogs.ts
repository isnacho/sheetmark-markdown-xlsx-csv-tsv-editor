// Confirm dialogs for the Markdown webview. Runtime: WEBVIEW (browser).

import { confirmModal } from '../shared/confirmModal';

export type ReloadDecision = 'reload' | 'keepLocal' | 'cancel';

// 'keepLocal' is a real action (force-write to disk) distinct from 'cancel', which
// stays the passive backdrop/click-outside no-op it always was.
export function confirmDiscardAndReload(): Promise<ReloadDecision> {
    return confirmModal(
        'Reload from Disk',
        'Discard unsaved changes and reload from disk?',
        'Discard & Reload',
        'Keep mine, ignore disk'
    ).then((r) => (r === 'confirm' ? 'reload' : r === 'secondary' ? 'keepLocal' : 'cancel'));
}

export function confirmOverwriteConflict(): Promise<boolean> {
    return confirmModal(
        'File Changed on Disk',
        'This file changed on disk since you opened it. Overwrite it with your local changes anyway?',
        'Overwrite'
    ).then((r) => r === 'confirm');
}

export function confirmRestoreConflict(): Promise<boolean> {
    return confirmModal(
        'File Changed on Disk',
        'This file changed on disk since you opened it. Restore the selected version anyway? Your disk changes will be lost.',
        'Restore Anyway'
    ).then((r) => r === 'confirm');
}

export function confirmOverwriteWithLocal(): Promise<boolean> {
    return confirmModal('Keep Local Version', 'Overwrite disk with your version?', 'Overwrite disk')
        .then((r) => r === 'confirm');
}
