import * as vscode from 'vscode';

export type SheetmarkAssociationType = 'xlsx' | 'csv' | 'tsv' | 'md';

export const SHEETMARK_ASSOCIATION_TYPES: SheetmarkAssociationType[] = ['md', 'xlsx', 'csv', 'tsv'];

const ASSOCIATION_META: Record<SheetmarkAssociationType, { viewType: string; pattern: string; label: string }> = {
    md: { viewType: 'xlsxViewer.md', pattern: '*.md', label: 'Markdown' },
    xlsx: { viewType: 'xlsxViewer.xlsx', pattern: '*.xlsx', label: 'XLSX' },
    csv: { viewType: 'xlsxViewer.csv', pattern: '*.csv', label: 'CSV' },
    tsv: { viewType: 'xlsxViewer.tsv', pattern: '*.tsv', label: 'TSV' },
};

export function getEditorAssociations(): unknown {
    return vscode.workspace.getConfiguration('workbench').get('editorAssociations');
}

export function isSheetmarkDefaultEditor(associations: unknown, type: SheetmarkAssociationType): boolean {
    const meta = ASSOCIATION_META[type];
    const directPattern = meta.pattern;
    const recursivePattern = `**/${meta.pattern}`;

    if (!associations) {
        return false;
    }

    if (Array.isArray(associations)) {
        return associations.some((entry: { viewType?: string; filenamePattern?: string }) =>
            entry?.viewType === meta.viewType &&
            (entry?.filenamePattern === directPattern || entry?.filenamePattern === recursivePattern)
        );
    }

    const map = associations as Record<string, string>;
    return map[directPattern] === meta.viewType || map[recursivePattern] === meta.viewType;
}

export function isOpenByDefaultSettingEnabled(type: SheetmarkAssociationType): boolean {
    return vscode.workspace.getConfiguration('xlsxViewer').get<boolean>(`${type}.openByDefault`, false);
}

/** True when Sheetmark is the default editor for a file type (association or openByDefault setting). */
export function isSheetmarkConfiguredAsDefault(type: SheetmarkAssociationType): boolean {
    return isSheetmarkDefaultEditor(getEditorAssociations(), type)
        || isOpenByDefaultSettingEnabled(type);
}

export async function setOpenByDefaultSetting(type: SheetmarkAssociationType, enabled: boolean): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('xlsxViewer');
    const current = cfg.get<boolean>(`${type}.openByDefault`, false);
    if (current === enabled) {
        return;
    }
    await cfg.update(`${type}.openByDefault`, enabled, vscode.ConfigurationTarget.Global);
}

export async function setEditorAssociation(
    type: SheetmarkAssociationType,
    enable: boolean,
    options?: { showToast?: boolean }
): Promise<void> {
    const showToast = options?.showToast !== false;
    const meta = ASSOCIATION_META[type];
    const cfg = vscode.workspace.getConfiguration();
    const associations: unknown = cfg.get('workbench.editorAssociations') || {};

    if (isSheetmarkDefaultEditor(associations, type) === enable) {
        return;
    }

    if (enable) {
        let newAssociations: unknown;
        if (Array.isArray(associations)) {
            newAssociations = (associations as Array<{ viewType?: string; filenamePattern?: string }>)
                .filter(entry => entry.filenamePattern !== meta.pattern && entry.filenamePattern !== `**/${meta.pattern}`);
            (newAssociations as Array<{ viewType: string; filenamePattern: string }>).push({
                viewType: meta.viewType,
                filenamePattern: meta.pattern,
            });
        } else {
            newAssociations = { ...(associations as Record<string, string>) };
            (newAssociations as Record<string, string>)[meta.pattern] = meta.viewType;
        }
        await cfg.update('workbench.editorAssociations', newAssociations, vscode.ConfigurationTarget.Global);
        if (showToast) {
            vscode.window.showInformationMessage(`Sheetmark is now set as the default editor for ${meta.label} files.`);
        }
        return;
    }

    const inspect = cfg.inspect('workbench.editorAssociations');
    const targets: Array<{ target: vscode.ConfigurationTarget; value: unknown }> = [
        { target: vscode.ConfigurationTarget.Global, value: inspect?.globalValue },
        { target: vscode.ConfigurationTarget.Workspace, value: inspect?.workspaceValue },
        { target: vscode.ConfigurationTarget.WorkspaceFolder, value: inspect?.workspaceFolderValue },
    ];

    for (const t of targets) {
        if (!t.value) {
            continue;
        }

        let newAssociations: unknown;
        if (Array.isArray(t.value)) {
            newAssociations = (t.value as Array<{ viewType?: string }>).filter(entry => entry.viewType !== meta.viewType);
        } else {
            newAssociations = { ...(t.value as Record<string, string>) };
            Object.keys(newAssociations as Record<string, string>).forEach(key => {
                if ((newAssociations as Record<string, string>)[key] === meta.viewType) {
                    delete (newAssociations as Record<string, string>)[key];
                }
            });
        }

        await cfg.update('workbench.editorAssociations', newAssociations, t.target);
    }

    if (showToast) {
        vscode.window.showInformationMessage(`${meta.label} association has been removed from settings.`);
    }
}

export async function syncOpenByDefaultFromSetting(type: SheetmarkAssociationType): Promise<void> {
    const desired = isOpenByDefaultSettingEnabled(type);
    const current = isSheetmarkDefaultEditor(getEditorAssociations(), type);
    if (desired === current) {
        return;
    }
    await setEditorAssociation(type, desired, { showToast: true });
}

export async function reconcileAllOpenByDefaultSettings(): Promise<void> {
    for (const type of SHEETMARK_ASSOCIATION_TYPES) {
        if (!isOpenByDefaultSettingEnabled(type)) {
            continue;
        }
        if (!isSheetmarkDefaultEditor(getEditorAssociations(), type)) {
            await setEditorAssociation(type, true, { showToast: false });
        }
    }
}

export async function enableOpenByDefault(type: SheetmarkAssociationType, options?: { showToast?: boolean }): Promise<void> {
    await setEditorAssociation(type, true, options);
    await setOpenByDefaultSetting(type, true);
}

export async function disableOpenByDefault(type: SheetmarkAssociationType, options?: { showToast?: boolean }): Promise<void> {
    await setEditorAssociation(type, false, options);
    await setOpenByDefaultSetting(type, false);
}
