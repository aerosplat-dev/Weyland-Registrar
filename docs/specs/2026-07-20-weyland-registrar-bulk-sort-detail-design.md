# Weyland-Registrar: Bulk Selection, Sort, Collection Members, Character Reveal Fields

## Context

The Registrar browsing UI (list/detail split, drag/resize, local collections) shipped and was
live-verified against the real registrar.weybooru.com in the prior redesign round. The user, after
using the shipped extension, requested four additions:

1. Bulk-select checkboxes + Activate/Deactivate for the selection.
2. Sort by name, creation date, last updated, author.
3. A list of collection members in every collection's detail view.
4. "Show Background/History" and "Show Secrets" buttons in every character's detail view.

Live inspection of the real Registrar API (`/data/list`, `/loci/list`, `/coll/list`, `/lore/list`)
confirmed every record type carries `name`, `createdAt`, `updatedAt`, `ownerName` uniformly, which
sort depends on. It also surfaced a real, pre-existing bug relevant to item 3 (below).

## 1. Bulk selection + Activate/Deactivate

- A checkbox is added to the left of every row in `itemList.js`, class `wreg-row-select` (parallel
  to the existing toggle's `wreg-row-toggle`), visually and interactively distinct from the
  existing activate/deactivate toggle switch on the right (different control shape, own column) —
  selecting an item for a bulk action must never read as activating it. Same
  `stopPropagation`-on-click-and-scoped-keydown isolation from the row's own click-opens-detail
  handler that `wreg-row-toggle` already uses (see `itemList.js`'s existing comment on that
  pattern) — without it, clicking the new checkbox would also open the detail view.
- Selection state is a `Set<itemKey>` held in `modal.js`'s existing module-level state (alongside
  `currentState`/`dragHandle`). It is **cleared when the active tab changes**, but **survives**
  search-text and active-only-filter changes within the same tab — matching how those two existing
  filters already behave (independent of each other, scoped to the current tab's rendering).
- Applies uniformly to all 5 tabs (character, location, collection, lore, local). Bulk-activating
  several collections or lore items at once is as legitimate a use case as bulk-activating several
  characters.
- When the selection is non-empty, a bulk-action bar appears above the item list (below the
  tab bar/search controls, inside `.wreg-list-header` in `template.html`), hidden (`display:none`)
  by default:
  - `<div id="wreg-bulk-bar">` containing `<span id="wreg-bulk-count">` (text `"N selected"`),
    `<button id="wreg-bulk-activate">Activate</button>`,
    `<button id="wreg-bulk-deactivate">Deactivate</button>`,
    `<button id="wreg-bulk-clear">Clear</button>`.
  - `modal.js` toggles `#wreg-bulk-bar`'s visibility and `#wreg-bulk-count`'s text every time the
    selection changes (checkbox click) or the tab changes (selection cleared).
- Clicking `#wreg-bulk-activate`/`#wreg-bulk-deactivate` calls the new batched function (below)
  with the current selection's itemKeys, then clears the selection and re-renders the current tab.
  `#wreg-bulk-clear` clears the selection (and hides the bar) without touching activation state.

### Batched activation — why a new code path is required

The existing `handleToggle(itemKey, makeActive)` in `index.js` awaits a full `syncBooks(settings)`
per call. `syncBooks` fully rebuilds both managed World Info books (`syncCharacterBook`,
`syncLocationBook`), including regenerating the single consolidated "Character Roster" entry
Weyland-WeyPhone depends on. Looping `handleToggle` over N selected items means N full rebuilds of
that entry — needlessly slow and needlessly re-racing a load-bearing shared entry N times instead
of once.

New function `handleBulkToggle(itemKeys, makeActive)` in `index.js`:

1. Partition `itemKeys` by `classifyItemKey(itemKey)` into `item` (character/location),
   `collection` (registrar or local), and `lore`.
2. For every `item` key: `settings.itemStates[itemKey] = makeActive ? 'active' : 'inactive'`
   (synchronous, same assignment `handleToggle` already does for this kind).
3. For every `collection` key: `settings.collections[key] = { active: makeActive, source: existing?.source ?? (settings.localCollections[key] ? 'local' : 'registrar') }`
   (synchronous, same assignment `handleToggle` already does for this kind).
4. For every `lore` key: call `activateScenario`/`deactivateScenario` individually (each writes to
   its own uniquely-named book — there is no shared entry to batch, and no way to batch them
   further), run concurrently via `Promise.all`, not sequentially.
5. After steps 2–3 are applied (all synchronous, no book writes yet) and step 4 is kicked off, call
   `syncBooks(settings)` exactly once, awaited alongside the lore `Promise.all`.
6. `getStContext().saveSettingsDebounced()` once at the end.

`handleToggle` itself is unchanged and keeps being used for single-item toggles (the row switch,
the detail-pane Activate/Deactivate button) — `handleBulkToggle` is purely additive, for the new
bulk-action bar only.

## 2. Sort

- A `<select id="wreg-sort">` with four `<option>`s (`value="name"` Name, `value="created"`
  Created, `value="updated"` Last Updated, `value="author"` Author) plus a direction toggle button
  `<button id="wreg-sort-direction">` (text content `▲` for ascending / `▼` for descending, toggles
  on click) are added to `template.html`'s `.wreg-list-controls`, next to the existing search box.
- One shared sort preference (field + direction), stored the same way the existing search text is
  (`portalElement.dataset.sortField` / `portalElement.dataset.sortDirection`), applied to whichever
  tab is currently shown. Default: `sortField = 'name'`, `sortDirection = 'asc'`.
- Field → record-property mapping (all four fetched record kinds — character, location,
  collection, lore — carry all four uniformly, confirmed against the live API), implemented as a
  new pure function `sortItems(items, field, direction)` in a new file `lib/ui/sortItems.js`:
  - `name` → `record.name`, locale-aware string compare (`localeCompare`).
  - `created` → `record.createdAt`, parsed via `new Date(value).getTime()` and compared
    numerically.
  - `updated` → `record.updatedAt`, same.
  - `author` → `record.ownerName`, locale-aware string compare.
  - Items missing the sorted-on field (e.g. a local collection missing `createdAt`) sort to the
    end of the list regardless of direction, rather than clustering at `NaN`/`undefined`'s
    otherwise-undefined comparator position.
- Local collections have none of `createdAt`/`updatedAt`/`ownerName` (they are user-created, never
  fetched from the Registrar). While the "My Local Collections" tab is active, `modal.js` sets the
  `created`/`updated`/`author` `<option>`s' `disabled` property to `true` (re-enabled when leaving
  the tab); if the stored `sortField` was one of those when the user switches to this tab,
  rendering falls back to `name`/`asc` for this tab's render only — `portalElement.dataset` itself
  is left untouched, so switching to any other tab resumes the user's actual stored choice.
