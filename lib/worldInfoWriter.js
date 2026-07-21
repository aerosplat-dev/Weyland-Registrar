import { resolveAllActive } from './activationState.js';
import { buildCharacterRosterText, buildLocationListText } from './rosterBuilder.js';
import { buildCharacterEntries, buildLocationEntries } from './entryBuilder.js';
import { ROSTER_UID, LOCATION_LIST_UID } from './uidScheme.js';

export const CHARACTER_BOOK_NAME = 'Lore Book - Weyland Registrar';
export const LOCATION_BOOK_NAME = 'World Book - Community Locations';

/**
 * Required sequence: write -> refresh book list -> activate. Never reorder --
 * skipping updateWorldInfoList before activating silently toasts
 * "No world found" instead of erroring.
 * @param {object} stContext - subset of getContext(): loadWorldInfo, saveWorldInfo, updateWorldInfoList, executeSlashCommandsWithOptions
 * @param {string} bookName
 * @param {object} bookData
 */
async function writeAndActivate(stContext, bookName, bookData) {
    await stContext.saveWorldInfo(bookName, bookData, true);
    await stContext.updateWorldInfoList();
    await stContext.executeSlashCommandsWithOptions(`/world state=on silent=true "${bookName}"`);
}

/**
 * Rebuilds the entire shared character book from the complete active set --
 * never a partial patch. Removes entries for characters no longer active,
 * builds fresh entries (via the sandbox) for characters newly active, and
 * always fully regenerates the single roster entry (uid 5000).
 * @param {object} stContext
 * @param {(name: string, args: any[]) => Promise<any>} callFunction - entrySandbox's callFunction
 * @param {import('./settings.js').WeylandRegistrarSettings} settings
 * @param {Object.<string, object>} allCharacterRecordsByKey - itemKey ("char:<id>") -> raw record, for every character the caller knows about (not just active ones)
 */
export async function syncCharacterBook(stContext, callFunction, settings, allCharacterRecordsByKey) {
    const collectionsWithMembers = resolveCollectionsForActivation(settings);
    const activeKeys = resolveAllActive(Object.keys(allCharacterRecordsByKey), settings.itemStates, collectionsWithMembers);

    const entries = {};
    // Each active character gets the next compact 0-based slot index (NOT
    // its raw characterId -- see uidScheme.js's own doc for why), so uids
    // stay densely packed starting at 5001 regardless of how sparse/large
    // the underlying characterIds are. Only increments for characters that
    // actually get an entry built, so a missing record never wastes a slot.
    let slotIndex = 0;
    for (const key of activeKeys) {
        const record = allCharacterRecordsByKey[key];
        if (!record) continue;
        const characterEntries = await buildCharacterEntries(callFunction, slotIndex, record);
        Object.assign(entries, characterEntries);
        slotIndex++;
    }

    const activeRecords = [...activeKeys].map(key => allCharacterRecordsByKey[key]).filter(Boolean);
    entries[ROSTER_UID] = {
        uid: ROSTER_UID,
        key: [],
        keysecondary: [],
        comment: 'Character Roster',
        content: buildCharacterRosterText(activeRecords),
        constant: true,
        position: 1,
        disable: false,
        order: 5000,
    };

    await writeAndActivate(stContext, CHARACTER_BOOK_NAME, { entries });
}

/**
 * Same regenerate-from-scratch contract as syncCharacterBook, for locations.
 * @param {object} stContext
 * @param {(name: string, args: any[]) => Promise<any>} callFunction
 * @param {import('./settings.js').WeylandRegistrarSettings} settings
 * @param {Object.<string, object>} allLocationRecordsByKey - itemKey ("loc:<id>") -> raw record
 */
export async function syncLocationBook(stContext, callFunction, settings, allLocationRecordsByKey) {
    const collectionsWithMembers = resolveCollectionsForActivation(settings);
    const activeKeys = resolveAllActive(Object.keys(allLocationRecordsByKey), settings.itemStates, collectionsWithMembers);

    const entries = {};
    // Same compact 0-based slot-index treatment as syncCharacterBook above,
    // not the raw locationId -- see uidScheme.js's own doc.
    let slotIndex = 0;
    for (const key of activeKeys) {
        const record = allLocationRecordsByKey[key];
        if (!record) continue;
        const locationEntries = await buildLocationEntries(callFunction, slotIndex, record);
        Object.assign(entries, locationEntries);
        slotIndex++;
    }

    const activeRecords = [...activeKeys].map(key => allLocationRecordsByKey[key]).filter(Boolean);
    entries[LOCATION_LIST_UID] = {
        uid: LOCATION_LIST_UID,
        key: [],
        keysecondary: [],
        comment: 'Location List',
        content: buildLocationListText(activeRecords),
        constant: true,
        position: 1,
        disable: false,
        order: 8000,
    };

    await writeAndActivate(stContext, LOCATION_BOOK_NAME, { entries });
}

/**
 * Collections stored in settings only carry {active, source} -- member
 * resolution happens elsewhere (collectionResolver.js for Registrar
 * collections, localCollections storage directly for local ones) and must
 * be merged in by the caller before this point in a real boot sequence
 * (Task 17). Tests pass settings.collections already carrying memberKeys.
 * @param {import('./settings.js').WeylandRegistrarSettings} settings
 */
function resolveCollectionsForActivation(settings) {
    const result = {};
    for (const [id, collection] of Object.entries(settings.collections)) {
        result[id] = { active: !!collection.active, memberKeys: collection.memberKeys ?? [] };
    }
    return result;
}
