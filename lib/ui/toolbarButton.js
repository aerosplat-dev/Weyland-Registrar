// lib/ui/toolbarButton.js
import { resolveExtensionBasePath } from '../location.js';

const BUTTON_ID = 'wreg-toolbar-btn';

/**
 * Injects a toolbar button into SillyTavern's World Info panel, placed
 * immediately before #world_editor_select (the "--- Pick to Edit ---"
 * lorebook-selection dropdown) -- deliberately NOT #world_info (the
 * separate multi-select used to activate/deactivate lorebooks globally,
 * a different control in a different section of the panel entirely).
 * #world_editor_select is static markup present at page load (not
 * dynamically injected), so it's as reliable an anchor as the prior
 * #world_refresh one.
 * @param {() => void} onClick
 */
export function injectToolbarButton(onClick) {
    let attempts = 0;
    const interval = setInterval(() => {
        attempts++;
        const anchor = document.getElementById('world_editor_select');
        if (anchor) {
            clearInterval(interval);
            if (document.getElementById(BUTTON_ID)) return;
            const btn = document.createElement('div');
            btn.id = BUTTON_ID;
            // menu_button_icon matches core ST's own icon+text combo button
            // convention in this exact panel (see #world_create_button's
            // "New" button, same markup shape: icon child + text span child).
            btn.className = 'menu_button menu_button_icon';
            btn.title = 'Open Weyland Registrar';
            const basePath = resolveExtensionBasePath(import.meta.url);
            const icon = document.createElement('img');
            icon.src = `/scripts/extensions/${basePath}/assets/registrar-icon.png`;
            icon.alt = '';
            icon.className = 'wreg-toolbar-icon';
            btn.appendChild(icon);
            const label = document.createElement('span');
            label.className = 'wreg-toolbar-label';
            label.textContent = 'Registrar';
            btn.appendChild(label);
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                onClick();
            });
            anchor.before(btn);
        } else if (attempts >= 20) {
            clearInterval(interval);
        }
    }, 500);
}
