# Weyland-Registrar UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain 3-column card-grid modal with a Router-styled, single-column list + detail-split UI that works well on both desktop and mobile, add an active-only filter, and add the previously-missing local-collection create/rename/edit/delete UI.

**Architecture:** Two new pure/tested logic modules (drag-position clamping + mobile detection; curated detail-field selection) sit underneath a rewritten DOM layer (`itemList.js`, a new `detailPane.js`, a new `collectionForm.js`, and a rewritten `modal.js` that orchestrates view-state, drag/resize, and the mobile/desktop split). `index.js` gains a handful of new handlers wiring the already-tested `lib/localCollections.js` CRUD functions to the new form, and a `getItemDetail` accessor for the detail pane.

**Tech Stack:** Same as the rest of the extension — vanilla JS (ES modules, no bundler), `node --test` for the two new pure-logic modules, live Playwright verification for everything DOM-only (this project's established pattern for browser-only code).

## Global Constraints

- **This plan only touches the UI layer** (`lib/ui/*`, `template.html`, `style.css`) plus small additive wiring in `index.js`. No changes to `lib/activationState.js`, `lib/worldInfoWriter.js`, `lib/scenarioBooks.js`, `lib/registrarApi.js`, `lib/collectionResolver.js`, `lib/entrySandbox.js`, `lib/entryBuilder.js`, `lib/uidScheme.js`, `lib/rosterBuilder.js`, `lib/settings.js`, `lib/catalogCache.js`, `lib/filterQuery.js`, or `lib/localCollections.js` — those are already correct, tested, and reviewed. Existing exports from `lib/localCollections.js` (`createLocalCollection`, `renameLocalCollection`, `updateLocalCollectionMembers`, `deleteLocalCollection`) are consumed as-is.
- **Critical mounting fix, not optional polish:** the current implementation mounts the modal as a *child* of `<body>` (`document.body.insertAdjacentHTML('beforeend', html)`). This codebase has a standing, previously-fixed bug class: SillyTavern sets `body { position: fixed; overflow: hidden }` and `<html>` carries a non-`none` CSS `transform` — any `position:fixed` element whose containing-block chain runs through these ends up sized/clipped incorrectly (confirmed root cause of a real prior bug in a sibling extension). The established, working fix: mount as a **sibling of `<body>`** (not a child), give the outer portal element explicit `width:100dvw;height:100dvh` (dynamic viewport units — these are NOT subject to the containing-block sizing bug the way `inset:0` alone would be), and never put `position:fixed` on anything except the portal itself — everything inside uses `position:absolute` relative to the portal. This plan's mobile full-screen requirement makes this fix load-bearing, not cosmetic: skipping it risks the modal rendering as zero-size or clipped on mobile.
- **Desktop has no dimming backdrop.** Matching Weyland-Router's own floating-panel behavior (confirmed by rendering its live UI): the portal is `pointer-events:none` so clicks reach the page everywhere except the actual modal window (`pointer-events:all` on the window itself only). This is a deliberate change from the current implementation's dark `rgba(0,0,0,0.6)` overlay — dropped in favor of matching Router's non-blocking floating-window feel. Mobile is full-screen regardless, so the backdrop question doesn't apply there.
- **Visual design tokens** (all confirmed by directly rendering Weyland-Router's live UI in this session, not just reading its CSS): accent crimson `#b4263a` at varying alpha; primary text `#e8e8e8`; muted text `#888`/`#777`/`#666`; accent text `#ffaab5`/`#ff6b80`; font `'JetBrains Mono', monospace` throughout; uppercase section labels with `1-1.5px` letter-spacing; modal chrome `border-radius:10px`, `border:1px solid rgba(180,38,58,0.35)`, background `linear-gradient(180deg, rgba(20,14,18,0.97) 0%, rgba(12,8,11,0.97) 100%)`, `box-shadow:0 20px 60px rgba(0,0,0,0.8), 0 0 1px rgba(180,38,58,0.4)`, `backdrop-filter:blur(20px)`; row component with a 2px crimson left-accent border and gradient background, hover brightens + `translateX(1px)`; toggle switch 36×20px track, grey-off/crimson-pink-on thumb, `cubic-bezier(0.4,0,0.2,1)` transition.
- **Do not define or depend on the shared `--rb-accent` CSS custom property** — it's inconsistently defined across the Weyland extension family (some define it white, Router only consumes it with a crimson fallback). Define scoped `--wreg-*` custom properties instead, on `.wreg-portal` (not `:root`, to avoid any global leakage).
- **Mobile breakpoint matches Router's own exactly:** `@media (max-width: 700px), (pointer: coarse)`. At this breakpoint: modal is full-screen (no border-radius, no resize, no drag), list and detail become two mutually-exclusive full-screen views (not a side-by-side layout that CSS-collapses) switched via a `data-view="list"|"detail"|"form"` attribute, not two panes stacked/hidden with CSS alone — this avoids the list pane's scroll state and the detail pane's scroll state bleeding into each other.
- **Row click (not the toggle) opens detail.** The toggle's own click handler must call `event.stopPropagation()` so a toggle click never also triggers the row's own click-to-open-detail listener.
- **Local collection deletion requires a confirmation step** before calling `deleteLocalCollection` (it also clears the collection's activation state — a real, if easily-undone, mutation).
- **No new build tooling.** Same `package.json` (`{"type": "module"}` only) as the rest of the extension.
- **Accessibility/quality floor** (per this session's frontend-design guidance): visible keyboard focus on every interactive element (toggle, row, button, form input) — never remove a focus outline without providing a replacement; respect `prefers-reduced-motion` (the open/close and hover animations must have a reduced-motion fallback that skips the animation, not just shortens it).

---

## Task 1: Drag/resize clamping + mobile detection (pure logic)

**Files:**
- Create: `lib/ui/dragResize.js`
- Test: `test/dragResize.test.js`

**Interfaces:**
- Consumes: nothing (pure functions) for `clampPosition`/`isMobileLayout`; a real `HTMLElement` + `window` for the DOM-wiring functions (untested, browser-only).
- Produces: `clampPosition(left, top, width, height, viewportWidth, viewportHeight, minVisible = 120): {left: number, top: number}`, `isMobileLayout(matchMediaFn?): boolean`, `attachDragHandle(handleEl, windowEl): {destroy: () => void}`, `attachViewportReclamp(windowEl): {destroy: () => void}`. Task 7 (modal.js) is the consumer of all four.

- [ ] **Step 1: Write the failing test**

```js
// test/dragResize.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { clampPosition, isMobileLayout } from '../lib/ui/dragResize.js';

test('clampPosition leaves an on-screen position unchanged', () => {
    const result = clampPosition(200, 100, 760, 580, 1400, 900);
    assert.deepEqual(result, { left: 200, top: 100 });
});

test('clampPosition prevents dragging fully off the left edge', () => {
    // width=760, minVisible=120 -> left should never go below -(760-120) = -640
    const result = clampPosition(-900, 100, 760, 580, 1400, 900);
    assert.equal(result.left, -640);
});

test('clampPosition prevents dragging fully off the right edge', () => {
    // viewportWidth=1400, minVisible=120 -> left should never exceed 1400-120 = 1280
    const result = clampPosition(2000, 100, 760, 580, 1400, 900);
    assert.equal(result.left, 1280);
});

test('clampPosition never allows top to go negative', () => {
    const result = clampPosition(200, -500, 760, 580, 1400, 900);
    assert.equal(result.top, 0);
});

test('clampPosition prevents dragging the titlebar fully below the viewport', () => {
    // viewportHeight=900, minVisible clamped to 80 for vertical -> top should never exceed 900-80 = 820
    const result = clampPosition(200, 5000, 760, 580, 1400, 900);
    assert.equal(result.top, 820);
});

test('clampPosition respects a custom minVisible', () => {
    const result = clampPosition(-900, 100, 760, 580, 1400, 900, 200);
    assert.equal(result.left, -560); // -(760-200)
});

test('isMobileLayout returns true when the media query matches', () => {
    const fakeMatchMedia = (query) => {
        assert.equal(query, '(max-width: 700px), (pointer: coarse)');
        return { matches: true };
    };
    assert.equal(isMobileLayout(fakeMatchMedia), true);
});

test('isMobileLayout returns false when the media query does not match', () => {
    const fakeMatchMedia = () => ({ matches: false });
    assert.equal(isMobileLayout(fakeMatchMedia), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/dragResize.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/ui/dragResize.js

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/dragResize.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/ui/dragResize.js test/dragResize.test.js
git commit -m "Add drag-position clamping and mobile-layout detection"
```

---

## Task 2: Curated detail-field selection (pure logic)

**Files:**
- Create: `lib/ui/detailFields.js`
- Test: `test/detailFields.test.js`

**Interfaces:**
- Consumes: a raw catalog record (as returned by `lib/registrarApi.js`'s fetch functions) and an item kind string.
- Produces: `formatTags(tagsJson: string): string`, `buildDetailFields(record, kind): Array<{label: string, value: string}>`. Task 5 (`detailPane.js`) is the consumer.

- [ ] **Step 1: Write the failing test**

```js
// test/detailFields.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTags, buildDetailFields } from '../lib/ui/detailFields.js';

test('formatTags parses a JSON tag array into a comma-separated string', () => {
    assert.equal(formatTags('["campus","dorms"]'), 'campus, dorms');
});

test('formatTags returns an empty string for empty/malformed input', () => {
    assert.equal(formatTags(''), '');
    assert.equal(formatTags('not-json'), '');
    assert.equal(formatTags('[]'), '');
});

test('buildDetailFields for a character includes species/gender/age as one line', () => {
    const fields = buildDetailFields({ species: 'Usagimimi', gender: 'Female', baseAge: '20' }, 'character');
    const speciesLine = fields.find(f => f.label === 'Species / Gender / Age');
    assert.ok(speciesLine);
    assert.equal(speciesLine.value, 'Usagimimi · Female · 20');
});

test('buildDetailFields for a character omits the species/gender/age line entirely if all three are empty', () => {
    const fields = buildDetailFields({ species: '', gender: '', baseAge: '', personality: 'Kind' }, 'character');
    assert.equal(fields.some(f => f.label === 'Species / Gender / Age'), false);
});

test('buildDetailFields for a character includes personality, appearance, and tags when present', () => {
    const fields = buildDetailFields({
        personality: 'Bubbly and outgoing.',
        appearance: 'Tall with red hair.',
        tags: '["campus"]',
    }, 'character');
    assert.deepEqual(fields, [
        { label: 'Personality', value: 'Bubbly and outgoing.' },
        { label: 'Appearance', value: 'Tall with red hair.' },
        { label: 'Tags', value: 'campus' },
    ]);
});

test('buildDetailFields omits empty optional fields for a character', () => {
    const fields = buildDetailFields({ personality: 'Kind.' }, 'character');
    assert.deepEqual(fields, [{ label: 'Personality', value: 'Kind.' }]);
});

test('buildDetailFields for a location includes description and tags', () => {
    const fields = buildDetailFields({ description: 'A quiet library.', tags: '["campus","quiet"]' }, 'location');
    assert.deepEqual(fields, [
        { label: 'Description', value: 'A quiet library.' },
        { label: 'Tags', value: 'campus, quiet' },
    ]);
});

test('buildDetailFields returns an empty array for collection/lore/local kinds', () => {
    assert.deepEqual(buildDetailFields({ name: 'X', summary: 'Y' }, 'collection'), []);
    assert.deepEqual(buildDetailFields({ name: 'X', summary: 'Y' }, 'lore'), []);
    assert.deepEqual(buildDetailFields({ name: 'X', summary: 'Y' }, 'local'), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/detailFields.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/ui/detailFields.js

/**
 * Parses a Registrar-style JSON-encoded tag array (e.g. '["campus","dorms"]')
 * into a human-readable comma-separated string. Never throws -- malformed or
 * empty input yields an empty string.
 * @param {string} tagsJson
 * @returns {string}
 */
export function formatTags(tagsJson) {
    if (!tagsJson) return '';
    try {
        const parsed = JSON.parse(tagsJson);
        if (!Array.isArray(parsed) || parsed.length === 0) return '';
        return parsed.join(', ');
    } catch {
        return '';
    }
}

/**
 * Selects and formats the curated set of fields worth showing in the detail
 * pane for one item -- deliberately NOT every raw field the record has
 * (backstory/secrets/relationships etc. exist only to build World Info
 * entries, not to help a user decide whether to activate someone). Returns
 * an ordered list of {label, value} pairs with any empty/absent field
 * omitted entirely (never an empty-value row).
 * @param {object} record
 * @param {'character'|'location'|'collection'|'lore'|'local'} kind
 * @returns {Array<{label: string, value: string}>}
 */
export function buildDetailFields(record, kind) {
    if (kind === 'character') {
        const fields = [];
        const identity = [record.species, record.gender, record.baseAge].filter(Boolean).join(' · ');
        if (identity) fields.push({ label: 'Species / Gender / Age', value: identity });
        if (record.personality) fields.push({ label: 'Personality', value: record.personality });
        if (record.appearance) fields.push({ label: 'Appearance', value: record.appearance });
        const tags = formatTags(record.tags);
        if (tags) fields.push({ label: 'Tags', value: tags });
        return fields;
    }
    if (kind === 'location') {
        const fields = [];
        if (record.description) fields.push({ label: 'Description', value: record.description });
        const tags = formatTags(record.tags);
        if (tags) fields.push({ label: 'Tags', value: tags });
        return fields;
    }
    return [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/detailFields.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/ui/detailFields.js test/detailFields.test.js
git commit -m "Add curated detail-field selection for the detail pane"
```

---

## Task 3: template.html + style.css rewrite

**Files:**
- Modify: `template.html` (full rewrite)
- Modify: `style.css` (full rewrite)

**Interfaces:**
- Consumes: nothing (declarative markup/styling).
- Produces: the DOM structure and visual styling every later UI task renders into. No unit tests (pure markup/CSS, browser-only per this project's established pattern for `lib/ui/*`).

- [ ] **Step 1: Write `template.html`**

```html
<div class="wreg-portal" id="wreg-portal">
  <div class="wreg-modal-window" id="wreg-modal-window" style="display:none;">
    <div class="wreg-titlebar" id="wreg-titlebar">
      <span class="wreg-wordmark">WEYLAND REGISTRAR</span>
      <button type="button" class="wreg-btn-icon" id="wreg-back-btn" title="Back to list" style="display:none;">&#8592;</button>
      <div class="wreg-titlebar-spacer"></div>
      <button type="button" class="wreg-btn-icon" id="wreg-refresh-catalog" title="Refresh Catalog">&#8635;</button>
      <button type="button" class="wreg-btn-icon" id="wreg-modal-close" title="Close">&times;</button>
    </div>

    <div class="wreg-body" id="wreg-body" data-view="list">

      <div class="wreg-list-view" id="wreg-list-view">
        <div class="wreg-list-header">
          <div class="wreg-tab-bar" id="wreg-tab-bar">
            <button type="button" class="wreg-tab" data-type="character">Characters</button>
            <button type="button" class="wreg-tab" data-type="location">Locations</button>
            <button type="button" class="wreg-tab" data-type="collection">Collections</button>
            <button type="button" class="wreg-tab" data-type="lore">Lore</button>
            <button type="button" class="wreg-tab" data-type="local">My Local Collections</button>
          </div>
          <div class="wreg-list-controls">
            <input type="search" id="wreg-search" class="wreg-search" placeholder="Search... (species:neko owner:name)">
            <label class="wreg-toggle-label wreg-filter-toggle" title="Show only currently-active items">
              <input type="checkbox" id="wreg-active-only">
              <span class="wreg-toggle-track"><span class="wreg-toggle-thumb"></span></span>
              <span class="wreg-toggle-text">Active only</span>
            </label>
            <button type="button" class="wreg-btn-primary" id="wreg-new-collection-btn" style="display:none;">+ New Collection</button>
          </div>
        </div>
        <div class="wreg-item-list" id="wreg-item-list"></div>
      </div>

      <div class="wreg-detail-view" id="wreg-detail-view"></div>

      <div class="wreg-form-view" id="wreg-form-view"></div>

    </div>
  </div>
</div>
```

- [ ] **Step 2: Write `style.css`**

```css
/* Weyland-Registrar -- visual design matched to Weyland-Router (confirmed
 * live), scoped under .wreg-portal so nothing here leaks into the rest of
 * SillyTavern or collides with a sibling extension's own tokens. */

.wreg-portal {
    --wreg-accent: #b4263a;
    --wreg-accent-soft: rgba(180, 38, 58, 0.35);
    --wreg-text: #e8e8e8;
    --wreg-text-muted: #888;
    --wreg-text-accent: #ffaab5;
    --wreg-text-accent-bright: #ff6b80;
    --wreg-font: 'JetBrains Mono', monospace;

    position: fixed;
    left: 0;
    top: 0;
    width: 100dvw;
    height: 100dvh;
    pointer-events: none;
    z-index: 9999;
    font-family: var(--wreg-font);
}

.wreg-modal-window {
    position: absolute;
    left: 100px;
    top: 60px;
    width: min(820px, calc(100dvw - 24px));
    height: 620px;
    min-width: 480px;
    min-height: 400px;
    max-width: calc(100dvw - 24px);
    max-height: calc(100dvh - 24px);
    resize: both;
    overflow: hidden;
    pointer-events: all;
    display: flex;
    flex-direction: column;
    background:
        radial-gradient(ellipse 80% 60% at 50% 0%, rgba(180, 38, 58, 0.08) 0%, transparent 70%),
        linear-gradient(180deg, rgba(20, 14, 18, 0.97) 0%, rgba(12, 8, 11, 0.97) 100%);
    border: 1px solid var(--wreg-accent-soft);
    border-radius: 10px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8), 0 0 1px rgba(180, 38, 58, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.04);
    backdrop-filter: blur(20px);
    animation: wreg-open 0.2s ease;
    color: var(--wreg-text);
}

@keyframes wreg-open {
    from { opacity: 0; transform: scale(0.98); }
    to { opacity: 1; transform: scale(1); }
}

@media (prefers-reduced-motion: reduce) {
    .wreg-modal-window { animation: none; }
}

.wreg-titlebar {
    height: 40px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
    background: linear-gradient(180deg, rgba(28, 16, 22, 0.98) 0%, rgba(18, 10, 16, 0.98) 100%);
    border-bottom: 1px solid rgba(180, 38, 58, 0.25);
    cursor: grab;
    user-select: none;
}

.wreg-wordmark {
    color: #e0445c;
    font-size: 15px;
    font-weight: 900;
    letter-spacing: 2px;
}

.wreg-titlebar-spacer {
    flex: 1;
}

.wreg-btn-icon {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(180, 38, 58, 0.04);
    border: 1px solid rgba(180, 38, 58, 0.18);
    border-radius: 5px;
    color: var(--wreg-text);
    font-family: var(--wreg-font);
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease, transform 0.15s ease;
}

.wreg-btn-icon:hover {
    background: rgba(180, 38, 58, 0.18);
    border-color: rgba(180, 38, 58, 0.6);
    color: #fff;
    transform: scale(1.05);
}

.wreg-btn-icon:active {
    transform: scale(0.95);
}

.wreg-btn-icon:focus-visible,
.wreg-btn-primary:focus-visible,
.wreg-tab:focus-visible,
.wreg-search:focus-visible,
.wreg-item-row:focus-visible,
.wreg-toggle-label input:focus-visible + .wreg-toggle-track {
    outline: 2px solid var(--wreg-text-accent-bright);
    outline-offset: 2px;
}

.wreg-btn-primary {
    padding: 6px 14px;
    background: linear-gradient(180deg, rgba(180, 38, 58, 0.3) 0%, rgba(180, 38, 58, 0.18) 100%);
    border: 1px solid rgba(180, 38, 58, 0.5);
    border-radius: 6px;
    color: var(--wreg-text-accent);
    font-family: var(--wreg-font);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.3px;
    cursor: pointer;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.wreg-btn-primary:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 14px rgba(180, 38, 58, 0.3);
}

.wreg-body {
    flex: 1;
    min-height: 0;
    display: flex;
}

/* Desktop: list + detail split side by side once a detail/form view is active. */
.wreg-list-view {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.wreg-body[data-view="detail"] .wreg-list-view,
.wreg-body[data-view="form"] .wreg-list-view {
    flex: 0 0 50%;
    border-right: 1px solid rgba(180, 38, 58, 0.2);
}

.wreg-detail-view,
.wreg-form-view {
    display: none;
    flex: 1;
    min-width: 0;
    overflow-y: auto;
    padding: 14px;
}

.wreg-body[data-view="detail"] .wreg-detail-view,
.wreg-body[data-view="form"] .wreg-form-view {
    display: block;
}

.wreg-list-header {
    flex-shrink: 0;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-bottom: 1px solid rgba(180, 38, 58, 0.15);
}

.wreg-tab-bar {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
}

.wreg-tab {
    padding: 5px 10px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 5px;
    color: var(--wreg-text-muted);
    font-family: var(--wreg-font);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.wreg-tab:hover {
    color: var(--wreg-text);
}

.wreg-tab.wreg-tab-active {
    background: rgba(180, 38, 58, 0.18);
    border-color: rgba(180, 38, 58, 0.5);
    color: var(--wreg-text-accent);
}

.wreg-list-controls {
    display: flex;
    align-items: center;
    gap: 10px;
}

.wreg-search {
    flex: 1;
    padding: 5px 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 5px;
    color: var(--wreg-text);
    font-family: var(--wreg-font);
    font-size: 11px;
}

.wreg-toggle-label {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    font-size: 10px;
    color: var(--wreg-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.wreg-toggle-label input {
    position: absolute;
    opacity: 0;
    width: 1px;
    height: 1px;
}

.wreg-toggle-track {
    width: 36px;
    height: 20px;
    border-radius: 11px;
    background: linear-gradient(180deg, #777, #555);
    border: 1px solid rgba(255, 255, 255, 0.12);
    position: relative;
    flex-shrink: 0;
    transition: background 0.25s ease;
}

.wreg-toggle-thumb {
    position: absolute;
    left: 2px;
    top: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #ccc;
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), background 0.25s ease;
}

.wreg-toggle-label input:checked + .wreg-toggle-track {
    background: linear-gradient(180deg, rgba(180, 38, 58, 0.45), rgba(180, 38, 58, 0.25));
}

.wreg-toggle-label input:checked + .wreg-toggle-track .wreg-toggle-thumb {
    transform: translateX(16px);
    background: linear-gradient(180deg, #ff6b80, #b4263a);
}

.wreg-item-list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.wreg-item-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    background: linear-gradient(90deg, rgba(180, 38, 58, 0.06), rgba(180, 38, 58, 0.02));
    border: 1px solid rgba(180, 38, 58, 0.15);
    border-left: 2px solid rgba(180, 38, 58, 0.35);
    border-radius: 5px;
    cursor: pointer;
    transition: border-left-color 0.15s ease, transform 0.15s ease, background 0.15s ease;
}

.wreg-item-row:hover {
    border-left-color: rgba(180, 38, 58, 0.7);
    transform: translateX(1px);
    background: linear-gradient(90deg, rgba(180, 38, 58, 0.1), rgba(180, 38, 58, 0.03));
}

.wreg-item-row-active {
    border-left-color: var(--wreg-text-accent-bright);
}

.wreg-item-row-main {
    flex: 1;
    min-width: 0;
}

.wreg-item-title {
    font-size: 12px;
    font-weight: 600;
}

.wreg-item-summary {
    font-size: 11px;
    color: var(--wreg-text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.wreg-forced-badge {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--wreg-text-accent);
    padding: 2px 6px;
    border: 1px solid rgba(180, 38, 58, 0.4);
    border-radius: 4px;
    flex-shrink: 0;
}

.wreg-row-toggle {
    flex-shrink: 0;
}

.wreg-detail-title {
    font-size: 15px;
    font-weight: 700;
    margin-bottom: 10px;
}

.wreg-detail-portrait {
    max-width: 100%;
    border-radius: 6px;
    margin-bottom: 10px;
    display: block;
}

.wreg-detail-field {
    margin-bottom: 10px;
}

.wreg-detail-field-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--wreg-text-muted);
    margin-bottom: 3px;
}

.wreg-detail-field-value {
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
}

.wreg-detail-actions {
    display: flex;
    gap: 8px;
    margin-top: 14px;
}

.wreg-form-field {
    margin-bottom: 12px;
}

.wreg-form-field label {
    display: block;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: var(--wreg-text-muted);
    margin-bottom: 4px;
}

.wreg-form-field input[type="text"] {
    width: 100%;
    padding: 6px 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 5px;
    color: var(--wreg-text);
    font-family: var(--wreg-font);
    font-size: 12px;
}

/* Mobile: full-screen, no drag/resize, list and detail/form are mutually
 * exclusive full-screen views rather than side-by-side panes. */
@media (max-width: 700px), (pointer: coarse) {
    .wreg-modal-window {
        position: fixed;
        inset: 0;
        left: 0;
        top: 0;
        width: 100dvw;
        height: 100dvh;
        max-width: none;
        max-height: none;
        border-radius: 0;
        resize: none;
    }

    .wreg-titlebar {
        cursor: default;
    }

    .wreg-body[data-view="list"] .wreg-list-view {
        flex: 1;
    }

    .wreg-body[data-view="list"] .wreg-detail-view,
    .wreg-body[data-view="list"] .wreg-form-view {
        display: none;
    }

    .wreg-body[data-view="detail"] .wreg-list-view,
    .wreg-body[data-view="form"] .wreg-list-view {
        display: none;
    }

    .wreg-body[data-view="detail"] .wreg-detail-view,
    .wreg-body[data-view="form"] .wreg-form-view {
        flex: 1;
        border-right: none;
    }

    .wreg-tab-bar {
        overflow-x: auto;
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add template.html style.css
git commit -m "Rewrite template.html and style.css to match Weyland-Router's design"
```

---

## Task 4: itemList.js rewrite (row rendering, detail-open, toggle isolation)

**Files:**
- Modify: `lib/ui/itemList.js` (full rewrite)

**Interfaces:**
- Consumes: nothing new beyond what it already had.
- Produces: `renderItemList(container, items, handlers)` — same name, extended `handlers` shape: adds `onOpenDetail: (itemKey) => void`. Task 7 (`modal.js`) is the consumer. No unit test (unchanged from Task 16 — pure DOM rendering, browser-only).

- [ ] **Step 1: Write the implementation**

```js
// lib/ui/itemList.js

/**
 * Renders a list of catalog items as a single-column, vertically scrollable
 * list of rows (never a grid, at any width) with an activate/deactivate
 * toggle and a click-to-open-detail interaction on the row itself.
 * @param {HTMLElement} container
 * @param {Array<{itemKey: string, name: string, summary?: string}>} items
 * @param {{
 *   onActivate: (itemKey: string) => void,
 *   onDeactivate: (itemKey: string) => void,
 *   onOpenDetail: (itemKey: string) => void,
 *   resolveActive: (itemKey: string) => boolean,
 *   resolveForced: (itemKey: string) => 'none'|'active'|'inactive',
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

        if (forced !== 'none') {
            const badge = document.createElement('span');
            badge.className = 'wreg-forced-badge';
            badge.textContent = forced === 'active' ? 'Pinned active' : 'Pinned inactive';
            row.appendChild(badge);
        }

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
        toggleLabel.addEventListener('click', (event) => {
            // Prevent the row's own click-to-open-detail listener from firing
            // for a click that was meant to toggle activation, not open detail.
            event.stopPropagation();
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
```

- [ ] **Step 2: Commit**

```bash
git add lib/ui/itemList.js
git commit -m "Rewrite itemList.js as a single-column row list with detail-open"
```

---

## Task 5: detailPane.js (curated detail rendering)

**Files:**
- Create: `lib/ui/detailPane.js`

**Interfaces:**
- Consumes: `buildDetailFields`/`formatTags` (Task 2, `lib/ui/detailFields.js`).
- Produces: `renderDetailPane(container, detail, handlers)`. Task 7 (`modal.js`) is the consumer, supplying `detail` from `index.js`'s new `getItemDetail(itemKey)`. No unit test (pure DOM rendering, browser-only).

- [ ] **Step 1: Write the implementation**

```js
// lib/ui/detailPane.js
import { buildDetailFields } from './detailFields.js';

/**
 * @typedef {Object} ItemDetail
 * @property {string} itemKey
 * @property {'character'|'location'|'collection'|'lore'|'local'} kind
 * @property {object} record - raw catalog record (character/location/collection/lore) or {name} for a local collection
 * @property {boolean} isActive
 * @property {'none'|'active'|'inactive'} forced
 * @property {string[]} [memberNames] - for collection/local kinds: resolved member display names
 * @property {boolean} [isLocal] - true only for a local collection, to show rename/edit/delete controls
 */

/**
 * Renders the curated detail view for one item into container.
 * @param {HTMLElement} container
 * @param {ItemDetail} detail
 * @param {{
 *   onActivate: (itemKey: string) => void,
 *   onDeactivate: (itemKey: string) => void,
 *   onRenameLocalCollection?: (itemKey: string) => void,
 *   onEditLocalCollectionMembers?: (itemKey: string) => void,
 *   onDeleteLocalCollection?: (itemKey: string) => void,
 * }} handlers
 */
export function renderDetailPane(container, detail, handlers) {
    container.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'wreg-detail-title';
    title.textContent = detail.record.name;
    container.appendChild(title);

    if (detail.record.portrait) {
        const img = document.createElement('img');
        img.className = 'wreg-detail-portrait';
        img.src = detail.record.portrait;
        img.alt = detail.record.name;
        container.appendChild(img);
    }

    if (detail.record.summary) {
        appendField(container, 'Summary', detail.record.summary);
    }

    for (const field of buildDetailFields(detail.record, detail.kind)) {
        appendField(container, field.label, field.value);
    }

    if (detail.memberNames && detail.memberNames.length) {
        appendField(container, 'Members', detail.memberNames.join(', '));
    }

    const actions = document.createElement('div');
    actions.className = 'wreg-detail-actions';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'wreg-btn-primary';
    toggle.textContent = detail.isActive ? 'Deactivate' : 'Activate';
    toggle.addEventListener('click', () => {
        if (detail.isActive) handlers.onDeactivate(detail.itemKey);
        else handlers.onActivate(detail.itemKey);
    });
    actions.appendChild(toggle);

    if (detail.isLocal) {
        const rename = document.createElement('button');
        rename.type = 'button';
        rename.className = 'wreg-btn-icon';
        rename.textContent = 'Rename';
        rename.style.width = 'auto';
        rename.style.padding = '0 10px';
        rename.addEventListener('click', () => handlers.onRenameLocalCollection?.(detail.itemKey));
        actions.appendChild(rename);

        const editMembers = document.createElement('button');
        editMembers.type = 'button';
        editMembers.className = 'wreg-btn-icon';
        editMembers.textContent = 'Edit Members';
        editMembers.style.width = 'auto';
        editMembers.style.padding = '0 10px';
        editMembers.addEventListener('click', () => handlers.onEditLocalCollectionMembers?.(detail.itemKey));
        actions.appendChild(editMembers);

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'wreg-btn-icon';
        del.textContent = 'Delete';
        del.style.width = 'auto';
        del.style.padding = '0 10px';
        del.addEventListener('click', () => {
            if (window.confirm(`Delete the local collection "${detail.record.name}"? This cannot be undone.`)) {
                handlers.onDeleteLocalCollection?.(detail.itemKey);
            }
        });
        actions.appendChild(del);
    }

    container.appendChild(actions);
}

function appendField(container, label, value) {
    const field = document.createElement('div');
    field.className = 'wreg-detail-field';
    const labelEl = document.createElement('div');
    labelEl.className = 'wreg-detail-field-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('div');
    valueEl.className = 'wreg-detail-field-value';
    valueEl.textContent = value;
    field.appendChild(labelEl);
    field.appendChild(valueEl);
    container.appendChild(field);
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ui/detailPane.js
git commit -m "Add curated detail pane rendering"
```

---

## Task 6: collectionForm.js (create/rename/edit-members)

**Files:**
- Create: `lib/ui/collectionForm.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `renderCollectionForm(container, formState, handlers)`. Task 7 (`modal.js`) is the consumer. No unit test (pure DOM rendering, browser-only).

- [ ] **Step 1: Write the implementation**

```js
// lib/ui/collectionForm.js

/**
 * @typedef {Object} CollectionFormState
 * @property {'create'|'rename'|'members'} mode
 * @property {string} [existingId] - present for rename/members modes
 * @property {string} [initialName]
 * @property {string[]} [initialMemberKeys]
 * @property {Array<{itemKey: string, name: string}>} availableItems - every character/location currently in the catalog, for the member checklist
 */

/**
 * Renders the local-collection create/rename/edit-members form. All three
 * modes share one component: "create" and "members" both show the member
 * checklist, "rename" only shows the name field.
 * @param {HTMLElement} container
 * @param {CollectionFormState} formState
 * @param {{onSubmit: (result: {name?: string, memberKeys?: string[]}) => void, onCancel: () => void}} handlers
 */
export function renderCollectionForm(container, formState, handlers) {
    container.innerHTML = '';

    const heading = document.createElement('div');
    heading.className = 'wreg-detail-title';
    heading.textContent = formState.mode === 'create' ? 'New Local Collection'
        : formState.mode === 'rename' ? 'Rename Collection'
        : 'Edit Members';
    container.appendChild(heading);

    let nameInput = null;
    if (formState.mode === 'create' || formState.mode === 'rename') {
        const field = document.createElement('div');
        field.className = 'wreg-form-field';
        const label = document.createElement('label');
        label.textContent = 'Name';
        nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = formState.initialName ?? '';
        field.appendChild(label);
        field.appendChild(nameInput);
        container.appendChild(field);
    }

    const checkboxes = new Map();
    if (formState.mode === 'create' || formState.mode === 'members') {
        const initialMembers = new Set(formState.initialMemberKeys ?? []);
        const listField = document.createElement('div');
        listField.className = 'wreg-form-field';
        const label = document.createElement('label');
        label.textContent = 'Members';
        listField.appendChild(label);
        const list = document.createElement('div');
        list.className = 'wreg-item-list';
        for (const item of formState.availableItems) {
            const row = document.createElement('label');
            row.className = 'wreg-item-row';
            row.style.cursor = 'pointer';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = initialMembers.has(item.itemKey);
            checkbox.style.marginRight = '8px';
            checkboxes.set(item.itemKey, checkbox);
            const name = document.createElement('span');
            name.className = 'wreg-item-title';
            name.textContent = item.name;
            row.appendChild(checkbox);
            row.appendChild(name);
            list.appendChild(row);
        }
        listField.appendChild(list);
        container.appendChild(listField);
    }

    const actions = document.createElement('div');
    actions.className = 'wreg-detail-actions';

    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'wreg-btn-primary';
    submit.textContent = 'Save';
    submit.addEventListener('click', () => {
        const result = {};
        if (nameInput) {
            const trimmed = nameInput.value.trim();
            if (!trimmed) {
                nameInput.focus();
                return;
            }
            result.name = trimmed;
        }
        if (checkboxes.size) {
            result.memberKeys = [...checkboxes.entries()].filter(([, cb]) => cb.checked).map(([key]) => key);
        }
        handlers.onSubmit(result);
    });
    actions.appendChild(submit);

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'wreg-btn-icon';
    cancel.textContent = 'Cancel';
    cancel.style.width = 'auto';
    cancel.style.padding = '0 10px';
    cancel.addEventListener('click', () => handlers.onCancel());
    actions.appendChild(cancel);

    container.appendChild(actions);
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/ui/collectionForm.js
git commit -m "Add local collection create/rename/edit-members form"
```

---

## Task 7: modal.js rewrite (orchestration, portal mount fix, drag/resize, view-state)

**Files:**
- Modify: `lib/ui/modal.js` (full rewrite)

**Interfaces:**
- Consumes: `renderItemList` (Task 4), `renderDetailPane` (Task 5), `renderCollectionForm` (Task 6), `clampPosition`/`isMobileLayout`/`attachDragHandle`/`attachViewportReclamp` (Task 1), `parseSearchTerms`/`matchesTerms` (existing, `lib/filterQuery.js`), `resolveExtensionBasePath` (existing, `lib/location.js`).
- Produces: `openModal(state)` — same exported name, extended `state` shape (see below). Task 8 (`index.js`) is the consumer.
- **`state` shape gains:** `getItemDetail: (itemKey: string) => ItemDetail` (Task 5's `ItemDetail` type), `getAvailableItemsForForm: () => Array<{itemKey: string, name: string}>` (characters+locations for the member checklist), `onCreateLocalCollection: (name: string, memberKeys: string[]) => void`, `onRenameLocalCollection: (itemKey: string, name: string) => void`, `onUpdateLocalCollectionMembers: (itemKey: string, memberKeys: string[]) => void`, `onDeleteLocalCollection: (itemKey: string) => void`.

**Critical fix carried from Global Constraints:** `ensureModalElement()` must mount the fetched `template.html` content as a **sibling of `<body>`**, not a child — `document.body.insertAdjacentHTML('afterend', html)`, not `'beforeend'`.

- [ ] **Step 1: Write the implementation**

```js
// lib/ui/modal.js
import { renderItemList } from './itemList.js';
import { renderDetailPane } from './detailPane.js';
import { renderCollectionForm } from './collectionForm.js';
import { parseSearchTerms, matchesTerms } from '../filterQuery.js';
import { resolveExtensionBasePath } from '../location.js';
import { isMobileLayout, attachDragHandle, attachViewportReclamp } from './dragResize.js';

let portalElement = null;
let modalReadyPromise = null;
let currentState = null;
let dragHandle = null;
let reclampHandle = null;

/**
 * Opens the browsing modal. Safe to call repeatedly: the portal/modal
 * elements are built and wired only once; `currentState` is a module-level
 * binding (not captured once at build time) so a later `openModal(newState)`
 * call is picked up correctly by controls wired during the first call.
 * @param {object} state - see modal.js's own JSDoc typedef in the plan/spec for the full shape
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
    });

    portalElement = portal;
    return window_;
}

function setView(view) {
    const body = portalElement.querySelector('#wreg-body');
    body.dataset.view = view;
    portalElement.querySelector('#wreg-back-btn').style.display = view === 'list' ? 'none' : '';
}

function updateDragResizeForLayout(window_) {
    dragHandle?.destroy();
    reclampHandle?.destroy();
    dragHandle = null;
    reclampHandle = null;
    if (!isMobileLayout()) {
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
        onActivate: currentState.onActivate,
        onDeactivate: currentState.onDeactivate,
        onOpenDetail: (itemKey) => openDetail(itemKey),
        resolveActive: currentState.resolveActive,
        resolveForced: currentState.resolveForced,
    });
}

function openDetail(itemKey) {
    const detail = currentState.getItemDetail(itemKey);
    const container = portalElement.querySelector('#wreg-detail-view');
    renderDetailPane(container, detail, {
        onActivate: (key) => { currentState.onActivate(key); openDetail(key); },
        onDeactivate: (key) => { currentState.onDeactivate(key); openDetail(key); },
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
```

- [ ] **Step 2: Commit**

```bash
git add lib/ui/modal.js
git commit -m "Rewrite modal.js: portal mount fix, list/detail/form view-state, drag/resize"
```

---

## Task 8: index.js additions (getItemDetail, local-collection handlers)

**Files:**
- Modify: `index.js` (additive changes only)

**Interfaces:**
- Consumes: everything already imported, plus `createLocalCollection`/`renameLocalCollection`/`updateLocalCollectionMembers`/`deleteLocalCollection` (existing, `lib/localCollections.js`, previously unimported).
- Produces: the extended `state` shape `openModal` now expects (Task 7). No unit test (integration wiring, browser-only, matching this project's established pattern for `index.js`).

- [ ] **Step 1: Add the import**

In `index.js`, add to the existing import list:

```js
import { createLocalCollection, renameLocalCollection, updateLocalCollectionMembers, deleteLocalCollection } from './lib/localCollections.js';
```

- [ ] **Step 2: Add `getItemDetail` and the local-collection handlers inside `initModal`**

Add these functions inside `initModal(settings)` (alongside the existing `handleToggle`), and add the five new keys to the object passed to `openModal(...)`:

```js
function getItemDetail(itemKey) {
    const kind = classifyItemKey(itemKey, catalog);
    if (kind === 'lore') {
        const loreId = String(itemKey).slice('lore:'.length);
        const record = catalog.lore.find(l => String(l.loreId) === loreId);
        return {
            itemKey, kind, record,
            isActive: !!settings.scenarioBooks[loreId]?.active,
            forced: 'none',
        };
    }
    if (kind === 'collection') {
        const key = String(itemKey);
        const isLocal = !!settings.localCollections[key];
        const record = isLocal
            ? { name: settings.localCollections[key].name }
            : (catalog.collections.find(c => String(c.collectionId) === key) ?? { name: key });
        const memberKeys = isLocal
            ? settings.localCollections[key].memberKeys
            : resolveCollectionMembers(catalog.collections.find(c => String(c.collectionId) === key) ?? {}, catalog);
        const allItems = [...catalog.characters, ...catalog.locations];
        const memberNames = memberKeys
            .map(k => allItems.find(i => i.itemKey === k)?.name)
            .filter(Boolean);
        return {
            itemKey, kind, record,
            isActive: !!resolvedCollections[key]?.active,
            forced: 'none',
            memberNames,
            memberKeys,
            isLocal,
        };
    }
    const allItems = [...catalog.characters, ...catalog.locations];
    const record = allItems.find(i => i.itemKey === itemKey) ?? {};
    return {
        itemKey, kind, record,
        isActive: resolveItemActive(itemKey, settings.itemStates, resolvedCollections),
        forced: settings.itemStates[itemKey] ?? 'none',
    };
}

function getAvailableItemsForForm() {
    return [...catalog.characters, ...catalog.locations].map(r => ({ itemKey: r.itemKey, name: r.name }));
}

async function persistAndRefresh() {
    getStContext().saveSettingsDebounced();
}

function onCreateLocalCollection(name, memberKeys) {
    const id = createLocalCollection(settings, name, memberKeys);
    settings.collections[id] = { active: false, source: 'local' };
    persistAndRefresh();
}

function onRenameLocalCollection(itemKey, name) {
    renameLocalCollection(settings, itemKey, name);
    persistAndRefresh();
}

function onUpdateLocalCollectionMembers(itemKey, memberKeys) {
    updateLocalCollectionMembers(settings, itemKey, memberKeys);
    persistAndRefresh();
}

async function onDeleteLocalCollection(itemKey) {
    const wasActive = !!settings.collections[itemKey]?.active;
    deleteLocalCollection(settings, itemKey);
    if (wasActive) await syncBooks(settings);
    persistAndRefresh();
}
```

- [ ] **Step 3: Pass the five new functions into `openModal`'s state object**

In the existing `openModal({...})` call inside `initModal`, add:

```js
    getItemDetail,
    getAvailableItemsForForm,
    onCreateLocalCollection,
    onRenameLocalCollection,
    onUpdateLocalCollectionMembers,
    onDeleteLocalCollection: onDeleteLocalCollection,
```

- [ ] **Step 4: Verify no syntax errors**

Run: `node --check index.js`
Expected: no output (syntax OK).

- [ ] **Step 5: Run the full existing unit suite to confirm no regressions**

Run: `node --test test/*.test.js`
Expected: PASS (all existing tests, unaffected — `index.js` has no unit tests of its own).

- [ ] **Step 6: Commit**

```bash
git add index.js
git commit -m "Wire local-collection create/rename/edit-members/delete and getItemDetail"
```

---

## Task 9: Live Playwright verification (desktop AND mobile)

**Files:** none (verification-only task).

- [ ] **Step 1: Desktop verification**

Using Playwright against the real running Weyland Tavern instance (per this project's established live-testing conventions — LAN IP, HTTP Basic Auth), at a desktop viewport (e.g. 1400×900):
1. Open the modal from the World Info panel button. Confirm no dimming backdrop appears (matching Router's own non-blocking floating-window feel) and clicking outside the modal window still reaches the page underneath.
2. Confirm the list renders as a single-column vertical list of rows, not a grid.
3. Click a row's toggle — confirm it activates/deactivates WITHOUT opening the detail pane.
4. Click a row itself (not the toggle) — confirm the detail pane opens on the right half, list pane shrinks to the left half, and the detail content matches the curated field set (§7 of the design spec) for that item's kind.
5. Turn on "Active only" — confirm the current tab narrows to only active items; turn it off, confirm the full list returns.
6. Drag the titlebar — confirm the window moves and is clamped at the viewport edges (cannot be dragged fully off-screen). Resize via the native resize handle — confirm it respects the min-width/min-height floor.
7. On the "My Local Collections" tab, click "+ New Collection," name it, select a couple of members, save — confirm it appears in the list and its detail view shows Rename/Edit Members/Delete controls. Activate it, confirm both members' entries land in the correct managed books (per existing, already-verified sync logic). Delete it with confirmation — confirm it disappears and its members deactivate.

- [ ] **Step 2: Mobile verification**

At a mobile-sized viewport (e.g. 390×844, or Playwright's device emulation with `pointer: coarse`):
1. Open the modal — confirm it is genuinely full-screen (no visible page content around it, correct `100dvw`/`100dvh` sizing, no clipped/zero-height rendering — this is the specific failure mode the portal-mount fix (Task 7) exists to prevent, so explicitly check the modal's actual rendered bounding box matches the viewport).
2. Confirm the titlebar is NOT draggable (no drag cursor, dragging it does nothing) and there's no visible resize handle.
3. Click a row — confirm the view swaps to a full-screen detail view (not a side panel) with a visible back button; confirm the list view's own header (tabs, search) is not visible while detail is showing.
4. Click back — confirm it returns to the full-screen list view with scroll position and any active-only-filter/search state intact.
5. Repeat the local-collection create/edit/delete flow from Step 1's point 7, confirming it works correctly as full-screen views on mobile too.

- [ ] **Step 3: Report findings**

Document what was verified and any issues found, following this project's established practice of being explicit about what could/couldn't be verified in the available environment (no live server access from certain sandboxed contexts — use a local fixture harness per Task 17's precedent if a real server genuinely isn't reachable, but prefer the real live server if it is, since it's available in this project's actual environment).

---

## Self-Review

**Spec coverage:**
- §4 (visual design system) → Task 3, Global Constraints.
- §5 (layout architecture, desktop/mobile split, portal-mount fix) → Task 3, Task 7, Global Constraints.
- §6 (list pane, active-only filter) → Task 4, Task 7.
- §7 (detail pane, curated fields) → Task 2, Task 5.
- §8 (local collection management) → Task 6, Task 7, Task 8.
- §9 (drag & resize, desktop-only) → Task 1, Task 7.
- §10 (interface changes) → all tasks' Interfaces sections.
- §11 (testing approach, explicit desktop+mobile) → Task 9.

**Placeholder scan:** no TBD/TODO; every code step has complete, real implementations.

**Type consistency check:** `ItemDetail`'s shape (defined in Task 5's JSDoc) is produced by `index.js`'s `getItemDetail` (Task 8) and consumed by `modal.js`'s `openDetail`/`renderDetailPane` call (Task 7) — verified the field names match exactly (`itemKey`, `kind`, `record`, `isActive`, `forced`, `memberNames`, `memberKeys`, `isLocal`) across all three tasks' code.
