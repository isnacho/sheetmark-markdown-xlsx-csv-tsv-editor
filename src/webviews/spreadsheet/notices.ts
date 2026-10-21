// Two small dialogs: the merge warning (merging keeps only the top-left value; can be snoozed for a
// day) and the notice asking whether to switch a CSV/TSV to styled mode. Runtime: WEBVIEW (browser).

import { state } from './state';
import { post } from './messaging';

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

export function hideStyleModeNoticePopup() {
    if (!state.styleModeNoticePopupEl) {return;}
    state.styleModeNoticePopupEl.classList.add('hidden');
}

export function submitStyleModeDecision(decision: 'continue' | 'convert' | 'cancel') {
    hideStyleModeNoticePopup();
    if (!state.styleModeRequestPending) {
        return;
    }
    post({ command: 'styleModeDecision', decision });
}

export function ensureStyleModeNoticePopup() {
    if (state.styleModeNoticePopupEl) {return state.styleModeNoticePopupEl;}

    const popup = document.createElement('div');
    popup.id = 'xlsxStyleModeNoticePopup';
    popup.className = 'xlsx-style-mode-notice-popup hidden';
    popup.innerHTML = `
        <div class="xlsx-style-mode-notice-dialog" role="dialog" aria-modal="true" aria-labelledby="styleModeNoticeTitle">
            <div id="styleModeNoticeTitle" class="style-mode-notice-title">Style Mode for CSV/TSV</div>
            <div class="style-mode-notice-message">CSV/TSV files do not store formatting in the file itself.</div>
            <div class="style-mode-notice-message">
                Styled edits are saved only as local extension data and expire after 48 hours from the last styled edit.
                To preserve formatting permanently, convert this file to XLSX.
            </div>
            <div class="style-mode-notice-actions">
                <button id="styleModeNoticeCancel" type="button" class="toggle-button">Keep Plain Mode</button>
                <button id="styleModeNoticeContinue" type="button" class="toggle-button">Continue Styled Mode</button>
                <button id="styleModeNoticeConvert" type="button" class="toggle-button">Convert to XLSX</button>
            </div>
        </div>
    `;

    popup.addEventListener('click', (e) => {
        if (e.target === popup) {
            submitStyleModeDecision('cancel');
        }
    });

    const cancelBtn = popup.querySelector('#styleModeNoticeCancel') as HTMLButtonElement | null;
    const continueBtn = popup.querySelector('#styleModeNoticeContinue') as HTMLButtonElement | null;
    const convertBtn = popup.querySelector('#styleModeNoticeConvert') as HTMLButtonElement | null;

    cancelBtn?.addEventListener('click', () => submitStyleModeDecision('cancel'));
    continueBtn?.addEventListener('click', () => submitStyleModeDecision('continue'));
    convertBtn?.addEventListener('click', () => submitStyleModeDecision('convert'));

    popup.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            submitStyleModeDecision('cancel');
        }
    });

    document.body.appendChild(popup);
    state.styleModeNoticePopupEl = popup;
    return popup;
}

export function showStyleModeNoticePopup() {
    const popup = ensureStyleModeNoticePopup();
    popup.classList.remove('hidden');
    const continueBtn = popup.querySelector('#styleModeNoticeContinue') as HTMLButtonElement | null;
    continueBtn?.focus();
}
