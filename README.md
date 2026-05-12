# WikiTrace

Track, archive and visualise every Wikipedia page you visit — as a force-directed graph clustered by category.

**Version 1.3.0** — Chrome & Firefox (Manifest V3)

## Features

- **Automatic tracking** of every Wikipedia page you visit (or on scroll-to-bottom / manual save)
- **Permanent cumulative archive** stored locally in your browser (no account needed)
- **Wikipedia categories** fetched automatically and used to cluster pages in the graph
- **Graph view** — force-directed D3.js graph rendered on Canvas, with coloured clusters, navigation edges (A→B if you clicked through), chronological edges (for unlinked pages), pan/zoom, and PNG export
- **List view** — sortable by title / date / category, filterable by category and free-text search
- **Reading list** — save any page (Wikipedia or any website) for later, with a user-assigned category; filterable by category and domain
- **Custom site tracking** — add any website to WikiTrace and track its pages alongside Wikipedia
- **Revisit detection** — the toolbar icon changes and a badge appears when you revisit a previously saved page
- **Per-page visit counter** — tracks how many times you've visited each saved page
- **User categories** — override the auto-detected Wikipedia category on any page
- **Batch URL import** — paste multiple Wikipedia URLs to add them at once
- **Export / Import** — backup and restore your full archive as JSON
- **Cross-device sync** via GitHub Gist — push/pull your archive between Chrome, Firefox and Firefox for Android
- **Dark / light theme** — toggle from the popup

---

## Installation

### Chrome (unpacked extension)

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `WikiTrace` folder (the one containing `manifest.json`)

### Firefox (temporary add-on)

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-On…**
3. Select `manifest.json` inside the `WikiTrace` folder

> Pre-built zip packages for both browsers are in the `dist/` folder.

The WikiTrace icon appears in the toolbar. Pin it for easy access.

---

## Folder structure

```
WikiTrace/
├── manifest.json
├── background.js          # Service worker — tracking, API queue, storage, sync
├── content.js             # Injected into all pages — scroll detection & referrer
├── popup/
│   ├── popup.html
│   └── popup.js           # Extension popup — current page status, stats, sync, settings
├── dashboard/
│   ├── dashboard.html
│   ├── dashboard.js       # List view, reading list, graph view (Canvas/D3), sites panel
│   └── dashboard.css
├── icons/
│   ├── icon16.png         # Normal state icons
│   ├── icon48.png
│   ├── icon128.png
│   ├── icon_revisit16.png # Revisit state icons
│   ├── icon_revisit48.png
│   └── icon_revisit128.png
├── lib/
│   └── d3.min.js
└── dist/
    ├── wikitrace-chrome.zip
    └── wikitrace-firefox.zip
```

---

## Save modes

Switch mode from the popup at any time:

| Mode | Behaviour |
|------|-----------|
| **Automatic** | Page saved as soon as it finishes loading |
| **On scroll** | Page saved when you reach the bottom |
| **Manual** | Page saved only when you click "Save to reading list" in the popup |

---

## Reading list

Any page — Wikipedia article, custom site, or generic URL — can be saved to the reading list with a user-chosen category. The reading list lives in the dashboard under its own tab and supports sorting by date, title, domain, and category, plus free-text search and domain/category filters.

---

## Custom site tracking

You can track pages from any website, not just Wikipedia. From the dashboard **Sites** panel, add a domain (e.g. `example.com`). WikiTrace will then record every page you visit on that domain and show them in a separate list and graph alongside your Wikipedia history.

---

## Cross-device sync (GitHub Gist)

WikiTrace can sync your full archive across all devices — including Firefox and Firefox for Android — using a private GitHub Gist as a free, zero-server backend.

### Setup

1. Go to **github.com/settings/tokens** → **Generate new token (classic)**
2. Tick only the **`gist`** scope → generate and copy the token
3. Open the WikiTrace popup → click **Sync** → paste the token → **Connect**
4. Click **Push →** to create the Gist on your first device

### Syncing a second device

1. Install WikiTrace on the new device
2. Open the popup → **Sync** → paste the same token → **Connect**  
   WikiTrace automatically finds your existing Gist
3. Click **← Pull** to import your archive

### Notes

- The Gist is created **private** automatically
- Merge strategy: union of all pages/entries, newer timestamp wins on conflict
- Wikipedia pages, reading list, tracked sites and custom-site data are all synced
- The token is stored locally only and never included in the synced Gist

---

## Roadmap

- [ ] Firefox add-on store release
- [ ] Auto-sync on browser close / on a schedule
- [ ] Selective sync (choose which categories or sites to include)
- [ ] Self-hosting option (sync to your own server instead of GitHub Gist)
