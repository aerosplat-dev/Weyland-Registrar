import test from 'node:test';
import assert from 'node:assert/strict';
import { characterEntryUids, locationEntryUids, ROSTER_UID, LOCATION_LIST_UID } from '../lib/uidScheme.js';

test('character uids are deterministic and collision-free across different ids', () => {
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
    for (let id = 0; id < 50; id++) {
        assert.notEqual(characterEntryUids(id).info, ROSTER_UID);
    }
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

test('constants', () => {
    assert.equal(ROSTER_UID, 5000);
    assert.equal(LOCATION_LIST_UID, 8000);
});
