const state = {
  payload: null,
  query: '',
  selectedSection: 'All',
  auxCollapsed: false,
  canvasMode: false,
  draggingKey: '',
  layout: {
    order: [],
    sizes: {},
  },
  loading: false,
};

const el = {
  sourceBadge: document.getElementById('sourceBadge'),
  chainBadge: document.getElementById('chainBadge'),
  generatedAt: document.getElementById('generatedAt'),
  panelCount: document.getElementById('panelCount'),
  sectionCount: document.getElementById('sectionCount'),
  tradeCoverage: document.getElementById('tradeCoverage'),
  marketCoverage: document.getElementById('marketCoverage'),
  assumptionsList: document.getElementById('assumptionsList'),
  sectionFilters: document.getElementById('sectionFilters'),
  sections: document.getElementById('sections'),
  auxSection: document.getElementById('auxSection'),
  auxGrid: document.getElementById('auxGrid'),
  canvasSection: document.getElementById('canvasSection'),
  canvasGrid: document.getElementById('canvasGrid'),
  searchInput: document.getElementById('searchInput'),
  reloadBtn: document.getElementById('reloadBtn'),
  canvasBtn: document.getElementById('canvasBtn'),
  resetLayoutBtn: document.getElementById('resetLayoutBtn'),
  collapseBtn: document.getElementById('collapseBtn'),
};

const colors = ['#4bf2ad', '#ffb36f', '#7ab8ff', '#f77866', '#f5e86e', '#c19fff'];
const LAYOUT_STORAGE_KEY = 'pandora_analytics_canvas_layout_v1';
let chartUidCounter = 0;

const fmtInt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const fmtCurrency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});
const fmtDecimal = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmtPercent = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function safeParseJson(raw, fallback) {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : fallback;
  } catch {
    return fallback;
  }
}

function loadLayoutState() {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return { order: [], sizes: {} };
    const parsed = safeParseJson(raw, { order: [], sizes: {} });
    return {
      order: Array.isArray(parsed.order) ? parsed.order : [],
      sizes: parsed.sizes && typeof parsed.sizes === 'object' ? parsed.sizes : {},
    };
  } catch {
    return { order: [], sizes: {} };
  }
}

function saveLayoutState() {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(state.layout));
  } catch {
    // ignore storage failures
  }
}

state.layout = loadLayoutState();

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatByType(value, format) {
  const n = toNum(value);
  if (format === 'integer') return fmtInt.format(n);
  if (format === 'currency') return fmtCurrency.format(n);
  if (format === 'percent') return fmtPercent.format(n);
  if (format === 'decimal') return fmtDecimal.format(n);
  if (value === null || value === undefined) return '-';
  return String(value);
}

function shortenText(value, limit = 54) {
  const text = String(value || '');
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}...`;
}

function isEthAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(String(value || ''));
}

function cellLinkForTable(row, columnKey, rawValue) {
  const walletKeys = new Set(['wallet', 'walletAddress', 'provider', 'trader', 'creator', 'user', 'disputer']);
  const marketKeys = new Set(['market', 'marketAddress', 'topMarket']);
  const key = String(columnKey || '');

  if (walletKeys.has(key) && isEthAddress(rawValue)) {
    const address = String(rawValue);
    return {
      url: `https://debank.com/profile/${address}`,
      className: 'wallet-link',
    };
  }

  if (marketKeys.has(key) && isEthAddress(rawValue)) {
    const address = String(rawValue);
    return {
      url: `https://thisispandora.ai/market/${address}`,
      className: 'market-link',
    };
  }

  if (key.endsWith('Short')) {
    const fullKey = key.slice(0, -5);
    const fullValue = row?.[fullKey];
    if (walletKeys.has(fullKey) && isEthAddress(fullValue)) {
      const address = String(fullValue);
      return {
        url: `https://debank.com/profile/${address}`,
        className: 'wallet-link',
      };
    }
    if (marketKeys.has(fullKey) && isEthAddress(fullValue)) {
      const address = String(fullValue);
      return {
        url: `https://thisispandora.ai/market/${address}`,
        className: 'market-link',
      };
    }
  }

  if (isEthAddress(rawValue) && /(wallet|provider|trader|creator|user|disputer)/i.test(key)) {
    const address = String(rawValue);
    return {
      url: `https://debank.com/profile/${address}`,
      className: 'wallet-link',
    };
  }

  if (isEthAddress(rawValue) && /market/i.test(key)) {
    const address = String(rawValue);
    return {
      url: `https://thisispandora.ai/market/${address}`,
      className: 'market-link',
    };
  }

  return null;
}

