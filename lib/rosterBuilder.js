/**
 * Rebuilds the full "Character Roster" entry text from every currently-active
 * character record. Must be called with the COMPLETE active set every time —
 * never patch an existing roster string, always regenerate from scratch.
 *
 * Line format is hand-ported from the Registrar's own base.js buildLoreBook()
 * (that function itself is DOM-dependent and reflects the site's live filtered
 * selection, not our persisted active set, so it cannot be called directly —
 * see the plan's Global Constraints). Header/footer say "ADDITIONAL
 * CHARACTERS", not the site's own "CHARACTER ROSTER" wording, so the model
 * reads this as a supplement to the setting's canonical built-in roster
 * (which appears earlier in context) rather than an override of it.
 * WeyPhone's own roster detection (registrarLorebook.js) still finds this
 * entry regardless — it matches on entry.comment ("Character Roster",
 * unchanged), not on this bracketed content text.
 * @param {Array<object>} records - raw character records for every active character
 * @returns {string}
 */
export function buildCharacterRosterText(records) {
    let text = '[ADDITIONAL CHARACTERS]\n' +
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
    text += '[END ADDITIONAL CHARACTERS]';
    return text;
}

/**
 * Rebuilds the full "Location List" entry text from every currently-active
 * location record. Same regenerate-from-scratch rule as buildCharacterRosterText.
 * Header/footer say "ADDITIONAL LOCATIONS", for the same reason as the
 * character roster above — distinguishes these from the setting's canonical
 * built-in locations rather than reading as an override.
 * @param {Array<object>} records - raw location records for every active location
 * @returns {string}
 */
export function buildLocationListText(records) {
    let text = '[ADDITIONAL LOCATIONS]\nThe following is a list of special named locations on and around the campus.\n';
    for (const record of records) {
        text += `${record.name}: (${record.summary})\n`;
    }
    text += '[END ADDITIONAL LOCATIONS]';
    return text;
}
