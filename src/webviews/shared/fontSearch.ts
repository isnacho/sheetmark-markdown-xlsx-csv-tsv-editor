// Search for the Font picker's list. Pure (no DOM) so it can be unit tested.

/** Lower case, accents removed, spaces collapsed: "Éclair  Sans" and "eclair sans" are the same. */
function normalize(text: string): string {
    return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * The names that match `query`, best matches first. Every word typed must appear in the name, in any
 * order ("neue hel" finds "Helvetica Neue"). Names that start with the query come first, then names
 * with a word that starts with the first typed word, then the rest; each group keeps the order of `names`.
 * An empty query returns every name unchanged.
 */
export function filterFontNames(names: readonly string[], query: string): string[] {
    const wanted = normalize(query);
    if (!wanted) { return [...names]; }
    const words = wanted.split(' ');

    const ranked: Array<{ name: string; rank: number; order: number }> = [];
    names.forEach((name, order) => {
        const haystack = normalize(name);
        if (!words.every(word => haystack.includes(word))) { return; }
        let rank = 2;
        if (haystack.startsWith(wanted)) { rank = 0; }
        else if (haystack.split(' ').some(part => part.startsWith(words[0]))) { rank = 1; }
        ranked.push({ name, rank, order });
    });
    return ranked.sort((a, b) => a.rank - b.rank || a.order - b.order).map(entry => entry.name);
}
