// All mutable state of the spreadsheet webview. Modules read and write it through `state`,
// so there is one copy of each value. Runtime: WEBVIEW (browser).
//
// Generated from the former IIFE declarations in spreadsheetWebview.ts; keep related fields together.

import type { ToolbarManager } from '../shared/toolbarManager';
import { defaultXlsxViewSettings, type XlsxViewSettings } from './components/spreadsheetSettingsComponent';
import type { BorderLineStyle, BorderMode, BorderPattern, BorderThickness } from './components/spreadsheetBorderComponent';
import type { CellStyleEdit, CellUndoState, ColumnFilterState, EditUndoEntry, SortDirection, WorksheetOp } from './components/spreadsheetTypes';
import type { XlsxFindManager } from './components/spreadsheetFindComponent';

export const MIN_ROW_HEADER_WIDTH = 40;

const defaultPlainViewSettings: XlsxViewSettings = {
    ...defaultXlsxViewSettings,
    autoSave: true,
    autoSaveMode: 'all',
    showManualSavePopup: false
};

export const state = {
    // Data injected from the extension via postMessage
    worksheetsMeta: [] as any[],
    currentWorksheet: 0,
    // Virtual scrolling state
    totalRows: 0,
    columnCount: 0,
    columnWidths: [] as number[],
    mergedCells: [] as any[],
    allRowHeights: [] as number[], // Pre-loaded row heights from extension
    totalContentHeight: 0, // Pre-calculated total height
    rowOffsetPrefix: [0] as number[], // Prefix sum: offset at row i
    rowMetricsVersion: 0,
    rowOffsetPrefixVersion: -1,
    rowCache: new Map<number, any>(),
    currentRowHeaderWidth: MIN_ROW_HEADER_WIDTH,
    currentVisibleStart: 0,
    currentVisibleEnd: 0,
    isRequestingRows: false,
    isRendering: false, // Prevent re-render during render
    // Selection state
    selectedCells: new Set<HTMLElement>(),
    activeCell: null as HTMLElement | null,
    isSelecting: false,
    selectionStart: null as { row: number, col: number } | null,
    selectionEnd: null as { row: number, col: number } | null,
    pendingEditCell: null as HTMLElement | null,
    pendingEditDrag: false,
    selectedRows: new Set<number>(),
    selectedColumns: new Set<number>(),
    lastSelectedRow: null as number | null,
    lastSelectedColumn: null as number | null,
    // Track selected row/column indices for full copy (virtualization support)
    selectedRowIndices: new Set<number>(),
    selectedColumnIndices: new Set<number>(),
    // Resize state
    isResizing: false,
    resizeType: null as 'column' | 'row' | null, // 'column' or 'row'
    resizeIndex: -1,
    resizeStartPos: 0,
    resizeStartSize: 0,
    // Auto-scroll while dragging selection
    autoScrollRequest: null as any,
    lastMousePos: null as { x: number, y: number } | null, // { x, y }
    handlersAttached: false,
    selectionGlobalListenersAttached: false,
    resizeGlobalListenersAttached: false,
    toolbarManager: null as ToolbarManager | null,
    // Settings (persisted by extension)
    currentSettings: { ...defaultXlsxViewSettings } as XlsxViewSettings,
    plainModeSettings: { ...defaultPlainViewSettings } as XlsxViewSettings,
    styledModeSettings: { ...defaultXlsxViewSettings } as XlsxViewSettings,
    hasVirtualTableInit: false,
    // Table edit mode (text-only)
    isEditMode: false,
    isCellEditing: false,
    activeTextEditBeforeState: null as CellUndoState | null,
    lastEditRange: null as Range | null,
    pendingWorksheetOps: [] as WorksheetOp[],
    pendingCellStyleEdits: new Map<string, CellStyleEdit>(),
    headerContextMenuEl: null as HTMLElement | null,
    colorPaletteEl: null as HTMLElement | null,
    activeColorTarget: null as 'text' | 'background' | 'border' | null,
    selectedTextColor: '#202124',
    selectedBgColor: '#ffffff',
    selectedBorderColor: '#202124',
    selectedBorderLineStyle: 'thin' as BorderLineStyle,
    selectedBorderThickness: 'thin' as BorderThickness,
    selectedBorderPattern: 'solid' as BorderPattern,
    selectedBorderMode: 'all' as BorderMode,
    editFormattingStripEl: null as HTMLElement | null,
    borderPopupEl: null as HTMLElement | null,
    insertControlPopupEl: null as HTMLElement | null,
    dropdownOptionsPopupEl: null as HTMLElement | null,
    dropdownOptionsResolver: null as ((options: string[] | null) => void) | null,
    mergeWarningPopupEl: null as HTMLElement | null,
    mergeWarningResolver: null as ((confirmed: boolean) => void) | null,
    styleModeNoticePopupEl: null as HTMLElement | null,
    formatPainterStyle: null as Partial<CellStyleEdit> | null,
    formatPainterArmed: false,
    formatPainterExecuting: false,
    editUndoStack: [] as EditUndoEntry[],
    editRedoStack: [] as EditUndoEntry[],
    pendingControlUndoState: new WeakMap<HTMLElement, CellUndoState>(),
    findManager: null as XlsxFindManager | null,
    // Save state (CSV-parity)
    isSaving: false,
    exitAfterSave: false,
    autoSaveTimer: null as any,
    manualSaveReminderUntil: 0,
    pendingOutsideControlEdits: [] as Array<{ row: number; col: number; value: string }>,
    isVersionPreviewMode: false,
    previewVersionId: null as string | null,
    imagePreviewOverlayEl: null as HTMLElement | null,
    // Plain view mode (removes all XLSX styling)
    isPlainView: false,
    isTemporaryStyleFile: false,
    currentAssociationFileType: 'xlsx',
    styleModeRequestPending: false,
    pendingStyleModeAction: null as (() => void) | null,
    baseTotalRows: 0,
    baseRowHeights: [] as number[],
    sourceRowsSnapshot: null as any[] | null,
    transformedRowsSnapshot: null as any[] | null,
    activeColumnFilters: new Map<number, ColumnFilterState>(),
    activeSortState: null as { columnIndex: number; direction: SortDirection } | null,
    // Hyperlink hover tooltip
    linkTooltip: null as HTMLElement | null,
    linkTooltipHideTimer: null as any,
    // Toast
    // Copy state (CSV-parity: avoid concurrent copies)
    isCopying: false,
    pasteListenerAttached: false,
    activeScrollContainer: null as HTMLElement | null,
};
