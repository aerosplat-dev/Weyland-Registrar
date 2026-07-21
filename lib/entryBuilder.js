import { characterEntryUids, locationEntryUids } from './uidScheme.js';

// Exported object so tests can temporarily override the timeout for faster timeout testing
export const config = { callFunctionTimeoutMs: 10000 }; // 10 second timeout for sandbox calls

/**
 * Wraps a callFunction with a timeout to prevent indefinite hangs if the sandbox stalls.
 *
 * Exported so any other module that calls into the same sandbox can reuse
 * this exact wrapping instead of duplicating it, and shares the one
 * `config.callFunctionTimeoutMs` knob above.
 * @param {(name: string, args: any[]) => Promise<any>} callFunction
 * @param {string} name - function name to call in sandbox
 * @param {any[]} args - arguments to pass
 * @returns {Promise<any>} result of the call, or rejects with TimeoutError after configured timeout
 */
export function withTimeout(callFunction, name, args) {
    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(
            () => reject(new Error(`Sandbox call '${name}' timed out after ${config.callFunctionTimeoutMs}ms`)),
            config.callFunctionTimeoutMs,
        );
    });

    return Promise.race([
        callFunction(name, args),
        timeoutPromise,
    ]).finally(() => {
        clearTimeout(timeoutHandle);
    });
}

/**
 * @param {(name: string, args: any[]) => Promise<any>} callFunction - matches entrySandbox.js's callFunction
 * @param {string|number} characterId
 * @param {object} record - raw character record from /data/list
 * @returns {Promise<Object.<number, object>>} uid -> WI entry, for this one character only
 */
export async function buildCharacterEntries(callFunction, characterId, record) {
    const uids = characterEntryUids(characterId);
    const emptyBook = { count: 0, entries: {} };
    const built = await withTimeout(callFunction, 'addLoreEntries', [emptyBook, Number(characterId) * 5, record]);
    // addLoreEntries returns the full book; extract only this character's own entries.
    const ownUids = new Set(Object.values(uids));
    const entries = {};
    for (const [uid, entry] of Object.entries(built.entries)) {
        if (ownUids.has(Number(uid))) entries[uid] = entry;
    }
    return entries;
}

/**
 * @param {(name: string, args: any[]) => Promise<any>} callFunction
 * @param {string|number} locationId
 * @param {object} record - raw location record from /loci/list
 * @returns {Promise<Object.<number, object>>} uid -> WI entry, for this one location only
 */
export async function buildLocationEntries(callFunction, locationId, record) {
    const subLocations = await withTimeout(callFunction, 'parseLocationSubLocations', [record]);
    const uids = locationEntryUids(locationId, subLocations.length);
    const emptyBook = { count: 0, entries: {} };

    let book = await withTimeout(callFunction, 'addWorldEntries', [emptyBook, uids.info, record]);
    for (let i = 0; i < subLocations.length; i++) {
        book = await withTimeout(callFunction, 'addSubLocationEntry', [book, uids.subLocations[i], uids.info, record.name, subLocations[i]]);
    }

    const ownUids = new Set([uids.info, ...uids.subLocations]);
    const entries = {};
    for (const [uid, entry] of Object.entries(book.entries)) {
        if (ownUids.has(Number(uid))) entries[uid] = entry;
    }
    return entries;
}
