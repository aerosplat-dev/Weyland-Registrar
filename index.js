// index.js
import { resolveExtensionBasePath } from './lib/location.js';
import { getSettings } from './lib/settings.js';
import { injectToolbarButton } from './lib/ui/toolbarButton.js';
import { openModal, showModalLoading, showModalError } from './lib/ui/modal.js';
import { createCatalogCache, createIndexedDbStorageEngine } from './lib/catalogCache.js';
import { fetchCharacterList, fetchLocationList, fetchCollectionList, toItemKey, buildSearchBlob } from './lib/registrarApi.js';
import { createEntrySandbox } from './lib/entrySandbox.js';
import { syncCharacterBook, syncLocationBook, CHARACTER_BOOK_NAME, LOCATION_BOOK_NAME } from './lib/worldInfoWriter.js';
import { MARKER_UID } from './lib/uidScheme.js';
import { resolveItemActive, resolveActiveCollectionNames } from './lib/activationState.js';
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
            result[id] = {
                active: !!collectionState.active,
                memberKeys: settings.localCollections[id].memberKeys,
                name: settings.localCollections[id].name,
            };
        } else {
            const record = (catalog.collections ?? []).find(c => String(c.collectionId) === id);
            result[id] = {
                active: !!collectionState.active,
                memberKeys: record ? resolveCollectionMembers(record, catalog) : [],
                name: record?.name ?? 'Unknown collection',
            };
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

/**
 * Common setup shared by every path that writes to the WI books: the
 * current catalog, settings with collections resolved to concrete
 * memberKeys, the entry-building sandbox, and SillyTavern's own context.
 * @param {object} settings
 * @returns {Promise<{catalog: object, settingsForSync: object, sandbox: {callFunction: Function}, stContext: object}>}
 */
async function prepareSync(settings) {
    const catalog = await readCatalog();
    const resolvedCollections = buildResolvedCollections(settings, catalog);
    const settingsForSync = { ...settings, collections: resolvedCollections };
    const sandbox = await ensureSandbox(settings);
    const stContext = getStContext();
    return { catalog, settingsForSync, sandbox, stContext };
}

// Surfaced so a user isn't left wondering where their pre-existing content
// went -- ensureBookOwnership (bookOwnership.js) only backs up when a
// same-named book had real content but no Weyland-Registrar marker, i.e.
// this fires at most once per book (the rebuilt book carries the marker
// from here on, so every later sync is a no-op here).
function notifyIfBackedUp(backupName) {
    if (backupName) {
        toastr.info(`Found existing content in a Registrar-managed lorebook without our marker, so it was backed up as "${backupName}" before being replaced.`, 'Weyland Registrar');
    }
}

/**
 * Writes BOTH books fully from the current settings, clearing pending-change
 * state for both -- used only by refreshCatalogAndSync (Refresh Catalog/
 * Retry), which always applies immediately regardless of the staged-changes
 * model below: it already regenerates from current settings, so deferring it
 * further would add no benefit, only a second, redundant "did this apply?"
 * question. Toggles/bulk actions/local-collection edits do NOT call this --
 * see handleToggle's own doc for why immediate syncing was removed.
 * @param {object} settings
 * @returns {Promise<void>}
 */
async function syncBooks(settings) {
    const { catalog, settingsForSync, sandbox, stContext } = await prepareSync(settings);
    const charactersByKey = Object.fromEntries(catalog.characters.map(r => [r.itemKey, r]));
    const locationsByKey = Object.fromEntries(catalog.locations.map(r => [r.itemKey, r]));

    const [characterBookBackup, locationBookBackup] = await Promise.all([
        syncCharacterBook(stContext, sandbox.callFunction, settingsForSync, charactersByKey),
        syncLocationBook(stContext, sandbox.callFunction, settingsForSync, locationsByKey),
    ]);

    settings.pendingChanges.character = false;
    settings.pendingChanges.location = false;
    getStContext().saveSettingsDebounced();

    notifyIfBackedUp(characterBookBackup);
    notifyIfBackedUp(locationBookBackup);
}

/**
 * The "Rebuild Lorebook"/"Apply Changes" button's action: fully regenerates
 * ONE book -- never both, unlike syncBooks -- from the currently cached
 * catalog (no network refetch), and clears that book's pending-changes flag.
 * Since syncCharacterBook/syncLocationBook never partially patch a book
 * (every sync fully regenerates `entries` from the live active set, see
 * worldInfoWriter.js's own doc), this single function correctly serves both
 * framings the button can show: with no pending changes, it's a from-scratch
 * "Rebuild Lorebook" (a parity-check tool, output identical to what's
 * already there); with pending changes, it's "Apply Changes" (the first
 * point since those toggles where the real book actually reflects them) --
 * the toast wording below is the only thing that varies between the two.
 * @param {object} settings
 * @param {'character'|'location'} bookType
 * @returns {Promise<void>}
 */
async function rebuildLorebook(settings, bookType) {
    const wasApplyingPendingChanges = !!settings.pendingChanges[bookType];
    const { catalog, settingsForSync, sandbox, stContext } = await prepareSync(settings);
    const backupName = bookType === 'character'
        ? await syncCharacterBook(stContext, sandbox.callFunction, settingsForSync, Object.fromEntries(catalog.characters.map(r => [r.itemKey, r])))
        : await syncLocationBook(stContext, sandbox.callFunction, settingsForSync, Object.fromEntries(catalog.locations.map(r => [r.itemKey, r])));

    settings.pendingChanges[bookType] = false;
    getStContext().saveSettingsDebounced();

    notifyIfBackedUp(backupName);
    if (!backupName) {
        const noun = bookType === 'character' ? 'Character' : 'Location';
        toastr.success(wasApplyingPendingChanges ? `${noun} changes applied.` : `${noun} lorebook rebuilt.`, 'Weyland Registrar');
    }
}

/**
 * Live entry count in the real WI book for parity-checking against what
 * the browsing list shows as active -- deliberately excludes the internal
 * ownership marker (uid MARKER_UID, bookOwnership.js), which is never
 * user-facing content.
 * @param {'character'|'location'} bookType
 * @returns {Promise<number>}
 */
async function getLorebookEntryCount(bookType) {
    const bookName = bookType === 'character' ? CHARACTER_BOOK_NAME : LOCATION_BOOK_NAME;
    const book = await getStContext().loadWorldInfo(bookName);
    return Object.keys(book?.entries ?? {}).filter(uid => Number(uid) !== MARKER_UID).length;
}

/**
 * Forces a fresh catalog fetch (bypassing the staleness check
 * ensureCatalogFresh applies) and syncs the WI books from it, always
 * returning to a real modal view afterward. Shared by the manual "Refresh
 * Catalog" button AND the error view's Retry button -- both express the
 * same intent ("try that failed/stale fetch again"). Retry previously
 * pointed at `initModal` instead, which only re-runs the lighter
 * emptiness/staleness gate (`ensureCatalogFresh`) and never calls
 * `syncBooks` -- so a successful Retry would repopulate the browsing list
 * but silently leave the actual World Info books (which other systems,
 * e.g. Weyland-WeyPhone's Character Roster entry, depend on) unsynced.
 * Routing both actions through this one function closes that gap.
 * @param {object} settings
 * @returns {Promise<void>}
 */
async function refreshCatalogAndSync(settings) {
    // Show the loading state immediately -- a manual refresh can take
    // several seconds on a real connection (confirmed live: ~9s under
    // simulated latency, mostly the loci/coll CORS-fallback double-hop),
    // and the list previously stayed showing stale/old data with zero
    // indication a refresh was even happening.
    await showModalLoading();
    let catalogFetchFailed = false;
    try {
        await refreshCatalog(settings);
    } catch (error) {
        console.error('[Weyland-Registrar] Catalog refresh failed:', error);
        catalogFetchFailed = true;
    }
    if (catalogFetchFailed) {
        if (!(await catalogCache.getCharacters())) {
            // Nothing to fall back on -- show a real error state rather
            // than a silently-empty list. Retry re-invokes this exact same
            // function, so it behaves identically to clicking Refresh
            // Catalog again, not a narrower re-check.
            await showModalError(
                "Couldn't reach the Registrar. Check your connection and try again.",
                () => refreshCatalogAndSync(settings),
            );
            return;
        }
        // Some (stale) data is still cached and worth showing -- a toast is
        // enough here, no need for a hard error takeover.
        toastr.error('Failed to refresh the Registrar catalog. Showing previously cached data.', 'Weyland Registrar');
    } else {
        // Catalog fetch succeeded -- syncBooks (rebuilding the WI books) is
        // a separate concern from what the browsing list shows, so its own
        // failure doesn't block reopening the list.
        try {
            await syncBooks(settings);
        } catch (error) {
            console.error('[Weyland-Registrar] syncBooks failed after a successful catalog refresh:', error);
            toastr.error('Catalog refreshed, but writing the World Info books failed. Try refreshing again.', 'Weyland Registrar');
        }
    }
    // Always return to a real view -- otherwise a failure here would leave
    // the user stuck staring at the loading spinner forever, which is worse
    // than falling back to whatever (possibly stale) data is still cached.
    await initModal(settings);
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
 *    character/location, resolved via the forced-active-pin model in
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

/**
 * Which book an individual character/location itemKey's own activation
 * state affects. Only meaningful for `classifyItemKey(itemKey) === 'item'`
 * keys -- a collection-kind key can span both books at once (a Registrar or
 * local collection isn't restricted to one item type), so mutation sites
 * touching a collection mark both books dirty directly instead of calling
 * this.
 * @param {string|number} itemKey
 * @returns {'character'|'location'}
 */
function bookTypeForItemKey(itemKey) {
    return String(itemKey).startsWith('char:') ? 'character' : 'location';
}

async function initModal(settings) {
    // Never assume the catalog is already populated by the time the modal
    // opens -- boot's own background population (see ensureCatalogFresh)
    // races the toolbar button becoming clickable, and a fast/eager click
    // can land here before that fetch finishes. Show a real loading state
    // and wait for it (sharing the same in-flight attempt as boot's own
    // call, not firing a duplicate) rather than rendering whatever happens
    // to already be cached, which was empty in the confirmed-live repro.
    if (!(await catalogCache.getCharacters()) || await isCatalogStale(settings)) {
        await showModalLoading();
        try {
            await ensureCatalogFresh(settings);
        } catch (error) {
            console.error('[Weyland-Registrar] Failed to populate catalog before opening modal:', error);
            // If there's truly nothing cached to fall back on, show a real
            // error state instead of silently rendering an empty list --
            // confirmed live that a fetch failure with no cached data looks
            // EXACTLY like "nothing to show" to a real user otherwise (no
            // error text anywhere in the DOM, console.error invisible
            // without devtools open). If some (stale) data IS already
            // cached, fall through and show that instead -- still useful,
            // no need for a hard error state.
            if (!(await catalogCache.getCharacters())) {
                // Retry goes through the same forced-fetch-plus-syncBooks
                // path as the manual Refresh Catalog button, not a plain
                // re-invocation of initModal -- see refreshCatalogAndSync's
                // own doc comment for why that distinction matters.
                await showModalError(
                    "Couldn't reach the Registrar. Check your connection and try again.",
                    () => refreshCatalogAndSync(settings),
                );
                return;
            }
        }
    }

    const catalog = await readCatalog();

    // Memoized per initModal call, invalidated on every settings mutation
    // below. Task 8 deliberately avoided a single fixed snapshot here
    // because a collection's own toggle needs to show up on the very next
    // call without re-invoking initModal -- but always recomputing fresh
    // went too far the other way: buildResolvedCollections does a full
    // O(active collections x catalog size) filter-scan, and it was being
    // called twice per rendered row (resolveActive + resolveActiveCollections
    // in itemList.js's render loop) plus once more per item in
    // updateStatsBar's active-count filter -- ~900+ fresh recomputations for
    // the Characters tab's 454 rows, measured at ~6.4s of main-thread
    // blocking on every tab switch (profile-tab-switch.mjs/
    // profile-breakdown.mjs). The expensive part -- resolveCollectionMembers'
    // filter scan -- only depends on each collection's filter string and the
    // catalog, both fixed for this initModal call's lifetime; only the
    // `.active` flag and local-collection membership/name actually change on
    // a mutation. So invalidate-then-lazily-recompute keeps Task 8's
    // freshness guarantee (a single recompute costs ~5.6ms on the real
    // catalog) while eliminating the O(rows) blowup.
    let resolvedCollectionsCache = null;
    function getResolvedCollections() {
        if (!resolvedCollectionsCache) resolvedCollectionsCache = buildResolvedCollections(settings, catalog);
        return resolvedCollectionsCache;
    }
    function invalidateResolvedCollections() {
        resolvedCollectionsCache = null;
    }

    /**
     * Marks a book as having activation-state changes that aren't reflected
     * in its real World Info entries yet -- set at exactly the same
     * mutation sites as `invalidateResolvedCollections()` above, since both
     * exist for the same reason (a settings write that changes what's
     * active). Cleared by `syncBooks`/`rebuildLorebook` once that book is
     * actually written. Persisted (not just in-memory) so the "Apply
     * Changes" indicator survives a reload.
     * @param {'character'|'location'} bookType
     */
    function markDirty(bookType) {
        settings.pendingChanges[bookType] = true;
    }

    /**
     * Handles both onActivate and onDeactivate for every tab: branches by
     * classifyItemKey so a collection-type itemKey writes
     * settings.collections[id].active (spec S9) instead of itemStates.
     *
     * Deliberately does NOT sync the real World Info book -- activation
     * state only marks the affected book(s) dirty (staged-changes model);
     * writing the book is deferred until the user clicks "Apply Changes"
     * (rebuildLorebook, wired to the same button as the always-available
     * "Rebuild Lorebook" action) or Refresh Catalog. This also closes a real
     * bug the prior sync-on-every-toggle version had: syncing immediately
     * but not awaiting it before the stats bar re-read the real book's entry
     * count raced the (slow, sequential per-character) sync, showing a
     * stale entry count paired with the already-updated active count --
     * confirmed live (toggling one more character showed "81 active
     * characters · 396 lorebook entries" for a full second before the real
     * write landed at 400). Staging removes the race entirely: nothing
     * re-reads the real book until an explicit Apply, at which point this
     * function's mutation has long since settled.
     *
     * Does NOT re-render the modal itself (Task 8 fix #1) -- lib/ui/modal.js's
     * renderCurrentTab/openDetail wrappers already re-render immediately
     * after calling onActivate/onDeactivate. Both branches below mutate
     * synchronously, so that immediate re-render already sees the new state.
     * @param {string|number} itemKey
     * @param {boolean} makeActive
     */
    function handleToggle(itemKey, makeActive) {
        const kind = classifyItemKey(itemKey);

        if (kind === 'collection') {
            const key = String(itemKey);
            const existing = settings.collections[key];
            settings.collections[key] = {
                active: makeActive,
                source: existing?.source ?? (settings.localCollections[key] ? 'local' : 'registrar'),
            };
            // A collection isn't restricted to one item type -- mark both
            // books dirty rather than inspecting its member composition.
            markDirty('character');
            markDirty('location');
        } else if (makeActive) {
            settings.itemStates[itemKey] = 'active';
            markDirty(bookTypeForItemKey(itemKey));
        } else {
            // No forced-inactive pin exists anymore (see activationState.js)
            // -- deactivating just clears any forced-active pin. If a
            // collection still covers this item, it stays active; the only
            // way to turn it off is to deactivate that collection.
            delete settings.itemStates[itemKey];
            markDirty(bookTypeForItemKey(itemKey));
        }
        invalidateResolvedCollections();
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
     * Same staged-changes behavior as handleToggle -- mutates every selected
     * item/collection's state and marks the affected book(s) dirty, without
     * syncing.
     * @param {Array<string>} itemKeys
     * @param {boolean} makeActive
     */
    function handleBulkToggle(itemKeys, makeActive) {
        for (const itemKey of itemKeys) {
            const kind = classifyItemKey(itemKey);
            if (kind === 'collection') {
                const key = String(itemKey);
                const existing = settings.collections[key];
                settings.collections[key] = {
                    active: makeActive,
                    source: existing?.source ?? (settings.localCollections[key] ? 'local' : 'registrar'),
                };
                markDirty('character');
                markDirty('location');
            } else if (makeActive) {
                settings.itemStates[itemKey] = 'active';
                markDirty(bookTypeForItemKey(itemKey));
            } else {
                delete settings.itemStates[itemKey];
                markDirty(bookTypeForItemKey(itemKey));
            }
        }

        if (itemKeys.length) {
            invalidateResolvedCollections();
        }
        getStContext().saveSettingsDebounced();
    }

    /**
     * Resolves the full detail-pane payload for a single itemKey. Reads the
     * memoized `getResolvedCollections()` (same cache as `resolveActive`
     * below), which stays fresh across a collection's own toggle because
     * every mutation site calls `invalidateResolvedCollections()`.
     * @param {string} itemKey
     * @returns {import('./lib/ui/detailPane.js').ItemDetail & {memberKeys?: string[]}}
     */
    function getItemDetail(itemKey) {
        const resolvedCollections = getResolvedCollections();
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
                activeCollectionNames: [], // a collection can't itself be "a member of" another collection
                memberNames,
                memberKeys,
                isLocal,
            };
        }
        // routingKind === 'item' -- classifyItemKey deliberately doesn't
        // distinguish character vs. location (it only needs to for routing,
        // where both go through the same forced-active-pin path); detailFields.js's
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
            activeCollectionNames: resolveActiveCollectionNames(itemKey, resolvedCollections),
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
        invalidateResolvedCollections();
        getStContext().saveSettingsDebounced();
    }

    function onRenameLocalCollection(itemKey, name) {
        renameLocalCollection(settings, itemKey, name);
        invalidateResolvedCollections();
        getStContext().saveSettingsDebounced();
    }

    function onUpdateLocalCollectionMembers(itemKey, memberKeys) {
        // Membership only affects a book if this collection is currently
        // active -- editing an inactive local set's members has no live
        // effect, so it doesn't need to (and shouldn't) light up the Apply
        // Changes button.
        const isActive = !!settings.collections[itemKey]?.active;
        updateLocalCollectionMembers(settings, itemKey, memberKeys);
        invalidateResolvedCollections();
        if (isActive) {
            markDirty('character');
            markDirty('location');
        }
        getStContext().saveSettingsDebounced();
    }

    function onDeleteLocalCollection(itemKey) {
        const wasActive = !!settings.collections[itemKey]?.active;
        deleteLocalCollection(settings, itemKey);
        invalidateResolvedCollections();
        if (wasActive) {
            markDirty('character');
            markDirty('location');
        }
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
            const resolvedCollections = getResolvedCollections();
            const kind = classifyItemKey(itemKey);
            if (kind === 'collection') return !!resolvedCollections[String(itemKey)]?.active;
            return resolveItemActive(itemKey, settings.itemStates, resolvedCollections);
        },
        resolveForced: (itemKey) => {
            // Only individual characters/locations carry a forced-active pin
            // (spec S9) -- collections have no forced concept, so they never
            // show a "Pinned" badge.
            return classifyItemKey(itemKey) === 'item' ? (settings.itemStates[itemKey] ?? 'none') : 'none';
        },
        resolveActiveCollections: (itemKey) => {
            // Same item-only gating as resolveForced above -- a collection
            // can't itself be "a member of" another collection.
            if (classifyItemKey(itemKey) !== 'item') return [];
            return resolveActiveCollectionNames(itemKey, getResolvedCollections());
        },
        onActivate: (itemKey) => handleToggle(itemKey, true),
        onDeactivate: (itemKey) => handleToggle(itemKey, false),
        onRefreshCatalog: () => refreshCatalogAndSync(settings),
        getItemDetail,
        getAvailableItemsForForm,
        onCreateLocalCollection,
        onRenameLocalCollection,
        onUpdateLocalCollectionMembers,
        onDeleteLocalCollection,
        onBulkActivate: (itemKeys) => handleBulkToggle(itemKeys, true),
        onBulkDeactivate: (itemKeys) => handleBulkToggle(itemKeys, false),
        onRebuildLorebook: (bookType) => rebuildLorebook(settings, bookType),
        getLorebookEntryCount: (bookType) => getLorebookEntryCount(bookType),
        isDirty: (bookType) => !!settings.pendingChanges[bookType],
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

let catalogReadyPromise = null;

/**
 * Ensures the catalog is populated (empty cache) or fresh (stale per
 * settings.refreshIntervalMinutes) before returning, memoizing the
 * IN-FLIGHT attempt so concurrent callers share one fetch instead of firing
 * duplicates -- specifically closes the race between boot's own background
 * population and a user clicking the toolbar button before that finishes.
 * Confirmed live (2s artificial latency per Registrar request, simulating a
 * real remote user): without this, the modal opened showing zero items in
 * every tab and never recovered even after boot's background fetch
 * eventually succeeded, since nothing re-rendered the already-open modal
 * from an unrelated resolving promise.
 *
 * Unlike `ensureSandbox`'s memoization (kept only for the extension's whole
 * lifetime, cleared solely on failure), this clears itself once settled
 * EITHER way via `finally` -- it exists only to dedupe concurrent in-flight
 * callers during one population attempt, not to permanently skip staleness
 * checks for the rest of the session; a call made after the previous one
 * has already settled always re-checks staleness fresh.
 * @param {object} settings
 * @returns {Promise<void>}
 */
function ensureCatalogFresh(settings) {
    if (!catalogReadyPromise) {
        catalogReadyPromise = (async () => {
            if (!(await catalogCache.getCharacters()) || await isCatalogStale(settings)) {
                await refreshCatalog(settings);
            }
        })().finally(() => {
            catalogReadyPromise = null;
        });
    }
    return catalogReadyPromise;
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
        await ensureCatalogFresh(settings);
    } catch (error) {
        // A Registrar-unreachable first boot shouldn't leave an unhandled
        // rejection behind (jQuery() calls this callback fire-and-forget,
        // it never awaits/catches it) -- the toolbar button and modal
        // remain usable either way, and the modal's own "Refresh Catalog"
        // button (below) can retry once the Registrar is reachable again.
        console.error('[Weyland-Registrar] Initial catalog refresh failed:', error);
    }
});
