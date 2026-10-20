// Reading and normalizing spreadsheet cell values (text, checkbox, dropdown, rating, date) from the
// rendered DOM and the row cache. Runtime: WEBVIEW (browser).

import { VirtualScrollConfig } from '../shared/common';
import { serializeEditableCellText } from './components/spreadsheetCellTextComponent';
import { state } from './state';

const { ROW_HEIGHT } = VirtualScrollConfig;

export function normalizeCellText(text: string | null | undefined): string {
    if (!text) {return '';}
    return String(text).replace(/\u00a0/g, '').replace(/\r\n?/g, '\n').trimEnd();
}

export function getCellType(cell: HTMLElement | null): string {
    if (!cell) {return 'text';}
    const raw = (cell.getAttribute('data-cell-type') || 'text').trim().toLowerCase();
    if (raw === 'checkbox' || raw === 'dropdown' || raw === 'image' || raw === 'rating' || raw === 'date') {
        return raw;
    }
    return 'text';
}

export function parseBooleanCellValue(value: string | null | undefined): boolean {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'true' || normalized === 'yes' || normalized === '1' || normalized === 'y';
}

export function normalizeRatingValue(value: string | number | null | undefined): number {
    const parsed = typeof value === 'number' ? value : parseInt(String(value || ''), 10);
    if (!Number.isFinite(parsed)) {return 0;}
    return Math.max(0, Math.min(5, parsed));
}

export function normalizeDateInputValue(value: string | null | undefined): string {
    const raw = (value || '').trim();
    if (!raw) {return '';}

    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) {return raw;}

    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
        return '';
    }

    const yyyy = parsed.getFullYear();
    const mm = String(parsed.getMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

export function getCellNormalizedValue(cell: HTMLElement): string {
    const type = getCellType(cell);

    if (type === 'checkbox') {
        const checkbox = cell.querySelector('.xlsx-cell-checkbox') as HTMLInputElement | null;
        if (checkbox) {
            return checkbox.checked ? 'TRUE' : 'FALSE';
        }
        return parseBooleanCellValue(cell.getAttribute('data-checkbox-checked')) ? 'TRUE' : 'FALSE';
    }

    if (type === 'dropdown') {
        const select = cell.querySelector('.xlsx-cell-dropdown') as HTMLSelectElement | null;
        if (select) {
            return normalizeCellText(select.value || '');
        }
        return normalizeCellText(cell.getAttribute('data-dropdown-value') || '');
    }

    if (type === 'rating') {
        const content = cell.querySelector('.cell-rating-content') as HTMLElement | null;
        if (content) {
            const current = normalizeRatingValue(content.getAttribute('data-rating-value'));
            return String(current);
        }
        return String(normalizeRatingValue(cell.getAttribute('data-rating-value')));
    }

    if (type === 'date') {
        const dateInput = cell.querySelector('.xlsx-cell-date') as HTMLInputElement | null;
        if (dateInput) {
            return normalizeDateInputValue(dateInput.value);
        }
        return normalizeDateInputValue(cell.getAttribute('data-date-value'));
    }

    return normalizeCellText(serializeEditableCellText(cell));
}

export function getOrCreateRowCellData(rowIndex: number, colIndex: number): any {
    const rowNumber = rowIndex + 1;
    const colNumber = colIndex + 1;

    const rowData = state.rowCache.get(rowIndex) || {
        rowNumber,
        cells: [],
        height: state.allRowHeights[rowIndex] || ROW_HEIGHT
    };

    if (!Array.isArray(rowData.cells)) {
        rowData.cells = [];
    }

    let cellData = rowData.cells.find((cell: any) => cell.colNumber === colNumber);
    if (!cellData) {
        cellData = {
            value: '',
            hyperlink: '',
            style: {},
            colNumber,
            rowNumber,
            isDefaultColor: true,
            hasDefaultBg: true,
            hasWhiteBackground: false,
            hasBlackBorder: false,
            hasWhiteBorder: false,
            hasBlackBackground: false,
            hasDefaultBorder: true,
            originalColor: 'rgb(0, 0, 0)',
            isEmpty: false,
            rowspan: 1,
            colspan: 1,
            isMerged: false,
            isMaster: false,
            isMergeCovered: false,
            masterRow: rowNumber,
            masterCol: colNumber
        };
        rowData.cells.push(cellData);
        rowData.cells.sort((a: any, b: any) => (a.colNumber || 0) - (b.colNumber || 0));
    }

    state.rowCache.set(rowIndex, rowData);
    return cellData;
}
