'use strict';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

function send(type, extra = {}) {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage({ type, ...extra }, resolve)
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

// ─── Data loading ─────────────────────────────────────────────────────────────

async function loadPages() {
  const { pages } = await send('GET_PAGES');
  allPages = pages.sort((a, b) => b.timestamp - a.timestamp);
}

function getCategories() {
  const counts = {};
  for (const p of allPages) {
    const c = p.primaryCategory || 'Uncategorized';
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

// ─── Stats bar ────────────────────────────────────────────────────────────────

function renderStats() {
  const cats = new Set(allPages.map((p) => p.primaryCategory).filter(Boolean));
  $('topbar-stats').textContent =
    `${allPages.length} page${allPages.length !== 1 ? 's' : ''} · ${cats.size} categories`;
}

// ─── List view ────────────────────────────────────────────────────────────────

function filteredPages() {
  const q = searchQuery.toLowerCase();
  return allPages
    .filter((p) => {
      const cat = p.primaryCategory || 'Uncategorized';
      if (activeCategories && !activeCategories.has(cat)) return false;
      if (q && !p.title.toLowerCase().includes(q) && !cat.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => {
      switch (sortKey) {
        case 'date-asc':  return a.timestamp - b.timestamp;
        case 'date-desc': return b.timestamp - a.timestamp;
        case 'title':     return a.title.localeCompare(b.title);
        case 'category':  return (a.primaryCategory || 'zzz').localeCompare(b.primaryCategory || 'zzz');
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
        <small>${allPages.length === 0 ? 'Browse Wikipedia — pages appear here automatically.' : 'Try adjusting your search or category filters.'}</small>
      </div>`;
    return;
  }

  const rows = pages.map((p) => {
    const cat = p.primaryCategory || 'Uncategorized';
    const color = catColor(cat);
    const bg = color.replace('hsl(', 'hsla(').replace(')', ',0.15)');
    return `
      <tr data-id="${p.id}">
        <td class="col-title"><a href="${p.url}" target="_blank">${escHtml(p.title)}</a></td>
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
      await send('DELETE_PAGE', { id });
      allPages = allPages.filter((p) => p.id !== id);
      renderStats();
      renderCategoryFilter();
      renderList();
      if (graphView.built) graphView.rebuild(allPages);
    });
  });
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

// ─── Tab switching ────────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    currentTab = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    $('panel-list').classList.toggle('hidden', currentTab !== 'list');
    $('panel-graph').classList.toggle('hidden', currentTab !== 'graph');
    $('panel-about').classList.toggle('hidden', currentTab !== 'about');
    document.querySelector('.sidebar').classList.toggle('hidden', currentTab === 'about');
    $('list-controls').style.display = currentTab === 'list' ? '' : 'none';
    if (currentTab === 'graph') graphView.init(allPages);
  });
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
    $('add-msg').textContent = `Added ${resp.results.length} page(s).`;
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
  if (!confirm('Delete all saved pages? This cannot be undone.')) return;
  await send('CLEAR_ALL');
  allPages = [];
  activeCategories = null;
  graphView.clear();
  renderStats();
  renderCategoryFilter();
  renderList();
});

// ─── Import / Export ──────────────────────────────────────────────────────────

$('btn-export').addEventListener('click', async () => {
  const { pages } = await send('GET_PAGES');
  const blob = new Blob([JSON.stringify(pages, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `wikitrace-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('btn-import').addEventListener('click', () => $('import-file-input').click());

$('import-file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const nodes = JSON.parse(ev.target.result);
      if (!Array.isArray(nodes)) throw new Error('Expected array');
      const resp = await send('IMPORT_PAGES', { nodes });
      if (resp?.ok) {
        showIOToast(`Imported ${resp.added} new page(s).`);
        await loadPages();
        renderStats();
        renderCategoryFilter();
        renderList();
        if (graphView.built) graphView.rebuild(allPages);
      }
    } catch {
      showIOToast('Import failed: invalid JSON file.', 'error');
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

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
      applyFilter() {}, rebuild() {}, clear() {},
    };
  }

  let built = false;
  let simulation = null;
  let svgRoot = null;
  let gMain = null;
  let nodesData = [];
  let linksData = [];
  let activeFilter = null;

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

    svg.call(d3.zoom().scaleExtent([0.05, 8]).on('zoom', (e) => {
      gMain.attr('transform', e.transform);
    }));

    const cachedPos = JSON.parse(localStorage.getItem('wt-positions') || '{}');
    nodesData = pages.map((p) => ({
      id: p.id, title: p.title, url: p.url,
      category: p.primaryCategory || 'Uncategorized',
      timestamp: p.timestamp,
      x: cachedPos[p.id]?.x ?? W / 2 + (Math.random() - 0.5) * 200,
      y: cachedPos[p.id]?.y ?? H / 2 + (Math.random() - 0.5) * 200,
    }));

    linksData = buildEdges(pages);
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
      .attr('r', 7)
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
      })
      .on('mousemove', (e) => {
        tooltip.style.left = (e.clientX + 14) + 'px';
        tooltip.style.top  = (e.clientY - 8) + 'px';
      })
      .on('mouseleave', () => tooltip.classList.add('hidden'))
      .on('click', (e, d) => { if (!e.defaultPrevented) chrome.tabs.create({ url: d.url }); });

    nodeG.append('text').attr('dx', 10).attr('dy', '.35em')
      .text((d) => d.title.length > 28 ? d.title.slice(0, 26) + '…' : d.title);

    const isLarge = pages.length > 500;
    simulation = d3.forceSimulation(nodesData)
      .force('link', d3.forceLink(linksData).id((d) => d.id).distance(70).strength(0.4))
      .force('charge', d3.forceManyBody().strength(-180).distanceMax(isLarge ? 250 : 400))
      .force('center', d3.forceCenter(W / 2, H / 2).strength(0.04))
      .force('collision', d3.forceCollide(15).strength(0.7))
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
      localStorage.setItem('wt-positions', JSON.stringify(pos));
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

    gLabels.selectAll('.cluster-label').data(hullData, (d) => d.cat).join('text')
      .attr('class', 'cluster-label')
      .attr('fill', (d) => catColor(d.cat))
      .attr('x', (d) => d.nodes.reduce((s, n) => s + n.x, 0) / d.nodes.length)
      .attr('y', (d) => Math.min(...d.nodes.map((n) => n.y)) - 28)
      .attr('text-anchor', 'middle').text((d) => d.cat);
  }

  function applyFilter(filter) {
    activeFilter = filter;
    if (!built) return;
    const svg = d3.select('#graph-svg');
    svg.selectAll('.node').style('opacity', (d) =>
      !filter || filter.has(d.category) ? 1 : 0.08);
    svg.selectAll('.link').style('opacity', (d) => {
      const srcCat = d.source.category;
      const tgtCat = d.target.category;
      return !filter || (filter.has(srcCat) && filter.has(tgtCat)) ? 0.4 : 0.04;
    });
    const categories = [...new Set(nodesData.map((n) => n.category))];
    updateHulls(categories, gMain.select('.hulls'), gMain.select('.cluster-labels'));
  }

  return {
    get built() { return built; },
    init(pages) { if (!built) build(pages); },
    rebuild(pages) { built = false; if (simulation) simulation.stop(); build(pages); },
    applyFilter,
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
  await loadPages();
  renderStats();
  renderCategoryFilter();
  renderList();
  graphView.applyFilter(activeCategories);
})();
