// The fonts installed on this computer, for the Font picker. A webview cannot list them itself
// (VS Code's webview sandbox blocks the browser's font-listing API), so the extension host asks the
// operating system. Each platform has one small command with fixed arguments (no user input):
//   macOS    AppKit's NSFontManager through osascript (about 0.4 s)
//   Windows  PowerShell + PresentationCore's SystemFontFamilies
//   Linux    fc-list
// If the command is missing or fails, the list is empty and the picker offers only the built-in fonts.
//
// In a remote window (SSH, WSL, Dev Containers) the extension host runs on the remote machine, so this
// lists the remote machine's fonts, not the ones on the screen in front of you.

import { execFile } from 'child_process';
import { BUILT_IN_FONT_IDS, isSafeFontName } from './fontChoice';

const MAX_FONTS = 3000;

/**
 * Family names from raw lines or an array: only safe names, none that clash with a built-in font
 * (Inter, System, Serif), each once (ignoring letter case), sorted for people.
 */
export function cleanFontNames(names: readonly unknown[]): string[] {
    const builtInLabels = new Set<string>(BUILT_IN_FONT_IDS);
    const seen = new Set<string>();
    const kept: string[] = [];
    for (const raw of names) {
        if (typeof raw !== 'string') { continue; }
        const name = raw.trim();
        const key = name.toLowerCase();
        if (!isSafeFontName(name) || builtInLabels.has(key) || seen.has(key)) { continue; }
        seen.add(key);
        kept.push(name);
    }
    return kept.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).slice(0, MAX_FONTS);
}

/** macOS: osascript prints a JSON array of family names. */
export function parseJsonFamilies(stdout: string): string[] {
    try {
        const parsed: unknown = JSON.parse(stdout.trim());
        return Array.isArray(parsed) ? cleanFontNames(parsed) : [];
    } catch {
        return [];
    }
}

/** Windows: PowerShell prints one family name per line. */
export function parseLineFamilies(stdout: string): string[] {
    return cleanFontNames(stdout.split(/\r?\n/));
}

/** Linux: `fc-list : family` prints one line per face, "Family,Localized family" (only the first is used). */
export function parseFcList(stdout: string): string[] {
    return cleanFontNames(stdout.split(/\r?\n/).map(line => line.split(',')[0]));
}

function run(command: string, args: string[]): Promise<string> {
    return new Promise(resolve => {
        execFile(command, args, { timeout: 15000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, encoding: 'utf8' },
            (error, stdout) => resolve(error ? '' : stdout));
    });
}

const MAC_SCRIPT = 'ObjC.import("AppKit"); JSON.stringify(ObjC.deepUnwrap($.NSFontManager.sharedFontManager.availableFontFamilies))';
const WINDOWS_SCRIPT = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Add-Type -AssemblyName PresentationCore; [System.Windows.Media.Fonts]::SystemFontFamilies | ForEach-Object { $_.Source }';

async function readInstalledFonts(): Promise<string[]> {
    switch (process.platform) {
        case 'darwin': return parseJsonFamilies(await run('osascript', ['-l', 'JavaScript', '-e', MAC_SCRIPT]));
        case 'win32': return parseLineFamilies(await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT]));
        default: return parseFcList(await run('fc-list', [':', 'family']));
    }
}

let cached: Promise<string[]> | undefined;

/** The installed font families. Listed once per VS Code session and shared by every editor; an empty result is retried next time. */
export function listLocalFonts(): Promise<string[]> {
    if (!cached) {
        const attempt = readInstalledFonts().catch(() => []);
        cached = attempt;
        void attempt.then(fonts => { if (!fonts.length && cached === attempt) { cached = undefined; } });
    }
    return cached;
}
