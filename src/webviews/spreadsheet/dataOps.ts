// Sort and filter for the spreadsheet webview's header menu. Pure apart from parsing rich-text
// HTML, which uses an inert template (htmlToPlainText). Runtime: WEBVIEW (browser).

import { htmlToPlainText } from '../shared/sanitizeHtml';
import { getCellFromRow } from './components/spreadsheetSheetDataComponent';
import type { ColumnFilterState, SortDirection } from './components/spreadsheetTypes';

export function stripHtmlForDataOps(value: string): string {
    if (!/[<&]/.test(value)) {
        return value;
    }

    return htmlToPlainText(value).replace(/\u00a0/g, ' ');
}

export function readCellTextForDataOps(rowData: any, colZeroBased: number): string {
    const cell = getCellFromRow(rowData, colZeroBased + 1);
    if (!cell) {return '';}

    const value = cell.value;
    if (value === null || value === undefined) {
        return '';
    }

    if (typeof value === 'string') {
        return stripHtmlForDataOps(value);
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (typeof value === 'object') {
        const richRuns = Array.isArray((value as any).richText) ? (value as any).richText : [];
        if (richRuns.length > 0) {
            return richRuns.map((run: any) => String(run?.text ?? '')).join('');
        }

        const hyperlinkText = typeof (value as any).text === 'string' ? (value as any).text : '';
        if (hyperlinkText) {
            return hyperlinkText;
        }
    }

    return stripHtmlForDataOps(String(value));
}

export function parseSortableNumber(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) {return null;}

    const negativeByParens = /^\(.*\)$/.test(trimmed);
    const normalized = trimmed
        .replace(/^\((.*)\)$/, '$1')
        .replace(/[%,$\s]/g, '')
        .replace(/,/g, '');
    if (!normalized || normalized === '-' || normalized === '.') {return null;}

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {return null;}
    return negativeByParens ? -parsed : parsed;
}

export function parseSortableBoolean(value: string): number | null {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === 'yes' || normalized === '1' || normalized === 'y') {return 1;}
    if (normalized === 'false' || normalized === 'no' || normalized === '0' || normalized === 'n') {return 0;}
    return null;
}

export function parseSortableDate(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) {return null;}
    if (!/^\d{4}-\d{1,2}-\d{1,2}/.test(trimmed) && !/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(trimmed)) {
        return null;
    }

    const timestamp = Date.parse(trimmed);
    return Number.isFinite(timestamp) ? timestamp : null;
}

export function compareDataOpValues(aText: string, bText: string, direction: SortDirection): number {
    const factor = direction === 'asc' ? 1 : -1;
    const a = aText.trim();
    const b = bText.trim();

    const aEmpty = a === '';
    const bEmpty = b === '';
    if (aEmpty && !bEmpty) {return 1;}
    if (!aEmpty && bEmpty) {return -1;}
    if (aEmpty && bEmpty) {return 0;}

    const aBool = parseSortableBoolean(a);
    const bBool = parseSortableBoolean(b);
    if (aBool !== null && bBool !== null) {
        return (aBool - bBool) * factor;
    }

    const aNum = parseSortableNumber(a);
    const bNum = parseSortableNumber(b);
    if (aNum !== null && bNum !== null) {
        return (aNum - bNum) * factor;
    }

    const aDate = parseSortableDate(a);
    const bDate = parseSortableDate(b);
    if (aDate !== null && bDate !== null) {
        return (aDate - bDate) * factor;
    }

    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) * factor;
}

/** Rows that pass every column filter, sorted by `sort` (the header row is handled by the caller). */
export function filterAndSortRows(rows: any[], filters: readonly ColumnFilterState[], sort: { columnIndex: number; direction: SortDirection } | null): any[] {
    let nextRows = rows;
    if (filters.length > 0) {
        nextRows = nextRows.filter((rowData) => {
            for (const filter of filters) {
                const raw = readCellTextForDataOps(rowData, filter.columnIndex);
                const cellText = filter.caseSensitive ? raw : raw.toLowerCase();
                const query = filter.caseSensitive ? filter.query : filter.query.toLowerCase();

                if (filter.mode === 'nonEmpty') {
                    if (!raw.trim()) {
                        return false;
                    }
                    continue;
                }

                if (!query) {
                    continue;
                }

                if (filter.mode === 'contains' && !cellText.includes(query)) {
                    return false;
                }
                if (filter.mode === 'equals' && cellText !== query) {
                    return false;
                }
                if (filter.mode === 'startsWith' && !cellText.startsWith(query)) {
                    return false;
                }
            }
            return true;
        });
    }

    if (sort) {
        const { columnIndex, direction } = sort;
        nextRows = [...nextRows].sort((a, b) => {
            const aText = readCellTextForDataOps(a, columnIndex);
            const bText = readCellTextForDataOps(b, columnIndex);
            return compareDataOpValues(aText, bText, direction);
        });
    }
    return nextRows;
}
