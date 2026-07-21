# Weyland-Registrar: Bulk Selection, Sort, Collection Members, Character Reveal Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bulk-select + batched activate/deactivate, a sort control, a collection-member-list
bug fix, and character background/secrets reveal buttons to the already-shipped Registrar browsing
UI.

**Architecture:** Four additive features layered onto the existing list/detail modal
(`lib/ui/modal.js`, `lib/ui/itemList.js`, `lib/ui/detailPane.js`, `template.html`, `style.css`,
`index.js`). No existing single-item activation path (`handleToggle`) changes; bulk activation is a
new, separate, batched code path.

**Tech Stack:** Same as the rest of the extension — vanilla JS, `node --test`, no build step.

## Global Constraints

- Bulk activate/deactivate must call `syncBooks(settings)` **at most once** per bulk action,
  regardless of how many items are selected (see design doc's "Batched activation" section) — never
  loop the existing single-item `handleToggle`.
- Bulk selection is a per-tab `Set<itemKey>`: cleared on tab switch, preserved through search-text
  and active-only-filter changes within the same tab.
- Sort preference (field + direction) is shared across tabs, stored on `portalElement.dataset`
  exactly like the existing search text already is. On the "My Local Collections" tab, only `name`
  is a valid sort field (local collections carry no `createdAt`/`updatedAt`/`ownerName`) — the
  `<select>`'s other three `<option>`s are `disabled` while that tab is active, and rendering falls
  back to `name`/`asc` for that tab's render only, without mutating the stored preference.
- Confirmed field mapping for the character detail reveal buttons: **Background/History** reveals
  `knownBackground` (label "Background") + `backgroundFriends` (label "Background Friends").
  **Secrets** reveals `hiddenBackground` (label "Hidden Background") + `secrets` (label "Secrets").
  Never surface `backgroundKeywords`/`secretsKeywords` (search-index fields, not display content).
- Pure logic (sort comparators, revealable-field selection, the collection-member resolution fix)
  gets full `node --test` coverage. DOM wiring in `itemList.js`/`detailPane.js`/`modal.js`/
  `index.js`/`template.html`/`style.css` is browser-only orchestration, verified via live
  Playwright E2E only — matching this codebase's existing, explicitly accepted convention (no
  `itemList.test.js`, `detailPane.test.js`, or `modal.test.js` exist today, by design).
- Never commit to the parent `WeylandTavern` repo. This extension is its own nested git repo at
  `/home/adener/WeylandTavern/SillyTavern/data/default-user/extensions/Weyland-Registrar` — commit
  there only.

---

### Task 1: `sortItems.js` — sort comparator module

**Files:**
- Create: `lib/ui/sortItems.js`
- Test: `test/sortItems.test.js`