- Sort is applied to the list in `modal.js`'s `renderCurrentTab`, after the existing search-term
  filter and after the existing active-only filter (so it always reflects exactly what's visible).

## 3. Collection member list — bug fix, not new build

`detailPane.js` already renders a `"Members"` field (`appendField(container, 'Members',
detail.memberNames.join(', '))`) whenever `detail.memberNames` is non-empty. The gap is upstream:
`buildResolvedCollections` in `index.js` only computes an entry for a collection id that already
exists in `settings.collections` — which is only created the first time a collection is toggled
(for local collections, immediately on creation; for **registrar-native** collections, not until
first activate/deactivate). A registrar collection viewed before ever being toggled — the common
first-view case — silently resolves to zero members. Confirmed live against the real
"Josh's Squirrel Hole" collection on registrar.weybooru.com: `Members` field did not render at all.

Fix, in `getItemDetail`'s `'collection'` branch (`index.js`): for a non-local collection, resolve
`memberKeys` directly via `resolveCollectionMembers(record, catalog)` (already imported, already
used inside `buildResolvedCollections` — just called one level earlier so it doesn't depend on a
`settings.collections` entry existing) instead of reading `resolvedCollections[key]?.memberKeys`.
The `isActive` flag is unaffected (correctly defaults to `false` via `!!undefined` when never
toggled — that part has no bug).

Additionally, render members as an actual list rather than one comma-joined line: `detailPane.js`
gets a small ordered rendering (one member name per row, plain text, non-interactive — clicking a
member to jump to its own detail is deliberately out of scope for this pass) instead of the single
`appendField` call.

## 4. "Show Background/History" / "Show Secrets" buttons

Character-only (per the request), added to `detailPane.js`'s character branch, below the existing
curated fields. Two buttons, each independently toggling a hidden field-group directly below it;
button label flips `Show ⇄ Hide` on click (mirrors the existing Activate/Deactivate label-flip
pattern). Both collapsed by default — consistent with `detailFields.js`'s own existing rationale
for excluding these fields from the curated set ("not needed to decide whether to activate
someone"), just made available on demand instead of omitted outright.

Confirmed field mapping (user's choice):
- **Show Background/History** reveals `knownBackground` (label "Background") and
  `backgroundFriends` (label "Background Friends").
- **Show Secrets** reveals `hiddenBackground` (label "Hidden Background") and `secrets`
  (label "Secrets") together — `hiddenBackground` is explicitly named as hidden content, the same
  spoiler tier as `secrets`, not public background.

`*Keywords` fields (`backgroundKeywords`, `secretsKeywords`) are Registrar-internal search-index
fields, not display content — neither button surfaces them, matching how `tags`'s own raw
JSON-encoded form is already never shown directly (only via `formatTags`).

New function in `lib/ui/detailFields.js`, `buildRevealableFields(record, section)` where
`section` is `'background'` or `'secrets'`, returning the same `{label, value}[]` shape as
`buildDetailFields`, empty-field-omitted the same way. `detailPane.js` calls it lazily (only when
a button is clicked, not on initial render) and keeps a local expanded/collapsed boolean per
section, reset each time `renderDetailPane` is called fresh for a different item.

## Testing

- Pure logic — sort comparators, `handleBulkToggle`'s per-kind partitioning, the
  `resolveCollectionMembers`-based fix, `buildRevealableFields` — gets full `node --test` unit
  coverage, matching every prior task in this codebase.
- DOM wiring (checkbox rendering, bulk-action-bar show/hide, sort `<select>`/direction-toggle
  wiring, per-tab option disabling, reveal-button click handling) is browser-only orchestration
  code — verified via live Playwright E2E only, matching this codebase's established, explicitly
  accepted zero-automated-coverage convention for this class of code.

## Out of scope

- Making collection-member rows in the detail view clickable/interactive (jump to that member's
  own detail). Plain list only, this pass.
- Persisting or exposing `backgroundKeywords`/`secretsKeywords` anywhere in the UI.
- Cross-tab bulk selection (selecting characters, then switching to locations and adding more to
  the same selection). Selection is explicitly per-tab and clears on tab switch.
- Any change to `handleToggle`'s existing single-item behavior, or to World Info sync semantics
  for anything other than batching the number of `syncBooks` calls during a bulk action.
