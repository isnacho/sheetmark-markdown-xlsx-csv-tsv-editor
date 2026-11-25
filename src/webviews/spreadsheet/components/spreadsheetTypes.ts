import type { BorderLineStyle } from './spreadsheetBorderComponent';
import type { SheetSnapshot } from '../pendingEdits';

export type StructuralOpType =
    | 'insertRowAbove'
    | 'insertRowBelow'
    | 'deleteRow'
    | 'insertColumnLeft'
    | 'insertColumnRight'
    | 'deleteColumn';

export type WorksheetOpType =
    | StructuralOpType
    | 'insertCellShiftRight'
    | 'insertCellShiftDown'
    | 'deleteCellShiftLeft'
    | 'deleteCellShiftUp'
    | 'mergeRange'
    | 'unmergeRange'
    | 'insertControl';

export type InsertControlType = 'checkbox' | 'dropdown' | 'rating' | 'date';

export type HorizontalAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';
export type WrapMode = 'wrap' | 'overflow' | 'clip';

export interface StructuralOp {
    type: StructuralOpType;
    index: number;
}

export interface BorderStyleEdit {
    clear?: boolean;
    top?: boolean;
    right?: boolean;
    bottom?: boolean;
    left?: boolean;
    color?: string;
    style?: BorderLineStyle;
}

export interface WorksheetOp {
    type: WorksheetOpType;
    index?: number;
    row?: number;
    col?: number;
    startRow?: number;
    startCol?: number;
    endRow?: number;
    endCol?: number;
    controlType?: InsertControlType;
    dropdownOptions?: string[];
    defaultValue?: string;
}

export interface CellStyleEdit {
    row: number;
    col: number;
    // Logical/Editor properties
    bgColor?: string;
    textColor?: string;
    bold?: boolean;
    italic?: boolean;
    fontSize?: number | string;
    fontFamily?: string;
    strike?: boolean;
    horizontalAlign?: HorizontalAlign;
    verticalAlign?: VerticalAlign | string;
    wrapMode?: WrapMode;
    indent?: number;

    // CSS Properties
    backgroundColor?: string;
    color?: string;
    fontWeight?: string;
    fontStyle?: string;
    textDecoration?: string;
    textDecorationLine?: string;
    textDecorationThickness?: string;
    textDecorationSkipInk?: string;
    textAlign?: string;
    whiteSpace?: string;
    wordWrap?: string;
    overflow?: string;
    textOverflow?: string;
    paddingLeft?: string;

    border?: BorderStyleEdit;
    clearFormatting?: boolean;
}

export interface CellUndoState {
    row: number;
    col: number;
    key: string;
    styleAttr: string;
    innerHtml: string;
    dataCellType?: string;
    dataCheckboxChecked?: string;
    dataDropdownValue?: string;
    dataRatingValue?: string;
    dataDateValue?: string;
    pendingStyle: CellStyleEdit | null;
    /** The cell's text at that moment, so undoing it can record the value into the edit ledger. */
    value?: string;
}

/** Every undo entry carries `seq` (when it was made), so a save can drop only the entries it made unrecoverable. */
export interface StyleEditUndoEntry {
    kind: 'style';
    seq: number;
    before: CellUndoState[];
    after: CellUndoState[];
}

/** Cell values only (paste, clear): addresses are 1-based, so the entry needs no DOM. */
export interface ValuesUndoEntry {
    kind: 'values';
    seq: number;
    before: Array<{ row: number; col: number; value: string }>;
    after: Array<{ row: number; col: number; value: string }>;
}

export interface WorksheetStateSnapshot {
    rows: any[];
    totalRows: number;
    columnCount: number;
    columnWidths: number[];
    allRowHeights: number[];
    mergedCells: any[];
    /** The ledger of this sheet at that moment, so undoing an unsaved structure edit also undoes what it queued. */
    pending: SheetSnapshot;
}

export interface SheetEditUndoEntry {
    kind: 'sheet';
    seq: number;
    before: WorksheetStateSnapshot;
    after: WorksheetStateSnapshot;
}

export type EditUndoEntry = StyleEditUndoEntry | ValuesUndoEntry | SheetEditUndoEntry;

export type FilterMode = 'contains' | 'equals' | 'startsWith' | 'nonEmpty';
export type SortDirection = 'asc' | 'desc';

export interface ColumnFilterState {
    columnIndex: number;
    mode: FilterMode;
    query: string;
    caseSensitive: boolean;
}
