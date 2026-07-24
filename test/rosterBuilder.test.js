// test/rosterBuilder.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCharacterRosterText, buildLocationListText } from '../lib/rosterBuilder.js';

test('empty roster still has header and footer', () => {
    const text = buildCharacterRosterText([]);
    assert.match(text, /^\[ADDITIONAL CHARACTERS\]/);
    assert.match(text, /\[END ADDITIONAL CHARACTERS\]$/);
});

test('single character line matches the Registrar template exactly', () => {
    const text = buildCharacterRosterText([{
        name: 'Maeve',
        species: 'Usagimimi',
        roster: 'blond, outgoing introvert',
        gender: 'Female',
        onlineHandle: '@HareSay',
        schoolYear: 'MCY',
        major: 'Journalism',
        dwelling: 'Sterling Hall, Room 117',
    }]);
    assert.match(
        text,
        /Maeve: \(Usagimimi, blond, outgoing introvert, Female, Username: @HareSay, \{\{getvar:MCY\}\}, Major: Journalism, Sterling Hall, Room 117\)/,
    );
});

test('pseudonyms from comma-separated name become an AKA prefix', () => {
    const text = buildCharacterRosterText([{
        name: 'Shy, Snek',
        species: 'Hebimimi', roster: '', gender: 'Nonbinary',
        onlineHandle: '@shy', schoolYear: 'MCY', major: '', dwelling: 'O\'See Hall',
    }]);
    assert.match(text, /^Shy: \(AKA: \[Snek\], Hebimimi,/m);
});

test('character with no major omits the Major field', () => {
    const text = buildCharacterRosterText([{
        name: 'Sky', species: 'Wolf', roster: '', gender: 'Male',
        onlineHandle: '@sky', schoolYear: 'MCY', major: '', dwelling: 'O\'See Hall',
    }]);
    assert.doesNotMatch(text, /Major:/);
});

test('location list line matches the Registrar template exactly', () => {
    const text = buildLocationListText([
        { name: "Mack's Autozone", summary: 'An old but lively auto repair shop.' },
    ]);
    assert.match(text, /^\[ADDITIONAL LOCATIONS\]/);
    assert.match(text, /Mack's Autozone: \(An old but lively auto repair shop\.\)/);
    assert.match(text, /\[END ADDITIONAL LOCATIONS\]$/);
});
