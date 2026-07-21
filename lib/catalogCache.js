const KEYS = {
    characters: 'weyland-registrar:catalog:characters',
    locations: 'weyland-registrar:catalog:locations',
    collections: 'weyland-registrar:catalog:collections',
    lastRefreshed: 'weyland-registrar:catalog:lastRefreshed',
};

/**
 * @typedef {Object} StorageEngine
 * @property {(key: string) => Promise<any>} get
 * @property {(key: string, value: any) => Promise<void>} set
 * @property {(key: string) => Promise<void>} delete
 */

/**
 * Wraps an injectable async key-value storage engine with typed
 * catalog-cache accessors. The real engine is IndexedDB-backed
 * (see createIndexedDbStorageEngine below, browser-only); tests inject an
 * in-memory Map-based fake instead.
 * @param {StorageEngine} storageEngine
 */
export function createCatalogCache(storageEngine) {
    const makeAccessor = (key) => ({
        get: () => storageEngine.get(key),
        set: (value) => storageEngine.set(key, value),
    });

    const characters = makeAccessor(KEYS.characters);
    const locations = makeAccessor(KEYS.locations);
    const collections = makeAccessor(KEYS.collections);
    const lastRefreshed = makeAccessor(KEYS.lastRefreshed);

    return {
        getCharacters: characters.get,
        setCharacters: characters.set,
        getLocations: locations.get,
        setLocations: locations.set,
        getCollections: collections.get,
        setCollections: collections.set,
        getLastRefreshed: lastRefreshed.get,
        setLastRefreshed: lastRefreshed.set,
    };
}

/**
 * Real browser storage engine backed by IndexedDB. Not unit-tested (no
 * IndexedDB in plain node --test) -- verified via live-browser E2E instead,
 * per the plan's accepted browser-only-coverage areas.
 * @returns {StorageEngine}
 */
export function createIndexedDbStorageEngine() {
    const DB_NAME = 'weyland-registrar-catalog';
    const STORE_NAME = 'kv';

    // Memoized so indexedDB.open() runs at most once per page session --
    // every get/set/delete call previously opened a fresh connection, which
    // materially added latency to every modal-open (4 sequential catalog
    // reads) and every activate/deactivate (a syncBooks re-read). Nulled out
    // on failure so a later call can retry instead of being stuck on a
    // rejected promise forever.
    let dbPromise = null;
    function openDb() {
        if (!dbPromise) {
            dbPromise = new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, 1);
                request.onupgradeneeded = () => {
                    request.result.createObjectStore(STORE_NAME);
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => {
                    dbPromise = null;
                    reject(request.error);
                };
            });
        }
        return dbPromise;
    }

    async function withStore(mode, callback) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, mode);
            const store = tx.objectStore(STORE_NAME);
            const request = callback(store);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    return {
        get: (key) => withStore('readonly', (store) => store.get(key)),
        set: (key, value) => withStore('readwrite', (store) => store.put(value, key)),
        delete: (key) => withStore('readwrite', (store) => store.delete(key)),
    };
}
