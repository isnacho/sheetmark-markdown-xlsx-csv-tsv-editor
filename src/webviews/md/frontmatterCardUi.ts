import type { FrontmatterFieldRow } from './frontmatter';
import { applyRowEditsToParsed, formatFrontmatterBlock } from './frontmatter';

export interface FrontmatterCardOptions {
    rows: readonly FrontmatterFieldRow[];
    parsed: Record<string, unknown>;
    collapsed: boolean;
    editing: boolean;
    onCollapsedChange: (collapsed: boolean) => void;
    onEditingChange: (editing: boolean) => void;
    onSave: (block: string) => void;
}

function buildReadOnlyField(row: FrontmatterFieldRow): HTMLElement {
    const field = document.createElement('div');
    field.className = 'yaml-frontmatter-field';
    if (row.kind === 'array') { field.classList.add('yaml-frontmatter-field-array'); }
    if (row.kind === 'object') { field.classList.add('yaml-frontmatter-field-object'); }
    field.style.paddingLeft = `${row.depth * 16}px`;

    const key = document.createElement('span');
    key.className = 'yaml-frontmatter-key';
    key.textContent = row.key;
    field.appendChild(key);

    if (row.kind === 'array' && row.chips?.length) {
        const chips = document.createElement('span');
        chips.className = 'yaml-frontmatter-chips';
        for (const chip of row.chips) {
            const chipEl = document.createElement('span');
            chipEl.className = 'yaml-frontmatter-chip';
            chipEl.textContent = chip;
            chips.appendChild(chipEl);
        }
        field.appendChild(chips);
    } else if (row.kind !== 'object') {
        const value = document.createElement('span');
        value.className = 'yaml-frontmatter-value';
        value.textContent = row.displayValue;
        field.appendChild(value);
    }

    return field;
}

function buildEditableField(row: FrontmatterFieldRow): HTMLElement | null {
    if (row.kind === 'object') {
        return buildReadOnlyField(row);
    }

    const field = document.createElement('label');
    field.className = 'yaml-frontmatter-field yaml-frontmatter-field-editable';
    field.style.paddingLeft = `${row.depth * 16}px`;
    field.dataset.keyPath = row.keyPath.join('.');

    const key = document.createElement('span');
    key.className = 'yaml-frontmatter-key';
    key.textContent = row.key;
    field.appendChild(key);

    const input = document.createElement('input');
    input.type = 'text';
    input.spellcheck = false;
    input.className = 'yaml-frontmatter-input';
    input.value = row.kind === 'array' ? (row.chips?.join(', ') ?? '') : row.displayValue;
    if (row.kind === 'array') {
        input.placeholder = 'comma-separated values';
    }
    field.appendChild(input);

    return field;
}

function collectEditedValues(body: HTMLElement, rows: readonly FrontmatterFieldRow[]): Map<string, string> {
    const values = new Map<string, string>();
    for (const row of rows) {
        if (row.kind === 'object') { continue; }
        const path = row.keyPath.join('.');
        const label = body.querySelector(`label.yaml-frontmatter-field-editable[data-key-path="${path}"]`);
        const input = label?.querySelector('input.yaml-frontmatter-input');
        if (input instanceof HTMLInputElement) {
            values.set(path, input.value);
        }
    }
    return values;
}

function wireCardButtons(card: HTMLElement, opts: FrontmatterCardOptions): void {
    const toggleBtn = card.querySelector('.yaml-frontmatter-toggle');
    const editBtn = card.querySelector('.yaml-frontmatter-edit-btn');
    const header = card.querySelector('.yaml-frontmatter-header');

    const setCollapsed = (collapsed: boolean) => {
        card.classList.toggle('yaml-frontmatter-collapsed', collapsed);
        if (header instanceof HTMLElement) {
            header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        }
        opts.onCollapsedChange(collapsed);
    };

    const setEditing = (editing: boolean) => {
        card.classList.toggle('yaml-frontmatter-editing', editing);
        if (editBtn instanceof HTMLButtonElement) {
            editBtn.textContent = editing ? 'Done' : 'Edit';
        }
        if (editing) {
            setCollapsed(false);
        }
        rebuildBody(card, opts, editing);
        opts.onEditingChange(editing);
    };

    const stopEditor = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
    };

    toggleBtn?.addEventListener('mousedown', stopEditor);
    toggleBtn?.addEventListener('click', (event) => {
        stopEditor(event);
        if (card.classList.contains('yaml-frontmatter-editing')) { return; }
        setCollapsed(!card.classList.contains('yaml-frontmatter-collapsed'));
    });

    editBtn?.addEventListener('mousedown', stopEditor);
    editBtn?.addEventListener('click', (event) => {
        stopEditor(event);
        if (card.classList.contains('yaml-frontmatter-editing')) {
            const body = card.querySelector('.yaml-frontmatter-body');
            if (!(body instanceof HTMLElement)) { return; }
            const values = collectEditedValues(body, opts.rows);
            const nextParsed = structuredClone(opts.parsed);
            applyRowEditsToParsed(nextParsed, opts.rows, values);
            opts.onSave(formatFrontmatterBlock(nextParsed));
            setEditing(false);
        } else {
            setEditing(true);
        }
    });
}

function rebuildBody(card: HTMLElement, opts: FrontmatterCardOptions, editing: boolean): void {
    let body = card.querySelector('.yaml-frontmatter-body');
    if (!(body instanceof HTMLElement)) {
        body = document.createElement('div');
        body.className = 'yaml-frontmatter-body';
        card.appendChild(body);
    }
    body.innerHTML = '';
    for (const row of opts.rows) {
        const field = editing ? buildEditableField(row) : buildReadOnlyField(row);
        if (field) { body.appendChild(field); }
    }
}

export function createFrontmatterCardElement(opts: FrontmatterCardOptions): HTMLElement {
    const card = document.createElement('div');
    card.className = 'yaml-frontmatter-card cm-md-frontmatter-widget';
    if (opts.collapsed) { card.classList.add('yaml-frontmatter-collapsed'); }
    if (opts.editing) { card.classList.add('yaml-frontmatter-editing'); }

    const header = document.createElement('div');
    header.className = 'yaml-frontmatter-header';
    header.setAttribute('aria-expanded', opts.collapsed ? 'false' : 'true');

    const title = document.createElement('span');
    title.className = 'yaml-frontmatter-title';
    title.textContent = 'YAML';
    header.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'yaml-frontmatter-header-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'yaml-frontmatter-edit-btn';
    editBtn.textContent = opts.editing ? 'Done' : 'Edit';
    actions.appendChild(editBtn);

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'yaml-frontmatter-toggle';
    toggleBtn.setAttribute('aria-label', 'Expand or collapse YAML panel');
    const chevron = document.createElement('span');
    chevron.className = 'yaml-frontmatter-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    toggleBtn.appendChild(chevron);
    actions.appendChild(toggleBtn);

    header.appendChild(actions);
    card.appendChild(header);

    rebuildBody(card, opts, opts.editing);
    wireCardButtons(card, opts);

    return card;
}
