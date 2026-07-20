// lib/ui/modal.js
import { renderItemList } from './itemList.js';
import { renderDetailPane } from './detailPane.js';
import { renderCollectionForm } from './collectionForm.js';
import { parseSearchTerms, matchesTerms } from '../filterQuery.js';
import { resolveExtensionBasePath } from '../location.js';
import { clampPosition, isMobileLayout, attachDragHandle, attachViewportReclamp } from './dragResize.js';

let portalElement = null;
let modalReadyPromise = null;
let currentState = null;
let dragHandle = null;
let reclampHandle = null;

/**
 * @typedef {import('./detailPane.js').ItemDetail} ItemDetail
 */

/**
 * Opens the browsing modal. Safe to call repeatedly: the portal/modal
 * elements are built and wired only once; `currentState` is a module-level
 * binding (not captured once at build time) so a later `openModal(newState)`
 * call is picked up correctly by controls wired during the first call.
 *
 * Every call resets the internal view-state to 'list' (whichever tab was
 * last active is preserved -- only list/detail/form resets, matching the
 * "reopen always starts at list" behaviour) and re-wires drag/resize for
 * the layout current at open time (desktop vs. mobile can have changed
 * since the modal was last closed).
 *
 * IMPORTANT for the caller (index.js / Task 8) building `state`:
 * - `onActivate`/`onDeactivate`/`onCreateLocalCollection`/
 *   `onRenameLocalCollection`/`onUpdateLocalCollectionMembers`/
 *   `onDeleteLocalCollection` must NOT call `openModal()` again as their own
 *   refresh mechanism (the pre-redesign pattern). This module already
 *   re-renders the affected view itself after every one of these calls (see
 *   `renderCurrentTab`/`openDetail`/`openCollectionForm` below); a fresh
 *   `openModal()` call would additionally reset the list/detail/form
 *   view-state back to 'list', fighting that self-managed re-render.
 * - Because this module treats those handlers as synchronous/fire-and-forget
 *   (per their documented `=> void` signature, no returned Promise is
 *   awaited before re-rendering), `resolveActive`/`resolveForced`/
 *   `getItemDetail` must reflect the new state as soon as the handler
 *   *returns* -- not only after some later async step (e.g. a World Info
 *   sync) finishes. This module's own `renderCurrentTab`/`openDetail` calls
 *   `currentState.resolveActive(...)`/`getItemDetail(...)` again
 *   immediately after invoking `onActivate`/`onDeactivate`, with no await in
 *   between.
 * @param {{
 *   getItemsForType: (type: string) => Array<{itemKey: string, name: string, summary?: string, searchBlob?: object}>,
 *   onActivate: (itemKey: string) => void,
 *   onDeactivate: (itemKey: string) => void,
 *   resolveActive: (itemKey: string) => boolean,
 *   resolveForced: (itemKey: string) => 'none'|'active'|'inactive',
 *   onRefreshCatalog: () => void,
 *   getItemDetail: (itemKey: string) => ItemDetail & {memberKeys?: string[]},
 *   getAvailableItemsForForm: () => Array<{itemKey: string, name: string}>,
 *   onCreateLocalCollection: (name: string, memberKeys: string[]) => void,
 *   onRenameLocalCollection: (itemKey: string, name: string) => void,
 *   onUpdateLocalCollectionMembers: (itemKey: string, memberKeys: string[]) => void,
 *   onDeleteLocalCollection: (itemKey: string) => void,
 * }} state - `getItemDetail`'s return is `detailPane.js`'s own `ItemDetail`
 *   shape, PLUS one addition this module requires beyond that file's
 *   documented typedef: for collection/local kinds, a `memberKeys: string[]`
 *   (the raw itemKeys of current members, not just `memberNames`'s resolved
 *   display strings) so `openCollectionForm` below can pre-check the member
 *   checklist against `getAvailableItemsForForm()`'s own itemKeys. See this
 *   task's report for why `detailPane.js` itself is not modified to add this
 *   field to its typedef (it never reads `memberKeys`, so the addition is
 *   purely additive and lives on the producer side, `getItemDetail`).
 */
export function openModal(state) {
    currentState = state;
    ensureModalElement().then((window_) => {
        window_.style.display = 'flex';
        setView('list');
        renderCurrentTab(currentTabType());
        updateDragResizeForLayout(window_);
    });
}

function currentTabType() {
    const activeTab = document.querySelector('.wreg-tab.wreg-tab-active');
    return activeTab?.dataset.type ?? 'character';
}

