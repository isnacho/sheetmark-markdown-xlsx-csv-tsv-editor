// Which links from webview content the host may hand to the OS. Pure (no `vscode` import) so it is
// unit-testable. Links come from untrusted file content: anything other than web and email links
// (file:, command:, vscode:, custom app schemes) could launch local programs or VS Code commands.

const ALLOWED_EXTERNAL_SCHEMES = new Set(['http', 'https', 'mailto']);

/** True when `url` is an absolute http(s) or mailto link. */
export function isAllowedExternalUrl(url: string): boolean {
    const match = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim());
    return !!match && ALLOWED_EXTERNAL_SCHEMES.has(match[1].toLowerCase());
}
