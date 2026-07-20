// lib/ui/itemList.js

/**
 * Renders a list of catalog items (characters, locations, collections, or
 * lore) as cards with an activate/deactivate control, showing the resolved
 * active/inactive/forced-override state explicitly per the spec's UI
 * requirement that the resolution logic is never a mystery to the user.
 * @param {HTMLElement} container
 * @param {Array<{itemKey: string, name: string, summary?: string}>} items
 * @param {{onActivate: (itemKey: string) => void, onDeactivate: (itemKey: string) => void, resolveActive: (itemKey: string) => boolean, resolveForced: (itemKey: string) => 'none'|'active'|'inactive'}} handlers
 */
export function renderItemList(container, items, handlers) {
    container.innerHTML = '';
    for (const item of items) {
        const isActive = handlers.resolveActive(item.itemKey);
        const forced = handlers.resolveForced(item.itemKey);

        const card = document.createElement('div');
        card.className = 'wreg-item-card' + (isActive ? ' wreg-active' : '');
        card.dataset.itemKey = item.itemKey;

        const title = document.createElement('div');
        title.className = 'wreg-item-title';
        title.textContent = item.name;
        card.appendChild(title);

        if (item.summary) {
            const summary = document.createElement('div');
            summary.className = 'wreg-item-summary';
            summary.textContent = item.summary;
            card.appendChild(summary);
        }

        if (forced !== 'none') {
            const badge = document.createElement('span');
            badge.className = 'wreg-forced-badge';
            badge.textContent = forced === 'active' ? 'Pinned active' : 'Pinned inactive';
            card.appendChild(badge);
        }

        const toggle = document.createElement('div');
        toggle.className = 'menu_button ' + (isActive ? 'fa-solid fa-toggle-on' : 'fa-solid fa-toggle-off');
        toggle.textContent = isActive ? 'Deactivate' : 'Activate';
        toggle.addEventListener('click', () => {
            if (isActive) handlers.onDeactivate(item.itemKey);
            else handlers.onActivate(item.itemKey);
        });
        card.appendChild(toggle);

        container.appendChild(card);
    }
}
