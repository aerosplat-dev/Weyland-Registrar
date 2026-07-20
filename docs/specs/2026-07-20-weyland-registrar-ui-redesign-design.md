# Weyland-Registrar UI Redesign — Design Spec

**Date:** 2026-07-20
**Status:** Approved for planning (pending final user sign-off on this document)
**Supersedes:** Task 16's plain grid-card modal UI (original spec §13, §13.1 unchanged — the WI panel entry point stays as-is)

## 1. Purpose

The functional core of Weyland-Registrar (browse, activate/deactivate characters/locations/collections/lore against the live Registrar) shipped and works end-to-end — confirmed live against the real registrar.weybooru.com. But the operator reviewed the shipped UI directly and found it genuinely lacking: a plain 3-column card grid with no visual identity, no way to see more than a one-line summary per item, no mobile consideration, and — separately — a real functional gap the final whole-branch review flagged: no UI anywhere lets a user create a local collection, only list existing ones.

This spec covers a full redesign of the modal's UI layer (`lib/ui/modal.js`, `lib/ui/itemList.js`, `template.html`, `style.css`) plus the small amount of new wiring in `index.js` needed for local-collection management. It does **not** touch any of the activation/sync/data logic built in Tasks 1-14, 17 (`lib/activationState.js`, `lib/worldInfoWriter.js`, `lib/scenarioBooks.js`, `lib/registrarApi.js`, `lib/collectionResolver.js`, etc.) — those are already correct, tested, and reviewed.

## 2. Goals

- Replace the 3-column card grid with a single-column, vertically scrollable list, matching Weyland-Router's row component visually.
- Add a detail view per item (portrait + curated fields), reachable by clicking anywhere on a row except its activate/deactivate control.
- Add an active-only filter per tab.
- Add a full local-collection management flow: create, rename, edit membership, delete — closing the gap the final review flagged.
- Adopt Weyland-Router's visual design language (colors, typography, modal chrome, button/toggle/row styling, animations) as confirmed by directly rendering Router's live UI in this session — not by copying its CSS text-only from a description.
- **Be genuinely good on both desktop and mobile — this is a first-class requirement, not an afterthought.** Every section below states its desktop behavior and its mobile behavior explicitly; a section that doesn't have a distinct mobile behavior says so and why the desktop behavior already works fine at small sizes.

## 3. Non-goals

- No changes to any backend/data/activation logic.
- No changes to the World Info panel toolbar button's own placement/injection (Task 15, already reviewed and correct).
- No attempt to make the modal's drag/resize position persist across reopens — Router itself doesn't persist this either (confirmed from its own source), so matching that exact characteristic (reset to a default position/size on each open) is intentional, not a gap.

## 4. Visual design system

Extracted from Weyland-Router's source and confirmed by directly rendering its live modal in this session (screenshot-verified, not just read from CSS text).

**Colors:**
- Brand accent: crimson `#b4263a`, used at varying opacity (`rgba(180,38,58,0.04)` through `0.98`) for backgrounds, borders, glows.
- Primary text: `#e8e8e8` / `#e0e0e0`. Muted/secondary text: `#888` / `#777` / `#666`.
- Accent text (headers, primary buttons, active states): `#ffaab5` (softer pink) and `#ff6b80` (brighter pink), titlebar wordmark `#e0445c`.
- Status colors: success green `#28c840`, warning amber `#febc2e`, danger red `#ff5f57`.
- **Do not reuse the shared `--rb-accent` CSS custom property.** It's inconsistently defined across the Weyland extension family (Weyland-Downloader/weybooru-viewer define it as white `#ffffff`; Router only *consumes* it with a crimson fallback, never defines it itself) — defining or depending on it here risks an unintended cross-extension collision if multiple of these extensions' stylesheets are loaded on the same page. Weyland-Registrar defines its own scoped custom properties instead (e.g. `--wreg-accent: #b4263a`), matching Router's actual crimson value without touching the shared, ambiguously-owned token.

**Typography:** `'JetBrains Mono', monospace` throughout all UI chrome (labels, buttons, inputs, item names). Section/field labels are uppercase with letter-spacing (`1-1.5px`). Font sizes range 10-16px for UI text, matching Router's scale.

**Modal chrome (desktop):** `border-radius:10px`, `border:1px solid rgba(180,38,58,0.35)`, background `linear-gradient(180deg, rgba(20,14,18,0.97) 0%, rgba(12,8,11,0.97) 100%)` plus a subtle radial crimson wash at the top, `box-shadow:0 20px 60px rgba(0,0,0,0.8), 0 0 1px rgba(180,38,58,0.4)`, `backdrop-filter:blur(20px)`. Titlebar: 40px tall, darker gradient, bottom border with a crimson gradient underline.

