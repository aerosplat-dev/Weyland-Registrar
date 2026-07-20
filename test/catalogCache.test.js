import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogCache } from '../lib/catalogCache.js';

function createInMemoryStorageEngine() {
    const store = new Map();
    return {
        async get(key) { return store.has(key) ? store.get(key) : undefined; },
        async set(key, value) { store.set(key, value); },
        async delete(key) { store.delete(key); },
    };
}

test('returns undefined for characters before anything is cached', async () => {
    const cache = createCatalogCache(createInMemoryStorageEngine());
    assert.equal(await cache.getCharacters(), undefined);
});

test('round-trips characters', async () => {
    const cache = createCatalogCache(createInMemoryStorageEngine());
    const records = [{ characterId: '1', name: 'Maeve' }];
    await cache.setCharacters(records);
    assert.deepEqual(await cache.getCharacters(), records);
});

test('round-trips locations, collections, and lore independently', async () => {
    const cache = createCatalogCache(createInMemoryStorageEngine());
    await cache.setLocations([{ locationId: '1' }]);
    await cache.setCollections([{ collectionId: '1' }]);
    await cache.setLore([{ loreId: '1' }]);
    assert.deepEqual(await cache.getLocations(), [{ locationId: '1' }]);
    assert.deepEqual(await cache.getCollections(), [{ collectionId: '1' }]);
    assert.deepEqual(await cache.getLore(), [{ loreId: '1' }]);
    assert.equal(await cache.getCharacters(), undefined);
});

test('tracks last-refreshed timestamp per call', async () => {
    const cache = createCatalogCache(createInMemoryStorageEngine());
    assert.equal(await cache.getLastRefreshed(), undefined);
    await cache.setLastRefreshed(1234567890);
    assert.equal(await cache.getLastRefreshed(), 1234567890);
});
