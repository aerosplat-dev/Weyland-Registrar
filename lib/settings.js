export const MODULE_NAME = 'Weyland-Registrar';

/**
 * @typedef {Object} WeylandRegistrarSettings
 * @property {string} apiBaseUrl
 * @property {number} refreshIntervalMinutes
 * @property {Object.<string, 'active'|'inactive'>} itemStates - itemKey -> forced override
 * @property {Object.<string, {active: boolean, source: 'registrar'|'local'}>} collections
 * @property {Object.<string, {name: string, memberKeys: string[]}>} localCollections
 * @property {Object.<string, {book: string, active: boolean}>} scenarioBooks - loreId -> book state
 */
export const defaultSettings = {
    apiBaseUrl: 'https://registrar.weybooru.com',
    refreshIntervalMinutes: 60,
    itemStates: {},
    collections: {},
    localCollections: {},
    scenarioBooks: {},
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
    return settings;
}
