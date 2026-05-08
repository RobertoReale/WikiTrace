# WikiTrace

Track, archive and visualise every Wikipedia page you visit — as a force-directed graph clustered by category.

## Features

- **Automatic tracking** of every Wikipedia page you visit (or on scroll-to-bottom / manual save)
- **Permanent cumulative archive** stored locally in your browser (no account needed)
- **Wikipedia categories** fetched automatically and used to cluster pages in the graph
- **Graph view** — force-directed D3.js graph with coloured clusters, navigation edges (A→B if you clicked through) and chronological edges (for unlinked pages)
- **List view** — sortable by title / date / category, filterable by category and free-text search
- **Batch URL import** — paste multiple Wikipedia URLs to add them at once
- **Export / Import** — backup and restore your archive as JSON
- **Cross-device sync** via GitHub Gist — push/pull your full archive between Chrome, Firefox and Firefox for Android

---

## Installation (Chrome — unpacked extension)

### 1. Download D3.js

The extension ships without `d3.min.js` to keep the repo lean.  
Download it from the official D3 releases and place it at:

```
lib/d3.min.js
```

Quick way (browser): open  
`https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js`  
→ Save As → save into the `lib/` folder as `d3.min.js`.

### 2. Load the extension

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `WikiTrace---versione-mia` folder (the one containing `manifest.json`)

The WikiTrace icon appears in the toolbar. Pin it for easy access.

---

## Folder structure

```
WikiTrace---versione-mia/
├── manifest.json
├── background.js          # Service worker — tracking, API queue, storage
├── content.js             # Injected into Wikipedia — scroll detection & referrer
├── popup/
│   ├── popup.html
│   └── popup.js           # Extension popup — current page status, stats, settings
├── dashboard/
│   ├── dashboard.html
│   ├── dashboard.js       # List view + D3 graph view
│   └── dashboard.css
└── lib/
    └── d3.min.js          # ← you must add this file (see Installation)
```

---

## Save modes

Switch mode from the popup at any time:

| Mode | Behaviour |
|------|-----------|
| **Automatic** | Page saved as soon as it finishes loading |
| **On scroll** | Page saved when you reach the bottom |
| **Manual** | Page saved only when you click "Save this page" in the popup |

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
- Pages, reading list, tracked sites and custom-site data are all synced
- The token is stored locally only and never included in the synced Gist

---

## Roadmap

- [ ] Firefox add-on store release (cross-browser support)
- [ ] Auto-sync on browser close / on a schedule
- [ ] Selective sync (choose which categories or sites to include)
- [ ] Self-hosting option (sync to your own server instead of GitHub Gist)