function sortByDay(points) {
  return [...points].sort((a, b) => String(a.x).localeCompare(String(b.x)));
}

function uniq(values) {
  return [...new Set(values)];
}

function panelSearchText(panel, sectionName) {
  return [panel.title, panel.key, panel.subtitle, sectionName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function getSections() {
  if (!state.payload || !Array.isArray(state.payload.sections)) return [];

  const q = state.query.trim().toLowerCase();
  return state.payload.sections
    .filter((section) => state.selectedSection === 'All' || section.name === state.selectedSection)
    .map((section) => {
      const panels = (section.panels || []).filter((panel) => !q || panelSearchText(panel, section.name).includes(q));
      return { ...section, panels };
    })
    .filter((section) => section.panels.length > 0);
}

function panelCount(sections) {
  return sections.reduce((sum, section) => sum + section.panels.length, 0);
}

function buildLinePath(points, xAt, yAt) {
  if (!points.length) return '';
  return points
    .map((point, idx) => `${idx === 0 ? 'M' : 'L'}${xAt(point.x).toFixed(2)},${yAt(point.y).toFixed(2)}`)
    .join(' ');
}

function renderLineChart(seriesInput, yFormat) {
  const series = seriesInput
    .map((s) => ({ name: s.name, points: sortByDay(s.points || []) }))
    .filter((s) => s.points.length > 0);

  const container = document.createElement('div');
  container.className = 'chart-wrap';

  if (!series.length) {
    const empty = document.createElement('div');
    empty.className = 'no-data';
    empty.textContent = 'No data available';
    container.appendChild(empty);
    return container;
  }

  const allX = uniq(series.flatMap((s) => s.points.map((p) => p.x))).sort((a, b) => String(a).localeCompare(String(b)));
  const yValues = series.flatMap((s) => s.points.map((p) => toNum(p.y)));
  const pointMaps = series.map((s) => new Map(s.points.map((p) => [p.x, toNum(p.y)])));

  const width = 920;
  const height = 320;
  const pad = { top: 20, right: 18, bottom: 40, left: 66 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  let yMin = Math.min(...yValues);
  let yMax = Math.max(...yValues);

  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    yMin = 0;
    yMax = 1;
  }

  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }

  const xAt = (x) => {
    const idx = allX.indexOf(x);
    if (idx < 0 || allX.length < 2) return pad.left;
    return pad.left + (idx / (allX.length - 1)) * chartW;
  };

  const yAt = (y) => {
    const ratio = (toNum(y) - yMin) / (yMax - yMin);
    return pad.top + (1 - ratio) * chartH;
  };

  const gridTicks = [0, 0.25, 0.5, 0.75, 1];
  const gridLines = gridTicks
    .map((tick) => {
      const yVal = yMin + (yMax - yMin) * tick;
      const y = yAt(yVal);
      return `
        <line x1="${pad.left}" y1="${y.toFixed(2)}" x2="${width - pad.right}" y2="${y.toFixed(2)}" class="grid-line" />
        <text x="${pad.left - 8}" y="${(y + 4).toFixed(2)}" class="axis-label">${escapeHtml(
          formatByType(yVal, yFormat === 'percent' ? 'percent' : 'decimal'),
        )}</text>
      `;
    })
    .join('');

  const defs = series
    .map((_, idx) => {
      const color = colors[idx % colors.length];
      const gradId = `line-grad-${chartUidCounter}-${idx}`;
      return `<linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.35" />
        <stop offset="100%" stop-color="${color}" stop-opacity="0.02" />
      </linearGradient>`;
    })
    .join('');

  const paths = series
    .map((s, idx) => {
      const color = colors[idx % colors.length];
      const path = buildLinePath(s.points, xAt, yAt);
      const gradId = `line-grad-${chartUidCounter}-${idx}`;
      const areaPath = `${path} L${xAt(s.points[s.points.length - 1].x).toFixed(2)},${(height - pad.bottom).toFixed(2)} L${xAt(
        s.points[0].x,
      ).toFixed(2)},${(height - pad.bottom).toFixed(2)} Z`;
      const lastPoint = s.points[s.points.length - 1];
      return `
        <path d="${areaPath}" fill="url(#${gradId})" class="area-path" />
        <path d="${path}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="${xAt(lastPoint.x).toFixed(2)}" cy="${yAt(lastPoint.y).toFixed(2)}" r="4" fill="${color}" />
      `;
    })
    .join('');

  const firstX = allX[0] || '';
  const lastX = allX[allX.length - 1] || '';

  chartUidCounter += 1;
  const chartUid = `chart-${chartUidCounter}`;
  const hoverDots = series
    .map(
      (s, idx) =>
        `<circle data-series="${idx}" class="hover-dot" r="5" fill="${colors[idx % colors.length]}" visibility="hidden" />`,
    )
    .join('');

  container.innerHTML = `
    <div class="chart-shell" data-chart-id="${chartUid}">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="chart" class="line-chart">
        <defs>${defs}</defs>
        ${gridLines}
        ${paths}
        <line class="hover-guide" x1="0" y1="${pad.top}" x2="0" y2="${height - pad.bottom}" visibility="hidden"></line>
        ${hoverDots}
        <text x="${pad.left}" y="${height - 8}" class="axis-label">${escapeHtml(firstX)}</text>
        <text x="${width - pad.right}" y="${height - 8}" text-anchor="end" class="axis-label">${escapeHtml(lastX)}</text>
      </svg>
      <div class="chart-tooltip" hidden></div>
    </div>
  `;

  const shell = container.querySelector('.chart-shell');
  const svg = container.querySelector('svg');
  const tooltip = container.querySelector('.chart-tooltip');
  const guide = container.querySelector('.hover-guide');
  const dots = [...container.querySelectorAll('.hover-dot')];

  function hideHover() {
    guide.setAttribute('visibility', 'hidden');
    dots.forEach((dot) => dot.setAttribute('visibility', 'hidden'));
    tooltip.hidden = true;
  }

  function showHover(clientX) {
    const rect = svg.getBoundingClientRect();
    if (!rect.width) return;

    const localX = ((clientX - rect.left) / rect.width) * width;
    const boundedX = Math.max(pad.left, Math.min(width - pad.right, localX));

    let idx = 0;
    if (allX.length > 1) {
      const ratio = (boundedX - pad.left) / chartW;
      idx = Math.max(0, Math.min(allX.length - 1, Math.round(ratio * (allX.length - 1))));
    }

    const xLabel = allX[idx];
    if (!xLabel) {
      hideHover();
      return;
    }

    const xCoord = xAt(xLabel);
    guide.setAttribute('x1', xCoord.toFixed(2));
    guide.setAttribute('x2', xCoord.toFixed(2));
    guide.setAttribute('visibility', 'visible');

    const lines = [];
    lines.push(`<div class="tooltip-time">${escapeHtml(String(xLabel))}</div>`);

    dots.forEach((dot, seriesIdx) => {
      const value = pointMaps[seriesIdx].get(xLabel);
      const label = series[seriesIdx].name || `Series ${seriesIdx + 1}`;
      if (value === undefined) {
        dot.setAttribute('visibility', 'hidden');
        lines.push(
          `<div class="tooltip-row"><i style="background:${colors[seriesIdx % colors.length]}"></i>${escapeHtml(label)}: <span>-</span></div>`,
        );
        return;
      }

      const yCoord = yAt(value);
      dot.setAttribute('cx', xCoord.toFixed(2));
      dot.setAttribute('cy', yCoord.toFixed(2));
      dot.setAttribute('visibility', 'visible');
      lines.push(
        `<div class="tooltip-row"><i style="background:${colors[seriesIdx % colors.length]}"></i>${escapeHtml(label)}: <span>${escapeHtml(
          formatByType(value, yFormat || 'decimal'),
        )}</span></div>`,
      );
    });

    tooltip.innerHTML = lines.join('');
    tooltip.hidden = false;

    const xPx = (xCoord / width) * rect.width;
    const maxLeft = rect.width - 210;
    const preferred = xPx + 14;
    const left = Math.max(8, Math.min(maxLeft, preferred));
    tooltip.style.left = `${left}px`;
    tooltip.style.top = '8px';
  }

  shell.addEventListener('mouseenter', (event) => {
    showHover(event.clientX);
  });
  shell.addEventListener('mousemove', (event) => {
    showHover(event.clientX);
  });
  shell.addEventListener('mouseleave', () => {
    hideHover();
  });

  const legend = document.createElement('div');
  legend.className = 'legend';
  series.forEach((s, idx) => {
    const item = document.createElement('span');
    item.className = 'legend-item';
    item.innerHTML = `<i style="background:${colors[idx % colors.length]}"></i>${escapeHtml(s.name || `Series ${idx + 1}`)}`;
    legend.appendChild(item);
  });

  container.appendChild(legend);
  return container;
}

function renderDistribution(panel) {
  const rows = Array.isArray(panel.rows) ? panel.rows : [];
  const labelKey = panel.labelKey || 'label';
  const valueKey = panel.valueKey || 'value';
  const maxValue = Math.max(...rows.map((r) => toNum(r[valueKey])), 0);

  const wrap = document.createElement('div');
  wrap.className = 'distribution';

  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'no-data';
    empty.textContent = 'No rows available';
    wrap.appendChild(empty);
    return wrap;
  }

  rows.forEach((row, idx) => {
    const label = row[labelKey] ?? '-';
    const value = toNum(row[valueKey]);
    const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;

    const bar = document.createElement('div');
    bar.className = 'dist-row';
    bar.innerHTML = `
      <div class="dist-head">
        <span class="dist-label">${escapeHtml(label)}</span>
        <strong class="dist-value">${escapeHtml(formatByType(value, panel.valueFormat || 'decimal'))}</strong>
      </div>
      <div class="dist-track">
        <div class="dist-fill" style="width:${pct.toFixed(2)}%; --bar-color:${colors[idx % colors.length]}"></div>
      </div>
    `;
    wrap.appendChild(bar);
  });

  return wrap;
}

