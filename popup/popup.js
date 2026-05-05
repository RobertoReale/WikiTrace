'use strict';

const $ = (id) => document.getElementById(id);

function isWikiUrl(url) {
  try { return new URL(url).hostname.endsWith('wikipedia.org'); }
  catch { return false; }
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  const cats = new Set(pages.map((p) => p.primaryCategory).filter(Boolean));

  $('stat-pages').textContent = pages.length;
  $('stat-cats').textContent = cats.size;
  $('stat-today').textContent = todayCount;
}

// ── Current-tab info ──────────────────────────────────────────────────────────

async function loadCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  if (!isWikiUrl(tab.url)) {
    // Check if this domain is a custom tracked site
    const { sites = [] } = await send('GET_TRACKED_SITES');
    if (sites.length > 0) {
      let hostname;
      try { hostname = new URL(tab.url).hostname; } catch { return; }
      const site = sites.find((s) => hostname === s.domain || hostname.endsWith('.' + s.domain));
      if (site) await loadCustomSiteTab(tab, site);
    }
    return;
  }

  const titleEl = $('page-title');
  const catsEl = $('page-cats');
  const btnSave = $('btn-save');
  const btnSaveLater = $('btn-save-later');

  titleEl.textContent = tab.title.replace(/ - Wikipedia.*$/, '');

  const { saved, page, inReadingList } = await send('GET_PAGE_STATUS', { url: tab.url });

  if (saved) {
    titleEl.insertAdjacentHTML('beforeend', ' <span class="badge badge-saved">Saved</span>');
    if (page?.userCategory) {
        catsEl.textContent = page.userCategory;
      } else if (page?.categories?.length) {
        catsEl.textContent = page.categories.join(' · ');
      } else {
        catsEl.textContent = 'Fetching categories…';
        catsEl.style.fontStyle = 'italic';
        catsEl.style.opacity = '0.5';
      }
    if (page?.timestamp) {
      const date = new Date(page.timestamp).toLocaleDateString();
      const visits = page.visitCount || 1;
      const revisitEl = $('page-revisit-info');
      revisitEl.textContent = `Saved ${date} · ${visits} visit${visits === 1 ? '' : 's'}`;
      revisitEl.classList.remove('hidden');
    }
    btnSave.disabled = true;
    btnSave.textContent = '✓ Already saved';
  } else {
    titleEl.insertAdjacentHTML('beforeend', ' <span class="badge badge-unsaved">Not saved</span>');
    btnSave.disabled = false;
    btnSave.textContent = 'Save this page';
    btnSave.onclick = async () => {
      btnSave.disabled = true;
      btnSave.textContent = 'Saving…';
      const resp = await send('MANUAL_SAVE', { tabId: tab.id, url: tab.url, title: tab.title });
      if (resp?.ok) {
        flash('Saved!');
        btnSave.textContent = '✓ Saved';
        btnSaveLater.disabled = true;
        $('rl-picker').classList.add('hidden');
        titleEl.querySelector('.badge').className = 'badge badge-saved';
        titleEl.querySelector('.badge').textContent = 'Saved';
        await loadStats();
      } else {
        flash('Error saving page', '#f87171');
        btnSave.disabled = false;
        btnSave.textContent = 'Save this page';
      }
    };
  }

  if (inReadingList) {
    btnSaveLater.disabled = true;
    btnSaveLater.textContent = '🔖 In reading list';
  } else {
    btnSaveLater.disabled = false;
    btnSaveLater.onclick = () => showRLPicker(tab);
  }
}

// ── Custom site tab ───────────────────────────────────────────────────────────

