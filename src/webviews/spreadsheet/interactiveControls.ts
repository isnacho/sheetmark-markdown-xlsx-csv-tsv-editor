// Interactive cell controls (checkbox, dropdown, rating, date): enabling them for the current mode,
// updating their presentation after a value change, the Insert Control and dropdown-options popups,
// and inserting a control into the selection. Runtime: WEBVIEW (browser).

import { Utils } from '../shared/utils';
import { state } from './state';
import { getCellNormalizedValue, getCellType, getOrCreateRowCellData, normalizeCellText, normalizeDateInputValue, normalizeRatingValue, parseBooleanCellValue } from './cellValues';
import { scheduleAutoSave } from './persistence';
import { renderDropdownCellContent } from './components/spreadsheetRenderComponent';
import type { InsertControlType } from './components/spreadsheetTypes';
import { captureWorksheetStateSnapshot, pushSheetUndoEntry } from './undo';

const showToast = Utils.showToast;

/** What inserting controls needs from the rest of the webview (still in spreadsheetWebview.ts). */
export interface InteractiveControlHooks {
    getLogicalSelectionBounds(): { minRow: number; maxRow: number; minCol: number; maxCol: number } | null;
    ensureAllRowsLoadedForStructureEdits(withOverlay?: boolean): Promise<boolean>;
}

let hooks: InteractiveControlHooks;

/** Call once at startup, before any edit. */
export function initInteractiveControls(h: InteractiveControlHooks): void {
    hooks = h;
}

export const DEFAULT_DROPDOWN_OPTIONS_TEMPLATE = 'Option 1\nOption 2\nOption 3';

export function ensureInsertControlPopup() {
    if (state.insertControlPopupEl) {
        return state.insertControlPopupEl;
    }

    const popup = document.createElement('div');
    popup.id = 'xlsxInsertControlPopup';
    popup.className = 'xlsx-insert-control-popup hidden';
    popup.innerHTML = `
        <div class="insert-control-title">Insert into selected cells</div>
        <button type="button" class="insert-control-item" data-control-type="checkbox">Checkbox</button>
        <button type="button" class="insert-control-item" data-control-type="dropdown">Dropdown</button>
        <button type="button" class="insert-control-item" data-control-type="rating">Stars (Rating)</button>
        <button type="button" class="insert-control-item" data-control-type="date">Date</button>
    `;

    popup.querySelectorAll('.insert-control-item').forEach((item) => {
        item.addEventListener('click', async (event) => {
            event.stopPropagation();
            const btn = item as HTMLButtonElement;
            const type = (btn.getAttribute('data-control-type') || '') as InsertControlType;
            if (!type) {return;}
            await insertControlIntoSelection(type);
        });
    });

    document.body.appendChild(popup);
    state.insertControlPopupEl = popup;
    return popup;
}

export function hideInsertControlPopup() {
    if (!state.insertControlPopupEl) {return;}
    state.insertControlPopupEl.classList.add('hidden');
}

export function showInsertControlPopup(anchor: HTMLElement) {
    if (!state.isEditMode) {
        showToast('Enter edit mode to insert controls');
        return;
    }

    const popup = ensureInsertControlPopup();
    popup.classList.remove('hidden');

    const rect = anchor.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - popupRect.width - 8);
    const top = Math.min(rect.bottom + 6, window.innerHeight - popupRect.height - 8);
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
}

export function parseDropdownOptionsInput(raw: string): string[] {
    return raw
        .split(/[\n,;|]+/)
        .map((item) => item.trim())
        .filter((item, idx, arr) => item.length > 0 && arr.indexOf(item) === idx)
        .slice(0, 80);
}

export function hideDropdownOptionsPopup(options: string[] | null = null) {
    if (!state.dropdownOptionsPopupEl) {return;}
    state.dropdownOptionsPopupEl.classList.add('hidden');

    const resolver = state.dropdownOptionsResolver;
    state.dropdownOptionsResolver = null;
    if (resolver) {
        resolver(options);
    }
}

