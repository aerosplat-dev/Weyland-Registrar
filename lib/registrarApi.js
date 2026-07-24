/**
 * @param {object} record
 * @param {'character'|'location'} itemType
 * @returns {string}
 */
export function toItemKey(record, itemType) {
    return itemType === 'character' ? `char:${record.characterId}` : `loc:${record.locationId}`;
}

/**
 * Parses a Registrar outfitEntries JSON blob (an array of {name, description})
 * the same way the site's own parseCharacterOutfitEntries does. Never throws.
 * @param {string|Array|null|undefined} raw
 * @returns {Array|null}
 */
function parseCharacterOutfitEntries(raw) {
    if (raw == null) return null;
    let arr = raw;
    if (typeof raw === 'string') {
        try {
            arr = JSON.parse(raw);
        } catch {
            return null;
        }
    }
    return Array.isArray(arr) ? arr : null;
}

/**
 * Ported from the Registrar's own outfitSearchBlobForCharacter (base.js):
 * prefers the newer outfitEntries array, falls back to the legacy flat
 * outfit fields when a character predates that format.
 * @param {object} record
 * @returns {string}
 */
function outfitSearchBlobForCharacter(record) {
    const lc = (value) => String(value ?? '').toLowerCase();
    const arr = parseCharacterOutfitEntries(record.outfitEntries);
    if (record.outfitEntries != null) {
        if (arr === null) return '';
        return arr.map(o => `${lc(o.name)} ${lc(o.description)}`).join(' ');
    }
    return `${lc(record.casualOutfit)} ${lc(record.nightOutfit)} ${lc(record.chillingOutfit)} ${lc(record.winterOutfit)} ${lc(record.underwearOutfit)}`;
}

/**
 * Ported from the Registrar's own parseLocationSubLocations (base.js). Never throws.
 * @param {object} record
 * @returns {Array}
 */
