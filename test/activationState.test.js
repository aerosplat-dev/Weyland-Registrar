import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveItemActive, resolveAllActive, resolveActiveCollectionNames } from '../lib/activationState.js';

test('unset item with no collections is inactive', () => {
    assert.equal(resolveItemActive('char:1', {}, {}), false);
});

test('forced-active wins with no collections', () => {
    assert.equal(resolveItemActive('char:1', { 'char:1': 'active' }, {}), true);
});

test('member of an active collection is active', () => {
    const collections = { c1: { active: true, memberKeys: ['char:1', 'char:2'] } };
    assert.equal(resolveItemActive('char:1', {}, collections), true);
    assert.equal(resolveItemActive('char:3', {}, collections), false);
});

test('member of an inactive collection is not active from that collection alone', () => {
    const collections = { c1: { active: false, memberKeys: ['char:1'] } };
    assert.equal(resolveItemActive('char:1', {}, collections), false);
});

test('a legacy forced-inactive value (from before this override was removed) no longer overrides collection membership', () => {
    const collections = { c1: { active: true, memberKeys: ['char:1'] } };
    assert.equal(resolveItemActive('char:1', { 'char:1': 'inactive' }, collections), true);
});

test('forced-active protects a member from its collection deactivating', () => {
    const collections = { c1: { active: false, memberKeys: ['char:1'] } };
    assert.equal(resolveItemActive('char:1', { 'char:1': 'active' }, collections), true);
});

test('deactivating one collection does not affect a member still in another active collection', () => {
    const collections = {
        c1: { active: false, memberKeys: ['char:1'] },
        c2: { active: true, memberKeys: ['char:1', 'char:2'] },
    };
    assert.equal(resolveItemActive('char:1', {}, collections), true);
});

test('resolveAllActive returns the resolved set for a list of keys', () => {
    const collections = { c1: { active: true, memberKeys: ['char:1'] } };
    const itemStates = { 'char:2': 'active', 'char:3': 'inactive' };
    const result = resolveAllActive(['char:1', 'char:2', 'char:3', 'char:4'], itemStates, collections);
    assert.deepEqual([...result].sort(), ['char:1', 'char:2']);
});

test('resolveActiveCollectionNames returns the name of every active collection containing the item', () => {
    const collections = {
        c1: { active: true, memberKeys: ['char:1'], name: 'Dorm Crew' },
        c2: { active: true, memberKeys: ['char:1', 'char:2'], name: 'All Students' },
    };
    assert.deepEqual(resolveActiveCollectionNames('char:1', collections).sort(), ['All Students', 'Dorm Crew']);
});

test('resolveActiveCollectionNames omits a collection the item belongs to that is not active', () => {
    const collections = { c1: { active: false, memberKeys: ['char:1'], name: 'Dorm Crew' } };
    assert.deepEqual(resolveActiveCollectionNames('char:1', collections), []);
});

test('resolveActiveCollectionNames returns an empty array for an item in no active collection', () => {
    assert.deepEqual(resolveActiveCollectionNames('char:1', {}), []);
});
