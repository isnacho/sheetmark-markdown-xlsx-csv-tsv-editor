// Allowlist HTML sanitizer for untrusted file content (spreadsheet cells, Markdown table cells).
//
// Runtime: WEBVIEW (browser). Parsing goes through a <template>, whose content is inert: scripts
// don't run and images don't load while we inspect it. Never parse untrusted HTML by assigning
// innerHTML on a live-document element (even a detached <div> fires <img onerror>).
//
// Pass `doc` only from tests (a linkedom document); the webview uses the global `document`.

const ALLOWED_TAGS = new Set([
    'a', 'abbr', 'b', 'bdi', 'bdo', 'blockquote', 'br', 'caption', 'cite', 'code', 'col', 'colgroup',
    'dd', 'del', 'dfn', 'div', 'dl', 'dt', 'em', 'font', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i',
    'img', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q', 's', 'samp', 'small', 'span', 'strike',
    'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'var', 'wbr',
]);

/** Removed together with everything inside them (other unknown tags are unwrapped, keeping their text). */
const DROPPED_TAGS = new Set([
    'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta', 'base',
    'form', 'input', 'button', 'select', 'textarea', 'option', 'template', 'noscript', 'svg', 'math',
    'video', 'audio', 'source', 'track', 'canvas', 'title', 'head',
]);

const ALLOWED_ATTRS = new Set([
    'class', 'style', 'title', 'alt', 'width', 'height', 'colspan', 'rowspan', 'align', 'valign',
    'color', 'face', 'size', 'start', 'type', 'datetime', 'href', 'src', 'loading', 'span',
]);

const ALLOWED_CSS_PROPS = new Set([
    'color', 'background-color', 'font-weight', 'font-style', 'font-size', 'font-family',
    'text-decoration', 'text-decoration-line', 'text-decoration-color', 'text-decoration-style',
    'text-decoration-thickness', 'text-align', 'vertical-align', 'white-space',
    'width', 'min-width', 'max-width', 'height',
]);

const SAFE_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:']);
const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[a-z0-9+/=\s]*$/i;

/** True for relative URLs, fragments, and http(s)/mailto. `allowDataImage` also admits base64 raster images. */
export function isSafeUrl(value: string, allowDataImage = false): boolean {
    // Browsers ignore control characters and whitespace inside a scheme ("java\tscript:").
    const url = value.replace(/[\u0000- \u007f-\u009f]/g, '');
    if (!url) { return true; }
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url);
    if (!scheme) { return true; }
    const name = scheme[1].toLowerCase() + ':';
    if (SAFE_URL_SCHEMES.has(name)) { return true; }
    if (allowDataImage && name === 'data:') { return SAFE_DATA_IMAGE.test(value.trim()); }
    // Local images in the Markdown editor are rewritten to webview resource URLs.
    if (name === 'vscode-webview-resource:' || name === 'vscode-resource:') { return true; }
    return false;
}

/** Keep only allowlisted CSS properties whose values can't load or run anything. */
export function sanitizeStyle(style: string): string {
    const kept: string[] = [];
    for (const decl of style.split(';')) {
        const colon = decl.indexOf(':');
        if (colon < 0) { continue; }
        const prop = decl.slice(0, colon).trim().toLowerCase();
        const value = decl.slice(colon + 1).trim();
        if (!ALLOWED_CSS_PROPS.has(prop) || !value) { continue; }
        if (/url\s*\(|expression\s*\(|javascript:|[\\<>{}]|@import/i.test(value)) { continue; }
        kept.push(`${prop}: ${value}`);
    }
    return kept.join('; ');
}

function sanitizeNode(node: Node, doc: Document): void {
    for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3) { continue; } // text: escaped on serialization
        if (child.nodeType !== 1) { child.parentNode?.removeChild(child); continue; } // comments etc.

        const el = child as Element;
        const tag = el.tagName.toLowerCase();
        if (DROPPED_TAGS.has(tag)) { el.parentNode?.removeChild(el); continue; }

        sanitizeNode(el, doc);

        if (!ALLOWED_TAGS.has(tag)) {
            const parent = el.parentNode;
            if (parent) {
                while (el.firstChild) { parent.insertBefore(el.firstChild, el); }
                parent.removeChild(el);
            }
            continue;
        }

        for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            if (!ALLOWED_ATTRS.has(name)) { el.removeAttribute(attr.name); continue; }
            if (name === 'href' && (tag !== 'a' || !isSafeUrl(attr.value))) { el.removeAttribute(attr.name); continue; }
            if (name === 'src' && (tag !== 'img' || !isSafeUrl(attr.value, true))) { el.removeAttribute(attr.name); continue; }
            if (name === 'style') {
                const clean = sanitizeStyle(attr.value);
                if (clean) { el.setAttribute('style', clean); } else { el.removeAttribute('style'); }
            }
        }
    }
}

function parseInert(html: string, doc: Document): DocumentFragment {
    const template = doc.createElement('template');
    template.innerHTML = html;
    return template.content;
}

/** Return `html` with only allowlisted tags, attributes, URLs and CSS left. Text is preserved and escaped. */
export function sanitizeHtml(html: string, doc: Document = document): string {
    if (!html) { return ''; }
    const fragment = parseInert(html, doc);
    sanitizeNode(fragment, doc);
    const holder = doc.createElement('div');
    holder.appendChild(fragment);
    return holder.innerHTML;
}

/** Plain text of an HTML string, parsed inertly (no image loads, no handlers). */
export function htmlToPlainText(html: string, doc: Document = document): string {
    if (!html) { return ''; }
    // Walk text nodes instead of moving the fragment into a live element (which would load images).
    let text = '';
    const collect = (node: Node) => {
        for (const child of Array.from(node.childNodes)) {
            if (child.nodeType === 3) { text += child.nodeValue || ''; }
            else if (child.nodeType === 1) { collect(child); }
        }
    };
    collect(parseInert(html, doc));
    return text;
}
