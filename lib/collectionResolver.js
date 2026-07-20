import { parseSearchTerms, matchesTerms } from './filterQuery.js';

/**
 * Resolves a Registrar collection record (its saved search filter plus
 * explicit selected/deselected id overrides, matching the site's own
 * "Dynamic"/"Static" selectionMode convention) into a concrete set of itemKeys.
 * @param {{filter?: string, selectedCharacters?: string, deselectedCharacters?: string}} collectionRecord
 * @param {{characters: Array<object>, locations: Array<object>}} catalog - every record augmented with .itemKey and .searchBlob
 * @returns {string[]}
 */
export function resolveCollectionMembers(collectionRecord, catalog) {
    const allItems = [...catalog.characters, ...catalog.locations];
    const filterString = safeDecode(collectionRecord.filter);
    const terms = filterString ? parseSearchTerms(filterString) : [];
    const matched = terms.length ? allItems.filter(item => matchesTerms(item.searchBlob, terms)) : [];

    const memberKeys = new Set(matched.map(item => item.itemKey));

    for (const id of parseIdArray(collectionRecord.selectedCharacters)) {
        const key = findItemKeyById(allItems, id);
        if (key) memberKeys.add(key);
    }
    for (const id of parseIdArray(collectionRecord.deselectedCharacters)) {
        const key = findItemKeyById(allItems, id);
        if (key) memberKeys.delete(key);
    }

    return [...memberKeys];
}

function safeDecode(value) {
    if (!value) return '';
    try {
        return decodeURIComponent(value);
    } catch {
        return '';
    }
}

function parseIdArray(encoded) {
    const decoded = safeDecode(encoded);
    if (!decoded) return [];
    try {
        const parsed = JSON.parse(decoded);
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
        return [];
    }
}

function findItemKeyById(allItems, id) {
    const found = allItems.find(item => String(item.characterId ?? item.locationId) === String(id));
    return found ? found.itemKey : null;
}
