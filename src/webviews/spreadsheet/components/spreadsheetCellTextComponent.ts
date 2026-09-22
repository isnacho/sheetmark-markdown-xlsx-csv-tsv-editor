const BR_TAG_RE = /<br\s*\/?>/gi;

/** Walk editable cell DOM and preserve line breaks as `\n`. */
export function serializeEditableCellText(root: HTMLElement): string {
    let out = '';
    const walk = (node: Node): void => {
        if (node.nodeType === Node.TEXT_NODE) {
            out += node.textContent ?? '';
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) { return; }
        const element = node as HTMLElement;
        if (element.tagName === 'BR') {
            out += '\n';
            return;
        }
        Array.from(element.childNodes).forEach(walk);
    };
    Array.from(root.childNodes).forEach(walk);
    return out;
}

/** Load plain text (and literal `<br>` tags) into a contenteditable cell. */
export function loadEditableCellContent(el: HTMLElement, rawText: string): void {
    const normalized = String(rawText).replace(/\r\n?/g, '\n').split(BR_TAG_RE).join('\n');
    el.replaceChildren();
    const parts = normalized.split('\n');
    parts.forEach((part, index) => {
        if (part) { el.appendChild(document.createTextNode(part)); }
        if (index < parts.length - 1) { el.appendChild(document.createElement('br')); }
    });
    if (!el.childNodes.length) { el.appendChild(document.createTextNode('')); }
}

export function insertLineBreakAtCaret(el: HTMLElement): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) { return; }
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) { return; }
    range.deleteContents();
    const br = document.createElement('br');
    range.insertNode(br);
    range.setStartAfter(br);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
}

export function escapeHtml(input: string): string {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Render stored cell text for display, preserving line breaks. */
export function formatCellTextHtml(value: string): string {
    if (!value) { return '&nbsp;'; }
    if (/[<&]/.test(value)) {
        return value;
    }
    return escapeHtml(value).replace(/\n/g, '<br>');
}
