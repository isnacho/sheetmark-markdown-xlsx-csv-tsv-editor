declare module 'typo-js' {
    export default class Typo {
        constructor(locale: string, affData?: string, wordsData?: string);
        check(word: string): boolean;
        suggest(word: string, limit?: number): string[];
    }
}
