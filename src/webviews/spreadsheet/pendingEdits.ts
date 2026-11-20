// The edit ledger: every unsaved change to the workbook, kept per sheet, as the single source of truth
// for "what has the user changed that is not on disk yet". The spreadsheet equivalent of Markdown's
// `currentContent` vs `originalContent`. Pure (no DOM, no `state`) so it is unit-tested.
// Runtime: WEBVIEW (browser).
//
// Per sheet it holds cell values, rich-text runs, style edits and structure operations in order.
// All cell addresses are 1-based `row:col` in the sheet's *current* coordinates: recording a
// structure operation shifts the pending entries the same way the host will shift the file, so a
// payload (ops first, then values and styles) always lines up.
//
// Saving is `takePayload` (what to send, plus a mark of what it contained) and, when the host says it
// worked, `settleSaved(mark)`, which drops only the entries that are still the ones that were sent:
// anything edited while the save was in flight stays pending.

import type { CellStyleEdit, WorksheetOp } from './components/spreadsheetTypes';

export interface ValueEdit { row: number; col: number; value: string }
export interface RichEdit { row: number; col: number; runs: any[] }

interface Entry<T> { data: T; version: number }
/** `original` is undefined when the cell's row was never loaded, so the entry is always kept. */
type ValueEntry = Entry<ValueEdit & { original?: string }>;

interface SheetLedger {
    values: Map<string, ValueEntry>;
    rich: Map<string, Entry<RichEdit>>;
    styles: Map<string, Entry<CellStyleEdit>>;
    ops: WorksheetOp[];
}

export interface SavePayload {
    edits: ValueEdit[];
    richEdits: RichEdit[];
    styleEdits: CellStyleEdit[];
    operations: WorksheetOp[];
}

/** What a payload contained, so `settleSaved` removes exactly that and nothing newer. */
export interface SentMark {
    sheet: number;
    values: Map<string, number>;
    rich: Map<string, number>;
    styles: Map<string, number>;
    opCount: number;
}

/** A deep copy of one sheet's ledger, for undoing a structure edit that is still unsaved. */
export interface SheetSnapshot {
    values: Array<ValueEdit & { original?: string }>;
    rich: RichEdit[];
    styles: CellStyleEdit[];
    ops: WorksheetOp[];
}

export const addressKey = (row: number, col: number): string => `${row}:${col}`;

/**
 * Where a cell at `address` ends up after `op`, or null if the operation deletes it. Mirrors how the
 * host applies the same operation to the file.
 */
export function remapAddress(address: { row: number; col: number }, op: WorksheetOp): { row: number; col: number } | null {
    const index = typeof op.index === 'number' ? op.index : 0;
    const row = typeof op.row === 'number' ? op.row : 0;
    const col = typeof op.col === 'number' ? op.col : 0;
    let { row: nextRow, col: nextCol } = address;

    switch (op.type) {
        case 'insertRowAbove':
            if (address.row >= index) { nextRow += 1; }
            break;
        case 'insertRowBelow':
            if (address.row > index) { nextRow += 1; }
            break;
        case 'deleteRow':
            if (address.row === index) { return null; }
            if (address.row > index) { nextRow -= 1; }
            break;
        case 'insertColumnLeft':
            if (address.col >= index) { nextCol += 1; }
            break;
        case 'insertColumnRight':
            if (address.col > index) { nextCol += 1; }
            break;
        case 'deleteColumn':
            if (address.col === index) { return null; }
            if (address.col > index) { nextCol -= 1; }
            break;
        case 'insertCellShiftRight':
            if (address.row === row && address.col >= col) { nextCol += 1; }
            break;
        case 'insertCellShiftDown':
            if (address.col === col && address.row >= row) { nextRow += 1; }
            break;
        case 'deleteCellShiftLeft':
            if (address.row === row && address.col === col) { return null; }
            if (address.row === row && address.col > col) { nextCol -= 1; }
            break;
        case 'deleteCellShiftUp':
            if (address.col === col && address.row === row) { return null; }
            if (address.col === col && address.row > row) { nextRow -= 1; }
            break;
        default:
            break;
    }
    return { row: nextRow, col: nextCol };
}

function emptySheet(): SheetLedger {
    return { values: new Map(), rich: new Map(), styles: new Map(), ops: [] };
}

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

export class PendingEdits {
    private sheets = new Map<number, SheetLedger>();
    private clock = 0;

    private sheet(index: number): SheetLedger {
        let ledger = this.sheets.get(index);
        if (!ledger) {
            ledger = emptySheet();
            this.sheets.set(index, ledger);
        }
        return ledger;
    }

