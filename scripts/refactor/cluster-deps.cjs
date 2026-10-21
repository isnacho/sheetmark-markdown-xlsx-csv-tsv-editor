// Shows how a group of declarations inside a big file depends on the rest of it, to decide what can
// move to its own module and what it would need passed in.
//
//   node scripts/refactor/cluster-deps.cjs FILE name1 name2 ...   (the group, by declaration name)
//   node scripts/refactor/cluster-deps.cjs FILE 900 980           (every declaration starting on those lines)
//
// "Needs" lists declarations outside the group that the group uses: move them too, import them from
// an existing module, or pass them in through an init(hooks) function. "Used by" lists the outside
// code that will import from the new module.
const { parse, bodyStatements, declarations, referencedNames, lineOf } = require('./lib.cjs');

const [file, ...args] = process.argv.slice(2);
if (!file || !args.length) {
    console.error('usage: cluster-deps.cjs FILE (name... | FROM_LINE TO_LINE)');
    process.exit(2);
}
const sf = parse(file);
const decls = declarations(bodyStatements(sf));
const byRange = args.length === 2 && args.every(a => /^\d+$/.test(a));
const inGroup = byRange
    ? (st) => lineOf(sf, st) >= +args[0] && lineOf(sf, st) <= +args[1]
    : (st) => args.some(name => decls.get(name) === st);
if (!byRange) {
    const missing = args.filter(name => !decls.has(name));
    if (missing.length) { console.error('not declared at top level:', missing.join(', ')); process.exit(1); }
}

const needs = new Map();
const usedBy = new Map();
const add = (map, key, value) => { if (!map.has(key)) { map.set(key, new Set()); } map.get(key).add(value); };
for (const [name, st] of decls) {
    for (const ref of referencedNames(st)) {
        if (ref === name || !decls.has(ref)) { continue; }
        const from = inGroup(st);
        const to = inGroup(decls.get(ref));
        if (from && !to) { add(needs, ref, name); }
        if (!from && to) { add(usedBy, ref, name); }
    }
}

const list = (set, max = 8) => [...set].slice(0, max).join(', ') + (set.size > max ? ` (+${set.size - max})` : '');
console.log('Group:', [...new Set([...decls].filter(([, st]) => inGroup(st)).map(([n]) => n))].join(' '));
console.log('\nNeeds (outside declaration <- used by):');
for (const [k, v] of needs) { console.log(`  ${k} <- ${list(v)}`); }
console.log('\nUsed by outside code (group declaration <- users):');
for (const [k, v] of usedBy) { console.log(`  ${k} <- ${list(v)}`); }
