// test/worldInfoWriter.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { syncCharacterBook, syncLocationBook, CHARACTER_BOOK_NAME, LOCATION_BOOK_NAME } from '../lib/worldInfoWriter.js';
import { ROSTER_UID, LOCATION_LIST_UID, MARKER_UID, characterEntryUids } from '../lib/uidScheme.js';
import { buildMarkerEntry } from '../lib/bookOwnership.js';

function fakeStContext() {
    const books = {};
    const activated = [];
    return {
        books,
        activated,
        loadWorldInfo: async (name) => books[name] ?? { entries: {} },
        saveWorldInfo: async (name, data) => { books[name] = data; },
        updateWorldInfoList: async () => {},
        executeSlashCommandsWithOptions: async (command) => { activated.push(command); },
    };
}

function fakeCallFunction() {
    return async (name, args) => {
        if (name === 'addLoreEntries') {
            const [book, id, record] = args;
            const entries = { ...book.entries };
            entries[id + 5001] = { uid: id + 5001, comment: record.name, content: `[${record.name} INFO]` };
            entries[id + 5005] = { uid: id + 5005, comment: `${record.name} End Section`, content: 'END' };
            return { ...book, entries };
        }
        throw new Error(`Unexpected call: ${name}`);
    };
}

test('syncCharacterBook writes entries for every active character plus one roster entry', async () => {
    const stContext = fakeStContext();
    const settings = { itemStates: { 'char:1': 'active' }, collections: {} };
    const recordsByKey = { 'char:1': { characterId: '1', name: 'Maeve', species: 'Usagimimi', gender: 'Female', onlineHandle: '@HareSay', schoolYear: 'MCY', dwelling: 'Sterling Hall' } };

    await syncCharacterBook(stContext, fakeCallFunction(), settings, recordsByKey);

    const book = stContext.books[CHARACTER_BOOK_NAME];
    assert.ok(book);
    // Slot index 0 (the first/only active character), not raw characterId
    // '1' -- see uidScheme.js's own doc for why these are no longer the same.
    const uids = characterEntryUids(0);
    assert.ok(book.entries[uids.info]);
    assert.ok(book.entries[uids.end]);
    assert.ok(book.entries[ROSTER_UID]);
    assert.match(book.entries[ROSTER_UID].content, /Maeve:/);
});

test('syncCharacterBook assigns compact sequential slot indexes regardless of sparse/large raw characterIds', async () => {
    const stContext = fakeStContext();
    // Real Registrar characterIds are neither small nor contiguous (this
    // catalog's real data runs well into the 700s) -- two active characters
    // with sparse/large ids must still land in the compact 5001-5010 block,
    // not scattered based on their raw ids (which, for id 700, would overflow
    // past MAX_CHARACTER_UID under the old characterId*5-based scheme).
    const settings = { itemStates: { 'char:5': 'active', 'char:700': 'active' }, collections: {} };
    const recordsByKey = {
        'char:5': { characterId: '5', name: 'Low', species: '', gender: '', onlineHandle: '', schoolYear: '', dwelling: '' },
        'char:700': { characterId: '700', name: 'High', species: '', gender: '', onlineHandle: '', schoolYear: '', dwelling: '' },
    };

    await syncCharacterBook(stContext, fakeCallFunction(), settings, recordsByKey);

    const book = stContext.books[CHARACTER_BOOK_NAME];
    const slot0 = characterEntryUids(0);
    const slot1 = characterEntryUids(1);
    assert.ok(book.entries[slot0.info], 'first active character gets slot 0 (uids 5001-5005)');
    assert.ok(book.entries[slot1.info], 'second active character gets slot 1 (uids 5006-5010)');
    assert.ok(Object.keys(book.entries).map(Number).every(uid => uid <= 7999), 'no entry exceeds MAX_CHARACTER_UID');
});

test('syncCharacterBook activates the book via /world after writing', async () => {
    const stContext = fakeStContext();
    const settings = { itemStates: {}, collections: {} };
    await syncCharacterBook(stContext, fakeCallFunction(), settings, {});
    assert.ok(stContext.activated.some(cmd => cmd.includes('/world') && cmd.includes(CHARACTER_BOOK_NAME)));
});

test('syncCharacterBook removes entries for a character that becomes inactive', async () => {
    const stContext = fakeStContext();
    const uids = characterEntryUids(0);
    // Carries the marker already -- this fixture simulates a normal resync
    // of a book this extension already owns, not a foreign-content
    // collision (see bookOwnership.test.js for that case).
    stContext.books[CHARACTER_BOOK_NAME] = {
        entries: {
            [uids.info]: { uid: uids.info, comment: 'Maeve' },
            [uids.end]: { uid: uids.end, comment: 'Maeve End Section' },
            [ROSTER_UID]: { uid: ROSTER_UID, comment: 'Character Roster', content: 'stale' },
            [MARKER_UID]: buildMarkerEntry(),
        },
    };
    // No forced-active pin and no covering collection -- this is what "a
    // character becomes inactive" actually looks like now that deactivating
    // clears the itemStates entry rather than writing 'inactive' (see
    // activationState.js).
    const settings = { itemStates: {}, collections: {} };
    await syncCharacterBook(stContext, fakeCallFunction(), settings, {
        'char:1': { characterId: '1', name: 'Maeve', species: '', gender: '', onlineHandle: '', schoolYear: '', dwelling: '' },
    });
    const book = stContext.books[CHARACTER_BOOK_NAME];
    assert.equal(book.entries[uids.info], undefined);
    assert.equal(book.entries[uids.end], undefined);
});

