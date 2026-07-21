// index.js
import { resolveExtensionBasePath } from './lib/location.js';
import { getSettings } from './lib/settings.js';
import { injectToolbarButton } from './lib/ui/toolbarButton.js';
import { openModal } from './lib/ui/modal.js';
import { createCatalogCache, createIndexedDbStorageEngine } from './lib/catalogCache.js';
import { fetchCharacterList, fetchLocationList, fetchCollectionList, toItemKey, buildSearchBlob } from './lib/registrarApi.js';
import { createEntrySandbox } from './lib/entrySandbox.js';
import { syncCharacterBook, syncLocationBook } from './lib/worldInfoWriter.js';
import { resolveItemActive } from './lib/activationState.js';
import { resolveCollectionMembers } from './lib/collectionResolver.js';
import { createLocalCollection, renameLocalCollection, updateLocalCollectionMembers, deleteLocalCollection } from './lib/localCollections.js';

const EXTENSION_BASE_PATH = resolveExtensionBasePath(import.meta.url);

let sandboxPromise = null;
let catalogCache = null;

function getStContext() {
    return SillyTavern.getContext();
}

/**
 * Memoizes the IN-FLIGHT creation promise, not just the resolved handle, so
 * concurrent callers (e.g. a bulk action touching several sandbox-backed
 * operations at once) await the same in-flight promise instead of each
 * starting their own -- N-1 duplicate `createEntrySandbox` calls would each
 * leak an orphaned `<iframe>` + permanent `message` listener
 * (entrySandbox.js). On failure the cached promise is cleared so the next
 * call retries instead of permanently caching a rejection.
 * @param {object} settings
 * @returns {Promise<{callFunction: (name: string, args: any[]) => Promise<any>, destroy: () => void}>}
 */
function ensureSandbox(settings) {
    if (!sandboxPromise) {
        sandboxPromise = createEntrySandbox(settings.apiBaseUrl).catch((error) => {
            sandboxPromise = null;
            throw error;
        });
    }
    return sandboxPromise;
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
    const [characters, locations, collections] = await Promise.all([
        fetchCharacterList(settings.apiBaseUrl),
        fetchLocationList(settings.apiBaseUrl),
        fetchCollectionList(settings.apiBaseUrl),
    ]);
    const taggedCharacters = characters.map(r => ({ ...r, itemKey: toItemKey(r, 'character'), searchBlob: buildSearchBlob(r, 'character') }));
    const taggedLocations = locations.map(r => ({ ...r, itemKey: toItemKey(r, 'location'), searchBlob: buildSearchBlob(r, 'location') }));

    await Promise.all([
        catalogCache.setCharacters(taggedCharacters),
        catalogCache.setLocations(taggedLocations),
        catalogCache.setCollections(collections),
        catalogCache.setLastRefreshed(Date.now()),
    ]);

    return { characters: taggedCharacters, locations: taggedLocations, collections };
}

/**
 * Reads the three catalog kinds in parallel (previously three sequential
 * awaits -- each IndexedDB round-trip stacking on the last measurably added
 * latency to every activate/deactivate, since this runs on every one of
 * them).
 * @returns {Promise<{characters: object[], locations: object[], collections: object[]}>}
 */
async function readCatalog() {
    const [characters, locations, collections] = await Promise.all([
        catalogCache.getCharacters(),
        catalogCache.getLocations(),
        catalogCache.getCollections(),
    ]);
    return { characters: characters ?? [], locations: locations ?? [], collections: collections ?? [] };
}

