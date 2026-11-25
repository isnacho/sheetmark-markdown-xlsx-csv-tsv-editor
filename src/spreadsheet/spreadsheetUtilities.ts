/**
 * An XLSX colour (`AARRGGBB`) as CSS. The alpha byte is ignored, as Excel and Google Sheets do:
 * openpyxl and other writers store `00` there ("001F3864"), and reading it as transparency made
 * those fills, text and borders invisible.
 */
export function convertARGBToRGBA(argb: string): string {
    if (!argb || argb.length !== 8) {
        return 'rgba(0, 0, 0, 1)';
    }

    const r = parseInt(argb.substring(2, 4), 16);
    const g = parseInt(argb.substring(4, 6), 16);
    const b = parseInt(argb.substring(6, 8), 16);

    return `rgba(${r}, ${g}, ${b}, 1)`;
}

/**
 * The CSS background of an exceljs cell fill, or undefined when the cell has none. A pattern fill
 * whose pattern is missing or `none` draws nothing in Excel even if it carries a colour.
 */
export function excelFillColor(fill: unknown): string | undefined {
    const pattern = fill as { type?: string; pattern?: string; fgColor?: { argb?: string } } | null | undefined;
    if (!pattern || pattern.type !== 'pattern') {return undefined;}
    if (!pattern.pattern || pattern.pattern === 'none') {return undefined;}
    const argb = pattern.fgColor?.argb;
    return argb ? convertARGBToRGBA(argb) : undefined;
}

export function isShadeOfBlack(color: string): boolean {
    // Parse RGB/RGBA values
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (!match) {return false;}
    
    const r = parseInt(match[1]);
    const g = parseInt(match[2]);
    const b = parseInt(match[3]);
    
    // Consider a color as "shade of black" only if ALL RGB values are very low
    // The color #c9daf8 = rgb(201, 218, 248) should NOT be considered black
    const threshold = 50; // Very dark colors only
    
    // ALL components must be below threshold to be considered "black"
    return r <= threshold && g <= threshold && b <= threshold;
}

export function isShadeOfWhite(color: string): boolean {
    // Parse RGB/RGBA values
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (!match) {return false;}

    const r = parseInt(match[1]);
    const g = parseInt(match[2]);
    const b = parseInt(match[3]);

    // Consider a color as "shade of white" if ALL RGB values are very high
    const threshold = 240; // Very light colors only

    return r >= threshold && g >= threshold && b >= threshold;
}