export function ensureDropdownOptionsPopup() {
    if (state.dropdownOptionsPopupEl) {
        return state.dropdownOptionsPopupEl;
    }

    const popup = document.createElement('div');
    popup.id = 'xlsxDropdownOptionsPopup';
    popup.className = 'xlsx-dropdown-options-popup hidden';
    popup.innerHTML = `
        <div class="xlsx-dropdown-options-dialog" role="dialog" aria-modal="true" aria-labelledby="dropdownOptionsTitle">
            <div id="dropdownOptionsTitle" class="dropdown-options-title">Dropdown options</div>
            <div class="dropdown-options-message">Enter one option per line. Comma, semicolon, and | are also supported.</div>
            <textarea id="dropdownOptionsInput" class="dropdown-options-input" spellcheck="false"></textarea>
            <div class="dropdown-options-actions">
                <button id="dropdownOptionsCancel" type="button" class="toggle-button">Cancel</button>
                <button id="dropdownOptionsInsert" type="button" class="toggle-button">Insert</button>
            </div>
        </div>
    `;

    popup.addEventListener('click', (event) => {
        if (event.target === popup) {
            hideDropdownOptionsPopup(null);
        }
    });

    const cancelBtn = popup.querySelector('#dropdownOptionsCancel') as HTMLButtonElement | null;
    const insertBtn = popup.querySelector('#dropdownOptionsInsert') as HTMLButtonElement | null;
    const input = popup.querySelector('#dropdownOptionsInput') as HTMLTextAreaElement | null;

    cancelBtn?.addEventListener('click', () => {
        hideDropdownOptionsPopup(null);
    });

    insertBtn?.addEventListener('click', () => {
        const options = parseDropdownOptionsInput(input?.value || '');
        if (!options.length) {
            showToast('Add at least one dropdown option');
            input?.focus();
            return;
        }
        hideDropdownOptionsPopup(options);
    });

    input?.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            insertBtn?.click();
        }
    });

    document.body.appendChild(popup);
    state.dropdownOptionsPopupEl = popup;
    return popup;
}

export async function promptDropdownOptions(initialOptions: string[] = [], confirmLabel: string = 'Insert'): Promise<string[] | null> {
    if (state.dropdownOptionsResolver) {
        state.dropdownOptionsResolver(null);
        state.dropdownOptionsResolver = null;
    }

    const popup = ensureDropdownOptionsPopup();
    const input = popup.querySelector('#dropdownOptionsInput') as HTMLTextAreaElement | null;
    const confirmButton = popup.querySelector('#dropdownOptionsInsert') as HTMLButtonElement | null;
    if (input) {
        const seed = initialOptions
            .map((item) => String(item || '').trim())
            .filter((item, idx, arr) => item.length > 0 && arr.indexOf(item) === idx)
            .slice(0, 80);
        input.value = seed.length ? seed.join('\n') : DEFAULT_DROPDOWN_OPTIONS_TEMPLATE;
    }

    if (confirmButton) {
        confirmButton.textContent = confirmLabel;
    }

    popup.classList.remove('hidden');

    requestAnimationFrame(() => {
        input?.focus();
        input?.select();
    });

    return await new Promise<string[] | null>((resolve) => {
        state.dropdownOptionsResolver = resolve;
    });
}

export function getDropdownOptionsFromCell(cell: HTMLElement): string[] {
    const select = cell.querySelector('.xlsx-cell-dropdown') as HTMLSelectElement | null;
    if (!select) {
        return [];
    }

    const unique = new Set<string>();
    Array.from(select.options).forEach((opt) => {
        const text = String(opt.value || '').trim();
        if (text) {
            unique.add(text);
        }
    });
    return Array.from(unique.values()).slice(0, 80);
}

