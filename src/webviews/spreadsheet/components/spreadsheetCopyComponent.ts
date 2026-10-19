 

import { htmlToPlainText } from '../../shared/sanitizeHtml';
import { serializeTsv } from './tsvClipboard';

/** Cached cell values can be rich-text HTML; the clipboard gets plain text with real line breaks. */
export function cellValueText(value: unknown): string {
    const raw = value === null || value === undefined ? '' : String(value);
    return /[<&]/.test(raw) ? htmlToPlainText(raw.replace(/<br\s*\/?>/gi, '\n')) : raw;
}

export interface XlsxCopyContext {
    selectedCells: Set<HTMLElement>;
    selectedColumnIndices: Set<number>;
    selectedRowIndices: Set<number>;
    columnCount: number;
    totalRows: number;
    rowCache: Map<number, any>;
    isCopying: boolean;
    setIsCopying: (next: boolean) => void;
    showToast: (message: string) => void;
    requestAllRows: () => Promise<any[]>;
    normalizeCellText: (text: string | null | undefined) => string;
}

function yieldToMain() {
    return new Promise(resolve => {
        requestAnimationFrame(() => {
            setTimeout(resolve, 0);
        });
    });
}

export async function writeToClipboardAsync(text: string) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
            await navigator.clipboard.writeText(text);
            return;
        } catch {
            // fall through to execCommand
        }
    }

    await new Promise<void>((resolve, reject) => {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.cssText = `
            position: fixed;
            left: -9999px;
            top: 0;
            width: 2px;
            height: 2px;
            padding: 0;
            border: none;
            outline: none;
            opacity: 0;
            pointer-events: none;
        `;

        document.body.appendChild(textarea);

        try {
            textarea.focus();
            textarea.select();
            textarea.setSelectionRange(0, text.length);
            const ok = document.execCommand('copy');
            document.body.removeChild(textarea);
            if (ok) {resolve();}
            else {reject(new Error('execCommand("copy") returned false'));}
        } catch (err) {
            document.body.removeChild(textarea);
            reject(err);
        }
    });
}

/**
 * Clipboard text (Excel-style TSV) for the current selection, plus how many cells it covers, or
 * `null` when the full rows could not be fetched. Separate from the clipboard write so it is
 * unit-testable with a fake context.
 */
export async function buildSelectionClipboard(ctx: XlsxCopyContext): Promise<{ text: string; cellCount: number } | null> {
    const hasFullColumnSelection = ctx.selectedColumnIndices.size > 0;
    const hasFullRowSelection = ctx.selectedRowIndices.size > 0;
    const outputRows: string[][] = [];
    const cachedCellText = (rowData: any, col: number): string => {
        const cellData = rowData?.cells ? rowData.cells.find((cell: any) => cell.colNumber === col + 1) : null;
        return cellData ? ctx.normalizeCellText(cellValueText(cellData.value)) : '';
    };

    if (hasFullColumnSelection || hasFullRowSelection) {
        const allRows = await ctx.requestAllRows();
        if (!allRows || allRows.length === 0) { return null; }

        if (allRows.length >= ctx.totalRows * 0.9) {
            allRows.forEach((row, i) => {
                ctx.rowCache.set(i, row);
            });
        }

        const rowCount = allRows.length;
        const sortedCols = Array.from(ctx.selectedColumnIndices).sort((a, b) => a - b);
        const sortedRows = Array.from(ctx.selectedRowIndices).sort((a, b) => a - b);
        const allCols = Array.from({ length: ctx.columnCount }, (_, c) => c);

        if (hasFullColumnSelection && !hasFullRowSelection) {
            for (let r = 0; r < rowCount; r++) {
                outputRows.push(sortedCols.map(c => cachedCellText(allRows[r], c)));
            }
        } else {
            // Whole rows: every column. Rows and columns both selected: their intersection.
            const cols = hasFullColumnSelection ? sortedCols : allCols;
            for (const r of sortedRows) {
                if (r < rowCount) { outputRows.push(cols.map(c => cachedCellText(allRows[r], c))); }
            }
        }

        const cellCount = hasFullColumnSelection
            ? rowCount * ctx.selectedColumnIndices.size
            : (hasFullRowSelection ? ctx.selectedRowIndices.size * ctx.columnCount : 0);
        return { text: serializeTsv(outputRows), cellCount };
    }

    const cellsArray = Array.from(ctx.selectedCells);
    const rowSet = new Set<number>();
    const colSet = new Set<number>();

    cellsArray.forEach(td => {
        const r = parseInt(td.dataset.row || '-1', 10);
        const c = parseInt(td.dataset.col || '-1', 10);
        if (!isNaN(r) && !isNaN(c)) {
            rowSet.add(r);
            colSet.add(c);
        }
    });

    const sortedRows = Array.from(rowSet).sort((a, b) => a - b);
    const sortedCols = Array.from(colSet).sort((a, b) => a - b);

    for (const r of sortedRows) {
        const rowData = ctx.rowCache.get(r);
        outputRows.push(sortedCols.map(c => {
            const cached = rowData?.cells?.find((cell: any) => (cell.colNumber || 1) - 1 === c);
            if (cached) { return ctx.normalizeCellText(cellValueText(cached.value)); }
            // Not cached: the rendered cell's text is already plain.
            const cell = document.querySelector('td[data-row="' + r + '"][data-col="' + c + '"]');
            return ctx.normalizeCellText(cell ? (cell.textContent || '') : '');
        }));
    }

    return { text: serializeTsv(outputRows), cellCount: cellsArray.length };
}

export async function copySelectionToClipboard(ctx: XlsxCopyContext): Promise<void> {
    if (ctx.selectedColumnIndices.size === 0 && ctx.selectedRowIndices.size === 0 && ctx.selectedCells.size === 0) {return;}
    if (ctx.isCopying) {return;}

    ctx.setIsCopying(true);

    try {
        ctx.showToast('Copying...');
        await yieldToMain();

        const result = await buildSelectionClipboard(ctx);
        if (!result) {
            ctx.showToast('Failed to fetch data');
            return;
        }

        await writeToClipboardAsync(result.text);

        ctx.selectedCells.forEach(cell => cell.classList.add('copying'));
        setTimeout(() => ctx.selectedCells.forEach(cell => cell.classList.remove('copying')), 300);

        ctx.showToast('Copied ' + result.cellCount + ' cells');
    } catch (err) {
        console.error('Copy operation failed:', err);
        ctx.showToast('Copy failed');
    } finally {
        ctx.setIsCopying(false);
    }
}
