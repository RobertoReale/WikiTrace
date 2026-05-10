'use strict';

const $ = (id) => document.getElementById(id);

function isWikiUrl(url) {
  try { return new URL(url).hostname.endsWith('wikipedia.org'); }
  catch { return false; }
}

function flash(msg, color = '#4ade80') {
  const el = $('status-msg');
  el.style.color = color;
  el.textContent = msg;
  setTimeout(() => { el.textContent = ''; }, 2500);
}

async function send(type, extra = {}) {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage({ type, ...extra }, (r) => {
      void chrome.runtime.lastError;
      resolve(r);
    })
  );
}

// ── Stats ─────────────────────────────────────────────────────────────────────

async function loadStats() {
  const { pages } = await send('GET_PAGES');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTs = today.getTime();

  const todayCount = pages.filter((p) => p.timestamp >= todayTs).length;
  const cats = new Set(pages.map((p) => p.userCategory || p.primaryCategory).filter(Boolean));

  $('stat-pages').textContent = pages.length;
  $('stat-cats').textContent = cats.size;
  $('stat-today').textContent = todayCount;
}

// ── Current-tab info ──────────────────────────────────────────────────────────

async function loadCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return;

  let isWiki = false;
  try { isWiki = new URL(tab.url).hostname.endsWith('wikipedia.org'); } catch {}

  let site = null;
  const { sites = [] } = await send('GET_TRACKED_SITES');
  if (sites.length > 0 && !isWiki) {
    let hostname;
    try { hostname = new URL(tab.url).hostname; } catch {}
    site = sites.find((s) => hostname === s.domain || hostname.endsWith('.' + s.domain));
  }

  const titleEl = $('page-title');
  const catsEl = $('page-cats');
  const rlConfirm = $('rl-confirm');

  // Unified fetching of reading list status
  const { saved: isWikiSaved, page: wikiPage, inReadingList } = await send('GET_PAGE_STATUS', { url: tab.url });
  let saved = isWikiSaved;
  let page = wikiPage;

  if (site) {
    titleEl.textContent = tab.title || site.domain;
    catsEl.textContent = site.name || site.domain;
    const csiteResp = await send('GET_CSITE_PAGE_STATUS', { domain: site.domain, url: tab.url });
    saved = csiteResp.saved;
    page = csiteResp.page;
  } else if (isWiki) {
    titleEl.textContent = tab.title.replace(/ - Wikipedia.*$/, '');
  } else {
    // Generic webpage
    titleEl.textContent = tab.title || tab.url;
    catsEl.textContent = 'Web Page';
    saved = false;
  }

  if (saved || inReadingList) {
    titleEl.insertAdjacentHTML('beforeend', ' <span class="badge badge-saved">Saved</span>');
    
    if (site || !isWiki) {
      if (inReadingList?.userCategory) {
        catsEl.textContent = inReadingList.userCategory;
      }
    } else {
      // Wikipedia
      if (page?.userCategory || inReadingList?.userCategory) {
        catsEl.textContent = page?.userCategory || inReadingList?.userCategory;
      } else if (page?.categories?.length) {
        catsEl.textContent = page.categories.join(' · ');
      } else {
        catsEl.textContent = 'Fetching categories…';
        catsEl.style.fontStyle = 'italic';
        catsEl.style.opacity = '0.5';
      }
    }

    if (page?.timestamp || inReadingList?.savedAt) {
      const date = new Date(page?.timestamp || inReadingList?.savedAt).toLocaleDateString();
      const visits = page?.visitCount || 1;
      const revisitEl = $('page-revisit-info');
      revisitEl.textContent = `Saved ${date} · ${visits} visit${visits === 1 ? '' : 's'}`;
      revisitEl.classList.remove('hidden');
    }
  } else {
    titleEl.insertAdjacentHTML('beforeend', ' <span class="badge badge-unsaved">Not saved</span>');
  }

  loadRLCategoryHints();

  if (inReadingList) {
    rlConfirm.disabled = true;
    rlConfirm.textContent = '✓ Already in list';
    $('rl-category-input').value = inReadingList.userCategory || '';
  } else {
    rlConfirm.disabled = false;
    rlConfirm.textContent = 'Save to reading list';
    
    const confirm = async () => {
      const cat = $('rl-category-input').value.trim() || 'General';
      rlConfirm.disabled = true;
      rlConfirm.textContent = 'Saving…';
      
      const respRL = await send('ADD_TO_READING_LIST', { url: tab.url, title: tab.title, userCategory: cat });
      
      // We only manually save to the graph if it's Wikipedia or Custom Site
      if (isWiki) {
        await send('MANUAL_SAVE', { tabId: tab.id, url: tab.url, title: tab.title, category: cat });
      } else if (site) {
        await send('MANUAL_SAVE_CSITE', { tabId: tab.id, domain: site.domain, url: tab.url, title: tab.title });
      }

      if (respRL?.ok) {
        flash('Saved to ' + cat);
        rlConfirm.textContent = '✓ Saved';
        titleEl.querySelector('.badge').className = 'badge badge-saved';
        titleEl.querySelector('.badge').textContent = 'Saved';
        await loadStats();
      } else {
        flash('Error saving', '#f87171');
        rlConfirm.disabled = false;
        rlConfirm.textContent = 'Save to reading list';
      }
    };

    rlConfirm.onclick = confirm;
    $('rl-category-input').onkeydown = (e) => { if (e.key === 'Enter') confirm(); };
  }
}

