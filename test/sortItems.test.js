// test/sortItems.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { sortItems } from '../lib/ui/sortItems.js';

const RECORDS = [
    { name: 'Winona', createdAt: '2025-06-01 10:00:00.000 +00:00', updatedAt: '2026-01-01 10:00:00.000 +00:00', ownerName: 'zed' },
    { name: 'Ayano', createdAt: '2025-04-10 22:09:28.589 +00:00', updatedAt: '2026-05-07 18:56:03.291 +00:00', ownerName: 'anna' },
    { name: 'Maya', createdAt: '2025-05-16 18:26:26.720 +00:00', updatedAt: '2026-01-03 22:44:40.521 +00:00', ownerName: 'mike' },
];

test('sorts by name ascending (default direction)', () => {
    const result = sortItems(RECORDS, 'name', 'asc');
    assert.deepEqual(result.map(r => r.name), ['Ayano', 'Maya', 'Winona']);
});

test('sorts by name descending', () => {
    const result = sortItems(RECORDS, 'name', 'desc');
    assert.deepEqual(result.map(r => r.name), ['Winona', 'Maya', 'Ayano']);
});

test('sorts by createdAt ascending, parsing the Registrar\'s date-string format', () => {
    const result = sortItems(RECORDS, 'created', 'asc');
    assert.deepEqual(result.map(r => r.name), ['Ayano', 'Maya', 'Winona']);
});

test('sorts by updatedAt descending', () => {
    const result = sortItems(RECORDS, 'updated', 'desc');
    assert.deepEqual(result.map(r => r.name), ['Ayano', 'Maya', 'Winona']);
});

test('sorts by author (ownerName) ascending', () => {
    const result = sortItems(RECORDS, 'author', 'asc');
    assert.deepEqual(result.map(r => r.name), ['Ayano', 'Maya', 'Winona']);
});

test('items missing the sorted field sort to the end, regardless of direction', () => {
    const items = [
        { name: 'HasDate', createdAt: '2025-06-01 10:00:00.000 +00:00' },
        { name: 'NoDate' },
        { name: 'AlsoHasDate', createdAt: '2025-01-01 10:00:00.000 +00:00' },
    ];
    const asc = sortItems(items, 'created', 'asc');
    assert.deepEqual(asc.map(i => i.name), ['AlsoHasDate', 'HasDate', 'NoDate']);
    const desc = sortItems(items, 'created', 'desc');
    assert.deepEqual(desc.map(i => i.name), ['HasDate', 'AlsoHasDate', 'NoDate']);
});

test('a malformed date string is treated as missing (sorts to the end)', () => {
    const items = [
        { name: 'Good', createdAt: '2025-06-01 10:00:00.000 +00:00' },
        { name: 'Malformed', createdAt: 'not-a-date' },
    ];
    const result = sortItems(items, 'created', 'asc');
    assert.deepEqual(result.map(i => i.name), ['Good', 'Malformed']);
});

test('does not mutate the input array', () => {
    const items = [{ name: 'B' }, { name: 'A' }];
    const original = [...items];
    sortItems(items, 'name', 'asc');
    assert.deepEqual(items, original);
});

test('an unrecognized field falls back to name', () => {
    const result = sortItems(RECORDS, 'bogus', 'asc');
    assert.deepEqual(result.map(r => r.name), ['Ayano', 'Maya', 'Winona']);
});
