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
 *  - otherwise, a match by id in the cached lore list -> a scenario/lore
 *    item. Per spec S8, lore/scenarios activate via their OWN dedicated
 *    whole-book mechanism (lib/scenarioBooks.js's activateScenario/
 *    deactivateScenario) -- never itemStates, never settings.collections.
 *    (The brief's original reference index.js routed every itemKey through
 *    the generic itemStates+syncBooks path, which would silently never
 *    create/activate a scenario's dedicated Lore Book at all -- a real gap,
 *    caught by cross-checking spec S8 and lib/scenarioBooks.js directly.)
 *  - otherwise -> a Registrar collection id: settings.collections[id].active
 *    (spec S9's collection-level active flag, distinct from itemStates).
 *
 * Registrar collectionId and loreId are both raw, unprefixed ids drawn from
 * two independent id spaces on the Registrar (see getItemsForType below); a
 * same-value collision between them is a pre-existing ambiguity in how
 * Task 16's modal itemKey scheme represents those two tabs, not something
 * introduced here. Lore is checked first since it is the narrower, more
 * specific mechanism.
 * @param {string|number} itemKey
 * @param {{lore?: object[]}} catalog
 * @returns {'item'|'lore'|'collection'}
 */
function classifyItemKey(itemKey, catalog) {
    const key = String(itemKey);
    if (key.startsWith('char:') || key.startsWith('loc:')) return 'item';
    if (key.startsWith('local:')) return 'collection';
    if ((catalog.lore ?? []).some(l => String(l.loreId) === key)) return 'lore';
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
        const kind = classifyItemKey(itemKey, catalog);

        if (kind === 'lore') {
            const loreRecord = catalog.lore.find(l => String(l.loreId) === String(itemKey));
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
            if (type === 'lore') return catalog.lore.map(l => ({ itemKey: l.loreId, name: l.name, summary: l.summary }));
            if (type === 'local') return Object.entries(settings.localCollections).map(([id, c]) => ({ itemKey: id, name: c.name }));
            return [];
        },
        resolveActive: (itemKey) => {
            const kind = classifyItemKey(itemKey, catalog);
            if (kind === 'lore') return !!settings.scenarioBooks[String(itemKey)]?.active;
            if (kind === 'collection') return !!resolvedCollections[String(itemKey)]?.active;
            return resolveItemActive(itemKey, settings.itemStates, resolvedCollections);
        },
        resolveForced: (itemKey) => {
            // Only individual characters/locations carry a forced tri-state
            // override (spec S9) -- collections and lore/scenario items have
            // no forced concept, so they never show a "Pinned" badge.
            return classifyItemKey(itemKey, catalog) === 'item' ? (settings.itemStates[itemKey] ?? 'none') : 'none';
        },
        onActivate: (itemKey) => handleToggle(itemKey, true),
        onDeactivate: (itemKey) => handleToggle(itemKey, false),
        onRefreshCatalog: async () => {
            await refreshCatalog(settings);
            await syncBooks(settings);
            await initModal(settings);
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

jQuery(async () => {
    const context = getStContext();
    const settings = getSettings(context.extensionSettings);
    catalogCache = createCatalogCache(createIndexedDbStorageEngine());

    await addExtensionSettings(settings);
    injectToolbarButton(() => initModal(settings));

    if (!(await catalogCache.getCharacters())) {
        await refreshCatalog(settings);
    }
});
