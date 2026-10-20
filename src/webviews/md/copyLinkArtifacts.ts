// Strips heading copy-link artifacts that end up in pasted or exported Markdown. Pure.

export function stripHeadingCopyLinkArtifacts(text: string): string {
    if (!text) {
        return '';
    }

    return text
        .replace(/\s*\[#\]\(#[^)\s]+(?:\s+"Copy link")?\)/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function sanitizeMarkdownCopyLinkArtifacts(markdown: string): string {
    if (!markdown) {
        return '';
    }

    return markdown.split('\n').map((line) => {
        if (!/^\s{0,3}#{1,6}\s+/.test(line)) {
            return line;
        }
        return stripHeadingCopyLinkArtifacts(line);
    }).join('\n');
}