/**
 * Resolves to the built/wired modal window element, building it at most once
 * even if `openModal` is called again before the first build finishes (a
 * single in-flight promise is reused so overlapping calls never double-fetch
 * or double-append template.html).
 * @returns {Promise<HTMLElement>}
 */
function ensureModalElement() {
    if (portalElement) return Promise.resolve(portalElement.querySelector('#wreg-modal-window'));
    if (!modalReadyPromise) {
        modalReadyPromise = buildModalElement();
    }
    return modalReadyPromise;
}

async function buildModalElement() {
    let portal = document.getElementById('wreg-portal');
    if (!portal) {
        const context = SillyTavern.getContext();
        const basePath = resolveExtensionBasePath(import.meta.url);
        const html = await context.renderExtensionTemplateAsync(basePath, 'template');
        // Mounted as a SIBLING of <body> (not a child) -- SillyTavern sets
        // body{position:fixed;overflow:hidden} and <html> carries a
        // transform, which breaks position:fixed descendants nested inside
        // body. See this plan's Global Constraints for the full rationale.
        document.body.insertAdjacentHTML('afterend', html);
        portal = document.getElementById('wreg-portal');
        if (!portal) {
            throw new Error('[Weyland-Registrar] template.html did not produce a #wreg-portal element.');
        }
    }

    const window_ = portal.querySelector('#wreg-modal-window');

    portal.querySelectorAll('.wreg-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            portal.querySelectorAll('.wreg-tab').forEach((t) => t.classList.remove('wreg-tab-active'));
            tab.classList.add('wreg-tab-active');
            portal.querySelector('#wreg-new-collection-btn').style.display = tab.dataset.type === 'local' ? '' : 'none';
            renderCurrentTab(tab.dataset.type);
        });
    });
    portal.querySelector('.wreg-tab').classList.add('wreg-tab-active');

    portal.querySelector('#wreg-modal-close').addEventListener('click', () => {
        window_.style.display = 'none';
    });
    portal.querySelector('#wreg-refresh-catalog').addEventListener('click', () => currentState.onRefreshCatalog());
    portal.querySelector('#wreg-search').addEventListener('input', (event) => {
        portal.dataset.searchQuery = event.target.value;
        renderCurrentTab(currentTabType());
    });
    portal.querySelector('#wreg-active-only').addEventListener('change', () => {
        renderCurrentTab(currentTabType());
    });
    portal.querySelector('#wreg-new-collection-btn').addEventListener('click', () => {
        openCollectionForm({ mode: 'create' });
    });
    portal.querySelector('#wreg-back-btn').addEventListener('click', () => {
        setView('list');
        // Re-render: the list can have gone stale while a detail/form view
        // was showing (e.g. the user activated/deactivated the item from
        // inside the detail pane -- see openDetail below), and on mobile
        // the list view was hidden entirely while detail/form was up, so
        // this is the only point where its DOM gets refreshed before the
        // user sees it again. Matches the same setView+renderCurrentTab
        // pairing already used below for the create/rename/edit-members
        // form submit and for onDeleteLocalCollection.
        renderCurrentTab(currentTabType());
    });

    portalElement = portal;
    return window_;
}

function setView(view) {
    const body = portalElement.querySelector('#wreg-body');
    body.dataset.view = view;
    portalElement.querySelector('#wreg-back-btn').style.display = view === 'list' ? 'none' : '';
}

/**
 * Tears down whichever drag/reclamp handles are currently attached and
 * (desktop only) re-attaches them fresh, re-clamping the window's current
 * position/size against the CURRENT viewport first. That re-clamp mirrors
 * Weyland-Router's own `clampRouterModalToViewport()` call inside its
 * `openModal()` (confirmed from its source, `index.js` ~line 1586) -- it
 * catches the case where the browser viewport shrank while the modal was
 * closed (no 'resize' event ever reached `attachViewportReclamp`'s listener,
 * since it wasn't attached while hidden), which would otherwise leave the
 * window positioned partly or fully off-screen on reopen.
 * Entirely skipped on mobile: no drag listener, no reclamp listener, and the
 * position is left alone (mobile's CSS pins the window fullscreen via its
 * own media query regardless of any inline left/top -- see this task's
 * report for a related style.css gap flagged, not fixed, here).
 * @param {HTMLElement} window_
 */
