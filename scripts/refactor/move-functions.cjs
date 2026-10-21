// Moves top-level declarations (functions, consts, types) out of a big file into a module next to
// it, with `export` added, and fixes the imports on both sides:
//   - the target gets the source file's imports that the moved code uses (paths adjusted);
//   - the source file imports the moved names it still uses and drops imports it no longer needs.
//
//   node scripts/refactor/move-functions.cjs FILE TARGET name1 name2 ...
//
// It prints what the moved code still uses from FILE ("still needs"): move those too, or pass them
// in with an init(hooks) function in the target (see initPersistence in
// src/webviews/spreadsheet/persistence.ts). Then run check-types and write the target's header comment.
const fs = require('fs');
const path = require('path');
const { ts, parse, bodyStatements, declarations, referencedNames, applyEdits } = require('./lib.cjs');

const [file, target, ...names] = process.argv.slice(2);
if (!file || !target || !names.length) {
    console.error('usage: move-functions.cjs FILE TARGET name...');
    process.exit(2);
}

const sourceText = fs.readFileSync(file, 'utf8');
const sf = parse(file, sourceText);
const body = bodyStatements(sf);
const inIife = body !== sf.statements;
const decls = declarations(body);

const missing = names.filter(n => !decls.has(n));
if (missing.length) { throw new Error('not declared at top level: ' + missing.join(', ')); }
const statements = [...new Set(names.map(n => decls.get(n)))].sort((a, b) => a.pos - b.pos);
for (const st of statements) {
    if (ts.isVariableStatement(st)) {
        const bound = [...decls].filter(([, s]) => s === st).map(([n]) => n);
        const left = bound.filter(n => !names.includes(n));
        if (left.length) { throw new Error(`${left.join(', ')} share a declaration with moved names; list them too`); }
    }
}

// Remove the indentation the IIFE adds (taken from the first line of each statement).
function dedent(chunk, indent) {
    if (!indent) { return chunk; }
    return chunk.split('\n').map(line => (line.startsWith(indent) ? line.slice(indent.length) : line)).join('\n');
}

const movedChunks = [];
const removals = [];
const movedRefs = new Set();
for (const st of statements) {
    const start = st.getStart(sf);
    const lineStart = sourceText.lastIndexOf('\n', start - 1) + 1;
    const indent = inIife ? sourceText.slice(lineStart, start) : '';
    const leading = sourceText.slice(st.getFullStart(), lineStart).replace(/^(?:[ \t]*\r?\n)+/, '');
    const hasExport = (ts.getModifiers?.(st) || []).some(m => m.kind === ts.SyntaxKind.ExportKeyword);
    const code = (hasExport ? '' : 'export ') + sourceText.slice(start, st.getEnd());
    movedChunks.push(dedent(leading, indent) + dedent(indent + code, indent));
    removals.push({ start: st.getFullStart(), end: st.getEnd(), newText: '' });
    for (const ref of referencedNames(st)) { movedRefs.add(ref); }
}

// What the moved code still uses from FILE itself.
const stillNeeds = [...decls.keys()].filter(n => movedRefs.has(n) && !names.includes(n));

const specFrom = (fromFile, spec) => {
    if (!spec.startsWith('.')) { return spec; }
    let rel = path.relative(path.dirname(fromFile), path.resolve(path.dirname(file), spec)).split(path.sep).join('/');
    return rel.startsWith('.') ? rel : './' + rel;
};

// Imports of `sf` as [{ decl, spec, typeOnly, defaultName, namespaceName, named: [{ local, text, typeOnly }] }].
function readImports(sourceFile) {
    return sourceFile.statements.filter(ts.isImportDeclaration).map(decl => {
        const clause = decl.importClause;
        const info = { decl, spec: decl.moduleSpecifier.text, typeOnly: !!clause?.isTypeOnly, defaultName: clause?.name?.text, namespaceName: undefined, named: [] };
        const nb = clause?.namedBindings;
        if (nb && ts.isNamespaceImport(nb)) { info.namespaceName = nb.name.text; }
        if (nb && ts.isNamedImports(nb)) {
            info.named = nb.elements.map(el => ({ local: el.name.text, text: el.getText(sourceFile).replace(/^type\s+/, ''), typeOnly: info.typeOnly || el.isTypeOnly }));
        }
        return info;
    });
}

function importLine(spec, named) {
    const allTypes = named.every(n => n.typeOnly);
    const list = named.map(n => (n.typeOnly && !allTypes ? 'type ' : '') + n.text).join(', ');
    return `import ${allTypes ? 'type ' : ''}{ ${list} } from '${spec}';`;
}

