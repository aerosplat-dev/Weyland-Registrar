
export const FORCE = { NONE: 'none', ACTIVE: 'active' };

/**
 * Resolves whether a single item (character or location) should be active,
 * given its forced-active override (if any) and the active/inactive state of
 * every collection, in priority order: forced-active > collection membership
 * > default-inactive.
 *
 * There is deliberately no forced-inactive override: pinning an item active
 * protects it from a collection deactivation (an independently-enabled item
 * should stay on even if a collection it also belongs to turns off), but
 * nothing pins an item OFF against collection membership -- an item that's
 * active via a collection can only be turned off by deactivating that
 * collection. A prior version of this extension did write a forced-inactive
 * override here; see settings.js's getSettings() for the migration that
 * strips any such legacy value out of a loaded settings object.
 * @param {string} itemKey - e.g. "char:1" or "loc:1"
 * @param {Object.<string, 'active'>} itemStates
 * @param {Object.<string, {active: boolean, memberKeys: string[]}>} collections
 * @returns {boolean}
 */
export function resolveItemActive(itemKey, itemStates, collections) {
    if (itemStates[itemKey] === FORCE.ACTIVE) return true;
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
 * @param {Object.<string, 'active'>} itemStates
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
