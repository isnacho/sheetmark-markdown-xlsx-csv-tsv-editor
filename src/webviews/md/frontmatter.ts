import { load as loadYaml, dump as dumpYaml } from 'js-yaml';

/** Doc-start `---` … `---` block only; mid-document rules are untouched. */
const FRONTMATTER_RE = /^(\uFEFF?)---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

export interface ExtractedFrontmatter {
    yamlText: string;
    body: string;
    range: { from: number; to: number };
}

export interface FrontmatterFieldRow {
    key: string;
    keyPath: string[];
    displayValue: string;
    kind: 'scalar' | 'array' | 'object';
    depth: number;
    /** 1-indexed line in the full document (for click-to-jump). */
    sourceLine: number;
    chips?: string[];
}

export interface FrontmatterCardData {
    rows: FrontmatterFieldRow[];
    parsed: Record<string, unknown>;
}

export interface FrontmatterRenderResult {
    body: string;
    card: FrontmatterCardData | null;
    /** True when a doc-start delimiter pair was found but should not render a card. */
    stripped: boolean;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function extractFrontmatter(raw: string): ExtractedFrontmatter | null {
    const match = raw.match(FRONTMATTER_RE);
    if (!match) {
        return null;
    }
    return {
        yamlText: match[2] ?? '',
        body: raw.slice(match[0].length),
        range: { from: 0, to: match[0].length },
    };
}

export function isEmptyFrontmatter(yamlText: string): boolean {
    return yamlText.trim().length === 0;
}

export function parseFrontmatter(yamlText: string): Record<string, unknown> | null {
    if (isEmptyFrontmatter(yamlText)) {
        return null;
    }
    try {
        const parsed = loadYaml(yamlText);
        if (parsed === null || parsed === undefined) {
            return {};
        }
        if (typeof parsed !== 'object' || Array.isArray(parsed)) {
            return null;
        }
        return parsed as Record<string, unknown>;
    } catch {
        return null;
    }
}

function yamlLineIndexForKey(yamlText: string, key: string, depth: number): number {
    const lines = yamlText.split(/\r?\n/);
    const indent = '  '.repeat(depth);
    const pattern = new RegExp(`^${indent}${escapeRegExp(key)}\\s*:`);
    for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
            return i;
        }
    }
    return 0;
}

function docLineForYamlLine(yamlLineIndex: number): number {
    // Line 1 = opening `---`; first YAML content line = 2.
    return yamlLineIndex + 2;
}

function formatScalar(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    if (value instanceof Date) {
        return value.toISOString().slice(0, 10);
    }
    if (typeof value === 'number') {
        return String(value);
    }
    return String(value);
}

function flattenFieldRows(
    value: unknown,
    key: string,
    keyPath: string[],
    yamlText: string,
    depth: number,
    rows: FrontmatterFieldRow[],
): void {
    const yamlLine = yamlLineIndexForKey(yamlText, key, depth);
    const sourceLine = docLineForYamlLine(yamlLine);

    if (Array.isArray(value)) {
        const chips = value.map((item) => formatScalar(item)).filter((item) => item.length > 0);
        rows.push({
            key,
            keyPath,
            displayValue: chips.join(', '),
            kind: 'array',
            depth,
            sourceLine,
            chips,
        });
        return;
    }

    if (value !== null && typeof value === 'object') {
        rows.push({
            key,
            keyPath,
            displayValue: '',
            kind: 'object',
            depth,
            sourceLine,
        });
        for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
            flattenFieldRows(childValue, childKey, [...keyPath, childKey], yamlText, depth + 1, rows);
        }
        return;
    }

    rows.push({
        key,
        keyPath,
        displayValue: formatScalar(value),
        kind: 'scalar',
        depth,
        sourceLine,
    });
}

export function buildFieldRows(parsed: Record<string, unknown>, yamlText: string): FrontmatterFieldRow[] {
    const rows: FrontmatterFieldRow[] = [];
    for (const [key, value] of Object.entries(parsed)) {
        flattenFieldRows(value, key, [key], yamlText, 0, rows);
    }
    return rows;
}

