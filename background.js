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
let cachedTrackedSites = null;

// ─── onInstalled ──────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['pages', 'settings', 'readingList', 'trackedSites'], (res) => {
    const updates = {};
    if (!res.pages) updates.pages = {};
    if (!res.settings) updates.settings = { saveMode: 'auto' };
    if (!res.readingList) updates.readingList = {};
    if (!res.trackedSites) updates.trackedSites = [];
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

function getDomain(url) {
  try { return new URL(url).hostname; }
  catch { return null; }
}

function matchesSite(site, url) {
  const hostname = getDomain(url);
  if (!hostname) return false;
  return hostname === site.domain || hostname.endsWith('.' + site.domain);
}

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Custom site cache ────────────────────────────────────────────────────────

async function getTrackedSites() {
  if (cachedTrackedSites === null) {
    const { trackedSites = [] } = await storageGet('trackedSites');
    cachedTrackedSites = trackedSites;
  }
  return cachedTrackedSites;
}

chrome.storage.onChanged.addListener((changes) => {
  if ('trackedSites' in changes) {
    cachedTrackedSites = changes.trackedSites.newValue || [];
  }
});

async function getTabTitle(tabId) {
  try {
    return await new Promise((resolve) => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(tab?.title || null);
      });
    });
  } catch { return null; }
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

