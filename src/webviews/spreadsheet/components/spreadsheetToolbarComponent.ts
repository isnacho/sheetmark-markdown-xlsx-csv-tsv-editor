import { Icons } from '../../shared/icons';
import { ToolbarButton } from '../../shared/toolbarManager';

export interface CreateXlsxToolbarButtonsOptions {
    onFind: () => void;
    textColorIcon: string;
    bgColorIcon: string;
    onSaveTableEdits: () => void;
    onInsertControl: () => void;
    onFormatBold: () => void;
    onFormatItalic: () => void;
    onFormatTextColor: () => void;
    onFormatBackgroundColor: () => void;
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
            id: 'saveTableEditsButton',
            icon: Icons.Save,
            tooltip: 'Save Changes (Ctrl/Cmd+S)',
            cls: 'icon-only',
            onClick: options.onSaveTableEdits
        },
        {
            id: 'formatBoldButton',
            icon: Icons.Bold,
            cls: 'icon-only',
            tooltip: 'Bold selected text (Ctrl/Cmd+B)',
            hidden: true,
            onClick: options.onFormatBold
        },
        {
            id: 'formatItalicButton',
            icon: Icons.Italic,
            cls: 'icon-only',
            tooltip: 'Italic selected text (Ctrl/Cmd+I)',
            hidden: true,
            onClick: options.onFormatItalic
        },
        {
            id: 'formatTextColorButton',
            icon: options.textColorIcon,
            cls: 'icon-only',
            tooltip: 'Set selected text color',
            hidden: true,
            onClick: options.onFormatTextColor
        },
        {
            id: 'formatBackgroundColorButton',
            icon: options.bgColorIcon,
            cls: 'icon-only',
            tooltip: 'Set selected text background color',
            hidden: true,
            onClick: options.onFormatBackgroundColor
        },
        {
            id: 'toggleExpandButton',
            icon: Icons.Expand,
            cls: 'icon-only',
            tooltip: 'Toggle Column Widths (Default / Expand All)',
            onClick: options.onToggleExpand
        },
        {
            id: 'insertControlButton',
            icon: Icons.TableInsert,
            label: 'Insert',
            tooltip: 'Insert checkbox, dropdown, rating, or date into selected cells',
            hidden: true,
            onClick: options.onInsertControl
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
