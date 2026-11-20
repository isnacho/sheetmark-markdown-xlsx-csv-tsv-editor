import { Icons } from '../../shared/icons';
import { ToolbarButton } from '../../shared/toolbarManager';

export interface CreateXlsxToolbarButtonsOptions {
    onFind: () => void;
    onSave: () => void;
    onUndo: () => void;
    onRedo: () => void;
    onToggleExpand: () => void;
    onVersionHistory: () => void;
    onOpenSettings: () => void;
    onHelp: () => void;
    onConvertFile: () => void;
    onRefresh: () => void;
}

export function createXlsxToolbarButtons(options: CreateXlsxToolbarButtonsOptions): ToolbarButton[] {
    return [
        {
            id: 'refreshButton',
            icon: Icons.Refresh,
            tooltip: 'Reload from Disk',
            cls: 'icon-only',
            onClick: options.onRefresh
        },
        {
            id: 'saveEditsButton',
            icon: Icons.Save,
            tooltip: 'Save Changes (Ctrl/Cmd+S)',
            cls: 'icon-only',
            onClick: options.onSave
        },
        {
            id: 'undoEditsButton',
            icon: Icons.Undo,
            tooltip: 'Undo (Ctrl/Cmd+Z)',
            cls: 'icon-only',
            onClick: options.onUndo
        },
        {
            id: 'redoEditsButton',
            icon: Icons.Redo,
            tooltip: 'Redo (Ctrl/Cmd+Shift+Z)',
            cls: 'icon-only',
            onClick: options.onRedo
        },
        {
            id: 'toggleExpandButton',
            icon: Icons.Expand,
            cls: 'icon-only',
            tooltip: 'Toggle Column Widths (Default / Expand All)',
            onClick: options.onToggleExpand
        },
        // Right end, in the Markdown toolbar's order: find first, settings last.
        {
            id: 'findButton',
            icon: Icons.Search,
            cls: 'icon-only',
            tooltip: 'Find in sheet (Ctrl/Cmd+F)',
            section: 'end',
            onClick: options.onFind
        },
        {
            id: 'versionHistoryButton',
            icon: Icons.VersionHistory,
            tooltip: 'Version history',
            cls: 'icon-only',
            section: 'end',
            onClick: options.onVersionHistory
        },
        {
            id: 'convertFileButton',
            icon: Icons.Convert,
            cls: 'icon-only',
            tooltip: 'Convert this file to CSV, TSV, or XLSX',
            section: 'end',
            onClick: options.onConvertFile
        },
        {
            id: 'helpButton',
            icon: Icons.Help,
            tooltip: 'Help & Feedback',
            cls: 'icon-only',
            section: 'end',
            onClick: options.onHelp
        },
        {
            id: 'openSettingsButton',
            icon: Icons.Settings,
            tooltip: 'Sheet Settings',
            cls: 'icon-only',
            section: 'end',
            onClick: options.onOpenSettings
        }
    ];
}
