'use strict';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

function send(type, extra = {}) {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage({ type, ...extra }, (r) => {
      void chrome.runtime.lastError;
      resolve(r);
    })
  );
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function strToHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) & 0xffffffff;
  return Math.abs(h) % 360;
}
function catColor(cat) {
  return `hsl(${strToHue(cat)},55%,58%)`;
}

// ─── App state ────────────────────────────────────────────────────────────────

let allPages = [];
let activeCategories = null;
let sortKey = 'date-desc';
let searchQuery = '';
let currentTab = 'list';
let currentSite = 'wikipedia';
let allTrackedSites = [];

let allWikiPages = [];
let allReadingList = [];
let rlSearchQuery = '';
let rlActiveCategory = null;
let rlActiveDomain = null;

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadPages() {
  if (currentSite === 'wikipedia') {
    const { pages } = await send('GET_PAGES');
    allPages = pages.sort((a, b) => b.timestamp - a.timestamp);
    allWikiPages = allPages;
  } else {
    const { pages } = await send('GET_CSITE_PAGES', { domain: currentSite });
    allPages = (pages || []).sort((a, b) => b.timestamp - a.timestamp);
  }
}

async function loadReadingList() {
  const { readingList } = await send('GET_READING_LIST');
  allReadingList = (readingList || []).sort((a, b) => b.savedAt - a.savedAt);
}

async function loadSiteSelector() {
  const { sites } = await send('GET_TRACKED_SITES');
  allTrackedSites = sites || [];
  updateSiteSelector();
}

