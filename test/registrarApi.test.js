import test from 'node:test';
import assert from 'node:assert/strict';
import {
    toItemKey,
    buildSearchBlob,
    fetchCharacterList,
    fetchViaProxy,
    fetchWithCorsFallback,
    fetchLocationList,
} from '../lib/registrarApi.js';

test('toItemKey for a character', () => {
    assert.equal(toItemKey({ characterId: '7' }, 'character'), 'char:7');
});

test('toItemKey for a location', () => {
    assert.equal(toItemKey({ locationId: '3' }, 'location'), 'loc:3');
});

test('buildSearchBlob lowercases and flattens relevant character fields', () => {
    const blob = buildSearchBlob({ name: 'Maeve', species: 'Usagimimi', ownerName: 'Josh', tags: '["a","b"]' }, 'character');
    assert.equal(blob.species, 'usagimimi');
    assert.equal(blob.owner, 'josh');
    assert.match(blob.tags, /a/);
});

test('buildSearchBlob sets type so a "type:location"/"type:character" filter term (used by real Registrar collections) works', () => {
    assert.equal(buildSearchBlob({}, 'character').type, 'character');
    assert.equal(buildSearchBlob({}, 'location').type, 'location');
});

// Field-for-field port of the Registrar's own makeCharacterSearchable
// (base.js) -- a narrower hand-picked field set was shipped first and found
// to under-match real collection filters, confirmed live against the real
// site (see collectionResolver.js's doc comment). "WUPD" is a filter that,
// on the real site, only matches via personality/relationships/room/
// backgroundKeywords/onlineHandle/outfitEntries -- none of which are in
// name/surname/summary.
test('buildSearchBlob for a character includes personality/relationships/room/backgroundKeywords/onlineHandle/outfits in the master field', () => {
    const blob = buildSearchBlob({
        personality: 'WUPD officer energy',
        relationships: 'Partners with the WUPD academy',
        room: 'WUPD dorm room',
        backgroundKeywords: 'WUPD, Police Academy',
        onlineHandle: 'Officer_WUPD',
        outfitEntries: JSON.stringify([{ name: 'WUPD Duty Uniform', description: 'Tan patrol shirt' }]),
    }, 'character');
    assert.match(blob.master, /wupd officer energy/);
    assert.match(blob.master, /partners with the wupd academy/);
    assert.match(blob.master, /wupd dorm room/);
    assert.match(blob.master, /wupd, police academy/);
    assert.match(blob.master, /officer_wupd/);
    assert.match(blob.master, /wupd duty uniform/);
});

test('buildSearchBlob for a character falls back to legacy flat outfit fields when outfitEntries is absent', () => {
    const blob = buildSearchBlob({ casualOutfit: 'Blue jacket' }, 'character');
    assert.match(blob.outfits, /blue jacket/);
    assert.match(blob.master, /blue jacket/);
});

test('buildSearchBlob for a character composes home/background/secrets from their constituent fields', () => {
    const blob = buildSearchBlob({
        dwelling: 'Sterling Hall', bathroomNeighbours: 'Maeve', room: 'Room 4',
        backgroundKeywords: 'rural', knownBackground: 'Farm life', backgroundFriends: 'Sven', hiddenBackground: 'Runaway',
        secretsKeywords: 'romance', secrets: 'Reads trashy novels',
    }, 'character');
    assert.equal(blob.home, 'sterling hall maeve room 4');
    assert.equal(blob.background, 'rural farm life sven runaway');
    assert.equal(blob.secrets, 'romance reads trashy novels');
});

test('buildSearchBlob for a location includes description/denizens/events/keywords/subLocations', () => {
    const blob = buildSearchBlob({
        description: 'A cozy bookstore', denizens: 'Nook the cat', events: 'Poetry night', extraKeys: 'reading, quiet',
        subLocations: JSON.stringify([{ name: 'Back Room', extraKeys: 'storage', description: 'Dusty shelves' }]),
    }, 'location');
    assert.match(blob.master, /a cozy bookstore/);
    assert.match(blob.master, /nook the cat/);
    assert.match(blob.master, /poetry night/);
    assert.match(blob.master, /reading, quiet/);
    assert.equal(blob.subLocations, 'back room storage dusty shelves');
});

