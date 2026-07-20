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
