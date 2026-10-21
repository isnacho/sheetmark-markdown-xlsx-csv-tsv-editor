 
 

import { ThemeManager, renderThemeToggleSettingItem } from '../shared/themeManager';
import { SettingsManager } from '../shared/settingsManager';
import { ToolbarManager } from '../shared/toolbarManager';
import { applyToolbarLayout } from '../shared/toolbarLayout';
import { wireDelayedToolbarTooltips } from '../shared/delayedTitleTooltip';
import { Utils } from '../shared/utils';
import { Icons } from '../shared/icons';
import { vscode, VirtualScrollConfig, debounce } from '../shared/common';
import { VirtualLoader } from '../shared/virtualLoader';
import { state, MIN_ROW_HEADER_WIDTH } from './state';
import { filterAndSortRows } from './dataOps';
import { post } from './messaging';
import { captureOriginalCellValues, hideLoading, setLoadingText, showLoading } from './ui';
import { getCellNormalizedValue, getCellType, getOrCreateRowCellData, normalizeCellText, normalizeDateInputValue, normalizeRatingValue, parseBooleanCellValue } from './cellValues';
import { clearAutoSaveTimer, hasPendingXlsxEdits, initPersistence, onSaveResult, persistInteractiveControlEdit, persistPlainTextEdit, removePendingOutsideControlEdit, saveEdits, scheduleAutoSave, showManualSaveReminderIfNeeded, syncLocalSnapshotValue, upsertPendingOutsideControlEdit } from './persistence';
import type { HostToSpreadsheetWebview } from '../../protocol/spreadsheet';
import type { HandledByFeedbackModal } from '../../protocol/common';
import { createXlsxRowHtml, getExcelColumnLabel, renderDropdownCellContent } from './components/spreadsheetRenderComponent';
import { XlsxSelectionManager } from './components/spreadsheetSelectionComponent';
import { createXlsxToolbarButtons } from './components/spreadsheetToolbarComponent';
import { FeedbackModal } from '../shared/feedbackModal';
import {
    XlsxViewSettings,
    normalizeXlsxSettings,
    syncSettingsCheckboxes,
    createXlsxSettingsDefinitions
} from './components/spreadsheetSettingsComponent';
import {
    BorderLineStyle,
    BorderThickness,
    BorderPattern,
    BorderMode,
    buildBorderCss as buildBorderCssValue,
    composeBorderLineStyle,
    decomposeBorderLineStyle,
    inferBorderLineStyleFromCss,
    inferBorderModeFromStyle,
    getActiveBorderModes
} from './components/spreadsheetBorderComponent';
import type { StructuralOpType, HorizontalAlign, VerticalAlign, WrapMode, StructuralOp, BorderStyleEdit, CellStyleEdit, CellUndoState, FilterMode } from './components/spreadsheetTypes';
import { cloneCellData, getCellFromRow, setCellOnRow, normalizeRowsAfterStructureChange } from './components/spreadsheetSheetDataComponent';
import {
    normalizeColorToHex,
} from './components/spreadsheetRichTextComponent';
import {
    formatCellTextHtml,
    insertLineBreakAtCaret,
    loadEditableCellContent
} from './components/spreadsheetCellTextComponent';
import { XlsxFindManager } from './components/spreadsheetFindComponent';
import { copySelectionToClipboard as copySelectionToClipboardHelper } from './components/spreadsheetCopyComponent';
import { parseTsv } from './components/tsvClipboard';
import { getMutableRowsSnapshot, getEffectiveRowHeightFromValue, invalidateRowMetrics, ensureRowOffsetPrefix, getRowTopOffset, getRowHeightRange, findRowIndexByOffset } from './rowLayout';
import { recordLogicalStyleEdit, recordCellStyleEdit, cloneCellStyleEdit } from './styleEdits';
import { captureCellUndoState, captureWorksheetStateSnapshot, pushEditUndoEntry, pushSheetUndoEntry, undoEditAction, redoEditAction, pushSingleCellUndo, initUndo } from './undo';
import { hideLinkTooltip, showImagePreview, hideImagePreview, initializeHyperlinkHover } from './linkPreview';
import { confirmMergePreserveTopLeftContent, hideStyleModeNoticePopup, showStyleModeNoticePopup } from './notices';
import { updateCheckboxCellPresentation, updateDropdownCellPresentation, updateRatingCellPresentation, updateDateCellPresentation, areInteractiveControlsEnabled, applyInteractiveControlState, hideInsertControlPopup, showInsertControlPopup, hideDropdownOptionsPopup, getDropdownOptionsFromCell, editDropdownOptionsForCell, initInteractiveControls } from './interactiveControls';