function updateSiteSelector() {
  const sel = $('site-selector');
  const prev = sel.value;
  sel.innerHTML = '<option value="wikipedia">Wikipedia</option>';
  for (const s of allTrackedSites) {
    const opt = document.createElement('option');
    opt.value = s.domain;
    opt.textContent = s.name || s.domain;
    sel.appendChild(opt);
  }
  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function getCategories() {
  const counts = {};
  for (const p of allPages) {
    const c = p.userCategory || p.primaryCategory || 'Uncategorized';
    counts[c] = (counts[c] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

// ─── Category filter sidebar ──────────────────────────────────────────────────

function renderCategoryFilter() {
  const cats = getCategories();
  if (activeCategories === null) activeCategories = new Set(cats.map((c) => c[0]));

  const container = $('cat-filter-list');
  container.innerHTML = '';

  if (cats.length === 0) {
    container.innerHTML = '<span style="color:var(--text3);font-size:11px;">No categories yet</span>';
    return;
  }

  for (const [cat, count] of cats) {
    const el = document.createElement('div');
    el.className = 'cat-item' + (activeCategories.has(cat) ? '' : ' disabled');

    const dot = document.createElement('span');
    dot.className = 'cat-dot';
    dot.style.background = catColor(cat);

    const name = document.createElement('span');
    name.className = 'cat-name';
    name.title = cat;
    name.textContent = cat;

    const countSpan = document.createElement('span');
    countSpan.className = 'cat-count';
    countSpan.textContent = count;

    el.append(dot, name, countSpan);
    el.addEventListener('click', () => {
      if (activeCategories.has(cat)) {
        activeCategories.delete(cat);
      } else {
        activeCategories.add(cat);
      }
      renderCategoryFilter();
      renderList();
      graphView.applyFilter(activeCategories);
    });
    container.appendChild(el);
  }
}

// ─── Reading list helpers ─────────────────────────────────────────────────────

function getDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return 'Unknown'; }
}

function getRLDomains() {
  const counts = {};
  for (const r of allReadingList) {
    const d = getDomain(r.url);
    counts[d] = (counts[d] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function renderRLDomainFilter() {
  const domains = getRLDomains();
  if (rlActiveDomain === undefined) rlActiveDomain = null;

  const container = $('rl-domain-filter-list');
  if (!container) return;
  container.innerHTML = '';

  if (domains.length === 0) {
    container.innerHTML = '<span style="color:var(--text3);font-size:11px;">No sites yet</span>';
    return;
  }

  const allEl = document.createElement('div');
  allEl.className = 'cat-item' + (rlActiveDomain === null ? ' active' : '');
  allEl.innerHTML = '<span class="cat-name">All sites</span>';
  allEl.addEventListener('click', () => { rlActiveDomain = null; renderRLDomainFilter(); renderReadingList(); });
  container.appendChild(allEl);

  for (const [dom, count] of domains) {
    const el = document.createElement('div');
    el.className = 'cat-item' + (rlActiveDomain === dom ? ' active' : '');

    const name = document.createElement('span');
    name.className = 'cat-name';
    name.title = dom;
    name.textContent = dom;

    const countSpan = document.createElement('span');
    countSpan.className = 'cat-count';
    countSpan.textContent = count;

    el.append(name, countSpan);
    el.addEventListener('click', () => {
      rlActiveDomain = rlActiveDomain === dom ? null : dom;
      renderRLDomainFilter();
      renderReadingList();
    });
    container.appendChild(el);
  }
}

function getRLCategories() {
  const counts = {};
  for (const r of allReadingList) {
    const c = r.userCategory || 'General';
    counts[c] = (counts[c] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function renderRLCategoryFilter() {
  const cats = getRLCategories();
  if (rlActiveCategory === undefined) rlActiveCategory = null;

  const container = $('rl-cat-filter-list');
  container.innerHTML = '';

  if (cats.length === 0) {
    container.innerHTML = '<span style="color:var(--text3);font-size:11px;">No categories yet</span>';
    return;
  }

  const allEl = document.createElement('div');
  allEl.className = 'cat-item' + (rlActiveCategory === null ? ' active' : '');
  allEl.innerHTML = '<span class="cat-name">All</span>';
  allEl.addEventListener('click', () => { rlActiveCategory = null; renderRLCategoryFilter(); renderReadingList(); });
  container.appendChild(allEl);

  for (const [cat, count] of cats) {
    const el = document.createElement('div');
    el.className = 'cat-item' + (rlActiveCategory === cat ? ' active' : '');

    const dot = document.createElement('span');
    dot.className = 'cat-dot';
    dot.style.background = catColor(cat);

    const name = document.createElement('span');
    name.className = 'cat-name';
    name.title = cat;
    name.textContent = cat;

    const countSpan = document.createElement('span');
    countSpan.className = 'cat-count';
    countSpan.textContent = count;

    el.append(dot, name, countSpan);
    el.addEventListener('click', () => {
      rlActiveCategory = rlActiveCategory === cat ? null : cat;
      renderRLCategoryFilter();
      renderReadingList();
    });
    container.appendChild(el);
  }
}

function renderRLActiveFiltersBar() {
  const container = $('rl-active-filters');
  if (!container) return;

  const hasSearch = !!rlSearchQuery;
  const hasCat = rlActiveCategory !== null;
  const hasDomain = rlActiveDomain !== null;
  const hasSort = rlSortKey !== 'date-desc';

  if (!hasSearch && !hasCat && !hasDomain && !hasSort) {
    container.classList.add('hidden');
    return;
  }

  container.innerHTML = '';
  container.classList.remove('hidden');

  if (hasSearch) {
    const tag = document.createElement('div');
    tag.className = 'filter-tag';
    tag.innerHTML = `<span class="filter-tag-label">Search:</span> "${escHtml(rlSearchQuery)}" 
                     <button class="filter-tag-close" title="Clear search">&times;</button>`;
    tag.querySelector('.filter-tag-close').onclick = () => {
      rlSearchQuery = '';
      $('rl-search-input').value = '';
      renderReadingList();
    };
    container.appendChild(tag);
  }

  if (hasCat) {
    const tag = document.createElement('div');
    tag.className = 'filter-tag';
    tag.innerHTML = `<span class="filter-tag-label">Category:</span> ${escHtml(rlActiveCategory)} 
                     <button class="filter-tag-close" title="Clear category">&times;</button>`;
    tag.querySelector('.filter-tag-close').onclick = () => {
      rlActiveCategory = null;
      renderRLCategoryFilter();
      renderReadingList();
    };
    container.appendChild(tag);
  }

  if (hasDomain) {
    const tag = document.createElement('div');
    tag.className = 'filter-tag';
    tag.innerHTML = `<span class="filter-tag-label">Site:</span> ${escHtml(rlActiveDomain)} 
                     <button class="filter-tag-close" title="Clear site">&times;</button>`;
    tag.querySelector('.filter-tag-close').onclick = () => {
      rlActiveDomain = null;
      renderRLDomainFilter();
      renderReadingList();
    };
    container.appendChild(tag);
  }

  if (hasSort) {
    let sortName = '';
    switch(rlSortKey) {
      case 'date-asc': sortName = 'Date ↑'; break;
      case 'title': sortName = 'Title A-Z'; break;
      case 'domain': sortName = 'Domain'; break;
      case 'category': sortName = 'Category'; break;
    }
    const tag = document.createElement('div');
    tag.className = 'filter-tag';
    tag.innerHTML = `<span class="filter-tag-label">Sort:</span> ${sortName} 
                     <button class="filter-tag-close" title="Reset sort">&times;</button>`;
    tag.querySelector('.filter-tag-close').onclick = () => {
      rlSortKey = 'date-desc';
      document.querySelectorAll('.rl-sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === 'date-desc'));
      renderReadingList();
    };
    container.appendChild(tag);
  }

  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn-clear-filters';
  clearBtn.textContent = 'Clear all filters';
  clearBtn.onclick = () => {
    rlSearchQuery = '';
    $('rl-search-input').value = '';
    rlActiveCategory = null;
    rlActiveDomain = null;
    rlSortKey = 'date-desc';
    document.querySelectorAll('.rl-sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === 'date-desc'));
    renderRLCategoryFilter();
    renderRLDomainFilter();
    renderReadingList();
  };
  container.appendChild(clearBtn);
}

function renderReadingList() {
  renderRLActiveFiltersBar();
  const container = $('rl-view');
  const visitedUrls = new Set(allWikiPages.map((p) => p.url));
  const q = rlSearchQuery.toLowerCase();

  const items = allReadingList.filter((r) => {
    if (rlActiveCategory && r.userCategory !== rlActiveCategory) return false;
    if (rlActiveDomain && getDomain(r.url) !== rlActiveDomain) return false;
    if (q && !r.title.toLowerCase().includes(q) && !(r.userCategory || '').toLowerCase().includes(q) && !getDomain(r.url).includes(q)) return false;
    return true;
  }).sort((a, b) => {
    switch (rlSortKey) {
      case 'date-asc':  return a.savedAt - b.savedAt;
      case 'date-desc': return b.savedAt - a.savedAt;
      case 'title':     return a.title.localeCompare(b.title);
      case 'domain':    return getDomain(a.url).localeCompare(getDomain(b.url));
      case 'category':  return (a.userCategory || 'zzz').localeCompare(b.userCategory || 'zzz');
      default:          return b.savedAt - a.savedAt;
    }
  });

  if (items.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>${allReadingList.length === 0 ? 'Your reading list is empty.' : 'No results match your filter.'}</p>
        <small>${allReadingList.length === 0 ? 'Use "Save for later" in the popup to add pages.' : 'Try adjusting your search or category filter.'}</small>
      </div>`;
    return;
  }

  const rows = items.map((r) => {
    const cat = r.userCategory || 'General';
    const color = catColor(cat);
    const bg = color.replace('hsl(', 'hsla(').replace(')', ',0.15)');
    const dom = getDomain(r.url);
    return `
      <tr data-rl-id="${r.id}">
        <td class="col-title"><a href="${escHtml(r.url)}" target="_blank">${escHtml(r.title)}</a></td>
        <td class="col-date">${formatDate(r.savedAt)}</td>
        <td class="col-domain"><span style="font-size:11px;color:var(--text3);">${escHtml(dom)}</span></td>
        <td class="col-cat"><span class="cat-pill" style="color:${color};background:${bg}">${escHtml(cat)}</span></td>
        <td class="col-actions">
          <button class="rl-mark-read" data-rl-read="${r.id}" title="Mark as read">✓ Read</button>
          <button class="rl-remove" data-rl-del="${r.id}" title="Remove">&times;</button>
        </td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <table>
      <thead><tr>
        <th>Title</th><th>Saved</th><th>Domain</th><th>Category</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  container.querySelectorAll('[data-rl-read]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.rlRead;
      await send('MARK_AS_READ', { id });
      allReadingList = allReadingList.filter((r) => r.id !== id);
      await loadPages();
      renderStats();
      renderReadingList();
    });
  });

  container.querySelectorAll('[data-rl-del]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.rlDel;
      await send('REMOVE_FROM_READING_LIST', { id });
      allReadingList = allReadingList.filter((r) => r.id !== id);
      renderRLCategoryFilter();
      renderRLDomainFilter();
      renderReadingList();
    });
  });
}

function renderRLStats() {
  $('topbar-stats').textContent =
    `${allReadingList.length} item${allReadingList.length !== 1 ? 's' : ''} · ${getRLCategories().length} categories`;
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

function renderStats() {
  if (currentSite === 'wikipedia') {
    const cats = new Set(allPages.map((p) => p.userCategory || p.primaryCategory).filter(Boolean));
    $('topbar-stats').textContent =
      `${allPages.length} page${allPages.length !== 1 ? 's' : ''} · ${cats.size} categories`;
  } else {
    const siteName = allTrackedSites.find((s) => s.domain === currentSite)?.name || currentSite;
    $('topbar-stats').textContent =
      `${siteName} · ${allPages.length} page${allPages.length !== 1 ? 's' : ''}`;
  }
}

// ─── List view ────────────────────────────────────────────────────────────────

function filteredPages() {
  const q = searchQuery.toLowerCase();
  return allPages
    .filter((p) => {
      const cat = p.userCategory || p.primaryCategory || 'Uncategorized';
      if (activeCategories && !activeCategories.has(cat)) return false;
      if (q && !p.title.toLowerCase().includes(q) && !cat.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => {
      switch (sortKey) {
        case 'date-asc':  return a.timestamp - b.timestamp;
        case 'date-desc': return b.timestamp - a.timestamp;
        case 'title':     return a.title.localeCompare(b.title);
        case 'category':  return (a.userCategory || a.primaryCategory || 'zzz').localeCompare(b.userCategory || b.primaryCategory || 'zzz');
        default: return 0;
      }
    });
}

function renderList() {
  const container = $('list-view');
  const pages = filteredPages();

  if (pages.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>${allPages.length === 0 ? 'No pages saved yet.' : 'No results match your filter.'}</p>
        <small>${allPages.length === 0 ? 'Browse some pages — they appear here automatically.' : 'Try adjusting your search or category filters.'}</small>
      </div>`;
    return;
  }

  const rows = pages.map((p) => {
    const cat = p.userCategory || p.primaryCategory || 'Uncategorized';
    const color = catColor(cat);
    const bg = color.replace('hsl(', 'hsla(').replace(')', ',0.15)');
    return `
      <tr data-id="${p.id}">
        <td class="col-title"><a href="${escHtml(p.url)}" target="_blank">${escHtml(p.title)}</a></td>
        <td class="col-date">${formatDate(p.timestamp)}</td>
        <td class="col-cat"><span class="cat-pill" style="color:${color};background:${bg}">${escHtml(cat)}</span></td>
        <td class="col-del"><button title="Remove" data-del="${p.id}">&times;</button></td>
      </tr>`;
  }).join('');

  container.innerHTML = `
    <table>
      <thead><tr>
        <th>Title</th><th>Date added</th><th>Category</th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  container.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.del;
      if (currentSite === 'wikipedia') {
        await send('DELETE_PAGE', { id });
      } else {
        await send('DELETE_CSITE_PAGE', { domain: currentSite, id });
      }
      allPages = allPages.filter((p) => p.id !== id);
      renderStats();
      renderCategoryFilter();
      renderList();
      if (graphView.built) graphView.rebuild(allPages);
    });
  });
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Sort buttons ─────────────────────────────────────────────────────────────

document.querySelectorAll('.sort-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    sortKey = btn.dataset.sort;
    document.querySelectorAll('.sort-btn').forEach((b) => b.classList.toggle('active', b === btn));
    renderList();
  });
});

$('search-input').addEventListener('input', (e) => {
  searchQuery = e.target.value;
  renderList();
});

// ─── Site selector ────────────────────────────────────────────────────────────

$('site-selector').addEventListener('change', async (e) => {
  currentSite = e.target.value;
  graphView.setPosKey(currentSite === 'wikipedia' ? 'wt-positions' : `wt-positions-${currentSite}`);
  activeCategories = null;
  await loadPages();
  renderStats();
  renderCategoryFilter();
  renderList();
  if (graphView.built) graphView.rebuild(allPages);
  $('add-url-section').classList.toggle('hidden', currentSite !== 'wikipedia' || currentTab === 'readinglist');
});

// ─── Tab switching ────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    currentTab = btn.dataset.tab;
    window.location.hash = currentTab;
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    $('panel-list').classList.toggle('hidden', currentTab !== 'list');
    $('panel-graph').classList.toggle('hidden', currentTab !== 'graph');
    $('panel-about').classList.toggle('hidden', currentTab !== 'about');
    $('panel-readinglist').classList.toggle('hidden', currentTab !== 'readinglist');
    $('panel-sites').classList.toggle('hidden', currentTab !== 'sites');
    const hideSidebar = currentTab === 'about' || currentTab === 'sites';
    document.querySelector('.sidebar').classList.toggle('hidden', hideSidebar);
    $('list-controls').style.display = currentTab === 'list' ? '' : 'none';
    $('cat-filter-section').classList.toggle('hidden', currentTab === 'readinglist' || currentTab === 'sites');
    $('add-url-section').classList.toggle('hidden',
      currentSite !== 'wikipedia' || currentTab === 'readinglist' || currentTab === 'sites');
    $('rl-controls').classList.toggle('hidden', currentTab !== 'readinglist');
    $('rl-cat-section').classList.toggle('hidden', currentTab !== 'readinglist');
    $('rl-domain-section').classList.toggle('hidden', currentTab !== 'readinglist');
    $('btn-export-svg').classList.toggle('hidden', currentTab !== 'graph');
    $('btn-export-png').classList.toggle('hidden', currentTab !== 'graph');
    
    (async () => {
      if (currentTab === 'graph') {
        await loadPages();
        graphView.init(allPages);
      }
      if (currentTab === 'readinglist') {
        await loadReadingList();
        renderRLStats();
        renderRLCategoryFilter();
        renderRLDomainFilter();
        renderReadingList();
      } else if (currentTab === 'sites') {
        renderSitesPanel();
      } else if (currentTab === 'list') {
        await loadPages();
        renderStats();
        renderCategoryFilter();
        renderList();
      } else {
        renderStats();
      }
    })();
  });
});

