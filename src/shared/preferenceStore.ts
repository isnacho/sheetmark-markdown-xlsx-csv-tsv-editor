// Small persisted preferences kept outside the file bytes: per-file ones (keyed by lowercased
// fsPath, so case differences on macOS/Windows don't split them) and editor-wide ones. Only
// `import type` from vscode, so the stores are unit-tested with a fake Memento.
//
// To add a Markdown preference: add one entry to createMarkdownPreferences below, then read and
// write it from MDEditorProvider. Per-file entries listed in `perFile` move with the file
// automatically on rename (renameStateMigration.ts).

import type * as vscode from 'vscode';
import type { MermaidPreviewMode } from '../protocol/markdown';

type Memento = Pick<vscode.Memento, 'get' | 'update'>;
type FileRef = { readonly fsPath: string };

export interface FilePreference<T> {
    get(file: FileRef): T;
    set(file: FileRef, value: T): Promise<void>;
    /** Move the stored value from `from` to `to` (file renamed or moved). */
    migrate(from: FileRef, to: FileRef): Promise<void>;
}

export interface GlobalPreference<T> {
    get(): T;
    set(value: T): Promise<void>;
}

/** Per-file preference stored under `keyPrefix + lowercased fsPath`. */
export function filePreference<T>(memento: Memento, keyPrefix: string, fallback: () => T): FilePreference<T> {
    const key = (file: FileRef) => keyPrefix + file.fsPath.toLowerCase();
    return {
        get: (file) => memento.get<T>(key(file)) ?? fallback(),
        set: async (file, value) => { await memento.update(key(file), value); },
        async migrate(from, to) {
            const fromKey = key(from);
            const toKey = key(to);
            if (fromKey === toKey) { return; }
            const value = memento.get<T>(fromKey);
            if (value === undefined) { return; }
            await memento.update(toKey, value);
            await memento.update(fromKey, undefined);
        },
    };
}

/**
 * Editor-wide preference. `normalize` maps stored or incoming values to a valid one, or
 * `undefined` to reject: on read that yields `fallback`; on write nothing is stored.
 */
export function globalPreference<T>(memento: Memento, key: string, fallback: T, normalize: (raw: unknown) => T | undefined): GlobalPreference<T> {
    return {
        get: () => normalize(memento.get(key)) ?? fallback,
        async set(value) {
            const normalized = normalize(value);
            if (normalized !== undefined) { await memento.update(key, normalized); }
        },
    };
}

const CALLOUT_SLUG = /^[\w-]*$/;

/** The Markdown editor's preferences. Storage keys are persisted user data: never rename them. */
export function createMarkdownPreferences(workspaceState: Memento, globalState: Memento) {
    const tableColumnWidths = filePreference<Record<number, readonly number[]>>(workspaceState, 'xlsxViewer.tableColumnWidths.', () => ({}));
    const frontmatterPanelCollapsed = filePreference<boolean>(workspaceState, 'xlsxViewer.frontmatterPanel.', () => false);
    return {
        /**
         * Table order-index to px per column: GFM pipe tables have no width syntax, so this can't
         * live in the .md file. Identity is positional, so adding or removing a table above a
         * resized one can misattribute widths (accepted, like StyleStorageService's row:col keys).
         */
        tableColumnWidths,
        /** Whether the YAML frontmatter card is collapsed. */
        frontmatterPanelCollapsed,
        mermaidPreviewMode: globalPreference<MermaidPreviewMode>(globalState, 'xlsxViewer.mermaidPreviewMode', 'diagram',
            (raw) => (raw === 'code' ? 'code' : 'diagram')),
        /** Default callout type slug for the slash menu, e.g. "info". */
        calloutDefaultType: globalPreference<string>(globalState, 'xlsxViewer.calloutDefaultType', 'info', (raw) => {
            if (typeof raw !== 'string') { return undefined; }
            const slug = raw.trim().toLowerCase();
            if (!slug) { return 'info'; }
            return CALLOUT_SLUG.test(slug) ? slug : undefined;
        }),
        /** Per-file preferences that follow a file when it moves. */
        perFile: [tableColumnWidths, frontmatterPanelCollapsed] as FilePreference<unknown>[],
    };
}

export type MarkdownPreferences = ReturnType<typeof createMarkdownPreferences>;
