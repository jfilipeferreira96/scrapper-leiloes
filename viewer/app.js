(function () {
  'use strict';

  // ============ DATA ============
  const DATA = window.__PROPERTY_DATA__ || {
    allProperties: [],
    newProperties: [],
    filteredProperties: [],
    locations: [],
    generatedAt: '',
  };

  const NEW_URLS = new Set((DATA.newProperties || []).map((p) => p.url));

  // ============ FILTERS (from filters.js) ============
  const normText = (text) =>
    (text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

  const FILTERS = window.__FILTERS__ || { districts: [], groups: [] };

  // Flatten all locations from groups
  const ALL_LOCATIONS = (FILTERS.groups || []).flatMap((g) => g.locations || []);

  // Load zone selections from localStorage (null = use all as default)
  let zoneSel = { locations: null, districts: null };
  try {
    const saved = JSON.parse(localStorage.getItem('leiloes_zone_sel') || 'null');
    if (saved) zoneSel = saved;
  } catch (e) {
    /* ignore corrupt data */
  }

  const getActiveLocations = () =>
    zoneSel.locations
      ? ALL_LOCATIONS.filter((l) => zoneSel.locations.includes(l))
      : ALL_LOCATIONS.slice();

  const getActiveDistricts = () =>
    zoneSel.districts
      ? (FILTERS.districts || []).filter((d) => zoneSel.districts.includes(d))
      : (FILTERS.districts || []).slice();

  // Pre-computed sets (rebuilt when selections change)
  let LOCS_NORM, LOCS_SET, LOCS_REGEX, ZONE_DISTRICTS;

  const rebuildZoneSets = () => {
    LOCS_NORM = getActiveLocations().map(normText);
    LOCS_SET = new Set(LOCS_NORM);
    LOCS_REGEX = LOCS_NORM.map((l) => new RegExp(`\\b${l.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`));
    ZONE_DISTRICTS = getActiveDistricts().map(normText);
  };
  rebuildZoneSets();

  // ============ STATE ============
  const state = {
    view: 'all',
    search: '',
    source: '',
    district: '',
    status: '',
    priceMin: null,
    priceMax: null,
    sortKey: 'firstSeenAt',
    sortDir: 'desc',
    page: 1,
    pageSize: 25,
    expanded: {},
  };

  // ============ FAVORITES & EXCLUDED (localStorage) ============
  const FAV_SET = new Set();
  const EXCL_SET = new Set();
  try {
    JSON.parse(localStorage.getItem('leiloes_fav') || '[]').forEach((u) => FAV_SET.add(u));
    JSON.parse(localStorage.getItem('leiloes_excl') || '[]').forEach((u) => EXCL_SET.add(u));
  } catch (e) {
    /* ignore corrupt data */
  }

  const saveFav = () => localStorage.setItem('leiloes_fav', JSON.stringify([...FAV_SET]));
  const saveExcl = () => localStorage.setItem('leiloes_excl', JSON.stringify([...EXCL_SET]));

  const toggleFav = (url) => {
    if (FAV_SET.has(url)) FAV_SET.delete(url);
    else FAV_SET.add(url);
    saveFav();
    renderAll();
    refreshDynamicUI();
  };

  const toggleExcl = (url) => {
    if (EXCL_SET.has(url)) EXCL_SET.delete(url);
    else EXCL_SET.add(url);
    saveExcl();
    state.page = 1;
    renderAll();
    refreshDynamicUI();
  };

  // ============ CONSTANTS ============
  const SOURCES = {
    onefix: '#3b82f6',
    bidleiloeira: '#a855f7',
    lcpremium: '#10b981',
    leilosoc: '#f59e0b',
    avaliberica: '#ef4444',
    leilostar: '#06b6d4',
    inlex: '#8b5cf6',
    vleiloes: '#ec4899',
    leiloeiradolena: '#14b8a6',
    solventium: '#f97316',
    exclusivagora: '#6366f1',
    leiloatrium: '#84cc16',
    cparaiso: '#0ea5e9',
    viaserumos: '#d946ef',
    maximovalor: '#dc2626',
    caixaimobiliario: '#7c3aed',
    imoloriente: '#0891b2',
    aleiloeiraforense: '#65a30d',
    leilosil: '#e11d48',
  };

  // ============ UTILITIES ============
  const fmtPrice = (val) => {
    if (val === null || val === undefined || val === 0) return null;
    return new Intl.NumberFormat('pt-PT', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0,
    }).format(val);
  };

  const fmtPriceCell = (val) =>
    fmtPrice(val) || '<span class="text-slate-300 dark:text-slate-700">—</span>';

  const fmtDate = (val) => {
    if (!val) return '—';
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val).slice(0, 10);
    return d.toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const esc = (text) => {
    const d = document.createElement('div');
    d.textContent = text || '';
    return d.innerHTML;
  };

  const badge = (text, color) => {
    if (!text) return '<span class="text-slate-300 dark:text-slate-700 text-xs">—</span>';
    return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap" style="background:${color}1a;color:${color}">${esc(text)}</span>`;
  };

  const srcColor = (s) => SOURCES[s] || '#64748b';

  const statusColor = (s) => {
    const v = (s || '').toLowerCase();
    if (/active|abert|aceita|decorr|ativ|leil|curso|propag|licitar|compre/.test(v)) return '#10b981';
    if (/fech|termin|encerr|cancel|suspen|vend/.test(v)) return '#ef4444';
    if (/brev|eminent|proxim|futur/.test(v)) return '#f59e0b';
    return '#64748b';
  };

  // ============ DATA ACCESS ============
  const zonesFiltered = () => {
    if (!LOCS_NORM.length) return [];
    return (DATA.allProperties || []).filter((p) => {
      // Exclude removed properties so the badge stays in sync
      if (EXCL_SET.has(p.url)) return false;
      const district = normText(p.district || '');
      const parish = normText(p.parish || '');
      const muni = normText(p.municipality || '');

      // 1. District must be in scope (if districts are configured)
      if (district && ZONE_DISTRICTS.length > 0 && !ZONE_DISTRICTS.includes(district)) {
        // Still allow if exact parish/muni match
      }

      // 2. Exact match on parish/municipality (even without district)
      const hasValidDistrict = !district || (ZONE_DISTRICTS.length > 0 && ZONE_DISTRICTS.includes(district));
      const hasExactMatch = (parish && LOCS_SET.has(parish)) || (muni && LOCS_SET.has(muni));

      if (hasExactMatch && hasValidDistrict) return true;

      // 3. Word-boundary match on address field only
      const addr = normText(p.location || '');
      if (addr && LOCS_REGEX.some((re) => re.test(addr)) && hasValidDistrict) return true;

      return false;
    });
  };

  const baseData = () => {
    if (state.view === 'new') return DATA.newProperties || [];
    if (state.view === 'zones') return zonesFiltered();
    if (state.view === 'favorites') {
      return (DATA.allProperties || []).filter((p) => FAV_SET.has(p.url));
    }
    if (state.view === 'excluded') {
      return (DATA.allProperties || []).filter((p) => EXCL_SET.has(p.url));
    }
    return DATA.allProperties || [];
  };

  const filtered = () => {
    let d = baseData();
    // Hide excluded properties in all views except "excluded"
    if (state.view !== 'excluded') {
      d = d.filter((p) => !EXCL_SET.has(p.url));
    }
    if (state.search) {
      const q = state.search.toLowerCase();
      d = d.filter(
        (p) =>
          (p.title || '').toLowerCase().includes(q) ||
          (p.location || '').toLowerCase().includes(q) ||
          (p.district || '').toLowerCase().includes(q) ||
          (p.municipality || '').toLowerCase().includes(q) ||
          (p.parish || '').toLowerCase().includes(q)
      );
    }
    if (state.source) d = d.filter((p) => p.source === state.source);
    if (state.district) d = d.filter((p) => p.district === state.district);
    if (state.status) d = d.filter((p) => p.status === state.status);
    if (state.priceMin !== null) d = d.filter((p) => p.price != null && p.price >= state.priceMin);
    if (state.priceMax !== null) d = d.filter((p) => p.price != null && p.price <= state.priceMax);
    return d;
  };

  const sorted = () => {
    const d = filtered().slice();
    const key = state.sortKey;
    const dir = state.sortDir === 'asc' ? 1 : -1;
    d.sort((a, b) => {
      const va = a[key];
      const vb = b[key];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'string') return va.localeCompare(vb) * dir;
      return (va - vb) * dir;
    });
    return d;
  };

  const paged = () => {
    const d = sorted();
    if (state.pageSize === 0) return d;
    const s = (state.page - 1) * state.pageSize;
    return d.slice(s, s + state.pageSize);
  };

  // ============ RENDER: STATS ============
  const renderStats = () => {
    const d = baseData().filter((p) => state.view === 'excluded' || !EXCL_SET.has(p.url));
    const wp = d.filter((p) => p.price && p.price > 0);
    const prices = wp.map((p) => p.price);
    const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
    const minP = prices.length ? Math.min(...prices) : 0;
    const maxP = prices.length ? Math.max(...prices) : 0;

    const cards = [
      { label: 'Imóveis', val: d.length, sub: `${(DATA.newProperties || []).length} novos`, color: '#3b82f6' },
      { label: 'Preço médio', val: fmtPrice(avg) || '—', sub: `${wp.length} com preço`, color: '#10b981' },
      { label: 'Mais barato', val: fmtPrice(minP) || '—', sub: 'preço mínimo', color: '#f59e0b' },
      { label: 'Mais caro', val: fmtPrice(maxP) || '—', sub: 'preço máximo', color: '#ef4444' },
    ];

    document.getElementById('stats').innerHTML = cards
      .map(
        (c) => `<div class="stat-card bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-4 pl-5" style="--c:${c.color}">
          <p class="text-2xl font-bold tracking-tight" style="color:${c.color}">${typeof c.val === 'number' ? c.val.toLocaleString('pt-PT') : c.val}</p>
          <p class="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">${c.label}</p>
          ${c.sub ? `<p class="text-[11px] text-slate-400 dark:text-slate-600 mt-0.5">${c.sub}</p>` : ''}
        </div>`
      )
      .join('');

    // Apply accent bar color
    document.querySelectorAll('.stat-card').forEach((el) => {
      el.style.setProperty('border-left', `3px solid ${el.style.getPropertyValue('--c')}`);
    });
  };

  // ============ RENDER: TABLE ============
  const renderRow = (p, idx) => {
    const isNew = NEW_URLS.has(p.url);
    const isFav = FAV_SET.has(p.url);
    const isOpen = !!state.expanded[p.url];
    const sc = srcColor(p.source);

    let html = `<tr data-idx="${idx}" class="border-b border-slate-100 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/30 cursor-pointer transition-colors ${isOpen ? 'bg-slate-50 dark:bg-slate-800/30' : ''}">`;

    // Expand arrow
    html += `<td class="px-2 py-3 text-center"><span class="expand-arrow${isOpen ? ' open' : ''}">&#9654;</span></td>`;

    // Imóvel
    html += `<td class="px-3 py-3 min-w-[250px]">
      <div class="flex items-center gap-1.5 flex-wrap">
        ${badge(p.source, sc)}
        ${isNew ? '<span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500 text-white font-bold tracking-wide uppercase">Novo</span>' : ''}
      </div>
      <a href="${esc(p.url)}" target="_blank" rel="noopener" class="block font-medium text-slate-800 dark:text-slate-200 hover:text-blue-600 dark:hover:text-blue-400 hover:underline mt-1 clamp-2">${esc(p.title)}</a>
    </td>`;

    // Morada
    html += `<td class="px-3 py-3 min-w-[160px] max-w-[220px]">${
      p.location
        ? `<span class="text-sm text-slate-600 dark:text-slate-400">${esc(p.location)}</span>`
        : '<span class="text-slate-300 dark:text-slate-700 text-xs">—</span>'
    }</td>`;

    // Preço
    html += '<td class="px-3 py-3 text-right whitespace-nowrap">';
    if (p.price) {
      html += `<span class="font-bold text-emerald-600 dark:text-emerald-400">${fmtPrice(p.price)}</span>`;
    } else {
      html += '<span class="text-slate-400 dark:text-slate-600 italic text-xs">Sob consulta</span>';
    }
    html += '</td>';

    // Abertura / Mínimo / Licitação
    html += `<td class="px-3 py-3 text-right text-slate-600 dark:text-slate-400 whitespace-nowrap">${fmtPriceCell(p.openingValue)}</td>`;
    html += `<td class="px-3 py-3 text-right text-slate-600 dark:text-slate-400 whitespace-nowrap">${fmtPriceCell(p.minSaleValue)}</td>`;
    html += '<td class="px-3 py-3 text-right whitespace-nowrap">';
    if (p.currentBid) {
      html += `<span class="font-semibold text-blue-600 dark:text-blue-400">${fmtPrice(p.currentBid)}</span>`;
    } else {
      html += '<span class="text-slate-300 dark:text-slate-700">—</span>';
    }
    html += '</td>';

    // Área
    html += `<td class="px-3 py-3 text-right text-slate-600 dark:text-slate-400 whitespace-nowrap">${
      p.area ? `${p.area} <span class="text-xs text-slate-400">m²</span>` : '<span class="text-slate-300 dark:text-slate-700">—</span>'
    }</td>`;

    // Estado
    html += `<td class="px-3 py-3">${badge(p.status, statusColor(p.status))}</td>`;

    // Detectado
    html += `<td class="px-3 py-3 text-right text-slate-500 dark:text-slate-400 text-xs whitespace-nowrap">${fmtDate(p.firstSeenAt)}</td>`;

    // Actions (favorite / exclude)
    const favCls = isFav ? 'act-btn fav-active' : 'act-btn';
    html += `<td class="px-2 py-3 text-center whitespace-nowrap">
      <button class="${favCls}" data-fav="${esc(p.url)}" title="Favorito">${isFav ? '\u2605' : '\u2606'}</button>
      <button class="act-btn excl-btn" data-excl="${esc(p.url)}" title="Excluir">\u2715</button>
    </td>`;

    html += '</tr>';
    return html;
  };

  const renderExpanded = (p) => {
    const imgs = (p.images || []).slice(0, 12);
    const moreImgs = (p.images || []).length - 12;
    let gallery = '';
    if (imgs.length > 0) {
      gallery = `<div class="flex gap-2 overflow-x-auto pb-2">${imgs
        .map(
          (img) =>
            `<a href="${esc(img)}" target="_blank" rel="noopener" class="flex-shrink-0"><img src="${esc(img)}" loading="lazy" class="w-24 h-24 object-cover rounded-lg border border-slate-200 dark:border-slate-700 hover:opacity-75 transition-opacity" onerror="this.parentElement.style.display='none'" /></a>`
        )
        .join('')}${
        moreImgs > 0
          ? `<span class="flex-shrink-0 w-24 h-24 flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-sm text-slate-500 font-medium">+${moreImgs}</span>`
          : ''
      }</div>`;
    }

    const locParts = [p.district, p.municipality, p.parish].filter(Boolean);
    const details = [];
    if (locParts.length) details.push(`Localização: ${locParts.join(', ')}`);
    if (p.area) details.push(`Área: ${p.area} m²`);
    if (p.rooms) details.push(`Divisões: ${p.rooms}`);
    if (p.auctionType) details.push(`Tipo: ${p.auctionType}`);
    if (p.publishedAt) details.push(`Publicado: ${fmtDate(p.publishedAt)}`);

    let links = `<a href="${esc(p.url)}" target="_blank" rel="noopener" class="text-blue-600 dark:text-blue-400 hover:underline text-sm font-medium">Ver página original</a>`;
    if (p.latitude && p.longitude) {
      links += `<span class="text-slate-300 dark:text-slate-700">·</span><a href="https://www.google.com/maps?q=${p.latitude},${p.longitude}" target="_blank" rel="noopener" class="text-blue-600 dark:text-blue-400 hover:underline text-sm font-medium">Ver no mapa</a>`;
    }

    return `<tr class="expand-row bg-slate-50 dark:bg-slate-800/30"><td colspan="11" class="px-6 py-4">
      ${gallery}
      ${details.length ? `<div class="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-sm text-slate-600 dark:text-slate-400">${details.map((d) => `<span>${esc(d)}</span>`).join('<span class="text-slate-300 dark:text-slate-700">·</span>')}</div>` : ''}
      <div class="flex items-center gap-3 mt-3">${links}</div>
    </td></tr>`;
  };

  const renderTable = () => {
    const data = paged();
    const total = filtered().length;

    const start = total === 0 ? 0 : state.pageSize === 0 ? 1 : (state.page - 1) * state.pageSize + 1;
    const end = state.pageSize === 0 ? total : Math.min(state.page * state.pageSize, total);
    document.getElementById('resultCount').textContent =
      total === 0 ? '0 imóveis' : `${start}–${end} de ${total} imóveis`;

    const empty = document.getElementById('emptyState');
    const tblSec = document.getElementById('tableSection');
    const pag = document.getElementById('pagination');
    if (total === 0) {
      empty.classList.remove('hidden');
      tblSec.classList.add('hidden');
      pag.classList.add('hidden');
      return;
    }
    empty.classList.add('hidden');
    tblSec.classList.remove('hidden');
    pag.classList.remove('hidden');

    document.getElementById('tableBody').innerHTML = data
      .map((p, i) => renderRow(p, i))
      .join('');

    // Sort indicators
    document.querySelectorAll('[data-sort]').forEach((th) => {
      const key = th.dataset.sort;
      const ind = th.querySelector('.sort-indicator');
      if (key === state.sortKey) {
        ind.textContent = state.sortDir === 'asc' ? '\u25B2' : '\u25BC';
        ind.style.opacity = '1';
      } else {
        ind.textContent = '';
      }
    });
  };

  // ============ RENDER: PAGINATION ============
  const renderPagination = () => {
    const total = filtered().length;
    const ps = state.pageSize;
    const totalPages = ps === 0 ? 1 : Math.ceil(total / ps);
    const cur = state.page;

    const paginationEl = document.getElementById('pagination');

    if (totalPages <= 1) {
      paginationEl.innerHTML =
        '<div></div><div class="text-sm text-slate-400 dark:text-slate-600">Todos os resultados numa página</div>';
      return;
    }

    // Build smart page range: always show first, last, and window around current
    const pages = [];
    const window = 2; // pages on each side of current
    for (let i = 1; i <= totalPages; i++) {
      if (i === 1 || i === totalPages || (i >= cur - window && i <= cur + window)) {
        pages.push(i);
      } else if (pages[pages.length - 1] !== '…') {
        pages.push('…');
      }
    }

    const pageBtn = (pg, label, disabled, active) =>
      `<button class="page-btn${active ? ' active' : ''}" data-page="${pg}"${disabled ? ' disabled' : ''}>${label || pg}</button>`;

    const html = `
      <div class="flex items-center gap-1 flex-wrap">
        ${pageBtn(cur - 1, '&#8249;', cur === 1)}
        ${pages
          .map((pg) =>
            pg === '…'
              ? '<span class="px-1 text-slate-400">…</span>'
              : pageBtn(pg, pg, false, pg === cur)
          )
          .join('')}
        ${pageBtn(cur + 1, '&#8250;', cur === totalPages)}
      </div>
      <div class="flex items-center gap-2">
        <span class="text-sm text-slate-500 dark:text-slate-400">Página ${cur} de ${totalPages}</span>
        <span class="text-slate-300 dark:text-slate-700">|</span>
        <label class="text-sm text-slate-500 dark:text-slate-400">Ir para:</label>
        <input type="number" class="page-jump" min="1" max="${totalPages}" value="${cur}">
      </div>`;

    paginationEl.innerHTML = html;

    // Page button clicks
    paginationEl.querySelectorAll('.page-btn[data-page]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pg = parseInt(btn.dataset.page, 10);
        if (pg >= 1 && pg <= totalPages && pg !== cur) {
          state.page = pg;
          renderAll();
        }
      });
    });

    // Jump-to-page input
    const jumpInput = paginationEl.querySelector('.page-jump');
    if (jumpInput) {
      jumpInput.addEventListener('change', () => {
        const pg = parseInt(jumpInput.value, 10);
        if (pg >= 1 && pg <= totalPages && pg !== cur) {
          state.page = pg;
          renderAll();
        } else {
          jumpInput.value = cur;
        }
      });
    }
  };

  // ============ FILTERS (dynamic) ============
  /**
   * Derive filter dropdown options from the currently visible dataset.
   * Called at init AND after every exclude/favorite toggle so the
   * dropdowns stay in sync with what the user sees.
   */
  const populateFilters = () => {
    // Use base data minus excluded (mirrors what's actually shown in "all" view)
    const visible = (DATA.allProperties || []).filter((p) => !EXCL_SET.has(p.url));

    const unique = (arr, key) => {
      const seen = new Set();
      const result = [];
      arr.forEach((p) => {
        const v = p[key];
        if (v && !seen.has(v)) {
          seen.add(v);
          result.push(v);
        }
      });
      return result.sort((a, b) => a.localeCompare(b));
    };

    const fill = (id, items, allLabel) => {
      const sel = document.getElementById(id);
      const current = sel.value;
      // Preserve selection only if it still exists in the new options
      const stillValid = current === '' || items.includes(current);
      sel.innerHTML =
        `<option value="">${allLabel}</option>` +
        items.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
      sel.value = stillValid ? current : '';
      // If the current selection is no longer valid, clear it from state too
      if (!stillValid) {
        if (id === 'filterSource') state.source = '';
        if (id === 'filterDistrict') state.district = '';
        if (id === 'filterStatus') state.status = '';
      }
    };

    fill('filterSource', unique(visible, 'source'), 'Todas as fontes');
    fill('filterDistrict', unique(visible, 'district'), 'Todos os distritos');
    fill('filterStatus', unique(visible, 'status'), 'Todos os estados');
  };

  const renderAll = () => {
    renderStats();
    renderTable();
    renderPagination();
    renderFilterChips();
  };

  /**
   * Refresh all dynamic UI elements that depend on the property set.
   * Called after toggleFav/toggleExcl to keep everything in sync.
   */
  const refreshDynamicUI = () => {
    populateFilters();
    renderSourceLegend();
    updateBadges();
    updateZonesBadge();
  };

  const updateZonesBadge = () => {
    document.getElementById('zonesBadge').textContent = zonesFiltered().length;
  };

  // ============ ACTIVE FILTER CHIPS ============
  const renderFilterChips = () => {
    const chips = [];
    if (state.search)
      chips.push({ label: `"${state.search}"`, clear: () => { state.search = ''; document.getElementById('search').value = ''; } });
    if (state.source)
      chips.push({ label: state.source, clear: () => { state.source = ''; document.getElementById('filterSource').value = ''; } });
    if (state.district)
      chips.push({ label: state.district, clear: () => { state.district = ''; document.getElementById('filterDistrict').value = ''; } });
    if (state.status)
      chips.push({ label: state.status, clear: () => { state.status = ''; document.getElementById('filterStatus').value = ''; } });
    if (state.priceMin !== null)
      chips.push({
        label: `\u2265 ${fmtPrice(state.priceMin) || `${state.priceMin} €`}`,
        clear: () => { state.priceMin = null; document.getElementById('priceMin').value = ''; clearPricePresets(); },
      });
    if (state.priceMax !== null)
      chips.push({
        label: `\u2264 ${fmtPrice(state.priceMax) || `${state.priceMax} €`}`,
        clear: () => { state.priceMax = null; document.getElementById('priceMax').value = ''; clearPricePresets(); },
      });

    const container = document.getElementById('filterChips');
    if (!chips.length) {
      container.innerHTML = '';
      container.style.minHeight = '0';
      return;
    }
    container.style.minHeight = '1.5rem';
    container.innerHTML = chips
      .map((c, i) => `<span class="filter-chip" data-chip="${i}">${esc(c.label)}<span class="chip-x">&times;</span></span>`)
      .join('');

    container.querySelectorAll('.filter-chip').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.chip, 10);
        chips[idx].clear();
        state.page = 1;
        renderAll();
      });
    });
  };

  // ============ SOURCE LEGEND ============
  const renderSourceLegend = () => {
    const counts = {};
    (DATA.allProperties || []).forEach((p) => {
      if (!EXCL_SET.has(p.url)) {
        counts[p.source] = (counts[p.source] || 0) + 1;
      }
    });
    const html = Object.keys(SOURCES)
      .map((src) => {
        const count = counts[src] || 0;
        if (!count) return '';
        return `<span class="inline-flex items-center"><span class="legend-dot" style="background:${SOURCES[src]}"></span>${esc(src)} <span class="text-slate-400 dark:text-slate-600 ml-0.5">(${count})</span></span>`;
      })
      .join('');
    document.getElementById('sourceLegend').innerHTML = html;
  };

  // ============ PRICE PRESETS ============
  const clearPricePresets = () => {
    document.querySelectorAll('.price-preset').forEach((b) => b.classList.remove('active'));
  };

  const syncPricePresets = () => {
    clearPricePresets();
    document.querySelectorAll('.price-preset').forEach((b) => {
      const pmin = b.dataset.pmin ? Number(b.dataset.pmin) : null;
      const pmax = b.dataset.pmax ? Number(b.dataset.pmax) : null;
      if (state.priceMin === pmin && state.priceMax === pmax) b.classList.add('active');
    });
  };

  const updateBadges = () => {
    document.getElementById('favBadge').textContent = FAV_SET.size;
    document.getElementById('exclBadge').textContent = EXCL_SET.size;
  };

  // ============ ZONE CONFIG MODAL ============
  const openZoneModal = () => {
    renderZoneCheckboxes();
    updateZoneModalSummary();
    document.getElementById('zoneModal').classList.remove('hidden');
  };

  const closeZoneModal = () => {
    document.getElementById('zoneModal').classList.add('hidden');
  };

  const renderZoneCheckboxes = () => {
    const selLocs = getActiveLocations();
    const selDist = getActiveDistricts();
    let html = '';

    // Districts
    html += '<div class="zone-group-card mb-3"><p class="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Distritos</p>';
    html += '<div class="flex flex-wrap gap-1">';
    (FILTERS.districts || []).forEach((d) => {
      const checked = selDist.includes(d) ? 'checked' : '';
      html += `<label class="zone-cb"><input type="checkbox" class="cb-district" value="${esc(d)}" ${checked}> ${esc(d)}</label>`;
    });
    html += '</div></div>';

    // Location groups
    (FILTERS.groups || []).forEach((g) => {
      const checkedCount = g.locations.filter((l) => selLocs.includes(l)).length;
      const allChecked = checkedCount === g.locations.length;
      html += '<div class="zone-group-card mb-3">';
      html += '<div class="flex items-center justify-between mb-2">';
      html += `<p class="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">${esc(g.name)} <span class="text-slate-400 dark:text-slate-600 normal-case font-normal">(${checkedCount}/${g.locations.length})</span></p>`;
      html += `<button class="text-xs text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 hover:underline group-toggle font-medium" data-group="${esc(g.name)}">${allChecked ? 'Desselecionar' : 'Selecionar'} grupo</button>`;
      html += '</div>';
      html += '<div class="flex flex-wrap gap-1">';
      (g.locations || []).forEach((l) => {
        const checked = selLocs.includes(l) ? 'checked' : '';
        html += `<label class="zone-cb"><input type="checkbox" class="cb-location" value="${esc(l)}" ${checked}> ${esc(l)}</label>`;
      });
      html += '</div></div>';
    });

    document.getElementById('zoneModalContent').innerHTML = html;

    // Live update on checkbox change
    document.querySelectorAll('#zoneModalContent input[type=checkbox]').forEach((cb) => {
      cb.addEventListener('change', updateZoneModalSummary);
    });

    // Group toggle buttons
    document.querySelectorAll('.group-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const groupName = btn.dataset.group;
        const group = (FILTERS.groups || []).find((g) => g.name === groupName);
        if (!group) return;
        const cbs = document.querySelectorAll('.cb-location');
        const groupCbs = [];
        group.locations.forEach((l) => {
          cbs.forEach((cb) => {
            if (cb.value === l) groupCbs.push(cb);
          });
        });
        const allChecked = groupCbs.every((cb) => cb.checked);
        groupCbs.forEach((cb) => (cb.checked = !allChecked));
        updateZoneModalSummary();
      });
    });
  };

  const updateZoneModalSummary = () => {
    const totalLocs = document.querySelectorAll('.cb-location').length;
    const checkedLocs = document.querySelectorAll('.cb-location:checked').length;
    const totalDist = document.querySelectorAll('.cb-district').length;
    const checkedDist = document.querySelectorAll('.cb-district:checked').length;
    const parts = [];
    if (totalLocs) parts.push(`${checkedLocs}/${totalLocs} localizações`);
    if (totalDist) parts.push(`${checkedDist}/${totalDist} distritos`);
    document.getElementById('zoneModalSummary').textContent = parts.join(' · ');
  };

  const saveZoneConfig = () => {
    const districts = [];
    document.querySelectorAll('.cb-district:checked').forEach((cb) => districts.push(cb.value));
    const locations = [];
    document.querySelectorAll('.cb-location:checked').forEach((cb) => locations.push(cb.value));
    zoneSel = { locations, districts };
    localStorage.setItem('leiloes_zone_sel', JSON.stringify(zoneSel));
    rebuildZoneSets();
    closeZoneModal();
    updateZonesBadge();
    state.page = 1;
    renderAll();
  };

  // ============ EVENTS ============
  document.getElementById('tableBody').addEventListener('click', (e) => {
    // Favorite button
    const favBtn = e.target.closest('[data-fav]');
    if (favBtn) {
      toggleFav(favBtn.dataset.fav);
      return;
    }
    // Exclude button
    const exclBtn = e.target.closest('[data-excl]');
    if (exclBtn) {
      toggleExcl(exclBtn.dataset.excl);
      return;
    }
    if (e.target.closest('a')) return;
    const row = e.target.closest('tr[data-idx]');
    if (!row) return;
    const idx = parseInt(row.dataset.idx, 10);
    const prop = paged()[idx];
    if (!prop) return;
    state.expanded[prop.url] = !state.expanded[prop.url];
    renderTable();
  });

  document.querySelectorAll('.view-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.view = tab.dataset.view;
      state.page = 1;
      document.querySelectorAll('.view-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      renderAll();
    });
  });

  let searchTimer;
  document.getElementById('search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const val = e.target.value;
    searchTimer = setTimeout(() => {
      state.search = val.trim();
      state.page = 1;
      renderAll();
    }, 200);
  });

  document.getElementById('filterSource').addEventListener('change', (e) => {
    state.source = e.target.value;
    state.page = 1;
    renderAll();
  });
  document.getElementById('filterDistrict').addEventListener('change', (e) => {
    state.district = e.target.value;
    state.page = 1;
    renderAll();
  });
  document.getElementById('filterStatus').addEventListener('change', (e) => {
    state.status = e.target.value;
    state.page = 1;
    renderAll();
  });
  document.getElementById('priceMin').addEventListener('input', (e) => {
    state.priceMin = e.target.value ? Number(e.target.value) : null;
    state.page = 1;
    syncPricePresets();
    renderAll();
  });
  document.getElementById('priceMax').addEventListener('input', (e) => {
    state.priceMax = e.target.value ? Number(e.target.value) : null;
    state.page = 1;
    syncPricePresets();
    renderAll();
  });
  document.querySelectorAll('.price-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pmin = btn.dataset.pmin ? Number(btn.dataset.pmin) : null;
      const pmax = btn.dataset.pmax ? Number(btn.dataset.pmax) : null;
      // Toggle off if already active
      if (state.priceMin === pmin && state.priceMax === pmax) {
        state.priceMin = null;
        state.priceMax = null;
        document.getElementById('priceMin').value = '';
        document.getElementById('priceMax').value = '';
      } else {
        state.priceMin = pmin;
        state.priceMax = pmax;
        document.getElementById('priceMin').value = pmin || '';
        document.getElementById('priceMax').value = pmax || '';
      }
      state.page = 1;
      syncPricePresets();
      renderAll();
    });
  });
  document.getElementById('pageSize').addEventListener('change', (e) => {
    state.pageSize = Number(e.target.value);
    state.page = 1;
    renderAll();
  });

  document.querySelectorAll('[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else {
        state.sortKey = key;
        state.sortDir = 'asc';
      }
      renderTable();
    });
  });

  document.getElementById('clearFilters').addEventListener('click', () => {
    state.search = '';
    state.source = '';
    state.district = '';
    state.status = '';
    state.priceMin = null;
    state.priceMax = null;
    state.page = 1;
    document.getElementById('search').value = '';
    document.getElementById('filterSource').value = '';
    document.getElementById('filterDistrict').value = '';
    document.getElementById('filterStatus').value = '';
    document.getElementById('priceMin').value = '';
    document.getElementById('priceMax').value = '';
    clearPricePresets();
    renderAll();
  });

  document.getElementById('exportCsv').addEventListener('click', () => {
    const data = filtered();
    const headers = [
      'Fonte', 'Título', 'Morada', 'Distrito', 'Concelho', 'Freguesia',
      'Preço', 'Abertura', 'Mínimo', 'Licitação', 'Área', 'Divisões',
      'Estado', 'Tipo', 'URL', 'Detectado',
    ];
    const rows = data.map((p) => [
      p.source, p.title, p.location, p.district, p.municipality, p.parish,
      p.price, p.openingValue, p.minSaleValue, p.currentBid, p.area, p.rooms,
      p.status, p.auctionType, p.url, p.firstSeenAt,
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `leiloes-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  });

  // Dark mode
  const initDark = () => {
    const stored = localStorage.getItem('darkMode');
    const prefers = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = stored === 'true' || (stored === null && prefers);
    document.documentElement.classList.toggle('dark', dark);
  };
  document.getElementById('darkToggle').addEventListener('click', () => {
    const dark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('darkMode', String(dark));
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') {
      e.preventDefault();
      document.getElementById('search').focus();
    }
    if (e.key === 'Escape') {
      const modal = document.getElementById('zoneModal');
      if (!modal.classList.contains('hidden')) closeZoneModal();
    }
  });

  // Zone config modal
  document.getElementById('zoneConfigBtn').addEventListener('click', openZoneModal);
  document.getElementById('zoneModalClose').addEventListener('click', closeZoneModal);
  document.getElementById('zoneSave').addEventListener('click', saveZoneConfig);
  document.getElementById('zoneSelectAll').addEventListener('click', () => {
    document.querySelectorAll('#zoneModalContent input[type=checkbox]').forEach((cb) => (cb.checked = true));
    updateZoneModalSummary();
  });
  document.getElementById('zoneClearAll').addEventListener('click', () => {
    document.querySelectorAll('#zoneModalContent input[type=checkbox]').forEach((cb) => (cb.checked = false));
    updateZoneModalSummary();
  });
  document.getElementById('zoneModal').addEventListener('click', (e) => {
    if (e.target.id === 'zoneModal') closeZoneModal();
  });

  // ============ INIT ============
  const init = () => {
    if (!DATA.allProperties || DATA.allProperties.length === 0) {
      document.getElementById('emptyState').innerHTML =
        '<p class="text-lg font-semibold text-slate-600 dark:text-slate-400">Sem dados</p>' +
        '<p class="text-sm text-slate-400 dark:text-slate-600 mt-1">Executa o scraper para gerar dados.</p>';
      document.getElementById('emptyState').classList.remove('hidden');
      document.getElementById('tableSection').classList.add('hidden');
      document.getElementById('pagination').classList.add('hidden');
      document.getElementById('stats').innerHTML = '';
      return;
    }

    if (DATA.generatedAt) {
      document.getElementById('generatedAt').textContent =
        `Atualizado a ${new Date(DATA.generatedAt).toLocaleString('pt-PT')}`;
    }

    document.getElementById('newBadge').textContent = (DATA.newProperties || []).length;
    updateZonesBadge();
    updateBadges();

    initDark();
    populateFilters();
    renderSourceLegend();
    renderAll();
  };

  init();
})();