(function () {
    initPersistence({ setEditMode });
    initUndo({ clearSelection, hideHeaderContextMenu, rerenderCurrentSheetFromLocalState, applyFindHighlightsInVisibleCells });
    initInteractiveControls({ getLogicalSelectionBounds, ensureAllRowsLoadedForStructureEdits });

    // ===== Virtual Scrolling Configuration =====
    const { ROW_HEIGHT, BUFFER_ROWS, CHUNK_SIZE } = VirtualScrollConfig;
    const textColorIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><path d="M8.5 16h7"/><path d="M12 4l4 12"/><path d="M12 4L8 16"/></svg>';
    const bgColorIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l8 8-6 6-8-8z"/><path d="M2 20h20"/></svg>';
    const virtualLoader = new VirtualLoader<any[]>('getRows');

    const selectionManager = new XlsxSelectionManager({
        selectedCells: state.selectedCells,
        selectedRows: state.selectedRows,
        selectedColumns: state.selectedColumns,
        selectedRowIndices: state.selectedRowIndices,
        selectedColumnIndices: state.selectedColumnIndices,
        getActiveCell: () => state.activeCell,
        setActiveCell: (cell) => {
            state.activeCell = cell;
        },
        getLastSelectedRow: () => state.lastSelectedRow,
        setLastSelectedRow: (value) => {
            state.lastSelectedRow = value;
        },
        getLastSelectedColumn: () => state.lastSelectedColumn,
        setLastSelectedColumn: (value) => {
            state.lastSelectedColumn = value;
        },
        getTotalRows: () => state.totalRows,
        getColumnCount: () => state.columnCount
    }); // { x, y }
    const AUTO_SCROLL_THRESHOLD = 40; // px
    const AUTO_SCROLL_STEP = 20;

    type SettingsScope = 'plain' | 'styled';

    const MAX_ROWS_FOR_CLIENT_DATA_OPS = 120000;


    function updateColorPreview(target: 'text' | 'background' | 'border', color: string) {
        const ids = target === 'text'
            ? ['formatTextColorButton', 'stripTextColorButton']
            : target === 'background'
                ? ['formatBackgroundColorButton', 'stripBgColorButton']
                : ['stripBorderColorButton'];
        ids.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {btn.style.setProperty('--format-color-preview', color);}
        });
    }

    function buildBorderCss(enabled: boolean, style?: BorderLineStyle, color?: string) {
        if (!enabled) {return '';}
        const nextStyle = style || state.selectedBorderLineStyle;
        const nextColor = color || state.selectedBorderColor;
        return buildBorderCssValue(true, nextStyle, nextColor);
    }

    function syncBorderStyleFromControls() {
        state.selectedBorderLineStyle = composeBorderLineStyle(state.selectedBorderThickness, state.selectedBorderPattern);
    }

    function syncBorderControlsFromStyle(style: BorderLineStyle) {
        const decomposed = decomposeBorderLineStyle(style);
        state.selectedBorderThickness = decomposed.thickness;
        state.selectedBorderPattern = decomposed.pattern;
    }

    function getSelectedBorderMode(): BorderMode {
        return state.selectedBorderMode;
    }

    function updateBorderPopupActiveButtons(border?: BorderStyleEdit) {
        if (!state.borderPopupEl) {return;}
        const activeModes = getActiveBorderModes(border);
        state.borderPopupEl.querySelectorAll('.border-mode-btn').forEach((btn) => {
            const mode = (btn as HTMLElement).getAttribute('data-mode') as BorderMode | null;
            if (!mode) {return;}
            btn.classList.toggle('active', activeModes.has(mode));
        });
    }

    function syncBorderControlsToUi() {
        const thicknessEl = document.getElementById('editBorderThickness') as HTMLSelectElement | null;
        if (thicknessEl) {thicknessEl.value = state.selectedBorderThickness;}

        const patternEl = document.getElementById('editBorderPattern') as HTMLSelectElement | null;
        if (patternEl) {patternEl.value = state.selectedBorderPattern;}

        updateColorPreview('border', state.selectedBorderColor);
    }

    function syncBorderSelectionFromCell(cell: HTMLElement | null) {
        if (!cell) {return;}

        const rowNum = parseInt(cell.getAttribute('data-rownum') || '0', 10);
        const colNum = parseInt(cell.getAttribute('data-colnum') || '0', 10);
        const key = rowNum > 0 && colNum > 0 ? `${rowNum}:${colNum}` : '';
        const pending = key ? state.pendingCellStyleEdits.get(key) : undefined;

        const copied = copyFormattingFromCell(cell);
        const border = (pending?.border || copied.border) as BorderStyleEdit | undefined;
        if (!border) {return;}

        state.selectedBorderMode = inferBorderModeFromStyle(border, state.selectedBorderMode);
        if (border.style) {
            state.selectedBorderLineStyle = border.style;
            syncBorderControlsFromStyle(border.style);
        }
        if (border.color) {
            state.selectedBorderColor = border.color;
        }

        syncBorderControlsToUi();
        updateBorderPopupActiveButtons(border);
    }

    function hideBorderPopup() {
        if (state.borderPopupEl) {
            state.borderPopupEl.classList.add('hidden');
        }
    }

    function ensureBorderPopup() {
        if (state.borderPopupEl) {
            return state.borderPopupEl;
        }

        const popup = document.createElement('div');
        popup.id = 'xlsxBorderPopup';
        popup.className = 'xlsx-border-popup hidden';
        popup.innerHTML = `
            <div class="border-popup-title">Borders</div>
            <div class="border-popup-grid">
                <button type="button" class="border-mode-btn" data-mode="all" title="All borders">All</button>
                <button type="button" class="border-mode-btn" data-mode="outside" title="Outside borders">Outer</button>
                <button type="button" class="border-mode-btn" data-mode="inner" title="Inner borders">Inner</button>
                <button type="button" class="border-mode-btn" data-mode="top" title="Top border">Top</button>
                <button type="button" class="border-mode-btn" data-mode="right" title="Right border">Right</button>
                <button type="button" class="border-mode-btn" data-mode="bottom" title="Bottom border">Bottom</button>
                <button type="button" class="border-mode-btn" data-mode="left" title="Left border">Left</button>
                <button type="button" class="border-mode-btn" data-mode="none" title="No borders">None</button>
            </div>
        `;

        popup.querySelectorAll('.border-mode-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const mode = (btn as HTMLElement).getAttribute('data-mode') as BorderMode | null;
                if (!mode) {return;}
                state.selectedBorderMode = mode;
                applyBorderPreset(mode);
                if (state.activeCell) {
                    syncBorderSelectionFromCell(state.activeCell);
                }
            });
        });

        document.body.appendChild(popup);
        state.borderPopupEl = popup;
        return popup;
    }

    function showBorderPopup(anchor: HTMLElement) {
        const popup = ensureBorderPopup();
        popup.classList.remove('hidden');

        const rect = anchor.getBoundingClientRect();
        const popupRect = popup.getBoundingClientRect();
        const left = Math.min(Math.max(8, rect.left), window.innerWidth - popupRect.width - 8);
        const top = Math.min(rect.bottom + 6, window.innerHeight - popupRect.height - 8);
        popup.style.left = left + 'px';
        popup.style.top = top + 'px';
    }

    function ensureHeaderVisible() {
        const thead = document.querySelector('#xlsxTable thead') as HTMLElement | null;
        if (thead) {
            thead.style.display = 'table-header-group';
        }
    }

    function applyCurrentBorderMode() {
        applyBorderPreset(getSelectedBorderMode());
    }

    function getFindManager(): XlsxFindManager {
        if (!state.findManager) {
            state.findManager = new XlsxFindManager({
                normalizeCellText,
                requestAllRows,
                getFallbackRows: getMutableRowsSnapshot,
                focusCellByPosition,
                isCellEditing: () => state.isCellEditing,
                tableSelector: '#xlsxTable'
            });
        }
        return state.findManager;
    }

    function applyFindHighlightsInVisibleCells() {
        getFindManager().reapplyHighlights();
    }

    async function focusCellByPosition(row: number, col: number) {
        const boundedRow = Math.max(0, Math.min(state.totalRows - 1, row));
        const boundedCol = Math.max(0, Math.min(state.columnCount - 1, col));

        let cell = document.querySelector(`td[data-row="${boundedRow}"][data-col="${boundedCol}"]`) as HTMLElement | null;

        if (!cell) {
            const container = getTableContainer();
            if (container) {
                const top = getRowTopOffset(boundedRow);
                container.scrollTop = Math.max(0, top - Math.floor(container.clientHeight / 2));
                await updateVisibleRows();
                cell = document.querySelector(`td[data-row="${boundedRow}"][data-col="${boundedCol}"]`) as HTMLElement | null;
            }
        }

        if (!cell) {
            showToast('Match is outside current view');
            return;
        }

        state.selectionStart = { row: boundedRow, col: boundedCol };
        state.selectionEnd = { row: boundedRow, col: boundedCol };
        selectCell(cell);

        const container = getTableContainer();
        if (container) {
            const rect = cell.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            if (rect.bottom > containerRect.bottom) {container.scrollTop += rect.bottom - containerRect.bottom + 16;}
            if (rect.top < containerRect.top) {container.scrollTop -= containerRect.top - rect.top + 16;}
            if (rect.right > containerRect.right) {container.scrollLeft += rect.right - containerRect.right + 16;}
            if (rect.left < containerRect.left) {container.scrollLeft -= containerRect.left - rect.left + 16;}
        }
    }

    async function navigateFind(direction: 'next' | 'prev') {
        await getFindManager().navigate(direction);
    }

    function openFindOverlay() {
        getFindManager().open();
    }

    function toggleFindOverlay() {
        getFindManager().toggle();
    }

    async function ensureAllRowsLoadedForStructureEdits(withOverlay = true) {
        if (state.rowCache.size >= state.totalRows && state.totalRows > 0) {return true;}

        if (withOverlay) {
            setLoadingText('Preparing full sheet for structure changes...');
            showLoading();
        }

        try {
            const allRows = await requestAllRows();
            if (!allRows || allRows.length === 0) {
                showToast('Unable to load rows for structure edit');
                return false;
            }

            state.rowCache.clear();
            for (let i = 0; i < allRows.length; i++) {
                state.rowCache.set(i, allRows[i] || { cells: [], rowNumber: i + 1, height: state.allRowHeights[i] || ROW_HEIGHT });
            }

            if (allRows.length > state.totalRows) {
                state.totalRows = allRows.length;
            }

            return true;
        } finally {
            if (withOverlay) {
                hideLoading();
                setLoadingText('Rendering worksheet...');
            }
        }
    }

    function rerenderCurrentSheetFromLocalState() {
        const container = document.getElementById('tableContainer');
        if (!container) {return;}

        state.currentVisibleStart = 0;
        state.currentVisibleEnd = 0;
        state.isRendering = false;

        container.innerHTML = createTableShell();
        initializeSelection();
        initializeResize();
        initializeHyperlinkHover();
        initializeVirtualScrolling();

        if (state.toolbarManager) {
            applyToolbarLayout(state.toolbarManager, {
                stickyToolbar: !!state.currentSettings.stickyToolbar,
                scrollTarget: '#content',
                onLayoutApplied: initializeVirtualScrolling
            });
        }
    }

    function canApplyStructureEdits(): boolean {
        if (state.isVersionPreviewMode) {
            showToast('Version preview is read-only');
            return false;
        }
        return true;
    }

    function persistStructureChange() {
        if (state.isEditMode) {
            scheduleAutoSave('structure');
            return;
        }

        if (state.currentSettings.autoSave) {
            saveEdits(false, true);
            return;
        }

        showManualSaveReminderIfNeeded();
    }

    async function applyStructureOperation(op: StructuralOp) {
        if (!canApplyStructureEdits()) {return;}

        const loaded = await ensureAllRowsLoadedForStructureEdits();
        if (!loaded) {return;}

        const beforeSnapshot = captureWorksheetStateSnapshot();
        const rows = getMutableRowsSnapshot();
        const target = op.index;
        const prevSelectedRows = Array.from(state.selectedRowIndices.values()).sort((a, b) => a - b);
        const prevSelectedCols = Array.from(state.selectedColumnIndices.values()).sort((a, b) => a - b);

        if (op.type === 'insertRowAbove' || op.type === 'insertRowBelow' || op.type === 'deleteRow') {
            if (op.type === 'deleteRow' && state.totalRows <= 1) {
                showToast('Cannot delete the last row');
                return;
            }

            const insertAt = op.type === 'insertRowAbove' ? target - 1 : target;
            if (op.type === 'insertRowAbove' || op.type === 'insertRowBelow') {
                rows.splice(Math.max(0, insertAt), 0, { cells: [], rowNumber: 0, height: ROW_HEIGHT });
                state.allRowHeights.splice(Math.max(0, insertAt), 0, ROW_HEIGHT);
                state.totalRows += 1;
            } else {
                rows.splice(Math.max(0, target - 1), 1);
                state.allRowHeights.splice(Math.max(0, target - 1), 1);
                state.totalRows = Math.max(1, state.totalRows - 1);
            }

            invalidateRowMetrics();
        } else {
            if (op.type === 'deleteColumn' && state.columnCount <= 1) {
                showToast('Cannot delete the last column');
                return;
            }

            const atCol = op.type === 'insertColumnLeft' ? target : (op.type === 'insertColumnRight' ? target + 1 : target);

            rows.forEach((row: any) => {
                if (!Array.isArray(row.cells)) {row.cells = [];}

                if (op.type === 'deleteColumn') {
                    row.cells = row.cells
                        .filter((cell: any) => cell.colNumber !== atCol)
                        .map((cell: any) => {
                            if (cell.colNumber > atCol) {cell.colNumber -= 1;}
                            return cell;
                        });
                } else {
                    row.cells = row.cells.map((cell: any) => {
                        if (cell.colNumber >= atCol) {cell.colNumber += 1;}
                        return cell;
                    });
                }
            });

            if (op.type === 'deleteColumn') {
                state.columnWidths.splice(Math.max(0, atCol - 1), 1);
                state.columnCount = Math.max(1, state.columnCount - 1);
            } else {
                state.columnWidths.splice(Math.max(0, atCol - 1), 0, 80);
                state.columnCount += 1;
            }
        }

        state.pendingWorksheetOps.push(op);
        normalizeRowsAfterStructureChange(rows, state.rowCache);
        state.mergedCells = [];

        state.selectedCells.clear();
        state.activeCell = null;

        if (op.type === 'insertRowAbove' || op.type === 'insertRowBelow' || op.type === 'deleteRow') {
            state.selectedRowIndices.clear();
            const pivot = op.type === 'insertRowAbove' ? target - 1 : (op.type === 'insertRowBelow' ? target : target - 1);
            prevSelectedRows.forEach(r => {
                let next = r;
                if (op.type === 'insertRowAbove' && r >= pivot) {next = r + 1;}
                if (op.type === 'insertRowBelow' && r > pivot) {next = r + 1;}
                if (op.type === 'deleteRow') {
                    if (r === pivot) {
                        next = Math.min(pivot, state.totalRows - 1);
                    } else if (r > pivot) {
                        next = r - 1;
                    }
                }
                next = Math.max(0, Math.min(state.totalRows - 1, next));
                state.selectedRowIndices.add(next);
            });
            state.selectedRows.clear();
            state.selectedRowIndices.forEach(v => state.selectedRows.add(v));
        } else {
            state.selectedColumnIndices.clear();
            const pivot = op.type === 'insertColumnLeft' ? target - 1 : (op.type === 'insertColumnRight' ? target : target - 1);
            prevSelectedCols.forEach(c => {
                let next = c;
                if (op.type === 'insertColumnLeft' && c >= pivot) {next = c + 1;}
                if (op.type === 'insertColumnRight' && c > pivot) {next = c + 1;}
                if (op.type === 'deleteColumn') {
                    if (c === pivot) {
                        next = Math.min(pivot, state.columnCount - 1);
                    } else if (c > pivot) {
                        next = c - 1;
                    }
                }
                next = Math.max(0, Math.min(state.columnCount - 1, next));
                state.selectedColumnIndices.add(next);
            });
            state.selectedColumns.clear();
            state.selectedColumnIndices.forEach(v => state.selectedColumns.add(v));
        }

        const afterSnapshot = captureWorksheetStateSnapshot();
        pushSheetUndoEntry(beforeSnapshot, afterSnapshot);
        hideHeaderContextMenu();
        rerenderCurrentSheetFromLocalState();
        persistStructureChange();
    }

    async function applyCellInsertOperation(type: 'insertCellShiftRight' | 'insertCellShiftDown', rowNumber: number, colNumber: number) {
        if (!canApplyStructureEdits()) {return;}
        if (rowNumber <= 0 || colNumber <= 0) {return;}

        const loaded = await ensureAllRowsLoadedForStructureEdits();
        if (!loaded) {return;}

        const beforeSnapshot = captureWorksheetStateSnapshot();
        const rows = getMutableRowsSnapshot();

        if (type === 'insertCellShiftRight') {
            const rowIndex = rowNumber - 1;
            const row = rows[rowIndex];
            if (!row) {return;}

            const previousColumnCount = state.columnCount;
            state.columnCount += 1;
            state.columnWidths.splice(Math.max(0, previousColumnCount), 0, 80);

            for (let col = previousColumnCount + 1; col > colNumber; col--) {
                const prevCell = getCellFromRow(row, col - 1);
                setCellOnRow(row, col, prevCell ? cloneCellData(prevCell) : null);
            }
            setCellOnRow(row, colNumber, null);
        } else {
            const previousTotalRows = state.totalRows;
            state.totalRows += 1;
            state.allRowHeights.push(ROW_HEIGHT);
            rows.push({ cells: [], rowNumber: state.totalRows, height: ROW_HEIGHT });
            invalidateRowMetrics();

            for (let row = previousTotalRows; row >= rowNumber; row--) {
                const srcRow = rows[row - 1];
                let dstRow = rows[row];
                if (!dstRow) {
                    dstRow = { cells: [], rowNumber: row + 1, height: state.allRowHeights[row] || ROW_HEIGHT };
                    rows[row] = dstRow;
                }
                const sourceCell = srcRow ? getCellFromRow(srcRow, colNumber) : null;
                setCellOnRow(dstRow, colNumber, sourceCell ? cloneCellData(sourceCell) : null);
            }

            const targetRow = rows[rowNumber - 1];
            if (targetRow) {
                setCellOnRow(targetRow, colNumber, null);
            }
        }

        state.pendingWorksheetOps.push({ type, row: rowNumber, col: colNumber });
        normalizeRowsAfterStructureChange(rows, state.rowCache);

        const afterSnapshot = captureWorksheetStateSnapshot();
        pushSheetUndoEntry(beforeSnapshot, afterSnapshot);

        state.selectedCells.clear();
        state.activeCell = null;
        hideHeaderContextMenu();
        rerenderCurrentSheetFromLocalState();
        persistStructureChange();
    }

    async function applyCellDeleteOperation(type: 'deleteCellShiftLeft' | 'deleteCellShiftUp', rowNumber: number, colNumber: number) {
        if (!canApplyStructureEdits()) {return;}
        if (rowNumber <= 0 || colNumber <= 0) {return;}

        const loaded = await ensureAllRowsLoadedForStructureEdits();
        if (!loaded) {return;}

        const beforeSnapshot = captureWorksheetStateSnapshot();
        const rows = getMutableRowsSnapshot();

        if (type === 'deleteCellShiftLeft') {
            const rowIndex = rowNumber - 1;
            const row = rows[rowIndex];
            if (!row) {return;}

            for (let col = colNumber; col < state.columnCount; col++) {
                const nextCell = getCellFromRow(row, col + 1);
                setCellOnRow(row, col, nextCell ? cloneCellData(nextCell) : null);
            }
            setCellOnRow(row, state.columnCount, null);
        } else {
            for (let row = rowNumber; row < state.totalRows; row++) {
                const srcRow = rows[row];
                const dstRow = rows[row - 1];
                const sourceCell = getCellFromRow(srcRow, colNumber);
                if (dstRow) {
                    setCellOnRow(dstRow, colNumber, sourceCell ? cloneCellData(sourceCell) : null);
                }
            }

            const lastRow = rows[state.totalRows - 1];
            if (lastRow) {
                setCellOnRow(lastRow, colNumber, null);
            }
        }

        state.pendingWorksheetOps.push({ type, row: rowNumber, col: colNumber });
        normalizeRowsAfterStructureChange(rows, state.rowCache);

        const afterSnapshot = captureWorksheetStateSnapshot();
        pushSheetUndoEntry(beforeSnapshot, afterSnapshot);

        state.selectedCells.clear();
        state.activeCell = null;
        hideHeaderContextMenu();
        rerenderCurrentSheetFromLocalState();
        persistStructureChange();
    }

    function ensureHeaderContextMenu() {
        if (state.headerContextMenuEl) {return state.headerContextMenuEl;}

        const menu = document.createElement('div');
        menu.id = 'headerContextMenu';
        menu.className = 'header-context-menu hidden';
        document.body.appendChild(menu);
        state.headerContextMenuEl = menu;
        return menu;
    }

    function hideHeaderContextMenu() {
        if (!state.headerContextMenuEl) {return;}
        state.headerContextMenuEl.classList.add('hidden');
        state.headerContextMenuEl.innerHTML = '';
    }

    function showHeaderContextMenu(e: MouseEvent, targetType: 'row' | 'column', targetIndexZeroBased: number) {
        if (targetType === 'row' && state.isVersionPreviewMode) {
            showToast('Version preview is read-only');
            return;
        }

        const menu = ensureHeaderContextMenu();
        menu.innerHTML = '';

        const targetIndexOneBased = targetIndexZeroBased + 1;
        const items: Array<{ label: string; op: StructuralOpType }> = targetType === 'row'
            ? [
                { label: 'Insert row above', op: 'insertRowAbove' },
                { label: 'Insert row below', op: 'insertRowBelow' },
                { label: 'Delete row', op: 'deleteRow' }
            ]
            : [
                { label: 'Insert column left', op: 'insertColumnLeft' },
                { label: 'Insert column right', op: 'insertColumnRight' },
                { label: 'Delete column', op: 'deleteColumn' }
            ];

        items.forEach(item => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'header-context-item';
            btn.textContent = item.label;
            btn.addEventListener('click', () => {
                applyStructureOperation({ type: item.op, index: targetIndexOneBased });
            });
            menu.appendChild(btn);
        });

        // Add Text wrap menu option for row/column selection
        const menuSeparator = document.createElement('div');
        menuSeparator.className = 'header-context-separator';
        menu.appendChild(menuSeparator);

        const sampleCell = targetType === 'row'
            ? document.querySelector(`td[data-row="${targetIndexZeroBased}"][data-col="0"]`) as HTMLElement | null
            : document.querySelector(`td[data-row="0"][data-col="${targetIndexZeroBased}"]`) as HTMLElement | null;
        const isWrapped = sampleCell ? sampleCell.style.whiteSpace === 'pre-wrap' : false;

        const wrapBtn = document.createElement('button');
        wrapBtn.type = 'button';
        wrapBtn.className = 'header-context-item';
        wrapBtn.textContent = isWrapped ? '✓ Text wrap' : 'Text wrap';
        wrapBtn.addEventListener('click', () => {
            hideHeaderContextMenu();
            const nextMode: WrapMode = isWrapped ? 'overflow' : 'wrap';
            if (targetType === 'row') {
                applyWrapModeToRange(targetIndexZeroBased, targetIndexZeroBased, 0, state.columnCount - 1, nextMode);
            } else {
                applyWrapModeToRange(0, state.totalRows - 1, targetIndexZeroBased, targetIndexZeroBased, nextMode);
            }
        });
        menu.appendChild(wrapBtn);

        if (targetType === 'column') {
            const appendSeparator = () => {
                const separator = document.createElement('div');
                separator.className = 'header-context-separator';
                menu.appendChild(separator);
            };

            const appendAction = (label: string, onClick: () => Promise<void> | void, hideBeforeRun = true) => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'header-context-item';
                btn.textContent = label;
                btn.addEventListener('click', async () => {
                    if (hideBeforeRun) {
                        hideHeaderContextMenu();
                    }
                    try {
                        await onClick();
                    } catch {
                        showToast('Unable to apply column operation');
                    }
                });
                menu.appendChild(btn);
            };

            const applyColumnFilter = async (mode: FilterMode, query: string, caseSensitive: boolean) => {
                const ready = await ensureSourceRowsSnapshot();
                if (!ready) {return;}

                const trimmedQuery = query.trim();
                if (mode === 'nonEmpty') {
                    state.activeColumnFilters.set(colIndex, {
                        columnIndex: colIndex,
                        mode,
                        query: '',
                        caseSensitive: false
                    });
                } else if (!trimmedQuery) {
                    state.activeColumnFilters.delete(colIndex);
                } else {
                    state.activeColumnFilters.set(colIndex, {
                        columnIndex: colIndex,
                        mode,
                        query: trimmedQuery,
                        caseSensitive
                    });
                }

                rebuildFilteredRows();
                const hasTransforms = state.activeSortState || state.activeColumnFilters.size > 0;
                applyDataOpsRowsToViewport(hasTransforms ? state.transformedRowsSnapshot : null);

                const filteredCount = hasTransforms && state.transformedRowsSnapshot ? state.transformedRowsSnapshot.length : state.baseTotalRows;
                showToast(hasTransforms ? `Showing ${filteredCount.toLocaleString()} filtered rows` : 'Filter cleared');
            };

            const clearColumnFilter = async () => {
                if (!state.activeColumnFilters.has(colIndex)) {
                    return;
                }

                state.activeColumnFilters.delete(colIndex);

                if (!state.sourceRowsSnapshot) {
                    applyDataOpsRowsToViewport(null);
                    return;
                }

                rebuildFilteredRows();
                if (!state.activeSortState && state.activeColumnFilters.size === 0) {
                    applyDataOpsRowsToViewport(null);
                    showToast('Filter cleared');
                    return;
                }

                applyDataOpsRowsToViewport(state.transformedRowsSnapshot);
                const filteredCount = state.transformedRowsSnapshot ? state.transformedRowsSnapshot.length : state.baseTotalRows;
                showToast(`Showing ${filteredCount.toLocaleString()} filtered rows`);
            };

            const appendFilterPanel = () => {
                const existingFilter = state.activeColumnFilters.get(colIndex);
                const panel = document.createElement('div');
                panel.className = 'header-filter-panel';
                panel.addEventListener('click', (event) => event.stopPropagation());
                panel.addEventListener('mousedown', (event) => event.stopPropagation());

                const title = document.createElement('div');
                title.className = 'header-filter-title';
                title.textContent = `Filter ${getExcelColumnLabel(colIndex + 1)}`;
                panel.appendChild(title);

                const modeSelect = document.createElement('select');
                modeSelect.className = 'header-filter-select';
                const filterModes: Array<{ value: FilterMode; label: string }> = [
                    { value: 'contains', label: 'Contains' },
                    { value: 'equals', label: 'Equals' },
                    { value: 'startsWith', label: 'Starts with' },
                    { value: 'nonEmpty', label: 'Non-empty' }
                ];
                filterModes.forEach((mode) => {
                    const option = document.createElement('option');
                    option.value = mode.value;
                    option.textContent = mode.label;
                    modeSelect.appendChild(option);
                });
                modeSelect.value = existingFilter?.mode || 'contains';
                panel.appendChild(modeSelect);

                const queryInput = document.createElement('input');
                queryInput.className = 'header-filter-input';
                queryInput.type = 'text';
                queryInput.placeholder = 'Filter value';
                queryInput.value = existingFilter && existingFilter.mode !== 'nonEmpty' ? existingFilter.query : '';
                panel.appendChild(queryInput);

                const caseLabel = document.createElement('label');
                caseLabel.className = 'header-filter-checkbox';
                const caseInput = document.createElement('input');
                caseInput.type = 'checkbox';
                caseInput.checked = !!existingFilter?.caseSensitive;
                caseLabel.appendChild(caseInput);
                caseLabel.appendChild(document.createTextNode('Case sensitive'));
                panel.appendChild(caseLabel);

                const actions = document.createElement('div');
                actions.className = 'header-filter-actions';

                const applyBtn = document.createElement('button');
                applyBtn.type = 'button';
                applyBtn.className = 'header-filter-button primary';
                applyBtn.textContent = 'Apply';

                const clearBtn = document.createElement('button');
                clearBtn.type = 'button';
                clearBtn.className = 'header-filter-button';
                clearBtn.textContent = 'Clear';

                actions.appendChild(applyBtn);
                actions.appendChild(clearBtn);
                panel.appendChild(actions);

                const syncControls = () => {
                    const nonEmpty = modeSelect.value === 'nonEmpty';
                    queryInput.disabled = nonEmpty;
                    caseInput.disabled = nonEmpty;
                    queryInput.placeholder = nonEmpty ? 'No value needed' : 'Filter value';
                };

                const runApply = async () => {
                    hideHeaderContextMenu();
                    await applyColumnFilter(modeSelect.value as FilterMode, queryInput.value, caseInput.checked);
                };

                modeSelect.addEventListener('change', () => {
                    syncControls();
                    if (modeSelect.value !== 'nonEmpty') {
                        queryInput.focus();
                        queryInput.select();
                    }
                });
                queryInput.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        void runApply();
                    } else if (event.key === 'Escape') {
                        hideHeaderContextMenu();
                    }
                });
                applyBtn.addEventListener('click', () => {
                    void runApply();
                });
                clearBtn.addEventListener('click', () => {
                    hideHeaderContextMenu();
                    void clearColumnFilter();
                });

                syncControls();
                menu.appendChild(panel);
            };

            const colIndex = targetIndexZeroBased;
            appendSeparator();

            // First row as header checkbox
            const headerCheckboxLabel = document.createElement('label');
            headerCheckboxLabel.className = 'header-context-checkbox-item';
            headerCheckboxLabel.addEventListener('click', (event) => event.stopPropagation());
            headerCheckboxLabel.addEventListener('mousedown', (event) => event.stopPropagation());

            const headerCheckbox = document.createElement('input');
            headerCheckbox.type = 'checkbox';
            headerCheckbox.className = 'header-context-checkbox';
            headerCheckbox.checked = !!state.currentSettings.firstRowIsHeader;

            const labelText = document.createTextNode('First row as header');

            headerCheckboxLabel.appendChild(headerCheckbox);
            headerCheckboxLabel.appendChild(labelText);

            headerCheckbox.addEventListener('change', async () => {
                applySettings({ ...state.currentSettings, firstRowIsHeader: headerCheckbox.checked });
                postSettings();
                if (state.sourceRowsSnapshot) {
                    rebuildFilteredRows();
                    applyDataOpsRowsToViewport(state.activeSortState || state.activeColumnFilters.size > 0 ? state.transformedRowsSnapshot : null);
                }
            });

            menu.appendChild(headerCheckboxLabel);

            // Show visual indicators for active sorts
            const isAscSorted = state.activeSortState?.columnIndex === colIndex && state.activeSortState?.direction === 'asc';
            const isDescSorted = state.activeSortState?.columnIndex === colIndex && state.activeSortState?.direction === 'desc';

            appendAction('Sort A to Z' + (isAscSorted ? ' ✓' : ''), async () => {
                const ready = await ensureSourceRowsSnapshot();
                if (!ready) {return;}

                if (isAscSorted) {
                    // Already sorted A-Z, toggle off
                    state.activeSortState = null;
                } else {
                    state.activeSortState = { columnIndex: colIndex, direction: 'asc' };
                }

                rebuildFilteredRows();
                applyDataOpsRowsToViewport(state.activeSortState || state.activeColumnFilters.size > 0 ? state.transformedRowsSnapshot : null);
            });

            appendAction('Sort Z to A' + (isDescSorted ? ' ✓' : ''), async () => {
                const ready = await ensureSourceRowsSnapshot();
                if (!ready) {return;}

                if (isDescSorted) {
                    // Already sorted Z-A, toggle off
                    state.activeSortState = null;
                } else {
                    state.activeSortState = { columnIndex: colIndex, direction: 'desc' };
                }

                rebuildFilteredRows();
                applyDataOpsRowsToViewport(state.activeSortState || state.activeColumnFilters.size > 0 ? state.transformedRowsSnapshot : null);
            });

            appendSeparator();
            appendFilterPanel();
            appendAction('Filter Non-Empty', async () => {
                await applyColumnFilter('nonEmpty', '', false);
            });
            appendAction('Clear Column Filter', async () => {
                await clearColumnFilter();
            });
            appendAction('Clear All Filters/Sort', async () => {
                if (!state.sourceRowsSnapshot && state.activeColumnFilters.size === 0 && !state.activeSortState) {
                    return;
                }
                state.activeColumnFilters.clear();
                state.activeSortState = null;
                applyDataOpsRowsToViewport(null);
            });
        }

        menu.classList.remove('hidden');

        const rect = menu.getBoundingClientRect();
        const left = Math.min(Math.max(8, e.clientX), window.innerWidth - rect.width - 8);
        const top = Math.min(Math.max(8, e.clientY), window.innerHeight - rect.height - 8);
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
    }

    function showCellContextMenu(e: MouseEvent, cell: HTMLElement) {
        if (state.isVersionPreviewMode) {
            showToast('Version preview is read-only');
            return;
        }

        const menu = ensureHeaderContextMenu();
        menu.innerHTML = '';

        const rowNumber = parseInt(cell.getAttribute('data-rownum') || '0', 10);
        const colNumber = parseInt(cell.getAttribute('data-colnum') || '0', 10);
        if (!rowNumber || !colNumber) {return;}
        const appendAction = (label: string, onClick: () => void, cls = 'header-context-item') => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = cls;
            btn.textContent = label;
            btn.addEventListener('click', () => {
                onClick();
            });
            menu.appendChild(btn);
        };

        appendAction('Copy', () => {
            hideHeaderContextMenu();
            copySelectionToClipboard();
        });
        appendAction('Paste', async () => {
            hideHeaderContextMenu();
            if (navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
                try {
                    const text = await navigator.clipboard.readText();
                    pasteTextAtSelection(text);
                } catch (err) {
                    const text = prompt('Paste content:');
                    if (text !== null) {
                        pasteTextAtSelection(text);
                    }
                }
            } else {
                const text = prompt('Paste content:');
                if (text !== null) {
                    pasteTextAtSelection(text);
                }
            }
        });

        const isWrapped = cell.style.whiteSpace === 'pre-wrap';
        appendAction(isWrapped ? '✓ Text wrap' : 'Text wrap', () => {
            hideHeaderContextMenu();
            const nextMode: WrapMode = isWrapped ? 'overflow' : 'wrap';
            const targets = getEditTargetCells();
            const inSelection = targets.some(c => c === cell);
            if (inSelection) {
                const bounds = getLogicalSelectionBounds();
                if (bounds) {
                    applyWrapModeToRange(bounds.minRow, bounds.maxRow, bounds.minCol, bounds.maxCol, nextMode);
                }
            } else {
                const r = parseInt(cell.getAttribute('data-row') || '0', 10);
                const c = parseInt(cell.getAttribute('data-col') || '0', 10);
                applyWrapModeToRange(r, r, c, c, nextMode);
            }
        });

        const topSeparator = document.createElement('div');
        topSeparator.className = 'header-context-separator';
        menu.appendChild(topSeparator);

        appendAction('Insert row above', () => applyStructureOperation({ type: 'insertRowAbove', index: rowNumber }));
        appendAction('Insert row below', () => applyStructureOperation({ type: 'insertRowBelow', index: rowNumber }));
        appendAction('Insert column left', () => applyStructureOperation({ type: 'insertColumnLeft', index: colNumber }));
        appendAction('Insert column right', () => applyStructureOperation({ type: 'insertColumnRight', index: colNumber }));

        const separator = document.createElement('div');
        separator.className = 'header-context-separator';
        menu.appendChild(separator);

        appendAction('Insert cell and shift right', () => applyCellInsertOperation('insertCellShiftRight', rowNumber, colNumber));
        appendAction('Insert cell and shift down', () => applyCellInsertOperation('insertCellShiftDown', rowNumber, colNumber));
        appendAction('Delete cell and shift left', () => applyCellDeleteOperation('deleteCellShiftLeft', rowNumber, colNumber));
        appendAction('Delete cell and shift up', () => applyCellDeleteOperation('deleteCellShiftUp', rowNumber, colNumber));

        menu.classList.remove('hidden');

        const rect = menu.getBoundingClientRect();
        const left = Math.min(Math.max(8, e.clientX), window.innerWidth - rect.width - 8);
        const top = Math.min(Math.max(8, e.clientY), window.innerHeight - rect.height - 8);
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
    }

    function captureEditSelectionRange() {
        if (!state.isEditMode) {return;}
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {return;}

        const range = selection.getRangeAt(0);
        const node = range.commonAncestorContainer;
        const element = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement) as HTMLElement | null;
        if (!element) {return;}

        const editableCell = element.closest('td[contenteditable="true"]');
        if (!editableCell) {return;}

        state.lastEditRange = range.cloneRange();
    }

    function restoreEditSelectionRange() {
        if (!state.lastEditRange) {return false;}

        const node = state.lastEditRange.commonAncestorContainer;
        const element = (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement) as HTMLElement | null;
        if (!element) {return false;}

        const editableCell = element.closest('td[contenteditable="true"]') as HTMLElement | null;
        if (!editableCell || !document.contains(editableCell)) {return false;}

        editableCell.focus();
        const selection = window.getSelection();
        if (!selection) {return false;}
        selection.removeAllRanges();
        selection.addRange(state.lastEditRange);
        return true;
    }

    function applyInlineStyleToSelection(styleName: 'color' | 'backgroundColor', value: string) {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {return;}
        const range = selection.getRangeAt(0);
        if (range.collapsed) {return;}

        const wrapper = document.createElement('span');
        wrapper.style[styleName] = value;

        try {
            const extracted = range.extractContents();
            wrapper.appendChild(extracted);
            range.insertNode(wrapper);

            const newRange = document.createRange();
            newRange.selectNodeContents(wrapper);
            selection.removeAllRanges();
            selection.addRange(newRange);
            state.lastEditRange = newRange.cloneRange();
        } catch {
            // Ignore range failures and keep editor functional.
        }
    }

    function updatePlainViewButtonLabel() {
        const btn = document.getElementById('togglePlainViewButton');
        if (!btn) {return;}

        const labelSpan = btn.querySelector('.btn-label');
        if (labelSpan) {
            labelSpan.textContent = state.isPlainView ? 'Styled' : 'Plain';
        }
    }

    function syncPlainViewUiState() {
        document.body.classList.toggle('plain-view', state.isPlainView);
        updatePlainViewButtonLabel();
    }

    function isPlainDirectEditMode() {
        return state.isPlainView && !state.isVersionPreviewMode;
    }

    function shouldShowSheetSelector() {
        // Show sheet selector if there are multiple sheets, regardless of file type
        return state.worksheetsMeta && state.worksheetsMeta.length > 1;
    }

    function syncSheetSelectorVisibility() {
        const selector = document.getElementById('sheetSelector');
        if (!selector) {return;}
        selector.classList.toggle('hidden', state.isEditMode || !shouldShowSheetSelector());
    }

    function syncTemporaryFileToolbarActions() {
        const togglePlainViewButton = document.getElementById('togglePlainViewButton');
        const toggleTableEditButton = document.getElementById('toggleTableEditButton');
        const hideEditTableButton = isPlainDirectEditMode();

        if (state.toolbarManager) {
            state.toolbarManager.setButtonVisibility('togglePlainViewButton', !state.isEditMode || state.isPlainView);
            state.toolbarManager.setButtonVisibility('toggleTableEditButton', !state.isEditMode && !hideEditTableButton);
            return;
        }

        if (togglePlainViewButton) {
            togglePlainViewButton.classList.toggle('hidden', state.isEditMode && !state.isPlainView);
        }
        if (toggleTableEditButton) {
            toggleTableEditButton.classList.toggle('hidden', state.isEditMode || hideEditTableButton);
        }
    }

    function resolveSettingsScope(scope: any): SettingsScope {
        return scope === 'plain' ? 'plain' : 'styled';
    }

    function getCurrentSettingsScope(): SettingsScope {
        return state.isPlainView ? 'plain' : 'styled';
    }

    function getStoredSettingsForScope(scope: SettingsScope): XlsxViewSettings {
        return scope === 'plain' ? state.plainModeSettings : state.styledModeSettings;
    }

    function setStoredSettingsForScope(scope: SettingsScope, settings: XlsxViewSettings) {
        if (scope === 'plain') {
            state.plainModeSettings = { ...settings };
            return;
        }
        state.styledModeSettings = { ...settings };
    }

    function normalizeSettingsForScope(scope: SettingsScope, incoming: any, previous: XlsxViewSettings): XlsxViewSettings {
        const normalized = normalizeXlsxSettings(incoming, previous);
        if (scope === 'plain') {
            normalized.autoSaveMode = 'all';
            normalized.showManualSavePopup = false;
        }
        return normalized;
    }

    function ingestSettingsForScope(scope: SettingsScope, incoming: any) {
        const previous = getStoredSettingsForScope(scope);
        const normalized = normalizeSettingsForScope(scope, incoming, previous);
        setStoredSettingsForScope(scope, normalized);
    }

    function applySettingsForScope(scope: SettingsScope) {
        applySettings(getStoredSettingsForScope(scope), scope);
    }

    function consumeIncomingSettingsPayload(message: any) {
        const incomingScope = resolveSettingsScope(message?.settingsScope);

        if (message?.plainSettings) {
            ingestSettingsForScope('plain', message.plainSettings);
        }
        if (message?.styledSettings) {
            ingestSettingsForScope('styled', message.styledSettings);
        }

        if (message?.settings) {
            const shouldIngestPlain = incomingScope === 'plain' && !message?.plainSettings;
            const shouldIngestStyled = incomingScope === 'styled' && !message?.styledSettings;
            if (shouldIngestPlain) {
                ingestSettingsForScope('plain', message.settings);
            }
            if (shouldIngestStyled) {
                ingestSettingsForScope('styled', message.settings);
            }
        }

        const scopeToApply = state.hasVirtualTableInit ? getCurrentSettingsScope() : incomingScope;
        applySettingsForScope(scopeToApply);
    }

    function requestStyledMode(nextAction?: () => void) {
        if (!state.isTemporaryStyleFile || !state.isPlainView) {
            return false;
        }

        state.pendingStyleModeAction = nextAction ?? null;
        if (!state.styleModeRequestPending) {
            state.styleModeRequestPending = true;
            post({ command: 'requestStyleMode' });
        }
        return true;
    }

    function activateStyledMode() {
        state.styleModeRequestPending = false;
        hideStyleModeNoticePopup();
        state.isPlainView = false;
        syncPlainViewUiState();
        syncTemporaryFileToolbarActions();
        if (state.isTemporaryStyleFile) {
            post({ command: 'setPreferredViewMode', mode: 'styled' });
        }
        applySettingsForScope('styled');

        // Flush any pending plain-mode edits before switching so data is not lost.
        // Then request a full re-init from the provider to get fresh data (the
        // provider re-reads the file which contains the auto-saved plain edits).
        if (state.pendingOutsideControlEdits.length > 0) {
            saveEdits(false, true);
        }
        state.rowCache.clear();
        state.currentVisibleStart = 0;
        state.currentVisibleEnd = 0;
        renderWorksheet(state.currentWorksheet);

        const nextAction = state.pendingStyleModeAction;
        state.pendingStyleModeAction = null;
        if (nextAction) {
            setTimeout(() => {
                try {
                    nextAction();
                } catch {
                    // ignore
                }
            }, 100);
        }
    }

    function cancelStyledModeRequest() {
        state.styleModeRequestPending = false;
        hideStyleModeNoticePopup();
        state.pendingStyleModeAction = null;
    }

    function applyEditFormatting(command: string, value?: string) {
        if (requestStyledMode(() => applyEditFormatting(command, value))) {
            return;
        }

        if (!state.isEditMode) {return;}

        const selection = window.getSelection();
        const hasLiveSelection = !!selection && selection.rangeCount > 0 && !selection.isCollapsed;

        if (!hasLiveSelection && !restoreEditSelectionRange()) {
            if (command === 'bold' || command === 'italic') {
                applyFormatToLogicalSelection({}, 'toggle', command as any);
                return;
            }

            showToast('Select text to format');
            return;
        }

        document.execCommand('styleWithCSS', false, 'true');
        const ok = value !== undefined
            ? document.execCommand(command, false, value)
            : document.execCommand(command, false);

        if (!ok && value !== undefined) {
            if (command === 'hiliteColor') {
                const fallbackOk = document.execCommand('backColor', false, value);
                if (!fallbackOk) {applyInlineStyleToSelection('backgroundColor', value);}
            } else if (command === 'foreColor') {
                // Fallback for engines that only support lower-case command alias.
                const fallbackOk = document.execCommand('forecolor', false, value);
                if (!fallbackOk) {applyInlineStyleToSelection('color', value);}
            }
        }

        captureEditSelectionRange();
    }

    function getEditTargetCells(): HTMLElement[] {
        const targets = Array.from(state.selectedCells)
            .filter(cell => document.contains(cell) && cell.tagName === 'TD')
            .map(cell => {
                const row = cell.getAttribute('data-row');
                const col = cell.getAttribute('data-col');
                return document.querySelector('td[data-row="' + row + '"][data-col="' + col + '"]') as HTMLElement | null;
            })
            .filter(Boolean) as HTMLElement[];

        if (targets.length > 0) {return targets;}

        if (state.activeCell && document.contains(state.activeCell) && state.activeCell.tagName === 'TD') {
            return [state.activeCell];
        }

        const focused = document.activeElement as HTMLElement | null;
        if (focused && document.contains(focused) && focused.tagName === 'TD') {
            return [focused];
        }
        return [];
    }

    function applyFormatToLogicalSelection(styleChanges: Partial<CellStyleEdit>, mode: 'set' | 'toggle' = 'set', toggleKey?: keyof CellStyleEdit) {
        if (requestStyledMode(() => applyFormatToLogicalSelection(styleChanges, mode, toggleKey))) {
            return;
        }

        const bounds = getLogicalSelectionBounds();
        if (!bounds) {
            showToast('Select cells to format');
            return;
        }

        const beforeStates: CellUndoState[] = [];
        const afterStates: CellUndoState[] = [];

        // Protection against freezing UI on entire sheet selection (e.g. 100K x 100 cols)
        // If it's more than 200k cells, we might need a warning, but let's allow it
        const maxCells = 200000;
        const cellCount = (bounds.maxRow - bounds.minRow + 1) * (bounds.maxCol - bounds.minCol + 1);

        if (cellCount > maxCells) {
            showToast(`Selection too large (${cellCount} cells) for individual formatting. Please select a smaller range.`);
            return;
        }

        // Logical Pass
        for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
            for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
                const rowNum = r + 1;
                const colNum = c + 1;
                const key = rowNum + ':' + colNum;

                let targetStyle = { ...styleChanges };

                if (mode === 'toggle' && toggleKey) {
                    const currentPending = state.pendingCellStyleEdits.get(key);
                    const domCell = document.querySelector(`td[data-row="${r}"][data-col="${c}"]`) as HTMLElement | null;
                    let currentlyEnabled = false;

                    if (currentPending) {
                        if (toggleKey === 'bold') {
                            currentlyEnabled = currentPending.fontWeight === 'bold';
                        } else if (toggleKey === 'italic') {
                            currentlyEnabled = currentPending.fontStyle === 'italic';
                        } else if (toggleKey === 'strike') {
                            currentlyEnabled = !!(currentPending.textDecorationLine?.includes('line-through') || currentPending.textDecoration?.includes('line-through'));
                        } else if (currentPending[toggleKey] !== undefined) {
                            currentlyEnabled = !!currentPending[toggleKey];
                        }
                    } else if (domCell) {
                        // Extract from DOM
                        if (toggleKey === 'bold') {currentlyEnabled = domCell.style.fontWeight === 'bold';}
                        else if (toggleKey === 'italic') {currentlyEnabled = domCell.style.fontStyle === 'italic';}
                        else if (toggleKey === 'strike') {currentlyEnabled = domCell.style.textDecorationLine === 'line-through';}
                    } else {
                        // Unmounted cell fallback
                        // We would ideally look up from rowCache, but for toggle we assume false if unknown unmounted
                        currentlyEnabled = false;
                    }
                    targetStyle[toggleKey] = !currentlyEnabled as any;
                }

                // Gather before state
                const pendingStyle = state.pendingCellStyleEdits.has(key) ? cloneCellStyleEdit(state.pendingCellStyleEdits.get(key)) : null;
                const domCell = document.querySelector(`td[data-row="${r}"][data-col="${c}"]`) as HTMLElement | null;
                beforeStates.push({
                    row: r, col: c, key,
                    styleAttr: domCell ? (domCell.getAttribute('style') || '') : '',
                    innerHtml: domCell ? domCell.innerHTML : '',
                    pendingStyle
                });

                recordLogicalStyleEdit(r, c, targetStyle);

                if (domCell) {
                    applyStyleToCellFromPainter(domCell, targetStyle);
                    afterStates.push({
                        row: r, col: c, key,
                        styleAttr: domCell.getAttribute('style') || '',
                        innerHtml: domCell.innerHTML,
                        pendingStyle: cloneCellStyleEdit(state.pendingCellStyleEdits.get(key))
                    });
                } else {
                    afterStates.push({
                        row: r, col: c, key,
                        styleAttr: '',
                        innerHtml: '',
                        pendingStyle: cloneCellStyleEdit(state.pendingCellStyleEdits.get(key))
                    });
                }
            }
        }

        if (beforeStates.length && afterStates.length) {
            pushEditUndoEntry({ before: beforeStates, after: afterStates });
        }
    }

    function getLogicalSelectionBounds(): { minRow: number, maxRow: number, minCol: number, maxCol: number } | null {
        const hasFullColumnSelection = state.selectedColumnIndices.size > 0;
        const hasFullRowSelection = state.selectedRowIndices.size > 0;

        if (hasFullRowSelection && hasFullColumnSelection) {
            return { minRow: 0, maxRow: state.totalRows - 1, minCol: 0, maxCol: state.columnCount - 1 };
        }

        if (hasFullRowSelection) {
            const minRow = Math.min(...Array.from(state.selectedRowIndices));
            const maxRow = Math.max(...Array.from(state.selectedRowIndices));
            return { minRow, maxRow, minCol: 0, maxCol: state.columnCount - 1 };
        }

        if (hasFullColumnSelection) {
            const minCol = Math.min(...Array.from(state.selectedColumnIndices));
            const maxCol = Math.max(...Array.from(state.selectedColumnIndices));
            return { minRow: 0, maxRow: state.totalRows - 1, minCol, maxCol };
        }

        if (state.selectionStart && state.selectionEnd) {
            return expandSelectionBoundsForMergedCells(
                Math.min(state.selectionStart.row, state.selectionEnd.row),
                Math.max(state.selectionStart.row, state.selectionEnd.row),
                Math.min(state.selectionStart.col, state.selectionEnd.col),
                Math.max(state.selectionStart.col, state.selectionEnd.col)
            );
        }

        if (state.selectedCells.size > 0) {
            const rows: number[] = [];
            const cols: number[] = [];
            state.selectedCells.forEach((cell) => {
                const row = parseInt(cell.dataset.row || '-1', 10);
                const col = parseInt(cell.dataset.col || '-1', 10);
                if (row >= 0 && col >= 0) {
                    rows.push(row);
                    cols.push(col);
                }
            });

            if (rows.length > 0 && cols.length > 0) {
                return {
                    minRow: Math.min(...rows),
                    maxRow: Math.max(...rows),
                    minCol: Math.min(...cols),
                    maxCol: Math.max(...cols)
                };
            }
        }

        if (state.activeCell) {
            const row = parseInt(state.activeCell.dataset.row || '0', 10);
            const col = parseInt(state.activeCell.dataset.col || '0', 10);
            return { minRow: row, maxRow: row, minCol: col, maxCol: col };
        }

        return null;
    }

    function getEditableCellsOrToast(message: string): HTMLElement[] {
        const cells = getEditTargetCells();
        if (!cells.length) {
            showToast(message);
            return [];
        }
        return cells;
    }

    function applyHorizontalAlign(value: HorizontalAlign) {
        if (requestStyledMode(() => applyHorizontalAlign(value))) {
            return;
        }

        const cells = getEditableCellsOrToast('Select cells to align');
        if (!cells.length) {return;}

        cells.forEach(cell => {
            cell.style.textAlign = value;
            recordCellStyleEdit(cell, { horizontalAlign: value });
        });
    }

    function applyVerticalAlign(value: VerticalAlign) {
        if (requestStyledMode(() => applyVerticalAlign(value))) {
            return;
        }

        const cells = getEditableCellsOrToast('Select cells to align');
        if (!cells.length) {return;}

        cells.forEach(cell => {
            cell.style.verticalAlign = value;
            recordCellStyleEdit(cell, { verticalAlign: value });
        });
    }

    function applyFontSize(value: number) {
        if (requestStyledMode(() => applyFontSize(value))) {
            return;
        }

        const cells = getEditableCellsOrToast('Select cells to set font size');
        if (!cells.length) {return;}

        const next = Math.max(6, Math.min(72, value));
        cells.forEach(cell => {
            cell.style.fontSize = `${next}pt`;
            recordCellStyleEdit(cell, { fontSize: next });
        });
    }

    function shiftFontSize(delta: number) {
        const sourceCell = state.activeCell || getEditTargetCells()[0] || null;
        if (!sourceCell) {
            showToast('Select cells to set font size');
            return;
        }

        const computed = window.getComputedStyle(sourceCell).fontSize;
        const numeric = parseFloat(computed || '11');
        const pts = Math.round((numeric * 72) / 96);
        applyFontSize(pts + delta);
    }

    function applyFontFamily(value: string) {
        if (requestStyledMode(() => applyFontFamily(value))) {
            return;
        }

        const cells = getEditableCellsOrToast('Select cells to set font family');
        if (!cells.length) {return;}

        cells.forEach(cell => {
            cell.style.fontFamily = value;
            recordCellStyleEdit(cell, { fontFamily: value });
        });
    }

    function applyWrapModeToRange(minRow: number, maxRow: number, minCol: number, maxCol: number, wrapMode: WrapMode) {
        if (requestStyledMode(() => applyWrapModeToRange(minRow, maxRow, minCol, maxCol, wrapMode))) {
            return;
        }

        const beforeStates: CellUndoState[] = [];
        const afterStates: CellUndoState[] = [];

        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                const rowNum = r + 1;
                const colNum = c + 1;
                const key = rowNum + ':' + colNum;

                const pendingStyle = state.pendingCellStyleEdits.has(key) ? cloneCellStyleEdit(state.pendingCellStyleEdits.get(key)) : null;
                const domCell = document.querySelector(`td[data-row="${r}"][data-col="${c}"]`) as HTMLElement | null;

                beforeStates.push({
                    row: r, col: c, key,
                    styleAttr: domCell ? (domCell.getAttribute('style') || '') : '',
                    innerHtml: domCell ? domCell.innerHTML : '',
                    pendingStyle
                });

                recordLogicalStyleEdit(r, c, { wrapMode });

                if (domCell) {
                    applyStyleToCellFromPainter(domCell, { wrapMode });
                    afterStates.push({
                        row: r, col: c, key,
                        styleAttr: domCell.getAttribute('style') || '',
                        innerHtml: domCell.innerHTML,
                        pendingStyle: cloneCellStyleEdit(state.pendingCellStyleEdits.get(key))
                    });
                } else {
                    afterStates.push({
                        row: r, col: c, key,
                        styleAttr: '',
                        innerHtml: '',
                        pendingStyle: cloneCellStyleEdit(state.pendingCellStyleEdits.get(key))
                    });
                }
            }
        }

        if (beforeStates.length && afterStates.length) {
            pushEditUndoEntry({ before: beforeStates, after: afterStates });
        }
    }

    function applyIndent(delta: number) {
        if (requestStyledMode(() => applyIndent(delta))) {
            return;
        }

        const cells = getEditableCellsOrToast('Select cells to indent');
        if (!cells.length) {return;}

        cells.forEach(cell => {
            const current = parseInt(cell.style.paddingLeft || '0', 10) || 0;
            const next = Math.max(0, current + delta);
            cell.style.paddingLeft = `${next}px`;
            recordCellStyleEdit(cell, { indent: Math.round(next / 8) });
        });
    }

    function applyStrikeThrough() {
        if (requestStyledMode(() => applyStrikeThrough())) {
            return;
        }

        const selection = window.getSelection();
        const hasTextSelection = !!selection && selection.rangeCount > 0 && !selection.isCollapsed;

        if (hasTextSelection || restoreEditSelectionRange()) {
            const current = window.getSelection();
            if (current && current.rangeCount > 0 && !current.isCollapsed) {
                applyEditFormatting('strikeThrough');
                return;
            }
        }

        const cells = getEditableCellsOrToast('Select cells to strike through');
        if (!cells.length) {return;}

        cells.forEach(cell => {
            const hasStrike = (cell.style.textDecoration || '').includes('line-through');
            if (hasStrike) {
                cell.style.textDecoration = '';
                cell.style.textDecorationLine = '';
                cell.style.textDecorationThickness = '';
                cell.style.textDecorationSkipInk = '';
                cell.style.textDecorationColor = '';
            } else {
                cell.style.textDecorationLine = 'line-through';
                cell.style.textDecorationThickness = '2px';
                cell.style.textDecorationSkipInk = 'none';
                cell.style.textDecorationColor = 'currentColor';
            }
            recordCellStyleEdit(cell, { strike: !hasStrike });
        });
    }

    function applyBorderPreset(mode: BorderMode) {
        if (requestStyledMode(() => applyBorderPreset(mode))) {
            return;
        }

        state.selectedBorderMode = mode;
        const bounds = getLogicalSelectionBounds();
        if (!bounds) {
            showToast('Select cells to set borders');
            return;
        }

        const maxCells = 200000;
        const cellCount = (bounds.maxRow - bounds.minRow + 1) * (bounds.maxCol - bounds.minCol + 1);
        if (cellCount > maxCells) {
            showToast(`Selection too large (${cellCount} cells) for borders. Please select a smaller range.`);
            return;
        }

        const beforeStates: CellUndoState[] = [];
        const afterStates: CellUndoState[] = [];

        for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
            for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
                const domCell = document.querySelector(`td[data-row="${r}"][data-col="${c}"]`) as HTMLElement | null;
                const rowNum = r + 1;
                const colNum = c + 1;
                const key = rowNum + ':' + colNum;

                // Gather before state
                const pendingStyle = state.pendingCellStyleEdits.has(key) ? cloneCellStyleEdit(state.pendingCellStyleEdits.get(key)) : null;
                beforeStates.push({
                    row: r, col: c, key,
                    styleAttr: domCell ? (domCell.getAttribute('style') || '') : '',
                    innerHtml: domCell ? domCell.innerHTML : '',
                    pendingStyle
                });

                // Prepare border style
                const existingBorder = pendingStyle?.border || (domCell ? copyFormattingFromCell(domCell).border : null) || { top: false, right: false, bottom: false, left: false, style: state.selectedBorderLineStyle, color: state.selectedBorderColor };

                const border: BorderStyleEdit = {
                    ...existingBorder,
                    clear: false,
                    color: state.selectedBorderColor,
                    style: state.selectedBorderLineStyle
                };

                if (mode === 'none') {
                    border.clear = true;
                    border.top = false;
                    border.right = false;
                    border.bottom = false;
                    border.left = false;
                } else if (mode === 'all') {
                    border.top = true;
                    border.right = true;
                    border.bottom = true;
                    border.left = true;
                } else if (mode === 'inner') {
                    if (r > bounds.minRow) {border.top = true;}
                    if (r < bounds.maxRow) {border.bottom = true;}
                    if (c > bounds.minCol) {border.left = true;}
                    if (c < bounds.maxCol) {border.right = true;}
                } else if (mode === 'outside') {
                    if (r === bounds.minRow) {border.top = true;}
                    if (r === bounds.maxRow) {border.bottom = true;}
                    if (c === bounds.minCol) {border.left = true;}
                    if (c === bounds.maxCol) {border.right = true;}
                } else {
                    if (mode === 'top') {border.top = true;}
                    if (mode === 'bottom') {border.bottom = true;}
                    if (mode === 'left') {border.left = true;}
                    if (mode === 'right') {border.right = true;}
                }

                recordLogicalStyleEdit(r, c, { border });

                if (domCell) {
                    if (border.clear) {
                        domCell.style.borderTop = '';
                        domCell.style.borderRight = '';
                        domCell.style.borderBottom = '';
                        domCell.style.borderLeft = '';
                        domCell.setAttribute('data-default-border', 'true');
                        domCell.removeAttribute('data-black-border');
                        domCell.removeAttribute('data-white-border');
                    } else {
                        domCell.style.borderTop = buildBorderCss(!!border.top, border.style, border.color);
                        domCell.style.borderRight = buildBorderCss(!!border.right, border.style, border.color);
                        domCell.style.borderBottom = buildBorderCss(!!border.bottom, border.style, border.color);
                        domCell.style.borderLeft = buildBorderCss(!!border.left, border.style, border.color);
                        domCell.removeAttribute('data-default-border');
                        domCell.removeAttribute('data-black-border');
                        domCell.removeAttribute('data-white-border');
                    }

                    afterStates.push({
                        row: r, col: c, key,
                        styleAttr: domCell.getAttribute('style') || '',
                        innerHtml: domCell.innerHTML,
                        pendingStyle: cloneCellStyleEdit(state.pendingCellStyleEdits.get(key))
                    });
                } else {
                    afterStates.push({
                        row: r, col: c, key,
                        styleAttr: '',
                        innerHtml: '',
                        pendingStyle: cloneCellStyleEdit(state.pendingCellStyleEdits.get(key))
                    });
                }
            }
        }

        if (beforeStates.length && afterStates.length) {
            pushEditUndoEntry({ before: beforeStates, after: afterStates });
        }
    }

    function applyBorderColorToSelection(color: string) {
        if (requestStyledMode(() => applyBorderColorToSelection(color))) {
            return;
        }

        state.selectedBorderColor = color;

        const bounds = getLogicalSelectionBounds();
        if (!bounds) {
            showToast('Select cells to set border color');
            return;
        }

        const beforeStates: CellUndoState[] = [];
        const afterStates: CellUndoState[] = [];
        let recoloredExistingBorder = false;

        for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
            for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
                const domCell = document.querySelector(`td[data-row="${r}"][data-col="${c}"]`) as HTMLElement | null;
                const rowNum = r + 1;
                const colNum = c + 1;
                const key = rowNum + ':' + colNum;
                const pendingStyle = state.pendingCellStyleEdits.has(key) ? cloneCellStyleEdit(state.pendingCellStyleEdits.get(key)) : null;
                const existingBorder = (pendingStyle?.border || (domCell ? copyFormattingFromCell(domCell).border : null)) as BorderStyleEdit | null;

                const hasSides = !!existingBorder && !existingBorder.clear && (!!existingBorder.top || !!existingBorder.right || !!existingBorder.bottom || !!existingBorder.left);
                if (!hasSides) {
                    continue;
                }

                recoloredExistingBorder = true;

                beforeStates.push({
                    row: r,
                    col: c,
                    key,
                    styleAttr: domCell ? (domCell.getAttribute('style') || '') : '',
                    innerHtml: domCell ? domCell.innerHTML : '',
                    pendingStyle
                });

                const border: BorderStyleEdit = {
                    ...existingBorder,
                    clear: false,
                    color,
                    style: existingBorder?.style || state.selectedBorderLineStyle
                };

                recordLogicalStyleEdit(r, c, { border });

                if (domCell) {
                    domCell.style.borderTop = buildBorderCss(!!border.top, border.style, border.color);
                    domCell.style.borderRight = buildBorderCss(!!border.right, border.style, border.color);
                    domCell.style.borderBottom = buildBorderCss(!!border.bottom, border.style, border.color);
                    domCell.style.borderLeft = buildBorderCss(!!border.left, border.style, border.color);
                    domCell.removeAttribute('data-default-border');
                    domCell.removeAttribute('data-black-border');
                    domCell.removeAttribute('data-white-border');
                }

                afterStates.push({
                    row: r,
                    col: c,
                    key,
                    styleAttr: domCell ? (domCell.getAttribute('style') || '') : '',
                    innerHtml: domCell ? domCell.innerHTML : '',
                    pendingStyle: cloneCellStyleEdit(state.pendingCellStyleEdits.get(key))
                });
            }
        }

        if (beforeStates.length && afterStates.length) {
            pushEditUndoEntry({ before: beforeStates, after: afterStates });
        }

        if (!recoloredExistingBorder) {
            const mode = getSelectedBorderMode() === 'none' ? 'all' : getSelectedBorderMode();
            applyBorderPreset(mode);
        }
    }

    function clearFormattingOnSelection() {
        if (requestStyledMode(() => clearFormattingOnSelection())) {
            return;
        }

        applyFormatToLogicalSelection({
            clearFormatting: true,
            border: { clear: true }
        }, 'set');

        const bounds = getLogicalSelectionBounds();
        if (!bounds) {return;}

        for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
            for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
                const cell = document.querySelector(`td[data-row="${r}"][data-col="${c}"]`) as HTMLElement | null;
                if (!cell) {continue;}

                cell.style.backgroundColor = '';
                cell.style.color = '';
                cell.style.fontSize = '';
                cell.style.fontFamily = '';
                cell.style.fontWeight = '';
                cell.style.fontStyle = '';
                cell.style.textDecoration = '';
                cell.style.textDecorationLine = '';
                cell.style.textDecorationThickness = '';
                cell.style.textDecorationSkipInk = '';
                cell.style.textDecorationColor = '';
                cell.style.textAlign = '';
                cell.style.verticalAlign = '';
                cell.style.whiteSpace = '';
                cell.style.wordWrap = '';
                cell.style.overflow = '';
                cell.style.textOverflow = '';
                cell.style.paddingLeft = '';
                cell.style.borderTop = '';
                cell.style.borderRight = '';
                cell.style.borderBottom = '';
                cell.style.borderLeft = '';

                const plainText = normalizeCellText(cell.textContent || '');
                const safeText = plainText
                    ? plainText
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;')
                        .replace(/'/g, '&#39;')
                    : '&nbsp;';
                cell.innerHTML = `<span class="cell-content">${safeText}</span>`;
            }
        }
    }

    function resolveCellTypeForClear(cell: HTMLElement | null, rowIndex: number, colIndex: number): string {
        if (cell) {return getCellType(cell);}

        const rowData = state.rowCache.get(rowIndex);
        if (!rowData) {return 'text';}

        const cellData = getCellFromRow(rowData, colIndex + 1);
        const rawType = typeof cellData?.cellType === 'string' ? cellData.cellType.trim().toLowerCase() : '';
        if (rawType === 'checkbox' || rawType === 'dropdown' || rawType === 'rating' || rawType === 'date' || rawType === 'image') {
            return rawType;
        }
        return 'text';
    }

    function getClearedValueForCellType(cellType: string): string {
        if (cellType === 'checkbox') {return 'FALSE';}
        if (cellType === 'rating') {return '0';}
        return '';
    }

    function setPlainCellContent(cell: HTMLElement, value: string) {
        const plainText = normalizeCellText(value || '');
        const safeText = plainText ? formatCellTextHtml(plainText) : '&nbsp;';
        cell.innerHTML = `<span class="cell-content">${safeText}</span>`;
    }

    function applyClearedValueToCellData(cellData: any, cellType: string, value: string) {
        cellData.value = value;
        if (cellType === 'checkbox') {
            cellData.checkboxChecked = false;
            cellData.value = 'FALSE';
        } else if (cellType === 'rating') {
            cellData.value = value;
        } else if (cellType === 'image') {
            cellData.imageSrc = '';
        }

        cellData.isEmpty = cellData.value === '';
        if (cellData.isEmpty && cellData.hyperlink) {
            cellData.hyperlink = '';
        }
    }

    function applyClearedValueToDomCell(cell: HTMLElement, cellType: string, value: string) {
        if (state.isPlainView) {
            setPlainCellContent(cell, value);
        } else if (cellType === 'checkbox') {
            updateCheckboxCellPresentation(cell, false);
        } else if (cellType === 'dropdown') {
            updateDropdownCellPresentation(cell, value);
        } else if (cellType === 'rating') {
            updateRatingCellPresentation(cell, 0);
        } else if (cellType === 'date') {
            updateDateCellPresentation(cell, value);
        } else {
            setPlainCellContent(cell, value);
        }

        if (value === '') {
            cell.setAttribute('data-empty', 'true');
            cell.removeAttribute('data-hyperlink');
        } else {
            cell.removeAttribute('data-empty');
        }
    }

    function clearSelectionContents() {
        const bounds = getLogicalSelectionBounds();
        if (!bounds) {
            showToast('Select cells to clear');
            return;
        }

        const cellCount = (bounds.maxRow - bounds.minRow + 1) * (bounds.maxCol - bounds.minCol + 1);
        if (cellCount > 200000) {
            showToast(`Selection too large (${cellCount} cells) to clear. Please select a smaller range.`);
            return;
        }

        const beforeStates: CellUndoState[] = [];
        const afterStates: CellUndoState[] = [];
        let hasChanges = false;

        for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
            for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
                const rowNumber = r + 1;
                const colNumber = c + 1;
                const domCell = document.querySelector(`td[data-row="${r}"][data-col="${c}"]`) as HTMLElement | null;
                const cellType = resolveCellTypeForClear(domCell, r, c);
                const clearedValue = getClearedValueForCellType(cellType);

                if (domCell) {
                    const before = captureCellUndoState(domCell);
                    if (before) {beforeStates.push(before);}
                }

                const rowData = state.rowCache.get(r);
                if (rowData) {
                    let cellData = getCellFromRow(rowData, colNumber);
                    if (!cellData) {
                        cellData = getOrCreateRowCellData(r, c);
                    }
                    applyClearedValueToCellData(cellData, cellType, clearedValue);
                }

                syncLocalSnapshotValue(rowNumber, colNumber, clearedValue);
                upsertPendingOutsideControlEdit(rowNumber, colNumber, clearedValue);
                hasChanges = true;

                if (domCell) {
                    applyClearedValueToDomCell(domCell, cellType, clearedValue);
                    const after = captureCellUndoState(domCell);
                    if (after) {afterStates.push(after);}
                }
            }
        }

        if (beforeStates.length && afterStates.length) {
            pushEditUndoEntry({ before: beforeStates, after: afterStates });
        }

        if (!hasChanges) {return;}

        if (state.isEditMode) {
            scheduleAutoSave('text');
            return;
        }

        if (state.currentSettings.autoSave) {
            saveEdits(false, true);
            return;
        }

        showManualSaveReminderIfNeeded();
    }

    async function queueMergeOperation(type: 'mergeRange' | 'unmergeRange') {
        const bounds = getLogicalSelectionBounds();
        if (!bounds) {
            showToast('Select a range to merge');
            return;
        }

        if (type === 'mergeRange' && bounds.minRow === bounds.maxRow && bounds.minCol === bounds.maxCol) {
            showToast('Select at least two cells to merge');
            return;
        }

        if (type === 'mergeRange') {
            const confirmed = await confirmMergePreserveTopLeftContent();
            if (!confirmed) {return;}
        }

        const loaded = await ensureAllRowsLoadedForStructureEdits();
        if (!loaded) {return;}

        const scrollContainer = getTableContainer();
        const preservedScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
        const preservedScrollLeft = scrollContainer ? scrollContainer.scrollLeft : 0;

        const beforeSnapshot = captureWorksheetStateSnapshot();
        const rows = getMutableRowsSnapshot();
        const startRow = bounds.minRow + 1;
        const startCol = bounds.minCol + 1;
        const endRow = bounds.maxRow + 1;
        const endCol = bounds.maxCol + 1;

        if (type === 'mergeRange') {
            const anchorRow = rows[startRow - 1];
            if (!anchorRow) {return;}

            const anchorSource = getCellFromRow(anchorRow, startCol) || {
                rowNumber: startRow,
                colNumber: startCol,
                value: '',
                style: {}
            };
            const anchor = cloneCellData(anchorSource);
            anchor.rowNumber = startRow;
            anchor.colNumber = startCol;
            anchor.rowspan = Math.max(1, endRow - startRow + 1);
            anchor.colspan = Math.max(1, endCol - startCol + 1);
            anchor.isMerged = true;
            anchor.isMaster = true;
            anchor.isMergeCovered = false;
            anchor.masterRow = startRow;
            anchor.masterCol = startCol;
            setCellOnRow(anchorRow, startCol, anchor);

            for (let r = startRow; r <= endRow; r++) {
                const rowData = rows[r - 1];
                if (!rowData) {continue;}
                for (let c = startCol; c <= endCol; c++) {
                    if (r === startRow && c === startCol) {continue;}

                    const coveredExisting = getCellFromRow(rowData, c);
                    const covered = cloneCellData(coveredExisting || {
                        rowNumber: r,
                        colNumber: c,
                        value: '',
                        style: {}
                    });
                    covered.rowNumber = r;
                    covered.colNumber = c;
                    covered.value = '';
                    covered.rowspan = 1;
                    covered.colspan = 1;
                    covered.isMerged = true;
                    covered.isMaster = false;
                    covered.isMergeCovered = true;
                    covered.masterRow = startRow;
                    covered.masterCol = startCol;
                    setCellOnRow(rowData, c, covered);
                }
            }
        } else {
            let baseStyle: any = {};
            const anchorExisting = getCellFromRow(rows[startRow - 1], startCol);
            if (anchorExisting && anchorExisting.style) {
                baseStyle = cloneCellData(anchorExisting.style);
            }

            for (let r = startRow; r <= endRow; r++) {
                const rowData = rows[r - 1];
                if (!rowData) {continue;}
                for (let c = startCol; c <= endCol; c++) {
                    const existing = getCellFromRow(rowData, c);
                    const next = cloneCellData(existing || {
                        rowNumber: r,
                        colNumber: c,
                        value: '',
                        style: baseStyle
                    });
                    next.rowNumber = r;
                    next.colNumber = c;
                    delete next.rowspan;
                    delete next.colspan;
                    next.isMerged = false;
                    next.isMaster = false;
                    next.isMergeCovered = false;
                    next.masterRow = r;
                    next.masterCol = c;
                    if (existing?.isMergeCovered) {
                        next.value = '';
                        next.style = cloneCellData(baseStyle);
                    }
                    setCellOnRow(rowData, c, next);
                }
            }
        }

        normalizeRowsAfterStructureChange(rows, state.rowCache);
        rerenderCurrentSheetFromLocalState();
        requestAnimationFrame(() => {
            const containerAfter = getTableContainer();
            if (!containerAfter) {return;}
            containerAfter.scrollTop = preservedScrollTop;
            containerAfter.scrollLeft = preservedScrollLeft;
            void updateVisibleRows();
        });

        state.pendingWorksheetOps.push({
            type,
            startRow,
            startCol,
            endRow,
            endCol
        });
        scheduleAutoSave('structure');

        const afterSnapshot = captureWorksheetStateSnapshot();
        pushSheetUndoEntry(beforeSnapshot, afterSnapshot);

        showToast(type === 'mergeRange' ? 'Merged' : 'Unmerged');
    }

    function copyFormattingFromCell(cell: HTMLElement): Partial<CellStyleEdit> {
        const computed = window.getComputedStyle(cell);

        const isExplicitBorderValue = (value?: string) => {
            const s = (value || '').trim().toLowerCase();
            if (!s || s === 'none') {return false;}
            if (s === '0' || s === '0px' || s.startsWith('0px ')) {return false;}
            return true;
        };

        const inlineBorderAll = cell.style.border || '';
        const inlineTop = cell.style.borderTop || '';
        const inlineRight = cell.style.borderRight || '';
        const inlineBottom = cell.style.borderBottom || '';
        const inlineLeft = cell.style.borderLeft || '';

        const parseInlineBorder = (value?: string): { width: string; style: string; color: string } | null => {
            const raw = (value || '').trim();
            if (!isExplicitBorderValue(raw)) {return null;}

            const match = raw.match(/^([\d.]+px)\s+([a-zA-Z]+)\s+(.+)$/);
            if (!match) {return null;}

            return {
                width: match[1],
                style: match[2].toLowerCase(),
                color: normalizeColorToHex(match[3]) || state.selectedBorderColor
            };
        };

        // To avoid picking up default table gridlines from CSS, check inline styles explicitly for borders
        // (Since all custom borders are applied via inline styles)
        const borderAllEnabled = isExplicitBorderValue(inlineBorderAll);
        const hasInlineBorders = borderAllEnabled || isExplicitBorderValue(inlineTop) || isExplicitBorderValue(inlineRight) || isExplicitBorderValue(inlineBottom) || isExplicitBorderValue(inlineLeft);

        const topEnabled = borderAllEnabled || isExplicitBorderValue(inlineTop);
        const rightEnabled = borderAllEnabled || isExplicitBorderValue(inlineRight);
        const bottomEnabled = borderAllEnabled || isExplicitBorderValue(inlineBottom);
        const leftEnabled = borderAllEnabled || isExplicitBorderValue(inlineLeft);

        const topBorderLine = topEnabled ? parseInlineBorder(inlineTop || inlineBorderAll) : null;
        const rightBorderLine = rightEnabled ? parseInlineBorder(inlineRight || inlineBorderAll) : null;
        const bottomBorderLine = bottomEnabled ? parseInlineBorder(inlineBottom || inlineBorderAll) : null;
        const leftBorderLine = leftEnabled ? parseInlineBorder(inlineLeft || inlineBorderAll) : null;
        const activeBorderLine = topBorderLine || rightBorderLine || bottomBorderLine || leftBorderLine;

        const pickBorderStyle = () => {
            if (!hasInlineBorders) {return 'thin';}
            if (activeBorderLine) {
                return inferBorderLineStyleFromCss(activeBorderLine.style, activeBorderLine.width);
            }

            const fallbackStyle = topEnabled
                ? computed.borderTopStyle
                : rightEnabled
                    ? computed.borderRightStyle
                    : bottomEnabled
                        ? computed.borderBottomStyle
                        : computed.borderLeftStyle;
            const fallbackWidth = topEnabled
                ? computed.borderTopWidth
                : rightEnabled
                    ? computed.borderRightWidth
                    : bottomEnabled
                        ? computed.borderBottomWidth
                        : computed.borderLeftWidth;

            return inferBorderLineStyleFromCss((fallbackStyle || '').toLowerCase(), fallbackWidth || '1px');
        };

        const pickBorderColor = () => {
            if (!hasInlineBorders) {return state.selectedBorderColor;}
            if (topBorderLine?.color) {return topBorderLine.color;}
            if (rightBorderLine?.color) {return rightBorderLine.color;}
            if (bottomBorderLine?.color) {return bottomBorderLine.color;}
            if (leftBorderLine?.color) {return leftBorderLine.color;}
            if (topEnabled) {return normalizeColorToHex(computed.borderTopColor);}
            if (rightEnabled) {return normalizeColorToHex(computed.borderRightColor);}
            if (bottomEnabled) {return normalizeColorToHex(computed.borderBottomColor);}
            if (leftEnabled) {return normalizeColorToHex(computed.borderLeftColor);}
            return normalizeColorToHex(computed.borderColor) || state.selectedBorderColor;
        };

        // If no inline borders exist, the entire border object means "clear"
        const border: BorderStyleEdit = hasInlineBorders ? {
            top: topEnabled,
            right: rightEnabled,
            bottom: bottomEnabled,
            left: leftEnabled,
            color: pickBorderColor(),
            style: pickBorderStyle()
        } : { clear: true };

        return {
            bgColor: normalizeColorToHex(computed.backgroundColor),
            textColor: normalizeColorToHex(computed.color),
            bold: computed.fontWeight === 'bold' || parseInt(computed.fontWeight || '400', 10) >= 600,
            italic: computed.fontStyle === 'italic',
            fontFamily: computed.fontFamily,
            fontSize: Math.round((parseFloat(computed.fontSize || '11') * 72) / 96),
            strike: computed.textDecorationLine.includes('line-through'),
            horizontalAlign: (computed.textAlign as HorizontalAlign) || 'left',
            verticalAlign: (computed.verticalAlign as VerticalAlign) || 'top',
            wrapMode: computed.whiteSpace.includes('wrap') ? 'wrap' : 'overflow',
            indent: Math.round((parseInt(computed.paddingLeft || '0', 10) || 0) / 8),
            border
        };
    }

    function applyStyleToCellFromPainter(cell: HTMLElement, style: any) {
        const backgroundColor = typeof style.backgroundColor === 'string' ? style.backgroundColor : (typeof style.bgColor === 'string' ? style.bgColor : '');
        if ('backgroundColor' in style || 'bgColor' in style) {
            cell.style.backgroundColor = backgroundColor || '';
            if (backgroundColor) {
                cell.removeAttribute('data-default-bg');
                cell.removeAttribute('data-white-bg');
                cell.removeAttribute('data-black-bg');
            }
        }
        const textColor = typeof style.color === 'string' ? style.color : (typeof style.textColor === 'string' ? style.textColor : '');
        if ('color' in style || 'textColor' in style) {
            if (textColor) {
                cell.style.setProperty('color', textColor, 'important');
            } else {
                cell.style.removeProperty('color');
            }
            if (textColor) {
                cell.removeAttribute('data-default-color');
            }
        }
        if (typeof style.fontWeight === 'string') {
            cell.style.fontWeight = style.fontWeight;
        } else if (typeof style.bold === 'boolean') {
            cell.style.fontWeight = style.bold ? 'bold' : 'normal';
        }
        if (typeof style.fontStyle === 'string') {
            cell.style.fontStyle = style.fontStyle;
        } else if (typeof style.italic === 'boolean') {
            cell.style.fontStyle = style.italic ? 'italic' : 'normal';
        }
        if (typeof style.fontSize === 'string') {
            cell.style.fontSize = style.fontSize;
        } else if (typeof style.fontSize === 'number') {
            cell.style.fontSize = `${style.fontSize}pt`;
        }
        if ('fontFamily' in style) {
            cell.style.fontFamily = style.fontFamily || '';
        }
        const strike = typeof style.textDecorationLine === 'string'
            ? style.textDecorationLine.includes('line-through')
            : typeof style.strike === 'boolean'
                ? style.strike
                : undefined;
        if (typeof strike === 'boolean') {
            if (strike) {
                cell.style.textDecorationLine = 'line-through';
                cell.style.textDecorationThickness = '2px';
                cell.style.textDecorationSkipInk = 'none';
                cell.style.textDecorationColor = 'currentColor';
            } else {
                cell.style.textDecoration = '';
                cell.style.textDecorationLine = '';
                cell.style.textDecorationThickness = '';
                cell.style.textDecorationSkipInk = '';
                cell.style.textDecorationColor = '';
            }
        }
        if (style.textAlign) {
            cell.style.textAlign = style.textAlign;
        } else if (style.horizontalAlign) {
            cell.style.textAlign = style.horizontalAlign;
        }
        if (style.verticalAlign) {
            cell.style.verticalAlign = style.verticalAlign;
        }
        if (style.whiteSpace || style.wordWrap || style.overflow || style.wrapMode) {
            const content = cell.querySelector('.cell-content') as HTMLElement | null;
            const wrapMode = style.wrapMode;
            if (style.whiteSpace === 'pre-wrap' || wrapMode === 'wrap') {
                cell.style.whiteSpace = 'pre-wrap';
                cell.style.wordWrap = 'break-word';
                cell.style.overflow = 'visible';
                cell.style.textOverflow = 'clip';
                if (content) {
                    content.style.whiteSpace = 'pre-wrap';
                    content.style.wordWrap = 'break-word';
                    content.style.overflow = 'visible';
                    content.style.textOverflow = 'clip';
                }
            } else if (style.whiteSpace === 'nowrap' && style.overflow !== 'hidden' || wrapMode === 'overflow') {
                cell.style.whiteSpace = 'nowrap';
                cell.style.wordWrap = 'normal';
                cell.style.overflow = 'visible';
                cell.style.textOverflow = 'clip';
                if (content) {
                    content.style.whiteSpace = 'nowrap';
                    content.style.wordWrap = 'normal';
                    content.style.overflow = 'visible';
                    content.style.textOverflow = 'clip';
                }
            } else {
                cell.style.whiteSpace = 'nowrap';
                cell.style.wordWrap = 'normal';
                cell.style.overflow = 'hidden';
                cell.style.textOverflow = 'clip';
                if (content) {
                    content.style.whiteSpace = 'nowrap';
                    content.style.wordWrap = 'normal';
                    content.style.overflow = 'hidden';
                    content.style.textOverflow = 'clip';
                }
            }
        }
        if (typeof style.paddingLeft === 'string') {
            cell.style.paddingLeft = style.paddingLeft;
        } else if (typeof style.indent === 'number') {
            cell.style.paddingLeft = `${Math.max(0, style.indent) * 8}px`;
        }
        if (style.border) {
            if (style.border.clear) {
                cell.style.borderTop = '';
                cell.style.borderRight = '';
                cell.style.borderBottom = '';
                cell.style.borderLeft = '';
                cell.setAttribute('data-default-border', 'true');
                cell.removeAttribute('data-black-border');
                cell.removeAttribute('data-white-border');
            } else {
                cell.style.borderTop = buildBorderCss(!!style.border.top, style.border.style, style.border.color);
                cell.style.borderRight = buildBorderCss(!!style.border.right, style.border.style, style.border.color);
                cell.style.borderBottom = buildBorderCss(!!style.border.bottom, style.border.style, style.border.color);
                cell.style.borderLeft = buildBorderCss(!!style.border.left, style.border.style, style.border.color);
                cell.removeAttribute('data-default-border');
                cell.removeAttribute('data-black-border');
                cell.removeAttribute('data-white-border');
            }
        }

        recordCellStyleEdit(cell, style);
    }

    function toggleFormatPainter() {
        if (state.formatPainterArmed) {
            state.formatPainterArmed = false;
            state.formatPainterStyle = null;
            document.body.classList.remove('format-painter-armed');
            showToast('Format painter off');
            return;
        }

        const source = state.activeCell || getEditTargetCells()[0] || null;
        if (!source) {
            showToast('Select a source cell first');
            return;
        }

        state.formatPainterStyle = copyFormattingFromCell(source);
        if (state.formatPainterStyle.border?.style) {
            syncBorderControlsFromStyle(state.formatPainterStyle.border.style);
            syncBorderStyleFromControls();
        }
        state.formatPainterArmed = true;
        document.body.classList.add('format-painter-armed');
        showToast('Format painter on: click a target cell');
    }

    function applyCellBackgroundColor(color: string) {
        applyFormatToLogicalSelection({ bgColor: color }, 'set');
    }

    function applyTextColor(color: string) {
        const selection = window.getSelection();
        const hasTextSelection = !!selection && selection.rangeCount > 0 && !selection.isCollapsed;

        if (hasTextSelection || restoreEditSelectionRange()) {
            const currentSelection = window.getSelection();
            if (currentSelection && currentSelection.rangeCount > 0 && !currentSelection.isCollapsed) {
                const range = currentSelection.getRangeAt(0);
                const startNode = range.startContainer;
                const endNode = range.endContainer;
                const startEl = (startNode.nodeType === Node.ELEMENT_NODE ? startNode : startNode.parentElement) as HTMLElement | null;
                const endEl = (endNode.nodeType === Node.ELEMENT_NODE ? endNode : endNode.parentElement) as HTMLElement | null;
                const startCell = startEl ? startEl.closest('td[contenteditable="true"]') : null;
                const endCell = endEl ? endEl.closest('td[contenteditable="true"]') : null;

                // In edit mode, text color formatting should not span across multiple cells.
                if (!state.isEditMode || (startCell && endCell && startCell === endCell)) {
                    applyEditFormatting('foreColor', color);
                    return;
                }
            }
        }

        const cells = getEditTargetCells();
        if (cells.length === 0) {
            showToast('Select text or a cell to apply text color');
            return;
        }

        applyFormatToLogicalSelection({ textColor: color }, 'set');
    }

    function ensureColorPalette() {
        if (state.colorPaletteEl) {return state.colorPaletteEl;}

        const palette = document.createElement('div');
        palette.id = 'sheetsColorPalette';
        palette.className = 'sheets-color-palette hidden';

        const swatches = [
            '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
            '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
            '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc'
        ];

        const title = document.createElement('div');
        title.className = 'sheets-color-title';
        title.textContent = 'Colors';
        palette.appendChild(title);

        const grid = document.createElement('div');
        grid.className = 'sheets-color-grid';
        swatches.forEach(color => {
            const sw = document.createElement('button');
            sw.type = 'button';
            sw.className = 'sheets-color-swatch';
            sw.style.backgroundColor = color;
            sw.setAttribute('data-color', color);
            sw.addEventListener('click', () => {
                if (state.activeColorTarget === 'text') {
                    state.selectedTextColor = color;
                    applyTextColor(color);
                    updateColorPreview('text', color);
                } else if (state.activeColorTarget === 'background') {
                    state.selectedBgColor = color;
                    applyCellBackgroundColor(color);
                    updateColorPreview('background', color);
                } else {
                    state.selectedBorderColor = color;
                    updateColorPreview('border', color);
                    applyBorderColorToSelection(color);
                }
                hideColorPalette();
            });
            grid.appendChild(sw);
        });
        palette.appendChild(grid);

        const customWrap = document.createElement('div');
        customWrap.className = 'sheets-color-custom';
        const customInput = document.createElement('input');
        customInput.type = 'color';
        customInput.id = 'sheetsCustomColorInput';
        customInput.value = state.selectedTextColor;
        customInput.addEventListener('input', () => {
            const color = customInput.value;
            if (state.activeColorTarget === 'text') {
                state.selectedTextColor = color;
                applyTextColor(color);
                updateColorPreview('text', color);
            } else if (state.activeColorTarget === 'background') {
                state.selectedBgColor = color;
                applyCellBackgroundColor(color);
                updateColorPreview('background', color);
            } else {
                state.selectedBorderColor = color;
                updateColorPreview('border', color);
                applyBorderColorToSelection(color);
            }
        });
        customWrap.appendChild(customInput);
        palette.appendChild(customWrap);

        document.body.appendChild(palette);
        state.colorPaletteEl = palette;
        return palette;
    }

    function hideColorPalette() {
        if (!state.colorPaletteEl) {return;}
        state.colorPaletteEl.classList.add('hidden');
        state.activeColorTarget = null;
    }

    function showColorPalette(anchor: HTMLElement, target: 'text' | 'background' | 'border') {
        const palette = ensureColorPalette();
        state.activeColorTarget = target;

        const input = palette.querySelector('#sheetsCustomColorInput') as HTMLInputElement | null;
        if (input) {
            input.value = target === 'text'
                ? state.selectedTextColor
                : target === 'background'
                    ? state.selectedBgColor
                    : state.selectedBorderColor;
        }

        palette.classList.remove('hidden');
        const rect = anchor.getBoundingClientRect();
        const paletteRect = palette.getBoundingClientRect();
        const left = Math.min(Math.max(8, rect.left), window.innerWidth - paletteRect.width - 8);
        const top = Math.min(rect.bottom + 6, window.innerHeight - paletteRect.height - 8);
        palette.style.left = left + 'px';
        palette.style.top = top + 'px';
    }

    function wireEditFormattingControls() {
        const buttonIds = [
            'formatBoldButton',
            'formatItalicButton',
            'formatTextColorButton',
            'formatBackgroundColorButton'
        ];

        buttonIds.forEach(id => {
            const button = document.getElementById(id);
            if (!button) {return;}
            button.addEventListener('mousedown', (e) => {
                // Keep text selection in the editable cell while clicking toolbar controls.
                e.preventDefault();
                captureEditSelectionRange();
            });
        });

        const textColorButton = document.getElementById('formatTextColorButton') as HTMLButtonElement | null;
        if (textColorButton) {
            textColorButton.classList.add('color-format-button');
            updateColorPreview('text', state.selectedTextColor);
            textColorButton.addEventListener('click', () => {
                captureEditSelectionRange();
                showColorPalette(textColorButton, 'text');
            });
        }

        const bgColorButton = document.getElementById('formatBackgroundColorButton') as HTMLButtonElement | null;
        if (bgColorButton) {
            bgColorButton.classList.add('color-format-button');
            updateColorPreview('background', state.selectedBgColor);
            bgColorButton.addEventListener('click', () => {
                captureEditSelectionRange();
                showColorPalette(bgColorButton, 'background');
            });
        }

        document.addEventListener('selectionchange', () => {
            captureEditSelectionRange();
        });

        document.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (!target.closest('#sheetsColorPalette') && !target.closest('#formatTextColorButton') && !target.closest('#formatBackgroundColorButton') && !target.closest('#stripTextColorButton') && !target.closest('#stripBgColorButton') && !target.closest('#stripBorderColorButton')) {
                hideColorPalette();
            }
            if (!target.closest('#xlsxBorderPopup') && !target.closest('#stripBordersButton')) {
                hideBorderPopup();
            }
        });

        ensureEditFormattingStrip();
    }

    function ensureEditFormattingStrip() {
        if (state.editFormattingStripEl) {return;}

        const toolbar = document.getElementById('toolbar');
        if (!toolbar) {return;}

        const strip = document.createElement('div');
        strip.id = 'xlsxEditFormattingStrip';
        strip.className = 'xlsx-edit-strip hidden';
        strip.innerHTML = `
            <div class="edit-strip-group">
                <select id="editFontFamily" class="edit-strip-select" title="Font family">
                    <option value="Arial">Arial</option>
                    <option value="Roboto">Roboto</option>
                    <option value="Inter">Inter</option>
                    <option value="Times New Roman">Times New Roman</option>
                    <option value="Consolas">Consolas</option>
                </select>
                <select id="editFontSize" class="edit-strip-select narrow" title="Font size">
                    <option value="10">10</option>
                    <option value="11">11</option>
                    <option value="12" selected>12</option>
                    <option value="14">14</option>
                    <option value="16">16</option>
                    <option value="18">18</option>
                    <option value="20">20</option>
                </select>
                <button id="fontMinusButton" type="button" class="toggle-button icon-only" title="Decrease font">A-</button>
                <button id="fontPlusButton" type="button" class="toggle-button icon-only" title="Increase font">A+</button>
            </div>
            <div class="edit-strip-group">
                <button id="stripBoldButton" type="button" class="toggle-button icon-only" title="Bold">B</button>
                <button id="stripItalicButton" type="button" class="toggle-button icon-only" title="Italic">I</button>
                <button id="stripStrikeButton" type="button" class="toggle-button icon-only" title="Strikethrough">S</button>
                <button id="stripTextColorButton" type="button" class="toggle-button icon-only" title="Text color">A</button>
                <button id="stripBgColorButton" type="button" class="toggle-button icon-only" title="Background color">■</button>
            </div>
            <div class="edit-strip-group">
                <select id="editHorizontalAlign" class="edit-strip-select narrow" title="Horizontal align">
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                </select>
                <select id="editVerticalAlign" class="edit-strip-select narrow" title="Vertical align">
                    <option value="top">Top</option>
                    <option value="middle">Middle</option>
                    <option value="bottom">Bottom</option>
                </select>
            </div>
            <div class="edit-strip-group">
                <button id="stripBordersButton" type="button" class="toggle-button" title="Borders">Borders</button>
                <select id="editBorderThickness" class="edit-strip-select narrow" title="Border thickness">
                    <option value="thin" selected>1px</option>
                    <option value="medium">2px</option>
                    <option value="thick">3px</option>
                </select>
                <select id="editBorderPattern" class="edit-strip-select narrow" title="Border pattern">
                    <option value="solid" selected>Solid</option>
                    <option value="dashed">Dashed</option>
                    <option value="dotted">Dotted</option>
                    <option value="double">Double</option>
                </select>
                <button id="stripBorderColorButton" type="button" class="toggle-button icon-only" title="Border color">▣</button>
                <button id="indentDecreaseButton" type="button" class="toggle-button icon-only" title="Decrease indent">←</button>
                <button id="indentIncreaseButton" type="button" class="toggle-button icon-only" title="Increase indent">→</button>
            </div>
            <div class="edit-strip-group">
                <button id="mergeCellsButton" type="button" class="toggle-button" title="Merge selected cells">Merge</button>
                <button id="unmergeCellsButton" type="button" class="toggle-button" title="Unmerge selected range">Unmerge</button>
                <button id="formatPainterButton" type="button" class="toggle-button" title="Copy style from active cell, then click a target cell">Painter</button>
                <button id="clearFormatButton" type="button" class="toggle-button" title="Clear formatting">Clear</button>
            </div>
        `;

        const findButton = document.getElementById('findButton');
        const findWrapper = findButton ? findButton.closest('.tooltip') : null;
        if (findWrapper && findWrapper.parentElement === toolbar) {
            findWrapper.insertAdjacentElement('afterend', strip);
        } else {
            toolbar.appendChild(strip);
        }
        state.editFormattingStripEl = strip;

        const onKeepTextSelection = (event: Event) => {
            event.preventDefault();
            captureEditSelectionRange();
        };

        strip.querySelectorAll('button').forEach(el => {
            el.addEventListener('mousedown', onKeepTextSelection);
        });

        strip.querySelectorAll('select').forEach(el => {
            el.addEventListener('mousedown', () => {
                captureEditSelectionRange();
            });
        });

        strip.querySelectorAll('button,select').forEach(el => {
            (el as HTMLElement).classList.add('tooltip');
        });

        const byId = <T extends HTMLElement>(id: string) => strip.querySelector(`#${id}`) as T | null;

        byId<HTMLSelectElement>('editFontFamily')?.addEventListener('change', (e) => {
            const value = (e.target as HTMLSelectElement).value;
            applyFontFamily(value);
        });
        byId<HTMLSelectElement>('editFontSize')?.addEventListener('change', (e) => {
            const value = parseInt((e.target as HTMLSelectElement).value, 10);
            if (!isNaN(value)) {applyFontSize(value);}
        });
        byId<HTMLButtonElement>('fontMinusButton')?.addEventListener('click', () => shiftFontSize(-1));
        byId<HTMLButtonElement>('fontPlusButton')?.addEventListener('click', () => shiftFontSize(1));

        byId<HTMLButtonElement>('stripBoldButton')?.addEventListener('click', () => applyEditFormatting('bold'));
        byId<HTMLButtonElement>('stripItalicButton')?.addEventListener('click', () => applyEditFormatting('italic'));
        byId<HTMLButtonElement>('stripStrikeButton')?.addEventListener('click', () => applyStrikeThrough());

        const stripTextColorButton = byId<HTMLButtonElement>('stripTextColorButton');
        if (stripTextColorButton) {
            stripTextColorButton.classList.add('color-format-button');
            stripTextColorButton.style.setProperty('--format-color-preview', state.selectedTextColor);
            stripTextColorButton.addEventListener('click', () => {
                captureEditSelectionRange();
                showColorPalette(stripTextColorButton, 'text');
            });
        }

        const stripBgColorButton = byId<HTMLButtonElement>('stripBgColorButton');
        if (stripBgColorButton) {
            stripBgColorButton.classList.add('color-format-button');
            stripBgColorButton.style.setProperty('--format-color-preview', state.selectedBgColor);
            stripBgColorButton.addEventListener('click', () => {
                captureEditSelectionRange();
                showColorPalette(stripBgColorButton, 'background');
            });
        }

        const stripBorderColorButton = byId<HTMLButtonElement>('stripBorderColorButton');
        if (stripBorderColorButton) {
            stripBorderColorButton.classList.add('color-format-button');
            stripBorderColorButton.style.setProperty('--format-color-preview', state.selectedBorderColor);
            stripBorderColorButton.addEventListener('click', () => {
                captureEditSelectionRange();
                applyCurrentBorderMode();
                showColorPalette(stripBorderColorButton, 'border');
            });
        }

        byId<HTMLSelectElement>('editHorizontalAlign')?.addEventListener('change', (e) => {
            applyHorizontalAlign((e.target as HTMLSelectElement).value as HorizontalAlign);
        });
        byId<HTMLSelectElement>('editVerticalAlign')?.addEventListener('change', (e) => {
            applyVerticalAlign((e.target as HTMLSelectElement).value as VerticalAlign);
        });
        byId<HTMLButtonElement>('stripBordersButton')?.addEventListener('click', (e) => {
            if (state.activeCell) {
                syncBorderSelectionFromCell(state.activeCell);
            } else {
                updateBorderPopupActiveButtons({ clear: true });
            }
            showBorderPopup(e.currentTarget as HTMLElement);
        });
        byId<HTMLSelectElement>('editBorderThickness')?.addEventListener('change', (e) => {
            state.selectedBorderThickness = (e.target as HTMLSelectElement).value as BorderThickness;
            syncBorderStyleFromControls();
            if (state.selectedBorderPattern === 'solid') {
                applyCurrentBorderMode();
            }
        });
        byId<HTMLSelectElement>('editBorderPattern')?.addEventListener('change', (e) => {
            state.selectedBorderPattern = (e.target as HTMLSelectElement).value as BorderPattern;
            syncBorderStyleFromControls();
            applyCurrentBorderMode();
        });

        byId<HTMLButtonElement>('indentDecreaseButton')?.addEventListener('click', () => applyIndent(-8));
        byId<HTMLButtonElement>('indentIncreaseButton')?.addEventListener('click', () => applyIndent(8));
        byId<HTMLButtonElement>('mergeCellsButton')?.addEventListener('click', () => queueMergeOperation('mergeRange'));
        byId<HTMLButtonElement>('unmergeCellsButton')?.addEventListener('click', () => queueMergeOperation('unmergeRange'));
        byId<HTMLButtonElement>('formatPainterButton')?.addEventListener('click', () => toggleFormatPainter());
        byId<HTMLButtonElement>('clearFormatButton')?.addEventListener('click', () => clearFormattingOnSelection());

        wireDelayedToolbarTooltips(strip);
    }

    function reorderToolbarAroundFind(isEditModeEnabled: boolean) {
        const toolbar = document.getElementById('toolbar');
        if (!toolbar) {return;}

        const findButton = document.getElementById('findButton');
        const settingsButton = document.getElementById('openSettingsButton');
        const insertButton = document.getElementById('insertControlButton');
        const plainButton = document.getElementById('togglePlainViewButton');
        const strip = document.getElementById('xlsxEditFormattingStrip');

        const findWrapper = findButton ? findButton.closest('.tooltip') as HTMLElement | null : null;
        const settingsWrapper = settingsButton ? settingsButton.closest('.tooltip') as HTMLElement | null : null;
        const insertWrapper = insertButton ? insertButton.closest('.tooltip') as HTMLElement | null : null;
        const plainWrapper = plainButton ? plainButton.closest('.tooltip') as HTMLElement | null : null;

        if (!findWrapper || !settingsWrapper || findWrapper.parentElement !== toolbar || settingsWrapper.parentElement !== toolbar) {
            return;
        }

        if (isEditModeEnabled) {
            if (findWrapper.nextElementSibling !== settingsWrapper) {
                findWrapper.insertAdjacentElement('afterend', settingsWrapper);
            }

            if (insertWrapper && insertWrapper.parentElement === toolbar && settingsWrapper.nextElementSibling !== insertWrapper) {
                settingsWrapper.insertAdjacentElement('afterend', insertWrapper);
            }

            if (strip && strip.parentElement === toolbar) {
                const anchor = insertWrapper && insertWrapper.parentElement === toolbar ? insertWrapper : settingsWrapper;
                if (anchor.nextElementSibling !== strip) {
                    anchor.insertAdjacentElement('afterend', strip);
                }
            }
            return;
        }

        if (plainWrapper && plainWrapper.parentElement === toolbar && plainWrapper.nextElementSibling !== settingsWrapper) {
            plainWrapper.insertAdjacentElement('afterend', settingsWrapper);
        }

        if (insertWrapper && insertWrapper.parentElement === toolbar && settingsWrapper.nextElementSibling !== insertWrapper) {
            settingsWrapper.insertAdjacentElement('afterend', insertWrapper);
        }
    }

    function getTableContainer(): HTMLElement | null {
        if (!document.body.classList.contains('sticky-toolbar-enabled')) {
            return document.getElementById('content');
        }
        return document.querySelector('#tableContainer .table-scroll') || document.getElementById('tableContainer');
    }

    function requestRows(start: number, end: number, timeout = 10000): Promise<any[]> {
        return virtualLoader.requestRows(start, end, timeout, { sheetIndex: state.currentWorksheet });
    }

    function requestAllRows(): Promise<any[]> {
        const rowCount = Math.max(0, state.baseTotalRows || state.totalRows);
        return requestRows(0, rowCount, 30000);
    }

    function clearDataTransforms() {
        state.sourceRowsSnapshot = null;
        state.transformedRowsSnapshot = null;
        state.activeColumnFilters.clear();
        state.activeSortState = null;
    }

    function getActiveRowsSnapshot(): any[] | null {
        if (state.transformedRowsSnapshot) {return state.transformedRowsSnapshot;}
        if (state.sourceRowsSnapshot) {return state.sourceRowsSnapshot;}
        return null;
    }

    function applyDataOpsRowsToViewport(rows: any[] | null) {
        if (rows) {
            state.transformedRowsSnapshot = rows;
            state.totalRows = rows.length;
            state.allRowHeights = rows.map((row) => {
                const h = Number((row as any)?.height);
                return Number.isFinite(h) && h > 0 ? h : ROW_HEIGHT;
            });
        } else {
            state.transformedRowsSnapshot = null;
            state.totalRows = state.baseTotalRows;
            state.allRowHeights = [...state.baseRowHeights];
        }

        invalidateRowMetrics();
        state.rowCache.clear();
        state.currentVisibleStart = 0;
        state.currentVisibleEnd = 0;
        hideHeaderContextMenu();
        renderWorksheet(state.currentWorksheet);
    }

    async function ensureSourceRowsSnapshot(): Promise<boolean> {
        if (state.sourceRowsSnapshot) {
            return true;
        }

        if ((state.baseTotalRows || state.totalRows) > MAX_ROWS_FOR_CLIENT_DATA_OPS) {
            showToast(`Filtering is limited to ${MAX_ROWS_FOR_CLIENT_DATA_OPS.toLocaleString()} rows for performance.`);
            return false;
        }

        try {
            setLoadingText('Loading rows for filtering...');
            showLoading();
            const rows = await requestAllRows();
            state.sourceRowsSnapshot = Array.isArray(rows) ? rows.map((row) => cloneCellData(row)) : [];
            return true;
        } catch {
            showToast('Unable to load rows for filtering');
            return false;
        } finally {
            hideLoading();
        }
    }

    function rebuildFilteredRows() {
        if (!state.sourceRowsSnapshot) {
            return;
        }

        let headerRow: any = null;
        let rowsToProcess = [...state.sourceRowsSnapshot];

        if (state.currentSettings.firstRowIsHeader && state.sourceRowsSnapshot.length > 0) {
            headerRow = state.sourceRowsSnapshot[0];
            rowsToProcess = state.sourceRowsSnapshot.slice(1);
        }

        const nextRows = filterAndSortRows(rowsToProcess, [...state.activeColumnFilters.values()], state.activeSortState);

        if (headerRow) {
            state.transformedRowsSnapshot = [headerRow, ...nextRows];
        } else {
            state.transformedRowsSnapshot = nextRows;
        }
    }

    function getHeaderIndicator(colIndex: number): string {
        const parts: string[] = [];
        if (state.activeSortState?.columnIndex === colIndex) {
            parts.push(state.activeSortState.direction === 'asc' ? 'A-Z' : 'Z-A');
        }
        if (state.activeColumnFilters.has(colIndex)) {
            parts.push('Filtered');
        }
        return parts.join(' • ');
    }

    function createRowHtml(rowData: any, rowIndex: number): string {
        const baseHeight = rowData.height || ROW_HEIGHT;
        const height = getEffectiveRowHeightFromValue(baseHeight);
        return createXlsxRowHtml({
            rowData,
            rowIndex,
            rowHeight: height,
            columnCount: state.columnCount,
            columnWidths: state.columnWidths,
            isPlainView: state.isPlainView,
            isEditMode: state.isEditMode,
            allowInteractiveControls: areInteractiveControlsEnabled()
        });
    }

    function adjustColumnWidths(mode: 'expand' | 'default') {
        try {
            const table = document.getElementById('xlsxTable') as HTMLTableElement | null;
            if (!table) {return;}

            const headerCells = table.querySelectorAll('th.col-header');
            if (headerCells.length === 0) {return;}

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) {return;}
            ctx.font = '10pt Arial, sans-serif';

            const visibleRows = table.querySelectorAll('tbody tr:not(.virtual-spacer)');
            const limit = Math.min(visibleRows.length, 80);

            let firstColMax = 30;
            for (let r = 0; r < limit; r++) {
                const row = visibleRows[r] as HTMLTableRowElement;
                const cell = row.children[0] as HTMLElement | undefined;
                if (!cell) {continue;}
                const width = ctx.measureText((cell.textContent || '').trim()).width + 24;
                if (width > firstColMax) {firstColMax = width;}
            }

            const cornerCell = table.querySelector('th.corner-cell') as HTMLElement | null;
            if (cornerCell) {
                cornerCell.style.width = `${Math.ceil(firstColMax)}px`;
                cornerCell.style.minWidth = `${Math.ceil(firstColMax)}px`;
            }

            headerCells.forEach((th, index) => {
                const headerEl = th as HTMLElement;
                const headerText = (headerEl.innerText || headerEl.textContent || '').trim();

                const baseWidth = Math.max(40, Math.round(state.columnWidths[index] || 80));
                let maxWidth = Math.max(ctx.measureText(headerText).width + 32, baseWidth);

                for (let r = 0; r < limit; r++) {
                    const row = visibleRows[r] as HTMLTableRowElement;
                    const cell = row.children[index + 1] as HTMLElement | undefined;
                    if (!cell) {continue;}
                    const width = ctx.measureText((cell.textContent || '').trim()).width + 32;
                    if (width > maxWidth) {maxWidth = width;}
                }

                const finalWidth = mode === 'expand'
                    ? Math.ceil(maxWidth)
                    : Math.min(Math.ceil(maxWidth), 200);

                headerEl.style.width = `${finalWidth}px`;
                headerEl.style.minWidth = `${finalWidth}px`;
            });
        } catch {
            // ignore width-sync errors to keep rendering responsive
        }
    }

    function setRowHeaderWidth(widthPx: number, allowShrink = false) {
        const nextWidth = Math.max(MIN_ROW_HEADER_WIDTH, Math.ceil(widthPx));
        if (!allowShrink && nextWidth <= state.currentRowHeaderWidth) {return;}
        if (allowShrink && nextWidth === state.currentRowHeaderWidth) {return;}

        state.currentRowHeaderWidth = nextWidth;
        document.documentElement.style.setProperty('--row-header-width', `${nextWidth}px`);
    }

    function estimateRowHeaderWidthForRowIndex(rowIndex: number): number {
        const oneBasedRow = Math.max(1, rowIndex + 1);
        const digits = String(oneBasedRow).length;
        return Math.max(MIN_ROW_HEADER_WIDTH, digits * 8 + 16);
    }

    function ensureRowHeaderWidthForVisibleRange(startRow: number, endRowExclusive: number) {
        if (state.totalRows <= 0) {return;}

        const maxVisibleRow = Math.max(startRow, endRowExclusive - 1);
        const clampedMaxVisibleRow = Math.max(0, Math.min(state.totalRows - 1, maxVisibleRow));
        const needed = estimateRowHeaderWidthForRowIndex(clampedMaxVisibleRow);
        setRowHeaderWidth(needed);
    }

    const syncColumnWidthsToCurrentMode = debounce(() => {
        if (state.isEditMode) {return;}
        adjustColumnWidths(document.body.classList.contains('expanded-mode') ? 'expand' : 'default');
    }, 100);

    function renderVirtualRows(startIndex: number, endIndex: number, rowsData: any[], cacheRows = true) {
        if (state.isRendering) {return;}
        state.isRendering = true;

        const tbody = document.querySelector('#xlsxTable tbody');
        if (!tbody) {
            state.isRendering = false;
            return;
        }

        if (cacheRows) {
            rowsData.forEach((row, i) => {
                state.rowCache.set(startIndex + i, row);
            });
        }

        const isHeaderStickyAndActive = !!state.currentSettings.firstRowIsHeader;
        let topSpacerHeight = 0;
        if (isHeaderStickyAndActive && startIndex > 0) {
            topSpacerHeight = getRowHeightRange(1, startIndex);
        } else {
            topSpacerHeight = getRowTopOffset(startIndex);
        }
        const bottomSpacerHeight = getRowHeightRange(endIndex, state.totalRows);

        let html = '';

        if (isHeaderStickyAndActive && startIndex > 0) {
            const headerRowData = state.rowCache.get(0) || { cells: [], rowNumber: 1 };
            html += createRowHtml(headerRowData, 0);
        }

        if (topSpacerHeight > 0) {
            html += '<tr class="virtual-spacer top-spacer"><td colspan="' + (state.columnCount + 1) + '" style="height: ' + topSpacerHeight + 'px; padding: 0; border: none;"></td></tr>';
        }

        for (let i = startIndex; i < endIndex; i++) {
            const rowData = state.rowCache.get(i) || { cells: [], rowNumber: i + 1 };
            html += createRowHtml(rowData, i);
        }

        if (bottomSpacerHeight > 0) {
            html += '<tr class="virtual-spacer bottom-spacer"><td colspan="' + (state.columnCount + 1) + '" style="height: ' + bottomSpacerHeight + 'px; padding: 0; border: none;"></td></tr>';
        }

        tbody.innerHTML = html;
        applyInteractiveControlState(tbody);
        ensureHeaderVisible();
        reapplySelection();
        applyFindHighlightsInVisibleCells();
        syncColumnWidthsToCurrentMode();
        if (state.isEditMode) {
            captureOriginalCellValues();
        }
        state.isRendering = false;
    }

    async function updateVisibleRows() {
        if (state.isRendering) {return;}

        const container = getTableContainer();
        if (!container || state.totalRows === 0) {return;}

        const scrollTop = container.scrollTop;
        const clientHeight = container.clientHeight;

        const firstVisibleRow = findRowIndexByOffset(scrollTop);
        const lastVisibleRow = Math.min(state.totalRows, findRowIndexByOffset(scrollTop + clientHeight) + 1);

        // Match CSV behavior: keep row headers compact and only grow when larger row numbers become visible.
        ensureRowHeaderWidthForVisibleRange(firstVisibleRow, lastVisibleRow);

        // Add buffer
        const bufferedStart = Math.max(0, firstVisibleRow - BUFFER_ROWS);
        const bufferedEnd = Math.min(state.totalRows, lastVisibleRow + BUFFER_ROWS);

        // Align to chunk boundaries
        let chunkStart = Math.floor(bufferedStart / CHUNK_SIZE) * CHUNK_SIZE;
        let chunkEnd = Math.ceil(bufferedEnd / CHUNK_SIZE) * CHUNK_SIZE;

        // Clamp to totalRows
        chunkEnd = Math.min(state.totalRows, chunkEnd);

        // CRITICAL FIX: If we're within 2 chunks of the end, just render to the end
        // This prevents fluctuation at boundaries like 2224 rows (22.24 chunks)
        const remainingRows = state.totalRows - chunkEnd;
        if (remainingRows > 0 && remainingRows < CHUNK_SIZE * 2) {
            chunkEnd = state.totalRows;
        }

        // Skip if we're already showing these rows (with some tolerance)
        // BUT only if we don't need to fetch row 0
        const needsRowZeroFetch = !!state.currentSettings.firstRowIsHeader && !state.rowCache.has(0);
        if (chunkStart === state.currentVisibleStart && chunkEnd === state.currentVisibleEnd && !needsRowZeroFetch) {
            return;
        }

        // Check if current range still covers what we need
        if (state.currentVisibleStart <= bufferedStart && state.currentVisibleEnd >= bufferedEnd && !needsRowZeroFetch) {
            return; // Current render still covers visible area
        }

        const activeRows = getActiveRowsSnapshot();
        const usingLocalRows = Array.isArray(activeRows);

        let needsMainFetch = false;
        for (let i = chunkStart; i < chunkEnd; i++) {
            if (!state.rowCache.has(i)) {
                needsMainFetch = true;
                break;
            }
        }

        const needsFetch = needsMainFetch || needsRowZeroFetch;

        if (needsFetch && usingLocalRows) {
            state.currentVisibleStart = chunkStart;
            state.currentVisibleEnd = chunkEnd;

            // Ensure row 0 is cached if needed
            if (state.currentSettings.firstRowIsHeader && !state.rowCache.has(0)) {
                const headerRow = activeRows[0];
                if (headerRow) {
                    state.rowCache.set(0, cloneCellData(headerRow));
                }
            }

            const rows = activeRows.slice(chunkStart, chunkEnd).map((row) => cloneCellData(row));
            if (rows.length > 0) {
                renderVirtualRows(chunkStart, chunkStart + rows.length, rows);
            } else {
                renderVirtualRows(chunkStart, chunkEnd, []);
            }
            return;
        }

        if (needsFetch && !state.isRequestingRows) {
            state.currentVisibleStart = chunkStart;
            state.currentVisibleEnd = chunkEnd;

            state.isRequestingRows = true;

            try {
                // Fetch row 0 first if needed
                if (needsRowZeroFetch) {
                    const zeroRowResult = await requestRows(0, 1);
                    if (zeroRowResult && zeroRowResult[0]) {
                        state.rowCache.set(0, zeroRowResult[0]);
                    }
                }

                let rows: any[] = [];
                if (needsMainFetch) {
                    rows = await requestRows(chunkStart, chunkEnd);
                } else {
                    // If we only needed row 0, we can construct the chunk rows from cache
                    for (let i = chunkStart; i < chunkEnd; i++) {
                        rows.push(state.rowCache.get(i) || { cells: [], rowNumber: i + 1 });
                    }
                }

                if (rows && rows.length > 0) {
                    state.currentVisibleStart = chunkStart;
                    state.currentVisibleEnd = chunkStart + rows.length;
                    renderVirtualRows(chunkStart, chunkStart + rows.length, rows);
                }
            } finally {
                state.isRequestingRows = false;
            }
        } else if (!needsFetch) {
            state.currentVisibleStart = chunkStart;
            state.currentVisibleEnd = chunkEnd;

            const cachedRows: any[] = [];
            for (let i = chunkStart; i < chunkEnd; i++) {
                cachedRows.push(state.rowCache.get(i) || { cells: [], rowNumber: i + 1 });
            }
            renderVirtualRows(chunkStart, chunkEnd, cachedRows);
        }
    }

    const onScroll = debounce(() => {
        updateVisibleRows();
    }, 16);

    function initializeVirtualScrolling() {
        const container = getTableContainer();
        if (!container) {return;}

        if (state.activeScrollContainer && state.activeScrollContainer !== container) {
            state.activeScrollContainer.removeEventListener('scroll', onScroll);
        }

        container.removeEventListener('scroll', onScroll);
        container.addEventListener('scroll', onScroll, { passive: true });
        state.activeScrollContainer = container;
        state.currentVisibleStart = -1;
        state.currentVisibleEnd = -1;
        updateVisibleRows();
    }

    function reapplySelection() {
        selectionManager.reapplySelection();

        if (!state.selectionStart || !state.selectionEnd) {return;}
        if (state.selectedRowIndices.size > 0 || state.selectedColumnIndices.size > 0) {return;}

        const minRow = Math.min(state.selectionStart.row, state.selectionEnd.row);
        const maxRow = Math.max(state.selectionStart.row, state.selectionEnd.row);
        const minCol = Math.min(state.selectionStart.col, state.selectionEnd.col);
        const maxCol = Math.max(state.selectionStart.col, state.selectionEnd.col);

        const visibleCells = document.querySelectorAll('#xlsxTable td[data-row][data-col]') as NodeListOf<HTMLElement>;
        visibleCells.forEach((cell) => {
            const row = parseInt(cell.dataset.row || '-1', 10);
            const col = parseInt(cell.dataset.col || '-1', 10);
            if (row < 0 || col < 0) {return;}

            if (row >= minRow && row <= maxRow && col >= minCol && col <= maxCol) {
                cell.classList.add('selected');
                if (row === minRow) {cell.classList.add('selection-top');}
                if (row === maxRow) {cell.classList.add('selection-bottom');}
                if (col === minCol) {cell.classList.add('selection-left');}
                if (col === maxCol) {cell.classList.add('selection-right');}
                state.selectedCells.add(cell);
            }
        });
    }

    function createTableShell(): string {
        let html = '<div class="table-scroll"><table id="xlsxTable">';

        // Header row
        html += '<thead><tr>';
        html += '<th class="corner-cell"></th>';
        for (let c = 1; c <= state.columnCount; c++) {
            const width = state.columnWidths[c - 1] || 80;
            html += '<th class="col-header" data-col="' + (c - 1) + '" style="width: ' + width + 'px; min-width: ' + width + 'px;">';
            const indicator = getHeaderIndicator(c - 1);
            html += '<span class="col-header-label">' + getExcelColumnLabel(c) + '</span>';
            if (indicator) {
                html += '<span class="col-header-indicator">' + indicator + '</span>';
            }
            html += '<div class="col-resize-handle" data-col="' + (c - 1) + '"></div>';
            html += '</th>';
        }
        html += '</tr></thead><tbody></tbody></table></div>';
        return html;
    }

    const showToast = Utils.showToast;

    function ensurePreviewBanner(): HTMLElement {
        let banner = document.getElementById('versionPreviewBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'versionPreviewBanner';
            banner.className = 'version-preview-banner hidden';
            banner.innerHTML = `
                <span id="versionPreviewText" class="version-preview-text"></span>
                <div class="version-preview-actions">
                    <button id="restoreVersionButton" class="toggle-button" type="button">Restore</button>
                    <button id="cancelVersionPreviewButton" class="toggle-button" type="button">Cancel</button>
                </div>
            `;

            const content = document.getElementById('content');
            if (content) {
                content.insertBefore(banner, content.firstChild);
            } else {
                document.body.appendChild(banner);
            }

            const restoreBtn = document.getElementById('restoreVersionButton') as HTMLButtonElement | null;
            const cancelBtn = document.getElementById('cancelVersionPreviewButton') as HTMLButtonElement | null;
            restoreBtn?.addEventListener('click', () => {
                if (!state.previewVersionId) {return;}
                post({ command: 'restoreVersion', versionId: state.previewVersionId });
            });
            cancelBtn?.addEventListener('click', () => {
                post({ command: 'cancelVersionPreview' });
            });
        }
        return banner;
    }

    function setVersionPreviewMode(isPreview: boolean, label?: string) {
        state.isVersionPreviewMode = isPreview;
        document.body.classList.toggle('preview-mode', isPreview);
        applyInteractiveControlState();
        if (isPreview) {
            hideImagePreview();
        }

        const banner = ensurePreviewBanner();
        if (isPreview) {
            const text = document.getElementById('versionPreviewText');
            if (text) {
                text.textContent = label || 'Previewing selected version (read-only)';
            }
            banner.classList.remove('hidden');
        } else {
            banner.classList.add('hidden');
            state.previewVersionId = null;
        }
    }

    function renderWorksheet(index: number) {
        if (!state.worksheetsMeta || !state.worksheetsMeta.length) {return;}

        showLoading();

        // Reset virtual scrolling state for new worksheet
        state.rowCache.clear();
        state.currentVisibleStart = 0;
        state.currentVisibleEnd = 0;
        virtualLoader.clear();
        state.isRendering = false;

        const wsMeta = state.worksheetsMeta[index];
        state.baseTotalRows = wsMeta.totalRows || 0;
        state.baseRowHeights = wsMeta.rowHeights || [];

        state.totalRows = state.baseTotalRows;
        state.columnCount = wsMeta.columnCount || 0;
        state.columnWidths = wsMeta.columnWidths || [];
        state.mergedCells = wsMeta.mergedCells || [];
        state.allRowHeights = [...state.baseRowHeights];

        if (state.sourceRowsSnapshot) {
            rebuildFilteredRows();
            if (state.activeColumnFilters.size > 0 || state.activeSortState) {
                state.totalRows = state.transformedRowsSnapshot ? state.transformedRowsSnapshot.length : 0;
                state.allRowHeights = (state.transformedRowsSnapshot || []).map((row) => {
                    const h = Number((row as any)?.height);
                    return Number.isFinite(h) && h > 0 ? h : ROW_HEIGHT;
                });
            }
        }

        invalidateRowMetrics();
        ensureRowOffsetPrefix();

        // Allow the overlay to render
        setTimeout(() => {
            try {
                const container = document.getElementById('tableContainer');
                if (!container) {return;}

                container.innerHTML = createTableShell();
                ensureHeaderVisible();
                initializeSelection();
                initializeResize();
                initializeHyperlinkHover();
                initializeVirtualScrolling();

                const toolbarEl = document.getElementById('toolbar') as HTMLElement | null;
                if (toolbarEl) {
                    toolbarEl.classList.remove('hidden');
                    toolbarEl.style.removeProperty('display');
                }

                if (state.toolbarManager) {
                    applyToolbarLayout(state.toolbarManager, {
                        stickyToolbar: !!state.currentSettings.stickyToolbar,
                        scrollTarget: '#content',
                        onLayoutApplied: initializeVirtualScrolling
                    });
                }
            } finally {
                hideLoading();
            }
        }, 100);
    }

    function initializeResize() {
        const table = document.querySelector('table');
        if (!table) {return;}

        // Column/row resize handles
        table.addEventListener('mousedown', (e) => {
            const target = e.target as HTMLElement;
            if (target && target.classList && target.classList.contains('col-resize-handle')) {
                e.preventDefault();
                e.stopPropagation();

                state.isResizing = true;
                state.resizeType = 'column';
                state.resizeIndex = parseInt(target.dataset.col!, 10);
                state.resizeStartPos = e.clientX;

                const header = target.parentElement;
                state.resizeStartSize = header ? header.offsetWidth : 0;

                document.body.style.cursor = 'col-resize';
                const indicator = document.getElementById('resizeIndicator');
                if (indicator) {indicator.style.display = 'block';}
                return false;
            }

            if (target && target.classList && target.classList.contains('row-resize-handle')) {
                if (state.isEditMode) {return;}
                e.preventDefault();
                e.stopPropagation();

                state.isResizing = true;
                state.resizeType = 'row';
                state.resizeIndex = parseInt(target.dataset.row!, 10);
                state.resizeStartPos = e.clientY;

                const header = target.parentElement;
                state.resizeStartSize = header ? header.offsetHeight : 0;

                document.body.style.cursor = 'row-resize';
                const indicator = document.getElementById('resizeIndicator');
                if (indicator) {indicator.style.display = 'block';}
                return false;
            }
        });

        // The table is rebuilt on every re-render, but document listeners must be added only once.
        if (!state.resizeGlobalListenersAttached) {
            state.resizeGlobalListenersAttached = true;

            document.addEventListener('mousemove', (e) => {
                if (!state.isResizing) {return;}

                const tableEl = document.querySelector('table');
                if (!tableEl) {return;}

                const indicator = document.getElementById('resizeIndicator');

                if (state.resizeType === 'column') {
                    const delta = e.clientX - state.resizeStartPos;
                    const newSize = Math.max(20, state.resizeStartSize + delta);

                    const headers = tableEl.querySelectorAll('th.col-header[data-col="' + state.resizeIndex + '"]') as NodeListOf<HTMLElement>;
                    const cells = tableEl.querySelectorAll('td[data-col="' + state.resizeIndex + '"]') as NodeListOf<HTMLElement>;

                    headers.forEach(header => {
                        header.style.width = newSize + 'px';
                        header.style.minWidth = newSize + 'px';
                    });

                    cells.forEach(cell => {
                        if (!cell.getAttribute('colspan') || cell.getAttribute('colspan') === '1') {
                            cell.style.width = newSize + 'px';
                            cell.style.minWidth = newSize + 'px';
                        }
                    });

                    if (indicator) {
                        indicator.style.left = e.clientX + 'px';
                        indicator.style.top = e.clientY + 'px';
                        indicator.textContent = newSize + 'px';
                    }
                } else if (state.resizeType === 'row') {
                    const delta = e.clientY - state.resizeStartPos;
                    const newSize = Math.max(15, state.resizeStartSize + delta);

                    const headers = tableEl.querySelectorAll('th.row-header[data-row="' + state.resizeIndex + '"]') as NodeListOf<HTMLElement>;
                    const row = tableEl.querySelectorAll('tr')[state.resizeIndex + 1] as HTMLElement; // +1 for header row

                    headers.forEach(header => {
                        header.style.height = newSize + 'px';
                    });

                    if (row) {
                        row.style.height = newSize + 'px';
                        const cells = row.querySelectorAll('td') as NodeListOf<HTMLElement>;
                        cells.forEach(cell => {
                            if (!cell.getAttribute('rowspan') || cell.getAttribute('rowspan') === '1') {
                                cell.style.height = newSize + 'px';
                            }
                        });
                    }

                    if (indicator) {
                        indicator.style.left = e.clientX + 'px';
                        indicator.style.top = e.clientY + 'px';
                        indicator.textContent = newSize + 'px';
                    }
                }
            });

            document.addEventListener('mouseup', () => {
                if (state.isResizing) {
                    state.isResizing = false;
                    state.resizeType = null;
                    state.resizeIndex = -1;
                    document.body.style.cursor = '';
                    const indicator = document.getElementById('resizeIndicator');
                    if (indicator) {indicator.style.display = 'none';}
                }
            });
        }

        // Double-click to auto-fit or edit
        table.addEventListener('dblclick', (e) => {
            const target = e.target as HTMLElement;
            if (target && target.classList && target.classList.contains('col-resize-handle')) {
                e.preventDefault();
                autoFitColumn(parseInt(target.dataset.col!, 10));
            } else if (target && target.classList && target.classList.contains('row-resize-handle')) {
                if (state.isEditMode) {return;}
                e.preventDefault();
                autoFitRow(parseInt(target.dataset.row!, 10));
            } else if (!state.isVersionPreviewMode) {
                const td = target.closest('td');
                if (td) {
                    enterCellEditMode(td as HTMLElement);
                }
            }
        });
    }

    function autoFitColumn(colIndex: number) {
        const cells = document.querySelectorAll('td[data-col="' + colIndex + '"], th[data-col="' + colIndex + '"]') as NodeListOf<HTMLElement>;
        let maxWidth = 50;

        cells.forEach(cell => {
            const content = (cell.textContent || '').trim();
            const tempSpan = document.createElement('span');
            tempSpan.style.visibility = 'hidden';
            tempSpan.style.position = 'absolute';
            tempSpan.style.whiteSpace = 'nowrap';
            tempSpan.style.font = window.getComputedStyle(cell).font;
            tempSpan.textContent = content;
            document.body.appendChild(tempSpan);

            const contentWidth = tempSpan.offsetWidth + 10; // padding
            maxWidth = Math.max(maxWidth, contentWidth);

            document.body.removeChild(tempSpan);
        });

        maxWidth = Math.min(maxWidth, 300); // Cap at 300px

        cells.forEach(cell => {
            cell.style.width = maxWidth + 'px';
            cell.style.minWidth = maxWidth + 'px';
        });
    }

    function autoFitRow(rowIndex: number) {
        const row = document.querySelectorAll('tr')[rowIndex + 1] as HTMLElement; // +1 for header row
        if (!row) {return;}

        const cells = row.querySelectorAll('td') as NodeListOf<HTMLElement>;
        let maxHeight = 20;

        cells.forEach(cell => {
            const content = (cell.textContent || '').trim();
            if (content.length > 50) {
                maxHeight = Math.max(maxHeight, 40);
            }
        });

        row.style.height = maxHeight + 'px';
        const headers = document.querySelectorAll('th.row-header[data-row="' + rowIndex + '"]') as NodeListOf<HTMLElement>;
        headers.forEach(header => {
            header.style.height = maxHeight + 'px';
        });

        cells.forEach(cell => {
            if (!cell.getAttribute('rowspan') || cell.getAttribute('rowspan') === '1') {
                cell.style.height = maxHeight + 'px';
            }
        });
    }

    function clearSelection() {
        state.selectionStart = null;
        state.selectionEnd = null;
        selectionManager.clearSelection();
    }

    function selectCell(cell: HTMLElement, isMulti = false) {
        selectionManager.selectCell(cell, isMulti);
        const row = parseInt(cell.dataset.row || '-1', 10);
        const col = parseInt(cell.dataset.col || '-1', 10);
        if (row >= 0 && col >= 0) {
            if (!isMulti || !state.selectionStart) {
                state.selectionStart = { row, col };
            }
            state.selectionEnd = { row, col };
        }
        syncBorderSelectionFromCell(cell);
    }

    function expandSelectionBoundsForMergedCells(minRow: number, maxRow: number, minCol: number, maxCol: number) {
        let expandedMinRow = minRow;
        let expandedMaxRow = maxRow;
        let expandedMinCol = minCol;
        let expandedMaxCol = maxCol;

        let changed = true;
        while (changed) {
            changed = false;
            (state.mergedCells || []).forEach((range: any) => {
                const r0 = Math.max(0, (range?.startRow || 1) - 1);
                const r1 = Math.max(r0, (range?.endRow || r0 + 1) - 1);
                const c0 = Math.max(0, (range?.startCol || 1) - 1);
                const c1 = Math.max(c0, (range?.endCol || c0 + 1) - 1);

                const intersects = !(r1 < expandedMinRow || r0 > expandedMaxRow || c1 < expandedMinCol || c0 > expandedMaxCol);
                if (!intersects) {return;}

                const nextMinRow = Math.min(expandedMinRow, r0);
                const nextMaxRow = Math.max(expandedMaxRow, r1);
                const nextMinCol = Math.min(expandedMinCol, c0);
                const nextMaxCol = Math.max(expandedMaxCol, c1);

                if (nextMinRow !== expandedMinRow || nextMaxRow !== expandedMaxRow || nextMinCol !== expandedMinCol || nextMaxCol !== expandedMaxCol) {
                    expandedMinRow = nextMinRow;
                    expandedMaxRow = nextMaxRow;
                    expandedMinCol = nextMinCol;
                    expandedMaxCol = nextMaxCol;
                    changed = true;
                }
            });
        }

        return {
            minRow: expandedMinRow,
            maxRow: expandedMaxRow,
            minCol: expandedMinCol,
            maxCol: expandedMaxCol
        };
    }

    function selectRange(startRow: number, startCol: number, endRow: number, endCol: number) {
        const bounds = expandSelectionBoundsForMergedCells(
            Math.min(startRow, endRow),
            Math.max(startRow, endRow),
            Math.min(startCol, endCol),
            Math.max(startCol, endCol)
        );

        state.selectionStart = { row: startRow, col: startCol };
        state.selectionEnd = { row: endRow, col: endCol };
        selectionManager.selectRange(bounds.minRow, bounds.minCol, bounds.maxRow, bounds.maxCol);
    }

    function selectRow(rowIndex: number, ctrlKey: boolean, shiftKey: boolean) {
        state.selectionStart = null;
        state.selectionEnd = null;
        selectionManager.selectRow(rowIndex, ctrlKey, shiftKey);
    }

    function selectColumn(colIndex: number, ctrlKey: boolean, shiftKey: boolean) {
        state.selectionStart = null;
        state.selectionEnd = null;
        selectionManager.selectColumn(colIndex, ctrlKey, shiftKey);
    }

    function updateSelectionInfo() {
        selectionManager.updateSelectionInfo();
        if (state.activeCell) {
            syncBorderSelectionFromCell(state.activeCell);
        }
    }

    async function copySelectionToClipboard() {
        await copySelectionToClipboardHelper({
            selectedCells: state.selectedCells,
            selectedColumnIndices: state.selectedColumnIndices,
            selectedRowIndices: state.selectedRowIndices,
            columnCount: state.columnCount,
            totalRows: state.totalRows,
            rowCache: state.rowCache,
            isCopying: state.isCopying,
            setIsCopying: (next: boolean) => {
                state.isCopying = next;
            },
            showToast,
            requestAllRows,
            normalizeCellText
        });
    }

    function pasteTextAtSelection(text: string) {
        const bounds = getLogicalSelectionBounds();
        if (!bounds) {
            showToast('Select a cell to paste');
            return;
        }

        const startRow = bounds.minRow;
        const startCol = bounds.minCol;

        // Clipboard TSV: tabs separate columns, newlines rows; quoted cells may hold line breaks.
        const grid = parseTsv(text);

        if (grid.length === 0 || grid[0].length === 0) {
            return;
        }

        const beforeSnapshot = captureWorksheetStateSnapshot();
        let anyChanged = false;
        const editsList: Array<{ row: number; col: number; value: string }> = [];

        for (let r = 0; r < grid.length; r++) {
            const rowIndex = startRow + r;
            if (rowIndex >= state.totalRows) {continue;}
            const rowNumber = rowIndex + 1;

            for (let c = 0; c < grid[r].length; c++) {
                const colIndex = startCol + c;
                if (colIndex >= state.columnCount) {continue;}
                const colNumber = colIndex + 1;

                const rawValue = grid[r][c];
                const cellData = getOrCreateRowCellData(rowIndex, colIndex);
                const cellType = cellData.cellType || 'text';

                let parsedValue = rawValue;
                if (cellType === 'checkbox') {
                    parsedValue = parseBooleanCellValue(rawValue) ? 'TRUE' : 'FALSE';
                } else if (cellType === 'rating') {
                    parsedValue = String(normalizeRatingValue(rawValue));
                } else if (cellType === 'date') {
                    parsedValue = normalizeDateInputValue(rawValue);
                } else if (cellType === 'dropdown') {
                    parsedValue = rawValue.trim();
                }

                if (cellData.value !== parsedValue) {
                    cellData.value = parsedValue;
                    syncLocalSnapshotValue(rowNumber, colNumber, parsedValue);
                    upsertPendingOutsideControlEdit(rowNumber, colNumber, parsedValue);
                    editsList.push({ row: rowNumber, col: colNumber, value: parsedValue });
                    anyChanged = true;
                }
            }
        }

        if (anyChanged) {
            const afterSnapshot = captureWorksheetStateSnapshot();
            pushSheetUndoEntry(beforeSnapshot, afterSnapshot);

            // Trigger a complete table redraw
            rerenderCurrentSheetFromLocalState();

            // Re-select the pasted range
            const endRow = Math.min(state.totalRows - 1, startRow + grid.length - 1);
            const endCol = Math.min(state.columnCount - 1, startCol + grid[0].length - 1);
            selectRange(startRow, startCol, endRow, endCol);

            // Save or schedule auto-save according to settings
            if (state.isEditMode) {
                scheduleAutoSave('text');
            } else {
                if (state.currentSettings.autoSave) {
                    editsList.forEach(e => removePendingOutsideControlEdit(e.row, e.col));
                    post({
                        command: 'saveXlsxEdits',
                        sheetIndex: state.currentWorksheet,
                        edits: editsList,
                        richEdits: [],
                        styleEdits: [],
                        operations: [],
                        isAutosave: true
                    });
                } else {
                    showManualSaveReminderIfNeeded();
                }
            }
        }
    }

    function initializeSelection() {
        const tableContainer = document.getElementById('tableContainer');
        const table = tableContainer ? tableContainer.querySelector('table') : null;
        if (!table) {return;}

        if (!state.pasteListenerAttached) {
            state.pasteListenerAttached = true;
            document.addEventListener('paste', (e) => {
                if (state.isCellEditing) {return;}
                const activeEl = document.activeElement;
                if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')) {
                    if (!activeEl.closest('#xlsxTable')) {
                        return;
                    }
                }
                const clipboardData = e.clipboardData;
                if (!clipboardData) {return;}
                const text = clipboardData.getData('text/plain');
                if (text) {
                    pasteTextAtSelection(text);
                }
            });
        }

        table.addEventListener('contextmenu', (e) => {
            const target = e.target as HTMLElement;
            const rowHeader = target.closest('th.row-header') as HTMLElement | null;
            const colHeader = target.closest('th.col-header') as HTMLElement | null;
            const cell = target.closest('td') as HTMLElement | null;
            if (!rowHeader && !colHeader && !cell) {return;}

            if (state.isVersionPreviewMode && (rowHeader || cell)) {
                showToast('Version preview is read-only');
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            if (cell) {
                showCellContextMenu(e, cell);
                return;
            }

            if (rowHeader) {
                const row = parseInt(rowHeader.dataset.row || '-1', 10);
                if (row >= 0) {showHeaderContextMenu(e, 'row', row);}
                return;
            }

            if (colHeader) {
                const col = parseInt(colHeader.dataset.col || '-1', 10);
                if (col >= 0) {showHeaderContextMenu(e, 'column', col);}
            }
        });

        table.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (target.closest('.col-resize-handle') || target.closest('.row-resize-handle')) {return;}

            const rowHeader = target.closest('th.row-header') as HTMLElement | null;
            const colHeader = target.closest('th.col-header') as HTMLElement | null;
            if (!rowHeader && !colHeader) {return;}
            if (e.ctrlKey || e.metaKey || e.shiftKey) {return;}

            if (state.isVersionPreviewMode && rowHeader) {
                showToast('Version preview is read-only');
                return;
            }

            if (rowHeader) {
                const row = parseInt(rowHeader.dataset.row || '-1', 10);
                if (row >= 0) {showHeaderContextMenu(e, 'row', row);}
                return;
            }

            if (colHeader) {
                const col = parseInt(colHeader.dataset.col || '-1', 10);
                if (col >= 0) {showHeaderContextMenu(e, 'column', col);}
            }
        });

        table.addEventListener('selectstart', (e) => {
            if (state.isEditMode) {return;}
            e.preventDefault();
            return false;
        });

        table.addEventListener('mousedown', (e) => {
            const target = e.target as HTMLElement;
            if (target && target.classList && (target.classList.contains('col-resize-handle') || target.classList.contains('row-resize-handle'))) {
                return;
            }

            const cellTarget = target.closest('td, th') as HTMLElement;
            if (!cellTarget) {return;}

            if (cellTarget.tagName === 'TD' && target.closest('.xlsx-cell-checkbox, .xlsx-cell-dropdown, .xlsx-dropdown-edit-button, .xlsx-rating-star, .xlsx-cell-date')) {
                const undoState = captureCellUndoState(cellTarget);
                if (undoState) {
                    state.pendingControlUndoState.set(cellTarget, undoState);
                }
            }

            const isHeaderInteraction =
                cellTarget.classList.contains('col-header') ||
                cellTarget.classList.contains('row-header') ||
                cellTarget.classList.contains('corner-cell');

            if (!state.isEditMode && cellTarget.tagName === 'TD' && !isHeaderInteraction) {
                const cellType = getCellType(cellTarget);
                const controlTarget = target.closest('.xlsx-cell-checkbox, .xlsx-cell-dropdown, .xlsx-dropdown-edit-button, .xlsx-rating-star, .xlsx-cell-date') as HTMLElement | null;
                const canEditControls = areInteractiveControlsEnabled();

                if (cellType === 'checkbox' && controlTarget && canEditControls) {
                    const row = parseInt(cellTarget.dataset.row!, 10);
                    const col = parseInt(cellTarget.dataset.col!, 10);

                    if (e.ctrlKey || e.metaKey) {
                        state.selectionStart = null;
                        state.selectionEnd = null;
                        if (cellTarget.classList.contains('selected')) {
                            cellTarget.classList.remove('selected', 'selection-top', 'selection-bottom', 'selection-left', 'selection-right');
                            state.selectedCells.delete(cellTarget);
                            if (cellTarget === state.activeCell) {
                                state.activeCell = null;
                            }
                        } else {
                            cellTarget.classList.add('selected', 'selection-top', 'selection-bottom', 'selection-left', 'selection-right');
                            state.selectedCells.add(cellTarget);
                            if (state.activeCell) {
                                state.activeCell.classList.remove('active-cell');
                            }
                            cellTarget.classList.add('active-cell');
                            state.activeCell = cellTarget;
                        }
                    } else if (e.shiftKey && state.activeCell) {
                        const startRow = parseInt(state.activeCell.dataset.row!, 10);
                        const startCol = parseInt(state.activeCell.dataset.col!, 10);
                        selectRange(startRow, startCol, row, col);
                    } else {
                        clearSelection();
                        selectCell(cellTarget);
                        state.isSelecting = true;
                        state.selectionStart = { row, col };
                        state.selectionEnd = { row, col };
                    }

                    updateSelectionInfo();
                    return;
                }

                if ((cellType === 'dropdown' || cellType === 'rating' || cellType === 'date') && canEditControls) {
                    if (!(e.ctrlKey || e.metaKey || e.shiftKey)) {
                        clearSelection();
                        selectCell(cellTarget);
                    }

                    if (cellType === 'date' && controlTarget) {
                        const dateInput = cellTarget.querySelector('.xlsx-cell-date') as HTMLInputElement | null;
                        if (dateInput && !dateInput.disabled) {
                            dateInput.focus();
                        }
                    }

                    updateSelectionInfo();
                    return;
                }
            }

            if (!state.isVersionPreviewMode && !isHeaderInteraction) {
                if (cellTarget.tagName === 'TD') {
                    if (state.isCellEditing && cellTarget.getAttribute('contenteditable') === 'true') {
                        return;
                    }

                    const row = parseInt(cellTarget.dataset.row!, 10);
                    const col = parseInt(cellTarget.dataset.col!, 10);
                    const cellType = getCellType(cellTarget);
                    const controlTarget = target.closest('.xlsx-cell-checkbox, .xlsx-cell-dropdown, .xlsx-dropdown-edit-button, .xlsx-rating-star, .xlsx-cell-date') as HTMLElement | null;
                    const wasSingleActiveCell = state.activeCell === cellTarget && state.selectedCells.size === 1;

                    // Match CSV/TSV behavior: single-cell mode should clear row/column mode selections.
                    state.selectedColumnIndices.clear();
                    state.selectedRowIndices.clear();
                    state.selectedColumns.clear();
                    state.selectedRows.clear();

                    if ((cellType === 'dropdown' || cellType === 'rating' || cellType === 'date') && controlTarget) {
                        if (!(e.ctrlKey || e.metaKey || e.shiftKey)) {
                            clearSelection();
                            selectCell(cellTarget);
                        }
                        state.pendingEditCell = null;
                        state.pendingEditDrag = false;
                        updateSelectionInfo();
                        return;
                    }

                    if (state.formatPainterArmed && state.formatPainterStyle) {
                        state.formatPainterExecuting = true;
                        state.pendingEditCell = null;
                        state.pendingEditDrag = false;
                    }

                    if (e.ctrlKey || e.metaKey) {
                        state.pendingEditCell = null;
                        state.pendingEditDrag = false;
                        state.selectionStart = null;
                        state.selectionEnd = null;
                        if (cellTarget.classList.contains('selected')) {
                            cellTarget.classList.remove('selected', 'selection-top', 'selection-bottom', 'selection-left', 'selection-right');
                            state.selectedCells.delete(cellTarget);
                            if (cellTarget === state.activeCell) {
                                state.activeCell = null;
                            }
                        } else {
                            cellTarget.classList.add('selected', 'selection-top', 'selection-bottom', 'selection-left', 'selection-right');
                            state.selectedCells.add(cellTarget);
                            if (state.activeCell) {
                                state.activeCell.classList.remove('active-cell');
                            }
                            cellTarget.classList.add('active-cell');
                            state.activeCell = cellTarget;
                        }
                    } else if (e.shiftKey && state.activeCell) {
                        state.pendingEditCell = null;
                        state.pendingEditDrag = false;
                        const startRow = parseInt(state.activeCell.dataset.row!, 10);
                        const startCol = parseInt(state.activeCell.dataset.col!, 10);
                        selectRange(startRow, startCol, row, col);
                    } else {
                        clearSelection();
                        selectCell(cellTarget);
                        state.isSelecting = true;
                        state.selectionStart = { row, col };
                        state.selectionEnd = { row, col };
                        state.pendingEditCell = (wasSingleActiveCell && !state.formatPainterExecuting && cellType === 'text') ? cellTarget : null;
                        state.pendingEditDrag = false;
                    }

                    if (!state.isCellEditing && cellType === 'text') {
                        e.preventDefault();
                    }

                    updateSelectionInfo();
                }
                return;
            }

            e.preventDefault();

            if (cellTarget.classList.contains('col-header')) {
                const colIndex = parseInt(cellTarget.dataset.col!, 10);
                if (!e.shiftKey) {
                    state.lastSelectedColumn = colIndex;
                }
                selectColumn(colIndex, e.ctrlKey || e.metaKey, e.shiftKey);
                return;
            }

            if (cellTarget.classList.contains('row-header')) {
                const rowIndex = parseInt(cellTarget.dataset.row!, 10);
                if (!e.shiftKey) {
                    state.lastSelectedRow = rowIndex;
                }
                selectRow(rowIndex, e.ctrlKey || e.metaKey, e.shiftKey);
                return;
            }

            if (cellTarget.classList.contains('corner-cell')) {
                clearSelection();

                for (let c = 0; c < state.columnCount; c++) {
                    state.selectedColumns.add(c);
                    state.selectedColumnIndices.add(c);
                }

                state.selectionStart = { row: 0, col: 0 };
                state.selectionEnd = { row: Math.max(0, state.totalRows - 1), col: Math.max(0, state.columnCount - 1) };

                const allCells = table.querySelectorAll('td') as NodeListOf<HTMLElement>;
                allCells.forEach(cell => {
                    cell.classList.add('selected');
                    const row = parseInt(cell.dataset.row || '-1', 10);
                    const col = parseInt(cell.dataset.col || '-1', 10);
                    if (row === 0) {cell.classList.add('selection-top');}
                    if (row === state.totalRows - 1) {cell.classList.add('selection-bottom');}
                    if (col === 0) {cell.classList.add('selection-left');}
                    if (col === state.columnCount - 1) {cell.classList.add('selection-right');}
                    state.selectedCells.add(cell);
                });
                if (allCells.length > 0) {
                    allCells[0].classList.add('active-cell');
                    state.activeCell = allCells[0];
                }
                updateSelectionInfo();
                return;
            }

            if (cellTarget.tagName === 'TD') {
                const row = parseInt(cellTarget.dataset.row!, 10);
                const col = parseInt(cellTarget.dataset.col!, 10);

                // Match CSV/TSV behavior: single-cell mode should clear row/column mode selections.
                state.selectedColumnIndices.clear();
                state.selectedRowIndices.clear();
                state.selectedColumns.clear();
                state.selectedRows.clear();

                if (e.ctrlKey || e.metaKey) {
                    if (cellTarget.classList.contains('selected')) {
                        cellTarget.classList.remove('selected', 'selection-top', 'selection-bottom', 'selection-left', 'selection-right');
                        state.selectedCells.delete(cellTarget);
                        if (cellTarget === state.activeCell) {
                            cellTarget.classList.remove('active-cell');
                            state.activeCell = null;

                            const remainingSelected = document.querySelector('td.selected') as HTMLElement;
                            if (remainingSelected) {
                                remainingSelected.classList.add('active-cell');
                                state.activeCell = remainingSelected;
                            }
                        }
                    } else {
                        cellTarget.classList.add('selected', 'selection-top', 'selection-bottom', 'selection-left', 'selection-right');
                        state.selectedCells.add(cellTarget);
                        if (state.activeCell) {
                            state.activeCell.classList.remove('active-cell');
                        }
                        cellTarget.classList.add('active-cell');
                        state.activeCell = cellTarget;
                    }
                    updateSelectionInfo();
                } else if (e.shiftKey && state.activeCell) {
                    const startRow = parseInt(state.activeCell.dataset.row!, 10);
                    const startCol = parseInt(state.activeCell.dataset.col!, 10);
                    selectRange(startRow, startCol, row, col);
                } else {
                    state.isSelecting = true;
                    state.selectionStart = { row, col };
                    selectCell(cellTarget);
                }
            }
        });

        table.addEventListener('mousemove', (e) => {
            if (state.isCellEditing) {return;}
            if (!state.isSelecting || !state.selectionStart) {return;}

            // Track last mouse position for auto-scroll
            state.lastMousePos = { x: e.clientX, y: e.clientY };

            const target = (e.target as HTMLElement).closest('td') as HTMLElement;
            if (!target) {return;}

            const row = parseInt(target.dataset.row!, 10);
            const col = parseInt(target.dataset.col!, 10);

            if (!state.selectionEnd || state.selectionEnd.row !== row || state.selectionEnd.col !== col) {
                state.selectionEnd = { row, col };
                state.pendingEditDrag = true;
                selectRange(state.selectionStart.row, state.selectionStart.col, row, col);
            }

            // Start auto-scroll loop if needed
            startAutoScroll();
        });

        table.addEventListener('input', (e) => {
            if (!state.isEditMode) {return;}

            const target = e.target as HTMLElement | null;
            if (!target) {return;}

            const editableCell = target.closest('td[contenteditable="true"]') as HTMLElement | null;
            if (!editableCell) {return;}

            scheduleAutoSave('text');
        });

        table.addEventListener('focusin', (e) => {
            const target = e.target as HTMLElement | null;
            if (!target) {return;}

            const controlTarget = target.closest('.xlsx-cell-checkbox, .xlsx-cell-dropdown, .xlsx-dropdown-edit-button, .xlsx-rating-star, .xlsx-cell-date') as HTMLElement | null;
            if (!controlTarget) {return;}

            const cell = controlTarget.closest('td') as HTMLElement | null;
            if (!cell) {return;}

            const undoState = captureCellUndoState(cell);
            if (undoState) {
                state.pendingControlUndoState.set(cell, undoState);
            }
        });

        table.addEventListener('change', (e) => {
            const controlsEditable = areInteractiveControlsEnabled();
            if (!controlsEditable) {return;}

            const target = e.target as HTMLElement | null;
            if (!target) {return;}

            const checkbox = target.closest('.xlsx-cell-checkbox') as HTMLInputElement | null;
            if (checkbox) {
                const cell = checkbox.closest('td') as HTMLElement | null;
                if (!cell) {return;}
                const before = state.pendingControlUndoState.get(cell) || captureCellUndoState(cell);
                state.pendingControlUndoState.delete(cell);
                updateCheckboxCellPresentation(cell, !!checkbox.checked);
                const after = captureCellUndoState(cell);
                pushSingleCellUndo(before, after);
                if (state.isEditMode) {
                    scheduleAutoSave('control');
                } else {
                    persistInteractiveControlEdit(cell);
                }
                return;
            }

            const dropdown = target.closest('.xlsx-cell-dropdown') as HTMLSelectElement | null;
            if (dropdown) {
                const cell = dropdown.closest('td') as HTMLElement | null;
                if (!cell) {return;}
                const before = state.pendingControlUndoState.get(cell) || captureCellUndoState(cell);
                state.pendingControlUndoState.delete(cell);
                updateDropdownCellPresentation(cell, dropdown.value);
                const after = captureCellUndoState(cell);
                pushSingleCellUndo(before, after);
                if (state.isEditMode) {
                    scheduleAutoSave('control');
                } else {
                    persistInteractiveControlEdit(cell);
                }
                return;
            }

            const dateInput = target.closest('.xlsx-cell-date') as HTMLInputElement | null;
            if (dateInput) {
                const cell = dateInput.closest('td') as HTMLElement | null;
                if (!cell) {return;}
                const before = state.pendingControlUndoState.get(cell) || captureCellUndoState(cell);
                state.pendingControlUndoState.delete(cell);
                updateDateCellPresentation(cell, dateInput.value);
                const after = captureCellUndoState(cell);
                pushSingleCellUndo(before, after);
                if (state.isEditMode) {
                    scheduleAutoSave('control');
                } else {
                    persistInteractiveControlEdit(cell);
                }
            }
        });

        table.addEventListener('click', (e) => {
            const target = e.target as HTMLElement | null;
            if (!target) {return;}

            const editButton = target.closest('.xlsx-dropdown-edit-button') as HTMLButtonElement | null;
            if (editButton) {
                const cell = editButton.closest('td') as HTMLElement | null;
                if (!cell || editButton.disabled) {return;}

                void editDropdownOptionsForCell(cell);
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            const ratingStar = target.closest('.xlsx-rating-star') as HTMLButtonElement | null;
            if (ratingStar) {
                const cell = ratingStar.closest('td') as HTMLElement | null;
                if (!cell || ratingStar.disabled) {return;}

                const before = state.pendingControlUndoState.get(cell) || captureCellUndoState(cell);
                state.pendingControlUndoState.delete(cell);
                const clickedValue = normalizeRatingValue(ratingStar.getAttribute('data-rating-value'));
                const currentValue = normalizeRatingValue(cell.getAttribute('data-rating-value'));
                const nextValue = clickedValue === currentValue ? 0 : clickedValue;
                updateRatingCellPresentation(cell, nextValue);
                const after = captureCellUndoState(cell);
                pushSingleCellUndo(before, after);

                if (state.isEditMode) {
                    scheduleAutoSave('control');
                } else {
                    persistInteractiveControlEdit(cell);
                }

                e.preventDefault();
                e.stopPropagation();
                return;
            }

            const imageTarget = target.closest('.xlsx-cell-image, .cell-image-content') as HTMLElement | null;
            if (!imageTarget) {return;}

            const cell = imageTarget.closest('td') as HTMLElement | null;
            if (!cell || getCellType(cell) !== 'image') {return;}

            const imageEl = cell.querySelector('.xlsx-cell-image') as HTMLImageElement | null;
            const src = imageEl?.getAttribute('src') || '';
            if (!src) {return;}

            e.preventDefault();
            e.stopPropagation();
            showImagePreview(src);
        });

        function startAutoScroll() {
            if (state.autoScrollRequest) {return;}
            autoScrollLoop();
        }

        function stopAutoScroll() {
            if (state.autoScrollRequest) {
                cancelAnimationFrame(state.autoScrollRequest);
                state.autoScrollRequest = null;
            }
        }

        function autoScrollLoop() {
            state.autoScrollRequest = requestAnimationFrame(() => {
                if (!state.isSelecting || !state.lastMousePos) {
                    stopAutoScroll();
                    return;
                }

                const tableContainer = document.getElementById('tableContainer');
                const scrollArea = tableContainer ? tableContainer.querySelector('.table-scroll') : null;
                if (!scrollArea) {
                    stopAutoScroll();
                    return;
                }

                const rect = scrollArea.getBoundingClientRect();
                let dx = 0;
                let dy = 0;

                if (state.lastMousePos.x < rect.left + AUTO_SCROLL_THRESHOLD) {dx = -AUTO_SCROLL_STEP;}
                else if (state.lastMousePos.x > rect.right - AUTO_SCROLL_THRESHOLD) {dx = AUTO_SCROLL_STEP;}

                if (state.lastMousePos.y < rect.top + AUTO_SCROLL_THRESHOLD) {dy = -AUTO_SCROLL_STEP;}
                else if (state.lastMousePos.y > rect.bottom - AUTO_SCROLL_THRESHOLD) {dy = AUTO_SCROLL_STEP;}

                if (dx !== 0 || dy !== 0) {
                    scrollArea.scrollBy({ left: dx, top: dy, behavior: 'auto' });

                    // After scrolling, determine the element under the pointer and update selection
                    const el = document.elementFromPoint(state.lastMousePos.x, state.lastMousePos.y);
                    const nearestCell = el ? el.closest && el.closest('td') : null;
                    if (nearestCell) {
                        const htmlCell = nearestCell as HTMLElement;
                        const r = parseInt(htmlCell.dataset.row!, 10);
                        const c = parseInt(htmlCell.dataset.col!, 10);
                        if (!state.selectionEnd || state.selectionEnd.row !== r || state.selectionEnd.col !== c) {
                            state.selectionEnd = { row: r, col: c };
                            selectRange(state.selectionStart!.row, state.selectionStart!.col, r, c);
                        }
                    }
                }

                // Continue loop
                autoScrollLoop();
            });
        }

        if (state.selectionGlobalListenersAttached) {return;}
        state.selectionGlobalListenersAttached = true;

        document.addEventListener('pointerdown', (e) => {
            const target = e.target as HTMLElement | null;
            if (!target) {return;}
            if (!(target.closest('#tableContainer') || target.closest('.toolbar') || target.closest('#xlsxTable'))) {return;}

            // Ignore interactions with dropdown edit button and most native inputs/selects
            // but allow pointerdown on checkbox inputs so selection can start from them.
            if (target.closest('.xlsx-dropdown-edit-button')) {
                return;
            }

            const selEl = target.closest('select');
            if (selEl) {return;}

            const inputEl = target.closest('input');
            if (inputEl) {
                // Allow checkbox inputs used as cell controls to participate in selection start.
                const isCheckboxControl = inputEl.classList && inputEl.classList.contains('xlsx-cell-checkbox');
                if (!isCheckboxControl) {return;}
            }

            const container = document.getElementById('tableContainer') as HTMLElement | null;
            if (!container) {return;}
            if (!container.hasAttribute('tabindex')) {
                container.setAttribute('tabindex', '-1');
            }
            container.focus({ preventScroll: true });
        }, true);

        document.addEventListener('mouseup', () => {
            if (state.formatPainterExecuting && state.formatPainterStyle) {
                applyFormatToLogicalSelection(state.formatPainterStyle, 'set');
                state.formatPainterExecuting = false;
                state.formatPainterArmed = false;
                state.formatPainterStyle = null;
                document.body.classList.remove('format-painter-armed');
                showToast('Formatting applied');
            }

            const shouldStartEdit = !!state.pendingEditCell && !state.pendingEditDrag;
            const targetToEdit = state.pendingEditCell;
            state.pendingEditCell = null;
            state.pendingEditDrag = false;
            state.isSelecting = false;
            state.lastMousePos = null;
            stopAutoScroll();

            if (shouldStartEdit && targetToEdit && !state.isVersionPreviewMode && !state.isCellEditing) {
                enterCellEditMode(targetToEdit);
            }
        });

        document.addEventListener('keydown', (e) => {
            const isCmdOrCtrl = e.ctrlKey || e.metaKey;
            const target = e.target as HTMLElement | null;

            if (e.key === 'Escape' && state.imagePreviewOverlayEl && !state.imagePreviewOverlayEl.classList.contains('hidden')) {
                e.preventDefault();
                hideImagePreview();
                return;
            }

            if (e.key === 'Escape' && state.insertControlPopupEl && !state.insertControlPopupEl.classList.contains('hidden')) {
                e.preventDefault();
                hideInsertControlPopup();
                return;
            }

            if (e.key === 'Escape' && state.dropdownOptionsPopupEl && !state.dropdownOptionsPopupEl.classList.contains('hidden')) {
                e.preventDefault();
                hideDropdownOptionsPopup(null);
                return;
            }

            const isFormEntryTarget = !!target && (
                target.closest('#xlsxDropdownOptionsPopup') !== null ||
                target.closest('.xlsx-cell-dropdown') !== null ||
                target.closest('.xlsx-dropdown-edit-button') !== null ||
                target.closest('.xlsx-cell-date') !== null ||
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.tagName === 'SELECT'
            );

            if (isFormEntryTarget) {
                if (isCmdOrCtrl && e.key.toLowerCase() === 's') {
                    e.preventDefault();
                    saveEdits(false);
                }
                return;
            }

            if (isCmdOrCtrl && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                toggleFindOverlay();
                return;
            }

            if (e.key === 'F3') {
                e.preventDefault();
                void navigateFind(e.shiftKey ? 'prev' : 'next');
                return;
            }

            if (target && (target.closest('#sheetFindOverlay') || target.closest('#sheetFindInput') || target.closest('#sheetFindNext') || target.closest('#sheetFindPrev') || target.closest('#sheetFindClose'))) {
                return;
            }

            if (state.isVersionPreviewMode) {
                const key = e.key.toLowerCase();
                const allowNavigation = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'pageup', 'pagedown', 'home', 'end'].includes(key);

                if (e.key === 'Escape') {
                    e.preventDefault();
                    post({ command: 'cancelVersionPreview' });
                    return;
                }

                if (isCmdOrCtrl && key === 'c') {
                    e.preventDefault();
                    copySelectionToClipboard();
                    return;
                }

                if (!allowNavigation) {
                    e.preventDefault();
                    showToast('Version preview is read-only');
                    return;
                }
            }

            if (isCmdOrCtrl && e.key.toLowerCase() === 's') {
                e.preventDefault();
                saveEdits(false);
                return;
            }

            const isUndoShortcut = isCmdOrCtrl && !e.shiftKey && e.key.toLowerCase() === 'z';
            const isRedoShortcut = isCmdOrCtrl && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'));
            if (isUndoShortcut || isRedoShortcut) {
                const active = document.activeElement as HTMLElement | null;
                const isEditingCell = !!active && active.tagName === 'TD' && active.getAttribute('contenteditable') === 'true';

                if (isEditingCell && state.isEditMode) {
                    e.preventDefault();
                    exitCellEditMode();
                }

                const handled = isRedoShortcut ? redoEditAction() : undoEditAction();
                if (handled) {
                    e.preventDefault();
                    if (state.isEditMode) {
                        scheduleAutoSave('text');
                    }
                    return;
                }

                if (state.isEditMode) {
                    e.preventDefault();
                    return;
                }
            }

            if (!state.isCellEditing) {
                const canDirectTextEdit = !state.isVersionPreviewMode;
                const key = e.key;
                if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab', 'Enter'].includes(key)) {
                    e.preventDefault();

                    if (key === 'Enter') {
                        if (canDirectTextEdit && state.activeCell) {
                            enterCellEditMode(state.activeCell);
                        } else if (state.activeCell) {
                            moveSelection(1, 0, e.shiftKey);
                        }
                        return;
                    }

                    let rowDelta = 0;
                    let colDelta = 0;
                    if (key === 'ArrowUp') {rowDelta = -1;}
                    if (key === 'ArrowDown') {rowDelta = 1;}
                    if (key === 'ArrowLeft' || (key === 'Tab' && e.shiftKey)) {colDelta = -1;}
                    if (key === 'ArrowRight' || (key === 'Tab' && !e.shiftKey)) {colDelta = 1;}

                    moveSelection(rowDelta, colDelta, e.shiftKey);
                    return;
                }

                if (canDirectTextEdit && state.activeCell && e.key.length === 1 && !isCmdOrCtrl && !e.altKey) {
                    enterCellEditMode(state.activeCell);
                    return;
                }

                if (e.key === 'F2' && canDirectTextEdit && state.activeCell) {
                    e.preventDefault();
                    enterCellEditMode(state.activeCell);
                    return;
                }
            } else {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (e.shiftKey) {
                        const editableCell = document.activeElement as HTMLElement | null;
                        if (editableCell && editableCell.tagName === 'TD') {
                            insertLineBreakAtCaret(editableCell);
                            if (state.isEditMode) {
                                scheduleAutoSave('text');
                            }
                        }
                        return;
                    }
                    exitCellEditMode();
                    moveSelection(1, 0, false);
                    return;
                }
                if (e.key === 'Tab') {
                    e.preventDefault();
                    exitCellEditMode();
                    moveSelection(0, e.shiftKey ? -1 : 1, false);
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    const active = document.activeElement as HTMLElement;
                    if (active && active.tagName === 'TD') {
                        active.innerHTML = active.dataset.originalHtml || '';
                    }
                    exitCellEditMode();
                    if (state.activeCell) {state.activeCell.focus();}
                    return;
                }
            }

            const canClearValues = state.isEditMode || isPlainDirectEditMode();
            if ((e.key === 'Delete' || e.key === 'Backspace') && canClearValues && !state.isCellEditing) {
                e.preventDefault();
                clearSelectionContents();
                return;
            }

            if (state.isEditMode) {
                if (isCmdOrCtrl && e.key.toLowerCase() === 'b') {
                    e.preventDefault();
                    applyEditFormatting('bold');
                    return;
                }

                if (isCmdOrCtrl && e.key.toLowerCase() === 'i') {
                    e.preventDefault();
                    applyEditFormatting('italic');
                    return;
                }

                if (isCmdOrCtrl && e.key.toLowerCase() === 'u') {
                    e.preventDefault();
                    applyStrikeThrough();
                    return;
                }

                return;
            }

            if (isCmdOrCtrl && e.key.toLowerCase() === 'c') {
                e.preventDefault();
                copySelectionToClipboard();
                return;
            }

            if (isCmdOrCtrl && e.key.toLowerCase() === 'a') {
                e.preventDefault();
                const currentTable = document.querySelector('#tableContainer table');
                if (!currentTable) {return;}
                const allCells = currentTable.querySelectorAll('td') as NodeListOf<HTMLElement>;
                clearSelection();

                for (let c = 0; c < state.columnCount; c++) {
                    state.selectedColumns.add(c);
                    state.selectedColumnIndices.add(c);
                }

                state.selectionStart = { row: 0, col: 0 };
                state.selectionEnd = { row: Math.max(0, state.totalRows - 1), col: Math.max(0, state.columnCount - 1) };

                allCells.forEach(cell => {
                    cell.classList.add('selected');
                    const row = parseInt(cell.dataset.row || '-1', 10);
                    const col = parseInt(cell.dataset.col || '-1', 10);
                    if (row === 0) {cell.classList.add('selection-top');}
                    if (row === state.totalRows - 1) {cell.classList.add('selection-bottom');}
                    if (col === 0) {cell.classList.add('selection-left');}
                    if (col === state.columnCount - 1) {cell.classList.add('selection-right');}
                    state.selectedCells.add(cell);
                });
                if (allCells.length > 0) {
                    allCells[0].classList.add('active-cell');
                    state.activeCell = allCells[0];
                }
                updateSelectionInfo();
            }
        });

        document.addEventListener('click', (e) => {
            const target = e.target as HTMLElement;
            if (state.headerContextMenuEl && !state.headerContextMenuEl.classList.contains('hidden')) {
                if (!target.closest('#headerContextMenu') && !target.closest('th.row-header') && !target.closest('th.col-header')) {
                    hideHeaderContextMenu();
                }
            }

            if (state.isCellEditing && !target.closest('td[contenteditable="true"]')) {
                exitCellEditMode();
            }

            if (state.isEditMode) {return;}
            if (!target.closest('table') && !target.closest('.toolbar')) {
                clearSelection();
            }
        });
    }

    function setSettingItemHidden(id: string, hidden: boolean) {
        const input = document.getElementById(id);
        const settingItem = input?.closest('.setting-item') as HTMLElement | null;
        if (!settingItem) {return;}
        settingItem.style.display = hidden ? 'none' : '';
    }

    function resetStyledOnlySettingsVisibility() {
        const styledOnlySettingIds = [
            'chkAllowInteractiveControlsOutsideEditMode',
            'chkHyperlinkPreview',
            'chkMergeWarningEnabled',
            'radioAutoSaveAll',
            'radioAutoSaveControlsOnly',
            'chkShowManualSavePopup'
        ];

        styledOnlySettingIds.forEach((id) => setSettingItemHidden(id, false));
    }

    function hideStyledOnlySettingsForPlainMode() {
        const styledOnlySettingIds = [
            'chkAllowInteractiveControlsOutsideEditMode',
            'chkHyperlinkPreview',
            'chkMergeWarningEnabled',
            'radioAutoSaveAll',
            'radioAutoSaveControlsOnly',
            'chkShowManualSavePopup'
        ];

        styledOnlySettingIds.forEach((id) => setSettingItemHidden(id, true));
    }

    function applySettings(settings: any, scopeOverride?: SettingsScope) {
        const scope = scopeOverride || getCurrentSettingsScope();
        const previousSpacious = !!state.currentSettings.spaciousCells;
        const previousSettings = getStoredSettingsForScope(scope);
        state.currentSettings = normalizeSettingsForScope(scope, settings, previousSettings);
        setStoredSettingsForScope(scope, state.currentSettings);

        if (!state.currentSettings.autoSave) {
            clearAutoSaveTimer();
            if (!state.isEditMode && state.pendingOutsideControlEdits.length > 0) {
                showManualSaveReminderIfNeeded();
            }
        } else {
            if (state.isEditMode && hasPendingXlsxEdits()) {
                scheduleAutoSave('text');
            } else if (!state.isEditMode && state.pendingOutsideControlEdits.length > 0) {
                saveEdits(false, true);
            }
        }

        if (state.currentSettings.autoSave) {
            state.manualSaveReminderUntil = 0;
        }

        resetStyledOnlySettingsVisibility();
        syncSettingsCheckboxes(state.currentSettings);
        if (scope === 'plain') {
            hideStyledOnlySettingsForPlainMode();
        }

        document.body.classList.toggle('sticky-header-enabled', !!state.currentSettings.stickyHeader);
        document.body.classList.toggle('first-row-as-header', !!state.currentSettings.firstRowIsHeader);
        document.body.classList.toggle('spacious-cells', !!state.currentSettings.spaciousCells);
        document.body.classList.toggle('text-wrap-enabled', !!state.currentSettings.textWrap);

        applyToolbarLayout(state.toolbarManager, {
            stickyToolbar: !!state.currentSettings.stickyToolbar,
            forceSticky: state.isEditMode,
            scrollTarget: '#content',
            onLayoutApplied: initializeVirtualScrolling
        });

        if (!state.currentSettings.hyperlinkPreview) {hideLinkTooltip();}
        applyInteractiveControlState();

        const spaciousChanged = previousSpacious !== !!state.currentSettings.spaciousCells;
        if (spaciousChanged && state.worksheetsMeta.length > 0) {
            invalidateRowMetrics();
            state.currentVisibleStart = 0;
            state.currentVisibleEnd = 0;
            rerenderCurrentSheetFromLocalState();
        }
    }

    function postSettings() {
        post({
            command: 'updateSettings',
            settingsScope: getCurrentSettingsScope(),
            settings: state.currentSettings
        });
    }

    function enterCellEditMode(cell: HTMLElement, clearContent = false) {
        if (state.isVersionPreviewMode) {return;}

        const cellType = getCellType(cell);
        if (cellType === 'checkbox') {
            const checkbox = cell.querySelector('.xlsx-cell-checkbox') as HTMLInputElement | null;
            if (checkbox && !checkbox.disabled) {
                const before = captureCellUndoState(cell);
                const next = !checkbox.checked;
                updateCheckboxCellPresentation(cell, next);
                const after = captureCellUndoState(cell);
                pushSingleCellUndo(before, after);
                if (state.isEditMode) {
                    scheduleAutoSave('control');
                } else {
                    persistInteractiveControlEdit(cell);
                }
            }
            return;
        }

        if (cellType === 'dropdown') {
            const dropdown = cell.querySelector('.xlsx-cell-dropdown') as HTMLSelectElement | null;
            if (dropdown && !dropdown.disabled) {
                dropdown.focus();
            }
            return;
        }

        if (cellType === 'rating') {
            const current = normalizeRatingValue(cell.getAttribute('data-rating-value'));
            const next = current >= 5 ? 0 : current + 1;
            const before = captureCellUndoState(cell);
            updateRatingCellPresentation(cell, next);
            const after = captureCellUndoState(cell);
            pushSingleCellUndo(before, after);
            if (state.isEditMode) {
                scheduleAutoSave('control');
            } else {
                persistInteractiveControlEdit(cell);
            }
            return;
        }

        if (cellType === 'date') {
            const dateInput = cell.querySelector('.xlsx-cell-date') as HTMLInputElement | null;
            if (dateInput && !dateInput.disabled) {
                dateInput.focus();
                dateInput.showPicker?.();
            }
            return;
        }

        if (cellType === 'image') {
            const imageEl = cell.querySelector('.xlsx-cell-image') as HTMLImageElement | null;
            const src = imageEl?.getAttribute('src') || '';
            if (src) {
                showImagePreview(src);
            }
            return;
        }

        if (state.isCellEditing) {
            exitCellEditMode();
        }
        cell.dataset.originalText = getCellNormalizedValue(cell);
        cell.dataset.originalHtml = cell.innerHTML;
        state.activeTextEditBeforeState = captureCellUndoState(cell);
        state.isCellEditing = true;
        cell.setAttribute('contenteditable', 'true');
        cell.setAttribute('spellcheck', 'false');
        cell.focus();

        if (clearContent) {
            loadEditableCellContent(cell, '');
        } else {
            loadEditableCellContent(cell, cell.dataset.originalText || '');
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(cell);
            sel?.removeAllRanges();
            sel?.addRange(range);
        }
    }

    function exitCellEditMode() {
        if (!state.isCellEditing) {return;}
        state.isCellEditing = false;

        const editableCell = (document.querySelector('td[contenteditable="true"]') as HTMLElement | null)
            || ((document.activeElement as HTMLElement | null)?.tagName === 'TD' ? document.activeElement as HTMLElement : null);
        const active = document.activeElement as HTMLElement;
        let changed = false;
        let afterState: CellUndoState | null = null;

        if (editableCell) {
            const original = (editableCell.dataset.originalText || '').replace(/\u00a0/g, '');
            const current = getCellNormalizedValue(editableCell).replace(/\u00a0/g, '');
            changed = current !== original;
            afterState = captureCellUndoState(editableCell);
            editableCell.removeAttribute('contenteditable');
        }

        if (active && active.tagName === 'TD') {
            active.blur();
        }

        document.querySelectorAll('td[contenteditable="true"]').forEach(td => {
            td.removeAttribute('contenteditable');
        });

        if (changed) {
            pushSingleCellUndo(state.activeTextEditBeforeState, afterState);
            if (state.isEditMode) {
                if (editableCell) {
                    const rowNum = parseInt(editableCell.getAttribute('data-rownum') || '0', 10);
                    const colNum = parseInt(editableCell.getAttribute('data-colnum') || '0', 10);
                    if (rowNum && colNum) {
                        const cellData = getOrCreateRowCellData(rowNum - 1, colNum - 1);
                        if (cellData) {
                            const current = getCellNormalizedValue(editableCell).replace(/\u00a0/g, '');
                            cellData.value = current;
                        }
                    }
                }
                scheduleAutoSave('text');
            } else if (editableCell && !state.isVersionPreviewMode) {
                persistPlainTextEdit(editableCell);
            }
        }

        state.activeTextEditBeforeState = null;
    }

    async function moveSelection(rowDelta: number, colDelta: number, shiftKey: boolean) {
        if (!state.activeCell) {return;}

        let currentR = parseInt(state.activeCell.getAttribute('data-row') || '0', 10);
        let currentC = parseInt(state.activeCell.getAttribute('data-col') || '0', 10);

        if (shiftKey && state.selectionEnd) {
            currentR = state.selectionEnd.row;
            currentC = state.selectionEnd.col;
        }

        let nextR = currentR + rowDelta;
        let nextC = currentC + colDelta;

        nextR = Math.max(0, Math.min(state.totalRows - 1, nextR));
        nextC = Math.max(0, Math.min(state.columnCount - 1, nextC));

        let nextCell = document.querySelector(`td[data-row="${nextR}"][data-col="${nextC}"]`) as HTMLElement;

        if (!nextCell) {
            const container = getTableContainer();
            if (container) {
                const top = getRowTopOffset(nextR);
                container.scrollTop = Math.max(0, top - 100);
                await updateVisibleRows();
                nextCell = document.querySelector(`td[data-row="${nextR}"][data-col="${nextC}"]`) as HTMLElement;
            }
        }

        if (nextCell) {
            if (shiftKey) {
                if (!state.selectionStart) {
                    state.selectionStart = {
                        row: parseInt(state.activeCell.getAttribute('data-row') || '0', 10),
                        col: parseInt(state.activeCell.getAttribute('data-col') || '0', 10)
                    };
                }
                state.selectionEnd = { row: nextR, col: nextC };
                selectionManager.selectRange(state.selectionStart.row, state.selectionStart.col, state.selectionEnd.row, state.selectionEnd.col);
            } else {
                state.selectionStart = { row: nextR, col: nextC };
                state.selectionEnd = { row: nextR, col: nextC };
                selectionManager.selectCell(nextCell);
            }

            const container = getTableContainer();
            if (container) {
                const cellRect = nextCell.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                const headerOffset = 30;
                const rowHeaderOffset = 50;

                if (cellRect.bottom > containerRect.bottom) {
                    container.scrollTop += cellRect.bottom - containerRect.bottom + 10;
                } else if (cellRect.top < containerRect.top + headerOffset) {
                    container.scrollTop -= (containerRect.top + headerOffset) - cellRect.top + 10;
                }

                if (cellRect.right > containerRect.right) {
                    container.scrollLeft += cellRect.right - containerRect.right + 10;
                } else if (cellRect.left < containerRect.left + rowHeaderOffset) {
                    container.scrollLeft -= (containerRect.left + rowHeaderOffset) - cellRect.left + 10;
                }
            }
        }
    }

    function setEditMode(enabled: boolean, preserveSelection: boolean = false) {
        if (enabled && state.isVersionPreviewMode) {
            showToast('Version preview is read-only');
            return;
        }

        state.isEditMode = !!enabled;
        document.body.classList.toggle('edit-mode', state.isEditMode);
        hideImagePreview();

        const toolbarEl = document.getElementById('toolbar') as HTMLElement | null;
        if (toolbarEl) {
            toolbarEl.classList.remove('hidden');
            toolbarEl.style.removeProperty('display');
        }

        ensureHeaderVisible();

        if (state.isEditMode) {
            const globalTip = document.querySelector('.global-tooltip') as HTMLElement | null;
            if (globalTip) {
                globalTip.style.opacity = '0';
                globalTip.style.visibility = 'hidden';
            }
        }

        applyToolbarLayout(state.toolbarManager, {
            stickyToolbar: !!state.currentSettings.stickyToolbar,
            forceSticky: state.isEditMode,
            scrollTarget: '#content',
            onLayoutApplied: initializeVirtualScrolling
        });

        const toggleExpandButton = document.getElementById('toggleExpandButton');
        const togglePlainViewButton = document.getElementById('togglePlainViewButton');
        const versionHistoryButton = document.getElementById('versionHistoryButton');
        const openSettingsButton = document.getElementById('openSettingsButton');
        const helpButton = document.getElementById('helpButton');
        const convertFileButton = document.getElementById('convertFileButton');
        const refreshButton = document.getElementById('refreshButton');

        const toggleTableEditButton = document.getElementById('toggleTableEditButton');
        const saveTableEditsButton = document.getElementById('saveTableEditsButton');
        const cancelTableEditsButton = document.getElementById('cancelTableEditsButton');
        const insertControlButton = document.getElementById('insertControlButton');
        const formatBoldButton = document.getElementById('formatBoldButton');
        const formatItalicButton = document.getElementById('formatItalicButton');
        const formatTextColorButton = document.getElementById('formatTextColorButton');
        const formatBackgroundColorButton = document.getElementById('formatBackgroundColorButton');

        if (state.toolbarManager) {
            state.toolbarManager.setButtonVisibility('toggleTableEditButton', !state.isEditMode && !isPlainDirectEditMode());
            state.toolbarManager.setButtonVisibility('saveTableEditsButton', state.isEditMode);
            state.toolbarManager.setButtonVisibility('cancelTableEditsButton', state.isEditMode);
            state.toolbarManager.setButtonVisibility('insertControlButton', state.isEditMode);
            state.toolbarManager.setButtonVisibility('formatBoldButton', false);
            state.toolbarManager.setButtonVisibility('formatItalicButton', false);
            state.toolbarManager.setButtonVisibility('formatTextColorButton', false);
            state.toolbarManager.setButtonVisibility('formatBackgroundColorButton', false);
            state.toolbarManager.setButtonVisibility('refreshButton', !state.isEditMode);
        } else {
            if (toggleTableEditButton) {toggleTableEditButton.classList.toggle('hidden', state.isEditMode || isPlainDirectEditMode());}
            if (saveTableEditsButton) {saveTableEditsButton.classList.toggle('hidden', !state.isEditMode);}
            if (cancelTableEditsButton) {cancelTableEditsButton.classList.toggle('hidden', !state.isEditMode);}
            if (insertControlButton) {insertControlButton.classList.toggle('hidden', !state.isEditMode);}
            if (formatBoldButton) {formatBoldButton.classList.add('hidden');}
            if (formatItalicButton) {formatItalicButton.classList.add('hidden');}
            if (formatTextColorButton) {formatTextColorButton.classList.add('hidden');}
            if (formatBackgroundColorButton) {formatBackgroundColorButton.classList.add('hidden');}
        }

        if (state.editFormattingStripEl) {
            state.editFormattingStripEl.classList.toggle('hidden', !state.isEditMode);
        }

        syncSheetSelectorVisibility();
        if (toggleExpandButton) {toggleExpandButton.classList.remove('hidden');}
        if (togglePlainViewButton) {togglePlainViewButton.classList.toggle('hidden', state.isEditMode && !state.isPlainView);}
        if (versionHistoryButton) {versionHistoryButton.classList.toggle('hidden', state.isEditMode);}
        if (openSettingsButton) {openSettingsButton.classList.remove('hidden');}
        if (helpButton) {helpButton.classList.toggle('hidden', state.isEditMode);}
        if (convertFileButton) {convertFileButton.classList.toggle('hidden', state.isEditMode);}
        if (refreshButton) {refreshButton.classList.toggle('hidden', state.isEditMode);}

        reorderToolbarAroundFind(state.isEditMode);

        if (!state.isEditMode) {
            exitCellEditMode();
            hideLinkTooltip();
            hideHeaderContextMenu();
            hideColorPalette();
            hideBorderPopup();
            hideInsertControlPopup();
            clearAutoSaveTimer();
            applyInteractiveControlState();

            if (!preserveSelection) {clearSelection();}
            state.lastEditRange = null;
            state.pendingWorksheetOps = [];
            state.pendingCellStyleEdits.clear();
            state.editUndoStack.length = 0;
            state.editRedoStack.length = 0;
            state.formatPainterArmed = false;
            state.formatPainterStyle = null;
            document.body.classList.remove('format-painter-armed');
            return;
        }

        if (!preserveSelection) {clearSelection();}
        state.editUndoStack.length = 0;
        state.editRedoStack.length = 0;
        hideInsertControlPopup();

        // Enable contenteditable for table cells
        const table = document.querySelector('#tableContainer table');
        if (!table) {return;}

        // Rebuild visible dropdown controls when entering edit mode so the inline Edit button appears immediately.
        table.querySelectorAll('td[data-cell-type="dropdown"]').forEach((td) => {
            const cell = td as HTMLElement;
            const options = getDropdownOptionsFromCell(cell);
            const selectedValue = getCellNormalizedValue(cell);

            cell.innerHTML = renderDropdownCellContent({
                options,
                selectedValue,
                allowInteractiveControls: areInteractiveControlsEnabled(),
                showEditButton: true
            });
            updateDropdownCellPresentation(cell, selectedValue);
        });

        applyInteractiveControlState(table);

        table.querySelectorAll('td').forEach(td => {
            td.classList.add('editable-cell');
            const htmlTd = td as HTMLElement;
            const currentText = getCellNormalizedValue(htmlTd);
            htmlTd.dataset.originalText = currentText;
            htmlTd.dataset.originalHtml = htmlTd.innerHTML;
        });

        captureOriginalCellValues();
    }

    function setExpandedMode(isExpanded: boolean) {
        document.body.classList.toggle('expanded-mode', !!isExpanded);

        const expandIcon = document.getElementById('expandIcon');
        const collapseIcon = document.getElementById('collapseIcon');
        const text = document.getElementById('expandButtonText');

        if (expandIcon) {expandIcon.style.display = isExpanded ? 'none' : 'block';}
        if (collapseIcon) {collapseIcon.style.display = isExpanded ? 'block' : 'none';}
        if (text) {text.textContent = isExpanded ? 'Default' : 'Expand';}

        adjustColumnWidths(isExpanded ? 'expand' : 'default');
    }

    function wireSettingsUI() {
        const settings = createXlsxSettingsDefinitions(
            () => state.currentSettings,
            (next: XlsxViewSettings) => {
                applySettings(next);
            },
            () => {
                postSettings();
            },
            {
                fileExtension: state.currentAssociationFileType,
                onOpenByDefaultChange: (enabled: boolean) => {
                    post({ command: enabled ? 'enableAsDefault' : 'disableDefaultEditor' });
                }
            }
        );

        SettingsManager.renderPanel(document.getElementById('toolbar')!, 'settingsPanel', 'settingsCancelButton', settings);

        const settingsGroup = document.querySelector('#settingsPanel .settings-group');
        if (settingsGroup) {
            settingsGroup.insertAdjacentHTML('beforeend', renderThemeToggleSettingItem('themeSelect'));
        }

        new SettingsManager('openSettingsButton', 'settingsPanel', 'settingsCancelButton', settings, () => {
            state.toolbarManager?.updateHeaderHeight();
        });

        if (typeof ThemeManager !== 'undefined') {
            new ThemeManager('themeSelect', {
                onBeforeCycle: () => !state.isEditMode
            }, vscode);
        }
    }

    function attachHandlersOnce() {
        if (state.handlersAttached) {return;}
        state.handlersAttached = true;

        state.toolbarManager = new ToolbarManager('toolbar');
        const toolbar = state.toolbarManager;

        // Sheet Selector
        const sheetSelector = document.createElement('select');
        sheetSelector.id = 'sheetSelector';
        sheetSelector.className = 'sheet-selector';
        sheetSelector.title = 'Select sheet';
        sheetSelector.addEventListener('change', (e) => {
            if (state.isEditMode) {return;}
            state.currentWorksheet = parseInt((e.target as HTMLSelectElement).value, 10);
            clearDataTransforms();
            clearSelection();
            renderWorksheet(state.currentWorksheet);
        });

        toolbar.setButtons(createXlsxToolbarButtons({
            onFind: () => openFindOverlay(),
            textColorIcon,
            bgColorIcon,
            onToggleTableEdit: () => setEditMode(true),
            onSaveTableEdits: () => saveEdits(true),
            onCancelTableEdits: () => {
                setEditMode(false);
                renderWorksheet(state.currentWorksheet);
                setTimeout(() => {
                    hideLoading();
                    ensureHeaderVisible();
                    const toolbarEl = document.getElementById('toolbar') as HTMLElement | null;
                    if (toolbarEl) {
                        toolbarEl.classList.remove('hidden');
                        toolbarEl.style.display = 'flex';
                    }
                    state.toolbarManager?.updateHeaderHeight();
                }, 180);
            },
            onInsertControl: () => {
                const btn = document.getElementById('insertControlButton') as HTMLElement | null;
                if (btn) {
                    showInsertControlPopup(btn);
                }
            },
            onFormatBold: () => applyEditFormatting('bold'),
            onFormatItalic: () => applyEditFormatting('italic'),
            onFormatTextColor: () => { },
            onFormatBackgroundColor: () => { },
            onToggleExpand: () => {
                const btn = document.getElementById('toggleExpandButton');
                const buttonState = btn?.getAttribute('data-state') || 'default';
                if (buttonState === 'default') {
                    btn?.setAttribute('data-state', 'expanded');
                    if (btn) {btn.innerHTML = Icons.Collapse;}
                    setExpandedMode(true);
                } else {
                    btn?.setAttribute('data-state', 'default');
                    if (btn) {btn.innerHTML = Icons.Expand;}
                    setExpandedMode(false);
                }
            },
            onTogglePlainView: () => {
                if (state.isEditMode) {return;}
                if (state.isPlainView && state.isTemporaryStyleFile) {
                    requestStyledMode();
                    return;
                }
                state.isPlainView = !state.isPlainView;
                syncPlainViewUiState();
                syncTemporaryFileToolbarActions();
                // Always notify the provider so it stays in sync for all file types
                post({ command: 'setPreferredViewMode', mode: state.isPlainView ? 'plain' : 'styled' });
                applySettingsForScope(getCurrentSettingsScope());

                state.rowCache.clear();
                state.currentVisibleStart = 0;
                state.currentVisibleEnd = 0;
                renderWorksheet(state.currentWorksheet);
            },
            onVersionHistory: () => {
                if (state.isEditMode) {return;}
                post({ command: 'showVersionHistory' });
            },
            onOpenSettings: () => { },
            onHelp: () => {
                FeedbackModal.show();
            },
            onConvertFile: () => {
                if (state.isEditMode) {return;}
                post({ command: 'convertFile' });
            },
            onRefresh: () => {
                if (state.isEditMode) {return;}
                post({ command: 'requestFreshData' });
            }
        }));

        toolbar.prependElement(sheetSelector);

        // Inject tooltip if variables are present

        // Ensure the "Plain/Styled" toggle shows the correct label on initial render
        const togglePlainViewBtn = document.getElementById('togglePlainViewButton');
        if (togglePlainViewBtn) {
            updatePlainViewButtonLabel();
        }

        wireEditFormattingControls();

        wireSettingsUI();
        wireDelayedToolbarTooltips();

        document.addEventListener('click', (e) => {
            const target = e.target as HTMLElement | null;
            if (!target) {return;}

            if (!target.closest('#insertControlButton') && !target.closest('#xlsxInsertControlPopup') && !target.closest('#xlsxDropdownOptionsPopup')) {
                hideInsertControlPopup();
            }

            if (!target.closest('#xlsxDropdownOptionsPopup') && !target.closest('#xlsxInsertControlPopup') && !target.closest('#insertControlButton') && state.dropdownOptionsPopupEl && !state.dropdownOptionsPopupEl.classList.contains('hidden')) {
                hideDropdownOptionsPopup(null);
            }
        });

        window.addEventListener('resize', () => {
            state.toolbarManager?.updateHeaderHeight();
        });
    }

    function populateSheetSelector() {
        const selector = document.getElementById('sheetSelector') as HTMLSelectElement;
        if (!selector) {return;}

        selector.innerHTML = '';
        state.worksheetsMeta.forEach((ws, i) => {
            const opt = document.createElement('option');
            opt.value = String(i);

            // Format name to "Sheet X" if generic
            let name = ws.name || `Sheet ${i + 1}`;
            const genericRegex = /^sheet\s*(\d+)$/i;
            if (genericRegex.test(name)) {
                const match = name.match(genericRegex);
                if (match) {
                    name = `Sheet ${match[1]}`;
                }
            }

            opt.textContent = name;
            selector.appendChild(opt);
        });
        selector.value = '0';
        syncSheetSelectorVisibility();
    }

    window.addEventListener('message', (event) => {
        const message = event.data as HostToSpreadsheetWebview;
        if (!message || typeof message !== 'object' || !('command' in message)) {return;}

        if (message.command === 'initSettings') {
            consumeIncomingSettingsPayload(message);
            return;
        }

        if (message.command === 'settingsUpdated') {
            consumeIncomingSettingsPayload(message);
            return;
        }

        if (message.command === 'saveResult') {
            onSaveResult(message);
            return;
        }

        if (message.command === 'versionHistoryError') {
            showToast(message.message || 'Version history failed');
            return;
        }

        if (message.command === 'versionRestoredXlsx') {
            showToast('Version restored');
            return;
        }

        if (message.command === 'versionPreviewCancelledXlsx') {
            showToast('Preview canceled');
            return;
        }

        if (message.command === 'styleModeActivated') {
            activateStyledMode();
            return;
        }

        if (message.command === 'showStyleModeNotice') {
            showStyleModeNoticePopup();
            return;
        }

        if (message.command === 'styleModeCancelled') {
            cancelStyledModeRequest();
            return;
        }

        if (message.command === 'diskDeletedExternally') {
            showToast('File deleted from disk', false, 10000);
            return;
        }

        // Handle rowsData response for virtual scrolling
        if (message.command === 'rowsData') {
            virtualLoader.resolveRequest(message.requestId, message.rows || []);
            return;
        }

        // Handle initVirtualTable for virtual scrolling
        if (message.command === 'initVirtualTable') {
            const previousWorksheet = state.currentWorksheet;
            state.worksheetsMeta = Array.isArray(message.worksheets) ? message.worksheets : [];
            state.currentWorksheet = Math.min(Math.max(previousWorksheet, 0), Math.max(state.worksheetsMeta.length - 1, 0));
            clearDataTransforms();

            state.hasVirtualTableInit = true;
            state.isTemporaryStyleFile = message.fileType === 'csv' || message.fileType === 'tsv';
            state.currentAssociationFileType = typeof message.fileType === 'string' ? message.fileType : 'xlsx';
            state.isPlainView = message.isPlainView !== undefined ? !!message.isPlainView : state.isTemporaryStyleFile;
            syncPlainViewUiState();

            const rowHeaderWidth = typeof message.rowHeaderWidth === 'number' ? message.rowHeaderWidth : MIN_ROW_HEADER_WIDTH;
            setRowHeaderWidth(rowHeaderWidth, true);

            attachHandlersOnce();
            syncTemporaryFileToolbarActions();
            populateSheetSelector();
            const selector = document.getElementById('sheetSelector') as HTMLSelectElement | null;
            if (selector) {selector.value = String(state.currentWorksheet);}

            applySettingsForScope(getCurrentSettingsScope());
            const expandBtn = document.getElementById('toggleExpandButton');
            if (expandBtn) {expandBtn.setAttribute('data-state', 'default');}
            setExpandedMode(false);

            if (message.previewMode) {
                state.previewVersionId = typeof message.versionId === 'string' ? message.versionId : null;
                const previewLabel = message.timestamp
                    ? `Previewing ${new Date(message.timestamp).toLocaleString()} (read-only)`
                    : 'Previewing selected version (read-only)';
                setVersionPreviewMode(true, previewLabel);
            } else {
                setVersionPreviewMode(false);
            }

            renderWorksheet(state.currentWorksheet);
            return;
        }

        // Compile-time check that every host message has a handler: only the feedback modal's
        // messages may reach here. A new HostToSpreadsheetWebview member fails to compile until handled.
        const handledByFeedbackModal: HandledByFeedbackModal = message;
        void handledByFeedbackModal;
    });

    document.addEventListener('DOMContentLoaded', () => {
        post({ command: 'webviewReady' });
    });
})();
