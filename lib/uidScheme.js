export const ROSTER_UID = 5000;
export const LOCATION_LIST_UID = 8000;

const LOCATION_SLOTS_PER_ITEM = 20;

/**
 * Reproduces the Registrar's own character uid scheme exactly: base = characterId*5,
 * entries at base+5001..base+5005. Deterministic and collision-free per characterId.
 * @param {string|number} characterId
 * @returns {{info: number, backstory: number, secrets: number, room: number, end: number}}
 */
export function characterEntryUids(characterId) {
    const base = Number(characterId) * 5;
    return {
        info: base + 5001,
        backstory: base + 5002,
        secrets: base + 5003,
        room: base + 5004,
        end: base + 5005,
    };
}

/**
 * A uid scheme this extension owns (the Registrar's own location uids are just an
 * export-time sequential counter, not stable per location). Reserves
 * LOCATION_SLOTS_PER_ITEM uids per location: slot 0 for the main entry, the rest
 * for sub-locations.
 * @param {string|number} locationId
 * @param {number} subLocationCount
 * @returns {{info: number, subLocations: number[]}}
 */
export function locationEntryUids(locationId, subLocationCount) {
    if (subLocationCount > LOCATION_SLOTS_PER_ITEM - 1) {
        throw new Error(
            `Too many sub-locations (${subLocationCount}) for location ${locationId}: max ${LOCATION_SLOTS_PER_ITEM - 1}`,
        );
    }
    const base = 8001 + Number(locationId) * LOCATION_SLOTS_PER_ITEM;
    const subLocations = [];
    for (let i = 0; i < subLocationCount; i++) {
        subLocations.push(base + 1 + i);
    }
    return { info: base, subLocations };
}
