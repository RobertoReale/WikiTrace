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
    chrome.runtime.sendMessage({ type, ...extra }, resolve)
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
  if (!tab || !isWikiUrl(tab.url)) return;

  const titleEl = $('page-title');
  const catsEl = $('page-cats');
  const btnSave = $('btn-save');

  titleEl.textContent = tab.title.replace(/ - Wikipedia.*$/, '');

  const { saved, page } = await send('GET_PAGE_STATUS', { url: tab.url });

  if (saved) {
    titleEl.insertAdjacentHTML('beforeend', ' <span class="badge badge-saved">Saved</span>');
    if (page?.categories?.length) {
      catsEl.textContent = page.categories.join(' · ');
    } else {
      catsEl.textContent = 'Fetching categories…';
      catsEl.style.fontStyle = 'italic';
      catsEl.style.opacity = '0.5';
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
}

// ── Settings ──────────────────────────────────────────────────────────────────

async function loadSettings() {
  const { settings } = await send('GET_SETTINGS');
  $('save-mode').value = settings.saveMode ?? 'auto';
  applyTheme(settings.theme ?? 'dark');
}

$('save-mode').addEventListener('change', async (e) => {
  await send('SET_SETTINGS', { settings: { saveMode: e.target.value } });
  flash('Setting saved');
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