**Interfaces:**
- Produces: `sortItems(items, field, direction)` where `field` is `'name'|'created'|'updated'|
  'author'` and `direction` is `'asc'|'desc'`, returning a **new** array (input not mutated).
  Consumed by Task 8 (`modal.js`'s `renderCurrentTab`).

- [ ] **Step 1: Write the failing tests**

Create `test/sortItems.test.js`:

```js
// test/sortItems.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { sortItems } from '../lib/ui/sortItems.js';

const RECORDS = [
    { name: 'Winona', createdAt: '2025-06-01 10:00:00.000 +00:00', updatedAt: '2026-01-01 10:00:00.000 +00:00', ownerName: 'zed' },
    { name: 'Ayano', createdAt: '2025-04-10 22:09:28.589 +00:00', updatedAt: '2026-05-07 18:56:03.291 +00:00', ownerName: 'anna' },
    { name: 'Maya', createdAt: '2025-05-16 18:26:26.720 +00:00', updatedAt: '2026-01-03 22:44:40.521 +00:00', ownerName: 'mike' },
];

test('sorts by name ascending (default direction)', () => {
    const result = sortItems(RECORDS, 'name', 'asc');
    assert.deepEqual(result.map(r => r.name), ['Ayano', 'Maya', 'Winona']);
});

test('sorts by name descending', () => {
    const result = sortItems(RECORDS, 'name', 'desc');
    assert.deepEqual(result.map(r => r.name), ['Winona', 'Maya', 'Ayano']);
});

test('sorts by createdAt ascending, parsing the Registrar\'s date-string format', () => {
    const result = sortItems(RECORDS, 'created', 'asc');
    assert.deepEqual(result.map(r => r.name), ['Ayano', 'Maya', 'Winona']);
});

test('sorts by updatedAt descending', () => {
    const result = sortItems(RECORDS, 'updated', 'desc');
    assert.deepEqual(result.map(r => r.name), ['Ayano', 'Maya', 'Winona']);
});

test('sorts by author (ownerName) ascending', () => {
    const result = sortItems(RECORDS, 'author', 'asc');
    assert.deepEqual(result.map(r => r.name), ['Ayano', 'Maya', 'Winona']);
});

test('items missing the sorted field sort to the end, regardless of direction', () => {
    const items = [
        { name: 'HasDate', createdAt: '2025-06-01 10:00:00.000 +00:00' },
        { name: 'NoDate' },
        { name: 'AlsoHasDate', createdAt: '2025-01-01 10:00:00.000 +00:00' },
    ];
    const asc = sortItems(items, 'created', 'asc');
    assert.deepEqual(asc.map(i => i.name), ['AlsoHasDate', 'HasDate', 'NoDate']);
    const desc = sortItems(items, 'created', 'desc');
    assert.deepEqual(desc.map(i => i.name), ['HasDate', 'AlsoHasDate', 'NoDate']);
});

test('a malformed date string is treated as missing (sorts to the end)', () => {
    const items = [
        { name: 'Good', createdAt: '2025-06-01 10:00:00.000 +00:00' },
        { name: 'Malformed', createdAt: 'not-a-date' },
    ];
    const result = sortItems(items, 'created', 'asc');
    assert.deepEqual(result.map(i => i.name), ['Good', 'Malformed']);
});

test('does not mutate the input array', () => {
    const items = [{ name: 'B' }, { name: 'A' }];
    const original = [...items];
    sortItems(items, 'name', 'asc');
    assert.deepEqual(items, original);
});

test('an unrecognized field falls back to name', () => {
    const result = sortItems(RECORDS, 'bogus', 'asc');
    assert.deepEqual(result.map(r => r.name), ['Ayano', 'Maya', 'Winona']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/sortItems.test.js`
Expected: FAIL — `Cannot find module '../lib/ui/sortItems.js'`

- [ ] **Step 3: Write the implementation**

Create `lib/ui/sortItems.js`:

```js
// lib/ui/sortItems.js

/**
 * Sorts catalog items by the given field. Every fetched Registrar record
 * kind (character/location/collection/lore) carries name/createdAt/
 * updatedAt/ownerName uniformly (confirmed against the live API) -- this
 * function is generic over all of them. Items missing the sorted field
 * (e.g. a local collection missing createdAt, or a malformed date string)
 * sort to the end of the list regardless of direction, rather than
 * clustering at whatever position a NaN/undefined comparison would produce.
 * @param {Array<object>} items
 * @param {'name'|'created'|'updated'|'author'} field
 * @param {'asc'|'desc'} direction
 * @returns {Array<object>} a new array; the input is not mutated
 */
export function sortItems(items, field, direction) {
    const key = fieldKey(field);
    const sign = direction === 'desc' ? -1 : 1;
    const withValue = [];
    const withoutValue = [];
    for (const item of items) {
        const value = extractValue(item, key);
        if (value === null) withoutValue.push(item);
        else withValue.push({ item, value });
    }
    withValue.sort((a, b) => sign * compare(a.value, b.value, key));
    return [...withValue.map((w) => w.item), ...withoutValue];
}

function fieldKey(field) {
    if (field === 'created') return 'createdAt';
    if (field === 'updated') return 'updatedAt';
    if (field === 'author') return 'ownerName';
    return 'name';
}

function extractValue(item, key) {
    const raw = item[key];
    if (raw === undefined || raw === null || raw === '') return null;
    if (key === 'createdAt' || key === 'updatedAt') {
        const time = new Date(raw).getTime();
        return Number.isNaN(time) ? null : time;
    }
    return String(raw);
}

function compare(a, b, key) {
    if (key === 'createdAt' || key === 'updatedAt') return a - b;
    return String(a).localeCompare(String(b));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/sortItems.test.js`
Expected: PASS, 9/9

- [ ] **Step 5: Commit**

```bash
git add lib/ui/sortItems.js test/sortItems.test.js
git commit -m "Add sortItems: sort catalog items by name/created/updated/author"
```

---

### Task 2: `buildRevealableFields` — background/secrets field selection

**Files:**
- Modify: `lib/ui/detailFields.js`
- Modify: `test/detailFields.test.js`

**Interfaces:**
- Produces: `buildRevealableFields(record, section)` where `section` is `'background'|'secrets'`,
  returning `Array<{label: string, value: string}>` — same shape as `buildDetailFields`. Consumed
  by Task 5 (`detailPane.js`'s reveal buttons).

- [ ] **Step 1: Write the failing tests**

Append to `test/detailFields.test.js` (after the existing tests, same imports — add
`buildRevealableFields` to the existing import line):

```js
import { formatTags, buildDetailFields, buildRevealableFields } from '../lib/ui/detailFields.js';
```

```js
test('buildRevealableFields background section returns Background and Background Friends, in order', () => {
    const fields = buildRevealableFields({
        knownBackground: 'Raised in rural Sweden.',
        backgroundFriends: 'Sven & Astrid (parents)',
        hiddenBackground: 'Should not appear here',
        secrets: 'Should not appear here',
    }, 'background');
    assert.deepEqual(fields, [
        { label: 'Background', value: 'Raised in rural Sweden.' },
        { label: 'Background Friends', value: 'Sven & Astrid (parents)' },
    ]);
});

test('buildRevealableFields background section omits empty fields', () => {
    const fields = buildRevealableFields({ knownBackground: 'Some history.', backgroundFriends: '' }, 'background');
    assert.deepEqual(fields, [{ label: 'Background', value: 'Some history.' }]);
});

test('buildRevealableFields secrets section returns Hidden Background and Secrets, in order', () => {
    const fields = buildRevealableFields({
        knownBackground: 'Should not appear here',
        hiddenBackground: 'A private history detail.',
        secrets: 'Devours trashy romance novels.',
    }, 'secrets');
    assert.deepEqual(fields, [
        { label: 'Hidden Background', value: 'A private history detail.' },
        { label: 'Secrets', value: 'Devours trashy romance novels.' },
    ]);
});

test('buildRevealableFields secrets section omits empty fields', () => {
    const fields = buildRevealableFields({ hiddenBackground: '', secrets: 'Just this one.' }, 'secrets');
    assert.deepEqual(fields, [{ label: 'Secrets', value: 'Just this one.' }]);
});

test('buildRevealableFields returns [] for an unrecognized section', () => {
    assert.deepEqual(buildRevealableFields({ secrets: 'x' }, 'bogus'), []);
});

test('buildRevealableFields never surfaces backgroundKeywords/secretsKeywords', () => {
    const bg = buildRevealableFields({ knownBackground: 'x', backgroundKeywords: 'rural, sweden' }, 'background');
    assert.equal(bg.some(f => f.value.includes('rural, sweden')), false);
    const sec = buildRevealableFields({ secrets: 'x', secretsKeywords: 'romance, novels' }, 'secrets');
    assert.equal(sec.some(f => f.value.includes('romance, novels')), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/detailFields.test.js`
Expected: FAIL — `buildRevealableFields is not a function` (or similar import error)

- [ ] **Step 3: Write the implementation**

In `lib/ui/detailFields.js`, add after `buildDetailFields`'s closing brace:

```js
/**
 * Selects and formats the two "reveal on demand" field groups for a
 * character's detail view. Deliberately NOT part of buildDetailFields's
 * curated set (see that function's own doc comment for why) -- shown only
 * when the user explicitly clicks a "Show Background/History" or "Show
 * Secrets" button. Field mapping is a deliberate choice, not the only
 * possible one: knownBackground/backgroundFriends are public-flavored
 * background info; hiddenBackground is explicitly named as hidden content,
 * so it groups with secrets (the same spoiler tier) rather than with the
 * public background fields.
 * @param {object} record
 * @param {'background'|'secrets'} section
 * @returns {Array<{label: string, value: string}>}
 */
export function buildRevealableFields(record, section) {
    if (section === 'background') {
        const fields = [];
        if (record.knownBackground) fields.push({ label: 'Background', value: record.knownBackground });
        if (record.backgroundFriends) fields.push({ label: 'Background Friends', value: record.backgroundFriends });
        return fields;
    }
    if (section === 'secrets') {
        const fields = [];
        if (record.hiddenBackground) fields.push({ label: 'Hidden Background', value: record.hiddenBackground });
        if (record.secrets) fields.push({ label: 'Secrets', value: record.secrets });
        return fields;
    }
    return [];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/detailFields.test.js`
Expected: PASS, all tests including the 6 new ones

- [ ] **Step 5: Commit**

```bash
git add lib/ui/detailFields.js test/detailFields.test.js
git commit -m "Add buildRevealableFields for character background/secrets reveal sections"
```

---

### Task 3: `template.html` + `style.css` — bulk bar, sort controls, member list, checkbox styling

**Files:**
- Modify: `template.html`
- Modify: `style.css`

**Interfaces:**
- Produces (DOM ids/classes Task 7/8 wire up):
  `#wreg-sort` (`<select>`, options `value="name"|"created"|"updated"|"author"`),
  `#wreg-sort-direction` (`<button>`, starts with text `▲`),
  `#wreg-bulk-bar` (starts `display:none`), `#wreg-bulk-count`, `#wreg-bulk-activate`,
  `#wreg-bulk-deactivate`, `#wreg-bulk-clear`, class `wreg-row-select` (bulk-select checkbox,
  visually distinct from `wreg-row-toggle`), class `wreg-btn-text` (auto-width modifier for
  `wreg-btn-icon` buttons with text content, e.g. Deactivate/Clear), class
  `wreg-detail-members-list` + `wreg-detail-member-item` (collection member list rows).

No test file — static markup and CSS, matching this repo's existing convention (no test exists for
`template.html`/`style.css` today).

- [ ] **Step 1: Edit `template.html`**

Replace the entire `.wreg-list-header` block (from `<div class="wreg-list-header">` through its
matching closing `</div>`) with:

```html
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
          <select id="wreg-sort" class="wreg-sort-select" title="Sort by">
            <option value="name">Name</option>
            <option value="created">Created</option>
            <option value="updated">Last Updated</option>
            <option value="author">Author</option>
          </select>
          <button type="button" class="wreg-btn-icon" id="wreg-sort-direction" title="Toggle sort direction">&#9650;</button>
          <label class="wreg-toggle-label wreg-filter-toggle" title="Show only currently-active items">
            <input type="checkbox" id="wreg-active-only">
            <span class="wreg-toggle-track"><span class="wreg-toggle-thumb"></span></span>
            <span class="wreg-toggle-text">Active only</span>
          </label>
          <button type="button" class="wreg-btn-primary" id="wreg-new-collection-btn" style="display:none;">+ New Collection</button>
        </div>
        <div class="wreg-bulk-bar" id="wreg-bulk-bar" style="display:none;">
          <span class="wreg-bulk-count" id="wreg-bulk-count">0 selected</span>
          <button type="button" class="wreg-btn-primary" id="wreg-bulk-activate">Activate</button>
          <button type="button" class="wreg-btn-icon wreg-btn-text" id="wreg-bulk-deactivate">Deactivate</button>
          <button type="button" class="wreg-btn-icon wreg-btn-text" id="wreg-bulk-clear">Clear</button>
        </div>
      </div>
```

- [ ] **Step 2: Edit `style.css`**

Add after the existing `.wreg-row-toggle { flex-shrink: 0; }` rule (around line 353-355):

```css
.wreg-row-select {
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    cursor: pointer;
    accent-color: var(--wreg-text-accent-bright);
}

.wreg-sort-select {
    padding: 5px 6px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 5px;
    color: var(--wreg-text);
    font-family: var(--wreg-font);
    font-size: 11px;
    flex-shrink: 0;
}

.wreg-sort-select option:disabled {
    color: var(--wreg-text-muted);
}

.wreg-btn-text {
    width: auto;
    padding: 0 10px;
}

.wreg-bulk-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-top: 8px;
    margin-top: 4px;
    border-top: 1px solid rgba(180, 38, 58, 0.15);
}

.wreg-bulk-count {
    font-size: 11px;
    color: var(--wreg-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-right: 4px;
}

.wreg-detail-members-list {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
}

.wreg-detail-member-item {
    font-size: 11px;
    color: var(--wreg-text);
    padding: 3px 6px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 4px;
}
```

Also add `.wreg-sort-select` to the existing `:focus-visible` selector list (around line 108-114),
changing:

```css
.wreg-btn-icon:focus-visible,
.wreg-btn-primary:focus-visible,
.wreg-tab:focus-visible,
.wreg-search:focus-visible,
.wreg-item-row:focus-visible,
.wreg-form-field input[type="text"]:focus-visible,
.wreg-toggle-label input[type="checkbox"]:focus-visible + .wreg-toggle-track {
```

to:

```css
.wreg-btn-icon:focus-visible,
.wreg-btn-primary:focus-visible,
.wreg-tab:focus-visible,
.wreg-search:focus-visible,
.wreg-sort-select:focus-visible,
.wreg-item-row:focus-visible,
.wreg-form-field input[type="text"]:focus-visible,
.wreg-toggle-label input[type="checkbox"]:focus-visible + .wreg-toggle-track {
```

- [ ] **Step 3: Verify no syntax errors**

Run: `node -e "require('fs').readFileSync('template.html', 'utf8'); console.log('template.html readable')"`
Run: `node -e "require('fs').readFileSync('style.css', 'utf8'); console.log('style.css readable')"`
(These are trivial existence/readability checks — real verification is Task 9's live Playwright
pass, since this is markup/CSS with no JS to unit test.)

- [ ] **Step 4: Commit**

```bash
git add template.html style.css
git commit -m "Add bulk-action-bar, sort controls, and member-list markup/styling"
```

---

### Task 4: Collection member list — bug fix + list rendering

**Files:**
- Modify: `index.js`
- Modify: `lib/ui/detailPane.js`

**Interfaces:**
- Consumes: `resolveCollectionMembers(collectionRecord, catalog)` from `lib/collectionResolver.js`
  (already imported in `index.js`).

- [ ] **Step 1: Fix `getItemDetail`'s collection branch in `index.js`**

Find this line inside `getItemDetail`'s `if (routingKind === 'collection')` block:

```js
            const memberKeys = resolvedCollections[key]?.memberKeys ?? [];
```

Replace it with:

```js
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
```

- [ ] **Step 2: Render members as a list instead of a comma-joined line, in `detailPane.js`**

Find this block in `renderDetailPane`:

```js
    if (detail.memberNames && detail.memberNames.length) {
        appendField(container, 'Members', detail.memberNames.join(', '));
    }
```

Replace it with:

```js
    if (detail.memberNames && detail.memberNames.length) {
        appendMembersList(container, detail.memberNames);
    }
```

Add this new function after the existing `appendField` function (at the end of the file):

```js
function appendMembersList(container, memberNames) {
    const field = document.createElement('div');
    field.className = 'wreg-detail-field';
    const labelEl = document.createElement('div');
    labelEl.className = 'wreg-detail-field-label';
    labelEl.textContent = 'Members';
    field.appendChild(labelEl);
    const list = document.createElement('ul');
    list.className = 'wreg-detail-members-list';
    for (const name of memberNames) {
        const item = document.createElement('li');
        item.className = 'wreg-detail-member-item';
        item.textContent = name;
        list.appendChild(item);
    }
    field.appendChild(list);
    container.appendChild(field);
}
```

- [ ] **Step 3: Verify by reading**

No test file exists for `index.js` or `detailPane.js` (DOM/ST-context-dependent orchestration,
matching this codebase's existing convention — verified via live Playwright in Task 9 instead). Run
the existing full suite to confirm nothing else broke:

Run: `node --test 'test/**/*.test.js'`
Expected: PASS, same count as before this task (this task adds no new unit tests)

- [ ] **Step 4: Commit**

```bash
git add index.js lib/ui/detailPane.js
git commit -m "Fix collection member list: resolve members for never-toggled registrar collections; render as a list"
```

---

### Task 5: "Show Background/History" / "Show Secrets" buttons

**Files:**
- Modify: `lib/ui/detailPane.js`

**Interfaces:**
- Consumes: `buildRevealableFields(record, section)` from Task 2.

- [ ] **Step 1: Add reveal-section state and rendering to `detailPane.js`**

At the top of the file, change the import line:

```js
import { buildDetailFields } from './detailFields.js';
```

to:

```js
import { buildDetailFields, buildRevealableFields } from './detailFields.js';
```

Add a module-level state variable right after the import:

```js
// Tracks whether the two reveal sections are expanded, keyed to the item
// currently being viewed -- reset when the viewed item changes, but
// preserved across a re-render of the SAME item (e.g. clicking
// Activate/Deactivate re-renders the same detail; without this, expanding
// Background/History and then toggling activation would immediately
// collapse it again).
let revealState = { itemKey: null, background: false, secrets: false };
```

At the top of `renderDetailPane`, right after `container.innerHTML = '';`, add:

```js
    if (revealState.itemKey !== detail.itemKey) {
        revealState = { itemKey: detail.itemKey, background: false, secrets: false };
    }
```

Find this block (the curated-fields loop):

```js
    for (const field of buildDetailFields(detail.record, detail.kind)) {
        appendField(container, field.label, field.value);
    }
```

Add immediately after it:

```js
    if (detail.kind === 'character') {
        appendRevealSection(container, detail.record, 'background', 'Background/History', revealState);
        appendRevealSection(container, detail.record, 'secrets', 'Secrets', revealState);
    }
```

Add this new function after `appendMembersList` (added in Task 4) at the end of the file:

```js
function appendRevealSection(container, record, section, buttonLabel, state) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'wreg-btn-icon wreg-btn-text';
    button.style.marginBottom = '8px';
    button.textContent = (state[section] ? 'Hide ' : 'Show ') + buttonLabel;
    container.appendChild(button);

    const fieldsContainer = document.createElement('div');
    fieldsContainer.style.display = state[section] ? '' : 'none';
    for (const field of buildRevealableFields(record, section)) {
        appendField(fieldsContainer, field.label, field.value);
    }
    container.appendChild(fieldsContainer);

    button.addEventListener('click', () => {
        state[section] = !state[section];
        button.textContent = (state[section] ? 'Hide ' : 'Show ') + buttonLabel;
        fieldsContainer.style.display = state[section] ? '' : 'none';
    });
}
```

- [ ] **Step 2: Verify by reading**

No test file exists for `detailPane.js` (matches existing convention — verified via live
Playwright in Task 9). Run the existing full suite to confirm nothing else broke:

Run: `node --test 'test/**/*.test.js'`
Expected: PASS, same count as before this task

- [ ] **Step 3: Commit**

```bash
git add lib/ui/detailPane.js
git commit -m "Add Show Background/History and Show Secrets reveal buttons to character detail view"
```

---

### Task 6: `handleBulkToggle` — batched bulk activation in `index.js`

**Files:**
- Modify: `index.js`

**Interfaces:**
- Consumes: `classifyItemKey`, `settings`, `catalog`, `syncBooks`, `ensureSandbox`,
  `activateScenario`, `deactivateScenario`, `getStContext` (all already in scope inside
  `initModal`).
- Produces: `handleBulkToggle(itemKeys, makeActive)`, an `async function` nested inside
  `initModal`'s closure (same scope as `handleToggle`). Consumed by Task 8 (wired into `openModal`'s
  state object as `onBulkActivate`/`onBulkDeactivate`).

- [ ] **Step 1: Add `handleBulkToggle` to `index.js`**

Insert this new function immediately after `handleToggle`'s closing brace (before the
`getItemDetail` function), still inside `initModal(settings)`:

