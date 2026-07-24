import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCollectionMembers } from '../lib/collectionResolver.js';

function makeCatalog() {
    return {
        characters: [
            { characterId: '1', itemKey: 'char:1', searchBlob: { owner: 'josh033169', species: 'nekomimi' } },
            { characterId: '2', itemKey: 'char:2', searchBlob: { owner: 'josh033169', species: 'wolf' } },
            { characterId: '3', itemKey: 'char:3', searchBlob: { owner: 'someoneelse', species: 'nekomimi' } },
        ],
        locations: [
            { locationId: '1', itemKey: 'loc:1', searchBlob: { owner: 'josh033169' } },
        ],
    };
}

test('resolves via filter string alone', () => {
    const collection = { filter: encodeURIComponent('owner:josh033169') };
    const members = resolveCollectionMembers(collection, makeCatalog());
    assert.deepEqual(members.sort(), ['char:1', 'char:2', 'loc:1']);
});

test('an empty filter matches every item, unfiltered -- matches the Registrar site\'s own filterList() behavior', () => {
    const collection = { filter: '' };
    const members = resolveCollectionMembers(collection, makeCatalog());
    assert.deepEqual(members.sort(), ['char:1', 'char:2', 'char:3', 'loc:1']);
});

// selectedCharacters/deselectedCharacters are NOT membership overrides --
// confirmed live against the real Registrar site across all 22 real
// collections (see collectionResolver.js's own doc comment for the evidence
// -- e.g. "Josh's Squirrel Hole" displays a deselected id and omits most of
// its 50 selected ids). This extension must never let them affect the
// resolved member set, even though they arrive as real fields on the raw
// collection record.
test('selectedCharacters and deselectedCharacters are ignored entirely, even when present on the record', () => {
    const collection = {
        filter: encodeURIComponent('owner:josh033169'),
        selectedCharacters: encodeURIComponent(JSON.stringify(['3'])), // would add char:3 under the old (wrong) model
        deselectedCharacters: encodeURIComponent(JSON.stringify(['2'])), // would remove char:2 under the old (wrong) model
        selectionMode: 'Static',
    };
    const members = resolveCollectionMembers(collection, makeCatalog());
    assert.deepEqual(members.sort(), ['char:1', 'char:2', 'loc:1']);
});

test('a filter matching nothing yields an empty set, not everything', () => {
    const collection = { filter: encodeURIComponent('owner:nobodyhere') };
    const members = resolveCollectionMembers(collection, makeCatalog());
    assert.deepEqual(members, []);
});
