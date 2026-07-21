/**
 * Parses a Registrar-style JSON-encoded tag array (e.g. '["campus","dorms"]')
 * into a human-readable comma-separated string. Never throws -- malformed or
 * empty input yields an empty string.
 * @param {string} tagsJson
 * @returns {string}
 */
export function formatTags(tagsJson) {
    if (!tagsJson) return '';
    try {
        const parsed = JSON.parse(tagsJson);
        if (!Array.isArray(parsed) || parsed.length === 0) return '';
        return parsed.join(', ');
    } catch {
        return '';
    }
}

/**
 * Selects and formats the curated set of fields worth showing in the detail
 * pane for one item -- deliberately NOT every raw field the record has
 * (backstory/secrets/relationships etc. exist only to build World Info
 * entries, not to help a user decide whether to activate someone). Returns
 * an ordered list of {label, value} pairs with any empty/absent field
 * omitted entirely (never an empty-value row).
 * @param {object} record
 * @param {'character'|'location'|'collection'|'lore'|'local'} kind
 * @returns {Array<{label: string, value: string}>}
 */
export function buildDetailFields(record, kind) {
    if (kind === 'character') {
        const fields = [];
        const identity = [record.species, record.gender, record.baseAge].filter(Boolean).join(' · ');
        if (identity) fields.push({ label: 'Species / Gender / Age', value: identity });
        if (record.personality) fields.push({ label: 'Personality', value: record.personality });
        if (record.appearance) fields.push({ label: 'Appearance', value: record.appearance });
        const tags = formatTags(record.tags);
        if (tags) fields.push({ label: 'Tags', value: tags });
        return fields;
    }
    if (kind === 'location') {
        const fields = [];
        if (record.description) fields.push({ label: 'Description', value: record.description });
        const tags = formatTags(record.tags);
        if (tags) fields.push({ label: 'Tags', value: tags });
        return fields;
    }
    return [];
}

/**
 * Selects and formats the two "reveal on demand" field groups for a
 * character's detail view. Deliberately NOT part of buildDetailFields's
 * curated set (see that function's own doc comment for why) -- shown only
 * when the user explicitly clicks a "Show Background/History" or "Show
 * Secrets" button. Field mapping is a deliberate choice, not the only
 * possible one: knownBackground/backgroundFriends are public-flavored
 * background info; hiddenBackground is explicitly named as hidden content,
 * so it groups with secrets (the same spoiler tier) rather than with the
 * public background fields.
 * @param {object} record
 * @param {'background'|'secrets'} section
 * @returns {Array<{label: string, value: string}>}
 */
export function buildRevealableFields(record, section) {
    if (section === 'background') {
        const fields = [];
        if (record.knownBackground) fields.push({ label: 'Background', value: record.knownBackground });
        if (record.backgroundFriends) fields.push({ label: 'Background Friends', value: record.backgroundFriends });
        return fields;
    }
    if (section === 'secrets') {
        const fields = [];
        if (record.hiddenBackground) fields.push({ label: 'Hidden Background', value: record.hiddenBackground });
        if (record.secrets) fields.push({ label: 'Secrets', value: record.secrets });
        return fields;
    }
    return [];
}
