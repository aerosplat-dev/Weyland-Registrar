// test/detailFields.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTags, buildDetailFields, buildRevealableFields } from '../lib/ui/detailFields.js';

test('formatTags parses a JSON tag array into a comma-separated string', () => {
    assert.equal(formatTags('["campus","dorms"]'), 'campus, dorms');
});

test('formatTags returns an empty string for empty/malformed input', () => {
    assert.equal(formatTags(''), '');
    assert.equal(formatTags('not-json'), '');
    assert.equal(formatTags('[]'), '');
});

test('buildDetailFields for a character includes species/gender/age as one line', () => {
    const fields = buildDetailFields({ species: 'Usagimimi', gender: 'Female', baseAge: '20' }, 'character');
    const speciesLine = fields.find(f => f.label === 'Species / Gender / Age');
    assert.ok(speciesLine);
    assert.equal(speciesLine.value, 'Usagimimi · Female · 20');
});

test('buildDetailFields for a character omits the species/gender/age line entirely if all three are empty', () => {
    const fields = buildDetailFields({ species: '', gender: '', baseAge: '', personality: 'Kind' }, 'character');
    assert.equal(fields.some(f => f.label === 'Species / Gender / Age'), false);
});

test('buildDetailFields for a character includes personality, appearance, and tags when present', () => {
    const fields = buildDetailFields({
        personality: 'Bubbly and outgoing.',
        appearance: 'Tall with red hair.',
        tags: '["campus"]',
    }, 'character');
    assert.deepEqual(fields, [
        { label: 'Personality', value: 'Bubbly and outgoing.' },
        { label: 'Appearance', value: 'Tall with red hair.' },
        { label: 'Tags', value: 'campus' },
    ]);
});

test('buildDetailFields omits empty optional fields for a character', () => {
    const fields = buildDetailFields({ personality: 'Kind.' }, 'character');
    assert.deepEqual(fields, [{ label: 'Personality', value: 'Kind.' }]);
});

test('buildDetailFields for a location includes description and tags', () => {
    const fields = buildDetailFields({ description: 'A quiet library.', tags: '["campus","quiet"]' }, 'location');
    assert.deepEqual(fields, [
        { label: 'Description', value: 'A quiet library.' },
        { label: 'Tags', value: 'campus, quiet' },
    ]);
});

test('buildDetailFields returns an empty array for collection/lore/local kinds', () => {
    assert.deepEqual(buildDetailFields({ name: 'X', summary: 'Y' }, 'collection'), []);
    assert.deepEqual(buildDetailFields({ name: 'X', summary: 'Y' }, 'lore'), []);
    assert.deepEqual(buildDetailFields({ name: 'X', summary: 'Y' }, 'local'), []);
});

test('buildRevealableFields background section returns Background and Background Friends, in order', () => {
    const fields = buildRevealableFields({
        knownBackground: 'Raised in rural Sweden.',
        backgroundFriends: 'Sven & Astrid (parents)',
        hiddenBackground: 'Should not appear here',
        secrets: 'Should not appear here',
    }, 'background');
    assert.deepEqual(fields, [
        { label: 'Background', value: 'Raised in rural Sweden.' },
        { label: 'Background Friends', value: 'Sven & Astrid (parents)' },
    ]);
});

test('buildRevealableFields background section omits empty fields', () => {
    const fields = buildRevealableFields({ knownBackground: 'Some history.', backgroundFriends: '' }, 'background');
    assert.deepEqual(fields, [{ label: 'Background', value: 'Some history.' }]);
});

test('buildRevealableFields secrets section returns Hidden Background and Secrets, in order', () => {
    const fields = buildRevealableFields({
        knownBackground: 'Should not appear here',
        hiddenBackground: 'A private history detail.',
        secrets: 'Devours trashy romance novels.',
    }, 'secrets');
    assert.deepEqual(fields, [
        { label: 'Hidden Background', value: 'A private history detail.' },
        { label: 'Secrets', value: 'Devours trashy romance novels.' },
    ]);
});

test('buildRevealableFields secrets section omits empty fields', () => {
    const fields = buildRevealableFields({ hiddenBackground: '', secrets: 'Just this one.' }, 'secrets');
    assert.deepEqual(fields, [{ label: 'Secrets', value: 'Just this one.' }]);
});

test('buildRevealableFields returns [] for an unrecognized section', () => {
    assert.deepEqual(buildRevealableFields({ secrets: 'x' }, 'bogus'), []);
});

test('buildRevealableFields never surfaces backgroundKeywords/secretsKeywords', () => {
    const bg = buildRevealableFields({ knownBackground: 'x', backgroundKeywords: 'rural, sweden' }, 'background');
    assert.equal(bg.some(f => f.value.includes('rural, sweden')), false);
    const sec = buildRevealableFields({ secrets: 'x', secretsKeywords: 'romance, novels' }, 'secrets');
    assert.equal(sec.some(f => f.value.includes('romance, novels')), false);
});
