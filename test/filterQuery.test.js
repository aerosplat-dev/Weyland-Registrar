// test/filterQuery.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSearchTerms, matchesTerms } from '../lib/filterQuery.js';

test('plain words become master-prop terms', () => {
    assert.deepEqual(parseSearchTerms('cat girl'), [
        { prop: 'master', value: 'cat', negate: false },
        { prop: 'master', value: 'girl', negate: false },
    ]);
});

test('prop:value becomes a scoped term', () => {
    assert.deepEqual(parseSearchTerms('owner:josh033169'), [
        { prop: 'owner', value: 'josh033169', negate: false },
    ]);
});

test('prop:!value becomes a negated scoped term', () => {
    assert.deepEqual(parseSearchTerms('species:!human'), [
        { prop: 'species', value: 'human', negate: true },
    ]);
});

test('quoted phrases are kept intact as one master term', () => {
    assert.deepEqual(parseSearchTerms('"cat girl" fluffy'), [
        { prop: 'master', value: 'fluffy', negate: false },
        { prop: 'master', value: 'cat girl', negate: false },
    ]);
});

test('empty search string yields no terms', () => {
    assert.deepEqual(parseSearchTerms(''), []);
});

test('matchesTerms: affirmative term must match', () => {
    const blob = { species: 'nekomimi', owner: 'josh033169' };
    assert.equal(matchesTerms(blob, [{ prop: 'species', value: 'neko', negate: false }]), true);
    assert.equal(matchesTerms(blob, [{ prop: 'species', value: 'wolf', negate: false }]), false);
});

test('matchesTerms: negated term must NOT match', () => {
    const blob = { species: 'nekomimi' };
    assert.equal(matchesTerms(blob, [{ prop: 'species', value: 'neko', negate: true }]), false);
    assert.equal(matchesTerms(blob, [{ prop: 'species', value: 'wolf', negate: true }]), true);
});

test('matchesTerms: unknown prop on the blob is skipped, not a failure', () => {
    const blob = { species: 'nekomimi' };
    assert.equal(matchesTerms(blob, [{ prop: 'nonexistent', value: 'x', negate: false }]), true);
});

test('matchesTerms: multiple terms are ANDed together', () => {
    const blob = { species: 'nekomimi', owner: 'josh033169' };
    assert.equal(matchesTerms(blob, [
        { prop: 'species', value: 'neko', negate: false },
        { prop: 'owner', value: 'josh', negate: false },
    ]), true);
    assert.equal(matchesTerms(blob, [
        { prop: 'species', value: 'neko', negate: false },
        { prop: 'owner', value: 'someoneelse', negate: false },
    ]), false);
});

test('multiple quoted phrases in one search string are each captured separately', () => {
    const terms = parseSearchTerms('"cat girl" fluffy "blue eyes"');
    assert.deepEqual(terms, [
        { prop: 'master', value: 'fluffy', negate: false },
        { prop: 'master', value: 'cat girl', negate: false },
        { prop: 'master', value: 'blue eyes', negate: false },
    ]);
});

test('matchesTerms: affirmative term with pipe-delimited value matches any piped option', () => {
    const blob = { species: 'kitsune' };
    assert.equal(matchesTerms(blob, [
        { prop: 'species', value: 'neko|kitsune', negate: false },
    ]), true);
    assert.equal(matchesTerms(blob, [
        { prop: 'species', value: 'neko|fox', negate: false },
    ]), false);
});

test('matchesTerms: negated term with pipe-delimited value fails if blob contains any piped option', () => {
    const blob = { species: 'kitsune' };
    assert.equal(matchesTerms(blob, [
        { prop: 'species', value: 'neko|kitsune', negate: true },
    ]), false);
    assert.equal(matchesTerms(blob, [
        { prop: 'species', value: 'neko|fox', negate: true },
    ]), true);
});