// ── Reading-list picker ───────────────────────────────────────────────────────

async function loadRLCategoryHints() {
  const { readingList } = await send('GET_READING_LIST');
  const sortedList = (readingList || []).sort((a, b) => b.savedAt - a.savedAt);
  const allCats = [...new Set(sortedList.map((r) => r.userCategory).filter(Boolean))];
  
  const input = $('rl-category-input');
  const dropdown = $('rl-dropdown');
  
  function renderDropdown(filterText = '') {
    const q = filterText.toLowerCase();
    const filtered = allCats.filter(c => c.toLowerCase().includes(q));
    dropdown.innerHTML = '';
    if (filtered.length === 0 || (filtered.length === 1 && filtered[0].toLowerCase() === q)) {
      dropdown.classList.add('hidden');
      return;
    }
    filtered.forEach(cat => {
      const el = document.createElement('div');
      el.className = 'rl-dropdown-item';
      el.textContent = cat;
      el.onmousedown = (e) => {
        e.preventDefault(); // prevent input blur
        input.value = cat;
        dropdown.classList.add('hidden');
      };
      dropdown.appendChild(el);
    });
    dropdown.classList.remove('hidden');
  }

  input.addEventListener('focus', () => renderDropdown(input.value));
  input.addEventListener('input', () => renderDropdown(input.value));
  input.addEventListener('blur', () => dropdown.classList.add('hidden'));

  const recentCats = allCats.slice(0, 5);
  const container = $('rl-existing-cats');
  container.innerHTML = '';
  recentCats.forEach((cat) => {
    const pill = document.createElement('button');
    pill.className = 'rl-cat-pill';
    pill.textContent = cat;
    pill.addEventListener('click', () => {
      $('rl-category-input').value = cat;
    });
    container.appendChild(pill);
  });
}

// ── Settings ──────────────────────────────────────────────────────────────────

async function loadSettings() {
  const { settings } = await send('GET_SETTINGS');
  $('save-mode').value = settings.saveMode ?? 'auto';
  $('revisit-notify').checked = settings.revisitNotify ?? true;
  applyTheme(settings.theme ?? 'dark');
}

$('save-mode').addEventListener('change', async (e) => {
  await send('SET_SETTINGS', { settings: { saveMode: e.target.value } });
  flash('Setting saved');
});

$('revisit-notify').addEventListener('change', async (e) => {
  await send('SET_SETTINGS', { settings: { revisitNotify: e.target.checked } });
});

// ── Theme ─────────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : '';
  $('btn-theme').textContent = theme === 'light' ? '☾' : '☀';
}

$('btn-theme').addEventListener('click', async () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  await send('SET_SETTINGS', { settings: { theme: next } });
});

// ── Dashboard link ────────────────────────────────────────────────────────────

$('open-dashboard').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  window.close();
});

// ── Sync ──────────────────────────────────────────────────────────────────────

let syncSettings = {};

function syncTimeAgo(ts) {
  if (!ts) return 'never';
  const d = Date.now() - ts;
  if (d < 60000) return 'just now';
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
  return `${Math.floor(d / 86400000)}d ago`;
}

