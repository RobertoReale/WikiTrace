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

## Roadmap (phase 2 — not yet implemented)

- Account + online archive for multi-device sync
- Self-hosting option
