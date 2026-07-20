// test/scenarioBooks.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarioBookName, activateScenario, deactivateScenario } from '../lib/scenarioBooks.js';

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

test('scenarioBookName matches the Registrar\'s own per-item naming convention', () => {
    assert.equal(scenarioBookName({ name: 'The Venture' }), 'Lore Book - The Venture');
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

    assert.ok(stContext.books['Lore Book - The Venture']);
    assert.ok(stContext.commands.some(cmd => cmd.includes('state=on') && cmd.includes('Lore Book - The Venture')));
    assert.equal(settings.scenarioBooks['1'].active, true);
    assert.equal(settings.scenarioBooks['1'].book, 'Lore Book - The Venture');
});

test('deactivateScenario turns the book off without deleting it', async () => {
    const stContext = fakeStContext();
    const settings = { scenarioBooks: { '1': { active: true, book: 'Lore Book - The Venture' } } };
    stContext.books['Lore Book - The Venture'] = { entries: {} };

    await deactivateScenario(stContext, settings, { loreId: '1', name: 'The Venture' });

    assert.ok(stContext.commands.some(cmd => cmd.includes('state=off') && cmd.includes('Lore Book - The Venture')));
    assert.equal(settings.scenarioBooks['1'].active, false);
    assert.ok(stContext.books['Lore Book - The Venture'], 'file is kept on disk, not deleted');
});