$('rl-search-input').addEventListener('input', (e) => {
  rlSearchQuery = e.target.value;
  renderReadingList();
});

let rlSortKey = 'date-desc';
document.querySelectorAll('.rl-sort-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    rlSortKey = btn.dataset.sort;
    document.querySelectorAll('.rl-sort-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    renderReadingList();
  });
});

// ─── Sites panel ──────────────────────────────────────────────────────────────

async function renderSitesPanel() {
  const container = $('sites-list');
  container.innerHTML = '';

  const wikiPageCount = currentSite === 'wikipedia'
    ? allPages.length
    : (await send('GET_PAGES')).pages.length;
  container.appendChild(buildSiteCard(
    { domain: 'wikipedia.org', name: 'Wikipedia' }, true, wikiPageCount
  ));

  for (const site of allTrackedSites) {
    const { pages } = await send('GET_CSITE_PAGES', { domain: site.domain });
    container.appendChild(buildSiteCard(site, false, (pages || []).length));
  }
}

function buildSiteCard(site, isBuiltin, pageCount) {
  const count = pageCount ?? '…';
  const card = document.createElement('div');
  card.className = 'site-card';
  card.innerHTML = `
    <div class="site-card-info">
      <div class="site-card-domain">
        ${escHtml(site.domain)}
        ${isBuiltin ? '<span class="site-card-builtin">built-in</span>' : ''}
      </div>
      <div class="site-card-name">${escHtml(site.name || site.domain)}</div>
      <div class="site-card-stats">${count} page${count !== 1 ? 's' : ''} saved</div>
    </div>
    <div class="site-card-actions">
      <button class="btn-goto-site" title="View this site's pages">View →</button>
      ${!isBuiltin ? `<button class="btn-danger-text" title="Remove site and delete all data">Remove</button>` : ''}
    </div>`;

  card.querySelector('.btn-goto-site').addEventListener('click', () => {
    const val = isBuiltin ? 'wikipedia' : site.domain;
    $('site-selector').value = val;
    $('site-selector').dispatchEvent(new Event('change'));
    document.querySelector('.tab[data-tab="list"]').click();
  });

  const removeBtn = card.querySelector('.btn-danger-text');
  if (removeBtn) {
    removeBtn.addEventListener('click', async () => {
      if (!confirm(`Remove ${site.domain}? All saved pages will be deleted.`)) return;
      await send('REMOVE_TRACKED_SITE', { domain: site.domain });
      allTrackedSites = allTrackedSites.filter((s) => s.domain !== site.domain);
      localStorage.removeItem(`wt-positions-${site.domain}`);
      if (currentSite === site.domain) {
        currentSite = 'wikipedia';
        graphView.setPosKey('wt-positions');
        $('site-selector').value = 'wikipedia';
        await loadPages();
        renderStats();
        renderCategoryFilter();
        renderList();
      }
      updateSiteSelector();
      renderSitesPanel();
    });
  }

  return card;
}

