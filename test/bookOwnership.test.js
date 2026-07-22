// test/bookOwnership.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarkerEntry, ensureBookOwnership } from '../lib/bookOwnership.js';
import { MARKER_UID } from '../lib/uidScheme.js';

function fakeStContext(initialBooks = {}) {
    const books = { ...initialBooks };
    return {
        books,
        loadWorldInfo: async (name) => books[name] ?? { entries: {} },
        saveWorldInfo: async (name, data) => { books[name] = data; },
    };
}

test('buildMarkerEntry is disabled (never injects into a prompt) and keyed at MARKER_UID', () => {
    const entry = buildMarkerEntry();
    assert.equal(entry.uid, MARKER_UID);
    assert.equal(entry.disable, true);
    assert.equal(entry.constant, false);
});

test('ensureBookOwnership returns null when the book does not exist yet', async () => {
    const stContext = fakeStContext();
    const result = await ensureBookOwnership(stContext, 'Some Book');
    assert.equal(result, null);
    assert.equal(stContext.books['Some Book'], undefined, 'no backup book should be created');
});

test('ensureBookOwnership returns null when the book exists but is empty', async () => {
    const stContext = fakeStContext({ 'Some Book': { entries: {} } });
    const result = await ensureBookOwnership(stContext, 'Some Book');
    assert.equal(result, null);
});

test('ensureBookOwnership backs up real content that has no marker', async () => {
    const stContext = fakeStContext({
        'Some Book': { entries: { 7: { uid: 7, comment: 'Homebrew entry', content: 'Not ours.' } } },
    });
    const backupName = await ensureBookOwnership(stContext, 'Some Book');
    assert.ok(backupName);
    assert.notEqual(backupName, 'Some Book');
    assert.match(backupName, /^Some Book \(Backup .+\)$/);
    assert.deepEqual(stContext.books[backupName].entries[7], { uid: 7, comment: 'Homebrew entry', content: 'Not ours.' });
    // The original book itself is left alone by this function -- the
    // caller (writeAndActivate) is responsible for overwriting it afterward.
    assert.ok(stContext.books['Some Book'].entries[7]);
});

test('ensureBookOwnership is a no-op once the book already carries the marker', async () => {
    const stContext = fakeStContext({
        'Some Book': { entries: { [MARKER_UID]: buildMarkerEntry(), 5001: { uid: 5001, comment: 'Real entry' } } },
    });
    const backupName = await ensureBookOwnership(stContext, 'Some Book');
    assert.equal(backupName, null);
});

test('ensureBookOwnership backs up again if a later sync finds the marker missing (e.g. a manual edit removed it)', async () => {
    const stContext = fakeStContext({
        'Some Book': { entries: { 7: { uid: 7, comment: 'Re-appeared homebrew entry' } } },
    });
    const first = await ensureBookOwnership(stContext, 'Some Book');
    assert.ok(first);
    // Simulate the caller's own overwrite (writeAndActivate would normally
    // do this) landing back in a marker-less state again.
    stContext.books['Some Book'] = { entries: { 8: { uid: 8, comment: 'Different homebrew entry' } } };
    const second = await ensureBookOwnership(stContext, 'Some Book');
    assert.ok(second);
    assert.notEqual(first, second, 'each collision gets its own distinct backup, not a shared/overwritten one');
});
