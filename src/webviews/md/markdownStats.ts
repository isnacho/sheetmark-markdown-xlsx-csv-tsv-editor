export interface TextStats {
    lines: number;
    words: number;
    chars: number;
}

/**
 * Strip Markdown syntax down to what's actually displayed, tolerant of
 * fragments that aren't valid standalone Markdown (a selection substring may
 * start/end mid-emphasis-run). Line structure is preserved so line counts
 * stay meaningful.
 */
export function stripMarkdownToPlainText(source: string): string {
    // Line-anchored block markers first (a bare "***" horizontal rule must be
    // recognized before the inline emphasis passes below would mangle it).
    let text = source
        .split('\n')
        .map(line => {
            if (/^\s{0,3}([*_-] ?){3,}$/.test(line.trim())) {
                return '';
            }
            return line
                .replace(/^\s{0,3}#{1,6}\s+/, '')
                .replace(/^\s{0,3}(?:>\s?)+/, '')
                .replace(/^(\s*)(?:[-*+]|\d+[.)])\s+/, '$1');
        })
        .join('\n');

    // Inline code first so its contents are protected from later passes.
    text = text.replace(/`([^`]*)`/g, '$1');
    // Images before links (images are links with a leading `!`).
    text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
    text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    // Bold before italic so `**` is consumed first.
    text = text.replace(/\*\*([^*]*)\*\*/g, '$1');
    text = text.replace(/__([^_]*)__/g, '$1');
    text = text.replace(/~~([^~]*)~~/g, '$1');
    text = text.replace(/\*([^*]*)\*/g, '$1');
    text = text.replace(/_([^_]*)_/g, '$1');

    return text;
}

export function computeTextStats(text: string): TextStats {
    const trimmed = text.trim();
    return {
        lines: text.split('\n').length,
        words: trimmed ? trimmed.split(/\s+/).filter(Boolean).length : 0,
        chars: text.length,
    };
}
