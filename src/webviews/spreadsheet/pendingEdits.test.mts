import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PendingEdits, remapAddress } from './pendingEdits.ts';

test('recording a value marks the sheet dirty; editing it back to the original makes it clean again', () => {
    const ledger = new PendingEdits();
    assert.equal(ledger.isDirty(), false);
    ledger.recordValue(0, 2, 3, 'new', 'old');
    assert.equal(ledger.isDirty(), true);
    assert.equal(ledger.isDirty(0), true);
    assert.equal(ledger.isDirty(1), false);
    ledger.recordValue(0, 2, 3, 'old', 'new');
    assert.equal(ledger.isDirty(), false, 'the original comes from the first edit, not the latest');
});

test('takePayload sends ops, values, rich runs and styles of one sheet only', () => {
    const ledger = new PendingEdits();
    ledger.recordValue(0, 1, 1, 'a', '');
    ledger.recordRich(0, 1, 1, [{ text: 'a', bold: true }]);
    ledger.recordStyle(0, { row: 1, col: 1, fontWeight: 'bold' });
    ledger.recordOp(0, { type: 'mergeRange', startRow: 1, startCol: 1, endRow: 1, endCol: 2 });
    ledger.recordValue(1, 5, 5, 'other sheet', '');
    const { payload } = ledger.takePayload(0);
    assert.deepEqual(payload.edits, [{ row: 1, col: 1, value: 'a' }]);
    assert.deepEqual(payload.richEdits, [{ row: 1, col: 1, runs: [{ text: 'a', bold: true }] }]);
    assert.deepEqual(payload.styleEdits, [{ row: 1, col: 1, fontWeight: 'bold' }]);
    assert.equal(payload.operations.length, 1);
    assert.deepEqual(ledger.takePayload(1).payload.edits, [{ row: 5, col: 5, value: 'other sheet' }]);
});

test('settleSaved keeps what was edited while the save was in flight (bug: a save result cleared everything)', () => {
    const ledger = new PendingEdits();
    ledger.recordValue(0, 1, 1, 'first', 'x');
    ledger.recordValue(0, 2, 2, 'second', 'y');
    const { mark } = ledger.takePayload(0);

    ledger.recordValue(0, 2, 2, 'second, edited again', 'y'); // changed after the payload was taken
    ledger.recordValue(0, 3, 3, 'brand new', 'z'); // made during the save
    ledger.recordOp(0, { type: 'deleteColumn', index: 9 });
    ledger.recordStyle(0, { row: 4, col: 4, fontStyle: 'italic' });

    ledger.settleSaved(mark);
    const left = ledger.takePayload(0).payload;
    assert.deepEqual(left.edits, [{ row: 2, col: 2, value: 'second, edited again' }, { row: 3, col: 3, value: 'brand new' }]);
    assert.equal(left.operations.length, 1, 'the op recorded during the save is still pending');
    assert.equal(left.styleEdits.length, 1);
});

test('settleSaved leaves the sheet clean when nothing changed meanwhile', () => {
    const ledger = new PendingEdits();
    ledger.recordValue(0, 1, 1, 'a', '');
    ledger.recordOp(0, { type: 'insertRowAbove', index: 1 });
    const { mark } = ledger.takePayload(0);
    ledger.settleSaved(mark);
    assert.equal(ledger.isDirty(), false);
});

test('edits on one sheet stay with that sheet when another sheet is saved (bug: edits went to the wrong sheet)', () => {
    const ledger = new PendingEdits();
    ledger.recordValue(0, 1, 1, 'on sheet 1', '');
    ledger.recordValue(1, 1, 1, 'on sheet 2', '');
    const { mark } = ledger.takePayload(1);
    ledger.settleSaved(mark);
    assert.deepEqual(ledger.dirtySheets(), [0]);
    assert.deepEqual(ledger.takePayload(0).payload.edits, [{ row: 1, col: 1, value: 'on sheet 1' }]);
});

test('recording a structure op shifts the pending entries the way the host shifts the file', () => {
    const ledger = new PendingEdits();
    ledger.recordValue(0, 3, 1, 'below', '');
    ledger.recordValue(0, 1, 1, 'above', '');
    ledger.recordStyle(0, { row: 3, col: 2, fontWeight: 'bold' });
    ledger.recordOp(0, { type: 'insertRowAbove', index: 2 });
    const { payload } = ledger.takePayload(0);
    assert.deepEqual(payload.edits.sort((a, b) => a.row - b.row), [{ row: 1, col: 1, value: 'above' }, { row: 4, col: 1, value: 'below' }]);
    assert.deepEqual(payload.styleEdits, [{ row: 4, col: 2, fontWeight: 'bold' }]);
});

