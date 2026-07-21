/**
 * crypto.randomUUID() requires a secure context (HTTPS or the literal "localhost" origin).
 * Weyland Tavern is commonly accessed over plain HTTP via a LAN IP, where randomUUID is
 * undefined but crypto.getRandomValues() (not secure-context-gated) still works.
 * @returns {string}
 */
function generateUuid() {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
}

/**
 * @param {import('./settings.js').WeylandRegistrarSettings} settings
 * @param {string} name
 * @param {string[]} [memberKeys]
 * @returns {string} the new local collection's id, formatted "local:<uuid>"
 */
export function createLocalCollection(settings, name, memberKeys = []) {
    const id = `local:${generateUuid()}`;
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
