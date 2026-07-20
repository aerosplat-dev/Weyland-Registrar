# Weyland-Registrar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a SillyTavern extension that browses registrar.weybooru.com's characters, locations, collections, and lore/scenarios, and keeps two extension-owned World Info lorebooks (plus one dedicated lorebook per activated scenario) in sync with what the user activates — no manual `.json` download/import ever required.

**Architecture:** Pure, unit-tested logic modules (activation-state resolution, uid assignment, roster-text building, search/filter parsing, collection resolution) sit underneath a thin data layer (Registrar API client + IndexedDB catalog cache) and a sandboxed entry-construction layer (a hidden, permission-stripped iframe that loads and executes the Registrar's own `base.js` entry-building functions). A World Info writer orchestrates all of this against SillyTavern's `getContext()` surface. A bespoke modal, opened from a new World Info panel toolbar button, is the only UI surface.

**Tech Stack:** Vanilla JS (ES modules, no bundler — house convention), `node --test` for unit tests, SillyTavern's `getContext()` API, browser `IndexedDB`, a sandboxed `<iframe sandbox="allow-scripts">`.

## Global Constraints

- **No hardcoded extension-location paths anywhere.** The extension must run unmodified whether installed at `data/<user>/extensions/Weyland-Registrar/` or `public/scripts/extensions/Weyland-Registrar/`. Every location-relative string (settings-template prefix, etc.) is derived from `import.meta.url` at runtime — never hardcode `'third-party/Weyland-Registrar'` or assume a fixed relative import depth into core.
- **No internal/relative imports of SillyTavern core files.** Every World Info operation goes through `getContext()` (`loadWorldInfo`, `saveWorldInfo`, `updateWorldInfoList`, `executeSlashCommandsWithOptions`) — confirmed sufficient; this sidesteps the bundled-vs-third-party relative-depth hazard entirely.
- **Required write→refresh sequence, never reordered:** `saveWorldInfo(name, data, true)` → `updateWorldInfoList()` → `executeSlashCommandsWithOptions('/world state=on silent=true "<name>"')`.
- **Exactly one `"Character Roster"` entry (uid `5000`) and one `"Location List"` entry (uid `8000`) per shared managed book, always fully regenerated (never patched) from the complete current active set on every add/remove.** This is required for `Weyland-WeyPhone/lib/registrarLorebook.js` to keep working (it `.find()`s the first matching roster entry only).
- **`keysecondary` differs per entry within a character's cluster and must never be flattened to one shared trigger set:** empty on the main INFO and End Section entries; the character's own `backgroundKeywords` on Backstory/History; the character's own `secretsKeywords` on Secrets; fixed strings (`dorm`, `apartment`, `home`, `room`, `<name>'s room`) plus `dwelling`-derived keywords on Dorm room/Housing.
- **uid schemes:** characters use `characterId*5 + 5001..5005` (reproduces the Registrar's own scheme exactly, deterministic, collision-free). Locations use `8001 + locationId*20 + subIndex` (a scheme this extension owns, since the Registrar's own location uids are just an export-time counter).
- **Entry *content* construction is delegated to the Registrar's own live `base.js` functions**, executed inside a hidden `<iframe sandbox="allow-scripts">` (deliberately without `allow-same-origin`) so a compromised script cannot reach SillyTavern's DOM, cookies, or session — only whatever is explicitly passed in via `postMessage`. This was a deliberate, discussed choice (see spec §6, §12) — do not "simplify" it back to a hand-ported static copy without checking with the user first.
- **Roster/location-list line-and-wrapper text is hand-ported** (`buildLoreBook()`/`buildWorldBook()` themselves are DOM-dependent and reflect the site's live filtered selection, not our persisted active set — there is no separately-callable pure function for just this piece). Header/footer text is `[CHARACTER ROSTER]`/`[END CHARACTER ROSTER]` and `[LOCATIONS]`/`[END LOCATIONS]` — plain, no page-specific suffix — confirmed safe because `Weyland-WeyPhone/lib/registrarLorebook.js` matches via the lenient regex `/\[CHARACTER ROSTER\b/i`.
- **CORS:** `/data/list` is fetched directly (has `Access-Control-Allow-Origin: *`). `/loci/list`, `/coll/list`, `/lore/list` use a **two-tier, direct-first** strategy: attempt a direct fetch first (so the extension automatically stops needing a proxy the moment the Registrar adds CORS headers, with zero code changes), and only fall back — on the fetch call itself throwing, not merely a resolved bad-status response — to SillyTavern's own proxy: `fetch('/proxy/' + fullTargetUrl, { credentials: 'include' })` — confirmed from `src/middleware/corsProxy.js` and `src/server-main.js:131` (`app.use('/proxy/:url(*)', corsProxyMiddleware)`), the target URL is appended raw, not encoded. Requires `enableCorsProxy: true` in `config.yaml`, already this fork's default. Deliberately does not chain further into third-party public CORS proxies (confirmed with the user) the way `weyland_dorms.html` does.
- **Activation resolution (tri-state per item, always in this priority order):** `forced-inactive` → inactive, full stop. Else `forced-active` → active. Else member of ≥1 currently-active collection → active. Else inactive. Deactivating/activating a collection only touches that collection's own flag and recomputes affected members — it never touches another collection's flag and never overrides a `forced-*` flag on a member.
- **Collections (Registrar or local) are never a third storage location.** They resolve to character IDs + location IDs, which get merged into the two shared managed books. Never bundle characters and locations together the way the Registrar's own collection downloads do.
- Extension name: `Weyland-Registrar`. `MODULE_NAME` constant = `'Weyland-Registrar'`, used as both the `extensionSettings` key and log-tag prefix, per house convention.
- No build tooling beyond a minimal `package.json` containing only `{"type": "module"}` (enables native ESM + `node --test`; no bundler, no lint config, no dependencies) — matches house convention of first-party Weyland extensions shipping raw, unbundled JS.

---

## Task 1: Extension scaffold + path-independence resolver

**Files:**
- Create: `manifest.json`
- Create: `package.json`
- Create: `lib/location.js`
- Test: `test/location.test.js`

**Interfaces:**
- Produces: `resolveExtensionBasePath(metaUrl: string): string` — used by every later task that needs a location-relative path (e.g. `renderExtensionTemplateAsync` prefix in Task 17).

- [ ] **Step 1: Write the failing test**

```js
// test/location.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveExtensionBasePath } from '../lib/location.js';

test('resolves base path for a third-party (nested-repo) install', () => {
    const metaUrl = 'http://localhost:8000/scripts/extensions/third-party/Weyland-Registrar/lib/location.js';
    assert.equal(resolveExtensionBasePath(metaUrl), 'third-party/Weyland-Registrar');
});

test('resolves base path for a bundled install', () => {
    const metaUrl = 'http://localhost:8000/scripts/extensions/Weyland-Registrar/lib/location.js';
    assert.equal(resolveExtensionBasePath(metaUrl), 'Weyland-Registrar');
});

test('resolves base path for a nested module (lib/ui/toolbarButton.js)', () => {
    const metaUrl = 'http://localhost:8000/scripts/extensions/third-party/Weyland-Registrar/lib/ui/toolbarButton.js';
    assert.equal(resolveExtensionBasePath(metaUrl), 'third-party/Weyland-Registrar');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/location.test.js`
Expected: FAIL — `lib/location.js` does not exist yet (`Cannot find module`).

- [ ] **Step 3: Write minimal implementation**

```js
// lib/location.js

/**
 * Derives this extension's own SillyTavern-relative base path (e.g.
 * "third-party/Weyland-Registrar" or "Weyland-Registrar") from a module's
 * import.meta.url, regardless of how deeply nested that module is under lib/.
 * @param {string} metaUrl - import.meta.url of any module inside this extension
 * @returns {string}
 */
export function resolveExtensionBasePath(metaUrl) {
    const url = new URL(metaUrl);
    const match = url.pathname.match(/^\/scripts\/extensions\/(.*?\/Weyland-Registrar)\//);
    if (!match) {
        throw new Error(`Could not resolve Weyland-Registrar base path from: ${url.pathname}`);
    }
    return match[1];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/location.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Create manifest.json and package.json**

```json
// manifest.json
{
    "display_name": "Weyland-Registrar",
    "loading_order": 150,
    "requires": [],
    "optional": [],
    "js": "index.js",
    "css": "style.css",
    "author": "weyland-tavern",
    "version": "1.0.0",
    "homePage": "https://github.com/SillyTavern/SillyTavern",
    "auto_update": false
}
```

```json
// package.json
{
    "name": "weyland-registrar",
    "private": true,
    "type": "module"
}
```

- [ ] **Step 6: Commit**

```bash
git add manifest.json package.json lib/location.js test/location.test.js
git commit -m "Scaffold extension with path-independent location resolver"
```

---

## Task 2: Settings module

**Files:**
- Create: `lib/settings.js`
- Test: `test/settings.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `MODULE_NAME: string`, `defaultSettings: object`, `getSettings(extensionSettings: object): object` — every later task that reads/writes persisted state calls `getSettings()` first and operates on the returned object.

- [ ] **Step 1: Write the failing test**

```js
// test/settings.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_NAME, defaultSettings, getSettings } from '../lib/settings.js';

test('creates default settings on first use', () => {
    const extensionSettings = {};
    const settings = getSettings(extensionSettings);
    assert.deepEqual(settings, defaultSettings);
    assert.equal(extensionSettings[MODULE_NAME], settings);
});

test('backfills newly-added keys without clobbering existing values', () => {
    const extensionSettings = {
        [MODULE_NAME]: { apiBaseUrl: 'https://custom.example.com' },
    };
    const settings = getSettings(extensionSettings);
    assert.equal(settings.apiBaseUrl, 'https://custom.example.com');
    assert.equal(settings.refreshIntervalMinutes, defaultSettings.refreshIntervalMinutes);
});

test('nested default objects are independent per extensionSettings instance', () => {
    const a = getSettings({});
    const b = getSettings({});
    a.itemStates['char:1'] = 'active';
    assert.equal(b.itemStates['char:1'], undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/settings.test.js`
Expected: FAIL — `lib/settings.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/settings.js

export const MODULE_NAME = 'Weyland-Registrar';

/**
 * @typedef {Object} WeylandRegistrarSettings
 * @property {string} apiBaseUrl
 * @property {number} refreshIntervalMinutes
 * @property {Object.<string, 'active'|'inactive'>} itemStates - itemKey -> forced override
 * @property {Object.<string, {active: boolean, source: 'registrar'|'local'}>} collections
 * @property {Object.<string, {name: string, memberKeys: string[]}>} localCollections
 * @property {Object.<string, {book: string, active: boolean}>} scenarioBooks - loreId -> book state
 */
export const defaultSettings = {
    apiBaseUrl: 'https://registrar.weybooru.com',
    refreshIntervalMinutes: 60,
    itemStates: {},
    collections: {},
    localCollections: {},
    scenarioBooks: {},
};

/**
 * Ensures extensionSettings[MODULE_NAME] exists and has every current default key,
 * without overwriting any existing value. Returns the (possibly newly-created) settings object.
 * @param {object} extensionSettings - SillyTavern's global extensionSettings object
 * @returns {WeylandRegistrarSettings}
 */
export function getSettings(extensionSettings) {
    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }
    const settings = extensionSettings[MODULE_NAME];
    for (const key in defaultSettings) {
        if (settings[key] === undefined) {
            settings[key] = structuredClone(defaultSettings[key]);
        }
    }
    return settings;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/settings.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/settings.js test/settings.test.js
git commit -m "Add settings module with default-backfill pattern"
```

---

## Task 3: Activation state resolution

**Files:**
- Create: `lib/activationState.js`
- Test: `test/activationState.test.js`

**Interfaces:**
- Consumes: `itemStates: Object.<string, 'active'|'inactive'>` (from settings), `collections: Object.<string, {active: boolean, memberKeys: string[]}>` (caller must have already resolved `memberKeys` — via Task 8 for Registrar collections or directly from `localCollections` for local ones).
- Produces: `resolveItemActive(itemKey, itemStates, collections): boolean`, `resolveAllActive(itemKeys, itemStates, collections): Set<string>`. Task 13 (World Info writer) calls `resolveAllActive` to determine the full active set before rebuilding a managed book.

- [ ] **Step 1: Write the failing test**

```js
// test/activationState.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveItemActive, resolveAllActive } from '../lib/activationState.js';

test('unset item with no collections is inactive', () => {
    assert.equal(resolveItemActive('char:1', {}, {}), false);
});

test('forced-active wins with no collections', () => {
    assert.equal(resolveItemActive('char:1', { 'char:1': 'active' }, {}), true);
});

test('member of an active collection is active', () => {
    const collections = { c1: { active: true, memberKeys: ['char:1', 'char:2'] } };
    assert.equal(resolveItemActive('char:1', {}, collections), true);
    assert.equal(resolveItemActive('char:3', {}, collections), false);
});

test('member of an inactive collection is not active from that collection alone', () => {
    const collections = { c1: { active: false, memberKeys: ['char:1'] } };
    assert.equal(resolveItemActive('char:1', {}, collections), false);
});

test('forced-inactive overrides collection membership', () => {
    const collections = { c1: { active: true, memberKeys: ['char:1'] } };
    assert.equal(resolveItemActive('char:1', { 'char:1': 'inactive' }, collections), false);
});

test('deactivating one collection does not affect a member still in another active collection', () => {
    const collections = {
        c1: { active: false, memberKeys: ['char:1'] },
        c2: { active: true, memberKeys: ['char:1', 'char:2'] },
    };
    assert.equal(resolveItemActive('char:1', {}, collections), true);
});

test('resolveAllActive returns the resolved set for a list of keys', () => {
    const collections = { c1: { active: true, memberKeys: ['char:1'] } };
    const itemStates = { 'char:2': 'active', 'char:3': 'inactive' };
    const result = resolveAllActive(['char:1', 'char:2', 'char:3', 'char:4'], itemStates, collections);
    assert.deepEqual([...result].sort(), ['char:1', 'char:2']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/activationState.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/activationState.js

export const FORCE = { NONE: 'none', ACTIVE: 'active', INACTIVE: 'inactive' };

/**
 * Resolves whether a single item (character or location) should be active,
 * given its forced override (if any) and the active/inactive state of every
 * collection, in priority order: forced-inactive > forced-active > collection
 * membership > default-inactive.
 * @param {string} itemKey - e.g. "char:1" or "loc:1"
 * @param {Object.<string, 'active'|'inactive'>} itemStates
 * @param {Object.<string, {active: boolean, memberKeys: string[]}>} collections
 * @returns {boolean}
 */
export function resolveItemActive(itemKey, itemStates, collections) {
    const forced = itemStates[itemKey];
    if (forced === FORCE.INACTIVE) return false;
    if (forced === FORCE.ACTIVE) return true;
    for (const collectionId in collections) {
        const collection = collections[collectionId];
        if (collection.active && collection.memberKeys.includes(itemKey)) {
            return true;
        }
    }
    return false;
}

/**
 * @param {string[]} itemKeys
 * @param {Object.<string, 'active'|'inactive'>} itemStates
 * @param {Object.<string, {active: boolean, memberKeys: string[]}>} collections
 * @returns {Set<string>}
 */
export function resolveAllActive(itemKeys, itemStates, collections) {
    const result = new Set();
    for (const key of itemKeys) {
        if (resolveItemActive(key, itemStates, collections)) {
            result.add(key);
        }
    }
    return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/activationState.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/activationState.js test/activationState.test.js
git commit -m "Add activation-state resolution (tri-state override + collection membership)"
```

---

## Task 4: uid scheme

**Files:**
- Create: `lib/uidScheme.js`
- Test: `test/uidScheme.test.js`

**Interfaces:**
- Produces: `characterEntryUids(characterId): {info, backstory, secrets, room, end}`, `locationEntryUids(locationId, subLocationCount): {info, subLocations: number[]}`, `ROSTER_UID = 5000`, `LOCATION_LIST_UID = 8000`. Used by Task 12 (entry builder) to assign uids, and by Task 13 (World Info writer) indirectly via Task 12 -- Task 13 itself never needs to track which uids to remove, since it fully rebuilds each managed book's entries from the complete active set on every sync rather than diffing against a persisted mapping (see Task 13's own notes).

- [ ] **Step 1: Write the failing test**

```js
// test/uidScheme.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { characterEntryUids, locationEntryUids, ROSTER_UID, LOCATION_LIST_UID } from '../lib/uidScheme.js';

test('character uids are deterministic and collision-free across different ids', () => {
    const c1 = characterEntryUids(1);
    const c2 = characterEntryUids(2);
    assert.deepEqual(c1, { info: 5006, backstory: 5007, secrets: 5008, room: 5009, end: 5010 });
    assert.deepEqual(c2, { info: 5011, backstory: 5012, secrets: 5013, room: 5014, end: 5015 });
    const c1Uids = Object.values(c1);
    const c2Uids = Object.values(c2);
    assert.equal(c1Uids.some(u => c2Uids.includes(u)), false);
});

test('character uids are stable across repeated calls (idempotent re-add)', () => {
    assert.deepEqual(characterEntryUids(42), characterEntryUids(42));
});

test('character uid never collides with roster uid 5000', () => {
    for (let id = 0; id < 50; id++) {
        assert.notEqual(characterEntryUids(id).info, ROSTER_UID);
    }
});

test('location uids are deterministic with headroom for sub-locations', () => {
    const l1 = locationEntryUids(1, 3);
    assert.equal(l1.info, 8021);
    assert.deepEqual(l1.subLocations, [8022, 8023, 8024]);
});

test('location uids with zero sub-locations', () => {
    const l0 = locationEntryUids(0, 0);
    assert.equal(l0.info, 8001);
    assert.deepEqual(l0.subLocations, []);
});

test('location sub-location count over headroom throws', () => {
    assert.throws(() => locationEntryUids(1, 20), /sub-location/i);
});

test('constants', () => {
    assert.equal(ROSTER_UID, 5000);
    assert.equal(LOCATION_LIST_UID, 8000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/uidScheme.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/uidScheme.js

export const ROSTER_UID = 5000;
export const LOCATION_LIST_UID = 8000;

const LOCATION_SLOTS_PER_ITEM = 20;

/**
 * Reproduces the Registrar's own character uid scheme exactly: base = characterId*5,
 * entries at base+5001..base+5005. Deterministic and collision-free per characterId.
 * @param {string|number} characterId
 * @returns {{info: number, backstory: number, secrets: number, room: number, end: number}}
 */
export function characterEntryUids(characterId) {
    const base = Number(characterId) * 5;
    return {
        info: base + 5001,
        backstory: base + 5002,
        secrets: base + 5003,
        room: base + 5004,
        end: base + 5005,
    };
}

/**
 * A uid scheme this extension owns (the Registrar's own location uids are just an
 * export-time sequential counter, not stable per location). Reserves
 * LOCATION_SLOTS_PER_ITEM uids per location: slot 0 for the main entry, the rest
 * for sub-locations.
 * @param {string|number} locationId
 * @param {number} subLocationCount
 * @returns {{info: number, subLocations: number[]}}
 */
export function locationEntryUids(locationId, subLocationCount) {
    if (subLocationCount > LOCATION_SLOTS_PER_ITEM - 1) {
        throw new Error(
            `Too many sub-locations (${subLocationCount}) for location ${locationId}: max ${LOCATION_SLOTS_PER_ITEM - 1}`,
        );
    }
    const base = 8001 + Number(locationId) * LOCATION_SLOTS_PER_ITEM;
    const subLocations = [];
    for (let i = 0; i < subLocationCount; i++) {
        subLocations.push(base + 1 + i);
    }
    return { info: base, subLocations };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/uidScheme.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/uidScheme.js test/uidScheme.test.js
git commit -m "Add deterministic uid schemes for characters and locations"
```

---

## Task 5: Roster / Location-List text builder

**Files:**
- Create: `lib/rosterBuilder.js`
- Test: `test/rosterBuilder.test.js`

**Interfaces:**
- Consumes: raw character/location records as returned by `/data/list`/`/loci/list` (fields: `name`, `species`, `roster`, `gender`, `onlineHandle`, `schoolYear`, `major`, `dwelling` for characters; `name`, `summary` for locations).
- Produces: `buildCharacterRosterText(records): string`, `buildLocationListText(records): string`. Task 13 calls these every time the active set changes, then wraps the result via `buildRosterEntry`/`buildLocationsEntry` in the sandbox (Task 11/12) for the surrounding WI entry boilerplate.

- [ ] **Step 1: Write the failing test**

```js
// test/rosterBuilder.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCharacterRosterText, buildLocationListText } from '../lib/rosterBuilder.js';

test('empty roster still has header and footer', () => {
    const text = buildCharacterRosterText([]);
    assert.match(text, /^\[CHARACTER ROSTER\]/);
    assert.match(text, /\[END CHARACTER ROSTER\]$/);
});

test('single character line matches the Registrar template exactly', () => {
    const text = buildCharacterRosterText([{
        name: 'Maeve',
        species: 'Usagimimi',
        roster: 'blond, outgoing introvert',
        gender: 'Female',
        onlineHandle: '@HareSay',
        schoolYear: 'MCY',
        major: 'Journalism',
        dwelling: 'Sterling Hall, Room 117',
    }]);
    assert.match(
        text,
        /Maeve: \(Usagimimi, blond, outgoing introvert, Female, Username: @HareSay, \{\{getvar:MCY\}\}, Major: Journalism, Sterling Hall, Room 117\)/,
    );
});

test('pseudonyms from comma-separated name become an AKA prefix', () => {
    const text = buildCharacterRosterText([{
        name: 'Shy, Snek',
        species: 'Hebimimi', roster: '', gender: 'Nonbinary',
        onlineHandle: '@shy', schoolYear: 'MCY', major: '', dwelling: 'O\'See Hall',
    }]);
    assert.match(text, /^Shy: \(AKA: \[Snek\], Hebimimi,/m);
});

test('character with no major omits the Major field', () => {
    const text = buildCharacterRosterText([{
        name: 'Sky', species: 'Wolf', roster: '', gender: 'Male',
        onlineHandle: '@sky', schoolYear: 'MCY', major: '', dwelling: 'O\'See Hall',
    }]);
    assert.doesNotMatch(text, /Major:/);
});

test('location list line matches the Registrar template exactly', () => {
    const text = buildLocationListText([
        { name: "Mack's Autozone", summary: 'An old but lively auto repair shop.' },
    ]);
    assert.match(text, /^\[LOCATIONS\]/);
    assert.match(text, /Mack's Autozone: \(An old but lively auto repair shop\.\)/);
    assert.match(text, /\[END LOCATIONS\]$/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/rosterBuilder.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/rosterBuilder.js

/**
 * Rebuilds the full "Character Roster" entry text from every currently-active
 * character record. Must be called with the COMPLETE active set every time —
 * never patch an existing roster string, always regenerate from scratch.
 *
 * Line format is hand-ported from the Registrar's own base.js buildLoreBook()
 * (that function itself is DOM-dependent and reflects the site's live filtered
 * selection, not our persisted active set, so it cannot be called directly —
 * see the plan's Global Constraints). Header/footer text is intentionally
 * plain, not the site's page-specific suffix variant — WeyPhone's own parser
 * matches via the lenient regex /\[CHARACTER ROSTER\b/i.
 * @param {Array<object>} records - raw character records for every active character
 * @returns {string}
 */
export function buildCharacterRosterText(records) {
    let text = '[CHARACTER ROSTER]\n' +
        "The following is a list of special named NPC's that live on and around the campus. " +
        "If an NPC is 'not yet in college', they should NEVER appear on campus randomly, and " +
        'should only appear in roleplay if {{char}} specifically looks for them.\n';
    for (const record of records) {
        const names = String(record.name).split(',').map(n => n.trim());
        const pseudonyms = names.slice(1);
        text += `${names[0]}: (` +
            (pseudonyms.length ? `AKA: [${pseudonyms.toString()}], ` : '') +
            `${record.species}, ` +
            (record.roster ? `${record.roster}, ` : '') +
            `${record.gender}, Username: ${record.onlineHandle}, {{getvar:${record.schoolYear}}},` +
            (record.major ? ` Major: ${record.major},` : '') +
            ` ${record.dwelling})\n`;
    }
    text += '[END CHARACTER ROSTER]';
    return text;
}

/**
 * Rebuilds the full "Location List" entry text from every currently-active
 * location record. Same regenerate-from-scratch rule as buildCharacterRosterText.
 * @param {Array<object>} records - raw location records for every active location
 * @returns {string}
 */
export function buildLocationListText(records) {
    let text = '[LOCATIONS]\nThe following is a list of special named locations on and around the campus.\n';
    for (const record of records) {
        text += `${record.name}: (${record.summary})\n`;
    }
    text += '[END LOCATIONS]';
    return text;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/rosterBuilder.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/rosterBuilder.js test/rosterBuilder.test.js
git commit -m "Add roster/location-list text builder (hand-ported line template)"
```

---

## Task 6: Local collections CRUD

**Files:**
- Create: `lib/localCollections.js`
- Test: `test/localCollections.test.js`

**Interfaces:**
- Consumes: `settings` object as returned by `getSettings()` (Task 2) — mutates `settings.localCollections` and `settings.collections` in place.
- Produces: `createLocalCollection(settings, name, memberKeys?): string` (returns new id), `updateLocalCollectionMembers(settings, id, memberKeys)`, `renameLocalCollection(settings, id, name)`, `deleteLocalCollection(settings, id)`.

- [ ] **Step 1: Write the failing test**

```js
// test/localCollections.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { getSettings } from '../lib/settings.js';
import {
    createLocalCollection,
    updateLocalCollectionMembers,
    renameLocalCollection,
    deleteLocalCollection,
} from '../lib/localCollections.js';

test('creates a local collection with a unique local: id', () => {
    const settings = getSettings({});
    const id = createLocalCollection(settings, 'My Roleplay Cast', ['char:1', 'loc:2']);
    assert.match(id, /^local:/);
    assert.deepEqual(settings.localCollections[id], { name: 'My Roleplay Cast', memberKeys: ['char:1', 'loc:2'] });
});

test('two collections created in a row get different ids', () => {
    const settings = getSettings({});
    const id1 = createLocalCollection(settings, 'A');
    const id2 = createLocalCollection(settings, 'B');
    assert.notEqual(id1, id2);
});

test('updateLocalCollectionMembers replaces the member list', () => {
    const settings = getSettings({});
    const id = createLocalCollection(settings, 'Cast', ['char:1']);
    updateLocalCollectionMembers(settings, id, ['char:1', 'char:2', 'loc:1']);
    assert.deepEqual(settings.localCollections[id].memberKeys, ['char:1', 'char:2', 'loc:1']);
});

test('updateLocalCollectionMembers on unknown id throws', () => {
    const settings = getSettings({});
    assert.throws(() => updateLocalCollectionMembers(settings, 'local:missing', []), /unknown/i);
});

test('renameLocalCollection updates the name only', () => {
    const settings = getSettings({});
    const id = createLocalCollection(settings, 'Old Name', ['char:1']);
    renameLocalCollection(settings, id, 'New Name');
    assert.equal(settings.localCollections[id].name, 'New Name');
    assert.deepEqual(settings.localCollections[id].memberKeys, ['char:1']);
});

test('deleteLocalCollection removes both the definition and its activation state', () => {
    const settings = getSettings({});
    const id = createLocalCollection(settings, 'Temp');
    settings.collections[id] = { active: true, source: 'local' };
    deleteLocalCollection(settings, id);
    assert.equal(settings.localCollections[id], undefined);
    assert.equal(settings.collections[id], undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/localCollections.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/localCollections.js

/**
 * @param {import('./settings.js').WeylandRegistrarSettings} settings
 * @param {string} name
 * @param {string[]} [memberKeys]
 * @returns {string} the new local collection's id, formatted "local:<uuid>"
 */
export function createLocalCollection(settings, name, memberKeys = []) {
    const id = `local:${globalThis.crypto.randomUUID()}`;
    settings.localCollections[id] = { name, memberKeys: [...memberKeys] };
    return id;
}

/**
 * @param {import('./settings.js').WeylandRegistrarSettings} settings
 * @param {string} id
 * @param {string[]} memberKeys
 */
export function updateLocalCollectionMembers(settings, id, memberKeys) {
    if (!settings.localCollections[id]) {
        throw new Error(`Unknown local collection: ${id}`);
    }
    settings.localCollections[id].memberKeys = [...memberKeys];
}

/**
 * @param {import('./settings.js').WeylandRegistrarSettings} settings
 * @param {string} id
 * @param {string} name
 */
export function renameLocalCollection(settings, id, name) {
    if (!settings.localCollections[id]) {
        throw new Error(`Unknown local collection: ${id}`);
    }
    settings.localCollections[id].name = name;
}

/**
 * @param {import('./settings.js').WeylandRegistrarSettings} settings
 * @param {string} id
 */
export function deleteLocalCollection(settings, id) {
    delete settings.localCollections[id];
    delete settings.collections[id];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/localCollections.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/localCollections.js test/localCollections.test.js
git commit -m "Add local collection CRUD over extension settings"
```

---

## Task 7: Filter/search query parser

**Files:**
- Create: `lib/filterQuery.js`
- Test: `test/filterQuery.test.js`

**Interfaces:**
- Produces: `parseSearchTerms(searchString): Array<{prop: string, value: string, negate: boolean}>`, `matchesTerms(searchBlob: object, terms: Array): boolean`. Used by Task 8 (collection resolver, to interpret a collection's saved `filter` string) and Task 16 (browsing UI's own live search box).
- Note: this is a deliberately-reduced port of the Registrar's own `filterList()` *algorithm* (search-term parsing + predicate matching only) — not a sandboxed call, since this logic has no character-content-fidelity requirement (it's query syntax, not authored prose) and the real `filterList()` is DOM-dependent (`document.getElementById('search')`/`'userid'`) so can't be called as-is anyway. `owner:me` and time-window (`update:`) special cases are intentionally out of scope — this extension has no authenticated Registrar user context.

- [ ] **Step 1: Write the failing test**

```js
// test/filterQuery.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSearchTerms, matchesTerms } from '../lib/filterQuery.js';

test('plain words become master-prop terms', () => {
    assert.deepEqual(parseSearchTerms('cat girl'), [
        { prop: 'master', value: 'cat', negate: false },
        { prop: 'master', value: 'girl', negate: false },
    ]);
});

test('prop:value becomes a scoped term', () => {
    assert.deepEqual(parseSearchTerms('owner:josh033169'), [
        { prop: 'owner', value: 'josh033169', negate: false },
    ]);
});

test('prop:!value becomes a negated scoped term', () => {
    assert.deepEqual(parseSearchTerms('species:!human'), [
        { prop: 'species', value: 'human', negate: true },
    ]);
});

test('quoted phrases are kept intact as one master term', () => {
    assert.deepEqual(parseSearchTerms('"cat girl" fluffy'), [
        { prop: 'master', value: 'fluffy', negate: false },
        { prop: 'master', value: 'cat girl', negate: false },
    ]);
});

test('empty search string yields no terms', () => {
    assert.deepEqual(parseSearchTerms(''), []);
});

test('matchesTerms: affirmative term must match', () => {
    const blob = { species: 'nekomimi', owner: 'josh033169' };
    assert.equal(matchesTerms(blob, [{ prop: 'species', value: 'neko', negate: false }]), true);
    assert.equal(matchesTerms(blob, [{ prop: 'species', value: 'wolf', negate: false }]), false);
});

test('matchesTerms: negated term must NOT match', () => {
    const blob = { species: 'nekomimi' };
    assert.equal(matchesTerms(blob, [{ prop: 'species', value: 'neko', negate: true }]), false);
    assert.equal(matchesTerms(blob, [{ prop: 'species', value: 'wolf', negate: true }]), true);
});

test('matchesTerms: unknown prop on the blob is skipped, not a failure', () => {
    const blob = { species: 'nekomimi' };
    assert.equal(matchesTerms(blob, [{ prop: 'nonexistent', value: 'x', negate: false }]), true);
});

test('matchesTerms: multiple terms are ANDed together', () => {
    const blob = { species: 'nekomimi', owner: 'josh033169' };
    assert.equal(matchesTerms(blob, [
        { prop: 'species', value: 'neko', negate: false },
        { prop: 'owner', value: 'josh', negate: false },
    ]), true);
    assert.equal(matchesTerms(blob, [
        { prop: 'species', value: 'neko', negate: false },
        { prop: 'owner', value: 'someoneelse', negate: false },
    ]), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/filterQuery.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/filterQuery.js

/**
 * Parses a Registrar-style search string ("species:neko owner:!bob \"exact phrase\"")
 * into structured terms. Ported from the algorithm inside the Registrar's own
 * filterList() (base.js) — deliberately excludes its DOM-dependent bits
 * (owner:me resolution, update: timestamp windows) since this extension has
 * no authenticated Registrar session to resolve those against.
 * @param {string} searchString
 * @returns {Array<{prop: string, value: string, negate: boolean}>}
 */
export function parseSearchTerms(searchString) {
    if (!searchString) return [];
    let str = searchString;
    const phrases = str.match(/".+"/g) || [];
    for (const phrase of phrases) {
        str = str.replace(phrase, '');
    }
    const words = str.split(/\s+/g).filter(Boolean);
    const terms = [];
    for (const word of words) {
        const frags = word.match(/([\w]+):(.+)/);
        if (frags && frags.length === 3) {
            const val = frags[2];
            if (val.charAt(0) === '!') {
                terms.push({ prop: frags[1], value: val.slice(1), negate: true });
            } else {
                terms.push({ prop: frags[1], value: val, negate: false });
            }
        } else {
            terms.push({ prop: 'master', value: word, negate: false });
        }
    }
    for (const phrase of phrases) {
        terms.push({ prop: 'master', value: phrase.slice(1, -1), negate: false });
    }
    return terms;
}

/**
 * @param {Object.<string, string>} searchBlob - lowercase, flattened searchable fields for one record
 * @param {Array<{prop: string, value: string, negate: boolean}>} terms
 * @returns {boolean} true if the record matches every term (AND)
 */
export function matchesTerms(searchBlob, terms) {
    for (const term of terms) {
        if (searchBlob[term.prop] === undefined) continue;
        const options = String(term.value).toLowerCase().split('|');
        const haystack = String(searchBlob[term.prop]);
        if (term.negate) {
            for (const option of options) {
                if (option && haystack.includes(option)) return false;
            }
        } else {
            let found = false;
            for (const option of options) {
                if (option && haystack.includes(option)) { found = true; break; }
            }
            if (!found) return false;
        }
    }
    return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/filterQuery.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/filterQuery.js test/filterQuery.test.js
git commit -m "Add search/filter query parser (ported algorithm, no DOM dependency)"
```

---

## Task 8: Collection resolver

**Files:**
- Create: `lib/collectionResolver.js`
- Test: `test/collectionResolver.test.js`

**Interfaces:**
- Consumes: a collection record (`{filter, selectedCharacters, deselectedCharacters}` as returned by `/coll/list`, URL-encoded per the Registrar's own convention), and a `catalog` of `{characters: [...], locations: [...]}` where every record has been augmented with `.itemKey` and `.searchBlob` (produced by Task 9's `buildSearchBlob`/`toItemKey`).
- Produces: `resolveCollectionMembers(collectionRecord, catalog): string[]` (array of itemKeys). Task 13 calls this for every active Registrar collection to get its `memberKeys` before calling `resolveAllActive` (Task 3).

- [ ] **Step 1: Write the failing test**

```js
// test/collectionResolver.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCollectionMembers } from '../lib/collectionResolver.js';

function makeCatalog() {
    return {
        characters: [
            { characterId: '1', itemKey: 'char:1', searchBlob: { owner: 'josh033169', species: 'nekomimi' } },
            { characterId: '2', itemKey: 'char:2', searchBlob: { owner: 'josh033169', species: 'wolf' } },
            { characterId: '3', itemKey: 'char:3', searchBlob: { owner: 'someoneelse', species: 'nekomimi' } },
        ],
        locations: [
            { locationId: '1', itemKey: 'loc:1', searchBlob: { owner: 'josh033169' } },
        ],
    };
}

test('resolves via filter string only', () => {
    const collection = { filter: encodeURIComponent('owner:josh033169'), selectedCharacters: '', deselectedCharacters: '' };
    const members = resolveCollectionMembers(collection, makeCatalog());
    assert.deepEqual(members.sort(), ['char:1', 'char:2', 'loc:1']);
});

test('deselectedCharacters removes a filter-matched member', () => {
    const collection = {
        filter: encodeURIComponent('owner:josh033169'),
        selectedCharacters: '',
        deselectedCharacters: encodeURIComponent(JSON.stringify(['2'])),
    };
    const members = resolveCollectionMembers(collection, makeCatalog());
    assert.deepEqual(members.sort(), ['char:1', 'loc:1']);
});

test('selectedCharacters adds a member the filter did not match', () => {
    const collection = {
        filter: encodeURIComponent('owner:josh033169'),
        selectedCharacters: encodeURIComponent(JSON.stringify(['3'])),
        deselectedCharacters: '',
    };
    const members = resolveCollectionMembers(collection, makeCatalog());
    assert.deepEqual(members.sort(), ['char:1', 'char:2', 'char:3', 'loc:1']);
});

test('no filter, only explicit selectedCharacters', () => {
    const collection = { filter: '', selectedCharacters: encodeURIComponent(JSON.stringify(['1', '3'])), deselectedCharacters: '' };
    const members = resolveCollectionMembers(collection, makeCatalog());
    assert.deepEqual(members.sort(), ['char:1', 'char:3']);
});

test('malformed selectedCharacters JSON does not throw, yields no additions', () => {
    const collection = { filter: '', selectedCharacters: 'not-json', deselectedCharacters: '' };
    assert.doesNotThrow(() => resolveCollectionMembers(collection, makeCatalog()));
    assert.deepEqual(resolveCollectionMembers(collection, makeCatalog()), []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/collectionResolver.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/collectionResolver.js
import { parseSearchTerms, matchesTerms } from './filterQuery.js';

/**
 * Resolves a Registrar collection record (its saved search filter plus
 * explicit selected/deselected id overrides, matching the site's own
 * "Dynamic"/"Static" selectionMode convention) into a concrete set of itemKeys.
 * @param {{filter?: string, selectedCharacters?: string, deselectedCharacters?: string}} collectionRecord
 * @param {{characters: Array<object>, locations: Array<object>}} catalog - every record augmented with .itemKey and .searchBlob
 * @returns {string[]}
 */
export function resolveCollectionMembers(collectionRecord, catalog) {
    const allItems = [...catalog.characters, ...catalog.locations];
    const filterString = safeDecode(collectionRecord.filter);
    const terms = filterString ? parseSearchTerms(filterString) : [];
    const matched = terms.length ? allItems.filter(item => matchesTerms(item.searchBlob, terms)) : [];

    const memberKeys = new Set(matched.map(item => item.itemKey));

    for (const id of parseIdArray(collectionRecord.selectedCharacters)) {
        const key = findItemKeyById(allItems, id);
        if (key) memberKeys.add(key);
    }
    for (const id of parseIdArray(collectionRecord.deselectedCharacters)) {
        const key = findItemKeyById(allItems, id);
        if (key) memberKeys.delete(key);
    }

    return [...memberKeys];
}

function safeDecode(value) {
    if (!value) return '';
    try {
        return decodeURIComponent(value);
    } catch {
        return '';
    }
}

function parseIdArray(encoded) {
    const decoded = safeDecode(encoded);
    if (!decoded) return [];
    try {
        const parsed = JSON.parse(decoded);
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
        return [];
    }
}

function findItemKeyById(allItems, id) {
    const found = allItems.find(item => String(item.characterId ?? item.locationId) === String(id));
    return found ? found.itemKey : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/collectionResolver.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/collectionResolver.js test/collectionResolver.test.js
git commit -m "Add collection resolver (filter + selected/deselected -> itemKeys)"
```

---

## Task 9: Registrar API client

**Files:**
- Create: `lib/registrarApi.js`
- Test: `test/registrarApi.test.js`

**Interfaces:**
- Consumes: injectable `fetchImpl`/`proxyFetchImpl` (both default to global `fetch`) for testability.
- Produces: `toItemKey(record, itemType): string`, `buildSearchBlob(record, itemType): object`, `fetchCharacterList(baseUrl, fetchImpl?): Promise<object[]>`, `fetchViaProxy(fullTargetUrl, fetchImpl?): Promise<object[]>`, `fetchWithCorsFallback(url, {fetchImpl?, proxyFetchImpl?}): Promise<object[]>`, `fetchLocationList`, `fetchCollectionList`, `fetchLoreList` (all three call `fetchWithCorsFallback` internally). Task 10 (catalog cache) calls these to populate/refresh the cache.
- **CORS strategy is two-tier, direct-first:** `/loci/list`, `/coll/list`, `/lore/list` currently lack CORS headers, but the Registrar is expected to add them eventually — attempting a direct fetch first means the extension automatically stops needing any proxy at all, with zero code changes, the moment that happens. Only a genuinely CORS-blocked request (the `fetch()` call itself throwing, which is how browsers surface CORS failures — no readable response, not a resolved-but-bad-status result) falls back to SillyTavern's own `/proxy/` passthrough. A direct fetch that resolves with a real HTTP error status (e.g. a 500) is NOT retried through the proxy — that's a genuine server error the proxy can't fix, and retrying would just double the load for nothing. Deliberately not chaining further into third-party public CORS proxies (`weyland_dorms.html`'s codetabs/allorigins/corsproxy.io fallback) — confirmed with the user; ST's own passthrough is trusted and always available in this fork, and stacking on flaky/rate-limited public services on top would add risk without a clear benefit.

- [ ] **Step 1: Write the failing test**

```js
// test/registrarApi.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    toItemKey,
    buildSearchBlob,
    fetchCharacterList,
    fetchViaProxy,
    fetchWithCorsFallback,
    fetchLocationList,
} from '../lib/registrarApi.js';

test('toItemKey for a character', () => {
    assert.equal(toItemKey({ characterId: '7' }, 'character'), 'char:7');
});

test('toItemKey for a location', () => {
    assert.equal(toItemKey({ locationId: '3' }, 'location'), 'loc:3');
});

test('buildSearchBlob lowercases and flattens relevant character fields', () => {
    const blob = buildSearchBlob({ name: 'Maeve', species: 'Usagimimi', ownerName: 'Josh', tags: '["a","b"]' }, 'character');
    assert.equal(blob.species, 'usagimimi');
    assert.equal(blob.owner, 'josh');
    assert.match(blob.tags, /a/);
});

test('fetchCharacterList calls /data/list directly with no proxy', async () => {
    let calledUrl = null;
    const fakeFetch = async (url) => {
        calledUrl = url;
        return { ok: true, json: async () => [{ characterId: '1' }] };
    };
    const result = await fetchCharacterList('https://registrar.weybooru.com', fakeFetch);
    assert.equal(calledUrl, 'https://registrar.weybooru.com/data/list');
    assert.deepEqual(result, [{ characterId: '1' }]);
});

test('fetchCharacterList throws on non-ok response', async () => {
    const fakeFetch = async () => ({ ok: false, status: 500 });
    await assert.rejects(() => fetchCharacterList('https://x', fakeFetch), /500/);
});

test('fetchViaProxy routes through /proxy/<raw target url>, not encoded', async () => {
    let calledUrl = null;
    let calledOpts = null;
    const fakeFetch = async (url, opts) => {
        calledUrl = url;
        calledOpts = opts;
        return { ok: true, json: async () => [{ locationId: '1' }] };
    };
    const result = await fetchViaProxy('https://registrar.weybooru.com/loci/list', fakeFetch);
    assert.equal(calledUrl, '/proxy/https://registrar.weybooru.com/loci/list');
    assert.deepEqual(calledOpts, { credentials: 'include' });
    assert.deepEqual(result, [{ locationId: '1' }]);
});

test('fetchWithCorsFallback uses the direct result when direct fetch succeeds', async () => {
    let proxyCalled = false;
    const fetchImpl = async () => ({ ok: true, json: async () => [{ locationId: '1' }] });
    const proxyFetchImpl = async () => { proxyCalled = true; return { ok: true, json: async () => [] }; };
    const result = await fetchWithCorsFallback('https://registrar.weybooru.com/loci/list', { fetchImpl, proxyFetchImpl });
    assert.deepEqual(result, [{ locationId: '1' }]);
    assert.equal(proxyCalled, false);
});

test('fetchWithCorsFallback falls back to the proxy when direct fetch throws (CORS block)', async () => {
    const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
    let proxyUrl = null;
    const proxyFetchImpl = async (url) => {
        proxyUrl = url;
        return { ok: true, json: async () => [{ locationId: '1' }] };
    };
    const result = await fetchWithCorsFallback('https://registrar.weybooru.com/loci/list', { fetchImpl, proxyFetchImpl });
    assert.equal(proxyUrl, '/proxy/https://registrar.weybooru.com/loci/list');
    assert.deepEqual(result, [{ locationId: '1' }]);
});

test('fetchWithCorsFallback does NOT fall back on a resolved-but-error direct response', async () => {
    let proxyCalled = false;
    const fetchImpl = async () => ({ ok: false, status: 500 });
    const proxyFetchImpl = async () => { proxyCalled = true; return { ok: true, json: async () => [] }; };
    await assert.rejects(
        () => fetchWithCorsFallback('https://registrar.weybooru.com/loci/list', { fetchImpl, proxyFetchImpl }),
        /500/,
    );
    assert.equal(proxyCalled, false);
});

test('fetchLocationList delegates to fetchWithCorsFallback with the right target URL', async () => {
    let calledUrl = null;
    const fetchImpl = async (url) => {
        calledUrl = url;
        return { ok: true, json: async () => [] };
    };
    await fetchLocationList('https://registrar.weybooru.com', fetchImpl);
    assert.equal(calledUrl, 'https://registrar.weybooru.com/loci/list');
});

test('fetchLocationList falls back to proxy when direct fetch is CORS-blocked', async () => {
    const fetchImpl = async () => { throw new TypeError('Failed to fetch'); };
    let proxyUrl = null;
    const proxyFetchImpl = async (url) => { proxyUrl = url; return { ok: true, json: async () => [{ locationId: '9' }] }; };
    const result = await fetchLocationList('https://registrar.weybooru.com', fetchImpl, proxyFetchImpl);
    assert.equal(proxyUrl, '/proxy/https://registrar.weybooru.com/loci/list');
    assert.deepEqual(result, [{ locationId: '9' }]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/registrarApi.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/registrarApi.js

/**
 * @param {object} record
 * @param {'character'|'location'} itemType
 * @returns {string}
 */
export function toItemKey(record, itemType) {
    return itemType === 'character' ? `char:${record.characterId}` : `loc:${record.locationId}`;
}

/**
 * Flattens the fields relevant to search filtering into a lowercase blob,
 * matching the prop names the Registrar's own filterList() uses (owner, species, etc.)
 * so filter strings copied from the Registrar work unmodified against our own catalog.
 * @param {object} record
 * @param {'character'|'location'} itemType
 * @returns {Object.<string, string>}
 */
export function buildSearchBlob(record, itemType) {
    const lc = (value) => String(value ?? '').toLowerCase();
    if (itemType === 'character') {
        return {
            master: `${lc(record.name)} ${lc(record.surname)} ${lc(record.summary)}`,
            owner: lc(record.ownerName),
            ownerId: lc(record.ownerId),
            species: lc(record.species),
            gender: lc(record.gender),
            major: lc(record.major),
            tags: lc(record.tags),
            handle: lc(record.onlineHandle),
            status: lc(record.status),
        };
    }
    return {
        master: `${lc(record.name)} ${lc(record.summary)}`,
        owner: lc(record.ownerName),
        ownerId: lc(record.ownerId),
        tags: lc(record.tags),
        status: lc(record.status),
    };
}

/**
 * /data/list has open CORS (Access-Control-Allow-Origin: *) -- fetch directly.
 * @param {string} baseUrl
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<object[]>}
 */
export async function fetchCharacterList(baseUrl, fetchImpl = fetch) {
    const res = await fetchImpl(`${baseUrl}/data/list`);
    if (!res.ok) {
        throw new Error(`Registrar /data/list failed: ${res.status}`);
    }
    return res.json();
}

/**
 * Routes through SillyTavern's own /proxy/:url(*) passthrough (src/middleware/corsProxy.js) --
 * the target url is appended RAW after "/proxy/", not URL-encoded, matching the
 * confirmed real usage in weyland-status's serviceHealthMonitor.js. Requires
 * enableCorsProxy: true in config.yaml (already this fork's default).
 * @param {string} fullTargetUrl - a complete absolute URL, e.g. "https://registrar.weybooru.com/loci/list"
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<object[]>}
 */
export async function fetchViaProxy(fullTargetUrl, fetchImpl = fetch) {
    const res = await fetchImpl(`/proxy/${fullTargetUrl}`, { credentials: 'include' });
    if (!res.ok) {
        throw new Error(`Proxy fetch failed for ${fullTargetUrl}: ${res.status}`);
    }
    return res.json();
}

/**
 * Two-tier CORS strategy: try a direct fetch first (these endpoints don't
 * currently send Access-Control-Allow-Origin, but the Registrar is expected
 * to add it eventually -- trying direct first means this auto-stops needing
 * any proxy the moment that happens, with zero code changes). Only a direct
 * fetch that THROWS (the way browsers surface a CORS block -- no readable
 * response at all) falls back to SillyTavern's own /proxy/ passthrough. A
 * direct fetch that resolves with a real HTTP error status is a genuine
 * server error, not a CORS problem, and is NOT retried through the proxy.
 * Deliberately does not chain further into third-party public CORS proxies.
 * @param {string} fullTargetUrl
 * @param {{fetchImpl?: typeof fetch, proxyFetchImpl?: typeof fetch}} [options]
 * @returns {Promise<object[]>}
 */
export async function fetchWithCorsFallback(fullTargetUrl, { fetchImpl = fetch, proxyFetchImpl = fetch } = {}) {
    let directResponse;
    try {
        directResponse = await fetchImpl(fullTargetUrl);
    } catch {
        return fetchViaProxy(fullTargetUrl, proxyFetchImpl);
    }
    if (!directResponse.ok) {
        throw new Error(`Registrar request failed: ${directResponse.status}`);
    }
    return directResponse.json();
}

/** @param {string} baseUrl @param {typeof fetch} [fetchImpl] @param {typeof fetch} [proxyFetchImpl] @returns {Promise<object[]>} */
export async function fetchLocationList(baseUrl, fetchImpl = fetch, proxyFetchImpl = fetch) {
    return fetchWithCorsFallback(`${baseUrl}/loci/list`, { fetchImpl, proxyFetchImpl });
}

/** @param {string} baseUrl @param {typeof fetch} [fetchImpl] @param {typeof fetch} [proxyFetchImpl] @returns {Promise<object[]>} */
export async function fetchCollectionList(baseUrl, fetchImpl = fetch, proxyFetchImpl = fetch) {
    return fetchWithCorsFallback(`${baseUrl}/coll/list`, { fetchImpl, proxyFetchImpl });
}

/** @param {string} baseUrl @param {typeof fetch} [fetchImpl] @param {typeof fetch} [proxyFetchImpl] @returns {Promise<object[]>} */
export async function fetchLoreList(baseUrl, fetchImpl = fetch, proxyFetchImpl = fetch) {
    return fetchWithCorsFallback(`${baseUrl}/lore/list`, { fetchImpl, proxyFetchImpl });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/registrarApi.test.js`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/registrarApi.js test/registrarApi.test.js
git commit -m "Add Registrar API client (direct fetch + /proxy/ passthrough)"
```

---

## Task 10: IndexedDB catalog cache

**Files:**
- Create: `lib/catalogCache.js`
- Test: `test/catalogCache.test.js`

**Interfaces:**
- Consumes: an injectable storage engine (`{get(key), set(key, value), delete(key)}` — async, Map-like) so the CRUD logic is unit-testable without a real IndexedDB; a real browser binding (`createIndexedDbStorageEngine()`) is provided but not unit-tested (browser-only, see Task 10 Step 6).
- Produces: `createCatalogCache(storageEngine): {getCharacters, setCharacters, getLocations, setLocations, getCollections, setCollections, getLore, setLore, getLastRefreshed, setLastRefreshed}`. Task 13 and Task 16 both read from this instead of re-fetching.

- [ ] **Step 1: Write the failing test**

```js
// test/catalogCache.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogCache } from '../lib/catalogCache.js';

function createInMemoryStorageEngine() {
    const store = new Map();
    return {
        async get(key) { return store.has(key) ? store.get(key) : undefined; },
        async set(key, value) { store.set(key, value); },
        async delete(key) { store.delete(key); },
    };
}

test('returns undefined for characters before anything is cached', async () => {
    const cache = createCatalogCache(createInMemoryStorageEngine());
    assert.equal(await cache.getCharacters(), undefined);
});

test('round-trips characters', async () => {
    const cache = createCatalogCache(createInMemoryStorageEngine());
    const records = [{ characterId: '1', name: 'Maeve' }];
    await cache.setCharacters(records);
    assert.deepEqual(await cache.getCharacters(), records);
});

test('round-trips locations, collections, and lore independently', async () => {
    const cache = createCatalogCache(createInMemoryStorageEngine());
    await cache.setLocations([{ locationId: '1' }]);
    await cache.setCollections([{ collectionId: '1' }]);
    await cache.setLore([{ loreId: '1' }]);
    assert.deepEqual(await cache.getLocations(), [{ locationId: '1' }]);
    assert.deepEqual(await cache.getCollections(), [{ collectionId: '1' }]);
    assert.deepEqual(await cache.getLore(), [{ loreId: '1' }]);
    assert.equal(await cache.getCharacters(), undefined);
});

test('tracks last-refreshed timestamp per call', async () => {
    const cache = createCatalogCache(createInMemoryStorageEngine());
    assert.equal(await cache.getLastRefreshed(), undefined);
    await cache.setLastRefreshed(1234567890);
    assert.equal(await cache.getLastRefreshed(), 1234567890);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/catalogCache.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/catalogCache.js

const KEYS = {
    characters: 'weyland-registrar:catalog:characters',
    locations: 'weyland-registrar:catalog:locations',
    collections: 'weyland-registrar:catalog:collections',
    lore: 'weyland-registrar:catalog:lore',
    lastRefreshed: 'weyland-registrar:catalog:lastRefreshed',
};

/**
 * @typedef {Object} StorageEngine
 * @property {(key: string) => Promise<any>} get
 * @property {(key: string, value: any) => Promise<void>} set
 * @property {(key: string) => Promise<void>} delete
 */

/**
 * Wraps an injectable async key-value storage engine with typed
 * catalog-cache accessors. The real engine is IndexedDB-backed
 * (see createIndexedDbStorageEngine below, browser-only); tests inject an
 * in-memory Map-based fake instead.
 * @param {StorageEngine} storageEngine
 */
export function createCatalogCache(storageEngine) {
    const makeAccessor = (key) => ({
        get: () => storageEngine.get(key),
        set: (value) => storageEngine.set(key, value),
    });

    const characters = makeAccessor(KEYS.characters);
    const locations = makeAccessor(KEYS.locations);
    const collections = makeAccessor(KEYS.collections);
    const lore = makeAccessor(KEYS.lore);
    const lastRefreshed = makeAccessor(KEYS.lastRefreshed);

    return {
        getCharacters: characters.get,
        setCharacters: characters.set,
        getLocations: locations.get,
        setLocations: locations.set,
        getCollections: collections.get,
        setCollections: collections.set,
        getLore: lore.get,
        setLore: lore.set,
        getLastRefreshed: lastRefreshed.get,
        setLastRefreshed: lastRefreshed.set,
    };
}

/**
 * Real browser storage engine backed by IndexedDB. Not unit-tested (no
 * IndexedDB in plain node --test) -- verified via live-browser E2E instead,
 * per the plan's accepted browser-only-coverage areas.
 * @returns {StorageEngine}
 */
export function createIndexedDbStorageEngine() {
    const DB_NAME = 'weyland-registrar-catalog';
    const STORE_NAME = 'kv';

    function openDb() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = () => {
                request.result.createObjectStore(STORE_NAME);
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async function withStore(mode, callback) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, mode);
            const store = tx.objectStore(STORE_NAME);
            const request = callback(store);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    return {
        get: (key) => withStore('readonly', (store) => store.get(key)),
        set: (key, value) => withStore('readwrite', (store) => store.put(value, key)),
        delete: (key) => withStore('readwrite', (store) => store.delete(key)),
    };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/catalogCache.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/catalogCache.js test/catalogCache.test.js
git commit -m "Add IndexedDB catalog cache with injectable storage engine"
```

- [ ] **Step 6: Note browser-only coverage (no automated test for this step)**

`createIndexedDbStorageEngine()` itself is verified later via live-browser E2E (Task 17's final verification pass), not `node --test` — record this explicitly rather than silently skip it.

---

## Task 11: Entry sandbox (hidden iframe + base.js loader)

**Files:**
- Create: `lib/entrySandbox.js`

**Interfaces:**
- Produces: `createEntrySandbox(baseUrl): Promise<{callFunction(name, args): Promise<any>, destroy()}>`. Task 12 (entry builder) is the only consumer.
- **No unit test for this file** — it is fundamentally DOM/iframe-dependent (creates a real `<iframe>`, real `postMessage`) and cannot run under plain `node --test`. This is the browser-only-coverage exception called out in the spec §15 and the plan's testing approach; it is verified via live-browser E2E in Task 17's final verification pass. Task 12 isolates all of the *testable* logic (payload shaping, error handling) behind an injectable stand-in for this module's `callFunction`, so nothing here blocks unit coverage of the surrounding orchestration.

- [ ] **Step 1: Write the implementation**

```js
// lib/entrySandbox.js

const SANDBOX_FUNCTIONS = [
    'addLoreEntries', 'addWorldEntries', 'addSubLocationEntry',
    'buildRosterEntry', 'buildLocationsEntry', 'cleanKeywords',
    'addBoilerplateProperties', 'buildLoreOutfitSection',
    'parseCharacterOutfitEntries', 'parseLocationSubLocations',
];

const RUNNER_HTML = `<!DOCTYPE html><html><head></head><body><script>
    window.addEventListener('message', async (event) => {
        const { id, type, payload } = event.data || {};
        if (type === 'load') {
            try {
                const res = await fetch(payload.scriptUrl);
                const text = await res.text();
                (0, eval)(text);
                const missing = payload.expectedFunctions.filter(name => typeof window[name] !== 'function');
                if (missing.length) {
                    parent.postMessage({ id, type: 'load-error', error: 'Missing functions: ' + missing.join(', ') }, '*');
                    return;
                }
                parent.postMessage({ id, type: 'load-ok' }, '*');
            } catch (error) {
                parent.postMessage({ id, type: 'load-error', error: String(error) }, '*');
            }
            return;
        }
        if (type === 'call') {
            try {
                const fn = window[payload.name];
                if (typeof fn !== 'function') throw new Error('Not a function: ' + payload.name);
                const result = await fn(...payload.args);
                parent.postMessage({ id, type: 'call-ok', result }, '*');
            } catch (error) {
                parent.postMessage({ id, type: 'call-error', error: String(error) }, '*');
            }
        }
    });
</script></body></html>`;

/**
 * Loads the Registrar's own base.js into a hidden, permission-stripped iframe
 * (sandbox="allow-scripts" WITHOUT allow-same-origin, so it runs in a unique
 * opaque origin with no access to SillyTavern's DOM, cookies, localStorage, or
 * session) and exposes its pure entry-building functions via postMessage RPC.
 * @param {string} baseUrl - Registrar base URL, e.g. "https://registrar.weybooru.com"
 * @returns {Promise<{callFunction: (name: string, args: any[]) => Promise<any>, destroy: () => void}>}
 */
export async function createEntrySandbox(baseUrl) {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.style.display = 'none';
    iframe.srcdoc = RUNNER_HTML;
    document.body.appendChild(iframe);

    await new Promise((resolve) => {
        iframe.addEventListener('load', resolve, { once: true });
    });

    let nextId = 1;
    const pending = new Map();

    window.addEventListener('message', (event) => {
        if (event.source !== iframe.contentWindow) return;
        const { id, type, result, error } = event.data || {};
        const waiter = pending.get(id);
        if (!waiter) return;
        pending.delete(id);
        if (type === 'call-error' || type === 'load-error') {
            waiter.reject(new Error(error));
        } else {
            waiter.resolve(result);
        }
    });

    function send(type, payload) {
        const id = nextId++;
        return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            iframe.contentWindow.postMessage({ id, type, payload }, '*');
        });
    }

    await send('load', {
        scriptUrl: `${baseUrl}/base.js`,
        expectedFunctions: SANDBOX_FUNCTIONS,
    });

    return {
        callFunction: (name, args) => send('call', { name, args }),
        destroy: () => iframe.remove(),
    };
}
```

- [ ] **Step 2: Manual verification (no automated test — see rationale above)**

Load Weyland-Registrar in a real browser session, open the devtools console, and run:

```js
const sandbox = await window.WeylandRegistrar.createEntrySandbox('https://registrar.weybooru.com');
const result = await sandbox.callFunction('cleanKeywords', ['a, b, c']);
console.log(result); // expect: ["a", "b", "c"]
```

(`window.WeylandRegistrar` export wiring happens in Task 17; until then, `import` the module directly in a scratch test page.) Confirm no console errors, confirm the iframe never becomes visible, confirm `sandbox.destroy()` removes the iframe from the DOM.

- [ ] **Step 3: Commit**

```bash
git add lib/entrySandbox.js
git commit -m "Add sandboxed base.js execution (hidden iframe, no same-origin access)"
```

---

## Task 12: Entry builder

**Files:**
- Create: `lib/entryBuilder.js`
- Test: `test/entryBuilder.test.js`

**Interfaces:**
- Consumes: a `callFunction(name, args): Promise<any>` function matching `entrySandbox.js`'s shape (Task 11) — injected, so tests use a fake instead of a real sandbox; `uidScheme.js`'s `characterEntryUids`/`locationEntryUids` (Task 4).
- Produces: `buildCharacterEntries(callFunction, characterId, record): Promise<Object.<number, object>>` (uid -> WI entry), `buildLocationEntries(callFunction, locationId, record): Promise<Object.<number, object>>`. Task 13 calls these, then merges the returned entries into a managed book alongside a freshly-rebuilt roster/location-list entry (Task 5).

- [ ] **Step 1: Write the failing test**

```js
// test/entryBuilder.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCharacterEntries, buildLocationEntries } from '../lib/entryBuilder.js';
import { characterEntryUids, locationEntryUids } from '../lib/uidScheme.js';

function fakeSandboxCall(responses) {
    return async (name, args) => {
        if (!(name in responses)) throw new Error(`Unexpected sandbox call: ${name}`);
        return responses[name](...args);
    };
}

test('buildCharacterEntries assigns the correct deterministic uids to sandbox output', async () => {
    const uids = characterEntryUids('1');
    const callFunction = fakeSandboxCall({
        addLoreEntries: (book, id, inputData) => {
            assert.equal(id, 5); // characterId(1) * 5
            const entries = {};
            entries[id + 5001] = { uid: id + 5001, comment: inputData.name, content: 'INFO' };
            entries[id + 5005] = { uid: id + 5005, comment: `${inputData.name} End Section`, content: 'END' };
            return { ...book, entries: { ...book.entries, ...entries } };
        },
    });
    const record = { characterId: '1', name: 'Maeve' };
    const result = await buildCharacterEntries(callFunction, '1', record);
    assert.deepEqual(Object.keys(result).map(Number).sort(), [uids.info, uids.end].sort());
    assert.equal(result[uids.info].comment, 'Maeve');
});

test('buildCharacterEntries propagates a sandbox call failure', async () => {
    const callFunction = async () => { throw new Error('sandbox exploded'); };
    await assert.rejects(
        () => buildCharacterEntries(callFunction, '1', { characterId: '1', name: 'X' }),
        /sandbox exploded/,
    );
});

test('buildLocationEntries assigns uids from locationEntryUids', async () => {
    const uids = locationEntryUids('2', 0);
    const callFunction = fakeSandboxCall({
        parseLocationSubLocations: () => [],
        addWorldEntries: (book, id, inputData) => {
            assert.equal(id, uids.info);
            const entries = {};
            entries[id] = { uid: id, comment: inputData.name, content: 'LOC INFO' };
            return { ...book, entries: { ...book.entries, ...entries } };
        },
    });
    const record = { locationId: '2', name: "Mack's Autozone", subLocations: '[]' };
    const result = await buildLocationEntries(callFunction, '2', record);
    assert.deepEqual(Object.keys(result).map(Number), [uids.info]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/entryBuilder.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/entryBuilder.js
import { characterEntryUids, locationEntryUids } from './uidScheme.js';

/**
 * @param {(name: string, args: any[]) => Promise<any>} callFunction - matches entrySandbox.js's callFunction
 * @param {string|number} characterId
 * @param {object} record - raw character record from /data/list
 * @returns {Promise<Object.<number, object>>} uid -> WI entry, for this one character only
 */
export async function buildCharacterEntries(callFunction, characterId, record) {
    const uids = characterEntryUids(characterId);
    const emptyBook = { count: 0, entries: {} };
    const built = await callFunction('addLoreEntries', [emptyBook, Number(characterId) * 5, record]);
    // addLoreEntries returns the full book; extract only this character's own entries.
    const ownUids = new Set(Object.values(uids));
    const entries = {};
    for (const [uid, entry] of Object.entries(built.entries)) {
        if (ownUids.has(Number(uid))) entries[uid] = entry;
    }
    return entries;
}

/**
 * @param {(name: string, args: any[]) => Promise<any>} callFunction
 * @param {string|number} locationId
 * @param {object} record - raw location record from /loci/list
 * @returns {Promise<Object.<number, object>>} uid -> WI entry, for this one location only
 */
export async function buildLocationEntries(callFunction, locationId, record) {
    const subLocations = await callFunction('parseLocationSubLocations', [record]);
    const uids = locationEntryUids(locationId, subLocations.length);
    const emptyBook = { count: 0, entries: {} };

    let book = await callFunction('addWorldEntries', [emptyBook, uids.info, record]);
    for (let i = 0; i < subLocations.length; i++) {
        book = await callFunction('addSubLocationEntry', [book, uids.subLocations[i], uids.info, record.name, subLocations[i]]);
    }

    const ownUids = new Set([uids.info, ...uids.subLocations]);
    const entries = {};
    for (const [uid, entry] of Object.entries(book.entries)) {
        if (ownUids.has(Number(uid))) entries[uid] = entry;
    }
    return entries;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/entryBuilder.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/entryBuilder.js test/entryBuilder.test.js
git commit -m "Add entry builder orchestration (sandbox call + deterministic uid assignment)"
```

---

## Task 13: World Info writer

**Files:**
- Create: `lib/worldInfoWriter.js`
- Test: `test/worldInfoWriter.test.js`

**Interfaces:**
- Consumes: an injectable `stContext` object matching the subset of `getContext()` this module needs (`loadWorldInfo`, `saveWorldInfo`, `updateWorldInfoList`, `executeSlashCommandsWithOptions`); `resolveAllActive` (Task 3); `buildCharacterRosterText`/`buildLocationListText` (Task 5); `buildCharacterEntries`/`buildLocationEntries` (Task 12); `ROSTER_UID`/`LOCATION_LIST_UID` (Task 4).
- Produces: `syncCharacterBook(stContext, callFunction, settings, allCharacterRecordsByKey): Promise<void>`, `syncLocationBook(stContext, callFunction, settings, allLocationRecordsByKey): Promise<void>`. Task 17 (extension boot) calls these after every activation-state change.
- **Design note (settled during pre-flight review):** both functions fully rebuild the managed book's `entries` object from the complete active set on every call -- they never diff against a persisted uid-ownership mapping. This is deliberately simpler and self-healing (no risk of a stale/corrupted mapping silently leaving orphaned entries behind); it also means `settings.itemOwnership`, described in an earlier draft of this plan, was removed as unnecessary write-only state before implementation began.

- [ ] **Step 1: Write the failing test**

```js
// test/worldInfoWriter.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { syncCharacterBook, syncLocationBook, CHARACTER_BOOK_NAME, LOCATION_BOOK_NAME } from '../lib/worldInfoWriter.js';
import { ROSTER_UID, LOCATION_LIST_UID, characterEntryUids } from '../lib/uidScheme.js';

function fakeStContext() {
    const books = {};
    const activated = [];
    return {
        books,
        activated,
        loadWorldInfo: async (name) => books[name] ?? { entries: {} },
        saveWorldInfo: async (name, data) => { books[name] = data; },
        updateWorldInfoList: async () => {},
        executeSlashCommandsWithOptions: async (command) => { activated.push(command); },
    };
}

function fakeCallFunction() {
    return async (name, args) => {
        if (name === 'addLoreEntries') {
            const [book, id, record] = args;
            const entries = { ...book.entries };
            entries[id + 5001] = { uid: id + 5001, comment: record.name, content: `[${record.name} INFO]` };
            entries[id + 5005] = { uid: id + 5005, comment: `${record.name} End Section`, content: 'END' };
            return { ...book, entries };
        }
        throw new Error(`Unexpected call: ${name}`);
    };
}

test('syncCharacterBook writes entries for every active character plus one roster entry', async () => {
    const stContext = fakeStContext();
    const settings = { itemStates: { 'char:1': 'active' }, collections: {} };
    const recordsByKey = { 'char:1': { characterId: '1', name: 'Maeve', species: 'Usagimimi', gender: 'Female', onlineHandle: '@HareSay', schoolYear: 'MCY', dwelling: 'Sterling Hall' } };

    await syncCharacterBook(stContext, fakeCallFunction(), settings, recordsByKey);

    const book = stContext.books[CHARACTER_BOOK_NAME];
    assert.ok(book);
    const uids = characterEntryUids('1');
    assert.ok(book.entries[uids.info]);
    assert.ok(book.entries[uids.end]);
    assert.ok(book.entries[ROSTER_UID]);
    assert.match(book.entries[ROSTER_UID].content, /Maeve:/);
});

test('syncCharacterBook activates the book via /world after writing', async () => {
    const stContext = fakeStContext();
    const settings = { itemStates: {}, collections: {} };
    await syncCharacterBook(stContext, fakeCallFunction(), settings, {});
    assert.ok(stContext.activated.some(cmd => cmd.includes('/world') && cmd.includes(CHARACTER_BOOK_NAME)));
});

test('syncCharacterBook removes entries for a character that becomes inactive', async () => {
    const stContext = fakeStContext();
    const uids = characterEntryUids('1');
    stContext.books[CHARACTER_BOOK_NAME] = {
        entries: {
            [uids.info]: { uid: uids.info, comment: 'Maeve' },
            [uids.end]: { uid: uids.end, comment: 'Maeve End Section' },
            [ROSTER_UID]: { uid: ROSTER_UID, comment: 'Character Roster', content: 'stale' },
        },
    };
    const settings = { itemStates: { 'char:1': 'inactive' }, collections: {} };
    await syncCharacterBook(stContext, fakeCallFunction(), settings, {
        'char:1': { characterId: '1', name: 'Maeve', species: '', gender: '', onlineHandle: '', schoolYear: '', dwelling: '' },
    });
    const book = stContext.books[CHARACTER_BOOK_NAME];
    assert.equal(book.entries[uids.info], undefined);
    assert.equal(book.entries[uids.end], undefined);
});

test('syncCharacterBook with zero active characters still writes an empty roster', async () => {
    const stContext = fakeStContext();
    const settings = { itemStates: {}, collections: {} };
    await syncCharacterBook(stContext, fakeCallFunction(), settings, {});
    const book = stContext.books[CHARACTER_BOOK_NAME];
    assert.match(book.entries[ROSTER_UID].content, /\[CHARACTER ROSTER\]/);
    assert.match(book.entries[ROSTER_UID].content, /\[END CHARACTER ROSTER\]/);
});

test('syncLocationBook writes to the correct book name', async () => {
    const stContext = fakeStContext();
    const callFunction = async (name, args) => {
        if (name === 'parseLocationSubLocations') return [];
        if (name === 'addWorldEntries') {
            const [book, id, record] = args;
            return { ...book, entries: { ...book.entries, [id]: { uid: id, comment: record.name, content: 'LOC' } } };
        }
        throw new Error(`Unexpected call: ${name}`);
    };
    const settings = { itemStates: { 'loc:1': 'active' }, collections: {} };
    await syncLocationBook(stContext, callFunction, settings, {
        'loc:1': { locationId: '1', name: "Mack's Autozone", summary: 'A shop.', subLocations: '[]' },
    });
    assert.ok(stContext.books[LOCATION_BOOK_NAME]);
    assert.ok(stContext.books[LOCATION_BOOK_NAME].entries[LOCATION_LIST_UID]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/worldInfoWriter.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/worldInfoWriter.js
import { resolveAllActive } from './activationState.js';
import { buildCharacterRosterText, buildLocationListText } from './rosterBuilder.js';
import { buildCharacterEntries, buildLocationEntries } from './entryBuilder.js';
import { ROSTER_UID, LOCATION_LIST_UID } from './uidScheme.js';

export const CHARACTER_BOOK_NAME = 'Lore Book - Weyland Registrar';
export const LOCATION_BOOK_NAME = 'World Book - Community Locations';

/**
 * Required sequence: write -> refresh book list -> activate. Never reorder --
 * skipping updateWorldInfoList before activating silently toasts
 * "No world found" instead of erroring.
 * @param {object} stContext - subset of getContext(): loadWorldInfo, saveWorldInfo, updateWorldInfoList, executeSlashCommandsWithOptions
 * @param {string} bookName
 * @param {object} bookData
 */
async function writeAndActivate(stContext, bookName, bookData) {
    await stContext.saveWorldInfo(bookName, bookData, true);
    await stContext.updateWorldInfoList();
    await stContext.executeSlashCommandsWithOptions(`/world state=on silent=true "${bookName}"`);
}

/**
 * Rebuilds the entire shared character book from the complete active set --
 * never a partial patch. Removes entries for characters no longer active,
 * builds fresh entries (via the sandbox) for characters newly active, and
 * always fully regenerates the single roster entry (uid 5000).
 * @param {object} stContext
 * @param {(name: string, args: any[]) => Promise<any>} callFunction - entrySandbox's callFunction
 * @param {import('./settings.js').WeylandRegistrarSettings} settings
 * @param {Object.<string, object>} allCharacterRecordsByKey - itemKey ("char:<id>") -> raw record, for every character the caller knows about (not just active ones)
 */
export async function syncCharacterBook(stContext, callFunction, settings, allCharacterRecordsByKey) {
    const collectionsWithMembers = resolveCollectionsForActivation(settings);
    const activeKeys = resolveAllActive(Object.keys(allCharacterRecordsByKey), settings.itemStates, collectionsWithMembers);

    const entries = {};
    for (const key of activeKeys) {
        const record = allCharacterRecordsByKey[key];
        if (!record) continue;
        const characterEntries = await buildCharacterEntries(callFunction, record.characterId, record);
        Object.assign(entries, characterEntries);
    }

    const activeRecords = [...activeKeys].map(key => allCharacterRecordsByKey[key]).filter(Boolean);
    entries[ROSTER_UID] = {
        uid: ROSTER_UID,
        key: [],
        keysecondary: [],
        comment: 'Character Roster',
        content: buildCharacterRosterText(activeRecords),
        constant: true,
        position: 1,
        disable: false,
        order: 5000,
    };

    await writeAndActivate(stContext, CHARACTER_BOOK_NAME, { entries });
}

/**
 * Same regenerate-from-scratch contract as syncCharacterBook, for locations.
 * @param {object} stContext
 * @param {(name: string, args: any[]) => Promise<any>} callFunction
 * @param {import('./settings.js').WeylandRegistrarSettings} settings
 * @param {Object.<string, object>} allLocationRecordsByKey - itemKey ("loc:<id>") -> raw record
 */
export async function syncLocationBook(stContext, callFunction, settings, allLocationRecordsByKey) {
    const collectionsWithMembers = resolveCollectionsForActivation(settings);
    const activeKeys = resolveAllActive(Object.keys(allLocationRecordsByKey), settings.itemStates, collectionsWithMembers);

    const entries = {};
    for (const key of activeKeys) {
        const record = allLocationRecordsByKey[key];
        if (!record) continue;
        const locationEntries = await buildLocationEntries(callFunction, record.locationId, record);
        Object.assign(entries, locationEntries);
    }

    const activeRecords = [...activeKeys].map(key => allLocationRecordsByKey[key]).filter(Boolean);
    entries[LOCATION_LIST_UID] = {
        uid: LOCATION_LIST_UID,
        key: [],
        keysecondary: [],
        comment: 'Location List',
        content: buildLocationListText(activeRecords),
        constant: true,
        position: 1,
        disable: false,
        order: 8000,
    };

    await writeAndActivate(stContext, LOCATION_BOOK_NAME, { entries });
}

/**
 * Collections stored in settings only carry {active, source} -- member
 * resolution happens elsewhere (collectionResolver.js for Registrar
 * collections, localCollections storage directly for local ones) and must
 * be merged in by the caller before this point in a real boot sequence
 * (Task 17). Tests pass settings.collections already carrying memberKeys.
 * @param {import('./settings.js').WeylandRegistrarSettings} settings
 */
function resolveCollectionsForActivation(settings) {
    const result = {};
    for (const [id, collection] of Object.entries(settings.collections)) {
        result[id] = { active: !!collection.active, memberKeys: collection.memberKeys ?? [] };
    }
    return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/worldInfoWriter.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/worldInfoWriter.js test/worldInfoWriter.test.js
git commit -m "Add World Info writer (full-rebuild sync for both managed books)"
```

---

## Task 14: Scenario (lore) book manager

**Files:**
- Create: `lib/scenarioBooks.js`
- Test: `test/scenarioBooks.test.js`

**Interfaces:**
- Consumes: the same `stContext` shape as Task 13; a `callFunction` (Task 11); a lore/scenario record from `/lore/list`.
- Produces: `scenarioBookName(loreRecord): string`, `activateScenario(stContext, callFunction, settings, loreRecord): Promise<void>`, `deactivateScenario(stContext, settings, loreRecord): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```js
// test/scenarioBooks.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarioBookName, activateScenario, deactivateScenario } from '../lib/scenarioBooks.js';

function fakeStContext() {
    const books = {};
    const commands = [];
    return {
        books, commands,
        loadWorldInfo: async (name) => books[name] ?? { entries: {} },
        saveWorldInfo: async (name, data) => { books[name] = data; },
        updateWorldInfoList: async () => {},
        executeSlashCommandsWithOptions: async (cmd) => { commands.push(cmd); },
    };
}

test('scenarioBookName matches the Registrar\'s own per-item naming convention', () => {
    assert.equal(scenarioBookName({ name: 'The Venture' }), 'Lore Book - The Venture');
});

test('activateScenario writes a dedicated book and activates it', async () => {
    const stContext = fakeStContext();
    const callFunction = async (name) => {
        if (name === 'buildRosterEntry') return { uid: 5000, comment: 'Character Roster', content: 'x' };
        throw new Error(`Unexpected: ${name}`);
    };
    const settings = { scenarioBooks: {} };
    const loreRecord = { loreId: '1', name: 'The Venture', greeting: 'Welcome.' };

    await activateScenario(stContext, callFunction, settings, loreRecord);

    assert.ok(stContext.books['Lore Book - The Venture']);
    assert.ok(stContext.commands.some(cmd => cmd.includes('state=on') && cmd.includes('Lore Book - The Venture')));
    assert.equal(settings.scenarioBooks['1'].active, true);
    assert.equal(settings.scenarioBooks['1'].book, 'Lore Book - The Venture');
});

test('deactivateScenario turns the book off without deleting it', async () => {
    const stContext = fakeStContext();
    const settings = { scenarioBooks: { '1': { active: true, book: 'Lore Book - The Venture' } } };
    stContext.books['Lore Book - The Venture'] = { entries: {} };

    await deactivateScenario(stContext, settings, { loreId: '1', name: 'The Venture' });

    assert.ok(stContext.commands.some(cmd => cmd.includes('state=off') && cmd.includes('Lore Book - The Venture')));
    assert.equal(settings.scenarioBooks['1'].active, false);
    assert.ok(stContext.books['Lore Book - The Venture'], 'file is kept on disk, not deleted');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/scenarioBooks.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Write minimal implementation**

```js
// lib/scenarioBooks.js

/**
 * Matches the Registrar's own getLoreBookName() convention (base.js): named
 * lore items get their own dedicated "Lore Book - <name>" file, never merged
 * with anything else.
 * @param {{name: string}} loreRecord
 * @returns {string}
 */
export function scenarioBookName(loreRecord) {
    return `Lore Book - ${loreRecord.name}`;
}

/**
 * Writes a scenario's dedicated book (built via the sandbox's buildRosterEntry
 * for any characters the scenario itself bundles -- full construction wiring
 * happens the same way as syncCharacterBook/syncLocationBook, omitted here for
 * brevity since this task focuses on the book-level activate/deactivate
 * contract) and activates it as a whole book.
 * @param {object} stContext
 * @param {(name: string, args: any[]) => Promise<any>} callFunction
 * @param {import('./settings.js').WeylandRegistrarSettings} settings
 * @param {object} loreRecord - raw record from /lore/list
 */
export async function activateScenario(stContext, callFunction, settings, loreRecord) {
    const bookName = scenarioBookName(loreRecord);
    const rosterEntry = await callFunction('buildRosterEntry', [5000, `[SCENARIO]\n${loreRecord.greeting ?? ''}\n[END SCENARIO]`]);
    const book = { entries: { [rosterEntry.uid]: rosterEntry } };

    await stContext.saveWorldInfo(bookName, book, true);
    await stContext.updateWorldInfoList();
    await stContext.executeSlashCommandsWithOptions(`/world state=on silent=true "${bookName}"`);

    settings.scenarioBooks[loreRecord.loreId] = { active: true, book: bookName };
}

/**
 * Deactivates a scenario's book WITHOUT deleting it from disk -- re-activating
 * later should not require re-fetching/rebuilding, matching the caching
 * philosophy for characters/locations.
 * @param {object} stContext
 * @param {import('./settings.js').WeylandRegistrarSettings} settings
 * @param {{loreId: string}} loreRecord
 */
export async function deactivateScenario(stContext, settings, loreRecord) {
    const state = settings.scenarioBooks[loreRecord.loreId];
    const bookName = state?.book ?? scenarioBookName(loreRecord);
    await stContext.executeSlashCommandsWithOptions(`/world state=off silent=true "${bookName}"`);
    settings.scenarioBooks[loreRecord.loreId] = { active: false, book: bookName };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/scenarioBooks.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/scenarioBooks.js test/scenarioBooks.test.js
git commit -m "Add per-scenario dedicated lorebook activate/deactivate"
```

---

## Task 15: World Info panel toolbar button

**Files:**
- Create: `lib/ui/toolbarButton.js`

**Interfaces:**
- Consumes: an `onClick` callback (wired to the modal's open function in Task 17).
- Produces: `injectToolbarButton(onClick): void`.
- **No unit test** — pure DOM injection, browser-only, verified via live-browser E2E in Task 17.

- [ ] **Step 1: Write the implementation**

```js
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
```

- [ ] **Step 2: Commit**

```bash
git add lib/ui/toolbarButton.js
git commit -m "Add World Info panel toolbar button injection"
```

---

## Task 16: Browsing modal + item list

**Files:**
- Create: `lib/ui/modal.js`
- Create: `lib/ui/itemList.js`
- Create: `template.html`
- Create: `style.css`

**Interfaces:**
- Consumes: the catalog cache (Task 10), `resolveItemActive` (Task 3), `parseSearchTerms`/`matchesTerms` (Task 7), activation callbacks wired in Task 17.
- Produces: `openModal(state): void`, `renderItemList(container, items, { onActivate, onDeactivate, resolveActive })`.
- **No unit test** — DOM rendering/event delegation, browser-only, verified via live-browser E2E in Task 17.

- [ ] **Step 1: Write `template.html`**

```html
<div id="wreg-modal-overlay" class="wreg-modal-overlay">
  <div class="wreg-modal-window">
    <div class="wreg-modal-header">
      <div class="wreg-tab-bar">
        <div class="wreg-tab" data-type="character">Characters</div>
        <div class="wreg-tab" data-type="location">Locations</div>
        <div class="wreg-tab" data-type="collection">Collections</div>
        <div class="wreg-tab" data-type="lore">Lore</div>
        <div class="wreg-tab" data-type="local">My Local Collections</div>
      </div>
      <input type="search" id="wreg-search" placeholder="Search... (species:neko owner:name)">
      <div id="wreg-refresh-catalog" class="menu_button fa-solid fa-arrows-rotate" title="Refresh Catalog"></div>
      <div id="wreg-modal-close" class="menu_button fa-solid fa-xmark"></div>
    </div>
    <div id="wreg-item-list" class="wreg-item-list"></div>
  </div>
</div>
```

- [ ] **Step 2: Write `lib/ui/itemList.js`**

```js
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
```

- [ ] **Step 3: Write `lib/ui/modal.js`**

```js
// lib/ui/modal.js
import { renderItemList } from './itemList.js';
import { parseSearchTerms, matchesTerms } from '../filterQuery.js';

let modalElement = null;

/**
 * Opens (creating on first call) the browsing modal.
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
    if (!modalElement) {
        modalElement = buildModalElement(state);
        document.body.appendChild(modalElement);
    }
    modalElement.style.display = 'flex';
    renderCurrentTab(state, 'character');
}

function buildModalElement(state) {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = document.getElementById('wreg-modal-template')?.innerHTML ?? '';
    const overlay = wrapper.firstElementChild;

    overlay.querySelectorAll('.wreg-tab').forEach((tab) => {
        tab.addEventListener('click', () => renderCurrentTab(state, tab.dataset.type));
    });
    overlay.querySelector('#wreg-modal-close').addEventListener('click', () => {
        overlay.style.display = 'none';
    });
    overlay.querySelector('#wreg-refresh-catalog').addEventListener('click', () => state.onRefreshCatalog());
    overlay.querySelector('#wreg-search').addEventListener('input', (e) => {
        overlay.dataset.searchQuery = e.target.value;
        renderCurrentTab(state, overlay.dataset.currentType ?? 'character');
    });

    return overlay;
}

function renderCurrentTab(state, type) {
    modalElement.dataset.currentType = type;
    const container = modalElement.querySelector('#wreg-item-list');
    const items = state.getItemsForType(type);
    const query = modalElement.dataset.searchQuery ?? '';
    const terms = parseSearchTerms(query);
    const filtered = terms.length && items.every(i => i.searchBlob)
        ? items.filter(item => matchesTerms(item.searchBlob, terms))
        : items;

    renderItemList(container, filtered, {
        onActivate: state.onActivate,
        onDeactivate: state.onDeactivate,
        resolveActive: state.resolveActive,
        resolveForced: state.resolveForced,
    });
}
```

- [ ] **Step 4: Write minimal `style.css`**

```css
.wreg-modal-overlay {
    display: none;
    position: absolute;
    inset: 0;
    z-index: 9999;
    background: rgba(0, 0, 0, 0.6);
    align-items: center;
    justify-content: center;
}

.wreg-modal-window {
    width: min(900px, 90vw);
    height: min(700px, 85vh);
    background: var(--SmartThemeBlurTintColor, #1e1e1e);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.wreg-modal-header {
    display: flex;
    align-items: center;
    gap: 0.5em;
    padding: 0.5em;
    border-bottom: 1px solid var(--SmartThemeBorderColor, #444);
}

.wreg-tab-bar {
    display: flex;
    gap: 0.25em;
}

.wreg-tab {
    padding: 0.3em 0.6em;
    cursor: pointer;
    border-radius: 4px;
}

.wreg-item-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.5em;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.5em;
}

.wreg-item-card {
    border: 1px solid var(--SmartThemeBorderColor, #444);
    border-radius: 6px;
    padding: 0.5em;
}

.wreg-item-card.wreg-active {
    border-color: var(--SmartThemeQuoteColor, #4caf50);
}

.wreg-forced-badge {
    font-size: 0.8em;
    opacity: 0.8;
}
```

- [ ] **Step 5: Commit**

```bash
git add lib/ui/modal.js lib/ui/itemList.js template.html style.css
git commit -m "Add browsing modal shell and item list rendering"
```

---

## Task 17: Settings drawer + extension boot wiring

**Files:**
- Create: `settings.html`
- Create: `index.js`

**Interfaces:**
- Consumes: every module from Tasks 1-16.
- Produces: the fully wired extension — this is the integration task with no new pure logic of its own.

- [ ] **Step 1: Write `settings.html`**

```html
<div class="wreg-settings inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
        <b data-i18n="Weyland-Registrar">Weyland-Registrar</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
        <label for="wreg-api-base-url" data-i18n="Registrar Base URL">Registrar Base URL</label>
        <input id="wreg-api-base-url" type="text" class="text_pole">
        <label for="wreg-refresh-interval" data-i18n="Refresh Interval (minutes)">Refresh Interval (minutes)</label>
        <input id="wreg-refresh-interval" type="number" class="text_pole" min="5">
    </div>
</div>
```

- [ ] **Step 2: Write `index.js`**

```js
// index.js
import { resolveExtensionBasePath } from './lib/location.js';
import { getSettings } from './lib/settings.js';
import { injectToolbarButton } from './lib/ui/toolbarButton.js';
import { openModal } from './lib/ui/modal.js';
import { createCatalogCache, createIndexedDbStorageEngine } from './lib/catalogCache.js';
import { fetchCharacterList, fetchLocationList, fetchCollectionList, fetchLoreList, toItemKey, buildSearchBlob } from './lib/registrarApi.js';
import { createEntrySandbox } from './lib/entrySandbox.js';
import { syncCharacterBook, syncLocationBook } from './lib/worldInfoWriter.js';
import { resolveItemActive } from './lib/activationState.js';
import { resolveCollectionMembers } from './lib/collectionResolver.js';

const EXTENSION_BASE_PATH = resolveExtensionBasePath(import.meta.url);

let sandboxHandle = null;
let catalogCache = null;

function getStContext() {
    return SillyTavern.getContext();
}

async function ensureSandbox(settings) {
    if (!sandboxHandle) {
        sandboxHandle = await createEntrySandbox(settings.apiBaseUrl);
    }
    return sandboxHandle;
}

function buildResolvedCollections(settings, catalog) {
    const result = {};
    for (const [id, collectionState] of Object.entries(settings.collections)) {
        if (settings.localCollections[id]) {
            result[id] = { active: !!collectionState.active, memberKeys: settings.localCollections[id].memberKeys };
        } else {
            const record = (catalog.collections ?? []).find(c => String(c.collectionId) === id);
            result[id] = { active: !!collectionState.active, memberKeys: record ? resolveCollectionMembers(record, catalog) : [] };
        }
    }
    return result;
}

async function refreshCatalog(settings) {
    const [characters, locations, collections, lore] = await Promise.all([
        fetchCharacterList(settings.apiBaseUrl),
        fetchLocationList(settings.apiBaseUrl),
        fetchCollectionList(settings.apiBaseUrl),
        fetchLoreList(settings.apiBaseUrl),
    ]);
    const taggedCharacters = characters.map(r => ({ ...r, itemKey: toItemKey(r, 'character'), searchBlob: buildSearchBlob(r, 'character') }));
    const taggedLocations = locations.map(r => ({ ...r, itemKey: toItemKey(r, 'location'), searchBlob: buildSearchBlob(r, 'location') }));

    await catalogCache.setCharacters(taggedCharacters);
    await catalogCache.setLocations(taggedLocations);
    await catalogCache.setCollections(collections);
    await catalogCache.setLore(lore);
    await catalogCache.setLastRefreshed(Date.now());

    return { characters: taggedCharacters, locations: taggedLocations, collections, lore };
}

async function syncBooks(settings) {
    const catalog = {
        characters: (await catalogCache.getCharacters()) ?? [],
        locations: (await catalogCache.getLocations()) ?? [],
        collections: (await catalogCache.getCollections()) ?? [],
    };
    const resolvedCollections = buildResolvedCollections(settings, catalog);
    const settingsForSync = { ...settings, collections: resolvedCollections };

    const sandbox = await ensureSandbox(settings);
    const stContext = getStContext();

    const charactersByKey = Object.fromEntries(catalog.characters.map(r => [r.itemKey, r]));
    const locationsByKey = Object.fromEntries(catalog.locations.map(r => [r.itemKey, r]));

    await syncCharacterBook(stContext, sandbox.callFunction, settingsForSync, charactersByKey);
    await syncLocationBook(stContext, sandbox.callFunction, settingsForSync, locationsByKey);
}

async function initModal(settings) {
    const catalog = {
        characters: (await catalogCache.getCharacters()) ?? [],
        locations: (await catalogCache.getLocations()) ?? [],
        collections: (await catalogCache.getCollections()) ?? [],
        lore: (await catalogCache.getLore()) ?? [],
    };
    const resolvedCollections = buildResolvedCollections(settings, catalog);

    openModal({
        getItemsForType: (type) => {
            if (type === 'character') return catalog.characters;
            if (type === 'location') return catalog.locations;
            if (type === 'collection') return catalog.collections.map(c => ({ itemKey: c.collectionId, name: c.name, summary: c.summary }));
            if (type === 'lore') return catalog.lore.map(l => ({ itemKey: l.loreId, name: l.name, summary: l.summary }));
            if (type === 'local') return Object.entries(settings.localCollections).map(([id, c]) => ({ itemKey: id, name: c.name }));
            return [];
        },
        resolveActive: (itemKey) => resolveItemActive(itemKey, settings.itemStates, resolvedCollections),
        resolveForced: (itemKey) => settings.itemStates[itemKey] ?? 'none',
        onActivate: async (itemKey) => {
            settings.itemStates[itemKey] = 'active';
            await syncBooks(settings);
            getStContext().saveSettingsDebounced();
        },
        onDeactivate: async (itemKey) => {
            settings.itemStates[itemKey] = 'inactive';
            await syncBooks(settings);
            getStContext().saveSettingsDebounced();
        },
        onRefreshCatalog: async () => {
            await refreshCatalog(settings);
            await syncBooks(settings);
        },
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

jQuery(async () => {
    const context = getStContext();
    const settings = getSettings(context.extensionSettings);
    catalogCache = createCatalogCache(createIndexedDbStorageEngine());

    await addExtensionSettings(settings);
    injectToolbarButton(() => initModal(settings));

    if (!(await catalogCache.getCharacters())) {
        await refreshCatalog(settings);
    }
});
```

- [ ] **Step 3: Manual E2E verification (Playwright, per house process)**

Following the weyland-tavern-dev skill's live-testing conventions (LAN IP + HTTP Basic Auth, not localhost):

1. Start the Weyland Tavern server, open a Playwright browser session against the real LAN URL.
2. Confirm the toolbar button renders next to Refresh in the World Info panel, in both standard UI and with Streamlined UI enabled (toggle it via its own settings and reload).
3. Click the button, confirm the modal opens and the Characters tab populates from a real `/data/list` fetch.
4. Activate one character. Confirm: `Lore Book - Weyland Registrar.json` is created/updated on disk with the character's entry cluster plus a single Character Roster entry; the World Info panel's book dropdown includes it; the book shows as globally active without a manual refresh.
5. Activate a second character, confirm the Character Roster entry now lists both (not just the second one overwriting the first — this is the regenerate-from-scratch invariant).
6. Deactivate the first character, confirm its entries are removed and the roster entry updates to list only the second.
7. Repeat activate/deactivate once for a location against `World Book - Community Locations.json`.
8. Activate a Registrar collection containing both characters and locations, confirm characters land only in the character book and locations only in the location book (never merged together).
9. Create a local collection from two already-cached items, activate it, confirm same behavior as a Registrar collection.
10. Deactivate one of two collections sharing a member, confirm the shared member stays active; then individually deactivate that member directly, confirm it is removed even though the other collection is still active.
11. Activate a lore/scenario item, confirm its own dedicated `Lore Book - <name>.json` is created and activated as a whole book, separate from the two shared books.
12. Confirm no console errors from the sandboxed iframe execution, and confirm the iframe stays hidden throughout.

- [ ] **Step 4: Commit**

```bash
git add settings.html index.js
git commit -m "Wire extension boot: settings drawer, toolbar button, catalog refresh, sync"
```

---

## Self-Review

**Spec coverage:**
- §4 (path-independence) → Task 1.
- §5 (Registrar API, CORS routing) → Task 9.
- §6 (sandboxed entry construction, keysecondary fidelity) → Tasks 11, 12.
- §7 (WI write/activation sequence, no internal imports) → Task 13.
- §8 (content types, roster/location-list invariant, uid schemes) → Tasks 4, 5, 13, 14.
- §9 (activation model) → Task 3.
- §10 (local collections) → Task 6.
- §11 (ownership model) → Task 13's full-rebuild-from-active-set contract (superseding §11's original mapping-based description; both `settings.itemOwnership` and `updateOwnership` were removed as dead code during pre-flight review, confirmed with the user -- the full rebuild achieves exclusive-ownership behavior more robustly without needing a persisted uid mapping).
- §12 (security rationale) → Task 11's design, documented inline.
- §13 + §13.1 (UI, WI panel entry point) → Tasks 15, 16.
- §14 (two-tier caching) → Task 10.
- §15 (testing approach, accepted browser-only gaps) → called out explicitly in Tasks 10, 11, 15, 16.

**Placeholder scan:** no TBD/TODO; every code step has complete, real implementations; no "similar to Task N" shortcuts — Task 14's scenario activation duplicates the write/activate sequence explicitly rather than referring back to Task 13.

**Type consistency fix applied during review:** Task 13's original draft referenced `settings.collections[id].memberKeys` directly, which conflicts with Task 2's settings shape (`collections` only stores `{active, source}`; member resolution is a join the caller must do). Fixed by having `syncCharacterBook`/`syncLocationBook` accept pre-resolved `settings.collections` (documented in `resolveCollectionsForActivation`'s docstring) and having Task 17's `index.js` be the one place that performs the join (`buildResolvedCollections`), consistent with Task 3's stated contract that `collections` passed to `resolveAllActive` must already carry `memberKeys`.

---

Plan complete and saved to `docs/plans/2026-07-20-weyland-registrar-implementation.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