$('btn-add-site').addEventListener('click', async () => {
  const domain = $('sites-domain-input').value.trim();
  const name = $('sites-name-input').value.trim();
  const msgEl = $('sites-add-msg');

  if (!domain) {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = 'Please enter a domain.';
    return;
  }

  $('btn-add-site').disabled = true;
  const resp = await send('ADD_TRACKED_SITE', { domain, name });
  $('btn-add-site').disabled = false;

  if (resp?.ok) {
    $('sites-domain-input').value = '';
    $('sites-name-input').value = '';
    msgEl.style.color = 'var(--success)';
    msgEl.textContent = `Now tracking ${resp.site.domain}`;
    allTrackedSites.push(resp.site);
    updateSiteSelector();
    renderSitesPanel();
    setTimeout(() => { msgEl.textContent = ''; }, 3000);
  } else {
    msgEl.style.color = 'var(--danger)';
    msgEl.textContent = resp?.error === 'already_tracked'
      ? 'This site is already being tracked.'
      : resp?.error === 'invalid_domain'
        ? 'Invalid domain. Use a format like britannica.com'
        : 'Failed to add site. Please try again.';
  }
});

$('sites-domain-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-add-site').click();
});

// ─── Add URLs ─────────────────────────────────────────────────────────────────

$('btn-add-urls').addEventListener('click', async () => {
  const raw = $('add-urls-input').value.trim();
  if (!raw) return;

  const entries = raw.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('wikipedia.org/wiki/'))
    .map((url) => ({ url }));

  if (entries.length === 0) {
    $('add-msg').style.color = '#f87171';
    $('add-msg').textContent = 'No valid Wikipedia URLs found.';
    return;
  }

  $('btn-add-urls').disabled = true;
  const resp = await send('ADD_URLS', { entries });
  $('btn-add-urls').disabled = false;

  if (resp?.ok) {
    $('add-urls-input').value = '';
    $('add-msg').style.color = 'var(--success)';
    $('add-msg').textContent = `Added ${resp.added} new page(s).`;
    setTimeout(() => { $('add-msg').textContent = ''; }, 3000);
    await loadPages();
    renderStats();
    renderCategoryFilter();
    renderList();
    if (graphView.built) graphView.rebuild(allPages);
  }
});