test('deleting a row drops the pending edits in it', () => {
    const ledger = new PendingEdits();
    ledger.recordValue(0, 2, 1, 'gone', '');
    ledger.recordValue(0, 3, 1, 'kept', '');
    ledger.recordOp(0, { type: 'deleteRow', index: 2 });
    assert.deepEqual(ledger.takePayload(0).payload.edits, [{ row: 2, col: 1, value: 'kept' }]);
});

test('remapAddress covers rows, columns and single-cell shifts', () => {
    assert.deepEqual(remapAddress({ row: 2, col: 2 }, { type: 'insertRowBelow', index: 2 }), { row: 2, col: 2 });
    assert.deepEqual(remapAddress({ row: 3, col: 2 }, { type: 'insertRowBelow', index: 2 }), { row: 4, col: 2 });
    assert.deepEqual(remapAddress({ row: 2, col: 2 }, { type: 'insertColumnLeft', index: 2 }), { row: 2, col: 3 });
    assert.equal(remapAddress({ row: 2, col: 2 }, { type: 'deleteColumn', index: 2 }), null);
    assert.deepEqual(remapAddress({ row: 2, col: 4 }, { type: 'deleteColumn', index: 2 }), { row: 2, col: 3 });
    assert.deepEqual(remapAddress({ row: 2, col: 4 }, { type: 'insertCellShiftRight', row: 2, col: 3 }), { row: 2, col: 5 });
    assert.deepEqual(remapAddress({ row: 3, col: 4 }, { type: 'insertCellShiftRight', row: 2, col: 3 }), { row: 3, col: 4 });
    assert.deepEqual(remapAddress({ row: 5, col: 3 }, { type: 'deleteCellShiftUp', row: 2, col: 3 }), { row: 4, col: 3 });
    assert.equal(remapAddress({ row: 2, col: 3 }, { type: 'deleteCellShiftLeft', row: 2, col: 3 }), null);
    assert.deepEqual(remapAddress({ row: 7, col: 7 }, { type: 'mergeRange', startRow: 1, startCol: 1, endRow: 2, endCol: 2 }), { row: 7, col: 7 });
});

test('overlayRows puts pending values back on rows fetched again (bug: an edited cell lost its edit when scrolled away and back)', () => {
    const ledger = new PendingEdits();
    ledger.recordValue(0, 2, 1, 'edited', 'disk');
    const rows: Array<{ rowNumber: number; cells: Array<{ rowNumber: number; colNumber: number; value: string; checkboxChecked?: boolean }> }> = [
        { rowNumber: 1, cells: [{ rowNumber: 1, colNumber: 1, value: 'a' }] },
        { rowNumber: 2, cells: [{ rowNumber: 2, colNumber: 1, value: 'disk', checkboxChecked: false }] },
    ];
    ledger.overlayRows(0, rows);
    assert.equal(rows[0].cells[0].value, 'a');
    assert.equal(rows[1].cells[0].value, 'edited');
    ledger.recordValue(0, 2, 1, 'TRUE', 'disk');
    ledger.overlayRows(0, rows);
    assert.equal(rows[1].cells[0].checkboxChecked, true);
});

test('overlayRows ignores other sheets and creates a missing cell', () => {
    const ledger = new PendingEdits();
    ledger.recordValue(1, 1, 2, 'x', '');
    const rows = [{ rowNumber: 1, cells: [] as any[] }];
    ledger.overlayRows(0, rows);
    assert.equal(rows[0].cells.length, 0);
    ledger.overlayRows(1, rows);
    assert.equal(rows[0].cells[0].value, 'x');
});

test('snapshot and restore bring back an earlier ledger, including ops', () => {
    const ledger = new PendingEdits();
    ledger.recordValue(0, 1, 1, 'a', '');
    const before = ledger.snapshot(0);
    ledger.recordOp(0, { type: 'insertRowAbove', index: 1 });
    ledger.recordValue(0, 5, 5, 'b', '');
    ledger.restore(0, before);
    const { payload } = ledger.takePayload(0);
    assert.deepEqual(payload.edits, [{ row: 1, col: 1, value: 'a' }]);
    assert.equal(payload.operations.length, 0);
    ledger.restore(0, { values: [], rich: [], styles: [], ops: [] });
    assert.equal(ledger.isDirty(), false);
});