async function syncBooks(settings) {
    const catalog = await readCatalog();
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
 * itemList.js's click handler only ever passes item.itemKey back to
 * onActivate/onDeactivate/resolveActive/resolveForced -- it never passes the
 * tab/type the item came from (openModal's state interface is intentionally
 * generic over itemKey). So this extension has to recover "what kind of
 * thing is this" from the key's own shape:
 *  - "char:"/"loc:" prefix (lib/registrarApi.js's toItemKey) -> an individual
 *    character/location, resolved via the tri-state model in
 *    lib/activationState.js (spec S9): settings.itemStates[itemKey].
 *  - "local:" prefix (always, by construction -- see
 *    lib/localCollections.js's createLocalCollection) -> a local collection.
 *  - otherwise -> a Registrar collection id: settings.collections[id].active
 *    (spec S9's collection-level active flag, distinct from itemStates).
 * @param {string|number} itemKey
 * @returns {'item'|'collection'}
 */
function classifyItemKey(itemKey) {
    const key = String(itemKey);
    if (key.startsWith('char:') || key.startsWith('loc:')) return 'item';
    return 'collection';
}

async function initModal(settings) {
    const catalog = await readCatalog();
    // NOTE: no outer `resolvedCollections` snapshot here (fix #2, Task 8) --
    // resolveActive/getItemDetail below each compute buildResolvedCollections
    // fresh on every call instead, since modal.js calls them repeatedly
    // without re-invoking initModal. `catalog` itself stays a single
    // per-initModal-call snapshot; only the collections resolution derived
    // from it needed to stop being snapshotted.

    /**
     * Handles both onActivate and onDeactivate for every tab: branches by
     * classifyItemKey so a collection-type itemKey writes
     * settings.collections[id].active (spec S9) instead of itemStates. Does
     * NOT re-render the modal itself (Task 8 fix #1) -- lib/ui/modal.js's
     * renderCurrentTab/openDetail wrappers already re-render immediately
     * after calling onActivate/onDeactivate (fire-and-forget, no await -- see
     * modal.js's own JSDoc on openModal). Both branches below mutate
     * synchronously before this function's first `await`, so that immediate
     * re-render already sees the new state.
     * @param {string|number} itemKey
     * @param {boolean} makeActive
     */
    async function handleToggle(itemKey, makeActive) {
        const kind = classifyItemKey(itemKey);

        if (kind === 'collection') {
            const key = String(itemKey);
            const existing = settings.collections[key];
            settings.collections[key] = {
                active: makeActive,
                source: existing?.source ?? (settings.localCollections[key] ? 'local' : 'registrar'),
            };
        } else {
            settings.itemStates[itemKey] = makeActive ? 'active' : 'inactive';
        }
        await syncBooks(settings);

        getStContext().saveSettingsDebounced();
        // No re-render call here: lib/ui/modal.js's own renderCurrentTab/
        // openDetail wrappers already re-render immediately after this
        // function returns (see modal.js's own JSDoc on openModal for the
        // full rationale). Re-invoking initModal/openModal here would reset
        // the list/detail/form view back to 'list' on every toggle, fighting
        // that self-managed re-render -- this was a real bug in the
        // pre-redesign version of this function, found during Task 7's
        // review, fixed here.
    }

    /**
     * Batched version of handleToggle for the bulk-selection action bar.
     * Mutates every selected item/collection's state synchronously first,
     * then calls syncBooks exactly once -- looping handleToggle here instead
     * would call syncBooks once per selected item, needlessly rebuilding the
     * shared roster/location-list entries (and the single consolidated
     * Character Roster entry Weyland-WeyPhone depends on) N times instead of
     * once.
     * @param {Array<string>} itemKeys
     * @param {boolean} makeActive
     */
    async function handleBulkToggle(itemKeys, makeActive) {
        for (const itemKey of itemKeys) {
            const kind = classifyItemKey(itemKey);
            if (kind === 'collection') {
                const key = String(itemKey);
                const existing = settings.collections[key];
                settings.collections[key] = {
                    active: makeActive,
                    source: existing?.source ?? (settings.localCollections[key] ? 'local' : 'registrar'),
                };
            } else {
                settings.itemStates[itemKey] = makeActive ? 'active' : 'inactive';
            }
        }

        if (itemKeys.length) await syncBooks(settings);
        getStContext().saveSettingsDebounced();
    }

    /**
     * Resolves the full detail-pane payload for a single itemKey. Computes
     * its own fresh `resolvedCollections` snapshot on every call (same fix
     * as `resolveActive` below) so a collection's own toggle is reflected
     * immediately even though modal.js calls this repeatedly without
     * re-invoking initModal.
     * @param {string} itemKey
     * @returns {import('./lib/ui/detailPane.js').ItemDetail & {memberKeys?: string[]}}
     */
    function getItemDetail(itemKey) {
        const resolvedCollections = buildResolvedCollections(settings, catalog); // fresh every call -- see Step 4's note
        const routingKind = classifyItemKey(itemKey);

        if (routingKind === 'collection') {
            const key = String(itemKey);
            const isLocal = !!settings.localCollections[key];
            const record = isLocal
                ? { name: settings.localCollections[key].name }
                : (catalog.collections.find(c => String(c.collectionId) === key) ?? { name: key });
            // For a LOCAL collection, settings.collections[key] always exists (created
            // immediately by onCreateLocalCollection), so resolvedCollections[key] is reliable.
            // For a REGISTRAR-native collection, settings.collections[key] only exists once the
            // user has toggled it at least once -- buildResolvedCollections silently omits any
            // collection that's never been toggled, which would make a collection's Members field
            // show empty the very first time a user opens its detail (confirmed live against the
            // real "Josh's Squirrel Hole" collection on registrar.weybooru.com before this fix).
            // Bypass that gate here and resolve members directly from the record instead --
            // "what members would this collection have" is independent of whether it's currently
            // active.
            const memberKeys = isLocal
                ? (resolvedCollections[key]?.memberKeys ?? [])
                : resolveCollectionMembers(record, catalog);
            const allItems = [...catalog.characters, ...catalog.locations];
            const memberNames = memberKeys
                .map(k => allItems.find(i => i.itemKey === k)?.name)
                .filter(Boolean);
            return {
                itemKey, kind: isLocal ? 'local' : 'collection', record,
                isActive: !!resolvedCollections[key]?.active,
                forced: 'none',
                memberNames,
                memberKeys,
                isLocal,
            };
        }
        // routingKind === 'item' -- classifyItemKey deliberately doesn't
        // distinguish character vs. location (it only needs to for routing,
        // where both go through the same tri-state path); detailFields.js's
        // buildDetailFields DOES need that finer distinction, so derive it here
        // via the itemKey's own prefix rather than widening classifyItemKey's
        // job (found during Task 5/Task 7's review: passing classifyItemKey's
        // 'item' straight through as the detail kind would make
        // buildDetailFields silently return [] for every character and
        // location -- the curated-fields feature would never show anything).
        const detailKind = String(itemKey).startsWith('char:') ? 'character' : 'location';
        const allItems = [...catalog.characters, ...catalog.locations];
        const record = allItems.find(i => i.itemKey === itemKey) ?? {};
        return {
            itemKey, kind: detailKind, record,
            isActive: resolveItemActive(itemKey, settings.itemStates, resolvedCollections),
            forced: settings.itemStates[itemKey] ?? 'none',
        };
    }

    function getAvailableItemsForForm() {
        // kind lets the member-checklist UI offer a Character/Location category
        // filter; searchBlob (already computed per record in refreshCatalog) is
        // passed through so that checklist can reuse the exact same
        // field-syntax search (species:x owner:y) as the main browser, not a
        // separately-maintained lesser search.
        return [
            ...catalog.characters.map(r => ({ itemKey: r.itemKey, name: r.name, kind: 'character', searchBlob: r.searchBlob })),
            ...catalog.locations.map(r => ({ itemKey: r.itemKey, name: r.name, kind: 'location', searchBlob: r.searchBlob })),
        ];
    }

    function onCreateLocalCollection(name, memberKeys) {
        const id = createLocalCollection(settings, name, memberKeys);
        settings.collections[id] = { active: false, source: 'local' };
        getStContext().saveSettingsDebounced();
    }

    function onRenameLocalCollection(itemKey, name) {
        renameLocalCollection(settings, itemKey, name);
        getStContext().saveSettingsDebounced();
    }

    function onUpdateLocalCollectionMembers(itemKey, memberKeys) {
        updateLocalCollectionMembers(settings, itemKey, memberKeys);
        getStContext().saveSettingsDebounced();
    }

    async function onDeleteLocalCollection(itemKey) {
        const wasActive = !!settings.collections[itemKey]?.active;
        deleteLocalCollection(settings, itemKey);
        if (wasActive) await syncBooks(settings);
        getStContext().saveSettingsDebounced();
    }

    openModal({
        getItemsForType: (type) => {
            if (type === 'character') return catalog.characters;
            if (type === 'location') return catalog.locations;
            // Spread the raw record (not just itemKey/name/summary) so
            // createdAt/updatedAt/ownerName survive into the sortable item --
            // every fetched record kind carries these uniformly (see
            // lib/ui/sortItems.js's own doc comment), but a bare
            // {itemKey, name, summary} projection was silently dropping them,
            // making Sort by Created/Updated/Author a no-op on this tab
            // (findings review, Task 9 follow-up). itemKey is assigned last so
            // it always wins over any same-named field on the raw record.
            if (type === 'collection') return catalog.collections.map(c => ({ ...c, itemKey: c.collectionId }));
            if (type === 'local') return Object.entries(settings.localCollections).map(([id, c]) => ({ itemKey: id, name: c.name }));
            return [];
        },
        resolveActive: (itemKey) => {
            const resolvedCollections = buildResolvedCollections(settings, catalog); // fresh every call, not the outer initModal-scoped snapshot
            const kind = classifyItemKey(itemKey);
            if (kind === 'collection') return !!resolvedCollections[String(itemKey)]?.active;
            return resolveItemActive(itemKey, settings.itemStates, resolvedCollections);
        },
        resolveForced: (itemKey) => {
            // Only individual characters/locations carry a forced tri-state
            // override (spec S9) -- collections have no forced concept, so
            // they never show a "Pinned" badge.
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
        getItemDetail,
        getAvailableItemsForForm,
        onCreateLocalCollection,
        onRenameLocalCollection,
        onUpdateLocalCollectionMembers,
        onDeleteLocalCollection,
        onBulkActivate: (itemKeys) => handleBulkToggle(itemKeys, true),
        onBulkDeactivate: (itemKeys) => handleBulkToggle(itemKeys, false),
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
