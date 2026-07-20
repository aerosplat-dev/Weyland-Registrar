// lib/ui/toolbarButton.js

const BUTTON_ID = 'wreg-toolbar-btn';

/**
 * Injects a toolbar button into SillyTavern's World Info panel, appended
 * after #world_refresh (not the panel's literal top-right corner, which
 * Streamlined UI already occupies with its own Advanced Options toggle --
 * confirmed by reading that extension's patches.json/style.css directly).
 * #world_refresh is never hidden by Streamlined UI's CSS, so this single
 * injection point works correctly in both standard and Streamlined UI,
 * unlike Weyland-Router which needs two separate injection points because
 * Streamlined UI DOES affect its own Connection Manager anchor.
 * @param {() => void} onClick
 */
export function injectToolbarButton(onClick) {
    let attempts = 0;
    const interval = setInterval(() => {
        attempts++;
        const anchor = document.getElementById('world_refresh');
        if (anchor) {
            clearInterval(interval);
            if (document.getElementById(BUTTON_ID)) return;
            const btn = document.createElement('div');
            btn.id = BUTTON_ID;
            btn.className = 'menu_button fa-solid fa-book-atlas';
            btn.title = 'Open Weyland Registrar';
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                onClick();
            });
            anchor.after(btn);
        } else if (attempts >= 20) {
            clearInterval(interval);
        }
    }, 500);
}
