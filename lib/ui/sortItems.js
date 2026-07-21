// lib/ui/sortItems.js

/**
 * Sorts catalog items by the given field. Every fetched Registrar record
 * kind (character/location/collection) carries name/createdAt/
 * updatedAt/ownerName uniformly (confirmed against the live API) -- this
 * function is generic over all of them. Items missing the sorted field
 * (e.g. a local collection missing createdAt, or a malformed date string)
 * sort to the end of the list regardless of direction, rather than
 * clustering at whatever position a NaN/undefined comparison would produce.
 * @param {Array<object>} items
 * @param {'name'|'created'|'updated'|'author'} field
 * @param {'asc'|'desc'} direction
 * @returns {Array<object>} a new array; the input is not mutated
 */
export function sortItems(items, field, direction) {
    const key = fieldKey(field);
    const sign = direction === 'desc' ? -1 : 1;
    const withValue = [];
    const withoutValue = [];
    for (const item of items) {
        const value = extractValue(item, key);
        if (value === null) withoutValue.push(item);
        else withValue.push({ item, value });
    }
    withValue.sort((a, b) => sign * compare(a.value, b.value, key));
    return [...withValue.map((w) => w.item), ...withoutValue];
}

function fieldKey(field) {
    if (field === 'created') return 'createdAt';
    if (field === 'updated') return 'updatedAt';
    if (field === 'author') return 'ownerName';
    return 'name';
}

function extractValue(item, key) {
    const raw = item[key];
    if (raw === undefined || raw === null || raw === '') return null;
    if (key === 'createdAt' || key === 'updatedAt') {
        const time = new Date(raw).getTime();
        return Number.isNaN(time) ? null : time;
    }
    // Trim before comparing: some Registrar records have incidental leading/
    // trailing whitespace in name/ownerName (confirmed live -- e.g. a
    // character record literally named " Lucia"), and a raw untrimmed
    // compare sorts a leading space before every letter, silently breaking
    // the visually-obvious alphabetical order a user expects.
    const trimmed = String(raw).trim();
    return trimmed === '' ? null : trimmed;
}

function compare(a, b, key) {
    if (key === 'createdAt' || key === 'updatedAt') return a - b;
    return String(a).localeCompare(String(b));
}
