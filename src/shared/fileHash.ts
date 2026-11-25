// Telling whether a file on disk is still the one the editor loaded or last saved: a hash of its
// bytes is kept as the baseline, and compared with the file's hash later. Used by the spreadsheet
// provider to ignore the watcher event of its own save and to refuse a save over a file that changed
// underneath it. No `vscode` import, so it is unit-testable. Runtime: EXTENSION HOST.

import { createHash } from 'crypto';
import * as fs from 'fs';

export function sha1Hex(bytes: Uint8Array): string {
    return createHash('sha1').update(bytes).digest('hex');
}

/** The hash of a file's bytes, or null when it cannot be read (missing, locked). */
export async function hashFile(filePath: string): Promise<string | null> {
    try {
        return sha1Hex(await fs.promises.readFile(filePath));
    } catch {
        return null;
    }
}

/**
 * Did the file change since the baseline? Anything unknown (no baseline yet, file unreadable) counts as
 * unchanged: the editor never raises an alarm it cannot back up.
 */
export function changedSinceBaseline(baseline: string | null, current: string | null): boolean {
    if (baseline === null || current === null) { return false; }
    return baseline !== current;
}
