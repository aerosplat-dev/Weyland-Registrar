import test from 'node:test';
import assert from 'node:assert/strict';
import { getSettings } from '../lib/settings.js';
import {
    createLocalCollection,
    updateLocalCollectionMembers,
    renameLocalCollection,
    deleteLocalCollection,
} from '../lib/localCollections.js';

test('creates a local collection with a unique local: id', () => {
    const settings = getSettings({});
    const id = createLocalCollection(settings, 'My Roleplay Cast', ['char:1', 'loc:2']);
    assert.match(id, /^local:/);
    assert.deepEqual(settings.localCollections[id], { name: 'My Roleplay Cast', memberKeys: ['char:1', 'loc:2'] });
});

test('two collections created in a row get different ids', () => {
    const settings = getSettings({});
    const id1 = createLocalCollection(settings, 'A');
    const id2 = createLocalCollection(settings, 'B');
    assert.notEqual(id1, id2);
});

test('updateLocalCollectionMembers replaces the member list', () => {
    const settings = getSettings({});
    const id = createLocalCollection(settings, 'Cast', ['char:1']);
    updateLocalCollectionMembers(settings, id, ['char:1', 'char:2', 'loc:1']);
    assert.deepEqual(settings.localCollections[id].memberKeys, ['char:1', 'char:2', 'loc:1']);
});

test('updateLocalCollectionMembers on unknown id throws', () => {
    const settings = getSettings({});
    assert.throws(() => updateLocalCollectionMembers(settings, 'local:missing', []), /unknown/i);
});

test('renameLocalCollection updates the name only', () => {
    const settings = getSettings({});
    const id = createLocalCollection(settings, 'Old Name', ['char:1']);
    renameLocalCollection(settings, id, 'New Name');
    assert.equal(settings.localCollections[id].name, 'New Name');
    assert.deepEqual(settings.localCollections[id].memberKeys, ['char:1']);
});

test('deleteLocalCollection removes both the definition and its activation state', () => {
    const settings = getSettings({});
    const id = createLocalCollection(settings, 'Temp');
    settings.collections[id] = { active: true, source: 'local' };
    deleteLocalCollection(settings, id);
    assert.equal(settings.localCollections[id], undefined);
    assert.equal(settings.collections[id], undefined);
});
