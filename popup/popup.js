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
  const btnSaveLater = $('btn-save-later');

  titleEl.textContent = tab.title.replace(/ - Wikipedia.*$/, '');

  const { saved, page, inReadingList } = await send('GET_PAGE_STATUS', { url: tab.url });

  if (saved) {
    titleEl.insertAdjacentHTML('beforeend', ' <span class="badge badge-saved">Saved</span>');
    if (page?.categories?.length) {
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
  } else if (!saved) {
    btnSaveLater.disabled = false;
    btnSaveLater.onclick = () => showRLPicker(tab);
  }
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
    const resp = await send('ADD_TO_READING_LIST', { url: tab.url, title: tab.title, userCategory: cat });
    picker.classList.add('hidden');
    if (resp?.ok) {
      flash(resp.alreadyExists ? 'Already in list' : 'Saved for later!');
      $('btn-save-later').disabled = true;
      $('btn-save-later').textContent = '🔖 In reading list';
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
