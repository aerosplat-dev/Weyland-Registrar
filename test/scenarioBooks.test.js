// test/scenarioBooks.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarioBookName, activateScenario, deactivateScenario } from '../lib/scenarioBooks.js';
import { config } from '../lib/entryBuilder.js';

function fakeStContext() {
    const books = {};
    const commands = [];
    return {
        books, commands,
        loadWorldInfo: async (name) => books[name] ?? { entries: {} },
        saveWorldInfo: async (name, data) => { books[name] = data; },
        updateWorldInfoList: async () => {},
        executeSlashCommandsWithOptions: async (cmd) => { commands.push(cmd); },
    };
}

test('scenarioBookName matches the Registrar\'s own per-item naming convention, suffixed with loreId', () => {
    assert.equal(scenarioBookName({ name: 'The Venture', loreId: '1' }), 'Lore Book - The Venture (1)');
});

test('scenarioBookName never collides with the shared character book name, even for a scenario named "Weyland Registrar"', () => {
    // lib/worldInfoWriter.js's CHARACTER_BOOK_NAME is the fixed string 'Lore Book - Weyland Registrar'.
    // Without the loreId suffix, a scenario literally named "Weyland Registrar" would produce that
    // exact string and clobber the shared character book on activation.
    assert.notEqual(scenarioBookName({ name: 'Weyland Registrar', loreId: '42' }), 'Lore Book - Weyland Registrar');
});

test('scenarioBookName disambiguates two different scenarios that share the same name', () => {
    const nameA = scenarioBookName({ name: 'The Venture', loreId: '1' });
    const nameB = scenarioBookName({ name: 'The Venture', loreId: '2' });
    assert.notEqual(nameA, nameB, 'same name but different loreId must produce different book names');
});

test('activateScenario writes a dedicated book and activates it', async () => {
    const stContext = fakeStContext();
    const callFunction = async (name) => {
        if (name === 'buildRosterEntry') return { uid: 5000, comment: 'Character Roster', content: 'x' };
        throw new Error(`Unexpected: ${name}`);
    };
    const settings = { scenarioBooks: {} };
    const loreRecord = { loreId: '1', name: 'The Venture', greeting: 'Welcome.' };

    await activateScenario(stContext, callFunction, settings, loreRecord);

    assert.ok(stContext.books['Lore Book - The Venture (1)']);
    assert.ok(stContext.commands.some(cmd => cmd.includes('state=on') && cmd.includes('Lore Book - The Venture (1)')));
    assert.equal(settings.scenarioBooks['1'].active, true);
    assert.equal(settings.scenarioBooks['1'].book, 'Lore Book - The Venture (1)');
});

test('deactivateScenario turns the book off without deleting it', async () => {
    const stContext = fakeStContext();
    const settings = { scenarioBooks: { '1': { active: true, book: 'Lore Book - The Venture (1)' } } };
    stContext.books['Lore Book - The Venture (1)'] = { entries: {} };

    await deactivateScenario(stContext, settings, { loreId: '1', name: 'The Venture' });

    assert.ok(stContext.commands.some(cmd => cmd.includes('state=off') && cmd.includes('Lore Book - The Venture (1)')));
    assert.equal(settings.scenarioBooks['1'].active, false);
    assert.ok(stContext.books['Lore Book - The Venture (1)'], 'file is kept on disk, not deleted');
});

test('reactivating a deactivated scenario reuses the book without rebuilding', async () => {
    const stContext = fakeStContext();
    let buildRosterEntryCallCount = 0;
    const callFunction = async (name) => {
        if (name === 'buildRosterEntry') {
            buildRosterEntryCallCount++;
            return { uid: 5000, comment: 'Character Roster', content: 'x' };
        }
        throw new Error(`Unexpected: ${name}`);
    };
    const settings = { scenarioBooks: {} };
    const loreRecord = { loreId: '1', name: 'The Venture', greeting: 'Welcome.' };

    // First activation: should build the book
    await activateScenario(stContext, callFunction, settings, loreRecord);
    assert.equal(buildRosterEntryCallCount, 1, 'first activation calls buildRosterEntry');
    assert.equal(settings.scenarioBooks['1'].active, true);

    // Deactivate: keeps the book on disk
    await deactivateScenario(stContext, settings, loreRecord);
    assert.equal(settings.scenarioBooks['1'].active, false);
    assert.ok(stContext.books['Lore Book - The Venture (1)'], 'book file is preserved');

    // Second activation: should reuse the book WITHOUT rebuilding
    await activateScenario(stContext, callFunction, settings, loreRecord);
    assert.equal(buildRosterEntryCallCount, 1, 'second activation does NOT call buildRosterEntry again');
    assert.equal(settings.scenarioBooks['1'].active, true, 'book is active again');
    assert.ok(stContext.commands.some(cmd => cmd.includes('state=on') && cmd.includes('Lore Book - The Venture (1)')), 'state=on command issued on reactivation');
});

test('activateScenario rejects with a timeout error when the sandbox call never resolves, instead of hanging', async () => {
    const originalTimeout = config.callFunctionTimeoutMs;
    try {
        // Temporarily set a very short timeout for testing
        config.callFunctionTimeoutMs = 50;

        const stContext = fakeStContext();
        // A callFunction that never resolves, simulating a stalled/unreachable sandbox
        const callFunction = async () => new Promise(() => {});
        const settings = { scenarioBooks: {} };
        const loreRecord = { loreId: '1', name: 'The Venture', greeting: 'Welcome.' };

        await assert.rejects(
            () => activateScenario(stContext, callFunction, settings, loreRecord),
            /timed out after 50ms/,
        );
    } finally {
        // Restore original timeout
        config.callFunctionTimeoutMs = originalTimeout;
    }
});