**Row component** (replaces the current card grid): matches Router's `.wtr-model-row` — subtle crimson gradient background, `border-radius:5px`, a 2px crimson left-accent border, hover brightens the left border and nudges `translateX(1px)`.

**Buttons:** primary action (crimson gradient, pink text, hover lift+glow) for "Activate"/"+ New Collection"; small neutral buttons (hover-to-crimson) for secondary actions; 26×26px icon buttons for compact controls (close, refresh, back).

**Toggle switch:** 36×20px track, grey-off / crimson-pink-on thumb, `cubic-bezier(0.4,0,0.2,1)` transition — used for the activate/deactivate control per row and the active-only filter.

**Animations:** Router's own inline `animation: wtr-open 0.2s ease` references a `@keyframes wtr-open` that **does not exist** in its stylesheet — confirmed by reading the full CSS file, meaning Router's modal actually just appears instantly today despite the reference. Weyland-Registrar defines its own working `@keyframes wreg-open` (opacity + slight scale-in, ~0.2s ease) rather than copying this latent gap.

## 5. Layout architecture

**Desktop (`min-width:701px` and not `pointer:coarse`):** a floating, draggable, resizable window (matching Router's mechanic — see §9), positioned via `left`/`top` inline styles clamped to the viewport, `resize:both`, `min-width`/`min-height` floors. Body is a flex row: **list pane** (full width when no item is selected; ~50% width, left side, when the detail pane is open) and **detail pane** (appears only once an item is clicked, right ~50%, its own independent vertical scroll).

**Mobile (`max-width:700px` or `pointer:coarse` — identical breakpoint to Router's own, confirmed from its CSS):** the modal becomes `position:fixed;inset:0`, full viewport (`100dvw`/`100dvh`), no border-radius, no drag, no resize (all consistent with how Router itself degrades on mobile — confirmed from its media query). The list/detail split is **not** a side-by-side layout at this width — it's two full-screen views. Selecting an item swaps the visible view from list to detail (a lightweight internal view-state, not a route/URL change) and shows a back button in the detail view's own header; the list view's own header (tabs, search, filter) is hidden while detail is showing, and reappears on back.

**Why this isn't "one responsive layout doing both jobs":** a `flex-basis:50%` pane that CSS-collapses to `100%` under a media query would still leave the *list* pane rendered (just invisible) underneath the detail view on mobile, wasting layout/scroll-position state and risking the two panes' scroll positions bleeding into each other. Making it a genuine two-state view (list-visible XOR detail-visible) on mobile, versus two-panes-at-once on desktop, is a deliberate structural difference, not a shortcut.

## 6. List pane

Single-column, vertically scrollable list of rows (never a multi-column grid, at any width — this directly satisfies the "vertical scrollable list" requirement and also removes the need for any grid-to-single-column responsive collapse logic, since it's single-column everywhere by design).

Each row: item name, one-line summary (truncated with ellipsis if long), a forced-override badge if applicable (unchanged from the current "Pinned active"/"Pinned inactive" concept), and the activate/deactivate toggle switch (§4). Clicking anywhere on the row **except the toggle itself** opens the detail pane/view for that item. This requires the toggle's click handler to call `stopPropagation()` so a toggle click doesn't also trigger detail-open — a concrete implementation detail worth calling out now so it isn't missed.

**Active-only filter:** a toggle switch next to the search box, labeled "Active only." When on, whichever tab is currently open renders only rows where `resolveActive(itemKey)` is true. This is a pure client-side render filter (no new data fetching, no settings persistence needed) — it resets to off when the modal is closed and reopened, matching the search box's own existing behavior of not persisting across sessions.

**Desktop vs. mobile:** no structural difference — a vertically scrollable single-column list works identically well at any width down to a phone screen; the only mobile-specific change is that the list occupies the *entire* screen (not half) until an item is selected.

## 7. Detail pane

**Content (curated fields, not everything the raw record has):**
- Characters: portrait image (if `record.portrait` is non-empty), name, summary, species/gender/age line, personality, appearance, tags. (Backstory, secrets, and other data used only for World Info entry construction are intentionally excluded from the detail view — they're not what a user needs to decide whether to activate someone.)
- Locations: portrait image if present, name, summary, description, tags.
- Collections (Registrar or local) and Lore/scenario items: name, summary, and — for collections specifically — a live-resolved preview list of member names (reusing `resolveCollectionMembers`/local membership data already available in `index.js`, not a new resolution mechanism).

**Desktop:** right-half pane, independently scrollable, with its own small header (item name + a close/back control that collapses the pane back to full-width list).

**Mobile:** replaces the list view entirely (full-screen), with a back button in its header that returns to the list view. Content itself (the curated fields, portrait, etc.) is identical between desktop and mobile — only the *frame* around it (half-width pane vs. full-screen view) differs.

## 8. Local collection management

Closes the gap the final whole-branch review flagged: `lib/localCollections.js`'s `createLocalCollection`/`renameLocalCollection`/`updateLocalCollectionMembers`/`deleteLocalCollection` (all already implemented and unit-tested in Task 6) currently have zero UI callers anywhere in the extension.

**"My Local Collections" tab additions:**
- A "+ New Collection" primary button at the top of the tab's list pane.
- Clicking it opens a small inline creation form (not a separate modal-within-a-modal): a name text input, and a multi-select list reusing the row component in a checkbox mode (select members from the already-loaded character/location catalog) instead of the activate toggle. Confirming calls `createLocalCollection` then `updateLocalCollectionMembers`.
- Each existing local collection's detail view (§7) gets its own "Rename" and "Edit Members" controls (reopening the same inline form, pre-populated) and a "Delete" control (with a confirmation step, since deletion also clears the collection's activation state per `deleteLocalCollection`'s existing contract).

**Desktop vs. mobile:** the creation/edit form renders inside whichever pane/view is currently showing detail content (the right-half pane on desktop, the full-screen detail view on mobile) — it's the same component in both cases, not a separate mobile-specific form.

## 9. Drag & resize (desktop only)

Matches Router's mechanic exactly (confirmed from its source): the titlebar is the drag handle (`cursor:grab`/`grabbing`), dragging updates `left`/`top` directly (not a CSS transform), clamped so a minimum portion of the window stays on-screen at all times, re-clamped on viewport resize. `resize:both` on the window element itself, with `min-width`/`min-height` floors matching Router's (`460px`/`360px`, adjusted if needed once the list+detail split's own minimum usable width is known during implementation). **Entirely disabled on mobile** — no drag listener attached, no `resize` CSS property — consistent with Router's own mobile behavior and with the fact that a fixed, full-screen mobile view has no meaningful "position" to drag.

## 10. Interface changes to existing modules

- `lib/ui/itemList.js`: `renderItemList` gains an `onOpenDetail(itemKey)` handler (called on row click, not just the toggle), and its rendering changes from card-grid markup to single-column row markup. The forced-badge and toggle logic are otherwise unchanged in *behavior*, only in markup/class names.
- `lib/ui/modal.js`: gains internal view-state (`list` | `detail`, plus which `itemKey` is selected), a mobile-detection check (matching Router's own `pointer:coarse`/width-based check), drag/resize wiring (desktop-only), and the active-only filter's toggle state. `openModal`'s external interface (the `state` object shape) gains one addition: a way to fetch a single item's full raw record for detail rendering (`getItemDetail(itemKey)` or equivalent) beyond the already-provided `getItemsForType`.
- `index.js`: gains the local-collection creation/edit/delete handlers wired to the new form, and a `getItemDetail`-style function for the modal to call.
- `template.html`: restructured for the titlebar (drag handle + wordmark + close), the list-pane/detail-pane two-region body (desktop) that becomes two full-screen views (mobile) via CSS, and the new-collection form markup.
- `style.css`: full rewrite to Router's visual system (§4), including the mobile media query block.

## 11. Testing / verification approach

Per this project's established practice, `lib/ui/*` and `template.html`/`style.css` have no unit tests (pure DOM/CSS, browser-only) — verified instead via live Playwright against the real running Weyland Tavern instance, **at both a desktop viewport and a mobile-sized viewport (or `pointer:coarse` emulation) explicitly, not just desktop** given how central the mobile requirement is to this redesign. The verification pass must explicitly confirm: list scrolls correctly at both sizes; row click (not on the toggle) opens detail at both sizes, with the correct framing (side panel vs. full-screen-with-back) per size; the toggle itself still works without also opening detail; drag/resize work on desktop and are absent (no drag listener, no resize handle) on mobile; the active-only filter correctly narrows each tab; and the full local-collection lifecycle (create → activate → edit members → rename → deactivate → delete) works end-to-end against real cached catalog data.
