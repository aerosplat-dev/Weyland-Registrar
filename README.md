# Weyland-Registrar

Browse, activate, and deactivate content from [registrar.weybooru.com](https://registrar.weybooru.com) — the community site for original AI-roleplay characters, locations, and collections — directly from inside Weyland Tavern. No more downloading `.json` files and importing them by hand.

## Accessing the Registrar Browser

Open the **World Info** panel and click the **Registrar** button next to the lorebook selection dropdown.

![The Registrar button, next to the "Pick to Edit" lorebook dropdown](docs/images/access-button.png)

## What it looks like

A floating, draggable browser (desktop-only; full-screen on mobile) with a scrollable list on the left and a detail view on the right.

![The Registrar browser open, showing the character list and a character's detail view](docs/images/browser-list-detail.png)

## Features

### Browsing

- Four tabs: **Characters**, **Locations**, **Collections** (curated on the Registrar website), and your own **Local Sets**
- Field-scoped search, matching the real Registrar site's own syntax: `species:neko owner:name`, `"exact phrase"`, `owner:!bob` to exclude, `species:neko|kitsune` to match either — search reaches into every content field (personality, speech, likes/dislikes, relationships, appearance, outfits, background, secrets, and more), not just name/summary
- Sort by Name, Created, Last Updated, or Author, in either direction — items missing the sorted field always sort to the end, and stray whitespace in a name never throws off alphabetical order
- Filter the list down to only currently-active items
- The catalog is cached locally after the first load, so reopening the browser doesn't require a fresh network fetch on every single open

### Activating content

- Activate/deactivate individual items, or bulk-select several and activate/deactivate them together
- **Pin** (📌) an item to force it active even if a collection covering it later gets deactivated — the only way to turn a pinned item off is to unpin it
- An item made active *by* a collection shows a tag naming which collection(s) are responsible — the only way to deactivate it is to deactivate that collection (pinning it instead locks it active regardless of the collection's state, so it isn't a way to turn one off)
- Toggling anything doesn't touch your real lorebooks right away — changes are staged. A **Rebuild**/**Apply** button in the titlebar glows once there are unapplied changes; click it to write them into the actual World Info book. With nothing pending, the same button does a full from-scratch rebuild — handy as a manual repair/parity check.

### Detail view

- Summary, curated fields, author, and (for characters) a Dorm Room/Housing line
- On-demand reveals for a character's Relationships, Background, and Secrets

### Local Sets

- Create your own named set from any mix of characters/locations, with a live-filterable member checklist (search + a Character/Location category filter)
- When creating a new set, a **Select Active Items** shortcut bulk-adds everything currently active
- Rename a set or edit its membership at any time; deleting one cleans up fully, no leftovers

### Safety

- Every lorebook this extension manages carries a visible, disabled marker entry warning that it's managed by Weyland-Registrar and that manual edits will be overwritten on the next sync
- If a lorebook with the same name already existed with real content, it's automatically backed up under a new name before the extension takes it over — nothing is silently lost
- Content fetched from the Registrar runs in a sandboxed iframe with no access to your SillyTavern session, cookies, or local storage

### Settings

Configurable from SillyTavern's native Extensions settings panel: a custom Registrar Base URL (if you're pointing at a different catalog server) and a Refresh Interval in minutes controlling how often the extension checks for new/updated content.

## How to Install

Copy-paste `https://github.com/aerosplat-dev/Weyland-Registrar.git` into the built-in SillyTavern extension installer, or just `git clone https://github.com/aerosplat-dev/Weyland-Registrar.git` under `SillyTavern/data/default-user/extensions`.
