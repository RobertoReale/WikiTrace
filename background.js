'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const WIKI_API_BASE = 'https://{lang}.wikipedia.org/w/api.php';
const QUEUE_INTERVAL_MS = 650;
const MAX_CATEGORIES = 2;
const MAX_RETRIES = 2;

const NOISE_RE = [
  /^articles/i, /^wikipedia/i, /^pages /i, /^all /i, /^cs1 /i,
  /webarchive/i, /^use /i, /template/i, /stub/i, /cleanup/i,
  /wikify/i, /orphan/i, /harv/i, /infobox/i, /disambiguation/i,
  /redirect/i, /living people/i, /^\d{4} /, /births$/i, /deaths$/i,
  /good article/i, /featured article/i,
  /^voci_/i, /senza_fonti/i, /categorie_aggiunte/i, /^pagine_/i,
];

// ─── In-memory state ──────────────────────────────────────────────────────────

const tabState = {};
const apiQueue = [];
let queueTimer = null;

// ─── onInstalled ──────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['pages', 'settings', 'readingList'], (res) => {
    const updates = {};
    if (!res.pages) updates.pages = {};
    if (!res.settings) updates.settings = { saveMode: 'auto' };
    if (!res.readingList) updates.readingList = {};
    if (Object.keys(updates).length > 0) chrome.storage.local.set(updates);
  });
});

// ─── Storage helpers ──────────────────────────────────────────────────────────

function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function storageSet(data) {
  return new Promise((resolve, reject) =>
    chrome.storage.local.set(data, () =>
      chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve()
    )
  );
}

// ─── Badge & icon feedback ────────────────────────────────────────────────────

function showBadge(tabId) {
  if (!tabId) return;
  chrome.action.setBadgeText({ text: '✓', tabId });
  chrome.action.setBadgeBackgroundColor({ color: '#22c55e', tabId });
  setTimeout(() => {
    chrome.tabs.get(tabId, () => {
      if (!chrome.runtime.lastError) {
        chrome.action.setBadgeText({ text: '', tabId });
      }
    });
  }, 2000);
}

function setRevisitIcon(tabId) {
  if (!tabId) return;
  chrome.action.setIcon({
    path: { 16: 'icons/icon_revisit16.png', 48: 'icons/icon_revisit48.png', 128: 'icons/icon_revisit128.png' },
    tabId,
  });
}

function resetIcon(tabId) {
  if (!tabId) return;
  chrome.action.setIcon({
    path: { 16: 'icons/icon16.png', 48: 'icons/icon48.png', 128: 'icons/icon128.png' },
    tabId,
  });
}

// ─── Wikipedia category API + queue ──────────────────────────────────────────

function isNoisyCategory(name) {
  return NOISE_RE.some((re) => re.test(name));
}

function cleanCategories(rawList) {
  return rawList
    .map((c) => c.title.replace(/^Categor[íi]a:/i, '').replace(/^Category:/i, '').trim())
    .filter((c) => !isNoisyCategory(c))
    .slice(0, MAX_CATEGORIES);
}

async function fetchCategoriesFromAPI(title, lang, attempt = 0) {
  const url = new URL(WIKI_API_BASE.replace('{lang}', lang));
  url.searchParams.set('action', 'query');
  url.searchParams.set('titles', title);
  url.searchParams.set('prop', 'categories');
  url.searchParams.set('clshow', '!hidden');
  url.searchParams.set('cllimit', '20');
  url.searchParams.set('format', 'json');
  url.searchParams.set('origin', '*');

  try {
    const resp = await fetch(url.toString());
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const pages = data?.query?.pages ?? {};
    const page = Object.values(pages)[0];
    return cleanCategories(page?.categories ?? []);
  } catch (e) {
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      return fetchCategoriesFromAPI(title, lang, attempt + 1);
    }
    throw e;
  }
}

function enqueueCategories(title, lang) {
  return new Promise((resolve, reject) => {
    apiQueue.push({ title, lang, resolve, reject });
    if (!queueTimer) scheduleNext();
  });
}

function scheduleNext() {
  queueTimer = setTimeout(processNext, QUEUE_INTERVAL_MS);
}