test('syncCharacterBook with zero active characters still writes an empty roster', async () => {
    const stContext = fakeStContext();
    const settings = { itemStates: {}, collections: {} };
    await syncCharacterBook(stContext, fakeCallFunction(), settings, {});
    const book = stContext.books[CHARACTER_BOOK_NAME];
    assert.match(book.entries[ROSTER_UID].content, /\[ADDITIONAL CHARACTERS\]/);
    assert.match(book.entries[ROSTER_UID].content, /\[END ADDITIONAL CHARACTERS\]/);
});

test('syncLocationBook writes to the correct book name', async () => {
    const stContext = fakeStContext();
    const callFunction = async (name, args) => {
        if (name === 'parseLocationSubLocations') return [];
        if (name === 'addWorldEntries') {
            const [book, id, record] = args;
            return { ...book, entries: { ...book.entries, [id]: { uid: id, comment: record.name, content: 'LOC' } } };
        }
        throw new Error(`Unexpected call: ${name}`);
    };
    const settings = { itemStates: { 'loc:1': 'active' }, collections: {} };
    await syncLocationBook(stContext, callFunction, settings, {
        'loc:1': { locationId: '1', name: "Mack's Autozone", summary: 'A shop.', subLocations: '[]' },
    });
    assert.ok(stContext.books[LOCATION_BOOK_NAME]);
    assert.ok(stContext.books[LOCATION_BOOK_NAME].entries[LOCATION_LIST_UID]);
});

test('syncCharacterBook always writes the ownership marker alongside real entries', async () => {
    const stContext = fakeStContext();
    const settings = { itemStates: {}, collections: {} };
    await syncCharacterBook(stContext, fakeCallFunction(), settings, {});
    assert.ok(stContext.books[CHARACTER_BOOK_NAME].entries[MARKER_UID]);
});

test('syncCharacterBook backs up foreign pre-existing content (no marker) before taking over, and returns the backup name', async () => {
    const stContext = fakeStContext();
    stContext.books[CHARACTER_BOOK_NAME] = {
        entries: {
            42: { uid: 42, comment: 'A user-authored entry unrelated to this extension', content: 'Some homebrew lore.' },
        },
    };
    const settings = { itemStates: { 'char:1': 'active' }, collections: {} };

    const backupName = await syncCharacterBook(stContext, fakeCallFunction(), settings, {
        'char:1': { characterId: '1', name: 'Maeve', species: '', gender: '', onlineHandle: '', schoolYear: '', dwelling: '' },
    });

    assert.ok(backupName, 'returns the backup book name');
    assert.notEqual(backupName, CHARACTER_BOOK_NAME);
    // The original foreign content survives, untouched, under the backup name.
    assert.deepEqual(stContext.books[backupName].entries[42], { uid: 42, comment: 'A user-authored entry unrelated to this extension', content: 'Some homebrew lore.' });
    // The primary book was rebuilt fresh and now carries the marker.
    assert.ok(stContext.books[CHARACTER_BOOK_NAME].entries[MARKER_UID]);
    assert.equal(stContext.books[CHARACTER_BOOK_NAME].entries[42], undefined);
});

test('syncCharacterBook does not back up when there is no pre-existing content to lose', async () => {
    const stContext = fakeStContext();
    const settings = { itemStates: {}, collections: {} };
    const backupName = await syncCharacterBook(stContext, fakeCallFunction(), settings, {});
    assert.equal(backupName, null);
});

test('syncCharacterBook does not re-back-up a book it already owns', async () => {
    const stContext = fakeStContext();
    const settings = { itemStates: {}, collections: {} };
    await syncCharacterBook(stContext, fakeCallFunction(), settings, {}); // first sync: takes ownership
    const backupName = await syncCharacterBook(stContext, fakeCallFunction(), settings, {}); // second sync: already ours
    assert.equal(backupName, null);
});

// Regression test for a real production bug: the roster/location-list entries
// are `constant: true` (always active), so their own content -- a full
// listing of every active character/location's name -- must never re-enter
// ST's recursive WI scan buffer. Without preventRecursion, and with this
// deployment's world_info_recursive setting enabled, that listing cascades
// into activating every other entry (whose own key is just its name) on
// every single message, regardless of what's actually said. Confirmed live:
// a single-name test message activated 47 entries with this unset, 21 (all
// legitimate) with it set.
test('syncCharacterBook marks the roster entry preventRecursion, so its full name listing cannot cascade-activate every character via recursive WI scanning', async () => {
    const stContext = fakeStContext();
    const settings = { itemStates: {}, collections: {} };
    await syncCharacterBook(stContext, fakeCallFunction(), settings, {});
    assert.equal(stContext.books[CHARACTER_BOOK_NAME].entries[ROSTER_UID].preventRecursion, true);
});

test('syncLocationBook marks the location-list entry preventRecursion, for the same reason as the character roster', async () => {
    const stContext = fakeStContext();
    const callFunction = async (name, args) => {
        if (name === 'parseLocationSubLocations') return [];
        if (name === 'addWorldEntries') {
            const [book, id, record] = args;
            return { ...book, entries: { ...book.entries, [id]: { uid: id, comment: record.name, content: 'LOC' } } };
        }
        throw new Error(`Unexpected call: ${name}`);
    };
    const settings = { itemStates: {}, collections: {} };
    await syncLocationBook(stContext, callFunction, settings, {});
    assert.equal(stContext.books[LOCATION_BOOK_NAME].entries[LOCATION_LIST_UID].preventRecursion, true);
});
