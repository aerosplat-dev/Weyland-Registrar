// lib/ui/modal.js
import { renderItemList } from './itemList.js';
import { parseSearchTerms, matchesTerms } from '../filterQuery.js';
import { resolveExtensionBasePath } from '../location.js';

let modalElement = null;
let modalReadyPromise = null;
let currentState = null;

/**
 * Opens the browsing modal, wiring up its tab/search/close/refresh controls
 * against the given state. Safe to call repeatedly: the modal element is
 * built and wired only once (subsequent calls just re-show it and re-render
 * the current tab against the freshest `state`), and `currentState` is a
 * module-level binding rather than something captured once at build time, so
 * a second `openModal(newState)` call (e.g. after a catalog refresh) is
 * correctly picked up by controls (tab clicks, search) wired during the
 * first call rather than silently operating on stale data.
 *
 * On first call, if `#wreg-modal-overlay` (template.html's root element)
 * isn't already present in the document, this module fetches and injects
 * template.html itself via `renderExtensionTemplateAsync` -- mirroring
 * Weyland-Downloader's own boot-time `$.get(template.html)` +
 * `$('body').append(html)` pattern (confirmed by reading that extension's
 * index.js directly) -- rather than assuming some other module already put
 * it there. This keeps `openModal` self-sufficient regardless of what the
 * extension's boot sequence (Task 17) does or doesn't do.
 * @param {{
 *   getItemsForType: (type: string) => Array<{itemKey: string, name: string, summary?: string, searchBlob?: object}>,
 *   onActivate: (itemKey: string) => void,
 *   onDeactivate: (itemKey: string) => void,
 *   resolveActive: (itemKey: string) => boolean,
 *   resolveForced: (itemKey: string) => 'none'|'active'|'inactive',
 *   onRefreshCatalog: () => void,
 * }} state
 */
export function openModal(state) {
    currentState = state;
    ensureModalElement().then((overlay) => {
        overlay.style.display = 'flex';
        renderCurrentTab('character');
    });
}

/**
 * Resolves to the built/wired modal element, building it at most once even
 * if `openModal` is called again before the first build finishes (a single
 * in-flight promise is reused so overlapping calls never double-fetch or
 * double-append template.html).
 * @returns {Promise<HTMLElement>}
 */
function ensureModalElement() {
    if (modalElement) return Promise.resolve(modalElement);
    if (!modalReadyPromise) {
        modalReadyPromise = buildModalElement();
    }
    return modalReadyPromise;
}

async function buildModalElement() {
    let overlay = document.getElementById('wreg-modal-overlay');
    if (!overlay) {
        const context = SillyTavern.getContext();
        const basePath = resolveExtensionBasePath(import.meta.url);
        const html = await context.renderExtensionTemplateAsync(basePath, 'template');
        document.body.insertAdjacentHTML('beforeend', html);
        overlay = document.getElementById('wreg-modal-overlay');
        if (!overlay) {
            throw new Error('[Weyland-Registrar] template.html did not produce a #wreg-modal-overlay element.');
        }
    }

    overlay.querySelectorAll('.wreg-tab').forEach((tab) => {
        tab.addEventListener('click', () => renderCurrentTab(tab.dataset.type));
    });
    overlay.querySelector('#wreg-modal-close').addEventListener('click', () => {
        overlay.style.display = 'none';
    });
    overlay.querySelector('#wreg-refresh-catalog').addEventListener('click', () => currentState.onRefreshCatalog());
    overlay.querySelector('#wreg-search').addEventListener('input', (e) => {
        overlay.dataset.searchQuery = e.target.value;
        renderCurrentTab(overlay.dataset.currentType ?? 'character');
    });

    modalElement = overlay;
    return overlay;
}

function renderCurrentTab(type) {
    modalElement.dataset.currentType = type;
    const container = modalElement.querySelector('#wreg-item-list');
    const items = currentState.getItemsForType(type);
    const query = modalElement.dataset.searchQuery ?? '';
    const terms = parseSearchTerms(query);
    const filtered = terms.length && items.every((item) => item.searchBlob)
        ? items.filter((item) => matchesTerms(item.searchBlob, terms))
        : items;

    renderItemList(container, filtered, {
        onActivate: currentState.onActivate,
        onDeactivate: currentState.onDeactivate,
        resolveActive: currentState.resolveActive,
        resolveForced: currentState.resolveForced,
    });
}
