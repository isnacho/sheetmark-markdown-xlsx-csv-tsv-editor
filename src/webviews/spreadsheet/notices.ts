// The merge warning dialog (merging keeps only the top-left value; can be snoozed for a day) and
// the legacy-styles notice for CSV/TSV. Runtime: WEBVIEW (browser).

import { state } from './state';
import { post } from './messaging';
import { hideToast, showToast } from '../shared/toast';

export const MERGE_WARNING_SUPPRESS_UNTIL_KEY = 'xlsx.mergeWarningSuppressUntil';

export function isMergeWarningSuppressedForToday() {
    try {
        const raw = window.localStorage.getItem(MERGE_WARNING_SUPPRESS_UNTIL_KEY);
        const until = raw ? parseInt(raw, 10) : 0;
        if (!until || Number.isNaN(until)) {return false;}
        return Date.now() < until;
    } catch {
        return false;
    }
}

export function suppressMergeWarningForOneDay() {
    try {
        const oneDayMs = 24 * 60 * 60 * 1000;
        window.localStorage.setItem(MERGE_WARNING_SUPPRESS_UNTIL_KEY, String(Date.now() + oneDayMs));
    } catch {
        // ignore storage errors
    }
}

export function hideMergeWarningPopup(confirmed: boolean) {
    if (!state.mergeWarningPopupEl || !state.mergeWarningResolver) {return;}

    const skip = state.mergeWarningPopupEl.querySelector('#mergeWarningSkipDay') as HTMLInputElement | null;
    if (confirmed && skip?.checked) {
        suppressMergeWarningForOneDay();
    }

    state.mergeWarningPopupEl.classList.add('hidden');
    const resolver = state.mergeWarningResolver;
    state.mergeWarningResolver = null;
    resolver(confirmed);
}

export function ensureMergeWarningPopup() {
    if (state.mergeWarningPopupEl) {return state.mergeWarningPopupEl;}

    const popup = document.createElement('div');
    popup.id = 'xlsxMergeWarningPopup';
    popup.className = 'xlsx-merge-warning-popup hidden';
    popup.innerHTML = `
        <div class="xlsx-merge-warning-dialog" role="dialog" aria-modal="true" aria-labelledby="mergeWarningTitle">
            <div id="mergeWarningTitle" class="merge-warning-title">Merge Cells</div>
            <div class="merge-warning-message">Only the top-left cell content will be preserved. Continue?</div>
            <label class="merge-warning-skip">
                <input id="mergeWarningSkipDay" type="checkbox" />
                Don't show this for 1 day
            </label>
            <div class="merge-warning-actions">
                <button id="mergeWarningCancel" type="button" class="toggle-button">Cancel</button>
                <button id="mergeWarningConfirm" type="button" class="toggle-button">Merge</button>
            </div>
        </div>
    `;

    popup.addEventListener('click', (e) => {
        if (e.target === popup) {
            hideMergeWarningPopup(false);
        }
    });

    const cancelBtn = popup.querySelector('#mergeWarningCancel') as HTMLButtonElement | null;
    const confirmBtn = popup.querySelector('#mergeWarningConfirm') as HTMLButtonElement | null;

    cancelBtn?.addEventListener('click', () => hideMergeWarningPopup(false));
    confirmBtn?.addEventListener('click', () => hideMergeWarningPopup(true));

    document.body.appendChild(popup);
    state.mergeWarningPopupEl = popup;
    return popup;
}

export async function confirmMergePreserveTopLeftContent() {
    if (!state.currentSettings.mergeWarningEnabled) {return true;}
    if (isMergeWarningSuppressedForToday()) {return true;}

    const popup = ensureMergeWarningPopup();
    const skip = popup.querySelector('#mergeWarningSkipDay') as HTMLInputElement | null;
    if (skip) {skip.checked = false;}
    popup.classList.remove('hidden');

    return await new Promise<boolean>((resolve) => {
        state.mergeWarningResolver = resolve;
    });
}

/** Shown for a CSV/TSV that still has formatting only older versions of Sheetmark stored. */
export const LEGACY_STYLES_NOTICE_TEXT = "This file has formatting saved only in Sheetmark. CSV files can't store formatting, so it is no longer shown. Convert to XLSX to keep it.";

export function showLegacyStylesNotice() {
    showToast(
        LEGACY_STYLES_NOTICE_TEXT,
        [
            { label: 'Convert to XLSX', onClick: () => { hideToast(); post({ command: 'convertToXlsx' }); } },
            { label: 'Dismiss', onClick: () => { hideToast(); post({ command: 'dismissLegacyStyles' }); } },
        ],
        { persistent: true, hideCloseButton: true, icon: 'warning' }
    );
}
