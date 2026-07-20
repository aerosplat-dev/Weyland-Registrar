
export const FORCE = { NONE: 'none', ACTIVE: 'active', INACTIVE: 'inactive' };

/**
 * Resolves whether a single item (character or location) should be active,
 * given its forced override (if any) and the active/inactive state of every
 * collection, in priority order: forced-inactive > forced-active > collection
 * membership > default-inactive.
 * @param {string} itemKey - e.g. "char:1" or "loc:1"
 * @param {Object.<string, 'active'|'inactive'>} itemStates
 * @param {Object.<string, {active: boolean, memberKeys: string[]}>} collections
 * @returns {boolean}
 */
export function resolveItemActive(itemKey, itemStates, collections) {
    const forced = itemStates[itemKey];
    if (forced === FORCE.INACTIVE) return false;
    if (forced === FORCE.ACTIVE) return true;
    for (const collectionId in collections) {
        const collection = collections[collectionId];
        if (collection.active && collection.memberKeys.includes(itemKey)) {
            return true;
        }
    }
    return false;
}

/**
 * @param {string[]} itemKeys
 * @param {Object.<string, 'active'|'inactive'>} itemStates
 * @param {Object.<string, {active: boolean, memberKeys: string[]}>} collections
 * @returns {Set<string>}
 */
export function resolveAllActive(itemKeys, itemStates, collections) {
    const result = new Set();
    for (const key of itemKeys) {
        if (resolveItemActive(key, itemStates, collections)) {
            result.add(key);
        }
    }
    return result;
}
