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
    chips?: string[];
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
    depth: number,
    rows: FrontmatterFieldRow[],
    visited: WeakSet<object> = new WeakSet(),
    maxDepth = 32,
): void {
    if (depth > maxDepth) {
        return;
    }

    if (Array.isArray(value)) {
        const chips = value.map((item) => formatScalar(item)).filter((item) => item.length > 0);
        rows.push({
            key,
            keyPath,
            displayValue: chips.join(', '),
            kind: 'array',
            depth,
            chips,
        });
        return;
    }

    if (value !== null && typeof value === 'object') {
        if (visited.has(value)) {
            return;
        }
        visited.add(value);
        rows.push({
            key,
            keyPath,
            displayValue: '',
            kind: 'object',
            depth,
        });
        for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
            flattenFieldRows(childValue, childKey, [...keyPath, childKey], depth + 1, rows, visited, maxDepth);
        }
        return;
    }

    rows.push({
        key,
        keyPath,
        displayValue: formatScalar(value),
        kind: 'scalar',
        depth,
    });
}

export function buildFieldRows(parsed: Record<string, unknown>): FrontmatterFieldRow[] {
    const rows: FrontmatterFieldRow[] = [];
    for (const [key, value] of Object.entries(parsed)) {
        flattenFieldRows(value, key, [key], 0, rows);
    }
    return rows;
}

export function formatFrontmatterBlock(parsed: Record<string, unknown>): string {
    const yamlBody = dumpYaml(parsed, { lineWidth: -1, noRefs: true }).trimEnd();
    return wrapFrontmatterYaml(yamlBody);
}

export function wrapFrontmatterYaml(yamlBody: string): string {
    const trimmed = yamlBody.trimEnd();
    if (!trimmed) {
        return '---\n---\n';
    }
    return `---\n${trimmed}\n---\n`;
}

/** First doc position after a valid frontmatter block — where the body starts. */
export function cursorPosAfterFrontmatter(content: string): number {
    return extractFrontmatter(content)?.range.to ?? 0;
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
    yamlText: string;
    rows: FrontmatterFieldRow[];
    parsed: Record<string, unknown>;
}

export function resolveFrontmatterWidgetData(doc: string): FrontmatterWidgetData | null {
    try {
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
            yamlText: extracted.yamlText,
            rows: buildFieldRows(parsed),
            parsed,
        };
    } catch {
        return null;
    }
}
