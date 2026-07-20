/**
 * Clamps a floating window's position so at least minVisible pixels of its
 * width stay on-screen horizontally (in either direction) and it can never
 * be dragged above the top edge or fully below the bottom edge vertically.
 * Matches Weyland-Router's own clamp formula exactly (confirmed from its
 * source): horizontal minVisible applies to both edges; vertical uses the
 * smaller of minVisible/80 so the titlebar stays grabbable even if a caller
 * passes a larger minVisible tuned for the horizontal case.
 * @param {number} left
 * @param {number} top
 * @param {number} width
 * @param {number} height
 * @param {number} viewportWidth
 * @param {number} viewportHeight
 * @param {number} [minVisible]
 * @returns {{left: number, top: number}}
 */
export function clampPosition(left, top, width, height, viewportWidth, viewportHeight, minVisible = 120) {
    const minVisibleY = Math.min(80, minVisible);
    const clampedLeft = Math.max(-width + minVisible, Math.min(viewportWidth - minVisible, left));
    const clampedTop = Math.max(0, Math.min(viewportHeight - minVisibleY, top));
    return { left: clampedLeft, top: clampedTop };
}

/**
 * @param {(query: string) => {matches: boolean}} [matchMediaFn] - injectable for testing; defaults to the real window.matchMedia
 * @returns {boolean}
 */
export function isMobileLayout(matchMediaFn = (query) => window.matchMedia(query)) {
    return matchMediaFn('(max-width: 700px), (pointer: coarse)').matches;
}

/**
 * Wires a titlebar element as a drag handle for a floating window element.
 * Desktop-only -- callers must not invoke this when isMobileLayout() is true.
 * Position is applied directly to windowEl.style.left/top (not a transform),
 * matching Router's own approach, and is clamped via clampPosition on every
 * mousemove.
 * @param {HTMLElement} handleEl
 * @param {HTMLElement} windowEl
 * @returns {{destroy: () => void}}
 */
export function attachDragHandle(handleEl, windowEl) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    function onMouseDown(event) {
        if (event.target.closest('button, input, select, textarea, a, label')) return;
        dragging = true;
        const rect = windowEl.getBoundingClientRect();
        startX = event.clientX;
        startY = event.clientY;
        startLeft = rect.left;
        startTop = rect.top;
        handleEl.style.cursor = 'grabbing';
        event.preventDefault();
    }

    function onMouseMove(event) {
        if (!dragging) return;
        const rect = windowEl.getBoundingClientRect();
        const { left, top } = clampPosition(
            startLeft + (event.clientX - startX),
            startTop + (event.clientY - startY),
            rect.width,
            rect.height,
            window.innerWidth,
            window.innerHeight,
        );
        windowEl.style.left = `${left}px`;
        windowEl.style.top = `${top}px`;
    }

    function onMouseUp() {
        dragging = false;
        handleEl.style.cursor = 'grab';
    }

    handleEl.style.cursor = 'grab';
    handleEl.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return {
        destroy() {
            handleEl.removeEventListener('mousedown', onMouseDown);
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        },
    };
}

/**
 * Re-clamps a floating window's position whenever the viewport resizes, so a
 * window dragged near an edge doesn't end up entirely off-screen after the
 * browser window shrinks.
 * @param {HTMLElement} windowEl
 * @returns {{destroy: () => void}}
 */
export function attachViewportReclamp(windowEl) {
    function onResize() {
        const rect = windowEl.getBoundingClientRect();
        const { left, top } = clampPosition(rect.left, rect.top, rect.width, rect.height, window.innerWidth, window.innerHeight);
        windowEl.style.left = `${left}px`;
        windowEl.style.top = `${top}px`;
    }
    window.addEventListener('resize', onResize);
    return { destroy: () => window.removeEventListener('resize', onResize) };
}