// Adds named imports to `text`, merging into an existing import of the same module when possible.
function addImports(text, fileName, wanted, extraLines = []) {
    const extra = [...extraLines];
    const edits = [];
    const imports = readImports(parse(fileName, text));
    for (const [spec, named] of wanted) {
        const existing = imports.find(i => i.spec === spec && !i.namespaceName && (i.named.length || !i.defaultName));
        if (!existing) { extra.push(importLine(spec, named)); continue; }
        const merged = [...existing.named];
        for (const n of named) { if (!merged.some(m => m.local === n.local)) { merged.push({ ...n, typeOnly: n.typeOnly }); } }
        const head = existing.defaultName ? `import ${existing.defaultName}, ` : 'import ';
        const line = existing.defaultName ? `${head}{ ${merged.map(n => (n.typeOnly ? 'type ' : '') + n.text).join(', ')} } from '${spec}';` : importLine(spec, merged);
        edits.push({ start: existing.decl.getStart(), end: existing.decl.getEnd(), newText: line });
    }
    text = applyEdits(text, edits);
    if (!extra.length) { return text; }
    const after = readImports(parse(fileName, text)).at(-1);
    if (after) {
        const at = after.decl.getEnd();
        return text.slice(0, at) + '\n' + extra.join('\n') + text.slice(at);
    }
    const header = text.match(/^(?:\/\/.*\n)*/)[0]; // keep the file's header comment first
    return header + (header ? '\n' : '') + extra.join('\n') + '\n' + text.slice(header.length);
}

// Drops named imports nothing references any more.
function pruneImports(text, fileName) {
    const sourceFile = parse(fileName, text);
    const used = new Set();
    for (const st of sourceFile.statements) { if (!ts.isImportDeclaration(st)) { for (const n of referencedNames(st)) { used.add(n); } } }
    const edits = [];
    for (const imp of readImports(sourceFile)) {
        if (!imp.named.length || imp.namespaceName) { continue; }
        const kept = imp.named.filter(n => used.has(n.local));
        if (kept.length === imp.named.length) { continue; }
        const keepDefault = imp.defaultName && used.has(imp.defaultName);
        let newText = '';
        if (kept.length && !keepDefault) { newText = imp.typeOnly ? `import type { ${kept.map(n => n.text).join(', ')} } from '${imp.spec}';` : importLine(imp.spec, kept); }
        else if (kept.length) { newText = `import ${imp.defaultName}, { ${kept.map(n => (n.typeOnly ? 'type ' : '') + n.text).join(', ')} } from '${imp.spec}';`; }
        else if (keepDefault) { newText = `import ${imp.defaultName} from '${imp.spec}';`; }
        const end = newText ? imp.decl.getEnd() : imp.decl.getEnd() + (text[imp.decl.getEnd()] === '\n' ? 1 : 0);
        edits.push({ start: imp.decl.getStart(), end, newText });
    }
    return applyEdits(text, edits);
}

// 1. Target: the source's imports that the moved code uses, then the moved code.
const targetWanted = new Map();
const targetExtraLines = [];
for (const imp of readImports(sf)) {
    const spec = specFrom(target, imp.spec);
    if (imp.namespaceName && movedRefs.has(imp.namespaceName)) { targetExtraLines.push(`import * as ${imp.namespaceName} from '${spec}';`); }
    if (imp.defaultName && movedRefs.has(imp.defaultName)) { targetExtraLines.push(`import ${imp.defaultName} from '${spec}';`); }
    const named = imp.named.filter(n => movedRefs.has(n.local));
    if (named.length) { targetWanted.set(spec, [...(targetWanted.get(spec) || []), ...named]); }
}
let targetText = fs.existsSync(target)
    ? fs.readFileSync(target, 'utf8')
    : `// Moved out of ${path.basename(file)} by scripts/refactor/move-functions.cjs. Describe the module here.\n`;
targetText = addImports(targetText, target, targetWanted, targetExtraLines);
targetText = targetText.replace(/\s*$/, '\n') + '\n' + movedChunks.join('\n\n') + '\n';
fs.writeFileSync(target, targetText);

// 2. Source: remove the moved code, import what is still used, prune the rest.
let newSource = applyEdits(sourceText, removals);
const remainingRefs = new Set();
for (const st of parse(file, newSource).statements) { if (!ts.isImportDeclaration(st)) { for (const n of referencedNames(st)) { remainingRefs.add(n); } } }
const typeNames = new Set(statements.filter(st => ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)).map(st => st.name.text));
const backImports = names.filter(n => remainingRefs.has(n)).map(n => ({ local: n, text: n, typeOnly: typeNames.has(n) }));
let targetSpec = path.relative(path.dirname(file), target).split(path.sep).join('/').replace(/\.ts$/, '');
if (!targetSpec.startsWith('.')) { targetSpec = './' + targetSpec; }
if (backImports.length) { newSource = addImports(newSource, file, new Map([[targetSpec, backImports]])); }
newSource = pruneImports(newSource, file);
fs.writeFileSync(file, newSource);

console.log(`moved ${statements.length} declarations to ${target}; ${backImports.length} imported back`);
if (stillNeeds.length) { console.log('still needs from ' + path.basename(file) + ': ' + stillNeeds.join(', ')); }
