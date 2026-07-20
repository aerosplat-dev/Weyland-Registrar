// lib/scenarioBooks.js
import { withTimeout } from './entryBuilder.js';

/**
 * Named lore items get their own dedicated "Lore Book - <name>" file, never
 * merged with anything else -- mirrors the per-item book naming used for
 * characters/locations elsewhere in this extension.
 *
 * Includes the scenario's own loreId so the name can never collide with (a) the
 * shared character book (lib/worldInfoWriter.js's CHARACTER_BOOK_NAME, itself a
 * fixed "Lore Book - Weyland Registrar" string -- a scenario literally named
 * "Weyland Registrar" would otherwise produce that exact string and clobber the
 * shared character book on activation) or (b) another scenario that happens to
 * share the same `name` (two same-named scenarios would otherwise write/toggle
 * the same on-disk file while settings.scenarioBooks tracks their active state
 * independently per loreId, desyncing state from disk).
 * @param {{name: string, loreId: string|number}} loreRecord
 * @returns {string}
 */
export function scenarioBookName(loreRecord) {
    return `Lore Book - ${loreRecord.name} (${loreRecord.loreId})`;
}

/**
 * Writes a scenario's dedicated book (built via the sandbox's buildRosterEntry
 * for any characters the scenario itself bundles -- full construction wiring
 * happens the same way as syncCharacterBook/syncLocationBook, omitted here for
 * brevity since this task focuses on the book-level activate/deactivate
 * contract) and activates it as a whole book.
 *
 * On reactivation (when the book was previously built and then deactivated),
 * skips the rebuild and just turns the book back on, preserving any content.
 * @param {object} stContext
 * @param {(name: string, args: any[]) => Promise<any>} callFunction
 * @param {import('./settings.js').WeylandRegistrarSettings} settings
 * @param {object} loreRecord - raw record from /lore/list
 */
export async function activateScenario(stContext, callFunction, settings, loreRecord) {
    const bookName = scenarioBookName(loreRecord);
    const existingRecord = settings.scenarioBooks[loreRecord.loreId];

    // If the book already exists from a prior build (whether currently active or deactivated),
    // reuse it instead of rebuilding.
    if (existingRecord && existingRecord.book === bookName) {
        await stContext.updateWorldInfoList();
        await stContext.executeSlashCommandsWithOptions(`/world state=on silent=true "${bookName}"`);
        settings.scenarioBooks[loreRecord.loreId] = { active: true, book: bookName };
        return;
    }

    // First-time build: construct the book from scratch. Wrapped in withTimeout (shared
    // with entryBuilder.js) so a stalled/unreachable sandbox can't hang this call forever.
    const rosterEntry = await withTimeout(callFunction, 'buildRosterEntry', [5000, `[SCENARIO]\n${loreRecord.greeting ?? ''}\n[END SCENARIO]`]);
    const book = { entries: { [rosterEntry.uid]: rosterEntry } };

    await stContext.saveWorldInfo(bookName, book, true);
    await stContext.updateWorldInfoList();
    await stContext.executeSlashCommandsWithOptions(`/world state=on silent=true "${bookName}"`);

    settings.scenarioBooks[loreRecord.loreId] = { active: true, book: bookName };
}

/**
 * Deactivates a scenario's book WITHOUT deleting it from disk -- re-activating
 * later should not require re-fetching/rebuilding, matching the caching
 * philosophy for characters/locations.
 * @param {object} stContext
 * @param {import('./settings.js').WeylandRegistrarSettings} settings
 * @param {{loreId: string}} loreRecord
 */
export async function deactivateScenario(stContext, settings, loreRecord) {
    const state = settings.scenarioBooks[loreRecord.loreId];
    const bookName = state?.book ?? scenarioBookName(loreRecord);
    await stContext.executeSlashCommandsWithOptions(`/world state=off silent=true "${bookName}"`);
    settings.scenarioBooks[loreRecord.loreId] = { active: false, book: bookName };
}