    private tick(): number {
        return ++this.clock;
    }

    // ---- recording -------------------------------------------------------------------------

    /**
     * Records a cell value. `original` is what the file holds for that cell, used the first time the
     * cell is edited; editing a value back to its original drops the entry, so `isDirty` is exact.
     */
    recordValue(sheet: number, row: number, col: number, value: string, original: string | undefined): void {
        const ledger = this.sheet(sheet);
        const key = addressKey(row, col);
        const existing = ledger.values.get(key);
        const baseline = existing ? existing.data.original : original;
        if (baseline !== undefined && value === baseline && !ledger.rich.has(key)) {
            ledger.values.delete(key);
            return;
        }
        ledger.values.set(key, { data: { row, col, value, original: baseline }, version: this.tick() });
    }

    recordRich(sheet: number, row: number, col: number, runs: any[]): void {
        this.sheet(sheet).rich.set(addressKey(row, col), { data: { row, col, runs }, version: this.tick() });
    }

    /** Stores the full (already merged) style edit for a cell. */
    recordStyle(sheet: number, style: CellStyleEdit): void {
        this.sheet(sheet).styles.set(addressKey(style.row, style.col), { data: clone(style), version: this.tick() });
    }

    removeStyle(sheet: number, row: number, col: number): void {
        this.sheets.get(sheet)?.styles.delete(addressKey(row, col));
    }

    getStyle(sheet: number, row: number, col: number): CellStyleEdit | undefined {
        const entry = this.sheets.get(sheet)?.styles.get(addressKey(row, col));
        return entry ? entry.data : undefined;
    }

    getValue(sheet: number, row: number, col: number): string | undefined {
        return this.sheets.get(sheet)?.values.get(addressKey(row, col))?.data.value;
    }

    /** Records a structure operation (or merge, or inserted control) and shifts pending entries to match it. */
    recordOp(sheet: number, op: WorksheetOp): void {
        const ledger = this.sheet(sheet);
        this.remapEntries(ledger, op);
        ledger.ops.push(clone(op));
    }

    private remapEntries(ledger: SheetLedger, op: WorksheetOp): void {
        const remapMap = <T extends { row: number; col: number }>(map: Map<string, Entry<T>>) => {
            const moved: Array<Entry<T>> = [];
            for (const entry of map.values()) {
                const next = remapAddress(entry.data, op);
                if (next) {
                    moved.push({ data: { ...entry.data, row: next.row, col: next.col }, version: entry.version });
                }
            }
            map.clear();
            for (const entry of moved) {
                map.set(addressKey(entry.data.row, entry.data.col), entry);
            }
        };
        remapMap(ledger.values);
        remapMap(ledger.rich);
        remapMap(ledger.styles);
    }

    // ---- state -----------------------------------------------------------------------------

    isSheetDirty(sheet: number): boolean {
        const ledger = this.sheets.get(sheet);
        return !!ledger && (ledger.values.size > 0 || ledger.rich.size > 0 || ledger.styles.size > 0 || ledger.ops.length > 0);
    }

    /** True when any sheet (or the given one) has unsaved changes. */
    isDirty(sheet?: number): boolean {
        if (sheet !== undefined) { return this.isSheetDirty(sheet); }
        for (const index of this.sheets.keys()) {
            if (this.isSheetDirty(index)) { return true; }
        }
        return false;
    }

    dirtySheets(): number[] {
        return [...this.sheets.keys()].filter(index => this.isSheetDirty(index)).sort((a, b) => a - b);
    }

    hasOps(sheet: number): boolean {
        return (this.sheets.get(sheet)?.ops.length ?? 0) > 0;
    }

    clearSheet(sheet: number): void {
        this.sheets.delete(sheet);
    }

    clearAll(): void {
        this.sheets.clear();
    }

    // ---- saving ----------------------------------------------------------------------------

    takePayload(sheet: number): { payload: SavePayload; mark: SentMark } {
        const ledger = this.sheets.get(sheet) ?? emptySheet();
        const mark: SentMark = { sheet, values: new Map(), rich: new Map(), styles: new Map(), opCount: ledger.ops.length };
        const edits: ValueEdit[] = [];
        const richEdits: RichEdit[] = [];
        const styleEdits: CellStyleEdit[] = [];
        for (const [key, entry] of ledger.values) {
            edits.push({ row: entry.data.row, col: entry.data.col, value: entry.data.value });
            mark.values.set(key, entry.version);
        }
        for (const [key, entry] of ledger.rich) {
            richEdits.push(clone(entry.data));
            mark.rich.set(key, entry.version);
        }
        for (const [key, entry] of ledger.styles) {
            styleEdits.push(clone(entry.data));
            mark.styles.set(key, entry.version);
        }
        return { payload: { edits, richEdits, styleEdits, operations: clone(ledger.ops.slice(0, mark.opCount)) }, mark };
    }