async function loadCustomSiteTab(tab, site) {
  const titleEl = $('page-title');
  const catsEl = $('page-cats');
  const btnSave = $('btn-save');
  const btnSaveLater = $('btn-save-later');

  titleEl.textContent = tab.title || site.domain;
  catsEl.textContent = site.name || site.domain;

  const { saved, page } = await send('GET_CSITE_PAGE_STATUS', { domain: site.domain, url: tab.url });

  if (saved) {
    titleEl.insertAdjacentHTML('beforeend', ' <span class="badge badge-saved">Saved</span>');
    if (page?.timestamp) {
      const date = new Date(page.timestamp).toLocaleDateString();
      const visits = page.visitCount || 1;
      const revisitEl = $('page-revisit-info');
      revisitEl.textContent = `Saved ${date} · ${visits} visit${visits === 1 ? '' : 's'}`;
      revisitEl.classList.remove('hidden');
    }
    btnSave.disabled = true;
    btnSave.textContent = '✓ Already saved';
  } else {
    titleEl.insertAdjacentHTML('beforeend', ' <span class="badge badge-unsaved">Not saved</span>');
    btnSave.disabled = false;
    btnSave.textContent = 'Save this page';
    btnSave.onclick = async () => {
      btnSave.disabled = true;
      btnSave.textContent = 'Saving…';
      const resp = await send('MANUAL_SAVE_CSITE', {
        tabId: tab.id, domain: site.domain, url: tab.url, title: tab.title,
      });
      if (resp?.ok) {
        flash('Saved!');
        btnSave.textContent = '✓ Saved';
        titleEl.querySelector('.badge').className = 'badge badge-saved';
        titleEl.querySelector('.badge').textContent = 'Saved';
        await loadStats();
      } else {
        flash('Error saving page', '#f87171');
        btnSave.disabled = false;
        btnSave.textContent = 'Save this page';
      }
    };
  }

  // Reading list not supported for custom sites
  btnSaveLater.classList.add('hidden');
}

// ── Reading-list picker ───────────────────────────────────────────────────────

async function loadRLCategoryHints() {
  const { readingList } = await send('GET_READING_LIST');
  const cats = [...new Set((readingList || []).map((r) => r.userCategory).filter(Boolean))];
  const container = $('rl-existing-cats');
  container.innerHTML = '';
  cats.forEach((cat) => {
    const pill = document.createElement('button');
    pill.className = 'rl-cat-pill';
    pill.textContent = cat;
    pill.addEventListener('click', () => {
      $('rl-category-input').value = cat;
    });
    container.appendChild(pill);
  });
}

function showRLPicker(tab) {
  const picker = $('rl-picker');
  picker.classList.remove('hidden');
  $('rl-category-input').value = '';
  $('btn-save-later').disabled = true;
  loadRLCategoryHints();

  $('rl-cancel').onclick = () => {
    picker.classList.add('hidden');
    $('btn-save-later').disabled = false;
  };

  const confirm = async () => {
    const cat = $('rl-category-input').value.trim() || 'General';
    
    // 1. Aggiunge alla lista di lettura (per leggere dopo)
    const respRL = await send('ADD_TO_READING_LIST', { url: tab.url, title: tab.title, userCategory: cat });
    
    // 2. AGGIORNAMENTO FIX: Invia un comando anche per catalogare la pagina nel grafo
    // Questo comando deve andare a colpire il record creato dall'automatico
    await send('MANUAL_SAVE', { 
      tabId: tab.id, 
      url: tab.url, 
      title: tab.title,
      category: cat // Passiamo la categoria scelta
    });

    picker.classList.add('hidden');
    
    if (respRL?.ok) {
      flash('Catalogato in ' + cat);
      $('btn-save-later').disabled = true;
      $('btn-save-later').textContent = '🔖 In reading list';
      
      // Ricarichiamo la info della tab per far sparire "Fetching categories..."
      await loadCurrentTab(); 
      await loadStats();
    } else {
      flash('Error saving', '#f87171');
      $('btn-save-later').disabled = false;
    }
  };

  $('rl-confirm').onclick = confirm;
  $('rl-category-input').onkeydown = (e) => { if (e.key === 'Enter') confirm(); };
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

// ── Init ──────────────────────────────────────────────────────────────────────

(async () => {
  await Promise.all([loadStats(), loadCurrentTab(), loadSettings()]);
})();
