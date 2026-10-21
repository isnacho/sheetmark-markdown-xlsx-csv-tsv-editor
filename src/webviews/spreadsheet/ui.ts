// Small DOM helpers of the spreadsheet webview: loading overlay, edit-toolbar enablement, and the
// per-cell "original value" stamps edit mode compares against. Runtime: WEBVIEW (browser).

import { getCellNormalizedValue } from './cellValues';

export function setButtonsEnabled(enabled: boolean) {
    const saveBtn = document.getElementById('saveTableEditsButton') as HTMLButtonElement;
    const cancelBtn = document.getElementById('cancelTableEditsButton') as HTMLButtonElement;
    if (saveBtn) {saveBtn.disabled = !enabled;}
    if (cancelBtn) {cancelBtn.disabled = !enabled;}
}

export function setLoadingText(text: string) {
    const el = document.querySelector('.loading-text');
    if (el) {el.textContent = text;}
}

export function showLoading() {
    const el = document.getElementById('loadingOverlay');
    if (el) {el.classList.remove('hidden');}
}

export function hideLoading() {
    const el = document.getElementById('loadingOverlay');
    if (el) {el.classList.add('hidden');}
}

export function captureOriginalCellValues() {
    const table = document.querySelector('#tableContainer table');
    if (!table) {return;}
    table.querySelectorAll('td.editable-cell').forEach(td => {
        const htmlTd = td as HTMLElement;
        const currentText = getCellNormalizedValue(htmlTd);
        htmlTd.dataset.originalText = currentText;
        htmlTd.dataset.originalHtml = htmlTd.innerHTML;
    });
}
