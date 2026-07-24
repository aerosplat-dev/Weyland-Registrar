import { parseSearchTerms, matchesTerms } from './filterQuery.js';

/**
 * Resolves a Registrar collection record's saved search filter into a
 * concrete set of itemKeys against our own catalog.
 *
 * `selectedCharacters`/`deselectedCharacters`/`selectionMode` are NOT
 * consulted here, despite naming that suggests they're membership overrides
 * -- confirmed live against the real site (registrar.weybooru.com's own
 * /collections/<id> page) that they are not. "Josh's Squirrel Hole"
 * (Dynamic, 50 selectedCharacters, 1 deselectedCharacters) displays exactly
 * the 5 characters its filter ("owner:josh033169") matches against the
 * CURRENT catalog -- including a deselected id that's still shown, and
 * excluding 46 selected ids that aren't. "Kemetic Folks" (Static, empty
 * filter, only 10 selectedCharacters) displays all 454 characters and 35
 * locations that exist -- an empty filter matches everything, exactly like
 * the site's own filterList(), regardless of any selected/deselected list.
 * Cross-checked against all 22 real collections on the live site (both
 * Dynamic and Static, including collections with prop-prefixed filters and
 * mixed character+location membership): pure live filter re-evaluation
 * matches the site's own display in every case. selectedCharacters/
 * deselectedCharacters/selectionMode are left in the raw collection record
 * (site UI bulk-selection-checkbox state, unrelated to true membership) but
 * this extension never reads them.
 * @param {{filter?: string}} collectionRecord
 * @param {{characters: Array<object>, locations: Array<object>}} catalog - every record augmented with .itemKey and .searchBlob
 * @returns {string[]}
 */
export function resolveCollectionMembers(collectionRecord, catalog) {
    const allItems = [...catalog.characters, ...catalog.locations];
    const filterString = safeDecode(collectionRecord.filter);
    // Matches the Registrar's own filterList(): no search string returns
    // every item, unfiltered.
    if (!filterString) return allItems.map(item => item.itemKey);

    const terms = parseSearchTerms(filterString);
    return allItems.filter(item => matchesTerms(item.searchBlob, terms)).map(item => item.itemKey);
}

function safeDecode(value) {
    if (!value) return '';
    try {
        return decodeURIComponent(value);
    } catch {
        return '';
    }
}