function updateDragResizeForLayout(window_) {
    dragHandle?.destroy();
    reclampHandle?.destroy();
    dragHandle = null;
    reclampHandle = null;
    if (!isMobileLayout()) {
        const rect = window_.getBoundingClientRect();
        const { left, top } = clampPosition(rect.left, rect.top, rect.width, rect.height, window.innerWidth, window.innerHeight);
        window_.style.left = `${left}px`;
        window_.style.top = `${top}px`;

        const titlebar = portalElement.querySelector('#wreg-titlebar');
        dragHandle = attachDragHandle(titlebar, window_);
        reclampHandle = attachViewportReclamp(window_);
    }
}

function renderCurrentTab(type) {
    const container = portalElement.querySelector('#wreg-item-list');
    const items = currentState.getItemsForType(type);
    const query = portalElement.dataset.searchQuery ?? '';
    const terms = parseSearchTerms(query);
    let filtered = terms.length && items.every((item) => item.searchBlob)
        ? items.filter((item) => matchesTerms(item.searchBlob, terms))
        : items;

    const activeOnly = portalElement.querySelector('#wreg-active-only').checked;
    if (activeOnly) {
        filtered = filtered.filter((item) => currentState.resolveActive(item.itemKey));
    }

    renderItemList(container, filtered, {
        // Wrapped (rather than passing currentState.onActivate/onDeactivate
        // directly) so toggling a row re-renders the list immediately
        // afterward -- without this, a row's own `.wreg-item-row-active`
        // class and (with "Active only" on) its very presence in the list
        // would go stale until some unrelated action (a tab click, a search
        // keystroke) forced a fresh render. This mirrors a bug this exact
        // extension already hit and fixed once before the redesign (see the
        // pre-redesign index.js's own `handleToggle` comment: "Fix #2:
        // re-renders the modal afterward so the toggled card's state is
        // visible immediately, per Task 16's own review concern that
        // openModal has no built-in auto-refresh-after-toggle") -- this
        // module now owns that refresh itself instead of requiring every
        // caller to re-invoke openModal.
        onActivate: (itemKey) => { currentState.onActivate(itemKey); renderCurrentTab(currentTabType()); },
        onDeactivate: (itemKey) => { currentState.onDeactivate(itemKey); renderCurrentTab(currentTabType()); },
        onOpenDetail: (itemKey) => openDetail(itemKey),
        resolveActive: currentState.resolveActive,
        resolveForced: currentState.resolveForced,
    });
}

function openDetail(itemKey) {
    const detail = currentState.getItemDetail(itemKey);
    const container = portalElement.querySelector('#wreg-detail-view');
    renderDetailPane(container, detail, {
        // Same self-refresh reasoning as renderCurrentTab's onActivate/
        // onDeactivate above, applied on both sides: the detail pane
        // re-renders itself (so its own Activate/Deactivate button label
        // stays correct) AND the list underneath re-renders (so a desktop
        // split-view doesn't show the list and detail pane disagreeing with
        // each other while the detail pane stays open).
        onActivate: (key) => { currentState.onActivate(key); openDetail(key); renderCurrentTab(currentTabType()); },
        onDeactivate: (key) => { currentState.onDeactivate(key); openDetail(key); renderCurrentTab(currentTabType()); },
        onRenameLocalCollection: (key) => openCollectionForm({ mode: 'rename', existingId: key }),
        onEditLocalCollectionMembers: (key) => openCollectionForm({ mode: 'members', existingId: key }),
        onDeleteLocalCollection: (key) => {
            currentState.onDeleteLocalCollection(key);
            setView('list');
            renderCurrentTab(currentTabType());
        },
    });
    setView('detail');
}

function openCollectionForm({ mode, existingId }) {
    const container = portalElement.querySelector('#wreg-form-view');
    const availableItems = currentState.getAvailableItemsForForm();
    let initialName = '';
    let initialMemberKeys = [];
    if (existingId) {
        const existing = currentState.getItemDetail(existingId);
        initialName = existing.record.name;
        initialMemberKeys = existing.memberKeys ?? [];
    }

    renderCollectionForm(container, { mode, existingId, initialName, initialMemberKeys, availableItems }, {
        onSubmit: (result) => {
            if (mode === 'create') {
                currentState.onCreateLocalCollection(result.name, result.memberKeys ?? []);
            } else if (mode === 'rename') {
                currentState.onRenameLocalCollection(existingId, result.name);
            } else if (mode === 'members') {
                currentState.onUpdateLocalCollectionMembers(existingId, result.memberKeys ?? []);
            }
            setView('list');
            renderCurrentTab(currentTabType());
        },
        onCancel: () => setView('list'),
    });
    setView('form');
}
