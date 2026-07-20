// test/worldInfoWriter.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { syncCharacterBook, syncLocationBook, CHARACTER_BOOK_NAME, LOCATION_BOOK_NAME } from '../lib/worldInfoWriter.js';
import { ROSTER_UID, LOCATION_LIST_UID, characterEntryUids } from '../lib/uidScheme.js';

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
    const uids = characterEntryUids('1');
    assert.ok(book.entries[uids.info]);
    assert.ok(book.entries[uids.end]);
    assert.ok(book.entries[ROSTER_UID]);
    assert.match(book.entries[ROSTER_UID].content, /Maeve:/);
});

test('syncCharacterBook activates the book via /world after writing', async () => {
    const stContext = fakeStContext();
    const settings = { itemStates: {}, collections: {} };
    await syncCharacterBook(stContext, fakeCallFunction(), settings, {});
    assert.ok(stContext.activated.some(cmd => cmd.includes('/world') && cmd.includes(CHARACTER_BOOK_NAME)));
});

test('syncCharacterBook removes entries for a character that becomes inactive', async () => {
    const stContext = fakeStContext();
    const uids = characterEntryUids('1');
    stContext.books[CHARACTER_BOOK_NAME] = {
        entries: {
            [uids.info]: { uid: uids.info, comment: 'Maeve' },
            [uids.end]: { uid: uids.end, comment: 'Maeve End Section' },
            [ROSTER_UID]: { uid: ROSTER_UID, comment: 'Character Roster', content: 'stale' },
        },
    };
    const settings = { itemStates: { 'char:1': 'inactive' }, collections: {} };
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
    assert.match(book.entries[ROSTER_UID].content, /\[CHARACTER ROSTER\]/);
    assert.match(book.entries[ROSTER_UID].content, /\[END CHARACTER ROSTER\]/);
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
