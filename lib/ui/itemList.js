// lib/ui/itemList.js

/**
 * Renders a list of catalog items as a single-column, vertically scrollable
 * list of rows (never a grid, at any width) with a bulk-select checkbox, an
 * activate/deactivate toggle, and a click-to-open-detail interaction on the
 * row itself.
 * @param {HTMLElement} container
 * @param {Array<{itemKey: string, name: string, summary?: string}>} items
 * @param {{
 *   onActivate: (itemKey: string) => void,
 *   onDeactivate: (itemKey: string) => void,
 *   onOpenDetail: (itemKey: string) => void,
 *   onToggleSelect: (itemKey: string) => void,
 *   resolveActive: (itemKey: string) => boolean,
 *   resolveForced: (itemKey: string) => 'none'|'active',
 *   resolveActiveCollections: (itemKey: string) => string[],
 *   isSelected: (itemKey: string) => boolean,
 * }} handlers
 */
export function renderItemList(container, items, handlers) {
    container.innerHTML = '';
    for (const item of items) {
        const isActive = handlers.resolveActive(item.itemKey);
        const forced = handlers.resolveForced(item.itemKey);

        const row = document.createElement('div');
        row.className = 'wreg-item-row' + (isActive ? ' wreg-item-row-active' : '');
        row.dataset.itemKey = item.itemKey;
        row.tabIndex = 0;
        row.setAttribute('role', 'button');

        const selectInput = document.createElement('input');
        selectInput.type = 'checkbox';
        selectInput.className = 'wreg-row-select';
        selectInput.checked = handlers.isSelected(item.itemKey);
        selectInput.setAttribute('aria-label', `Select ${item.name} for bulk action`);
        // Same isolation pattern as the activate toggle below: without this, a
        // click or Enter/Space here would also bubble to the row's own
        // click-opens-detail listener.
        selectInput.addEventListener('click', (event) => {
            event.stopPropagation();
        });
        selectInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.stopPropagation();
            }
        });
        selectInput.addEventListener('change', () => {
            handlers.onToggleSelect(item.itemKey);
        });
        row.appendChild(selectInput);

        const main = document.createElement('div');
        main.className = 'wreg-item-row-main';

        const title = document.createElement('div');
        title.className = 'wreg-item-title';
        title.textContent = item.name;
        main.appendChild(title);

        if (item.summary) {
            const summary = document.createElement('div');
            summary.className = 'wreg-item-summary';
            summary.textContent = item.summary;
            main.appendChild(summary);
        }
        row.appendChild(main);

        // "From <Collection>" tags -- explain why an unpinned item is active,
        // and that deactivating it individually won't work (the collection
        // itself has to be turned off, or the item pinned).
        for (const name of handlers.resolveActiveCollections(item.itemKey)) {
            const collectionBadge = document.createElement('span');
            collectionBadge.className = 'wreg-collection-badge';
            collectionBadge.textContent = name;
            collectionBadge.title = `Active because of the "${name}" collection`;
            row.appendChild(collectionBadge);
        }

        // Pin button: independent of the activate/deactivate toggle below,
        // so an item that's already active via a collection can still be
        // pinned (protecting it from that collection later deactivating).
        // Reuses the same onActivate/onDeactivate handlers the toggle uses --
        // pinning is exactly "force itemStates[itemKey] to 'active'",
        // unpinning is exactly "clear it" -- just keyed off `forced` here
        // instead of `isActive`.
        const pinButton = document.createElement('button');
        pinButton.type = 'button';
        pinButton.className = 'wreg-pin-btn' + (forced === 'active' ? ' wreg-pin-btn-active' : '');
        pinButton.textContent = '📌';
        pinButton.title = forced === 'active'
            ? 'Pinned -- stays active even if a collection deactivates. Click to unpin.'
            : 'Pin -- keep this active even if a collection deactivates.';
        pinButton.setAttribute('aria-label', pinButton.title);
        pinButton.addEventListener('click', (event) => {
            event.stopPropagation();
            if (forced === 'active') handlers.onDeactivate(item.itemKey);
            else handlers.onActivate(item.itemKey);
        });
        pinButton.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.stopPropagation();
            }
        });
        row.appendChild(pinButton);

        const toggleLabel = document.createElement('label');
        toggleLabel.className = 'wreg-toggle-label wreg-row-toggle';
        const toggleInput = document.createElement('input');
        toggleInput.type = 'checkbox';
        toggleInput.checked = isActive;
        toggleLabel.appendChild(toggleInput);
        const track = document.createElement('span');
        track.className = 'wreg-toggle-track';
        track.innerHTML = '<span class="wreg-toggle-thumb"></span>';
        toggleLabel.appendChild(track);
        // Isolate the toggle from the row's own click-to-open-detail listener
        // on both input modalities:
        // - A mouse click anywhere on the label bubbles from the clicked
        //   child (e.g. the track), and the browser's label-activation
        //   default action also fires a second, synthetic click targeted at
        //   the checkbox itself -- both bubble through this label and must
        //   be stopped here before they reach the row.
        // - A keydown (Space toggles a focused checkbox) bubbles the same
        //   way. Without stopping it here too, the row's own keydown handler
        //   below would also see it, call preventDefault() (which would
        //   suppress the checkbox's native keyboard toggle), and incorrectly
        //   open the detail view as well -- verified empirically with a
        //   jsdom repro before adding this guard.
        toggleLabel.addEventListener('click', (event) => {
            event.stopPropagation();
        });
        toggleLabel.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.stopPropagation();
            }
        });
        toggleInput.addEventListener('change', () => {
            if (isActive) handlers.onDeactivate(item.itemKey);
            else handlers.onActivate(item.itemKey);
        });
        row.appendChild(toggleLabel);

        row.addEventListener('click', () => handlers.onOpenDetail(item.itemKey));
        row.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handlers.onOpenDetail(item.itemKey);
            }
        });

        container.appendChild(row);
    }
}
