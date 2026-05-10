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

  function mkTag(labelText, valueText, closeTitle, onClose) {
    const tag = document.createElement('div');
    tag.className = 'filter-tag';
    const lbl = document.createElement('span');
    lbl.className = 'filter-tag-label';
    lbl.textContent = labelText;
    const btn = document.createElement('button');
    btn.className = 'filter-tag-close';
    btn.title = closeTitle;
    btn.textContent = '×';
    btn.onclick = onClose;
    tag.append(lbl, ` ${valueText} `, btn);
    return tag;
  }

  if (hasSearch)
    container.appendChild(mkTag('Search:', `"${rlSearchQuery}"`, 'Clear search', () => {
      rlSearchQuery = ''; $('rl-search-input').value = ''; renderReadingList();
    }));

  if (hasCat)
    container.appendChild(mkTag('Category:', rlActiveCategory, 'Clear category', () => {
      rlActiveCategory = null; renderRLCategoryFilter(); renderReadingList();
    }));

  if (hasDomain)
    container.appendChild(mkTag('Site:', rlActiveDomain, 'Clear site', () => {
      rlActiveDomain = null; renderRLDomainFilter(); renderReadingList();
    }));

  if (hasSort) {
    let sortName = '';
    switch (rlSortKey) {
      case 'date-asc': sortName = 'Date ↑'; break;
      case 'title': sortName = 'Title A-Z'; break;
      case 'domain': sortName = 'Domain'; break;
      case 'category': sortName = 'Category'; break;
    }
    container.appendChild(mkTag('Sort:', sortName, 'Reset sort', () => {
      rlSortKey = 'date-desc';
      document.querySelectorAll('.rl-sort-btn').forEach(b => b.classList.toggle('active', b.dataset.sort === 'date-desc'));
      renderReadingList();
    }));
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
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const p = document.createElement('p');
    p.textContent = allReadingList.length === 0 ? 'Your reading list is empty.' : 'No results match your filter.';
    const small = document.createElement('small');
    small.textContent = allReadingList.length === 0 ? 'Use "Save for later" in the popup to add pages.' : 'Try adjusting your search or category filter.';
    empty.append(p, small);
    container.replaceChildren(empty);
    return;
  }

  const table = document.createElement('table');
  const thead = table.createTHead();
  const hrow = thead.insertRow();
  for (const th of ['Title', 'Saved', 'Domain', 'Category', '']) {
    const cell = document.createElement('th');
    cell.textContent = th;
    hrow.appendChild(cell);
  }
  const tbody = table.createTBody();

  for (const r of items) {
    const cat = r.userCategory || 'General';
    const color = catColor(cat);
    const bg = color.replace('hsl(', 'hsla(').replace(')', ',0.15)');
    const dom = getDomain(r.url);
    const tr = tbody.insertRow();
    tr.dataset.rlId = r.id;

    const tdTitle = tr.insertCell(); tdTitle.className = 'col-title';
    const a = document.createElement('a'); a.href = r.url; a.target = '_blank'; a.textContent = r.title;
    tdTitle.appendChild(a);

    const tdDate = tr.insertCell(); tdDate.className = 'col-date';
    tdDate.textContent = formatDate(r.savedAt);

    const tdDom = tr.insertCell(); tdDom.className = 'col-domain';
    const domSpan = document.createElement('span');
    domSpan.style.cssText = 'font-size:11px;color:var(--text3);';
    domSpan.textContent = dom;
    tdDom.appendChild(domSpan);

    const tdCat = tr.insertCell(); tdCat.className = 'col-cat';
    const pill = document.createElement('span'); pill.className = 'cat-pill';
    pill.style.color = color; pill.style.background = bg; pill.textContent = cat;
    tdCat.appendChild(pill);

    const tdAct = tr.insertCell(); tdAct.className = 'col-actions';
    const readBtn = document.createElement('button');
    readBtn.className = 'rl-mark-read'; readBtn.title = 'Mark as read'; readBtn.textContent = '✓ Read';
    readBtn.addEventListener('click', async () => {
      await send('MARK_AS_READ', { id: r.id });
      allReadingList = allReadingList.filter((x) => x.id !== r.id);
      await loadPages(); renderStats(); renderReadingList();
    });
    const delBtn = document.createElement('button');
    delBtn.className = 'rl-remove'; delBtn.title = 'Remove'; delBtn.textContent = '×';
    delBtn.addEventListener('click', async () => {
      await send('REMOVE_FROM_READING_LIST', { id: r.id });
      allReadingList = allReadingList.filter((x) => x.id !== r.id);
      renderRLCategoryFilter(); renderRLDomainFilter(); renderReadingList();
    });
    tdAct.append(readBtn, delBtn);
  }

  container.replaceChildren(table);
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
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const p = document.createElement('p');
    p.textContent = allPages.length === 0 ? 'No pages saved yet.' : 'No results match your filter.';
    const small = document.createElement('small');
    small.textContent = allPages.length === 0 ? 'Browse some pages — they appear here automatically.' : 'Try adjusting your search or category filters.';
    empty.append(p, small);
    container.replaceChildren(empty);
    return;
  }

  const table = document.createElement('table');
  const thead = table.createTHead();
  const hrow = thead.insertRow();
  for (const th of ['Title', 'Date added', 'Category', '']) {
    const cell = document.createElement('th');
    cell.textContent = th;
    hrow.appendChild(cell);
  }
  const tbody = table.createTBody();

  for (const p of pages) {
    const cat = p.userCategory || p.primaryCategory || 'Uncategorized';
    const color = catColor(cat);
    const bg = color.replace('hsl(', 'hsla(').replace(')', ',0.15)');
    const tr = tbody.insertRow();
    tr.dataset.id = p.id;

    const tdTitle = tr.insertCell(); tdTitle.className = 'col-title';
    const a = document.createElement('a'); a.href = p.url; a.target = '_blank'; a.textContent = p.title;
    tdTitle.appendChild(a);

    const tdDate = tr.insertCell(); tdDate.className = 'col-date';
    tdDate.textContent = formatDate(p.timestamp);

    const tdCat = tr.insertCell(); tdCat.className = 'col-cat';
    const pill = document.createElement('span'); pill.className = 'cat-pill';
    pill.style.color = color; pill.style.background = bg; pill.textContent = cat;
    tdCat.appendChild(pill);

    const tdDel = tr.insertCell(); tdDel.className = 'col-del';
    const delBtn = document.createElement('button');
    delBtn.title = 'Remove'; delBtn.textContent = '×';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = p.id;
      if (currentSite === 'wikipedia') {
        await send('DELETE_PAGE', { id });
      } else {
        await send('DELETE_CSITE_PAGE', { domain: currentSite, id });
      }
      allPages = allPages.filter((page) => page.id !== id);
      renderStats(); renderCategoryFilter(); renderList();
      if (graphView.built) graphView.rebuild(allPages);
    });
    tdDel.appendChild(delBtn);
  }

  container.replaceChildren(table);
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
    $('btn-export-svg').classList.add('hidden');
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

  const info = document.createElement('div');
  info.className = 'site-card-info';

  const domainDiv = document.createElement('div');
  domainDiv.className = 'site-card-domain';
  domainDiv.textContent = site.domain;
  if (isBuiltin) {
    const builtinSpan = document.createElement('span');
    builtinSpan.className = 'site-card-builtin';
    builtinSpan.textContent = 'built-in';
    domainDiv.append(' ', builtinSpan);
  }

  const nameDiv = document.createElement('div');
  nameDiv.className = 'site-card-name';
  nameDiv.textContent = site.name || site.domain;

  const statsDiv = document.createElement('div');
  statsDiv.className = 'site-card-stats';
  statsDiv.textContent = `${count} page${count !== 1 ? 's' : ''} saved`;

  info.append(domainDiv, nameDiv, statsDiv);

  const actions = document.createElement('div');
  actions.className = 'site-card-actions';

  const viewBtn = document.createElement('button');
  viewBtn.className = 'btn-goto-site';
  viewBtn.title = "View this site's pages";
  viewBtn.textContent = 'View →';
  viewBtn.addEventListener('click', () => {
    const val = isBuiltin ? 'wikipedia' : site.domain;
    $('site-selector').value = val;
    $('site-selector').dispatchEvent(new Event('change'));
    document.querySelector('.tab[data-tab="list"]').click();
  });
  actions.appendChild(viewBtn);

  if (!isBuiltin) {
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn-danger-text';
    removeBtn.title = 'Remove site and delete all data';
    removeBtn.textContent = 'Remove';
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
    actions.appendChild(removeBtn);
  }

  card.append(info, actions);
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
  $('add-msg').style.color = 'var(--text2)';
  $('add-msg').textContent = `Processing ${entries.length} URL(s)…`;
  const resp = await send('ADD_URLS', { entries });
  $('btn-add-urls').disabled = false;

  if (resp?.ok) {
    $('add-urls-input').value = '';
    $('add-msg').style.color = 'var(--success)';
    $('add-msg').textContent = `Added ${resp.added} new page(s).`;
    setTimeout(() => { $('add-msg').textContent = ''; }, 4000);
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

$('btn-export-png').addEventListener('click', () => exportGraph());

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

function exportGraph() {
  const canvasEl = document.getElementById('graph-canvas');
  if (!canvasEl || !graphView.built) { showIOToast('Build the graph first by switching to the Graph tab.', 'error'); return; }

  // Composite the graph onto an opaque background before exporting
  const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--bg0').trim();
  const out = document.createElement('canvas');
  out.width  = canvasEl.width;
  out.height = canvasEl.height;
  const octx = out.getContext('2d');
  octx.fillStyle = bgColor;
  octx.fillRect(0, 0, out.width, out.height);
  octx.drawImage(canvasEl, 0, 0);

  const stamp = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.download = `wikitrace-graph-${stamp}.png`;
  a.href = out.toDataURL('image/png');
  a.click();
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

  let built           = false;
  let simulation      = null;
  let canvas          = null;
  let ctx             = null;
  let currentTransform = d3.zoomIdentity;
  let zoomBehavior    = null;
  let nodesData       = [];
  let linksData       = [];
  let activeFilter    = null;
  let posKey          = 'wt-positions';
  let nodeLimit       = 100;
  let lastInputPages  = [];
  let sliderDebounce  = null;
  let hoveredNode     = null;
  let dragNode        = null;
  let isDragging      = false;
  let adjacentSet     = new Set();
  let animFrameId     = null;
  let needsDraw       = false;
  let abortController = null;
  let linkFilter      = 'both';

  // ── Data helpers ──────────────────────────────────────────────────────────────

  function buildEdges(pages) {
    const byId = new Map(pages.map((p) => [p.id, p]));
    const edges = [], seen = new Set();
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
      if (!seen.has(key)) { seen.add(key); edges.push({ source: unlinked[i - 1].id, target: unlinked[i].id, type: 'chrono' }); }
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

  function isConnected(a, b) { return a === b || adjacentSet.has(`${a},${b}`); }

  // ── Canvas utilities ──────────────────────────────────────────────────────────

  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function findNodeAt(gx, gy) {
    for (let i = nodesData.length - 1; i >= 0; i--) {
      const n = nodesData[i];
      const dx = n.x - gx, dy = n.y - gy;
      if (dx * dx + dy * dy <= (n.r + 4) * (n.r + 4)) return n;
    }
    return null;
  }

  function requestDraw() {
    needsDraw = true;
    if (!animFrameId) {
      animFrameId = requestAnimationFrame(() => {
        animFrameId = null;
        if (needsDraw) { needsDraw = false; draw(); }
      });
    }
  }

  // Draws a convex hull expanded outward by `padding` pixels on a 2D context.
  function drawHullShape(c, points, padding) {
    if (points.length === 0) return false;
    if (points.length <= 2) {
      const cx = (points[0][0] + (points[1] ? points[1][0] : points[0][0])) / 2;
      const cy = (points[0][1] + (points[1] ? points[1][1] : points[0][1])) / 2;
      let r = padding + 12;
      for (const [x, y] of points) {
        const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
        if (d + padding + 12 > r) r = d + padding + 12;
      }
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2);
      return true;
    }
    const hull = d3.polygonHull(points);
    if (!hull) return false;
    const hcx = hull.reduce((s, p) => s + p[0], 0) / hull.length;
    const hcy = hull.reduce((s, p) => s + p[1], 0) / hull.length;
    const exp = hull.map(([x, y]) => {
      const len = Math.sqrt((x - hcx) ** 2 + (y - hcy) ** 2) || 1;
      return [x + ((x - hcx) / len) * padding, y + ((y - hcy) / len) * padding];
    });
    c.beginPath();
    c.moveTo(exp[0][0], exp[0][1]);
    for (let i = 1; i < exp.length; i++) c.lineTo(exp[i][0], exp[i][1]);
    c.closePath();
    return true;
  }

  // ── Draw layers ───────────────────────────────────────────────────────────────

  function draw() {
    if (!ctx || !canvas) return;
    if (!canvas.clientWidth || !canvas.clientHeight) return;
    const W = canvas.clientWidth || 900;
    const H = canvas.clientHeight || 600;
    const dpr = window.devicePixelRatio || 1;
    // Resize canvas physical pixels if the CSS size changed (e.g. panel revealed)
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width  = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
    }
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(currentTransform.x, currentTransform.y);
    ctx.scale(currentTransform.k, currentTransform.k);
    _drawHulls();
    _drawLinks();
    _drawNodes();
    _drawHullLabels();
    ctx.restore();
  }

  function _drawHulls() {
    const vis = activeFilter;
    const byCategory = {};
    for (const n of nodesData) {
      if (vis && !vis.has(n.category)) continue;
      (byCategory[n.category] || (byCategory[n.category] = [])).push([n.x, n.y]);
    }
    for (const [cat, pts] of Object.entries(byCategory)) {
      const color = catColor(cat);
      if (!drawHullShape(ctx, pts, 22)) continue;
      ctx.fillStyle = color; ctx.globalAlpha = 0.09; ctx.fill();
      ctx.strokeStyle = color; ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.setLineDash([]);
  }

  function _drawLinks() {
    const edgeColor = cssVar('--text2');
    for (const l of linksData) {
      if (linkFilter !== 'both' && l.type !== linkFilter) continue;
      // Skip links not yet resolved by the force simulation
      if (!l.source || !l.target || l.source.x == null) continue;
      let opacity = 0.4, sw = 1.2;
      if (hoveredNode) {
        const hi = l.source.id === hoveredNode.id || l.target.id === hoveredNode.id;
        opacity = hi ? 0.85 : 0.04; sw = hi ? 2 : 1.2;
      } else if (activeFilter) {
        const ok = activeFilter.has(l.source.category) && activeFilter.has(l.target.category);
        opacity = ok ? 0.4 : 0.04;
      }
      ctx.globalAlpha = opacity;
      ctx.strokeStyle = edgeColor;
      ctx.lineWidth   = sw;
      ctx.setLineDash(l.type === 'chrono' ? [4, 3] : []);
      ctx.beginPath();
      ctx.moveTo(l.source.x, l.source.y);
      ctx.lineTo(l.target.x, l.target.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.setLineDash([]);
  }

  function _drawNodes() {
    const textColor = cssVar('--text');
    const bgColor   = cssVar('--bg0');
    for (const n of nodesData) {
      const filtered  = activeFilter && !activeFilter.has(n.category);
      const isHovered = hoveredNode && n.id === hoveredNode.id;
      const conn      = hoveredNode ? isConnected(hoveredNode.id, n.id) : false;
      let nodeOpacity = 1;
      if (hoveredNode)  nodeOpacity = conn ? 1 : 0.08;
      else if (filtered) nodeOpacity = 0.08;
      ctx.globalAlpha = nodeOpacity;
      const r     = isHovered ? Math.max(n.r, 12) : n.r;
      const color = catColor(n.category);
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = color.replace('58%)', '78%)');
      ctx.lineWidth = isHovered ? 2 : 1.5; ctx.stroke();
      // Label: visible for large nodes normally, or for all connected nodes on hover
      const showLabel = hoveredNode ? conn : (!filtered && n.r > 9);
      if (showLabel) {
        const label = n.title.length > 28 ? n.title.slice(0, 26) + '…' : n.title;
        ctx.font = '10px sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        ctx.shadowColor = bgColor; ctx.shadowBlur = 3;
        ctx.fillStyle = textColor;
        ctx.fillText(label, n.x + r + 3, n.y);
        ctx.shadowBlur = 0;
      }
    }
    ctx.globalAlpha = 1;
  }

  function _drawHullLabels() {
    const vis = activeFilter;
    const cats = [...new Set(nodesData.map((n) => n.category))];
    const hullData = [];
    for (const cat of cats) {
      const catNodes = nodesData.filter((n) => n.category === cat && (!vis || vis.has(n.category)));
      if (catNodes.length) hullData.push({ cat, nodes: catNodes });
    }
    if (!hullData.length) return;

    const LABEL_H = 14, HULL_PAD = 22, LABEL_MARGIN = 16;
    const labelPos = hullData.map((d) => {
      const cx = d.nodes.reduce((s, n) => s + n.x, 0) / d.nodes.length;
      const cy = d.nodes.reduce((s, n) => s + n.y, 0) / d.nodes.length;
      return {
        cat: d.cat, cx, cy,
        hMinX: Math.min(...d.nodes.map((n) => n.x)) - HULL_PAD,
        hMaxX: Math.max(...d.nodes.map((n) => n.x)) + HULL_PAD,
        hMinY: Math.min(...d.nodes.map((n) => n.y)) - HULL_PAD,
        hMaxY: Math.max(...d.nodes.map((n) => n.y)) + HULL_PAD,
        x: 0, y: 0, anchor: 'center',
      };
    });

    const gcx = labelPos.reduce((s, lp) => s + lp.cx, 0) / labelPos.length;
    const gcy = labelPos.reduce((s, lp) => s + lp.cy, 0) / labelPos.length;
    for (const lp of labelPos) {
      let dx = lp.cx - gcx, dy = lp.cy - gcy;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1) { dx = 0; dy = -1; } else { dx /= len; dy /= len; }
      if (Math.abs(dy) >= Math.abs(dx)) {
        lp.anchor = 'center'; lp.x = lp.cx;
        lp.y = dy <= 0 ? lp.hMinY - LABEL_MARGIN : lp.hMaxY + LABEL_MARGIN;
      } else {
        lp.y = lp.cy;
        if (dx < 0) { lp.anchor = 'right'; lp.x = lp.hMinX - LABEL_MARGIN; }
        else        { lp.anchor = 'left';  lp.x = lp.hMaxX + LABEL_MARGIN; }
      }
    }

    const lbbox = (lp) => {
      const hw = lp.cat.length * 3.5;
      const lx = lp.anchor === 'left'  ? lp.x         : lp.anchor === 'right' ? lp.x - hw * 2 : lp.x - hw;
      const rx = lp.anchor === 'left'  ? lp.x + hw * 2 : lp.anchor === 'right' ? lp.x         : lp.x + hw;
      return { lx, rx, ty: lp.y - LABEL_H, by: lp.y + 4 };
    };

    // Collision avoidance between labels and between labels and node text
    for (let iter = 0; iter < 30; iter++) {
      let moved = false;
      for (let i = 0; i < labelPos.length; i++) {
        for (let j = i + 1; j < labelPos.length; j++) {
          const a = labelPos[i], b = labelPos[j];
          const ba = lbbox(a), bb = lbbox(b);
          if (ba.rx > bb.lx && ba.lx < bb.rx && ba.by > bb.ty && ba.ty < bb.by) {
            const ox = Math.min(ba.rx - bb.lx, bb.rx - ba.lx);
            const oy = Math.min(ba.by - bb.ty, bb.by - ba.ty);
            if (oy <= ox) {
              const push = oy / 2 + 1;
              if (b.y >= a.y) { a.y -= push; b.y += push; } else { a.y += push; b.y -= push; }
            } else {
              const push = ox / 2 + 1;
              if (b.x >= a.x) { a.x -= push; b.x += push; } else { a.x += push; b.x -= push; }
            }
            moved = true;
          }
        }
      }
      const visNodes = nodesData.filter((n) => !activeFilter || activeFilter.has(n.category));
      for (const lp of labelPos) {
        for (const node of visNodes) {
          const disp = node.title.length > 28 ? node.title.slice(0, 26) + '…' : node.title;
          const nw = disp.length * 6.5;
          const nlx = node.x + 10, nrx = node.x + 10 + nw;
          const nty = node.y - 8, nby = node.y + 4;
          const ba = lbbox(lp);
          if (ba.rx > nlx && ba.lx < nrx && ba.by > nty && ba.ty < nby) {
            const ox = Math.min(ba.rx - nlx, nrx - ba.lx);
            const oy = Math.min(ba.by - nty, nby - ba.ty);
            if (oy <= ox) { if (lp.y < node.y) lp.y -= oy + 2; else lp.y += oy + 2; }
            else          { if (lp.x < node.x) lp.x -= ox + 2; else lp.x += ox + 2; }
            moved = true;
          }
        }
      }
      if (!moved) break;
    }

    ctx.font = 'bold 10px sans-serif';
    for (const lp of labelPos) {
      ctx.textAlign    = lp.anchor;
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle    = catColor(lp.cat);
      ctx.globalAlpha  = 0.6;
      ctx.fillText(lp.cat.toUpperCase(), lp.x, lp.y);
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
  }

  // ── Build ─────────────────────────────────────────────────────────────────────

  function build(inputPages) {
    built = true;
    canvas = $('graph-canvas');
    if (!canvas) return;

    // Tear down previous instance
    if (animFrameId)     { cancelAnimationFrame(animFrameId); animFrameId = null; }
    if (simulation)      { simulation.stop(); simulation = null; }
    if (abortController) { abortController.abort(); }
    abortController = new AbortController();
    const { signal } = abortController;

    // Size canvas to physical pixels
    const dpr = window.devicePixelRatio || 1;
    const W   = canvas.clientWidth  || 900;
    const H   = canvas.clientHeight || 600;
    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    if (inputPages.length === 0) { $('graph-empty').classList.remove('hidden'); return; }
    $('graph-empty').classList.add('hidden');

    const MIN_SLIDER    = 10;
    const sliderBar     = $('graph-slider-bar');
    const slider        = $('graph-node-slider');
    const sliderValEl   = $('graph-slider-val');
    const sliderTotalEl = $('graph-slider-total');
    lastInputPages = inputPages;

    if (inputPages.length > MIN_SLIDER) {
      nodeLimit = Math.min(Math.max(nodeLimit, MIN_SLIDER), inputPages.length);
      slider.min = MIN_SLIDER; slider.max = inputPages.length;
      slider.value = nodeLimit;
      sliderValEl.textContent   = nodeLimit;
      sliderTotalEl.textContent = `/ ${inputPages.length}`;
      sliderBar.classList.remove('hidden');
    } else {
      sliderBar.classList.add('hidden');
    }

    let pages = (nodeLimit < inputPages.length)
      ? [...inputPages].sort((a, b) => b.timestamp - a.timestamp).slice(0, nodeLimit)
      : inputPages;

    const cachedPos = JSON.parse(localStorage.getItem(posKey) || '{}');
    linksData = buildEdges(pages);

    const degree = {};
    for (const p of pages) degree[p.id] = 0;
    for (const e of linksData) { degree[e.source]++; degree[e.target]++; }

    // Build adjacency set from raw string IDs (before D3 resolves them to objects)
    adjacentSet = new Set();
    for (const e of linksData) {
      adjacentSet.add(`${e.source},${e.target}`);
      adjacentSet.add(`${e.target},${e.source}`);
    }

    const uniqueCats  = [...new Set(pages.map((p) => p.userCategory || p.primaryCategory || 'Uncategorized'))];
    const catAngles   = {};
    uniqueCats.forEach((c, i) => { catAngles[c] = (i / uniqueCats.length) * 2 * Math.PI; });
    const spawnRadius = Math.min(W, H) * 0.35;

    nodesData = pages.map((p) => {
      const cat   = p.userCategory || p.primaryCategory || 'Uncategorized';
      const angle = catAngles[cat] || 0;
      return {
        id: p.id, title: p.title, url: p.url, category: cat, timestamp: p.timestamp,
        r: Math.min(20, Math.max(7, 5 + Math.sqrt(degree[p.id] || 0) * 1.5)),
        x: cachedPos[p.id]?.x ?? (W / 2 + Math.cos(angle) * spawnRadius + (Math.random() - 0.5) * 80),
        y: cachedPos[p.id]?.y ?? (H / 2 + Math.sin(angle) * spawnRadius + (Math.random() - 0.5) * 80),
      };
    });

    const allNewNodes = nodesData.some((n) => !cachedPos[n.id]);
    hoveredNode = null; dragNode = null; isDragging = false;

    // ── Tooltip ──────────────────────────────────────────────────────────────────
    let tooltip = document.querySelector('.graph-tooltip');
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.className = 'graph-tooltip hidden';
      tooltip.innerHTML = '<div class="tt-title"></div><div class="tt-date"></div>';
      document.body.appendChild(tooltip);
    }

    // ── Mouse handlers — registered BEFORE zoom so stopImmediatePropagation ──────
    // prevents D3 zoom from capturing mousedown on a node.
    let wasDragging = false;
    const mousedown = (e) => {
      if (e.button !== 0) return;
      const [mx, my] = d3.pointer(e);
      const [gx, gy] = currentTransform.invert([mx, my]);
      const node = findNodeAt(gx, gy);
      if (node) {
        e.stopImmediatePropagation();
        dragNode = node; isDragging = false;
        node.fx = node.x; node.fy = node.y;
        simulation.alphaTarget(0.1).restart();
        canvas.style.cursor = 'grabbing';
      }
    };

    const mousemove = (e) => {
      const [mx, my] = d3.pointer(e);
      if (dragNode) {
        isDragging = true;
        const [gx, gy] = currentTransform.invert([mx, my]);
        dragNode.fx = gx; dragNode.fy = gy;
        requestDraw(); return;
      }
      const [gx, gy] = currentTransform.invert([mx, my]);
      const node = findNodeAt(gx, gy);
      if (node !== hoveredNode) {
        hoveredNode = node;
        canvas.style.cursor = node ? 'pointer' : 'default';
        if (node) {
          tooltip.querySelector('.tt-title').textContent = node.title;
          tooltip.querySelector('.tt-date').textContent  = formatDate(node.timestamp);
          tooltip.classList.remove('hidden');
        } else {
          tooltip.classList.add('hidden');
        }
        requestDraw();
      }
      if (node) {
        tooltip.style.left = (e.clientX + 14) + 'px';
        tooltip.style.top  = (e.clientY - 8)  + 'px';
      }
    };

    const mouseup = () => {
      if (dragNode) {
        if (isDragging) wasDragging = true;
        dragNode.fx = null; dragNode.fy = null;
        simulation.alphaTarget(0);
        dragNode = null; isDragging = false;
        canvas.style.cursor = hoveredNode ? 'pointer' : 'default';
      }
    };

    const click = (e) => {
      if (wasDragging) { wasDragging = false; return; }
      const [mx, my] = d3.pointer(e);
      const [gx, gy] = currentTransform.invert([mx, my]);
      const node = findNodeAt(gx, gy);
      if (node) chrome.tabs.create({ url: node.url });
    };

    const mouseleave = () => {
      if (hoveredNode) { hoveredNode = null; tooltip.classList.add('hidden'); canvas.style.cursor = 'default'; requestDraw(); }
      if (dragNode)    { dragNode.fx = null; dragNode.fy = null; simulation.alphaTarget(0); dragNode = null; isDragging = false; }
    };

    canvas.addEventListener('mousedown',  mousedown,  { signal });
    canvas.addEventListener('mousemove',  mousemove,  { signal });
    canvas.addEventListener('mouseleave', mouseleave, { signal });
    canvas.addEventListener('click',      click,      { signal });
    window.addEventListener('mouseup',    mouseup,    { signal });
    window.addEventListener('resize',     requestDraw, { signal });

    // ── Zoom — applied AFTER manual handlers ─────────────────────────────────────
    currentTransform = d3.zoomIdentity;
    zoomBehavior = d3.zoom().scaleExtent([0.05, 8]).on('zoom', (e) => {
      currentTransform = e.transform; requestDraw();
    });
    d3.select(canvas).on('.zoom', null).call(zoomBehavior);

    d3.select('#btn-zoom-in').on('click',    () => d3.select(canvas).transition().duration(300).call(zoomBehavior.scaleBy, 1.3));
    d3.select('#btn-zoom-out').on('click',   () => d3.select(canvas).transition().duration(300).call(zoomBehavior.scaleBy, 0.7));
    d3.select('#btn-zoom-reset').on('click', () => d3.select(canvas).transition().duration(300).call(zoomBehavior.transform, d3.zoomIdentity));
    d3.select('#btn-reset-layout').on('click', () => {
      if (confirm('Are you sure you want to reset the graph layout?')) {
        localStorage.removeItem(posKey); graphView.rebuild(lastInputPages);
      }
    });

    // ── Force simulation ──────────────────────────────────────────────────────────
    const isLarge = pages.length > 500;
    simulation = d3.forceSimulation(nodesData)
      .force('link',      d3.forceLink(linksData).id((d) => d.id).distance(70).strength(0.4))
      .force('charge',    d3.forceManyBody().strength(-180).distanceMax(isLarge ? 250 : 400))
      .force('center',    d3.forceCenter(W / 2, H / 2).strength(0.04))
      .force('collision', d3.forceCollide((d) => d.r + 8).strength(0.7))
      .force('cluster',   forceCluster())
      .alphaDecay(isLarge ? 0.08 : 0.04).velocityDecay(0.38);

    if (!allNewNodes) simulation.alpha(0.15);

    simulation.on('tick', requestDraw);

    simulation.on('end', () => {
      const pos = {};
      for (const n of nodesData) pos[n.id] = { x: n.x, y: n.y };
      localStorage.setItem(posKey, JSON.stringify(pos));
    });

    if (activeFilter) applyFilter(activeFilter);
    else requestDraw();
  }

  function applyFilter(filter) {
    activeFilter = filter;
    if (built) requestDraw();
  }

  $('graph-node-slider').addEventListener('input', (e) => {
    nodeLimit = +e.target.value;
    $('graph-slider-val').textContent = nodeLimit;
    clearTimeout(sliderDebounce);
    sliderDebounce = setTimeout(() => { built = false; if (simulation) simulation.stop(); build(lastInputPages); }, 300);
  });

  return {
    get built()    { return built; },
    init(pages)    { if (!built) build(pages); },
    rebuild(pages) { built = false; if (simulation) simulation.stop(); build(pages); },
    applyFilter,
    setLinkFilter(f) { linkFilter = f; if (built) requestDraw(); },
    redraw()       { if (built) requestDraw(); },
    setPosKey(key) { posKey = key; },
    clear() {
      built = false;
      if (simulation)     { simulation.stop(); simulation = null; }
      if (animFrameId)    { cancelAnimationFrame(animFrameId); animFrameId = null; }
      if (abortController){ abortController.abort(); abortController = null; }
      if (ctx && canvas)  { ctx.clearRect(0, 0, canvas.clientWidth || 900, canvas.clientHeight || 600); }
      hoveredNode = null; dragNode = null;
      document.querySelector('.graph-tooltip')?.classList.add('hidden');
      $('graph-empty').classList.remove('hidden');
    },
  };
})();

// ─── Link filter buttons ──────────────────────────────────────────────────────

document.querySelectorAll('.link-filter-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.link-filter-btn').forEach((b) => b.classList.toggle('active', b === btn));
    graphView.setLinkFilter(btn.dataset.filter);
  });
});

// ─── Theme ────────────────────────────────────────────────────────────────────

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : '';
  $('btn-theme').textContent = theme === 'light' ? '☾' : '☀';
}

$('btn-theme').addEventListener('click', async () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  applyTheme(next);
  graphView.redraw();
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