```js

    /**
     * Batched version of handleToggle for the bulk-selection action bar.
     * Mutates every selected item/collection's state synchronously first,
     * then calls syncBooks exactly once -- looping handleToggle here instead
     * would call syncBooks once per selected item, needlessly rebuilding the
     * shared roster/location-list entries (and the single consolidated
     * Character Roster entry Weyland-WeyPhone depends on) N times instead of
     * once. Lore/scenario items are the one exception: each owns a separate,
     * uniquely-named book with nothing shared to batch, so they still
     * activate individually, run concurrently via Promise.all rather than
     * sequentially.
     * @param {Array<string>} itemKeys
     * @param {boolean} makeActive
     */
    async function handleBulkToggle(itemKeys, makeActive) {
        const loreKeys = [];
        let needsSync = false;

        for (const itemKey of itemKeys) {
            const kind = classifyItemKey(itemKey);
            if (kind === 'lore') {
                loreKeys.push(itemKey);
            } else if (kind === 'collection') {
                const key = String(itemKey);
                const existing = settings.collections[key];
                settings.collections[key] = {
                    active: makeActive,
                    source: existing?.source ?? (settings.localCollections[key] ? 'local' : 'registrar'),
                };
                needsSync = true;
            } else {
                settings.itemStates[itemKey] = makeActive ? 'active' : 'inactive';
                needsSync = true;
            }
        }

        const stContext = getStContext();
        const loreWork = Promise.all(loreKeys.map(async (itemKey) => {
            const loreId = String(itemKey).slice('lore:'.length);
            const loreRecord = catalog.lore.find((l) => String(l.loreId) === loreId);
            if (!loreRecord) return;
            settings.scenarioBooks[loreId] = { ...(settings.scenarioBooks[loreId] ?? {}), active: makeActive };
            if (makeActive) {
                const sandbox = await ensureSandbox(settings);
                await activateScenario(stContext, sandbox.callFunction, settings, loreRecord);
            } else {
                await deactivateScenario(stContext, settings, loreRecord);
            }
        }));

        await Promise.all([needsSync ? syncBooks(settings) : Promise.resolve(), loreWork]);
        stContext.saveSettingsDebounced();
    }
```

