import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import * as vscode from 'vscode';

export const VERSION_HISTORY_RETENTION_MS = 48 * 60 * 60 * 1000;
export const VERSION_HISTORY_SNAPSHOT_DEBOUNCE_MS = 1000;

function getHistoryKey(filePath: string): string {
    return createHash('sha1').update(filePath).digest('hex');
}

export function getVersionHistoryRoot(globalStoragePath: string): string {
    return path.join(globalStoragePath, '.history');
}

export function getVersionHistoryFile(
    globalStoragePath: string,
    filePath: string,
    kind: string,
    extension: string = 'json'
): string {
    return path.join(getVersionHistoryRoot(globalStoragePath), `${kind}-${getHistoryKey(filePath)}.${extension}`);
}

export function getVersionHistoryDir(globalStoragePath: string, filePath: string, kind: string): string {
    return path.join(getVersionHistoryRoot(globalStoragePath), `${kind}-${getHistoryKey(filePath)}`);
}

export async function migrateVersionHistory(
    globalStoragePath: string,
    oldPath: string,
    newPath: string,
    kind: string,
    isDirectory: boolean,
): Promise<void> {
    const oldLocation = isDirectory
        ? getVersionHistoryDir(globalStoragePath, oldPath, kind)
        : getVersionHistoryFile(globalStoragePath, oldPath, kind);
    const newLocation = isDirectory
        ? getVersionHistoryDir(globalStoragePath, newPath, kind)
        : getVersionHistoryFile(globalStoragePath, newPath, kind);

    if (oldLocation === newLocation) {
        return;
    }

    try {
        await fs.promises.access(oldLocation);
    } catch {
        return;
    }

    try {
        await fs.promises.access(newLocation);
        return;
    } catch {
        // Destination does not exist yet — proceed with rename.
    }

    await fs.promises.rename(oldLocation, newLocation);
}

export function formatVersionHistoryGroupLabel(timestamp: number): string {
    const now = new Date();
    const entryDate = new Date(timestamp);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const entryDay = new Date(entryDate.getFullYear(), entryDate.getMonth(), entryDate.getDate());
    const dayDiff = Math.round((today.getTime() - entryDay.getTime()) / (24 * 60 * 60 * 1000));

    if (dayDiff === 0) {return 'Today';}
    if (dayDiff === 1) {return 'Yesterday';}
    if (dayDiff >= 2 && dayDiff <= 6) {return 'This Week';}
    return entryDate.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatVersionHistoryTimestamp(timestamp: number): string {
    const entryDate = new Date(timestamp);
    return entryDate.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
}

export function buildGroupedVersionHistoryItems<T extends { timestamp: number }>(
    entries: T[],
    mapEntry: (entry: T) => vscode.QuickPickItem & { entry: T }
): Array<vscode.QuickPickItem & { entry?: T }> {
    const grouped = new Map<string, { sortKey: number; items: Array<ReturnType<typeof mapEntry>> }>();

    for (const entry of entries) {
        const label = formatVersionHistoryGroupLabel(entry.timestamp);
        const bucket = grouped.get(label);
        if (!bucket) {
            grouped.set(label, { sortKey: entry.timestamp, items: [mapEntry(entry)] });
        } else {
            bucket.items.push(mapEntry(entry));
        }
    }

    const sortedGroups = [...grouped.entries()].sort((a, b) => b[1].sortKey - a[1].sortKey);
    const result: Array<vscode.QuickPickItem & { entry?: T }> = [];

    for (const [label, { items }] of sortedGroups) {
        result.push({ label, kind: vscode.QuickPickItemKind.Separator });
        for (const item of items) {
            result.push(item);
        }
    }

    return result;
}

/**
 * Show the version-history QuickPick (newest first, grouped by day) and return the picked entry.
 * The oldest entry is labeled "Original File" and the last restored one "Restored"; `describe`
 * supplies the detail text for ordinary versions (size, character count, ...).
 */
export async function pickVersionHistoryEntry<T extends { id: string; timestamp: number }>(
    entries: readonly T[],
    restoredVersionId: string | null,
    describe: (entry: T) => string,
): Promise<T | undefined> {
    const sorted = [...entries].sort((a, b) => b.timestamp - a.timestamp);
    const oldestVersionId = sorted.length ? sorted[sorted.length - 1].id : null;
    const picked = await vscode.window.showQuickPick(
        buildGroupedVersionHistoryItems(sorted, (entry) => {
            const isOriginal = entry.id === oldestVersionId;
            const isRestored = entry.id === restoredVersionId;
            return {
                label: isOriginal && isRestored ? 'Original File (Restored)'
                    : isOriginal ? 'Original File'
                        : isRestored ? 'Restored'
                            : formatVersionHistoryTimestamp(entry.timestamp),
                description: isOriginal || isRestored ? formatVersionHistoryTimestamp(entry.timestamp) : describe(entry),
                detail: `Saved ${Math.max(1, Math.round((Date.now() - entry.timestamp) / 60000))} min ago`,
                entry,
            };
        }),
        { placeHolder: `Version history (${sorted.length} versions)` },
    );
    return picked?.entry;
}