async function processNext() {
  queueTimer = null;
  const item = apiQueue.shift();
  if (!item) return;
  try {
    item.resolve(await fetchCategoriesFromAPI(item.title, item.lang));
  } catch (e) {
    item.reject(e);
  }
  if (apiQueue.length > 0) scheduleNext();
}

// ─── URL utilities ────────────────────────────────────────────────────────────

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch { return url; }
}

function extractSlug(url) {
  try {
    const m = new URL(url).pathname.match(/^\/wiki\/(.+)$/);
    return m ? decodeURIComponent(m[1]).replace(/_/g, ' ') : null;
  } catch { return null; }
}

function extractWikiInfo(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith('wikipedia.org')) return null;
    const lang = u.hostname.split('.')[0];
    const m = u.pathname.match(/^\/wiki\/(.+)$/);
    if (!m) return null;
    if (m[1].includes(':')) return null;
    const title = decodeURIComponent(m[1]).replace(/_/g, ' ');
    return { lang, title };
  } catch { return null; }
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Referrer resolution ──────────────────────────────────────────────────────

async function getReferrerId(tabId, fallbackParentId) {
  try {
    const resp = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: 'GET_REFERRER' }, (r) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(r);
      });
    });
    const referrer = resp?.referrer;
    if (referrer && extractWikiInfo(referrer)) {
      const { pages = {} } = await storageGet('pages');
      const normalReferrer = normalizeUrl(referrer);
      const referrerPage = Object.values(pages).find((p) => p.url === normalReferrer);
      if (referrerPage) return referrerPage.id;
    }
  } catch { /* content script not ready */ }
  return fallbackParentId;
}

// ─── Page persistence ─────────────────────────────────────────────────────────

async function savePage({ url, title, parentId }) {
  const normalUrl = normalizeUrl(url);
  const info = extractWikiInfo(url);
  if (!info) return null;

  const { pages = {} } = await storageGet('pages');
  const slug = extractSlug(normalUrl);
  const existing = Object.values(pages).find(
    (p) => p.url === normalUrl || (slug && extractSlug(p.url) === slug)
  );
  if (existing) return existing.id;

  const id = generateId();
  const entry = {
    id, url: normalUrl,
    title: title || info.title,
    timestamp: Date.now(),
    parentId: parentId || null,
    categories: [],
    primaryCategory: null,
    visitCount: 1,
  };

  pages[id] = entry;
  await storageSet({ pages });

  const { graphPositions = {} } = await storageGet('graphPositions');
  if (!graphPositions[id]) await storageSet({ graphCacheDirty: true });

  enqueueCategories(info.title, info.lang)
    .then(async (cats) => {
      const { pages: current = {} } = await storageGet('pages');
      if (!current[id]) return;
      current[id].categories = cats;
      current[id].primaryCategory = cats[0] || null;
      await storageSet({ pages: current });
    })
    .catch((e) => console.warn('WikiTrace: category fetch failed', e));

  return id;
}

// ─── Navigation listeners ─────────────────────────────────────────────────────

async function handleNavCompleted(details) {
  if (details.frameId !== 0) return;
  const { tabId, url } = details;
  if (!extractWikiInfo(url)) return;

  const { settings = {}, pages = {} } = await storageGet(['settings', 'pages']);
  const mode = settings.saveMode ?? 'auto';
  const revisitNotify = settings.revisitNotify ?? true;

  // Check if this URL was already saved
  const normalUrl = normalizeUrl(url);
  const slug = extractSlug(normalUrl);
  const existing = Object.values(pages).find(
    (p) => p.url === normalUrl || (slug && extractSlug(p.url) === slug)
  );

  if (existing) {
    // Increment visit counter and show revisit icon
    pages[existing.id].visitCount = (pages[existing.id].visitCount || 1) + 1;
    await storageSet({ pages });
    if (revisitNotify) setRevisitIcon(tabId); else resetIcon(tabId);
    tabState[tabId] = { pageId: existing.id, url };
    return;
  }

  // New page — reset any lingering revisit icon
  resetIcon(tabId);

  const fallbackParentId = tabState[tabId]?.pageId ?? null;
  const parentId = await getReferrerId(tabId, fallbackParentId);
  const hintTitle = tabState[tabId]?.pendingTitle ?? null;

  if (mode === 'auto') {
    const id = await savePage({ url, title: hintTitle, parentId });
    tabState[tabId] = { pageId: id, url };
    if (id) showBadge(tabId);
  } else {
    tabState[tabId] = {
      pageId: tabState[tabId]?.pageId ?? null,
      pendingUrl: url,
      pendingParentId: parentId,
      pendingTitle: hintTitle,
    };
  }
}

