/**
 * @param {import('./settings.js').WeylandRegistrarSettings} settings
 * @param {string} name
 * @param {string[]} [memberKeys]
 * @returns {string} the new local collection's id, formatted "local:<uuid>"
 */
export function createLocalCollection(settings, name, memberKeys = []) {
    const id = `local:${globalThis.crypto.randomUUID()}`;
    settings.localCollections[id] = { name, memberKeys: [...memberKeys] };
    return id;
}

/**
 * @param {import('./settings.js').WeylandRegistrarSettings} settings
 * @param {string} id
 * @param {string[]} memberKeys
 */
export function updateLocalCollectionMembers(settings, id, memberKeys) {
    if (!settings.localCollections[id]) {
        throw new Error(`Unknown local collection: ${id}`);
    }
    settings.localCollections[id].memberKeys = [...memberKeys];
}

/**
 * @param {import('./settings.js').WeylandRegistrarSettings} settings
 * @param {string} id
 * @param {string} name
 */
export function renameLocalCollection(settings, id, name) {
    if (!settings.localCollections[id]) {
        throw new Error(`Unknown local collection: ${id}`);
    }
    settings.localCollections[id].name = name;
}

/**
 * @param {import('./settings.js').WeylandRegistrarSettings} settings
 * @param {string} id
 */
export function deleteLocalCollection(settings, id) {
    delete settings.localCollections[id];
    delete settings.collections[id];
}