export async function editDropdownOptionsForCell(cell: HTMLElement) {
    if (!state.isEditMode) {
        showToast('Enter edit mode to edit dropdown options');
        return;
    }

    if (getCellType(cell) !== 'dropdown') {
        return;
    }

    const row = parseInt(cell.getAttribute('data-row') || '-1', 10);
    const col = parseInt(cell.getAttribute('data-col') || '-1', 10);
    if (row < 0 || col < 0) {
        return;
    }

    const cellData = getOrCreateRowCellData(row, col);
    const existingOptions = Array.isArray(cellData.dropdownOptions) && cellData.dropdownOptions.length
        ? cellData.dropdownOptions.map((item: any) => String(item || '').trim()).filter((item: string) => !!item)
        : getDropdownOptionsFromCell(cell);

    const configuredOptions = await promptDropdownOptions(existingOptions, 'Apply');
    if (!configuredOptions || !configuredOptions.length) {
        return;
    }

    const beforeSnapshot = captureWorksheetStateSnapshot();
    const currentValue = getCellNormalizedValue(cell);
    const nextValue = configuredOptions.includes(currentValue) ? currentValue : configuredOptions[0];

    cellData.cellType = 'dropdown';
    cellData.dropdownOptions = [...configuredOptions];
    cellData.value = nextValue;

    const rowNumber = row + 1;
    const colNumber = col + 1;

    state.pendingWorksheetOps.push({
        type: 'insertControl',
        row: rowNumber,
        col: colNumber,
        controlType: 'dropdown',
        dropdownOptions: [...configuredOptions],
        defaultValue: nextValue
    });

    cell.innerHTML = renderDropdownCellContent({
        options: configuredOptions,
        selectedValue: nextValue,
        allowInteractiveControls: areInteractiveControlsEnabled(),
        showEditButton: state.isEditMode
    });
    updateDropdownCellPresentation(cell, nextValue);
    applyInteractiveControlState(cell);

    const afterSnapshot = captureWorksheetStateSnapshot();
    pushSheetUndoEntry(beforeSnapshot, afterSnapshot);
    scheduleAutoSave('control');
    showToast('Dropdown options updated');
}

