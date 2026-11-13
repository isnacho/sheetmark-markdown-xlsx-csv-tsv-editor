// The `xlsxViewer.fontFamily` setting: which font both editors use. Pure (no `vscode` import) so it
// can be unit tested. The webview side (labels, applying the font) is src/webviews/shared/fontManager.ts.
//
// The value is either a built-in font id ('inter', 'system', 'serif') or the family name of a font
// installed on the computer. Names come from the user's settings and from webview messages, so they
// are checked before they are stored or put into CSS.

import type { BuiltInFont, FontChoice } from '../protocol/common';

export const DEFAULT_FONT_CHOICE: BuiltInFont = 'inter';

// A Record, so adding a member to BuiltInFont fails to compile until it is listed here.
const BUILT_IN_FONTS: Record<BuiltInFont, true> = { inter: true, system: true, serif: true };

export const BUILT_IN_FONT_IDS: readonly BuiltInFont[] = Object.keys(BUILT_IN_FONTS) as BuiltInFont[];

export function isBuiltInFont(value: unknown): value is BuiltInFont {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BUILT_IN_FONTS, value);
}

const MAX_FONT_NAME_LENGTH = 100;
// Control characters, quotes and backslashes (the name goes inside a quoted CSS string), and
// ; { } < > (never in a family name, and the easiest way to smuggle CSS or markup).
const UNSAFE_FONT_NAME = /[\u0000-\u001f\u007f"\\;{}<>]/;

/** A family name that is safe to put inside a quoted CSS `font-family`. */
export function isSafeFontName(value: unknown): value is string {
    return typeof value === 'string'
        && value.length > 0
        && value.length <= MAX_FONT_NAME_LENGTH
        && value === value.trim()
        && !value.startsWith('.') // macOS hides its own UI fonts behind a leading dot
        && !UNSAFE_FONT_NAME.test(value);
}

/** True for a value the setting may hold: a built-in id or a safe font name. */
export function isFontChoice(value: unknown): value is FontChoice {
    return isBuiltInFont(value) || isSafeFontName(value);
}

/**
 * A stored or received value as the choice to use. Built-in ids match any letter case ("Serif" in
 * Settings JSON works); anything unsafe or empty falls back to Inter.
 */
export function normalizeFontChoice(value: unknown): FontChoice {
    if (typeof value !== 'string') { return DEFAULT_FONT_CHOICE; }
    const trimmed = value.trim();
    const lower = trimmed.toLowerCase();
    if (isBuiltInFont(lower)) { return lower; }
    return isSafeFontName(trimmed) ? trimmed : DEFAULT_FONT_CHOICE;
}
