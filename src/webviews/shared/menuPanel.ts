/** Shared markup helpers for menu-panel rows (settings gear panel, slash menu icons, …). */

export function escapeMenuHtml(input: string): string {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function renderMenuIcon(iconSvg: string): string {
    return `<span class="menu-row__icon cm-slash-menu-icon" aria-hidden="true">${iconSvg}</span>`;
}

export function renderMenuCheckboxRow(options: {
    id: string;
    label: string;
    tooltip?: string;
    inputType?: 'checkbox' | 'radio';
    groupName?: string;
    value?: string;
    className?: string;
}): string {
    const safeId = escapeMenuHtml(options.id);
    const safeLabel = escapeMenuHtml(options.label);
    const tooltip = options.tooltip && options.tooltip.trim().length > 0 ? options.tooltip : options.label;
    const safeTooltip = escapeMenuHtml(tooltip);
    const inputType = options.inputType === 'radio' ? 'radio' : 'checkbox';
    const safeGroupName = escapeMenuHtml(options.groupName || '');
    const safeValue = escapeMenuHtml(options.value || '');
    const safeClassName = escapeMenuHtml((options.className || '').trim());
    const groupAttr = inputType === 'radio' && safeGroupName ? ` name="${safeGroupName}"` : '';
    const valueAttr = inputType === 'radio' ? ` value="${safeValue}"` : '';
    const extraClass = safeClassName ? ` ${safeClassName}` : '';
    return `<label class="menu-row setting-item tooltip${extraClass}"><input type="${inputType}" id="${safeId}"${groupAttr}${valueAttr}/> <span>${safeLabel}</span><span class="tooltiptext hidden">${safeTooltip}</span></label>`;
}

export function renderMenuActionRow(options: {
    id: string;
    label: string;
    title?: string;
    trailingHtml: string;
}): string {
    const safeId = escapeMenuHtml(options.id);
    const safeLabel = escapeMenuHtml(options.label);
    const safeTitle = escapeMenuHtml(options.title || options.label);
    return `<button type="button" id="${safeId}" class="menu-row menu-row--action setting-item setting-action-btn" title="${safeTitle}"><span>${safeLabel}</span>${options.trailingHtml}</button>`;
}

export function renderMenuSelectRow(options: {
    selectId: string;
    label: string;
    choices: Array<{ value: string; label: string }>;
    title?: string;
}): string {
    const safeSelectId = escapeMenuHtml(options.selectId);
    const safeLabel = escapeMenuHtml(options.label);
    const safeTitle = escapeMenuHtml(options.title || options.label);
    const optionHtml = options.choices
        .map((choice) => `<option value="${escapeMenuHtml(choice.value)}">${escapeMenuHtml(choice.label)}</option>`)
        .join('');
    return `<div class="menu-row menu-row--control setting-item theme-setting-item"><span>${safeLabel}</span><select id="${safeSelectId}" class="theme-select" title="${safeTitle}">${optionHtml}</select></div>`;
}

export function renderMenuSection(title: string, rowsHtml: string): string {
    return `<div class="menu-panel__section settings-section"><div class="menu-panel__section-title settings-section-title">${escapeMenuHtml(title)}</div>${rowsHtml}</div>`;
}

export function renderMenuPanelShell(options: {
    title: string;
    titleId: string;
    closeId: string;
    closeIconHtml: string;
    bodyHtml: string;
}): string {
    const safeTitle = escapeMenuHtml(options.title);
    const safeTitleId = escapeMenuHtml(options.titleId);
    const safeCloseId = escapeMenuHtml(options.closeId);
    return `<div class="menu-panel__header settings-header"><span id="${safeTitleId}" class="menu-panel__title settings-title">${safeTitle}</span><button id="${safeCloseId}" class="settings-close-btn" type="button" title="Close" aria-label="Close">${options.closeIconHtml}</button></div><div class="menu-panel__body settings-scroll">${options.bodyHtml}</div>`;
}

export function groupMenuSections<T extends { section?: string }>(items: T[]): Array<{ name?: string; items: T[] }> {
    const sections: Array<{ name?: string; items: T[] }> = [];
    items.forEach((item) => {
        const sectionName = item.section;
        const last = sections[sections.length - 1];
        if (last && last.name === sectionName) {
            last.items.push(item);
            return;
        }
        sections.push({ name: sectionName, items: [item] });
    });
    return sections;
}
