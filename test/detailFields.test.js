// test/detailFields.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTags, buildDetailFields } from '../lib/ui/detailFields.js';

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