async function savePage({ url, title, parentId, userCategory = null }) {
  const normalUrl = normalizeUrl(url);
  const info = extractWikiInfo(url);
  if (!info) return null;

  const { pages = {} } = await storageGet('pages');
  const slug = extractSlug(normalUrl);
  
  // Cerchiamo se la pagina è già stata tracciata (es. dal sistema Automatic)
  const existing = Object.values(pages).find(
    (p) => p.url === normalUrl || (slug && extractSlug(p.url) === slug)
  );

  if (existing) {
    // FIX: Se la pagina esiste già e l'utente ha inserito una categoria, la aggiorniamo
    if (userCategory) {
      const { pages: current = {} } = await storageGet('pages');
      if (current[existing.id]) {
        current[existing.id].userCategory = userCategory; // Salviamo la tua categoria personalizzata
        await storageSet({ pages: current });
      }
    }
    return existing.id; // Ritorniamo l'ID esistente per non creare duplicati nel grafo
  }

  // Se la pagina è nuova, creiamo il record completo
  const id = generateId();
  const entry = {
    id, 
    url: normalUrl,
    title: title || info.title,
    timestamp: Date.now(),
    parentId: parentId || null,
    categories: [],           // Categorie automatiche di Wikipedia
    primaryCategory: null,
    userCategory: userCategory, // La tua categoria (es. "Science")
    visitCount: 1,
  };

  pages[id] = entry;
  await storageSet({ pages });

  // Gestione del grafo
  const { graphPositions = {} } = await storageGet('graphPositions');
  if (!graphPositions[id]) await storageSet({ graphCacheDirty: true });

  // Continua a scaricare le categorie di Wikipedia in background per il grafo
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

async function saveCustomPage({ domain, url, title, parentId }) {
  const normalUrl = normalizeUrl(url);
  const storeKey = `csite_${domain}`;
  const stored = await storageGet(storeKey);
  const pages = stored[storeKey] || {};

  const existing = Object.values(pages).find((p) => p.url === normalUrl);
  if (existing) return existing.id;

  const id = generateId();
  pages[id] = {
    id, url: normalUrl,
    title: title || normalUrl,
    timestamp: Date.now(),
    parentId: parentId || null,
    categories: [],
    primaryCategory: null,
    visitCount: 1,
  };
  await storageSet({ [storeKey]: pages });
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

  const normalUrl = normalizeUrl(url);
  const slug = extractSlug(normalUrl);
  const existing = Object.values(pages).find(
    (p) => p.url === normalUrl || (slug && extractSlug(p.url) === slug)
  );

  if (existing) {
    pages[existing.id].visitCount = (pages[existing.id].visitCount || 1) + 1;
    await storageSet({ pages });
    if (revisitNotify) setRevisitIcon(tabId); else resetIcon(tabId);
    tabState[tabId] = { pageId: existing.id, url };
    return;
  }

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

async function handleCustomNavCompleted(details) {
  if (details.frameId !== 0) return;
  const { tabId, url } = details;

  const domain = getDomain(url);
  if (!domain || domain.endsWith('wikipedia.org')) return;

  const sites = await getTrackedSites();
  const site = sites.find((s) => matchesSite(s, url));
  if (!site) return;

  const { settings = {} } = await storageGet('settings');
  const mode = settings.saveMode ?? 'auto';
  const revisitNotify = settings.revisitNotify ?? true;

  const storeKey = `csite_${site.domain}`;
  const stored = await storageGet(storeKey);
  const pages = stored[storeKey] || {};
  const normalUrl = normalizeUrl(url);
  const existing = Object.values(pages).find((p) => p.url === normalUrl);

  if (existing) {
    pages[existing.id].visitCount = (pages[existing.id].visitCount || 1) + 1;
    await storageSet({ [storeKey]: pages });
    if (revisitNotify) setRevisitIcon(tabId); else resetIcon(tabId);
    tabState[tabId] = { pageId: existing.id, url, customDomain: site.domain };
    return;
  }

  resetIcon(tabId);
  const fallbackParentId = (tabState[tabId]?.customDomain === site.domain)
    ? (tabState[tabId]?.pageId ?? null)
    : null;

  if (mode === 'auto') {
    const title = await getTabTitle(tabId);
    const id = await saveCustomPage({ domain: site.domain, url, title, parentId: fallbackParentId });
    tabState[tabId] = { pageId: id, url, customDomain: site.domain };
    if (id) showBadge(tabId);
  } else {
    const title = await getTabTitle(tabId);
    tabState[tabId] = {
      pageId: tabState[tabId]?.pageId ?? null,
      pendingUrl: url,
      pendingParentId: fallbackParentId,
      pendingTitle: title,
      customDomain: site.domain,
    };
  }
}

chrome.webNavigation.onCompleted.addListener(handleCustomNavCompleted, {
  url: [{ schemes: ['https', 'http'] }],
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

        if (state.customDomain) {
          const id = await saveCustomPage({
            domain: state.customDomain,
            url: state.pendingUrl,
            title: state.pendingTitle || null,
            parentId: state.pendingParentId || null,
          });
          tabState[tabId] = { pageId: id, url: state.pendingUrl, customDomain: state.customDomain };
          if (id) showBadge(tabId);
          sendResponse({ ok: true, id });
        } else {
          const id = await savePage({ url: state.pendingUrl, title: state.pendingTitle || null, parentId: state.pendingParentId });
          tabState[tabId] = { pageId: id, url: state.pendingUrl };
          if (id) showBadge(tabId);
          sendResponse({ ok: true, id });
        }
        break;
      }

      case 'MANUAL_SAVE': {
        const tabId = msg.tabId;
        const state = tabState[tabId] ?? {};
        const url = msg.url || state.pendingUrl;
        if (!url) { sendResponse({ ok: false, error: 'No URL' }); return; }
        const id = await savePage({ url, title: msg.title || null, parentId: state.pendingParentId ?? null, userCategory: msg.category });
        if (!id) { sendResponse({ ok: false, error: 'Not a Wikipedia page' }); return; }
        if (tabId != null) { tabState[tabId] = { pageId: id, url }; showBadge(tabId); }
        sendResponse({ ok: true, id });
        break;
      }

      case 'MANUAL_SAVE_CSITE': {
        const { tabId, domain, url, title } = msg;
        if (!domain || !url) { sendResponse({ ok: false, error: 'Missing params' }); return; }
        const id = await saveCustomPage({ domain, url, title: title || null, parentId: null });
        if (!id) { sendResponse({ ok: false, error: 'Save failed' }); return; }
        if (tabId != null) { tabState[tabId] = { pageId: id, url, customDomain: domain }; showBadge(tabId); }
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
          if (id && !existingUrls.has(normalUrl)) { added++; existingUrls.add(normalUrl); }
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

      case 'IMPORT_CSITE': {
        const { domain, name, pages: importPages } = msg;
        if (!domain) { sendResponse({ ok: false, error: 'No domain' }); return; }

        const sites = await getTrackedSites();
        if (!sites.find((s) => s.domain === domain)) {
          const updated = [...sites, { domain, name: name || domain }];
          await storageSet({ trackedSites: updated });
          cachedTrackedSites = updated;
        }

        const storeKey = `csite_${domain}`;
        const stored = await storageGet(storeKey);
        const existing = stored[storeKey] || {};
        const existingUrls = new Set(Object.values(existing).map((p) => p.url));
        let added = 0;

        for (const page of (importPages || [])) {
          if (!page?.url) continue;
          const normalUrl = normalizeUrl(page.url);
          if (existingUrls.has(normalUrl)) continue;
          const id = page.id || generateId();
          existing[id] = {
            id, url: normalUrl,
            title: page.title || normalUrl,
            timestamp: page.timestamp || Date.now(),
            parentId: page.parentId || null,
            categories: [],
            primaryCategory: null,
            visitCount: page.visitCount || 1,
          };
          existingUrls.add(normalUrl);
          added++;
        }

        await storageSet({ [storeKey]: existing });
        sendResponse({ ok: true, added });
        break;
      }

      case 'GET_PAGES': {
        const { pages = {} } = await storageGet('pages');
        sendResponse({ pages: Object.values(pages) });
        break;
      }

      case 'GET_TRACKED_SITES': {
        const sites = await getTrackedSites();
        sendResponse({ sites });
        break;
      }

      case 'ADD_TRACKED_SITE': {
        const sites = await getTrackedSites();
        const { domain, name } = msg;
        if (!domain) { sendResponse({ ok: false, error: 'No domain' }); return; }
        const normalDomain = domain.toLowerCase().replace(/^www\./, '').replace(/\/$/, '');
        const domainRe = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
        if (!domainRe.test(normalDomain)) { sendResponse({ ok: false, error: 'invalid_domain' }); return; }
        if (sites.some((s) => s.domain === normalDomain)) {
          sendResponse({ ok: false, error: 'already_tracked' }); return;
        }
        const newSite = { domain: normalDomain, name: name || normalDomain };
        const updated = [...sites, newSite];
        await storageSet({ trackedSites: updated });
        cachedTrackedSites = updated;
        sendResponse({ ok: true, site: newSite });
        break;
      }

      case 'REMOVE_TRACKED_SITE': {
        const sites = await getTrackedSites();
        const { domain } = msg;
        const updated = sites.filter((s) => s.domain !== domain);
        await storageSet({ trackedSites: updated });
        cachedTrackedSites = updated;
        await new Promise((resolve) => chrome.storage.local.remove(`csite_${domain}`, resolve));
        sendResponse({ ok: true });
        break;
      }

      case 'GET_CSITE_PAGES': {
        const { domain } = msg;
        const storeKey = `csite_${domain}`;
        const stored = await storageGet(storeKey);
        const pages = stored[storeKey] || {};
        sendResponse({ pages: Object.values(pages) });
        break;
      }

      case 'DELETE_CSITE_PAGE': {
        const { domain, id } = msg;
        const storeKey = `csite_${domain}`;
        const stored = await storageGet(storeKey);
        const pages = stored[storeKey] || {};
        delete pages[id];
        await storageSet({ [storeKey]: pages });
        sendResponse({ ok: true });
        break;
      }

      case 'GET_CSITE_PAGE_STATUS': {
        const { domain, url } = msg;
        const storeKey = `csite_${domain}`;
        const stored = await storageGet(storeKey);
        const pages = stored[storeKey] || {};
        const normalUrl = normalizeUrl(url);
        const found = Object.values(pages).find((p) => p.url === normalUrl);
        sendResponse({ saved: !!found, page: found || null });
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
        let { pages = {}, readingList = {} } = await storageGet(['pages', 'readingList']);
        if (!readingList || Array.isArray(readingList)) {
          const obj = {};
          if (Array.isArray(readingList)) readingList.forEach(r => { if(r && r.id) obj[r.id] = r; });
          readingList = obj;
        }
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
        let { readingList = {} } = await storageGet('readingList');
        if (!readingList || Array.isArray(readingList)) {
          const obj = {};
          if (Array.isArray(readingList)) readingList.forEach(r => { if(r && r.id) obj[r.id] = r; });
          readingList = obj;
          await storageSet({ readingList });
        }
        sendResponse({ readingList: Object.values(readingList) });
        break;
      }

      case 'ADD_TO_READING_LIST': {
        let { readingList = {} } = await storageGet('readingList');
        if (!readingList || Array.isArray(readingList)) {
          const obj = {};
          if (Array.isArray(readingList)) readingList.forEach(r => { if(r && r.id) obj[r.id] = r; });
          readingList = obj;
        }
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
        let { readingList = {} } = await storageGet('readingList');
        if (!readingList || Array.isArray(readingList)) {
          const obj = {};
          if (Array.isArray(readingList)) readingList.forEach(r => { if(r && r.id) obj[r.id] = r; });
          readingList = obj;
        }
        delete readingList[msg.id];
        await storageSet({ readingList });
        sendResponse({ ok: true });
        break;
      }

      case 'MARK_AS_READ': {
        let { readingList = {} } = await storageGet('readingList');
        if (!readingList || Array.isArray(readingList)) {
          const obj = {};
          if (Array.isArray(readingList)) readingList.forEach(r => { if(r && r.id) obj[r.id] = r; });
          readingList = obj;
        }
        const item = readingList[msg.id];
        if (!item) { sendResponse({ ok: false, error: 'Not found' }); return; }
        delete readingList[msg.id];
        await storageSet({ readingList });
        
        const pageId = await savePage({ url: item.url, title: item.title, parentId: null, userCategory: item.userCategory });
        
        sendResponse({ ok: true, pageId });
        break;
      }

      case 'CLEAR_ALL': {
        const sites = await getTrackedSites();
        const customKeys = sites.map((s) => `csite_${s.domain}`);
        if (customKeys.length > 0) {
          await new Promise((resolve) => chrome.storage.local.remove(customKeys, resolve));
        }
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
