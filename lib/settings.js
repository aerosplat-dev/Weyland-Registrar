export const MODULE_NAME = 'Weyland-Registrar';

/**
 * @typedef {Object} WeylandRegistrarSettings
 * @property {string} apiBaseUrl
 * @property {number} refreshIntervalMinutes
 * @property {Object.<string, 'active'>} itemStates - itemKey -> forced-active pin (absent = not pinned)
 * @property {Object.<string, {active: boolean, source: 'registrar'|'local'}>} collections
 * @property {Object.<string, {name: string, memberKeys: string[]}>} localCollections
 */
export const defaultSettings = {
    apiBaseUrl: 'https://registrar.weybooru.com',
    refreshIntervalMinutes: 60,
    itemStates: {},
    collections: {},
    localCollections: {},
};

/**
 * Ensures extensionSettings[MODULE_NAME] exists and has every current default key,
 * without overwriting any existing value. Returns the (possibly newly-created) settings object.
 * @param {object} extensionSettings - SillyTavern's global extensionSettings object
 * @returns {WeylandRegistrarSettings}
 */
export function getSettings(extensionSettings) {
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    const settings = extensionSettings[MODULE_NAME];
    for (const key in defaultSettings) {
        if (settings[key] === undefined) {
            settings[key] = structuredClone(defaultSettings[key]);
        }
    }
    // "Pinned inactive" was removed (see activationState.js) -- only a
    // forced-active pin can exist now. Strip any legacy 'inactive' value a
    // prior version of this extension wrote, so a stale entry doesn't show a
    // contradictory "Pinned inactive" badge on an item that's actually
    // active via a collection.
    for (const key in settings.itemStates) {
        if (settings.itemStates[key] !== 'active') {
            delete settings.itemStates[key];
        }
    }
    return settings;
}
