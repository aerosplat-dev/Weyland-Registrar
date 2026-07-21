export const ROSTER_UID = 5000;
export const LOCATION_LIST_UID = 8000;
export const MAX_CHARACTER_UID = 7999;

const LOCATION_SLOTS_PER_ITEM = 20;
const CHARACTER_SLOTS_PER_ITEM = 5;

/**
 * Computes uid (and, via the Registrar's own sandboxed addLoreEntries, the
 * matching `order`/`displayIndex` fields -- confirmed by reading base.js
 * directly: it sets `order: id+5001` etc., mirroring `uid` exactly) for one
 * character's WI entries, from its 0-based SLOT INDEX among the currently
 * active characters -- NOT its raw Registrar characterId.
 *
 * This deliberately departs from a literal reproduction of the Registrar's
 * own characterId-based scheme (base = characterId*5). That scheme ties
 * every active character's uid to its raw, externally-assigned id, which is
 * neither small nor contiguous: real Registrar characterIds run well into
 * the 700s, so `characterId*5 + 5001` already exceeds 7999 (spilling into
 * LOCATION_LIST_UID's own 8000 and the location entries' reserved range)
 * for any characterId >= 600, and produces large, arbitrary gaps between
 * whichever characters happen to be active. Since syncCharacterBook fully
 * rebuilds the book from scratch on every sync (never a partial patch),
 * there is no requirement for a character's uid to stay stable across
 * syncs -- only that it's internally consistent and collision-free within
 * one sync. Compacting to a 0-based slot index keeps every active
 * character's block densely packed starting at 5001, supporting up to
 * (7999-5001+1)/5 = 599 simultaneously active characters -- well beyond
 * this catalog's entire size, even if every character were active at once.
 * @param {number} slotIndex - 0-based sequential position among active characters
 * @returns {{info: number, backstory: number, secrets: number, room: number, end: number}}
 */
export function characterEntryUids(slotIndex) {
    const base = Number(slotIndex) * CHARACTER_SLOTS_PER_ITEM;
    const end = base + 5005;
    if (end > MAX_CHARACTER_UID) {
        throw new Error(
            `Too many active characters (slot index ${slotIndex}): character entries would reach uid ${end}, exceeding the reserved 5001-${MAX_CHARACTER_UID} range`,
        );
    }
    return {
        info: base + 5001,
        backstory: base + 5002,
        secrets: base + 5003,
        room: base + 5004,
        end,
    };
}

/**
 * A uid scheme this extension owns (the Registrar's own location uids are just an
 * export-time sequential counter, not stable per location). Reserves
 * LOCATION_SLOTS_PER_ITEM uids per location: slot 0 for the main entry, the rest
 * for sub-locations.
 *
 * Like `characterEntryUids` above, `slotIndex` is the location's 0-based
 * sequential position among the currently active locations, not its raw
 * Registrar locationId -- the same raw-id-based sparseness/unbounded-growth
 * problem applies here too (nothing about locationId is small or
 * contiguous), even though there's no next reserved range immediately after
 * location space for it to collide into today.
 * @param {number} slotIndex - 0-based sequential position among active locations
 * @param {number} subLocationCount
 * @returns {{info: number, subLocations: number[]}}
 */
export function locationEntryUids(slotIndex, subLocationCount) {
    if (subLocationCount > LOCATION_SLOTS_PER_ITEM - 1) {
        throw new Error(
            `Too many sub-locations (${subLocationCount}) for location slot ${slotIndex}: max ${LOCATION_SLOTS_PER_ITEM - 1}`,
        );
    }
    const base = 8001 + Number(slotIndex) * LOCATION_SLOTS_PER_ITEM;
    const subLocations = [];
    for (let i = 0; i < subLocationCount; i++) {
        subLocations.push(base + 1 + i);
    }
    return { info: base, subLocations };
}