// ─── Clear all ────────────────────────────────────────────────────────────────

$('btn-clear').addEventListener('click', async () => {
  if (!confirm('Delete all saved pages and reading list? This cannot be undone.')) return;
  await send('CLEAR_ALL');
  localStorage.removeItem('wt-positions');
  for (const site of allTrackedSites) {
    localStorage.removeItem(`wt-positions-${site.domain}`);
  }
  allPages = [];
  allReadingList = [];
  activeCategories = null;
  rlActiveCategory = null;
  graphView.clear();
  renderStats();
  renderCategoryFilter();
  renderList();
  if (currentTab === 'readinglist') { renderRLCategoryFilter(); renderReadingList(); }
  if (currentTab === 'sites') renderSitesPanel();
});

// ─── Import / Export ──────────────────────────────────────────────────────────

$('btn-export').addEventListener('click', async () => {
  const [{ pages }, { readingList }, { sites }] = await Promise.all([
    send('GET_PAGES'),
    send('GET_READING_LIST'),
    send('GET_TRACKED_SITES'),
  ]);

  const customSites = {};
  for (const site of (sites || [])) {
    const { pages: sitePages } = await send('GET_CSITE_PAGES', { domain: site.domain });
    customSites[site.domain] = { name: site.name || site.domain, pages: sitePages || [] };
  }

  const data = { pages, readingList: readingList || [], trackedSites: sites || [], customSites };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `wikitrace-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('btn-export-svg').addEventListener('click', () => exportGraph('svg'));
$('btn-export-png').addEventListener('click', () => exportGraph('png'));

$('btn-import').addEventListener('click', () => $('import-file-input').click());

$('import-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const parsed = JSON.parse(ev.target.result);
      const nodes = Array.isArray(parsed) ? parsed : (parsed.pages || []);
      const readingListItems = Array.isArray(parsed) ? [] : (parsed.readingList || []);
      const resp = await send('IMPORT_PAGES', { nodes, readingListItems });

      let customAdded = 0;
      if (parsed.customSites && typeof parsed.customSites === 'object') {
        for (const [domain, siteData] of Object.entries(parsed.customSites)) {
          const cResp = await send('IMPORT_CSITE', {
            domain, name: siteData.name, pages: siteData.pages || [],
          });
          if (cResp?.ok) customAdded += cResp.added;
        }
      }

      if (resp?.ok) {
        const rlMsg = resp.addedRL > 0 ? `, ${resp.addedRL} reading list item(s)` : '';
        const csMsg = customAdded > 0 ? `, ${customAdded} custom site page(s)` : '';
        showIOToast(`Imported ${resp.added} new page(s)${rlMsg}${csMsg}.`);
        await Promise.all([loadPages(), loadReadingList(), loadSiteSelector()]);
        renderStats();
        renderCategoryFilter();
        renderList();
        if (graphView.built) graphView.rebuild(allPages);
        if (currentTab === 'sites') renderSitesPanel();
      }
    } catch {
      showIOToast('Import failed: invalid JSON file.', 'error');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

function exportGraph(format) {
  const svgEl = document.getElementById('graph-svg');
  if (!svgEl || !graphView.built) { showIOToast('Build the graph first by switching to the Graph tab.', 'error'); return; }

  const rootStyle = getComputedStyle(document.documentElement);
  const resolve = (v) => rootStyle.getPropertyValue(v).trim();
  const W = svgEl.clientWidth;
  const H = svgEl.clientHeight;

  const clone = svgEl.cloneNode(true);
  clone.setAttribute('width', W);
  clone.setAttribute('height', H);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('width', W); bg.setAttribute('height', H);
  bg.setAttribute('fill', resolve('--bg0'));
  clone.insertBefore(bg, clone.firstChild);

  const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  styleEl.textContent = [
    `.node text{font-size:10px;fill:${resolve('--text')};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}`,
    `.cluster-label{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;fill-opacity:.7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}`,
    `.link{stroke:#475569;stroke-opacity:0.4;} .link.chrono{stroke-dasharray:4 3;}`,
  ].join('');
  clone.insertBefore(styleEl, clone.firstChild);

  const svgBlob = new Blob(
    ['<?xml version="1.0" standalone="no"?>\n', new XMLSerializer().serializeToString(clone)],
    { type: 'image/svg+xml;charset=utf-8' }
  );
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === 'svg') {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(svgBlob);
    a.download = `wikitrace-graph-${stamp}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
    return;
  }

  const blobUrl = URL.createObjectURL(svgBlob);
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = W * 2; canvas.height = H * 2;
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(blobUrl);
    const a = document.createElement('a');
    a.download = `wikitrace-graph-${stamp}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  };
  img.onerror = () => URL.revokeObjectURL(blobUrl);
  img.src = blobUrl;
}