- [ ] **Step 2: Verify by reading**

No test file exists for `index.js` (matches existing convention). This function cannot be
meaningfully live-tested until Task 8 wires it into the UI — verify correctness now by tracing it
by hand against `handleToggle`'s already-reviewed equivalent per-kind branches (the
`item`/`collection` mutations here are byte-for-byte the same assignments `handleToggle` already
makes) and confirm the full suite still passes:

Run: `node --test 'test/**/*.test.js'`
Expected: PASS, same count as before this task

- [ ] **Step 3: Commit**

```bash
git add index.js
git commit -m "Add handleBulkToggle: batched activate/deactivate for the bulk-selection action bar"
```

---

### Task 7: `itemList.js` — bulk-select checkbox

**Files:**
- Modify: `lib/ui/itemList.js`

**Interfaces:**
- Produces: `renderItemList`'s handlers object gains `onToggleSelect: (itemKey) => void` and
  `isSelected: (itemKey) => boolean`. Consumed by Task 8 (`modal.js`'s `renderCurrentTab`).

- [ ] **Step 1: Add the bulk-select checkbox to `itemList.js`**

Update the JSDoc on `renderItemList` — change:

```js
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
```

to:

```js
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
 *   resolveForced: (itemKey: string) => 'none'|'active'|'inactive',
 *   isSelected: (itemKey: string) => boolean,
 * }} handlers
 */
```

Find this block (right after the `row.setAttribute('role', 'button');` line, before
`const main = document.createElement('div');`):

```js
        const main = document.createElement('div');
        main.className = 'wreg-item-row-main';
```

Insert immediately before it:

```js
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

```

- [ ] **Step 2: Verify by reading**

No test file exists for `itemList.js` (matches existing convention — verified via live Playwright
in Task 9). Run the existing full suite to confirm nothing else broke:

Run: `node --test 'test/**/*.test.js'`
Expected: PASS, same count as before this task

- [ ] **Step 3: Commit**

```bash
git add lib/ui/itemList.js
git commit -m "Add bulk-select checkbox to itemList.js rows"
```

---

### Task 8: `modal.js` wiring + `index.js` state — bulk selection, sort application

**Files:**
- Modify: `lib/ui/modal.js`
- Modify: `index.js`

**Interfaces:**
- Consumes: `sortItems` (Task 1), `onToggleSelect`/`isSelected` handler contract (Task 7),
  `handleBulkToggle` (Task 6, exposed as `onBulkActivate`/`onBulkDeactivate`).

This is the integration task wiring every prior task together. No test file — DOM wiring, matching
this codebase's existing convention. Verified live in Task 9.

- [ ] **Step 1: Import `sortItems` and add module-level selection state in `modal.js`**

Change the import block at the top of `modal.js` from:

```js
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
```

to:

```js
import { renderItemList } from './itemList.js';
import { renderDetailPane } from './detailPane.js';
import { renderCollectionForm } from './collectionForm.js';
import { parseSearchTerms, matchesTerms } from '../filterQuery.js';
import { resolveExtensionBasePath } from '../location.js';
import { clampPosition, isMobileLayout, attachDragHandle, attachViewportReclamp } from './dragResize.js';
import { sortItems } from './sortItems.js';

let portalElement = null;
let modalReadyPromise = null;
let currentState = null;
let dragHandle = null;
let reclampHandle = null;
// Per-tab bulk-selection state -- cleared on every tab switch (see the tab
// click handler in buildModalElement), preserved through search/active-only
// filter changes within the same tab.
let selectedKeys = new Set();
```

- [ ] **Step 2: Update `openModal`'s JSDoc to document the two new state fields**

Find this block in the `@param` JSDoc on `openModal`:

```js
 *   onUpdateLocalCollectionMembers: (itemKey: string, memberKeys: string[]) => void,
 *   onDeleteLocalCollection: (itemKey: string) => void,
 * }} state - `getItemDetail`'s return is `detailPane.js`'s own `ItemDetail`
```

Replace with:

```js
 *   onUpdateLocalCollectionMembers: (itemKey: string, memberKeys: string[]) => void,
 *   onDeleteLocalCollection: (itemKey: string) => void,
 *   onBulkActivate: (itemKeys: string[]) => void,
 *   onBulkDeactivate: (itemKeys: string[]) => void,
 * }} state - `getItemDetail`'s return is `detailPane.js`'s own `ItemDetail`
```

- [ ] **Step 3: Wire the tab-click handler to clear selection and update sort-option availability**

Find this block in `buildModalElement`:

```js
    portal.querySelectorAll('.wreg-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            portal.querySelectorAll('.wreg-tab').forEach((t) => t.classList.remove('wreg-tab-active'));
            tab.classList.add('wreg-tab-active');
            portal.querySelector('#wreg-new-collection-btn').style.display = tab.dataset.type === 'local' ? '' : 'none';
            renderCurrentTab(tab.dataset.type);
        });
    });
```

Replace with:

```js
    portal.querySelectorAll('.wreg-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            portal.querySelectorAll('.wreg-tab').forEach((t) => t.classList.remove('wreg-tab-active'));
            tab.classList.add('wreg-tab-active');
            portal.querySelector('#wreg-new-collection-btn').style.display = tab.dataset.type === 'local' ? '' : 'none';
            // Bulk selection is scoped to the tab you made it on -- switching
            // tabs clears it (see this module's top-of-file selectedKeys doc).
            selectedKeys.clear();
            updateBulkBar();
            updateSortOptionsForTab(tab.dataset.type);
            renderCurrentTab(tab.dataset.type);
        });
    });
```

- [ ] **Step 4: Wire the bulk-bar buttons and sort controls**

Find this block in `buildModalElement` (the existing control wiring, right before
`portalElement = portal;`):

```js
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
```

Replace with:

```js
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
    portal.querySelector('#wreg-bulk-activate').addEventListener('click', () => {
        currentState.onBulkActivate([...selectedKeys]);
        selectedKeys.clear();
        updateBulkBar();
        renderCurrentTab(currentTabType());
    });
    portal.querySelector('#wreg-bulk-deactivate').addEventListener('click', () => {
        currentState.onBulkDeactivate([...selectedKeys]);
        selectedKeys.clear();
        updateBulkBar();
        renderCurrentTab(currentTabType());
    });
    portal.querySelector('#wreg-bulk-clear').addEventListener('click', () => {
        selectedKeys.clear();
        updateBulkBar();
        renderCurrentTab(currentTabType());
    });
    portal.querySelector('#wreg-sort').addEventListener('change', (event) => {
        portal.dataset.sortField = event.target.value;
        renderCurrentTab(currentTabType());
    });
    portal.querySelector('#wreg-sort-direction').addEventListener('click', () => {
        const next = (portal.dataset.sortDirection ?? 'asc') === 'asc' ? 'desc' : 'asc';
        portal.dataset.sortDirection = next;
        portal.querySelector('#wreg-sort-direction').textContent = next === 'asc' ? '▲' : '▼';
        renderCurrentTab(currentTabType());
    });

    portalElement = portal;
    return window_;
```

- [ ] **Step 5: Add `updateBulkBar` and `updateSortOptionsForTab` helper functions**

Add these two new functions after `setView` (right before `updateDragResizeForLayout`):

```js
function updateBulkBar() {
    const bar = portalElement.querySelector('#wreg-bulk-bar');
    const count = portalElement.querySelector('#wreg-bulk-count');
    if (selectedKeys.size > 0) {
        bar.style.display = '';
        count.textContent = `${selectedKeys.size} selected`;
    } else {
        bar.style.display = 'none';
    }
}

/**
 * Local collections carry none of createdAt/updatedAt/ownerName (they are
 * user-created, never fetched from the Registrar) -- while the "My Local
 * Collections" tab is active, disable the sort <option>s that don't apply
 * and show "Name" as selected in the control, WITHOUT touching the actual
 * stored sortField preference (portal.dataset.sortField), so switching back
 * to any other tab resumes the user's real choice untouched.
 * @param {string} type
 */
function updateSortOptionsForTab(type) {
    const isLocal = type === 'local';
    portalElement.querySelectorAll('#wreg-sort option').forEach((option) => {
        if (option.value !== 'name') option.disabled = isLocal;
    });
    const select = portalElement.querySelector('#wreg-sort');
    const storedField = portalElement.dataset.sortField ?? 'name';
    select.value = isLocal && storedField !== 'name' ? 'name' : storedField;
}
```

- [ ] **Step 6: Apply sort and wire bulk-select handlers in `renderCurrentTab`**

Find `renderCurrentTab`'s full current body:

```js
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
```

Replace it with:

```js
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

    // Local collections have no createdAt/updatedAt/ownerName -- fall back to
    // name/asc for this render only when on that tab, without touching the
    // stored preference (see updateSortOptionsForTab's own doc).
    const storedSortField = portalElement.dataset.sortField ?? 'name';
    const sortField = type === 'local' && storedSortField !== 'name' ? 'name' : storedSortField;
    const sortDirection = portalElement.dataset.sortDirection ?? 'asc';
    filtered = sortItems(filtered, sortField, sortDirection);

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
        onToggleSelect: (itemKey) => {
            if (selectedKeys.has(itemKey)) selectedKeys.delete(itemKey);
            else selectedKeys.add(itemKey);
            updateBulkBar();
        },
        resolveActive: currentState.resolveActive,
        resolveForced: currentState.resolveForced,
        isSelected: (itemKey) => selectedKeys.has(itemKey),
    });
}
```

- [ ] **Step 7: Wire `onBulkActivate`/`onBulkDeactivate` into `index.js`'s `openModal` call**

In `index.js`, find this block inside the `openModal({...})` call:

```js
        onCreateLocalCollection,
        onRenameLocalCollection,
        onUpdateLocalCollectionMembers,
        onDeleteLocalCollection,
    });
```

Replace with:

```js
        onCreateLocalCollection,
        onRenameLocalCollection,
        onUpdateLocalCollectionMembers,
        onDeleteLocalCollection,
        onBulkActivate: (itemKeys) => handleBulkToggle(itemKeys, true),
        onBulkDeactivate: (itemKeys) => handleBulkToggle(itemKeys, false),
    });
```

- [ ] **Step 8: Verify by reading**

No test file exists for `modal.js` (matches existing convention — verified via live Playwright in
Task 9). Run the existing full suite to confirm nothing else broke:

Run: `node --test 'test/**/*.test.js'`
Expected: PASS, same count as before this task (Tasks 1 and 2 added tests; this task adds none)

- [ ] **Step 9: Commit**

```bash
git add lib/ui/modal.js index.js
git commit -m "Wire bulk selection, bulk activate/deactivate, and sort into modal.js"
```

---

### Task 9: Live Playwright verification (desktop + mobile)

Not delegated to a subagent — executed directly against the real deployment (LAN IP, HTTP Basic
Auth), matching how the prior UI redesign's own final verification task (UI-9) was done. This is
the only real functional test for every DOM-wiring task above (3, 4 partially, 5, 6 partially, 7,
8).

**Desktop checklist:**
- [ ] Sort control: switching between Name/Created/Updated/Author actually reorders the visible
  list; the direction toggle button flips the order and its own glyph (▲/▼).
- [ ] Sort persists across a tab switch (e.g. set Author/desc on Characters, switch to Locations,
  confirm Locations is also sorted by Author/desc).
- [ ] Sort by Created/Updated/Author actually reorders the list on the Collections tab AND the Lore
  tab specifically (not just Characters/Locations) — regression check for the bug where
  `getItemsForType` projected these two tabs down to `{itemKey, name, summary}`, silently dropping
  `createdAt`/`updatedAt`/`ownerName` so every sort on those tabs was a no-op with no error/feedback.
- [ ] On the "My Local Collections" tab, the Created/Updated/Author `<option>`s are disabled and
  the control shows "Name"; switching back to another tab restores the previously-chosen
  field/direction.
- [ ] Bulk-select checkboxes appear on every tab; checking one shows the bulk bar with the correct
    count; the bulk-select checkbox visually reads as distinct from the activate toggle switch.
- [ ] Clicking a bulk-select checkbox does NOT open the detail view (isolation from row-click) and
    does NOT change the row's activation state.
- [ ] Selecting several characters, clicking bulk Activate, activates all of them in one action;
    confirm via ground-truth `extensionSettings` read (not just DOM) that `itemStates` was updated
    for every selected key and `syncBooks` ran (both managed World Info books reflect every newly
    active character/location).
- [ ] Bulk Deactivate on a mixed selection (characters + a collection + a lore item) correctly
    deactivates every kind through its own mechanism (itemStates for items, settings.collections for
    the collection, settings.scenarioBooks/deactivateScenario for the lore item).
- [ ] Bulk Clear empties the selection and hides the bulk bar without changing any activation state.
- [ ] Switching tabs clears the selection (bulk bar disappears); search text and the active-only
    filter do NOT clear an existing selection within the same tab.
- [ ] Opening a REGISTRAR-native collection's detail view that has never been toggled shows its
    correct Members list (the bug this plan fixes) — verify against a real, never-before-activated
    collection on the live server.
- [ ] Members render as a visually distinct list (one name per row), not a comma-joined line.
- [ ] A character's detail view shows "Show Background/History" and "Show Secrets" buttons; clicking
    each reveals the correct fields (Background/Background Friends; Hidden Background/Secrets) with
    correct labels and content matching the raw Registrar record; clicking again hides them and the
    button label flips back to "Show ...".
- [ ] Expanding Background/History, then clicking Activate/Deactivate on the same character (detail
    pane button), does NOT collapse the reveal section; switching to a different character's detail
    and back DOES reset both sections to collapsed.
- [ ] A location's or collection's detail view does NOT show the reveal buttons (character-only).

**Mobile checklist (390×844 viewport, `hasTouch`/`isMobile` context):**
- [ ] Sort control and bulk bar are usable at mobile width (not clipped/overlapping) and the bulk
    bar appears correctly above the full-screen list.
- [ ] Bulk-select checkboxes are tappable and correctly isolated from opening detail on mobile touch
    interaction, matching desktop's isolation behavior.
- [ ] Reveal buttons work correctly in the mobile full-screen detail view; content doesn't overflow
    the viewport.

**On completion:**
- [ ] Update `.superpowers/sdd/progress.md` with a Task 9 entry documenting what was verified, any
    bugs found and fixed, and confirmation that all test-touched live settings state (itemStates,
    collections, localCollections, scenarioBooks) was reset back to clean afterward.
- [ ] If any bug is found, fix-and-re-verify before considering this task/plan complete, matching
    every other task's review-loop discipline in this codebase.