function setNestedValue(target: Record<string, unknown>, path: string[], value: unknown): void {
    let current: Record<string, unknown> = target;
    for (let i = 0; i < path.length - 1; i++) {
        const segment = path[i];
        const next = current[segment];
        if (next === null || typeof next !== 'object' || Array.isArray(next)) {
            current[segment] = {};
        }
        current = current[segment] as Record<string, unknown>;
    }
    current[path[path.length - 1]] = value;
}

function parseEditableScalar(rawValue: string, previous: unknown): unknown {
    const trimmed = rawValue.trim();
    if (typeof previous === 'boolean') {
        if (trimmed === 'true') { return true; }
        if (trimmed === 'false') { return false; }
    }
    if (typeof previous === 'number' && /^-?\d+(\.\d+)?$/.test(trimmed)) {
        return Number(trimmed);
    }
    return rawValue;
}

export function applyRowEditsToParsed(
    parsed: Record<string, unknown>,
    rows: readonly FrontmatterFieldRow[],
    values: Map<string, string>,
): void {
    for (const row of rows) {
        if (row.kind === 'object') { continue; }
        const raw = values.get(row.keyPath.join('.'));
        if (raw === undefined) { continue; }
        const previous = row.keyPath.reduce<unknown>((acc, segment) => {
            if (acc && typeof acc === 'object' && !Array.isArray(acc)) {
                return (acc as Record<string, unknown>)[segment];
            }
            return undefined;
        }, parsed);
        const nextValue = row.kind === 'array'
            ? raw.split(',').map((part) => part.trim()).filter((part) => part.length > 0)
            : parseEditableScalar(raw, previous);
        setNestedValue(parsed, row.keyPath, nextValue);
    }
}

export function formatFrontmatterBlock(parsed: Record<string, unknown>): string {
    const yamlBody = dumpYaml(parsed, { lineWidth: -1, noRefs: true }).trimEnd();
    if (!yamlBody) {
        return '---\n---\n';
    }
    return `---\n${yamlBody}\n---\n`;
}

export function resolveFrontmatterForRender(content: string, collapsed: boolean): FrontmatterRenderResult {
    const extracted = extractFrontmatter(content);
    if (!extracted) {
        return { body: content, card: null, stripped: false };
    }

    if (isEmptyFrontmatter(extracted.yamlText)) {
        return { body: extracted.body, card: null, stripped: true };
    }

    const parsed = parseFrontmatter(extracted.yamlText);
    if (parsed === null) {
        return { body: content, card: null, stripped: false };
    }

    if (Object.keys(parsed).length === 0) {
        return { body: extracted.body, card: null, stripped: true };
    }

    const rows = buildFieldRows(parsed, extracted.yamlText);
    return {
        body: extracted.body,
        card: { rows, parsed },
        stripped: true,
    };
}

export function markdownBodyWithoutFrontmatter(content: string): string {
    const extracted = extractFrontmatter(content);
    if (!extracted) {
        return content;
    }
    if (isEmptyFrontmatter(extracted.yamlText)) {
        return extracted.body;
    }
    const parsed = parseFrontmatter(extracted.yamlText);
    if (parsed === null) {
        return content;
    }
    return extracted.body;
}

export interface FrontmatterWidgetData {
    range: { from: number; to: number };
    rows: FrontmatterFieldRow[];
    parsed: Record<string, unknown>;
}

export function resolveFrontmatterWidgetData(doc: string): FrontmatterWidgetData | null {
    const extracted = extractFrontmatter(doc);
    if (!extracted || isEmptyFrontmatter(extracted.yamlText)) {
        return null;
    }
    const parsed = parseFrontmatter(extracted.yamlText);
    if (!parsed || Object.keys(parsed).length === 0) {
        return null;
    }
    return {
        range: extracted.range,
        rows: buildFieldRows(parsed, extracted.yamlText),
        parsed,
    };
}
