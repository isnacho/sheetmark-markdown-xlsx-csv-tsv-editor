// Tab-separated clipboard format shared with Excel / Google Sheets. Pure: no DOM.
//
// Cells that contain a tab, newline or quote are wrapped in quotes with inner quotes doubled, so a
// multi-line cell (Shift+Enter) survives copy and paste as one cell instead of becoming extra rows.

function quoteField(value: string): string {
    return /[\t\r\n"]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}

/** Rows of cell text to clipboard TSV. */
export function serializeTsv(rows: readonly (readonly string[])[]): string {
    return rows.map(row => row.map(quoteField).join('\t')).join('\n');
}

function naiveParse(text: string): string[][] {
    const lines = text.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === '') { lines.pop(); }
    return lines.map(line => line.split('\t'));
}

/**
 * Clipboard TSV to rows of cell text. Honors quoted fields (embedded tabs, newlines, `""`). A field
 * is quoted only when it starts with `"`; if a quote is never closed the text is treated as plain
 * (split on every tab and newline), so stray quotes in pasted prose don't swallow the rest.
 */
export function parseTsv(text: string): string[][] {
    if (!text.includes('"')) { return naiveParse(text); }

    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let i = 0;
    let fieldStart = true;

    while (i < text.length) {
        const ch = text[i];
        if (fieldStart && ch === '"') {
            const close = findClosingQuote(text, i + 1);
            if (close < 0) { return naiveParse(text); }
            field = text.slice(i + 1, close).replace(/""/g, '"');
            i = close + 1;
            fieldStart = false;
            continue;
        }
        fieldStart = false;
        if (ch === '\t') {
            row.push(field); field = ''; fieldStart = true; i++;
        } else if (ch === '\n' || ch === '\r') {
            row.push(field); rows.push(row); row = []; field = ''; fieldStart = true;
            i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
        } else {
            field += ch; i++;
        }
    }
    if (!fieldStart || field || row.length > 0) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}

/** Index of the quote that closes a field opened just before `from`, skipping `""` escapes; -1 if none. */
function findClosingQuote(text: string, from: number): number {
    let i = from;
    while (i < text.length) {
        if (text[i] === '"') {
            if (text[i + 1] === '"') { i += 2; continue; }
            return i;
        }
        i++;
    }
    return -1;
}
