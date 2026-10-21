// Turns top-level `let`/`const` variables of a big file into fields of a shared `state` object:
// rewrites every reference to `state.NAME` (scope-aware, via the TypeScript language service, so a
// local variable with the same name is left alone) and deletes the declarations.
//
//   node scripts/refactor/move-to-state.cjs FILE TSCONFIG name1 name2 ...
//
// Add the fields to the module's state.ts (same names, same initial values) first, and import
// `state` in FILE. Rename any local variable called `state` first (rename-locals.cjs), or it will
// shadow the import. Then run check-types.
const fs = require('fs');
const path = require('path');
const { ts, parse, bodyStatements, languageService, applyEdits } = require('./lib.cjs');

const [file, tsconfig, ...names] = process.argv.slice(2);
if (!file || !tsconfig || !names.length) {
    console.error('usage: move-to-state.cjs FILE TSCONFIG name...');
    process.exit(2);
}
const abs = path.resolve(file);
let text = fs.readFileSync(abs, 'utf8');
const ls = languageService(tsconfig, file, () => text);
const sf = ls.getProgram().getSourceFile(abs) || parse(abs, text);

const edits = [];
const found = new Set();
for (const st of bodyStatements(sf)) {
    if (!ts.isVariableStatement(st)) { continue; }
    for (const d of st.declarationList.declarations) {
        const name = d.name.getText(sf);
        if (!names.includes(name)) { continue; }
        if (st.declarationList.declarations.length !== 1) { throw new Error(`split the multi-variable declaration of ${name} first`); }
        found.add(name);
        edits.push({ start: st.getFullStart(), end: st.getEnd(), newText: '' });
        const declStart = d.name.getStart(sf);
        for (const loc of ls.findRenameLocations(abs, declStart, false, false, { providePrefixAndSuffixTextForRename: true }) || []) {
            if (path.resolve(loc.fileName) !== abs) { throw new Error(`${name} is used in ${loc.fileName}; export it from state.ts by hand`); }
            if (loc.textSpan.start === declStart) { continue; }
            edits.push({
                start: loc.textSpan.start,
                end: loc.textSpan.start + loc.textSpan.length,
                newText: (loc.prefixText || '') + 'state.' + name + (loc.suffixText || ''),
            });
        }
    }
}
const missing = names.filter(n => !found.has(n));
if (missing.length) { throw new Error('not declared at top level: ' + missing.join(', ')); }
fs.writeFileSync(abs, applyEdits(text, edits));
console.log(`rewrote ${edits.length - found.size} references, removed ${found.size} declarations`);