export function getTodayIsoDate(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

export function createInsertedControlInnerHtml(controlType: InsertControlType, defaultValue: string, dropdownOptions: string[]): string {
    if (controlType === 'checkbox') {
        const checked = parseBooleanCellValue(defaultValue);
        return `<span class="cell-content cell-checkbox-content"><input type="checkbox" class="xlsx-cell-checkbox" aria-label="Cell checkbox"${checked ? ' checked' : ''} /><span class="checkbox-value">${checked ? 'TRUE' : 'FALSE'}</span></span>`;
    }

    if (controlType === 'dropdown') {
        const safeDefault = defaultValue || (dropdownOptions[0] || '');
        return renderDropdownCellContent({
            options: dropdownOptions,
            selectedValue: safeDefault,
            allowInteractiveControls: true,
            showEditButton: state.isEditMode
        });
    }

    if (controlType === 'rating') {
        const rating = normalizeRatingValue(defaultValue);
        let stars = '';
        for (let i = 1; i <= 5; i++) {
            stars += `<button type="button" class="xlsx-rating-star${i <= rating ? ' active' : ''}" data-rating-value="${i}" aria-label="Rate ${i} of 5">★</button>`;
        }
        return `<span class="cell-content cell-rating-content" data-rating-value="${rating}">${stars}<span class="rating-value">${rating || ''}</span></span>`;
    }

    const normalized = normalizeDateInputValue(defaultValue);
    const valueAttr = normalized ? ` value="${Utils.escapeHtml(normalized)}"` : '';
    return `<span class="cell-content cell-date-content"><input type="date" class="xlsx-cell-date" aria-label="Cell date"${valueAttr} /></span>`;
}

export function applyInsertedControlToDomCell(cell: HTMLElement, controlType: InsertControlType, defaultValue: string, dropdownOptions: string[]) {
    cell.setAttribute('data-cell-type', controlType);
    cell.removeAttribute('data-checkbox-checked');
    cell.removeAttribute('data-dropdown-value');
    cell.removeAttribute('data-rating-value');
    cell.removeAttribute('data-date-value');

    cell.innerHTML = createInsertedControlInnerHtml(controlType, defaultValue, dropdownOptions);

    if (controlType === 'checkbox') {
        cell.setAttribute('data-checkbox-checked', parseBooleanCellValue(defaultValue) ? 'true' : 'false');
    }

    if (controlType === 'dropdown') {
        const nextValue = defaultValue || (dropdownOptions[0] || '');
        cell.setAttribute('data-dropdown-value', nextValue);
        const select = cell.querySelector('.xlsx-cell-dropdown') as HTMLSelectElement | null;
        if (select) {
            select.value = nextValue;
        }
    }

    if (controlType === 'rating') {
        cell.setAttribute('data-rating-value', String(normalizeRatingValue(defaultValue)));
    }

    if (controlType === 'date') {
        cell.setAttribute('data-date-value', normalizeDateInputValue(defaultValue));
    }
}

export async function insertControlIntoSelection(controlType: InsertControlType) {
    hideInsertControlPopup();

    if (!state.isEditMode) {
        showToast('Enter edit mode to insert controls');
        return;
    }

    const bounds = hooks.getLogicalSelectionBounds();
    if (!bounds) {
        showToast('Select one or more cells first');
        return;
    }

    const cellCount = (bounds.maxRow - bounds.minRow + 1) * (bounds.maxCol - bounds.minCol + 1);
    if (cellCount > 50000) {
        showToast('Selection is too large for control insertion');
        return;
    }

    let dropdownOptions: string[] = [];
    let defaultValue = '';

    if (controlType === 'dropdown') {
        const configuredOptions = await promptDropdownOptions();
        if (!configuredOptions) {
            return;
        }

        dropdownOptions = configuredOptions;
        defaultValue = dropdownOptions[0];
    } else if (controlType === 'checkbox') {
        defaultValue = 'FALSE';
    } else if (controlType === 'rating') {
        defaultValue = '3';
    } else if (controlType === 'date') {
        defaultValue = getTodayIsoDate();
    }

    const loaded = await hooks.ensureAllRowsLoadedForStructureEdits(false);
    if (!loaded) {
        return;
    }

    const beforeSnapshot = captureWorksheetStateSnapshot();

    for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
        for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
            const rowNumber = r + 1;
            const colNumber = c + 1;

            const cellData = getOrCreateRowCellData(r, c);
            cellData.hyperlink = '';
            cellData.cellType = controlType;

            if (controlType === 'checkbox') {
                cellData.dropdownOptions = ['TRUE', 'FALSE'];
                cellData.checkboxChecked = false;
                cellData.value = 'FALSE';
            } else if (controlType === 'dropdown') {
                cellData.dropdownOptions = [...dropdownOptions];
                cellData.value = defaultValue;
            } else if (controlType === 'rating') {
                cellData.dropdownOptions = ['1', '2', '3', '4', '5'];
                cellData.value = defaultValue;
            } else if (controlType === 'date') {
                cellData.dropdownOptions = [];
                cellData.value = defaultValue;
            }

            state.pendingWorksheetOps.push({
                type: 'insertControl',
                row: rowNumber,
                col: colNumber,
                controlType,
                dropdownOptions: dropdownOptions.length ? [...dropdownOptions] : undefined,
                defaultValue
            });
        }
    }

    for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
        for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
            const domCell = document.querySelector(`td[data-row="${r}"][data-col="${c}"]`) as HTMLElement | null;
            if (!domCell) {continue;}
            applyInsertedControlToDomCell(domCell, controlType, defaultValue, dropdownOptions);
        }
    }

    const afterSnapshot = captureWorksheetStateSnapshot();
    pushSheetUndoEntry(beforeSnapshot, afterSnapshot);

    applyInteractiveControlState();
    showToast('Inserted control');
    scheduleAutoSave('control');
}