test('buildSearchBlob never throws on malformed outfitEntries/subLocations JSON', () => {
    assert.doesNotThrow(() => buildSearchBlob({ outfitEntries: 'not-json' }, 'character'));
    assert.doesNotThrow(() => buildSearchBlob({ subLocations: 'not-json' }, 'location'));
});

test('fetchCharacterList calls /data/list directly with no proxy', async () => {
    let calledUrl = null;
    const fakeFetch = async (url) => {
        calledUrl = url;
        return { ok: true, json: async () => [{ characterId: '1' }] };
    };
    const result = await fetchCharacterList('https://registrar.weybooru.com', fakeFetch);
    assert.equal(calledUrl, 'https://registrar.weybooru.com/data/list');
    assert.deepEqual(result, [{ characterId: '1' }]);
});

test('fetchCharacterList throws on non-ok response', async () => {
    const fakeFetch = async () => ({ ok: false, status: 500 });
    await assert.rejects(() => fetchCharacterList('https://x', fakeFetch), /500/);
});

test('fetchViaProxy routes through /proxy/<raw target url>, not encoded', async () => {
    let calledUrl = null;
    let calledOpts = null;
    const fakeFetch = async (url, opts) => {
        calledUrl = url;
        calledOpts = opts;
        return { ok: true, json: async () => [{ locationId: '1' }] };
    };
    const result = await fetchViaProxy('https://registrar.weybooru.com/loci/list', fakeFetch);
    assert.equal(calledUrl, '/proxy/https://registrar.weybooru.com/loci/list');
    assert.deepEqual(calledOpts, { credentials: 'include' });
    assert.deepEqual(result, [{ locationId: '1' }]);
});

test('fetchWithCorsFallback uses the direct result when direct fetch succeeds', async () => {
    let proxyCalled = false;
    const fetchImpl = async () => ({ ok: true, json: async () => [{ locationId: '1' }] });
    const proxyFetchImpl = async () => { proxyCalled = true; return { ok: true, json: async () => [] }; };
    const result = await fetchWithCorsFallback('https://registrar.weybooru.com/loci/list', { fetchImpl, proxyFetchImpl });
    assert.deepEqual(result, [{ locationId: '1' }]);
    assert.equal(proxyCalled, false);
});

test('fetchWithCorsFallback falls back to the proxy when direct fetch throws (CORS block)', async () => {
    const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
    let proxyUrl = null;
    const proxyFetchImpl = async (url) => {
        proxyUrl = url;
        return { ok: true, json: async () => [{ locationId: '1' }] };
    };
    const result = await fetchWithCorsFallback('https://registrar.weybooru.com/loci/list', { fetchImpl, proxyFetchImpl });
    assert.equal(proxyUrl, '/proxy/https://registrar.weybooru.com/loci/list');
    assert.deepEqual(result, [{ locationId: '1' }]);
});

test('fetchWithCorsFallback does NOT fall back on a resolved-but-error direct response', async () => {
    let proxyCalled = false;
    const fetchImpl = async () => ({ ok: false, status: 500 });
    const proxyFetchImpl = async () => { proxyCalled = true; return { ok: true, json: async () => [] }; };
    await assert.rejects(
        () => fetchWithCorsFallback('https://registrar.weybooru.com/loci/list', { fetchImpl, proxyFetchImpl }),
        /500/,
    );
    assert.equal(proxyCalled, false);
});

test('fetchLocationList delegates to fetchWithCorsFallback with the right target URL', async () => {
    let calledUrl = null;
    const fetchImpl = async (url) => {
        calledUrl = url;
        return { ok: true, json: async () => [] };
    };
    await fetchLocationList('https://registrar.weybooru.com', fetchImpl);
    assert.equal(calledUrl, 'https://registrar.weybooru.com/loci/list');
});

test('fetchLocationList falls back to proxy when direct fetch is CORS-blocked', async () => {
    const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
    let proxyUrl = null;
    const proxyFetchImpl = async (url) => { proxyUrl = url; return { ok: true, json: async () => [{ locationId: '9' }] }; };
    const result = await fetchLocationList('https://registrar.weybooru.com', fetchImpl, proxyFetchImpl);
    assert.equal(proxyUrl, '/proxy/https://registrar.weybooru.com/loci/list');
    assert.deepEqual(result, [{ locationId: '9' }]);
});
