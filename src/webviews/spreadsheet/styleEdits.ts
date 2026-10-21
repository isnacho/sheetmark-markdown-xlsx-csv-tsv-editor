// Cell style edits made in the spreadsheet webview: convert toolbar style values to the CSS-like
// shape the renderer and the host expect (styleToRendererCss, normalizeStyleForStorage), and record
// them as pending edits (state.pendingCellStyleEdits) plus the cached row data. Runtime: WEBVIEW (browser).

import { state } from './state';
import { getOrCreateRowCellData } from './cellValues';
import { scheduleAutoSave } from './persistence';
import type { CellStyleEdit } from './components/spreadsheetTypes';

export function styleToRendererCss(style: Record<string, any>): Record<string, any> {
    const css: Record<string, any> = {};

    const backgroundColor = typeof style.backgroundColor === 'string' ? style.backgroundColor : (typeof style.bgColor === 'string' ? style.bgColor : '');
    if (backgroundColor) {
        css.backgroundColor = backgroundColor;
    }

    const textColor = typeof style.color === 'string' ? style.color : (typeof style.textColor === 'string' ? style.textColor : '');
    if (textColor) {
        css.color = textColor;
    }

    if (typeof style.fontWeight === 'string') {
        css.fontWeight = style.fontWeight;
    } else if (typeof style.bold === 'boolean') {
        css.fontWeight = style.bold ? 'bold' : 'normal';
    }

    if (typeof style.fontStyle === 'string') {
        css.fontStyle = style.fontStyle;
    } else if (typeof style.italic === 'boolean') {
        css.fontStyle = style.italic ? 'italic' : 'normal';
    }

    const fontSizeValue = style.fontSize;
    if (typeof fontSizeValue === 'string' && fontSizeValue.trim()) {
        css.fontSize = fontSizeValue;
    } else if (typeof fontSizeValue === 'number') {
        css.fontSize = `${fontSizeValue}pt`;
    }

    if (typeof style.fontFamily === 'string') {
        css.fontFamily = style.fontFamily;
    }

    if (typeof style.textDecoration === 'string') {
        css.textDecoration = style.textDecoration;
    }
    if (typeof style.textDecorationLine === 'string') {
        css.textDecorationLine = style.textDecorationLine;
    } else if (typeof style.strike === 'boolean') {
        css.textDecorationLine = style.strike ? 'line-through' : '';
    }
    if (typeof style.textDecorationThickness === 'string') {
        css.textDecorationThickness = style.textDecorationThickness;
    }
    if (typeof style.textDecorationSkipInk === 'string') {
        css.textDecorationSkipInk = style.textDecorationSkipInk;
    }

    if (typeof style.textAlign === 'string') {
        css.textAlign = style.textAlign;
    } else if (typeof style.horizontalAlign === 'string') {
        css.textAlign = style.horizontalAlign;
    }

    if (typeof style.verticalAlign === 'string') {
        css.verticalAlign = style.verticalAlign;
    }

    if (typeof style.whiteSpace === 'string') {
        css.whiteSpace = style.whiteSpace;
    }
    if (typeof style.wordWrap === 'string') {
        css.wordWrap = style.wordWrap;
    }
    if (typeof style.overflow === 'string') {
        css.overflow = style.overflow;
    }

    if (typeof style.paddingLeft === 'string') {
        css.paddingLeft = style.paddingLeft;
    } else if (typeof style.indent === 'number') {
        css.paddingLeft = `${Math.max(0, style.indent) * 8}px`;
    }

    if (style.border && typeof style.border === 'object' && !style.border.clear) {
        css.border = {
            top: style.border.top,
            right: style.border.right,
            bottom: style.border.bottom,
            left: style.border.left,
            color: style.border.color,
            style: style.border.style
        };
    }

    return css;
}

export function normalizeStyleForStorage(style: Record<string, any>): Record<string, any> {
    if (!style || typeof style !== 'object') {
        return {};
    }

    if (style.clearFormatting) {
        return {
            row: style.row,
            col: style.col,
            clearFormatting: true,
            border: { clear: true, top: false, right: false, bottom: false, left: false }
        };
    }

    const stored: Record<string, any> = {
        row: style.row,
        col: style.col
    };
    const css = styleToRendererCss(style);

    for (const [key, value] of Object.entries(css)) {
        stored[key] = value;
    }

    return stored;
}

export function updateRowCacheStyle(row: number, col: number, style: Partial<CellStyleEdit>) {
    const cellData = getOrCreateRowCellData(row, col);
    if (cellData) {
        const normalized = styleToRendererCss(style);
        cellData.style = { ...cellData.style, ...normalized };
        if ('backgroundColor' in normalized) {
            cellData.hasDefaultBg = !normalized.backgroundColor;
        }
        if ('color' in normalized) {
            cellData.isDefaultColor = !normalized.color;
        }
        if (style.clearFormatting) {
            cellData.style = {};
            cellData.hasDefaultBg = true;
            cellData.isDefaultColor = true;
        }
    }
}

export function recordLogicalStyleEdit(row: number, col: number, style: Partial<CellStyleEdit>) {
    const rowNum = row + 1;
    const colNum = col + 1;
    const key = rowNum + ':' + colNum;
    const existing = state.pendingCellStyleEdits.get(key) || { row: rowNum, col: colNum };
    const merged = normalizeStyleForStorage({ ...existing, ...style, row: rowNum, col: colNum });
    state.pendingCellStyleEdits.set(key, merged as CellStyleEdit);
    updateRowCacheStyle(row, col, style);
    scheduleAutoSave('format');
}

export function recordCellStyleEdit(cell: HTMLElement, style: Partial<CellStyleEdit>) {
    const rowNum = parseInt(cell.getAttribute('data-rownum') || '0', 10);
    const colNum = parseInt(cell.getAttribute('data-colnum') || '0', 10);
    if (!rowNum || !colNum) {return;}

    const key = rowNum + ':' + colNum;
    const existing = state.pendingCellStyleEdits.get(key) || { row: rowNum, col: colNum };
    const merged = normalizeStyleForStorage({ ...existing, ...style, row: rowNum, col: colNum });
    state.pendingCellStyleEdits.set(key, merged as CellStyleEdit);
    updateRowCacheStyle(rowNum - 1, colNum - 1, style);
    scheduleAutoSave('format');
}

export function cloneCellStyleEdit(style: CellStyleEdit | null | undefined): CellStyleEdit | null {
    return style ? JSON.parse(JSON.stringify(style)) : null;
}
