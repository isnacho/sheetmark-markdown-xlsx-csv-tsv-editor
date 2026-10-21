// Renames every variable or parameter called OLD in FILE to NEW, scope-aware (TypeScript language
// service). Use it to free a name before move-to-state.cjs, for example locals called `state`.
//
//   node scripts/refactor/rename-locals.cjs FILE TSCONFIG OLD NEW [ALT_LINES ALT_NAME]
//
// Declarations on the comma-separated ALT_LINES get ALT_NAME instead of NEW.
const fs = require('fs');
const path = require('path');
const { ts, parse, languageService, applyEdits, lineOf } = require('./lib.cjs');

const [file, tsconfig, oldName, newName, altLines = '', altName = ''] = process.argv.slice(2);
if (!file || !tsconfig || !oldName || !newName) {
    console.error('usage: rename-locals.cjs FILE TSCONFIG OLD NEW [ALT_LINES ALT_NAME]');
    process.exit(2);
}
const abs = path.resolve(file);
const text = fs.readFileSync(abs, 'utf8');
const ls = languageService(tsconfig, file, () => text);
const sf = ls.getProgram().getSourceFile(abs) || parse(abs, text);
const alt = new Set(altLines.split(',').filter(Boolean).map(Number));

const declNames = [];
(function walk(n) {
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n)) && ts.isIdentifier(n.name) && n.name.text === oldName) { declNames.push(n.name); }
    ts.forEachChild(n, walk);
})(sf);

const edits = new Map();
for (const id of declNames) {
    const target = alt.has(lineOf(sf, id)) ? altName : newName;
    for (const loc of ls.findRenameLocations(abs, id.getStart(sf), false, false, { providePrefixAndSuffixTextForRename: true }) || []) {
        edits.set(loc.textSpan.start, {
            start: loc.textSpan.start,
            end: loc.textSpan.start + loc.textSpan.length,
            newText: (loc.prefixText || '') + target + (loc.suffixText || ''),
        });
    }
}
fs.writeFileSync(abs, applyEdits(text, edits.values()));
console.log(`renamed ${declNames.length} declarations, ${edits.size} locations`);
