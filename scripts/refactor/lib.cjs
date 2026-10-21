// Shared helpers for the refactor scripts: parse a file, find the IIFE body the big webview files
// wrap their code in, and build a TypeScript language service for scope-aware renames.
const ts = require('typescript');
const fs = require('fs');
const path = require('path');

function parse(file, text = fs.readFileSync(file, 'utf8')) {
    return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

/** Statements of the `(function () { ... })()` body, or the file's top level when there is none. */
function bodyStatements(sf) {
    for (const st of sf.statements) {
        if (!ts.isExpressionStatement(st) || !ts.isCallExpression(st.expression)) { continue; }
        let fn = st.expression.expression;
        if (ts.isParenthesizedExpression(fn)) { fn = fn.expression; }
        if (ts.isFunctionExpression(fn) || ts.isArrowFunction(fn)) { return fn.body.statements; }
    }
    return sf.statements;
}

/** Names bound by a declaration name, including destructuring (`const { a, b: c } = x`). */
function boundNames(name) {
    if (ts.isIdentifier(name)) { return [name.text]; }
    return name.elements.flatMap(el => (ts.isOmittedExpression(el) ? [] : boundNames(el.name)));
}

/** Name -> statement for every function, variable, type and interface declared in the body. */
function declarations(statements) {
    const decls = new Map();
    for (const st of statements) {
        if ((ts.isFunctionDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) && st.name) {
            decls.set(st.name.text, st);
        } else if (ts.isVariableStatement(st)) {
            for (const d of st.declarationList.declarations) {
                for (const name of boundNames(d.name)) { decls.set(name, st); }
            }
        }
    }
    return decls;
}

/** Identifiers referenced inside `node`, ignoring property names (`a.name`, `{ name: x }`). */
function referencedNames(node) {
    const names = new Set();
    (function walk(n) {
        if (ts.isIdentifier(n)) {
            const p = n.parent;
            const isPropertyName = (ts.isPropertyAccessExpression(p) && p.name === n)
                || ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p) || ts.isMethodDeclaration(p)) && p.name === n);
            if (!isPropertyName) { names.add(n.text); }
        }
        ts.forEachChild(n, walk);
    })(node);
    return names;
}

function languageService(tsconfig, file, getText) {
    const abs = path.resolve(file);
    const cfg = ts.parseJsonConfigFileContent(ts.readConfigFile(tsconfig, ts.sys.readFile).config, ts.sys, path.dirname(path.resolve(tsconfig)));
    const host = {
        getScriptFileNames: () => cfg.fileNames,
        getScriptVersion: () => '1',
        getScriptSnapshot: (f) => {
            const t = path.resolve(f) === abs ? getText() : (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : undefined);
            return t === undefined ? undefined : ts.ScriptSnapshot.fromString(t);
        },
        getCurrentDirectory: () => process.cwd(),
        getCompilationSettings: () => cfg.options,
        getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
        fileExists: ts.sys.fileExists, readFile: ts.sys.readFile, readDirectory: ts.sys.readDirectory,
    };
    return ts.createLanguageService(host);
}

/** Apply non-overlapping {start, end, newText} edits to text. */
function applyEdits(text, edits) {
    const sorted = [...edits].sort((a, b) => b.start - a.start);
    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].end > sorted[i - 1].start) { throw new Error('overlapping edits'); }
    }
    for (const e of sorted) { text = text.slice(0, e.start) + e.newText + text.slice(e.end); }
    return text;
}

const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

module.exports = { ts, parse, bodyStatements, declarations, referencedNames, languageService, applyEdits, lineOf };