    /** The host saved `mark`: drop exactly those entries, keep anything recorded or changed since. */
    settleSaved(mark: SentMark): void {
        const ledger = this.sheets.get(mark.sheet);
        if (!ledger) { return; }
        for (const [key, version] of mark.values) {
            if (ledger.values.get(key)?.version === version) { ledger.values.delete(key); }
        }
        for (const [key, version] of mark.rich) {
            if (ledger.rich.get(key)?.version === version) { ledger.rich.delete(key); }
        }
        for (const [key, version] of mark.styles) {
            if (ledger.styles.get(key)?.version === version) { ledger.styles.delete(key); }
        }
        ledger.ops.splice(0, mark.opCount);
        if (!this.isSheetDirty(mark.sheet)) { this.sheets.delete(mark.sheet); }
    }

    // ---- undo of unsaved structure edits ---------------------------------------------------

    snapshot(sheet: number): SheetSnapshot {
        const ledger = this.sheets.get(sheet) ?? emptySheet();
        return {
            values: [...ledger.values.values()].map(entry => clone(entry.data)),
            rich: [...ledger.rich.values()].map(entry => clone(entry.data)),
            styles: [...ledger.styles.values()].map(entry => clone(entry.data)),
            ops: clone(ledger.ops),
        };
    }

    restore(sheet: number, snapshot: SheetSnapshot): void {
        const ledger = emptySheet();
        for (const data of snapshot.values) {
            ledger.values.set(addressKey(data.row, data.col), { data: clone(data), version: this.tick() });
        }
        for (const data of snapshot.rich) {
            ledger.rich.set(addressKey(data.row, data.col), { data: clone(data), version: this.tick() });
        }
        for (const data of snapshot.styles) {
            ledger.styles.set(addressKey(data.row, data.col), { data: clone(data), version: this.tick() });
        }
        ledger.ops = clone(snapshot.ops);
        if (this.isLedgerEmpty(ledger)) {
            this.sheets.delete(sheet);
        } else {
            this.sheets.set(sheet, ledger);
        }
    }

    private isLedgerEmpty(ledger: SheetLedger): boolean {
        return ledger.values.size === 0 && ledger.rich.size === 0 && ledger.styles.size === 0 && ledger.ops.length === 0;
    }

    // ---- rows from the host ----------------------------------------------------------------

    /**
     * Puts the pending values (and, through `applyStyle`, styles) of `sheet` onto rows that arrived
     * from the host, so an edit survives the rows being fetched again.
     */
    overlayRows(sheet: number, rows: any[], applyStyle?: (cell: any, style: CellStyleEdit) => void): void {
        const ledger = this.sheets.get(sheet);
        if (!ledger || !Array.isArray(rows)) { return; }
        const byRow = new Map<number, any>();
        for (const row of rows) {
            if (row && typeof row.rowNumber === 'number') { byRow.set(row.rowNumber, row); }
        }
        const cellOf = (row: any, col: number): any => {
            if (!Array.isArray(row.cells)) { row.cells = []; }
            let cell = row.cells.find((candidate: any) => candidate?.colNumber === col);
            if (!cell) {
                cell = { rowNumber: row.rowNumber, colNumber: col, value: '', style: {} };
                row.cells.push(cell);
                row.cells.sort((a: any, b: any) => (a.colNumber || 0) - (b.colNumber || 0));
            }
            return cell;
        };
        for (const entry of ledger.values.values()) {
            const row = byRow.get(entry.data.row);
            if (!row) { continue; }
            const cell = cellOf(row, entry.data.col);
            cell.value = entry.data.value;
            cell.isEmpty = entry.data.value === '';
            if (typeof cell.checkboxChecked === 'boolean') {
                cell.checkboxChecked = /^(true|1|yes|checked)$/i.test(entry.data.value.trim());
            }
        }
        if (applyStyle) {
            for (const entry of ledger.styles.values()) {
                const row = byRow.get(entry.data.row);
                if (row) { applyStyle(cellOf(row, entry.data.col), entry.data); }
            }
        }
    }
}