chrome.webNavigation.onCompleted.addListener(handleNavCompleted, {
  url: [{ hostContains: 'wikipedia.org', pathContains: '/wiki/' }],
});

chrome.tabs.onRemoved.addListener((tabId) => { delete tabState[tabId]; });

// ─── Message bus ──────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {

      case 'PAGE_SCROLL_BOTTOM': {
        const tabId = sender.tab?.id;
        if (!tabId) { sendResponse({ ok: false }); return; }
        const { settings = {} } = await storageGet('settings');
        if ((settings.saveMode ?? 'auto') !== 'scroll') { sendResponse({ ok: false }); return; }
        const state = tabState[tabId];
        if (!state?.pendingUrl) { sendResponse({ ok: false }); return; }
        const id = await savePage({ url: state.pendingUrl, title: state.pendingTitle || null, parentId: state.pendingParentId });
        tabState[tabId] = { pageId: id, url: state.pendingUrl };
        if (id) showBadge(tabId);
        sendResponse({ ok: true, id });
        break;
      }

      case 'MANUAL_SAVE': {
        const tabId = msg.tabId;
        const state = tabState[tabId] ?? {};
        const url = msg.url || state.pendingUrl;
        if (!url) { sendResponse({ ok: false, error: 'No URL' }); return; }
        const id = await savePage({ url, title: msg.title || null, parentId: state.pendingParentId ?? null });
        if (!id) { sendResponse({ ok: false, error: 'Not a Wikipedia page' }); return; }
        if (tabId != null) { tabState[tabId] = { pageId: id, url }; showBadge(tabId); }
        sendResponse({ ok: true, id });
        break;
      }

      case 'ADD_URLS': {
        const { pages: existingPages = {} } = await storageGet('pages');
        const existingUrls = new Set(Object.values(existingPages).map((p) => p.url));
        const results = [];
        let added = 0;
        for (const entry of msg.entries) {
          const normalUrl = normalizeUrl(entry.url);
          const id = await savePage({ url: entry.url, title: entry.title || null, parentId: null });
          results.push({ url: entry.url, id });
          if (id && !existingUrls.has(normalUrl)) added++;
        }
        sendResponse({ ok: true, results, added });
        break;
      }

      case 'IMPORT_PAGES': {
        const { pages = {} } = await storageGet('pages');
        const existingUrls = new Set(Object.values(pages).map((p) => p.url));
        const existingSlugs = new Set(Object.values(pages).map((p) => extractSlug(p.url)).filter(Boolean));
        let added = 0;
        for (const node of (msg.nodes || [])) {
          if (!node?.url || !node?.title) continue;
          const normalUrl = normalizeUrl(node.url);
          const slug = extractSlug(normalUrl);
          if (existingUrls.has(normalUrl) || (slug && existingSlugs.has(slug))) continue;
          const id = node.id || generateId();
          pages[id] = {
            id, url: normalUrl, title: node.title,
            timestamp: node.timestamp || (node.date ? new Date(node.date).getTime() : Date.now()),
            parentId: node.parentId || null,
            categories: node.categories || [],
            primaryCategory: node.primaryCategory || (node.categories?.[0] ?? null),
          };
          existingUrls.add(normalUrl);
          if (slug) existingSlugs.add(slug);
          added++;
        }
        await storageSet({ pages, graphCacheDirty: true });

        let addedRL = 0;
        if (Array.isArray(msg.readingListItems) && msg.readingListItems.length > 0) {
          const { readingList = {} } = await storageGet('readingList');
          const existingRLUrls = new Set(Object.values(readingList).map((r) => r.url));
          for (const item of msg.readingListItems) {
            if (!item?.url || !item?.title) continue;
            const normalUrl = normalizeUrl(item.url);
            if (existingRLUrls.has(normalUrl)) continue;
            const rlId = item.id || generateId();
            readingList[rlId] = {
              id: rlId, url: normalUrl, title: item.title,
              userCategory: item.userCategory || 'General',
              savedAt: item.savedAt || Date.now(),
            };
            existingRLUrls.add(normalUrl);
            addedRL++;
          }
          await storageSet({ readingList });
        }

        sendResponse({ ok: true, added, addedRL });
        break;
      }

      case 'GET_PAGES': {
        const { pages = {} } = await storageGet('pages');
        sendResponse({ pages: Object.values(pages) });
        break;
      }

      case 'LINK_HINT': {
        const tabId = sender.tab?.id;
        if (tabId && msg.url && msg.title) {
          tabState[tabId] = { ...tabState[tabId], pendingTitle: msg.title };
        }
        sendResponse({ ok: true });
        break;
      }

      case 'GET_PAGE_STATUS': {
        const { pages = {}, readingList = {} } = await storageGet(['pages', 'readingList']);
        const normalUrl = normalizeUrl(msg.url);
        const slug = extractSlug(normalUrl);
        const found = Object.values(pages).find(
          (p) => p.url === normalUrl || (slug && extractSlug(p.url) === slug)
        );
        const inReadingList = Object.values(readingList).find((r) => r.url === normalUrl) || null;
        sendResponse({ saved: !!found, page: found || null, inReadingList });
        break;
      }

      case 'DELETE_PAGE': {
        const { pages = {} } = await storageGet('pages');
        delete pages[msg.id];
        const { graphPositions = {} } = await storageGet('graphPositions');
        delete graphPositions[msg.id];
        await storageSet({ pages, graphPositions, graphCacheDirty: true });
        sendResponse({ ok: true });
        break;
      }

      case 'GET_SETTINGS': {
        const { settings = {} } = await storageGet('settings');
        sendResponse({ settings });
        break;
      }

      case 'SET_SETTINGS': {
        const { settings: current = {} } = await storageGet('settings');
        await storageSet({ settings: { ...current, ...msg.settings } });
        sendResponse({ ok: true });
        break;
      }

      case 'GET_READING_LIST': {
        const { readingList = {} } = await storageGet('readingList');
        sendResponse({ readingList: Object.values(readingList) });
        break;
      }

      case 'ADD_TO_READING_LIST': {
        const { readingList = {} } = await storageGet('readingList');
        const normalUrl = normalizeUrl(msg.url);
        const existing = Object.values(readingList).find((r) => r.url === normalUrl);
        if (existing) { sendResponse({ ok: true, id: existing.id, alreadyExists: true }); return; }
        const id = generateId();
        readingList[id] = {
          id, url: normalUrl, title: msg.title || '',
          userCategory: msg.userCategory || 'General',
          savedAt: Date.now(),
        };
        await storageSet({ readingList });
        sendResponse({ ok: true, id });
        break;
      }

      case 'REMOVE_FROM_READING_LIST': {
        const { readingList = {} } = await storageGet('readingList');
        delete readingList[msg.id];
        await storageSet({ readingList });
        sendResponse({ ok: true });
        break;
      }

      case 'MARK_AS_READ': {
        const { readingList = {} } = await storageGet('readingList');
        const item = readingList[msg.id];
        if (!item) { sendResponse({ ok: false, error: 'Not found' }); return; }
        delete readingList[msg.id];
        await storageSet({ readingList });
        const pageId = await savePage({ url: item.url, title: item.title, parentId: null });
        sendResponse({ ok: true, pageId });
        break;
      }

      case 'CLEAR_ALL': {
        await storageSet({ pages: {}, graphPositions: {}, graphCacheDirty: true, readingList: {} });
        sendResponse({ ok: true });
        break;
      }

      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  })();
  return true;
});