function renderSync() {
  const { syncToken: token, syncGistId: gistId, syncLastAt: lastAt } = syncSettings;
  const badge = $('sync-badge');

  if (!token) {
    badge.textContent = 'Off';
    badge.className = 'sync-badge sync-badge-off';
    $('sync-info').classList.add('hidden');
    $('sync-action-btns').classList.add('hidden');
    $('btn-sync-pull').disabled = true;
    $('btn-sync-push').disabled = true;
  } else if (!gistId) {
    badge.textContent = 'Token saved';
    badge.className = 'sync-badge sync-badge-warn';
    $('sync-token-input').value = '•'.repeat(20);
    $('sync-info').classList.add('hidden');
    $('sync-action-btns').classList.remove('hidden');
    $('btn-sync-pull').disabled = true;
    $('btn-sync-push').disabled = false;
  } else {
    badge.textContent = syncTimeAgo(lastAt);
    badge.className = 'sync-badge sync-badge-ok';
    $('sync-token-input').value = '•'.repeat(20);
    $('sync-info').classList.remove('hidden');
    $('sync-action-btns').classList.remove('hidden');
    const gistEl = $('sync-gist-id');
    gistEl.textContent = gistId.slice(0, 10) + '…';
    gistEl.title = gistId;
    $('btn-sync-pull').disabled = false;
    $('btn-sync-push').disabled = false;
  }
}

function syncFlash(msg, ok = true) {
  const el = $('sync-feedback');
  el.style.color = ok ? 'var(--success)' : '#f87171';
  el.textContent = msg;
  if (msg) setTimeout(() => { el.textContent = ''; }, 3000);
}

async function loadSyncStatus() {
  const { settings = {} } = await send('GET_SETTINGS');
  syncSettings = settings;
  renderSync();
}

$('sync-toggle').addEventListener('click', () => {
  const panel = $('sync-panel');
  const arrow = $('sync-arrow');
  const willOpen = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !willOpen);
  arrow.classList.toggle('open', willOpen);
});

$('sync-gist-id').addEventListener('click', () => {
  const id = syncSettings.syncGistId;
  if (id) navigator.clipboard.writeText(id).then(() => syncFlash('Gist ID copied'));
});

$('btn-sync-connect').addEventListener('click', async () => {
  const raw = $('sync-token-input').value.trim();
  if (!raw || raw.startsWith('•')) { syncFlash('Enter your GitHub token', false); return; }
  const btn = $('btn-sync-connect');
  btn.disabled = true; btn.textContent = '…';
  syncFlash('');
  try {
    const res = await send('SYNC_CONNECT', { token: raw });
    if (!res.ok) throw new Error(res.error);
    const { settings = {} } = await send('GET_SETTINGS');
    syncSettings = settings;
    renderSync();
    syncFlash(res.gistId ? 'Connected — found existing sync' : 'Token saved — push to create sync');
  } catch (e) {
    syncFlash(e.message.includes('401') ? 'Invalid token' : e.message, false);
  } finally {
    btn.disabled = false; btn.textContent = 'Connect';
  }
});

$('btn-sync-push').addEventListener('click', async () => {
  const btn = $('btn-sync-push');
  btn.disabled = true; btn.textContent = '…';
  try {
    const res = await send('SYNC_PUSH');
    if (!res.ok) throw new Error(res.error);
    syncSettings.syncGistId = res.gistId;
    syncSettings.syncLastAt = res.at;
    renderSync();
    syncFlash('Pushed successfully');
  } catch (e) {
    syncFlash(e.message, false);
  } finally {
    btn.disabled = false; btn.textContent = 'Push →';
  }
});

$('btn-sync-pull').addEventListener('click', async () => {
  const btn = $('btn-sync-pull');
  btn.disabled = true; btn.textContent = '…';
  try {
    const res = await send('SYNC_PULL');
    if (!res.ok) throw new Error(res.error);
    syncSettings.syncLastAt = res.at;
    renderSync();
    syncFlash(`Pulled — ${res.pages} pages, ${res.rl} in list`);
    await loadStats();
  } catch (e) {
    syncFlash(e.message, false);
  } finally {
    btn.disabled = false; btn.textContent = '← Pull';
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

(async () => {
  await Promise.all([loadStats(), loadCurrentTab(), loadSettings(), loadSyncStatus()]);
})();
