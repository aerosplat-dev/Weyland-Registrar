import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCharacterEntries, buildLocationEntries, config } from '../lib/entryBuilder.js';
import { characterEntryUids, locationEntryUids } from '../lib/uidScheme.js';

function fakeSandboxCall(responses) {
    return async (name, args) => {
        if (!(name in responses)) throw new Error(`Unexpected sandbox call: ${name}`);
        return responses[name](...args);
    };
}

test('buildCharacterEntries assigns the correct deterministic uids to sandbox output', async () => {
    const uids = characterEntryUids('1');
    const callFunction = fakeSandboxCall({
        addLoreEntries: (book, id, inputData) => {
            assert.equal(id, 5); // slotIndex(1) * 5
            const entries = {};
            entries[id + 5001] = { uid: id + 5001, comment: inputData.name, content: 'INFO' };
            entries[id + 5005] = { uid: id + 5005, comment: `${inputData.name} End Section`, content: 'END' };
            return { ...book, entries: { ...book.entries, ...entries } };
        },
    });
    const record = { characterId: '1', name: 'Maeve' };
    const result = await buildCharacterEntries(callFunction, '1', record);
    assert.deepEqual(Object.keys(result).map(Number).sort(), [uids.info, uids.end].sort());
    assert.equal(result[uids.info].comment, 'Maeve');
});

test('buildCharacterEntries uids are driven by the passed slotIndex, not the record\'s own (possibly large/sparse) characterId', async () => {
    // A real Registrar characterId of 700 would, under the old
    // characterId*5-based scheme, overflow past MAX_CHARACTER_UID. Passing
    // slotIndex 0 (e.g. this is the first active character) must still
    // produce the compact 5001-5005 block regardless of the record's own id.
    const uids = characterEntryUids(0);
    const callFunction = fakeSandboxCall({
        addLoreEntries: (book, id, inputData) => {
            assert.equal(id, 0); // slotIndex(0) * 5 -- NOT characterId(700) * 5 = 3500
            const entries = {};
            entries[id + 5001] = { uid: id + 5001, comment: inputData.name, content: 'INFO' };
            entries[id + 5005] = { uid: id + 5005, comment: `${inputData.name} End Section`, content: 'END' };
            return { ...book, entries: { ...book.entries, ...entries } };
        },
    });
    const record = { characterId: '700', name: 'HighId' };
    const result = await buildCharacterEntries(callFunction, 0, record);
    assert.deepEqual(Object.keys(result).map(Number).sort(), [uids.info, uids.end].sort());
    assert.ok(Object.keys(result).map(Number).every(u => u <= 7999));
});

test('buildCharacterEntries propagates a sandbox call failure', async () => {
    const callFunction = async () => { throw new Error('sandbox exploded'); };
    await assert.rejects(
        () => buildCharacterEntries(callFunction, '1', { characterId: '1', name: 'X' }),
        /sandbox exploded/,
    );
});

test('buildLocationEntries assigns uids from locationEntryUids', async () => {
    const uids = locationEntryUids('2', 0);
    const callFunction = fakeSandboxCall({
        parseLocationSubLocations: () => [],
        addWorldEntries: (book, id, inputData) => {
            assert.equal(id, uids.info);
            const entries = {};
            entries[id] = { uid: id, comment: inputData.name, content: 'LOC INFO' };
            return { ...book, entries: { ...book.entries, ...entries } };
        },
    });
    const record = { locationId: '2', name: "Mack's Autozone", subLocations: '[]' };
    const result = await buildLocationEntries(callFunction, '2', record);
    assert.deepEqual(Object.keys(result).map(Number), [uids.info]);
});

test('buildCharacterEntries rejects with timeout error when sandbox call never resolves', async () => {
    const originalTimeout = config.callFunctionTimeoutMs;
    try {
        // Temporarily set a very short timeout for testing
        config.callFunctionTimeoutMs = 50;

        // A callFunction that never resolves
        const callFunction = async () => new Promise(() => {});

        await assert.rejects(
            () => buildCharacterEntries(callFunction, '1', { characterId: '1', name: 'X' }),
            /timed out after 50ms/,
        );
    } finally {
        // Restore original timeout
        config.callFunctionTimeoutMs = originalTimeout;
    }
});
