/**
 * Parses a Registrar-style search string ("species:neko owner:!bob \"exact phrase\"")
 * into structured terms. Ported from the algorithm inside the Registrar's own
 * filterList() (base.js) — deliberately excludes its DOM-dependent bits
 * (owner:me resolution, update: timestamp windows) since this extension has
 * no authenticated Registrar session to resolve those against.
 * @param {string} searchString
 * @returns {Array<{prop: string, value: string, negate: boolean}>}
 */
export function parseSearchTerms(searchString) {
    if (!searchString) return [];
    let str = searchString;
    const phrases = str.match(/".+"/g) || [];
    for (const phrase of phrases) {
        str = str.replace(phrase, '');
    }
    const words = str.split(/\s+/g).filter(Boolean);
    const terms = [];
    for (const word of words) {
        const frags = word.match(/([\w]+):(.+)/);
        if (frags && frags.length === 3) {
            const val = frags[2];
            if (val.charAt(0) === '!') {
                terms.push({ prop: frags[1], value: val.slice(1), negate: true });
            } else {
                terms.push({ prop: frags[1], value: val, negate: false });
            }
        } else {
            terms.push({ prop: 'master', value: word, negate: false });
        }
    }
    for (const phrase of phrases) {
        terms.push({ prop: 'master', value: phrase.slice(1, -1), negate: false });
    }
    return terms;
}

/**
 * @param {Object.<string, string>} searchBlob - lowercase, flattened searchable fields for one record
 * @param {Array<{prop: string, value: string, negate: boolean}>} terms
 * @returns {boolean} true if the record matches every term (AND)
 */
export function matchesTerms(searchBlob, terms) {
    for (const term of terms) {
        if (searchBlob[term.prop] === undefined) continue;
        const options = String(term.value).toLowerCase().split('|');
        const haystack = String(searchBlob[term.prop]);
        if (term.negate) {
            for (const option of options) {
                if (option && haystack.includes(option)) return false;
            }
        } else {
            let found = false;
            for (const option of options) {
                if (option && haystack.includes(option)) { found = true; break; }
            }
            if (!found) return false;
        }
    }
    return true;
}