function showIOToast(msg, type = 'success') {
  const el = $('io-toast');
  el.textContent = msg;
  el.style.color = type === 'success' ? 'var(--success)' : 'var(--danger)';
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

// ─── D3 Graph view ────────────────────────────────────────────────────────────

const graphView = (() => {
  if (typeof d3 === 'undefined') {
    return {
      built: false,
      init() {
        $('graph-empty').innerHTML = `
          <p>D3.js not found.</p>
          <small>Place <code>d3.min.js</code> in <code>lib/</code>. See README.</small>`;
        $('graph-empty').classList.remove('hidden');
      },
      applyFilter() {}, rebuild() {}, clear() {}, setPosKey() {},
    };
  }

  let built = false;
  let simulation = null;
  let svgRoot = null;
  let gMain = null;
  let nodesData = [];
  let linksData = [];
  let activeFilter = null;
  let posKey = 'wt-positions';

  function buildEdges(pages) {
    const byId = new Map(pages.map((p) => [p.id, p]));
    const edges = [];
    const seen = new Set();

    for (const p of pages) {
      if (p.parentId && byId.has(p.parentId)) {
        const key = `${p.parentId}|${p.id}`;
        if (!seen.has(key)) { seen.add(key); edges.push({ source: p.parentId, target: p.id, type: 'nav' }); }
      }
    }

    const unlinked = [...pages]
      .filter((p) => !p.parentId || !byId.has(p.parentId))
      .sort((a, b) => a.timestamp - b.timestamp);

    for (let i = 1; i < unlinked.length; i++) {
      const key = `${unlinked[i - 1].id}|${unlinked[i].id}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ source: unlinked[i - 1].id, target: unlinked[i].id, type: 'chrono' });
      }
    }

    return edges;
  }

  function forceCluster() {
    const STRENGTH = 0.09;
    let nodes;
    function force(alpha) {
      const byCategory = {};
      for (const n of nodes) {
        const c = n.category || 'Uncategorized';
        if (!byCategory[c]) byCategory[c] = [];
        byCategory[c].push(n);
      }
      for (const catNodes of Object.values(byCategory)) {
        const cx = catNodes.reduce((s, n) => s + (n.x || 0), 0) / catNodes.length;
        const cy = catNodes.reduce((s, n) => s + (n.y || 0), 0) / catNodes.length;
        for (const n of catNodes) {
          n.vx += (cx - n.x) * STRENGTH * alpha;
          n.vy += (cy - n.y) * STRENGTH * alpha;
        }
      }
    }
    force.initialize = (n) => { nodes = n; };
    return force;
  }

  function expandedHullPath(points, padding) {
    if (points.length === 0) return null;
    if (points.length === 1) {
      const [x, y] = points[0];
      const r = padding + 12;
      return `M ${x - r},${y} a ${r},${r} 0 1,0 ${r * 2},0 a ${r},${r} 0 1,0 ${-r * 2},0`;
    }
    if (points.length === 2) {
      const cx = (points[0][0] + points[1][0]) / 2;
      const cy = (points[0][1] + points[1][1]) / 2;
      const dx = points[1][0] - points[0][0];
      const dy = points[1][1] - points[0][1];
      const dist = Math.sqrt(dx * dx + dy * dy) / 2 + padding;
      return `M ${cx - dist},${cy} a ${dist},${padding + 12} 0 1,0 ${dist * 2},0 a ${dist},${padding + 12} 0 1,0 ${-dist * 2},0`;
    }
    const hull = d3.polygonHull(points);
    if (!hull) return null;
    const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length;
    const cy = hull.reduce((s, p) => s + p[1], 0) / hull.length;
    const expanded = hull.map(([x, y]) => {
      const len = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) || 1;
      return [x + ((x - cx) / len) * padding, y + ((y - cy) / len) * padding];
    });
    return `M${expanded.map((p) => p.join(',')).join('L')}Z`;
  }

  function build(inputPages) {
    built = true;
    const svg = d3.select('#graph-svg');
    svg.selectAll('*').remove();

    if (inputPages.length === 0) { $('graph-empty').classList.remove('hidden'); return; }
    $('graph-empty').classList.add('hidden');

    const MAX_NODES = 100;
    const notice = $('graph-notice');
    let pages = inputPages;
    if (inputPages.length > MAX_NODES) {
      pages = [...inputPages].sort((a, b) => b.timestamp - a.timestamp).slice(0, MAX_NODES);
      notice.textContent = `Showing ${MAX_NODES} of ${inputPages.length} pages (most recent). Use category filters to narrow down.`;
      notice.classList.remove('hidden');
    } else {
      notice.classList.add('hidden');
    }

    const W = $('graph-svg').clientWidth || 900;
    const H = $('graph-svg').clientHeight || 600;

    svgRoot = svg;
    gMain = svg.append('g');

    const zoomBehavior = d3.zoom().scaleExtent([0.05, 8]).on('zoom', (e) => {
      gMain.attr('transform', e.transform);
    });
    svg.call(zoomBehavior);

    d3.select('#btn-zoom-in').on('click', () => svg.transition().duration(300).call(zoomBehavior.scaleBy, 1.3));
    d3.select('#btn-zoom-out').on('click', () => svg.transition().duration(300).call(zoomBehavior.scaleBy, 0.7));
    d3.select('#btn-zoom-reset').on('click', () => svg.transition().duration(300).call(zoomBehavior.transform, d3.zoomIdentity));
    d3.select('#btn-reset-layout').on('click', () => {
      if (confirm('Are you sure you want to reset the graph layout?')) {
        localStorage.removeItem(posKey);
        graphView.rebuild(pages);
      }
    });

    const cachedPos = JSON.parse(localStorage.getItem(posKey) || '{}');
    linksData = buildEdges(pages);

    const degree = {};
    for (const p of pages) degree[p.id] = 0;
    for (const e of linksData) {
      degree[e.source]++;
      degree[e.target]++;
    }

    // Smart initial positioning: spawn nodes in a circle grouped by category
    const uniqueCats = [...new Set(pages.map(p => p.userCategory || p.primaryCategory || 'Uncategorized'))];
    const catAngles = {};
    uniqueCats.forEach((c, i) => { catAngles[c] = (i / uniqueCats.length) * 2 * Math.PI; });
    const spawnRadius = Math.min(W, H) * 0.35;

    nodesData = pages.map((p) => {
      const cat = p.userCategory || p.primaryCategory || 'Uncategorized';
      const angle = catAngles[cat] || 0;
      return {
        id: p.id, title: p.title, url: p.url,
        category: cat,
        timestamp: p.timestamp,
        r: Math.min(20, Math.max(7, 5 + Math.sqrt(degree[p.id] || 0) * 1.5)),
        x: cachedPos[p.id]?.x ?? (W / 2 + Math.cos(angle) * spawnRadius + (Math.random() - 0.5) * 80),
        y: cachedPos[p.id]?.y ?? (H / 2 + Math.sin(angle) * spawnRadius + (Math.random() - 0.5) * 80),
      };
    });

    const adjacent = new Set();
    for (const e of linksData) {
      adjacent.add(`${e.source},${e.target}`);
      adjacent.add(`${e.target},${e.source}`);
    }
    const isConnected = (a, b) => a === b || adjacent.has(`${a},${b}`);

    const categories = [...new Set(nodesData.map((n) => n.category))];
    const allNewNodes = nodesData.some((n) => !cachedPos[n.id]);

    const gHulls  = gMain.append('g').attr('class', 'hulls');
    const gLabels = gMain.append('g').attr('class', 'cluster-labels');
    const gLinks  = gMain.append('g').attr('class', 'links');
    const gNodes  = gMain.append('g').attr('class', 'nodes');

    const link = gLinks.selectAll('.link')
      .data(linksData).join('line')
      .attr('class', (d) => `link ${d.type}`)
      .attr('stroke', '#475569').attr('stroke-width', 1.2);

    const nodeG = gNodes.selectAll('.node')
      .data(nodesData, (d) => d.id).join('g').attr('class', 'node')
      .call(d3.drag()
        .on('start', (e, d) => { if (!e.active) simulation.alphaTarget(0.1).restart(); d.fx = d.x; d.fy = d.y; })
        .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on('end',   (e, d) => { if (!e.active) simulation.alphaTarget(0); d.fx = null; d.fy = null; }));

    nodeG.append('circle')
      .attr('r', (d) => d.r)
      .attr('fill', (d) => catColor(d.category))
      .attr('stroke', (d) => catColor(d.category).replace('58%)', '78%)'));

    let tooltip = document.querySelector('.graph-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'graph-tooltip hidden';
      tooltip.innerHTML = '<div class="tt-title"></div><div class="tt-date"></div>';
      document.body.appendChild(tooltip);
    }

    nodeG
      .on('mouseenter', (e, d) => {
        tooltip.querySelector('.tt-title').textContent = d.title;
        tooltip.querySelector('.tt-date').textContent = formatDate(d.timestamp);
        tooltip.classList.remove('hidden');
        
        nodeG.style('opacity', n => isConnected(d.id, n.id) ? 1 : 0.08);
        nodeG.selectAll('text').style('opacity', n => isConnected(d.id, n.id) ? 1 : 0);
        link.style('stroke-opacity', l => (l.source.id === d.id || l.target.id === d.id) ? 0.8 : 0.04)
            .style('stroke-width', l => (l.source.id === d.id || l.target.id === d.id) ? 2 : 1.2);
      })
      .on('mousemove', (e) => {
        tooltip.style.left = (e.clientX + 14) + 'px';
        tooltip.style.top  = (e.clientY - 8) + 'px';
      })
      .on('mouseleave', () => {
        tooltip.classList.add('hidden');
        if (activeFilter) {
          applyFilter(activeFilter);
        } else {
          nodeG.style('opacity', 1);
          nodeG.selectAll('text').style('opacity', n => n.r > 9 ? 1 : 0);
          link.style('stroke-opacity', 0.4).style('stroke-width', 1.2);
        }
      })
      .on('click', (e, d) => { if (!e.defaultPrevented) chrome.tabs.create({ url: d.url }); });

    nodeG.append('text').attr('dx', (d) => d.r + 3).attr('dy', '.35em')
      .style('opacity', (d) => d.r > 9 ? 1 : 0)
      .text((d) => d.title.length > 28 ? d.title.slice(0, 26) + '…' : d.title);

    const isLarge = pages.length > 500;
    simulation = d3.forceSimulation(nodesData)
      .force('link', d3.forceLink(linksData).id((d) => d.id).distance(70).strength(0.4))
      .force('charge', d3.forceManyBody().strength(-180).distanceMax(isLarge ? 250 : 400))
      .force('center', d3.forceCenter(W / 2, H / 2).strength(0.04))
      .force('collision', d3.forceCollide((d) => d.r + 8).strength(0.7))
      .force('cluster', forceCluster())
      .alphaDecay(isLarge ? 0.08 : 0.04).velocityDecay(0.38);

    if (!allNewNodes) simulation.alpha(0.15);

    simulation.on('tick', () => {
      link
        .attr('x1', (d) => d.source.x).attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x).attr('y2', (d) => d.target.y);
      nodeG.attr('transform', (d) => `translate(${d.x},${d.y})`);
      updateHulls(categories, gHulls, gLabels);
    });

    simulation.on('end', () => {
      const pos = {};
      for (const n of nodesData) pos[n.id] = { x: n.x, y: n.y };
      localStorage.setItem(posKey, JSON.stringify(pos));
    });

    if (activeFilter) applyFilter(activeFilter);
  }

  function updateHulls(categories, gHulls, gLabels) {
    const visible = activeFilter;
    const hullData = categories
      .filter((c) => !visible || visible.has(c))
      .map((cat) => ({
        cat,
        nodes: nodesData.filter((n) => n.category === cat && (!visible || visible.has(n.category))),
      }))
      .filter((d) => d.nodes.length > 0);

    gHulls.selectAll('.hull').data(hullData, (d) => d.cat).join('path')
      .attr('class', 'hull')
      .attr('fill', (d) => catColor(d.cat)).attr('fill-opacity', 0.09)
      .attr('stroke', (d) => catColor(d.cat)).attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '5,3')
      .attr('d', (d) => expandedHullPath(d.nodes.map((n) => [n.x, n.y]), 22));

    const LABEL_H = 14;
    const HULL_PAD = 22;
    const LABEL_MARGIN = 16;

    const labelPos = hullData.map((d) => {
      const cx = d.nodes.reduce((s, n) => s + n.x, 0) / d.nodes.length;
      const cy = d.nodes.reduce((s, n) => s + n.y, 0) / d.nodes.length;
      return {
        cat: d.cat, cx, cy,
        hMinX: Math.min(...d.nodes.map((n) => n.x)) - HULL_PAD,
        hMaxX: Math.max(...d.nodes.map((n) => n.x)) + HULL_PAD,
        hMinY: Math.min(...d.nodes.map((n) => n.y)) - HULL_PAD,
        hMaxY: Math.max(...d.nodes.map((n) => n.y)) + HULL_PAD,
        x: 0, y: 0, anchor: 'middle',
      };
    });

    const gcx = labelPos.reduce((s, lp) => s + lp.cx, 0) / labelPos.length;
    const gcy = labelPos.reduce((s, lp) => s + lp.cy, 0) / labelPos.length;
    for (const lp of labelPos) {
      let dx = lp.cx - gcx, dy = lp.cy - gcy;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1) { dx = 0; dy = -1; }
      else { dx /= len; dy /= len; }

      if (Math.abs(dy) >= Math.abs(dx)) {
        lp.anchor = 'middle';
        lp.x = lp.cx;
        lp.y = dy <= 0 ? lp.hMinY - LABEL_MARGIN : lp.hMaxY + LABEL_MARGIN;
      } else {
        lp.y = lp.cy;
        if (dx < 0) { lp.anchor = 'end';   lp.x = lp.hMinX - LABEL_MARGIN; }
        else        { lp.anchor = 'start'; lp.x = lp.hMaxX + LABEL_MARGIN; }
      }
    }

    const lbbox = (lp) => {
      const hw = lp.cat.length * 3.5;
      const lx = lp.anchor === 'start' ? lp.x : lp.anchor === 'end' ? lp.x - hw * 2 : lp.x - hw;
      const rx = lp.anchor === 'start' ? lp.x + hw * 2 : lp.anchor === 'end' ? lp.x : lp.x + hw;
      return { lx, rx, ty: lp.y - LABEL_H, by: lp.y + 4 };
    };

    for (let iter = 0; iter < 30; iter++) {
      let moved = false;
      for (let i = 0; i < labelPos.length; i++) {
        for (let j = i + 1; j < labelPos.length; j++) {
          const a = labelPos[i], b = labelPos[j];
          const ba = lbbox(a), bb = lbbox(b);
          if (ba.rx > bb.lx && ba.lx < bb.rx && ba.by > bb.ty && ba.ty < bb.by) {
            const overlapX = Math.min(ba.rx - bb.lx, bb.rx - ba.lx);
            const overlapY = Math.min(ba.by - bb.ty, bb.by - ba.ty);
            if (overlapY <= overlapX) {
              const push = overlapY / 2 + 1;
              if (b.y >= a.y) { a.y -= push; b.y += push; }
              else             { a.y += push; b.y -= push; }
            } else {
              const push = overlapX / 2 + 1;
              if (b.x >= a.x) { a.x -= push; b.x += push; }
              else             { a.x += push; b.x -= push; }
            }
            moved = true;
          }
        }
      }
      for (let i = 0; i < labelPos.length; i++) {
        const lp = labelPos[i];
        const visNodes = nodesData.filter((n) => !activeFilter || activeFilter.has(n.category));
        for (const node of visNodes) {
          const disp = node.title.length > 28 ? node.title.slice(0, 26) + '…' : node.title;
          const nw = disp.length * 6.5;
          const nlx = node.x + 10, nrx = node.x + 10 + nw;
          const nty = node.y - 8,  nby = node.y + 4;
          const ba = lbbox(lp);
          if (ba.rx > nlx && ba.lx < nrx && ba.by > nty && ba.ty < nby) {
            const ox = Math.min(ba.rx - nlx, nrx - ba.lx);
            const oy = Math.min(ba.by - nty, nby - ba.ty);
            if (oy <= ox) {
              if (lp.y < node.y) lp.y -= oy + 2;
              else               lp.y += oy + 2;
            } else {
              if (lp.x < node.x) lp.x -= ox + 2;
              else               lp.x += ox + 2;
            }
            moved = true;
          }
        }
      }
      if (!moved) break;
    }

    gLabels.selectAll('.cluster-label').data(labelPos, (d) => d.cat).join('text')
      .attr('class', 'cluster-label')
      .attr('fill', (d) => catColor(d.cat))
      .attr('x', (d) => d.x)
      .attr('y', (d) => d.y)
      .attr('text-anchor', (d) => d.anchor)
      .text((d) => d.cat);
  }

  function applyFilter(filter) {
    activeFilter = filter;
    if (!built) return;
    const svg = d3.select('#graph-svg');
    svg.selectAll('.node').style('opacity', (d) =>
      !filter || filter.has(d.category) ? 1 : 0.08);
    svg.selectAll('.node text').style('opacity', (d) =>
      (!filter || filter.has(d.category)) && d.r > 9 ? 1 : 0);
    svg.selectAll('.link')
      .style('stroke-opacity', (d) => {
        const srcCat = d.source.category;
        const tgtCat = d.target.category;
        return !filter || (filter.has(srcCat) && filter.has(tgtCat)) ? 0.4 : 0.04;
      })
      .style('stroke-width', 1.2);
    const categories = [...new Set(nodesData.map((n) => n.category))];
    updateHulls(categories, gMain.select('.hulls'), gMain.select('.cluster-labels'));
  }

  return {
    get built() { return built; },
    init(pages) { if (!built) build(pages); },
    rebuild(pages) { built = false; if (simulation) simulation.stop(); build(pages); },
    applyFilter,
    setPosKey(key) { posKey = key; },
    clear() {
      built = false;
      if (simulation) simulation.stop();
      d3.select('#graph-svg').selectAll('*').remove();
      $('graph-empty').classList.remove('hidden');
    },
  };
})();

// ─── Theme ────────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : '';
  $('btn-theme').textContent = theme === 'light' ? '☾' : '☀';
}

$('btn-theme').addEventListener('click', async () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  await send('SET_SETTINGS', { settings: { theme: next } });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

(async () => {
  const { settings } = await send('GET_SETTINGS');
  applyTheme(settings.theme ?? 'dark');
  await Promise.all([loadPages(), loadReadingList(), loadSiteSelector()]);
  
  const hash = window.location.hash.slice(1);
  const tabBtn = document.querySelector(`.tab[data-tab="${hash}"]`);
  
  if (tabBtn) {
    tabBtn.click();
  } else {
    renderStats();
    renderCategoryFilter();
    renderList();
    graphView.applyFilter(activeCategories);
  }
})();
