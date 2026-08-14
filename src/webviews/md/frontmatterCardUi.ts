import type { FrontmatterFieldRow } from './frontmatter';
import { wrapFrontmatterYaml } from './frontmatter';

export interface FrontmatterCardOptions {
    yamlText: string;
    rows: readonly FrontmatterFieldRow[];
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

function fitTextareaHeight(textarea: HTMLTextAreaElement): void {
    textarea.style.height = '0';
    textarea.style.height = `${textarea.scrollHeight}px`;
}

function buildEditableCode(yamlText: string): HTMLTextAreaElement {
    const textarea = document.createElement('textarea');
    textarea.className = 'yaml-frontmatter-textarea';
    textarea.spellcheck = false;
    textarea.value = yamlText;
    textarea.rows = 1;
    textarea.addEventListener('input', () => fitTextareaHeight(textarea));
    requestAnimationFrame(() => fitTextareaHeight(textarea));
    return textarea;
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
            const textarea = body?.querySelector('textarea.yaml-frontmatter-textarea');
            if (textarea instanceof HTMLTextAreaElement) {
                opts.onSave(wrapFrontmatterYaml(textarea.value));
            }
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
    body.classList.toggle('yaml-frontmatter-body-editing', editing);

    if (editing) {
        const textarea = buildEditableCode(opts.yamlText);
        body.appendChild(textarea);
        textarea.focus();
        return;
    }

    for (const row of opts.rows) {
        body.appendChild(buildReadOnlyField(row));
    }
}

export function createFrontmatterCardElement(opts: FrontmatterCardOptions): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-md-frontmatter-widget';

    const card = document.createElement('div');
    card.className = 'yaml-frontmatter-card';
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

    const spacer = document.createElement('div');
    spacer.className = 'yaml-frontmatter-tail-spacer';
    spacer.setAttribute('aria-hidden', 'true');

    wrap.appendChild(card);
    wrap.appendChild(spacer);
    return wrap;
}
