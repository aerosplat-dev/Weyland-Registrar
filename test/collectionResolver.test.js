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

test('resolves via filter string only', () => {
    const collection = { filter: encodeURIComponent('owner:josh033169'), selectedCharacters: '', deselectedCharacters: '' };
    const members = resolveCollectionMembers(collection, makeCatalog());
    assert.deepEqual(members.sort(), ['char:1', 'char:2', 'loc:1']);
});

test('deselectedCharacters removes a filter-matched member', () => {
    const collection = {
        filter: encodeURIComponent('owner:josh033169'),
        selectedCharacters: '',
        deselectedCharacters: encodeURIComponent(JSON.stringify(['2'])),
    };
    const members = resolveCollectionMembers(collection, makeCatalog());
    assert.deepEqual(members.sort(), ['char:1', 'loc:1']);
});

test('selectedCharacters adds a member the filter did not match', () => {
    const collection = {
        filter: encodeURIComponent('owner:josh033169'),
        selectedCharacters: encodeURIComponent(JSON.stringify(['3'])),
        deselectedCharacters: '',
    };
    const members = resolveCollectionMembers(collection, makeCatalog());
    assert.deepEqual(members.sort(), ['char:1', 'char:2', 'char:3', 'loc:1']);
});

test('no filter, only explicit selectedCharacters', () => {
    const collection = { filter: '', selectedCharacters: encodeURIComponent(JSON.stringify(['1', '3'])), deselectedCharacters: '' };
    const members = resolveCollectionMembers(collection, makeCatalog());
    assert.deepEqual(members.sort(), ['char:1', 'char:3']);
});

test('malformed selectedCharacters JSON does not throw, yields no additions', () => {
    const collection = { filter: '', selectedCharacters: 'not-json', deselectedCharacters: '' };
    assert.doesNotThrow(() => resolveCollectionMembers(collection, makeCatalog()));
    assert.deepEqual(resolveCollectionMembers(collection, makeCatalog()), []);
});
