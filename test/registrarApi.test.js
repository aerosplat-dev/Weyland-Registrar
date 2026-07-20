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
