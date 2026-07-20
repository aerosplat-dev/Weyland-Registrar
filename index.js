// index.js
import { resolveExtensionBasePath } from './lib/location.js';
import { getSettings } from './lib/settings.js';
import { injectToolbarButton } from './lib/ui/toolbarButton.js';
import { openModal } from './lib/ui/modal.js';
import { createCatalogCache, createIndexedDbStorageEngine } from './lib/catalogCache.js';
import { fetchCharacterList, fetchLocationList, fetchCollectionList, fetchLoreList, toItemKey, buildSearchBlob } from './lib/registrarApi.js';
import { createEntrySandbox } from './lib/entrySandbox.js';
import { syncCharacterBook, syncLocationBook } from './lib/worldInfoWriter.js';
import { activateScenario, deactivateScenario } from './lib/scenarioBooks.js';
import { resolveItemActive } from './lib/activationState.js';
import { resolveCollectionMembers } from './lib/collectionResolver.js';

const EXTENSION_BASE_PATH = resolveExtensionBasePath(import.meta.url);

let sandboxHandle = null;
let catalogCache = null;

function getStContext() {
    return SillyTavern.getContext();
}

async function ensureSandbox(settings) {
    if (!sandboxHandle) {
        sandboxHandle = await createEntrySandbox(settings.apiBaseUrl);
    }
    return sandboxHandle;
}

function buildResolvedCollections(settings, catalog) {
    const result = {};
    for (const [id, collectionState] of Object.entries(settings.collections)) {
        if (settings.localCollections[id]) {
            result[id] = { active: !!collectionState.active, memberKeys: settings.localCollections[id].memberKeys };
        } else {
            const record = (catalog.collections ?? []).find(c => String(c.collectionId) === id);
            result[id] = { active: !!collectionState.active, memberKeys: record ? resolveCollectionMembers(record, catalog) : [] };
        }
    }
    return result;
}

async function refreshCatalog(settings) {
    const [characters, locations, collections, lore] = await Promise.all([
        fetchCharacterList(settings.apiBaseUrl),
        fetchLocationList(settings.apiBaseUrl),
        fetchCollectionList(settings.apiBaseUrl),
        fetchLoreList(settings.apiBaseUrl),
    ]);
    const taggedCharacters = characters.map(r => ({ ...r, itemKey: toItemKey(r, 'character'), searchBlob: buildSearchBlob(r, 'character') }));
    const taggedLocations = locations.map(r => ({ ...r, itemKey: toItemKey(r, 'location'), searchBlob: buildSearchBlob(r, 'location') }));

    await catalogCache.setCharacters(taggedCharacters);
    await catalogCache.setLocations(taggedLocations);
    await catalogCache.setCollections(collections);
    await catalogCache.setLore(lore);
    await catalogCache.setLastRefreshed(Date.now());

    return { characters: taggedCharacters, locations: taggedLocations, collections, lore };
}

async function syncBooks(settings) {
    const catalog = {
        characters: (await catalogCache.getCharacters()) ?? [],
        locations: (await catalogCache.getLocations()) ?? [],
        collections: (await catalogCache.getCollections()) ?? [],
    };
    const resolvedCollections = buildResolvedCollections(settings, catalog);
    const settingsForSync = { ...settings, collections: resolvedCollections };

    const sandbox = await ensureSandbox(settings);
    const stContext = getStContext();

    const charactersByKey = Object.fromEntries(catalog.characters.map(r => [r.itemKey, r]));
    const locationsByKey = Object.fromEntries(catalog.locations.map(r => [r.itemKey, r]));

    await syncCharacterBook(stContext, sandbox.callFunction, settingsForSync, charactersByKey);
    await syncLocationBook(stContext, sandbox.callFunction, settingsForSync, locationsByKey);
}

