import test from 'node:test';
import assert from 'node:assert/strict';
import { characterEntryUids, locationEntryUids, ROSTER_UID, LOCATION_LIST_UID, MAX_CHARACTER_UID } from '../lib/uidScheme.js';

test('character uids are deterministic and collision-free across different slot indexes', () => {
    const c1 = characterEntryUids(1);
    const c2 = characterEntryUids(2);
    assert.deepEqual(c1, { info: 5006, backstory: 5007, secrets: 5008, room: 5009, end: 5010 });
    assert.deepEqual(c2, { info: 5011, backstory: 5012, secrets: 5013, room: 5014, end: 5015 });
    const c1Uids = Object.values(c1);
    const c2Uids = Object.values(c2);
    assert.equal(c1Uids.some(u => c2Uids.includes(u)), false);
});

test('character uids are stable across repeated calls (idempotent re-add)', () => {
    assert.deepEqual(characterEntryUids(42), characterEntryUids(42));
});

test('character uid never collides with roster uid 5000', () => {
    for (let slot = 0; slot < 50; slot++) {
        assert.notEqual(characterEntryUids(slot).info, ROSTER_UID);
    }
});

test('a real-world large raw characterId no longer overflows, since uids are keyed by slot index not characterId', () => {
    // A character with Registrar characterId 700 (real catalog data goes well
    // into the 700s) would, under the old characterId*5-based scheme, produce
    // base 3500 -> uids 8501-8505, both exceeding MAX_CHARACTER_UID and
    // colliding with LOCATION_LIST_UID's own range. As the first (or only)
    // active character it now gets slot index 0 regardless of its raw id.
    const uids = characterEntryUids(0);
    assert.deepEqual(uids, { info: 5001, backstory: 5002, secrets: 5003, room: 5004, end: 5005 });
    assert.ok(Object.values(uids).every(u => u <= MAX_CHARACTER_UID));
});

test('the highest slot index that still fits stays within MAX_CHARACTER_UID', () => {
    const uids = characterEntryUids(598);
    assert.equal(uids.end, 7995);
    assert.ok(uids.end <= MAX_CHARACTER_UID);
});

test('a slot index beyond capacity throws rather than silently overflowing past MAX_CHARACTER_UID', () => {
    assert.throws(() => characterEntryUids(599), /exceeding the reserved/i);
});

test('location uids are deterministic with headroom for sub-locations', () => {
    const l1 = locationEntryUids(1, 3);
    assert.equal(l1.info, 8021);
    assert.deepEqual(l1.subLocations, [8022, 8023, 8024]);
});

test('location uids with zero sub-locations', () => {
    const l0 = locationEntryUids(0, 0);
    assert.equal(l0.info, 8001);
    assert.deepEqual(l0.subLocations, []);
});

test('location sub-location count over headroom throws', () => {
    assert.throws(() => locationEntryUids(1, 20), /sub-location/i);
});

test('a real-world large raw locationId no longer produces sparse/gapped uids, since uids are keyed by slot index', () => {
    // Two locations activated together, however sparse/large their raw
    // locationIds (e.g. 3 and 900), get consecutive slot indexes (0, 1) and
    // therefore tightly-packed, gap-free uid blocks.
    const first = locationEntryUids(0, 0);
    const second = locationEntryUids(1, 0);
    assert.equal(second.info - first.info, 20);
});

test('constants', () => {
    assert.equal(ROSTER_UID, 5000);
    assert.equal(LOCATION_LIST_UID, 8000);
    assert.equal(MAX_CHARACTER_UID, 7999);
});
