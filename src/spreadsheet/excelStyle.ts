// Spreadsheet styles: the webview's stored style format, its CSS form, and applying it to exceljs cells.
//
// Runtime: EXTENSION HOST. No `vscode` import, so it is unit-testable. Used by the provider (save,
// toolbar Convert) and by the `xlsx-viewer.convertFile` command, which must produce identical output.

import * as Excel from 'exceljs';

export function borderEditToCssValue(enabled: boolean, style?: string, color?: string): string {
    if (!enabled) {return '';}

    const normalizedStyle = String(style || 'thin');
    const lower = normalizedStyle.toLowerCase();
    const width = lower.includes('thick')
        ? '3px'
        : lower.includes('medium')
            ? '2px'
            : '1px';
    const pattern = lower.includes('double')
        ? 'double'
        : lower.includes('dash')
            ? 'dashed'
            : lower.includes('dot') || lower === 'hair'
                ? 'dotted'
                : 'solid';

    return `${width} ${pattern} ${color || '#202124'}`;
}

function normalizeBorderForRender(border: any): any {
    if (!border || typeof border !== 'object' || border.clear) {
        return undefined;
    }

    const color = typeof border.color === 'string' ? border.color : '#202124';
    const lineStyle = typeof border.style === 'string' ? border.style : 'thin';
    const normalized: any = {};

    (['top', 'right', 'bottom', 'left'] as const).forEach((side) => {
        const value = border[side];
        if (typeof value === 'string' && value.trim()) {
            normalized[side] = value;
        } else if (value === true) {
            normalized[side] = borderEditToCssValue(true, lineStyle, color);
        }
    });

    return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function parseCssBorderForExcel(value: unknown): { style: Excel.BorderStyle; color?: string } | undefined {
    if (typeof value !== 'string' || !value.trim()) {
        return undefined;
    }

    const raw = value.trim();
    const lower = raw.toLowerCase();
    const style: Excel.BorderStyle = lower.includes('double')
        ? 'double'
        : lower.includes('dash')
            ? 'dashed'
            : lower.includes('dot')
                ? 'dotted'
                : lower.includes('3px') || lower.includes('thick')
                    ? 'thick'
                    : lower.includes('2px') || lower.includes('medium')
                        ? 'medium'
                        : 'thin';

    const colorMatch = raw.match(/(#[0-9a-fA-F]{6}|rgba?\([^)]+\))/);
    return {
        style,
        color: colorMatch ? colorMatch[1] : undefined
    };
}

/**
 * Normalize stored style format to CSS-renderable properties.
 * Stored format: { bold: true, italic: false, textColor: '#000000', ... }
 * CSS format: { fontWeight: 'bold', fontStyle: 'italic', color: '#000000', ... }
 */
export function normalizeStoredStyle(stored: any): any {
    if (!stored || typeof stored !== 'object') {
        return {};
    }

    const normalized: any = {};

    const copyCssProp = (prop: string) => {
        if (stored[prop] !== undefined) {
            normalized[prop] = stored[prop];
        }
    };

    copyCssProp('fontWeight');
    copyCssProp('fontStyle');
    copyCssProp('color');
    copyCssProp('backgroundColor');
    copyCssProp('fontSize');
    copyCssProp('fontFamily');
    copyCssProp('textAlign');
    copyCssProp('verticalAlign');
    copyCssProp('whiteSpace');
    copyCssProp('wordWrap');
    copyCssProp('overflow');
    copyCssProp('textOverflow');
    copyCssProp('paddingLeft');
    copyCssProp('textDecoration');
    copyCssProp('textDecorationLine');
    copyCssProp('textDecorationThickness');
    copyCssProp('textDecorationSkipInk');

    if (stored.bgColor && typeof stored.bgColor === 'string') {
        normalized.backgroundColor = stored.bgColor;
    }

    // Font weight normalization
    if (stored.bold !== undefined) {
        normalized.fontWeight = stored.bold ? 'bold' : 'normal';
    }

    // Font style normalization
    if (stored.italic !== undefined) {
        normalized.fontStyle = stored.italic ? 'italic' : 'normal';
    }

    // Text decoration normalization
    if (stored.strike !== undefined) {
        if (stored.strike) {
            normalized.textDecorationLine = 'line-through';
            normalized.textDecorationThickness = '2px';
            normalized.textDecorationSkipInk = 'none';
        } else {
            normalized.textDecoration = '';
            normalized.textDecorationLine = '';
        }
    }

    // Color normalization
    if (stored.textColor && typeof stored.textColor === 'string') {
        normalized.color = stored.textColor;
    }

    if (stored.color && typeof stored.color === 'string') {
        normalized.color = stored.color;
    }

    // Background color normalization
    if (stored.backgroundColor && typeof stored.backgroundColor === 'string') {
        normalized.backgroundColor = stored.backgroundColor;
    }

    // Font size normalization
    if (stored.fontSize && typeof stored.fontSize === 'number') {
        normalized.fontSize = stored.fontSize + 'pt';
    }

    // Font family normalization
    if (stored.fontFamily && typeof stored.fontFamily === 'string') {
        normalized.fontFamily = stored.fontFamily;
    }

    // Text alignment normalization
    if (stored.horizontalAlign && typeof stored.horizontalAlign === 'string') {
        normalized.textAlign = stored.horizontalAlign;
    }

    // Vertical alignment normalization
    if (stored.verticalAlign && typeof stored.verticalAlign === 'string') {
        normalized.verticalAlign = stored.verticalAlign;
    }

    // Wrap mode normalization
    if (stored.wrapMode && typeof stored.wrapMode === 'string') {
        if (stored.wrapMode === 'wrap') {
            normalized.whiteSpace = 'pre-wrap';
            normalized.wordWrap = 'break-word';
            normalized.overflow = 'visible';
            normalized.textOverflow = 'clip';
        } else if (stored.wrapMode === 'overflow') {
            normalized.whiteSpace = 'nowrap';
            normalized.wordWrap = 'normal';
            normalized.overflow = 'visible';
            normalized.textOverflow = 'clip';
        } else if (stored.wrapMode === 'clip') {
            normalized.whiteSpace = 'nowrap';
            normalized.wordWrap = 'normal';
            normalized.overflow = 'hidden';
            normalized.textOverflow = 'clip';
        }
    }

    // Indent normalization
    if (stored.indent && typeof stored.indent === 'number') {
        normalized.paddingLeft = stored.indent * 8 + 'px';
    }

    const renderBorder = normalizeBorderForRender(stored.border);
    if (renderBorder) {
        normalized.border = renderBorder;
    }

    return normalized;
}

export function parseStyleKey(key: string): { row: number; col: number } | null {
    const [rowText, colText] = key.split(':');
    const row = parseInt(rowText, 10);
    const col = parseInt(colText, 10);
    if (!Number.isFinite(row) || !Number.isFinite(col) || row <= 0 || col <= 0) {
        return null;
    }
    return { row, col };
}

export function toARGB(hexOrColor: unknown): string | undefined {
    if (typeof hexOrColor !== 'string') {return undefined;}
    const value = hexOrColor.trim();
    const hexMatch = value.match(/^#([0-9a-fA-F]{6})$/);
    if (hexMatch) {return ('FF' + hexMatch[1]).toUpperCase();}

    const rgbMatch = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (rgbMatch) {
        const r = Math.max(0, Math.min(255, parseInt(rgbMatch[1], 10)));
        const g = Math.max(0, Math.min(255, parseInt(rgbMatch[2], 10)));
        const b = Math.max(0, Math.min(255, parseInt(rgbMatch[3], 10)));
        return ('FF' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('')).toUpperCase();
    }

    return undefined;
}

export function applyStoredStylesToWorksheet(worksheet: Excel.Worksheet, storedStyles: Record<string, any>) {
    if (!storedStyles || typeof storedStyles !== 'object') {
        return;
    }

    for (const [key, styleEdit] of Object.entries(storedStyles)) {
        const address = parseStyleKey(key);
        if (!address) {continue;}

        const cell = worksheet.getRow(address.row).getCell(address.col);
        const cssStyle = normalizeStoredStyle(styleEdit);
        if (cssStyle.backgroundColor) {
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: toARGB(cssStyle.backgroundColor) || 'FFFFFFFF' }
            } as Excel.FillPattern;
        }

        const currentFont = cell.font ? { ...cell.font } : {};
        let hasFontEdit = false;
        if (cssStyle.fontWeight) {
            currentFont.bold = cssStyle.fontWeight === 'bold';
            hasFontEdit = true;
        }
        if (cssStyle.fontStyle) {
            currentFont.italic = cssStyle.fontStyle === 'italic';
            hasFontEdit = true;
        }
        if (cssStyle.color) {
            currentFont.color = { argb: toARGB(cssStyle.color) || 'FF000000' };
            hasFontEdit = true;
        }
        if (cssStyle.fontSize) {
            const parsedSize = parseFloat(cssStyle.fontSize);
            if (Number.isFinite(parsedSize) && parsedSize > 0) {
                currentFont.size = parsedSize;
                hasFontEdit = true;
            }
        }
        if (cssStyle.fontFamily) {
            currentFont.name = cssStyle.fontFamily;
            hasFontEdit = true;
        }
        if (cssStyle.textDecorationLine === 'line-through' || String(cssStyle.textDecoration || '').includes('line-through')) {
            currentFont.strike = true;
            hasFontEdit = true;
        }
        if (hasFontEdit) {
            cell.font = currentFont as Partial<Excel.Font>;
        }

        const currentAlignment: any = cell.alignment ? { ...cell.alignment } : {};
        let hasAlignmentEdit = false;
        if (cssStyle.textAlign) {
            currentAlignment.horizontal = cssStyle.textAlign;
            hasAlignmentEdit = true;
        }
        if (cssStyle.verticalAlign) {
            currentAlignment.vertical = cssStyle.verticalAlign;
            hasAlignmentEdit = true;
        }
        if (typeof cssStyle.whiteSpace === 'string') {
            currentAlignment.wrapText = cssStyle.whiteSpace === 'pre-wrap';
            hasAlignmentEdit = true;
        }
        if (cssStyle.paddingLeft) {
            const indentPx = parseFloat(cssStyle.paddingLeft);
            if (Number.isFinite(indentPx)) {
                currentAlignment.indent = Math.max(0, Math.round(indentPx / 8));
                hasAlignmentEdit = true;
            }
        }
        if (hasAlignmentEdit) {
            cell.alignment = currentAlignment as Partial<Excel.Alignment>;
        }

        if (cssStyle.border) {
            const border = cssStyle.border as any;
            const toEdge = (value: unknown) => {
                const parsed = parseCssBorderForExcel(value);
                if (!parsed) {return undefined;}
                return {
                    style: parsed.style,
                    color: { argb: toARGB(parsed.color || cssStyle.color || '#202124') || 'FF202124' }
                };
            };
            cell.border = {
                top: toEdge(border.top),
                right: toEdge(border.right),
                bottom: toEdge(border.bottom),
                left: toEdge(border.left)
            } as any;
        }
    }
}
