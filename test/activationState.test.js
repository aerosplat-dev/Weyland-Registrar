import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveItemActive, resolveAllActive } from '../lib/activationState.js';

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

test('forced-inactive overrides collection membership', () => {
    const collections = { c1: { active: true, memberKeys: ['char:1'] } };
    assert.equal(resolveItemActive('char:1', { 'char:1': 'inactive' }, collections), false);
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
