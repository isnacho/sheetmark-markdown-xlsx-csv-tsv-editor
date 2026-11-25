// Small DOM helpers of the spreadsheet webview: the loading overlay. Runtime: WEBVIEW (browser).

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
