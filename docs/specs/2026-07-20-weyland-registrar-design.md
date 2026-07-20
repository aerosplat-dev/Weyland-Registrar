# Weyland-Registrar — Design Spec

**Date:** 2026-07-20
**Status:** Approved for planning (pending final user sign-off on this document)

## 1. Purpose

registrar.weybooru.com is a community site where Weyland Tavern players create and share
original characters, locations, and scenarios. Today, using that content requires a fully
manual round trip: browse the site, download a `.json` World Info export, then import it by
hand into SillyTavern. This extension replaces that entire round trip with an in-app browser:
users browse the Registrar's catalog, and activating/deactivating a character, location,
collection, or scenario is a single click that directly edits the right World Info lorebook and
refreshes the running SillyTavern instance — no downloads, no manual imports.

## 2. Goals

- Browse Registrar characters, locations, collections, and lore/scenarios from inside Weyland
  Tavern, with search/tag filtering equivalent to the site's own.
- Activate/deactivate any character or location with one action; the extension maintains two
  shared, extension-owned lorebooks reflecting exactly what's currently active.
- Activate/deactivate collections (official Registrar collections or user-created local
  collections) as a convenience for selecting groups of characters/locations — never as a
  third storage location.
- Activate/deactivate lore/scenario items, each as its own dedicated lorebook, matching the
  Registrar's own per-item file convention.
- Every mutation is immediately reflected in the running SillyTavern client — no stale caches,
  no "reload the page" workaround.

## 3. Non-goals

- No support for uploading/editing content back to the Registrar (read-only consumer).
- No handling of the Registrar's `/lore/list` content beyond what's in scope per §8 (each
  scenario is self-contained; no cross-scenario merging).
- No attempt to reconcile a managed lorebook with entries a user added by hand outside this
  extension — see §11 (Ownership model).

## 4. Location & path-independence

Nested-repo extension at `data/default-user/extensions/Weyland-Registrar/` (own `.git`, own
`aerosplat-dev` remote — house convention for new first-party extensions), **but it must run
correctly if later relocated to `public/scripts/extensions/Weyland-Registrar/` with zero code
changes.** This is a hard, explicitly-reinforced requirement (this exact bug — hardcoded
`'third-party/<Name>'`-style path assumptions — has broken multiple Weyland extensions before,
including WeyPhone, whose own real-world lifecycle went nested-repo → later promoted to the
bundled tree).

Concretely:
- No hardcoded `'third-party/Weyland-Registrar'` string anywhere.
- One init-time helper derives the extension's own base path from `import.meta.url`
  (`new URL('.', import.meta.url).pathname.replace(/^\/scripts\/extensions\//, '').replace(/\/$/, '')`),
  reused everywhere a location-relative string is needed (e.g. the `renderExtensionTemplateAsync`
  prefix).
- No relative-depth imports into SillyTavern core (`../../world-info.js` vs
  `../../../world-info.js`) — per §7, none are needed at all.

## 5. Registrar API integration

Confirmed live, public, unauthenticated GET endpoints (verified directly against
registrar.weybooru.com):

| Endpoint | Content | CORS |
|---|---|---|
| `GET /data/list` | All characters (raw fields) | `Access-Control-Allow-Origin: *` — fetch directly |
| `GET /loci/list` | All locations (raw fields) | none — route through SillyTavern's `/proxy/<url>` passthrough |
| `GET /coll/list` | All collections (filter + selected/deselected ID refs) | none — route through `/proxy/<url>` |
| `GET /lore/list` | All lore/scenario items (raw fields) | none — route through `/proxy/<url>` |

`enableCorsProxy: true` is already the default in this fork (originally for weyland-status), so
routing the three CORS-less endpoints through SillyTavern's own `/proxy/<url>` requires no new
server-side work — just consistent client-side use of that existing passthrough instead of a
third-party public CORS proxy.

No query-param server-side search exists; filtering happens client-side against the full fetched
list, matching the Registrar's own `filterList()` behavior (search terms, `prop:value` field
filters, quoted phrases).

## 6. Entry construction — replicate the Registrar's own template exactly

There is no per-item "pre-built entries" endpoint. `/data/list`/`/loci/list` return raw fields
only; the actual World Info entry text (headers, roster-line format, trigger-key regex
construction) is built by the Registrar's own client-side code, in `base.js`.

**Decision: fetch the live `base.js` and execute its own entry-building functions directly**,
rather than hand-porting a static copy, so entry output is always byte-exact with whatever the
Registrar currently produces, with no ongoing manual format-maintenance burden. This was a
deliberate choice after weighing a hand-ported static alternative — see §12 for the reasoning and
the accepted residual risk.