function renderTable(panel) {
  const columns = panel.columns || [];
  const rows = panel.rows || [];

  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';

  if (!columns.length) {
    const empty = document.createElement('div');
    empty.className = 'no-data';
    empty.textContent = 'No table schema available';
    wrap.appendChild(empty);
    return wrap;
  }

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  columns.forEach((col) => {
    const th = document.createElement('th');
    th.textContent = col.label || col.key;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const rowsToShow = 40;
  rows.slice(0, rowsToShow).forEach((row) => {
    const tr = document.createElement('tr');
    columns.forEach((col) => {
      const td = document.createElement('td');
      const raw = row[col.key];
      const formatted = col.format ? formatByType(raw, col.format) : raw;
      const displayText = shortenText(formatted);
      const linkMeta = cellLinkForTable(row, col.key, raw);
      if (linkMeta?.url) {
        const a = document.createElement('a');
        a.className = linkMeta.className || 'wallet-link';
        a.href = linkMeta.url;
        a.target = '_blank';
        a.rel = 'noreferrer noopener';
        a.textContent = displayText;
        td.appendChild(a);
      } else {
        td.textContent = displayText;
      }
      td.title = String(formatted ?? '');
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrap.appendChild(table);

  if (rows.length > rowsToShow) {
    const foot = document.createElement('p');
    foot.className = 'table-footnote';
    foot.textContent = `Showing ${rowsToShow} of ${fmtInt.format(rows.length)} rows`;
    wrap.appendChild(foot);
  }

  return wrap;
}

function renderKpi(panel) {
  const card = document.createElement('div');
  card.className = 'kpi';

  const value = document.createElement('p');
  value.className = 'kpi-value';
  value.textContent = formatByType(panel.value, panel.format || 'decimal');
  card.appendChild(value);

  if (panel.subtitle) {
    const subtitle = document.createElement('p');
    subtitle.className = 'kpi-sub';
    subtitle.textContent = panel.subtitle;
    card.appendChild(subtitle);
  }

  return card;
}

function renderKpiGroup(panel) {
  const grid = document.createElement('div');
  grid.className = 'kpi-group';

  const items = Array.isArray(panel.items) ? panel.items : [];
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'no-data';
    empty.textContent = 'No metrics available';
    grid.appendChild(empty);
    return grid;
  }

  items.forEach((item) => {
    const cell = document.createElement('article');
    cell.className = 'kpi-item';
    cell.innerHTML = `
      <h4>${escapeHtml(item.label || 'Metric')}</h4>
      <p>${escapeHtml(formatByType(item.value, item.format || 'decimal'))}</p>
    `;
    grid.appendChild(cell);
  });

  return grid;
}

function panelBody(panel) {
  if (panel.type === 'kpi') return renderKpi(panel);
  if (panel.type === 'kpi_group') return renderKpiGroup(panel);
  if (panel.type === 'distribution') return renderDistribution(panel);
  if (panel.type === 'table') return renderTable(panel);
  if (panel.type === 'timeseries') {
    return renderLineChart([{ name: panel.title || 'Series', points: panel.series || [] }], panel.yFormat || 'decimal');
  }
  if (panel.type === 'multiseries') {
    return renderLineChart(
      (panel.series || []).map((s) => ({ name: s.name || 'Series', points: s.points || [] })),
      panel.series?.[0]?.yFormat || 'decimal',
    );
  }

  const unsupported = document.createElement('div');
  unsupported.className = 'no-data';
  unsupported.textContent = `Unsupported panel type: ${panel.type || 'unknown'}`;
  return unsupported;
}

function renderPanel(panel, sectionName) {
  const card = document.createElement('article');
  card.className = 'panel-card';
  if (panel.type === 'timeseries' || panel.type === 'multiseries') {
    card.classList.add('has-chart');
  }

  const head = document.createElement('header');
  head.className = 'panel-head';

  const titleWrap = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = panel.title || panel.key || 'Untitled panel';
  titleWrap.appendChild(title);

  const meta = document.createElement('p');
  meta.className = 'panel-meta';
  meta.textContent = `${sectionName} / ${panel.type || 'unknown'} / ${panel.key || 'no-key'}`;
  titleWrap.appendChild(meta);

  head.appendChild(titleWrap);

  const tag = document.createElement('span');
  tag.className = 'panel-tag';
  tag.textContent = panel.type || 'panel';
  head.appendChild(tag);

  card.appendChild(head);
  card.appendChild(panelBody(panel));

  if (Array.isArray(panel.notes) && panel.notes.length > 0) {
    const notes = document.createElement('ul');
    notes.className = 'panel-notes';
    panel.notes.forEach((note) => {
      const li = document.createElement('li');
      li.textContent = note;
      notes.appendChild(li);
    });
    card.appendChild(notes);
  }

  return card;
}

function renderSectionFilters(sections) {
  const names = ['All', ...sections.map((s) => s.name)];
  el.sectionFilters.innerHTML = '';

  names.forEach((name) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `section-chip${name === state.selectedSection ? ' active' : ''}`;
    btn.textContent = name;
    btn.addEventListener('click', () => {
      state.selectedSection = name;
      render();
    });
    el.sectionFilters.appendChild(btn);
  });
}

function renderAssumptions(assumptions) {
  el.assumptionsList.innerHTML = '';
  (assumptions || []).forEach((line) => {
    const li = document.createElement('li');
    li.textContent = line;
    el.assumptionsList.appendChild(li);
  });
}

function buildAuxPanels(aux) {
  return [
    {
      title: 'Top Traders by Volume',
      type: 'table',
      columns: [
        { key: 'traderShort', label: 'Trader' },
        { key: 'totalUsdc', label: 'Volume USDC', format: 'currency' },
      ],
      rows: aux.topTraders || [],
      key: 'aux_top_traders',
    },
    {
      title: 'Disputes by Day',
      type: 'timeseries',
      yFormat: 'integer',
      series: (aux.disputesByDay || []).map((row) => ({ x: row.day, y: row.count })),
      key: 'aux_disputes_by_day',
    },
    {
      title: 'Redemptions by Market Type',
      type: 'distribution',
      rows: aux.redemptionByMarketType || [],
      labelKey: 'marketType',
      valueKey: 'totalUsdc',
      valueFormat: 'currency',
      key: 'aux_redemption_market_type',
    },
    {
      title: 'Unresolved Past Deadline Polls',
      type: 'table',
      columns: [
        { key: 'pollId', label: 'Poll' },
        { key: 'question', label: 'Question' },
        { key: 'overdueHours', label: 'Overdue Hours', format: 'decimal' },
      ],
      rows: aux.unresolvedPastDeadline || [],
      key: 'aux_unresolved_polls',
    },
  ];
}

function defaultCanvasSize(panel) {
  if (panel.type === 'table') return 'l';
  if (panel.type === 'multiseries' || panel.type === 'timeseries') return 'l';
  if (panel.type === 'kpi_group') return 'l';
  return 'm';
}

function nextCanvasSize(size) {
  if (size === 's') return 'm';
  if (size === 'm') return 'l';
  return 's';
}

function syncLayoutWithItems(items) {
  const keys = items.map((item) => item.itemKey);
  const filteredOrder = state.layout.order.filter((key) => keys.includes(key));
  keys.forEach((key) => {
    if (!filteredOrder.includes(key)) filteredOrder.push(key);
  });

  const nextSizes = {};
  keys.forEach((key) => {
    const current = state.layout.sizes[key];
    if (current === 's' || current === 'm' || current === 'l') {
      nextSizes[key] = current;
    }
  });

  const changed =
    filteredOrder.length !== state.layout.order.length ||
    filteredOrder.some((key, idx) => key !== state.layout.order[idx]) ||
    Object.keys(nextSizes).length !== Object.keys(state.layout.sizes).length;

  if (changed) {
    state.layout.order = filteredOrder;
    state.layout.sizes = nextSizes;
    saveLayoutState();
  }
}

function orderedCanvasItems(items) {
  const indexByKey = new Map(state.layout.order.map((key, idx) => [key, idx]));
  return [...items].sort((a, b) => {
    const ai = indexByKey.has(a.itemKey) ? indexByKey.get(a.itemKey) : Number.MAX_SAFE_INTEGER;
    const bi = indexByKey.has(b.itemKey) ? indexByKey.get(b.itemKey) : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return String(a.panel.title || a.itemKey).localeCompare(String(b.panel.title || b.itemKey));
  });
}

function reorderLayout(dragKey, targetKey) {
  if (!dragKey || !targetKey || dragKey === targetKey) return;
  const order = [...state.layout.order];
  const from = order.indexOf(dragKey);
  const to = order.indexOf(targetKey);
  if (from < 0 || to < 0) return;

  order.splice(from, 1);
  order.splice(to, 0, dragKey);
  state.layout.order = order;
  saveLayoutState();
  render();
}

function getCanvasItems(sections) {
  const items = [];
  sections.forEach((section) => {
    section.panels.forEach((panel) => {
      const key = String(panel.key || `${section.name}_${panel.title || 'panel'}`);
      items.push({
        itemKey: key,
        sectionName: section.name,
        panel,
      });
    });
  });

  if (!state.auxCollapsed) {
    const auxPanels = buildAuxPanels(state.payload?.auxTables || {});
    auxPanels.forEach((panel) => {
      items.push({
        itemKey: String(panel.key || `aux_${panel.title || 'panel'}`),
        sectionName: 'Auxiliary',
        panel,
      });
    });
  }

  return items;
}

function renderCanvas(sections) {
  const items = getCanvasItems(sections);
  el.canvasGrid.innerHTML = '';

  if (!items.length) {
    el.canvasGrid.innerHTML = '<article class="empty-state">No blocks available for canvas.</article>';
    return;
  }

  syncLayoutWithItems(items);
  const ordered = orderedCanvasItems(items);

  ordered.forEach((item) => {
    const size = state.layout.sizes[item.itemKey] || defaultCanvasSize(item.panel);

    const wrapper = document.createElement('article');
    wrapper.className = `canvas-item size-${size}`;
    wrapper.draggable = true;
    wrapper.dataset.key = item.itemKey;

    wrapper.addEventListener('dragstart', (event) => {
      state.draggingKey = item.itemKey;
      wrapper.classList.add('dragging');
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', item.itemKey);
      }
    });

    wrapper.addEventListener('dragend', () => {
      state.draggingKey = '';
      wrapper.classList.remove('dragging');
      document.querySelectorAll('.canvas-item.drop-target').forEach((node) => node.classList.remove('drop-target'));
    });

    wrapper.addEventListener('dragover', (event) => {
      event.preventDefault();
      wrapper.classList.add('drop-target');
    });

    wrapper.addEventListener('dragleave', () => {
      wrapper.classList.remove('drop-target');
    });

    wrapper.addEventListener('drop', (event) => {
      event.preventDefault();
      wrapper.classList.remove('drop-target');
      const dragKey = event.dataTransfer?.getData('text/plain') || state.draggingKey;
      reorderLayout(dragKey, item.itemKey);
    });

    const canvasBar = document.createElement('div');
    canvasBar.className = 'canvas-item-bar';
    canvasBar.innerHTML = `
      <span class="drag-handle" title="Drag to move">:: Drag</span>
      <button type="button" class="size-btn" title="Cycle size">Size: ${size.toUpperCase()}</button>
    `;

    const sizeBtn = canvasBar.querySelector('.size-btn');
    sizeBtn.addEventListener('click', () => {
      state.layout.sizes[item.itemKey] = nextCanvasSize(size);
      saveLayoutState();
      render();
    });

    const card = renderPanel(item.panel, item.sectionName);
    card.classList.add('canvas-panel');

    wrapper.appendChild(canvasBar);
    wrapper.appendChild(card);
    el.canvasGrid.appendChild(wrapper);
  });
}

function renderAux() {
  const aux = state.payload?.auxTables || {};
  el.auxGrid.innerHTML = '';
  const auxPanels = buildAuxPanels(aux);

  auxPanels.forEach((panel) => {
    const card = renderPanel(panel, 'Auxiliary');
    card.classList.add('aux-card');
    el.auxGrid.appendChild(card);
  });

  el.auxSection.classList.toggle('collapsed', state.auxCollapsed);
  el.collapseBtn.textContent = state.auxCollapsed ? 'Expand Aux Tables' : 'Collapse Aux Tables';
}

function renderSections(sections) {
  el.sections.innerHTML = '';

  if (!sections.length) {
    const empty = document.createElement('article');
    empty.className = 'empty-state';
    empty.textContent = 'No panels match the current filters.';
    el.sections.appendChild(empty);
    return;
  }

  sections.forEach((section, idx) => {
    const wrapper = document.createElement('section');
    wrapper.className = 'section-block';
    wrapper.style.setProperty('--delay', `${idx * 60}ms`);

    const head = document.createElement('header');
    head.className = 'section-head';
    head.innerHTML = `
      <h2>${escapeHtml(section.name)}</h2>
      <p>${fmtInt.format(section.panels.length)} panel${section.panels.length === 1 ? '' : 's'}</p>
    `;

    const grid = document.createElement('div');
    grid.className = 'panel-grid';
    section.panels.forEach((panel) => {
      grid.appendChild(renderPanel(panel, section.name));
    });

    wrapper.appendChild(head);
    wrapper.appendChild(grid);
    el.sections.appendChild(wrapper);
  });
}

function renderSummary() {
  const allSections = state.payload?.sections || [];
  const visibleSections = getSections();
  const visibleMainPanels = panelCount(visibleSections);
  const visibleCanvasBlocks = getCanvasItems(visibleSections).length;

  el.sourceBadge.textContent = state.payload?.source || '-';
  el.chainBadge.textContent = state.payload?.chainId ? `Ethereum (${state.payload.chainId})` : '-';
  el.generatedAt.textContent = state.payload?.generatedAt ? new Date(state.payload.generatedAt).toLocaleString() : '-';

  el.panelCount.textContent = fmtInt.format(state.canvasMode ? visibleCanvasBlocks : visibleMainPanels);
  el.sectionCount.textContent = fmtInt.format(visibleSections.length);
  el.tradeCoverage.textContent = fmtInt.format(toNum(state.payload?.coverage?.trades));
  el.marketCoverage.textContent = fmtInt.format(toNum(state.payload?.coverage?.markets));

  renderAssumptions(state.payload?.assumptions || []);
  renderSectionFilters(allSections);
  el.canvasBtn.textContent = state.canvasMode ? 'Exit Canvas' : 'Arrange Canvas';

  if (state.canvasMode) {
    el.canvasSection.classList.remove('hidden');
    el.sections.classList.add('hidden');
    el.auxSection.classList.add('hidden');
    renderCanvas(visibleSections);
  } else {
    el.canvasSection.classList.add('hidden');
    el.sections.classList.remove('hidden');
    el.auxSection.classList.remove('hidden');
    renderSections(visibleSections);
    renderAux();
  }
}

function renderLoading() {
  el.canvasSection.classList.add('hidden');
  el.auxSection.classList.add('hidden');
  el.sections.classList.remove('hidden');
  el.sections.innerHTML = '<article class="empty-state">Loading analytics payload...</article>';
}

function renderError(error) {
  const msg = String(error?.message || error || 'Unknown error');
  el.canvasSection.classList.add('hidden');
  el.auxSection.classList.add('hidden');
  el.sections.classList.remove('hidden');
  el.sections.innerHTML = `<article class="empty-state error">Failed to load analytics: ${escapeHtml(msg)}</article>`;
}

async function fetchAnalytics() {
  const configuredBase = String(window.PANDORA_ANALYTICS_API_BASE || '').trim().replace(/\/+$/, '');
  const candidates = [];
  if (configuredBase) candidates.push(`${configuredBase}/api/analytics`);
  candidates.push('/api/analytics');
  candidates.push('./data/analytics.json');

  let lastError = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        lastError = new Error(`HTTP ${res.status} @ ${url}`);
        continue;
      }
      const data = await res.json();
      if (data && Array.isArray(data.sections)) return data;
      lastError = new Error(`Invalid analytics payload @ ${url}`);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Unable to load analytics data');
}

async function loadAnalytics() {
  state.loading = true;
  renderLoading();
  try {
    state.payload = await fetchAnalytics();
    renderSummary();
  } catch (error) {
    renderError(error);
  } finally {
    state.loading = false;
  }
}

function render() {
  if (!state.payload) {
    renderLoading();
    return;
  }
  renderSummary();
}

el.searchInput.addEventListener('input', (event) => {
  state.query = String(event.target.value || '');
  render();
});

el.reloadBtn.addEventListener('click', () => {
  loadAnalytics();
});

el.canvasBtn.addEventListener('click', () => {
  state.canvasMode = !state.canvasMode;
  render();
});

el.resetLayoutBtn.addEventListener('click', () => {
  state.layout = { order: [], sizes: {} };
  saveLayoutState();
  render();
});

el.collapseBtn.addEventListener('click', () => {
  state.auxCollapsed = !state.auxCollapsed;
  render();
});

loadAnalytics();