function parseLocationSubLocations(record) {
    if (!record || record.subLocations == null) return [];
    try {
        const raw = record.subLocations;
        const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

/**
 * Flattens the fields relevant to search filtering into a lowercase blob --
 * a field-for-field port of the Registrar's own makeCharacterSearchable/
 * makeLocationSearchable (base.js), including the "master" catch-all field
 * (every other blob field concatenated), so filter strings copied from the
 * Registrar -- and any prop-prefixed term ("personality:shy", "home:dorm")
 * -- match our own catalog exactly the same way they match on the real site.
 * A narrower, hand-picked field set was tried first and found to under-match:
 * confirmed live against all 22 real Registrar collections (including
 * prop-prefixed filters like "owner:Josh type:location status:wip" and
 * master-field-only filters like "WUPD", which only appears in fields this
 * blob now covers -- personality/relationships/room/backgroundKeywords/
 * onlineHandle/outfitEntries -- not in name/surname/summary).
 * @param {object} record
 * @param {'character'|'location'} itemType
 * @returns {Object.<string, string>}
 */
export function buildSearchBlob(record, itemType) {
    const lc = (value) => String(value ?? '').toLowerCase();
    if (itemType === 'character') {
        const blob = {
            type: 'character',
            tags: lc(record.tags),
            handle: lc(record.onlineHandle),
            ownerId: lc(record.ownerId),
            owner: lc(record.ownerName),
            status: lc(record.status),
            name: `${lc(record.name)} ${lc(record.surname)}`,
            gender: lc(record.gender),
            species: lc(record.species),
            major: lc(record.major),
            summary: lc(record.summary),
        };
        blob.personality = lc(record.personality);
        blob.speech = lc(record.speech);
        blob.quirks = lc(record.quirks);
        blob.likes = lc(record.likes);
        blob.dislikes = lc(record.dislikes);
        blob.sexuality = lc(record.sexuality);
        blob.relationships = lc(record.relationships);
        blob.behavior = `${blob.personality} ${blob.speech} ${blob.quirks} ${blob.likes} ${blob.dislikes} ${blob.sexuality} ${blob.relationships} `;
        blob.appearance = lc(record.appearance);
        blob.outfits = outfitSearchBlobForCharacter(record);
        blob.home = `${lc(record.dwelling)} ${lc(record.bathroomNeighbours)} ${lc(record.room)}`;
        blob.background = `${lc(record.backgroundKeywords)} ${lc(record.knownBackground)} ${lc(record.backgroundFriends)} ${lc(record.hiddenBackground)}`;
        blob.secrets = `${lc(record.secretsKeywords)} ${lc(record.secrets)}`;

        blob.master = '';
        for (const key in blob) blob.master += `${blob[key]}|||`;
        return blob;
    }

    const blob = {
        type: 'location',
        tags: lc(record.tags),
        ownerId: lc(record.ownerId),
        owner: lc(record.ownerName),
        status: lc(record.status),
        name: lc(record.name),
        summary: lc(record.summary),
        description: lc(record.description),
        denizens: lc(record.denizens),
        events: lc(record.events),
        keywords: lc(record.extraKeys),
    };
    const subs = parseLocationSubLocations(record);
    let subParts = '';
    for (const s of subs) subParts += `${lc(s.name)} ${lc(s.extraKeys)} ${lc(s.description)} `;
    blob.subLocations = subParts.trim();

    blob.master = '';
    for (const key in blob) blob.master += `${blob[key]}|||`;
    return blob;
}

/**
 * /data/list has open CORS (Access-Control-Allow-Origin: *) -- fetch directly.
 * @param {string} baseUrl
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<object[]>}
 */
export async function fetchCharacterList(baseUrl, fetchImpl = fetch) {
    const res = await fetchImpl(`${baseUrl}/data/list`);
    if (!res.ok) {
        throw new Error(`Registrar /data/list failed: ${res.status}`);
    }
    return res.json();
}

/**
 * Routes through SillyTavern's own /proxy/:url(*) passthrough (src/middleware/corsProxy.js) --
 * the target url is appended RAW after "/proxy/", not URL-encoded, matching the
 * confirmed real usage in weyland-status's serviceHealthMonitor.js. Requires
 * enableCorsProxy: true in config.yaml (already this fork's default).
 * @param {string} fullTargetUrl - a complete absolute URL, e.g. "https://registrar.weybooru.com/loci/list"
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<object[]>}
 */
export async function fetchViaProxy(fullTargetUrl, fetchImpl = fetch) {
    const res = await fetchImpl(`/proxy/${fullTargetUrl}`, { credentials: 'include' });
    if (!res.ok) {
        throw new Error(`Proxy fetch failed for ${fullTargetUrl}: ${res.status}`);
    }
    return res.json();
}

/**
 * Two-tier CORS strategy: try a direct fetch first (these endpoints don't
 * currently send Access-Control-Allow-Origin, but the Registrar is expected
 * to add it eventually -- trying direct first means this auto-stops needing
 * any proxy the moment that happens, with zero code changes). Only a direct
 * fetch that THROWS (the way browsers surface a CORS block -- no readable
 * response at all) falls back to SillyTavern's own /proxy/ passthrough. A
 * direct fetch that resolves with a real HTTP error status is a genuine
 * server error, not a CORS problem, and is NOT retried through the proxy.
 * Deliberately does not chain further into third-party public CORS proxies.
 * @param {string} fullTargetUrl
 * @param {{fetchImpl?: typeof fetch, proxyFetchImpl?: typeof fetch}} [options]
 * @returns {Promise<object[]>}
 */
export async function fetchWithCorsFallback(fullTargetUrl, { fetchImpl = fetch, proxyFetchImpl = fetch } = {}) {
    let directResponse;
    try {
        directResponse = await fetchImpl(fullTargetUrl);
    } catch {
        return fetchViaProxy(fullTargetUrl, proxyFetchImpl);
    }
    if (!directResponse.ok) {
        throw new Error(`Registrar request failed: ${directResponse.status}`);
    }
    return directResponse.json();
}

/** @param {string} baseUrl @param {typeof fetch} [fetchImpl] @param {typeof fetch} [proxyFetchImpl] @returns {Promise<object[]>} */
export async function fetchLocationList(baseUrl, fetchImpl = fetch, proxyFetchImpl = fetch) {
    return fetchWithCorsFallback(`${baseUrl}/loci/list`, { fetchImpl, proxyFetchImpl });
}

/** @param {string} baseUrl @param {typeof fetch} [fetchImpl] @param {typeof fetch} [proxyFetchImpl] @returns {Promise<object[]>} */
export async function fetchCollectionList(baseUrl, fetchImpl = fetch, proxyFetchImpl = fetch) {
    return fetchWithCorsFallback(`${baseUrl}/coll/list`, { fetchImpl, proxyFetchImpl });
}