**Verified pure-function set** (confirmed zero `document`/`window`/`fetch`/`localStorage`
references in any of these, and zero top-level auto-executing code anywhere in `base.js` — the
whole file can be loaded with no side effects until something explicitly calls one of its
`initPage_*` entry points, which we never do):
`addLoreEntries`, `addWorldEntries`, `addSubLocationEntry`, `buildRosterEntry`,
`buildLocationsEntry`, `cleanKeywords`, `addBoilerplateProperties`, `buildLoreOutfitSection`,
`parseCharacterOutfitEntries`, `parseLocationSubLocations`.

**Execution sandbox:** `base.js` is loaded into a hidden `<iframe sandbox="allow-scripts">`
(deliberately *without* `allow-same-origin`), putting its execution in a unique, opaque origin
with no access to SillyTavern's DOM, cookies, localStorage, or session state. The parent page
communicates with it only via `postMessage`: send raw character/location records in, receive
built WI entry objects back. Post-load, the parent verifies the expected functions exist
(`typeof addLoreEntries === 'function'`, etc.) before trusting the sandbox, so a broken or
unexpectedly-reshaped script fails loudly instead of silently misbehaving. The fetched script
text is cached (with its fetch timestamp) so it isn't re-fetched on every single entry build
within a session.

**Per-entry-type keys — must not be flattened.** Every entry in a character's cluster shares one
primary `key` (name + pseudonym regex triggers, `baseKey` in the Registrar's own code), but
`keysecondary` is different per entry and must be reproduced exactly as the Registrar builds it:
- Main INFO entry: `keysecondary: []`.
- Backstory/History: `keysecondary` = the character's own author-defined `backgroundKeywords`.
- Secrets: `keysecondary` = the character's own author-defined `secretsKeywords`.
- Dorm room/Housing: `keysecondary` = fixed strings (`dorm`, `apartment`, `home`, `room`, the
  character's own name + `'s room`, and the raw `dwelling` value) plus `dwelling`-derived
  keywords.
- End Section: `keysecondary: []`.

Locations follow the same pattern (main entry vs. sub-location entries, each sub-location
inheriting the parent's primary `key` plus its own `extraKeys`-derived secondary keywords).

## 7. World Info write & activation — no internal core imports needed

Confirmed by reading `world-info.js` directly: every operation this extension needs is reachable
through `getContext()` plus one built-in slash command — **no relative/internal import of core
files anywhere**, which sidesteps the bundled-vs-third-party relative-depth hazard entirely:

- `loadWorldInfo(name)` / `saveWorldInfo(name, data, true)` — read/write a book (full-file
  replace).
- `updateWorldInfoList()` — refresh the server-derived book list so a newly-written file becomes
  recognized.
- `executeSlashCommandsWithOptions('/world state=on silent=true "<book name>"')` — activate a
  book globally, idempotently (`state=off` to deactivate).

**Required sequence, never reordered:** write book (`saveWorldInfo`) → `updateWorldInfoList()` →
`/world state=on`. Skipping the middle step silently toasts "No world found" instead of erroring.

The two shared books (§8) are activated once, the first time they're created, and stay active
permanently — per-item activation happens by editing entries *inside* them, not by toggling the
books. Per-scenario books (§8) *are* toggled at the book level, since each is self-contained.

## 8. Content types & file layout

| Type | Source | Managed file(s) |
|---|---|---|
| Characters | `/data/list` | One shared `Lore Book - Weyland Registrar.json`; entries merged in/out per activation |
| Locations | `/loci/list` | One shared `World Book - Community Locations.json`; entries merged in/out per activation |
| Collections | `/coll/list` | Not a file — resolves to a set of character IDs + location IDs, merged into the two shared files above. Never bundled together as the Registrar's own download does. |
| Local collections | extension settings only | Same resolution as Registrar collections — no separate code path (see §9) |
| Lore/scenarios | `/lore/list` | **One dedicated file per scenario**, named `Lore Book - <Scenario Name>.json`, matching the Registrar's own per-item naming convention (its `getLoreBookName()` uses the same pattern). Activated/deactivated as a whole book; never merged with anything else. |

**Roster/Location-List entries are regenerated, never patched.** Exactly one `"Character
Roster"` entry (uid `5000`) and one `"Location List"` entry (uid `8000`) per shared managed book,
fully rebuilt from every currently-active item's roster-line fields on every add/remove. This is
required for correctness: `Weyland-WeyPhone/lib/registrarLorebook.js` auto-detects any World Info
book whose name contains "registrar" and parses its single "Character Roster" entry to build
phone contacts — if the managed book ever ends up with more than one such entry, WeyPhone's
`.find()` only sees the first and silently drops the rest. Keeping this invariant is what makes
"activate a character here" also transparently work as "this character is now texting-reachable
in WeyPhone," confirmed as an intended, desired side effect of this design.

**uid scheme:**
- Characters: `characterId*5 + 5001..5005` — reproduces the Registrar's own scheme exactly.
  Deterministic and collision-free (each `characterId` reserves a disjoint block of 5), so
  re-adding a previously-removed character always lands on identical uids.
- Locations: `8001 + locationId*20 + subIndex` — a scheme we own, since the Registrar's own
  location uids are just an export-time sequential counter, not stable per location. 20 slots per
  location gives generous headroom for sub-locations.

## 9. Activation model

Per item (character or location), extension-owned state is tri-state: **unset / forced-active /
forced-inactive**. Resolved active status, in priority order:

1. `forced-inactive` → inactive, full stop — overrides everything else.
2. else `forced-active` → active.
3. else member of ≥1 currently-active collection (Registrar or local) → active.
4. else → inactive.

Clicking an item's own activate/deactivate control sets `forced-active`/`forced-inactive`
directly — this always wins over collection membership in either direction. Activating or
deactivating a collection only toggles that collection's own active flag and recomputes affected
members' resolved status; it never touches another collection's active flag and never overrides
a `forced-*` flag on a member. Concretely: if character X is in two active collections and one is
deactivated, X stays active (still claimed by the other). If X was individually deactivated by
the user, no collection activation brings it back until the user clears that override themselves.

## 10. Local collections

Extension-only groupings (name + member character/location IDs), stored in
`extensionSettings['Weyland-Registrar'].localCollections`, never uploaded to the Registrar.
Participate in the exact same resolution logic as §9 — activating/deactivating a local collection
is not a separate code path from a Registrar collection.

## 11. Ownership model

The two shared managed books, and each per-scenario book, are treated as **fully owned by this
extension**. The extension tracks its own mapping of registrar `characterId`/`locationId` →
which uids it placed in which file, and uses that mapping (not a scan of file contents) to decide
what to add/remove. Manual edits a user makes directly in SillyTavern's own World Info editor to
these specific files are not preserved across the extension's own add/remove operations — this is
called out explicitly as a known tradeoff, matching how Weyland-LTM already owns its per-chat
book exclusively.

## 12. Security consideration: live execution of Registrar's `base.js`

This was an explicit, discussed tradeoff, not an oversight. The chosen approach (§6) fetches and
executes third-party code from an external community-content site inside the extension's runtime
sandbox, rather than hand-porting a static, unit-tested copy of the same ~10 functions. The
sandboxed-iframe execution model (no `allow-same-origin`) means a compromised `base.js` cannot
reach SillyTavern's DOM, session, cookies, or API keys — it is scoped to whatever data is
explicitly passed in via `postMessage` (public character/location records) and can only return
data the same way. The residual risk accepted: a compromised `base.js` could still return
malformed or subtly incorrect WI entries into the user's lorebooks, and the extension has no way
to independently verify correctness beyond the post-load function-existence check. This was an
informed choice, made after the alternative (hand-porting, zero ongoing execution risk, bounded
and checkable drift risk) was presented directly.

## 13. UI

Bespoke branded modal (matching the flagship-tool treatment of Weyland-Downloader/Weyland-Router,
not the plain settings-drawer treatment) with a type-switcher for Characters / Locations /
Collections / Lore / My Local Collections, client-side search + tag filtering, checkbox
multi-select, per-item and per-collection activate/deactivate controls, and explicit active /
inactive / forced-override state indicators so the resolution logic in §9 is never a mystery to
the user. A standard `#extensions_settings2` drawer handles lighter config (API base URL
override, refresh interval).

## 14. Caching & refresh

Two different storage tiers, not one — this distinction matters because `extensionSettings` is
persisted server-side as part of the entire `settings.json` blob on every `saveSettingsDebounced()`,
and the raw catalog is too large for that (`/data/list` alone is 3.5MB):

- **Lightweight state** (activation overrides from §9, local collection definitions from §10, the
  ownership mapping from §11) → `extensionSettings['Weyland-Registrar']`, following house
  convention. This is small (bookkeeping only, no bulk content) and must persist reliably through
  Weyland Tavern's normal settings sync.
- **Bulk catalog cache** (raw fetched records from all four list endpoints, and resolved
  entry-clusters) → browser-local IndexedDB, never routed through `extensionSettings`. Sized for
  multi-megabyte data, doesn't bloat `settings.json`, and doesn't get re-transmitted on unrelated
  settings saves.

Re-activating a previously-seen item, or building a local collection, reads from the IndexedDB
cache and never requires a re-fetch. A manual "Refresh Catalog" action re-pulls all four list
endpoints. Each record's `updatedAt` field allows flagging "source updated since you activated
this" per item — a nice-to-have, not required for v1.

## 15. Testing approach

- Pure-logic modules (activation-state resolution in §9, uid assignment in §8, roster/
  location-list regeneration) get full `node --test` unit coverage.
- Entry construction (§6) is tested by feeding the sandboxed `base.js` execution known raw
  records and diffing output against the real sample files already confirmed on disk
  (`Collection - Dean's Listers.json` etc.) as ground truth.
- Browser-only orchestration (modal UI, event delegation, WI write/refresh sequencing) is a
  deliberately accepted zero-automated-coverage area, verified instead via live-browser E2E
  (Playwright) per house process — called out explicitly, not left unstated.