/**
 * Classifies a modal itemKey by which activation mechanism owns it.
 *
 * Task 16's itemList.js click handler only ever passes item.itemKey back to
 * onActivate/onDeactivate/resolveActive/resolveForced -- it never passes the
 * tab/type the item came from (openModal's state interface is intentionally
 * generic over itemKey). So this extension has to recover "what kind of
 * thing is this" from the key's own shape:
 *  - "char:"/"loc:" prefix (lib/registrarApi.js's toItemKey) -> an individual
 *    character/location, resolved via the tri-state model in
 *    lib/activationState.js (spec S9): settings.itemStates[itemKey].
 *  - "local:" prefix (always, by construction -- see
 *    lib/localCollections.js's createLocalCollection) -> a local collection.
 *  - "lore:" prefix (this module's own getItemsForType('lore') below, which
 *    mints `lore:${l.loreId}`) -> a scenario/lore item. Per spec S8, lore/
 *    scenarios activate via their OWN dedicated whole-book mechanism
 *    (lib/scenarioBooks.js's activateScenario/deactivateScenario) -- never
 *    itemStates, never settings.collections. (The brief's original reference
 *    index.js routed every itemKey through the generic itemStates+syncBooks
 *    path, which would silently never create/activate a scenario's dedicated
 *    Lore Book at all -- a real gap, caught by cross-checking spec S8 and
 *    lib/scenarioBooks.js directly.)
 *  - otherwise -> a Registrar collection id: settings.collections[id].active
 *    (spec S9's collection-level active flag, distinct from itemStates).
 *
 * Registrar collectionId and loreId are both raw, unprefixed ids drawn from
 * two independent id spaces on the Registrar -- nothing stops a collection
 * and a lore item from sharing the same raw id value. getItemsForType('lore')
 * below prefixes its itemKey with "lore:" (matching the char:/loc:/local:
 * convention) specifically so this classification is an unambiguous prefix
 * check with zero collision risk against a same-valued collectionId; only
 * lib/scenarioBooks.js's OWN internal keying (settings.scenarioBooks,
 * catalog.lore lookups) still uses the raw loreId, so every call site here
 * that classifies a key as 'lore' must strip the "lore:" prefix before using
 * it to look up a lore record or index into settings.scenarioBooks. Lore is
 * checked before the collection fallback since it is the narrower, more
 * specific mechanism.
 * @param {string|number} itemKey
 * @returns {'item'|'lore'|'collection'}
 */
function classifyItemKey(itemKey) {
    const key = String(itemKey);
    if (key.startsWith('char:') || key.startsWith('loc:')) return 'item';
    if (key.startsWith('local:')) return 'collection';
    if (key.startsWith('lore:')) return 'lore';
    return 'collection';
}

async function initModal(settings) {
    const catalog = {
        characters: (await catalogCache.getCharacters()) ?? [],
        locations: (await catalogCache.getLocations()) ?? [],
        collections: (await catalogCache.getCollections()) ?? [],
        lore: (await catalogCache.getLore()) ?? [],
    };
    const resolvedCollections = buildResolvedCollections(settings, catalog);

    /**
     * Handles both onActivate and onDeactivate for every tab. Fix #1: branches
     * by classifyItemKey so a collection-type itemKey writes
     * settings.collections[id].active (spec S9) instead of itemStates, and a
     * lore-type itemKey goes through activateScenario/deactivateScenario
     * (spec S8) instead of itemStates+syncBooks. Fix #2: re-renders the modal
     * afterward so the toggled card's state is visible immediately, per
     * Task 16's own review concern that openModal has no built-in
     * auto-refresh-after-toggle.
     * @param {string|number} itemKey
     * @param {boolean} makeActive
     */
    async function handleToggle(itemKey, makeActive) {
        const kind = classifyItemKey(itemKey);

        if (kind === 'lore') {
            const loreId = String(itemKey).slice('lore:'.length);
            const loreRecord = catalog.lore.find(l => String(l.loreId) === loreId);
            if (loreRecord) {
                const stContext = getStContext();
                if (makeActive) {
                    const sandbox = await ensureSandbox(settings);
                    await activateScenario(stContext, sandbox.callFunction, settings, loreRecord);
                } else {
                    await deactivateScenario(stContext, settings, loreRecord);
                }
            }
        } else if (kind === 'collection') {
            const key = String(itemKey);
            const existing = settings.collections[key];
            settings.collections[key] = {
                active: makeActive,
                source: existing?.source ?? (settings.localCollections[key] ? 'local' : 'registrar'),
            };
            await syncBooks(settings);
        } else {
            settings.itemStates[itemKey] = makeActive ? 'active' : 'inactive';
            await syncBooks(settings);
        }

        getStContext().saveSettingsDebounced();

        // Re-render (fix #2). openModal()'s own render always jumps back to
        // the "character" tab, so remember whichever tab was actually being
        // viewed and click back onto it once the fresh render lands -- this
        // still only calls what modal.js already exposes (openModal, plus
        // the .wreg-tab click handler it wires itself), no modal.js changes.
        const overlay = document.getElementById('wreg-modal-overlay');
        const previousType = overlay?.dataset.currentType;
        await initModal(settings);
        if (previousType && previousType !== 'character') {
            document.getElementById('wreg-modal-overlay')
                ?.querySelector(`.wreg-tab[data-type="${previousType}"]`)
                ?.click();
        }
    }

    openModal({
        getItemsForType: (type) => {
            if (type === 'character') return catalog.characters;
            if (type === 'location') return catalog.locations;
            if (type === 'collection') return catalog.collections.map(c => ({ itemKey: c.collectionId, name: c.name, summary: c.summary }));
            if (type === 'lore') return catalog.lore.map(l => ({ itemKey: `lore:${l.loreId}`, name: l.name, summary: l.summary }));
            if (type === 'local') return Object.entries(settings.localCollections).map(([id, c]) => ({ itemKey: id, name: c.name }));
            return [];
        },
        resolveActive: (itemKey) => {
            const kind = classifyItemKey(itemKey);
            if (kind === 'lore') return !!settings.scenarioBooks[String(itemKey).slice('lore:'.length)]?.active;
            if (kind === 'collection') return !!resolvedCollections[String(itemKey)]?.active;
            return resolveItemActive(itemKey, settings.itemStates, resolvedCollections);
        },
        resolveForced: (itemKey) => {
            // Only individual characters/locations carry a forced tri-state
            // override (spec S9) -- collections and lore/scenario items have
            // no forced concept, so they never show a "Pinned" badge.
            return classifyItemKey(itemKey) === 'item' ? (settings.itemStates[itemKey] ?? 'none') : 'none';
        },
        onActivate: (itemKey) => handleToggle(itemKey, true),
        onDeactivate: (itemKey) => handleToggle(itemKey, false),
        onRefreshCatalog: async () => {
            try {
                await refreshCatalog(settings);
                await syncBooks(settings);
                await initModal(settings);
            } catch (error) {
                console.error('[Weyland-Registrar] Manual catalog refresh failed:', error);
            }
        },
    });
}

