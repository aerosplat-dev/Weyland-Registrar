/**
 * Rebuilds the full "Character Roster" entry text from every currently-active
 * character record. Must be called with the COMPLETE active set every time —
 * never patch an existing roster string, always regenerate from scratch.
 *
 * Line format is hand-ported from the Registrar's own base.js buildLoreBook()
 * (that function itself is DOM-dependent and reflects the site's live filtered
 * selection, not our persisted active set, so it cannot be called directly —
 * see the plan's Global Constraints). Header/footer text is intentionally
 * plain, not the site's page-specific suffix variant — WeyPhone's own parser
 * matches via the lenient regex /\[CHARACTER ROSTER\b/i.
 * @param {Array<object>} records - raw character records for every active character
 * @returns {string}
 */
export function buildCharacterRosterText(records) {
    let text = '[CHARACTER ROSTER]\n' +
        "The following is a list of special named NPC's that live on and around the campus. " +
        "If an NPC is 'not yet in college', they should NEVER appear on campus randomly, and " +
        'should only appear in roleplay if {{char}} specifically looks for them.\n';
    for (const record of records) {
        const names = String(record.name).split(',').map(n => n.trim());
        const pseudonyms = names.slice(1);
        text += `${names[0]}: (` +
            (pseudonyms.length ? `AKA: [${pseudonyms.toString()}], ` : '') +
            `${record.species}, ` +
            (record.roster ? `${record.roster}, ` : '') +
            `${record.gender}, Username: ${record.onlineHandle}, {{getvar:${record.schoolYear}}},` +
            (record.major ? ` Major: ${record.major},` : '') +
            ` ${record.dwelling})\n`;
    }
    text += '[END CHARACTER ROSTER]';
    return text;
}

/**
 * Rebuilds the full "Location List" entry text from every currently-active
 * location record. Same regenerate-from-scratch rule as buildCharacterRosterText.
 * @param {Array<object>} records - raw location records for every active location
 * @returns {string}
 */
export function buildLocationListText(records) {
    let text = '[LOCATIONS]\nThe following is a list of special named locations on and around the campus.\n';
    for (const record of records) {
        text += `${record.name}: (${record.summary})\n`;
    }
    text += '[END LOCATIONS]';
    return text;
}
