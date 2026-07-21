/**
 * @param {object} record
 * @param {'character'|'location'} itemType
 * @returns {string}
 */
export function toItemKey(record, itemType) {
    return itemType === 'character' ? `char:${record.characterId}` : `loc:${record.locationId}`;
}

/**
 * Flattens the fields relevant to search filtering into a lowercase blob,
 * matching the prop names the Registrar's own filterList() uses (owner, species, etc.)
 * so filter strings copied from the Registrar work unmodified against our own catalog.
 * @param {object} record
 * @param {'character'|'location'} itemType
 * @returns {Object.<string, string>}
 */
export function buildSearchBlob(record, itemType) {
    const lc = (value) => String(value ?? '').toLowerCase();
    if (itemType === 'character') {
        return {
            master: `${lc(record.name)} ${lc(record.surname)} ${lc(record.summary)}`,
            owner: lc(record.ownerName),
            ownerId: lc(record.ownerId),
            species: lc(record.species),
            gender: lc(record.gender),
            major: lc(record.major),
            tags: lc(record.tags),
            handle: lc(record.onlineHandle),
            status: lc(record.status),
        };
    }
    return {
        master: `${lc(record.name)} ${lc(record.summary)}`,
        owner: lc(record.ownerName),
        ownerId: lc(record.ownerId),
        tags: lc(record.tags),
        status: lc(record.status),
    };
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