async function addExtensionSettings(settings) {
    const context = getStContext();
    const template = await context.renderExtensionTemplateAsync(EXTENSION_BASE_PATH, 'settings');
    $('#extensions_settings2').append(template);
    $('#wreg-api-base-url').val(settings.apiBaseUrl).on('input', function () {
        settings.apiBaseUrl = String($(this).val());
        context.saveSettingsDebounced();
    });
    $('#wreg-refresh-interval').val(settings.refreshIntervalMinutes).on('input', function () {
        settings.refreshIntervalMinutes = Number($(this).val());
        context.saveSettingsDebounced();
    });
}

/**
 * True if the cache is empty, or older than settings.refreshIntervalMinutes
 * (spec S14: the setting exists specifically to drive this cadence check --
 * lib/catalogCache.js's getLastRefreshed() has no other caller anywhere in
 * the plan, and refreshIntervalMinutes was otherwise only ever read/written
 * by the settings-drawer binding, never actually consulted -- a dead setting
 * otherwise).
 * @param {import('./lib/settings.js').WeylandRegistrarSettings} settings
 * @returns {Promise<boolean>}
 */
async function isCatalogStale(settings) {
    const lastRefreshed = await catalogCache.getLastRefreshed();
    if (!lastRefreshed) return true;
    const intervalMinutes = Number(settings.refreshIntervalMinutes) > 0 ? Number(settings.refreshIntervalMinutes) : 60;
    return Date.now() - lastRefreshed >= intervalMinutes * 60 * 1000;
}

jQuery(async () => {
    const context = getStContext();
    const settings = getSettings(context.extensionSettings);
    catalogCache = createCatalogCache(createIndexedDbStorageEngine());

    await addExtensionSettings(settings);
    injectToolbarButton(() => {
        (async () => {
            try {
                await initModal(settings);
            } catch (error) {
                // injectToolbarButton's click handler calls this callback
                // fire-and-forget (no await/catch of its own) -- without this
                // wrapper, a rejected initModal (e.g. an IndexedDB read
                // failure, or a template-fetch failure inside openModal)
                // would become an unhandled promise rejection.
                console.error('[Weyland-Registrar] Opening modal failed:', error);
            }
        })();
    });

    try {
        if (!(await catalogCache.getCharacters()) || await isCatalogStale(settings)) {
            await refreshCatalog(settings);
        }
    } catch (error) {
        // A Registrar-unreachable first boot shouldn't leave an unhandled
        // rejection behind (jQuery() calls this callback fire-and-forget,
        // it never awaits/catches it) -- the toolbar button and modal
        // remain usable either way, and the modal's own "Refresh Catalog"
        // button (below) can retry once the Registrar is reachable again.
        console.error('[Weyland-Registrar] Initial catalog refresh failed:', error);
    }
});