export function updateCheckboxCellPresentation(cell: HTMLElement, checked: boolean) {
    cell.setAttribute('data-checkbox-checked', checked ? 'true' : 'false');
    const checkbox = cell.querySelector('.xlsx-cell-checkbox') as HTMLInputElement | null;
    if (checkbox) {
        checkbox.checked = checked;
    }
    const valueLabel = cell.querySelector('.checkbox-value') as HTMLElement | null;
    if (valueLabel) {
        valueLabel.textContent = checked ? 'TRUE' : 'FALSE';
    }
}

export function updateDropdownCellPresentation(cell: HTMLElement, value: string) {
    const normalized = normalizeCellText(value || '');
    const select = cell.querySelector('.xlsx-cell-dropdown') as HTMLSelectElement | null;
    if (select) {
        select.value = normalized;
    }
    cell.setAttribute('data-dropdown-value', normalized);
}

export function updateRatingCellPresentation(cell: HTMLElement, rating: number) {
    const normalized = normalizeRatingValue(rating);
    cell.setAttribute('data-rating-value', String(normalized));

    const content = cell.querySelector('.cell-rating-content') as HTMLElement | null;
    if (content) {
        content.setAttribute('data-rating-value', String(normalized));
    }

    cell.querySelectorAll('.xlsx-rating-star').forEach((el) => {
        const star = el as HTMLButtonElement;
        const val = normalizeRatingValue(star.getAttribute('data-rating-value'));
        star.classList.toggle('active', val <= normalized && normalized > 0);
    });

    const label = cell.querySelector('.rating-value') as HTMLElement | null;
    if (label) {
        label.textContent = normalized > 0 ? String(normalized) : '';
    }
}

export function updateDateCellPresentation(cell: HTMLElement, value: string) {
    const normalized = normalizeDateInputValue(value);
    const dateInput = cell.querySelector('.xlsx-cell-date') as HTMLInputElement | null;
    if (dateInput) {
        dateInput.value = normalized;
    }
    cell.setAttribute('data-date-value', normalized);
}

export function canUseInteractiveControlsOutsideEditMode(): boolean {
    return !!state.currentSettings.allowInteractiveControlsOutsideEditMode && !state.isVersionPreviewMode;
}

export function areInteractiveControlsEnabled(): boolean {
    return state.isEditMode || canUseInteractiveControlsOutsideEditMode();
}

export function applyInteractiveControlState(root?: ParentNode | null) {
    const scope = root || document;
    const controlsEnabled = areInteractiveControlsEnabled();
    const outsideEditEnabled = !state.isEditMode && controlsEnabled;

    document.body.classList.toggle('controls-editable-outside-edit-mode', outsideEditEnabled);

    scope.querySelectorAll('.xlsx-cell-checkbox').forEach((el) => {
        const input = el as HTMLInputElement;
        input.disabled = !controlsEnabled;
    });

    scope.querySelectorAll('.xlsx-cell-dropdown').forEach((el) => {
        const select = el as HTMLSelectElement;
        select.disabled = !controlsEnabled;
    });

    scope.querySelectorAll('.xlsx-rating-star').forEach((el) => {
        const button = el as HTMLButtonElement;
        button.disabled = !controlsEnabled;
    });

    scope.querySelectorAll('.xlsx-cell-date').forEach((el) => {
        const input = el as HTMLInputElement;
        input.disabled = !controlsEnabled;
    });

    scope.querySelectorAll('.xlsx-dropdown-edit-button').forEach((el) => {
        const button = el as HTMLButtonElement;
        button.disabled = !state.isEditMode;
    });
}
