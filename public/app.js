const $ = (id) => document.getElementById(id);

const ROUTES = ['sublingual', 'injection', 'oral', 'gel', 'patchApply', 'patchRemove'];
const ESTERS = [
  'E2', 'EB', 'EV', 'EC', 'EN', 'EU',
  'CPA', 'SPIRO', 'BICA', 'MPA', 'LEUP', 'TRIP', 'RLX',
  'T', 'TC', 'TE', 'TU',
];

const state = {
  role: null,
  events: [],
  labResults: [],
  tab: 'dose',
  editingId: null,
  series: 'e2',
  rangeDays: 30,
  sim: null,
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function api(path, opts = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...opts });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error(data && data.error ? data.error : 'request_failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

function toast(msg, isError = false) {
  const el = $('toast');
  el.hidden = false;
  el.textContent = msg;
  el.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.className = 'toast'; }, 2500);
}

function isAdmin() {
  return state.role === 'admin';
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function timeHToInput(timeH) {
  const d = new Date(timeH * 3600000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function inputToTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return {
    timeH: d.getTime() / 3600000,
    day: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
  };
}

function formatWhen(timeH) {
  const d = new Date(timeH * 3600000);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function numOrNull(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function fillSelect(el, values, label) {
  const current = el.value;
  el.innerHTML = values.map((v) => `<option value="${esc(v)}">${esc(label(v))}</option>`).join('');
  if (values.includes(current)) el.value = current;
}

function syncChoices() {
  fillSelect($('f-route'), ROUTES, (v) => t('route_' + v));
  fillSelect($('f-ester'), ESTERS, (v) => t('ester_' + v));
}

function showExtras(route) {
  const map = {
    'extra-concentration': route === 'injection',
    'extra-area': route === 'gel',
    'extra-site': route === 'gel',
    'extra-hold': route === 'sublingual',
    'extra-rate': route === 'patchApply',
    'extra-wear': route === 'patchApply',
  };
  for (const [id, on] of Object.entries(map)) $(id).hidden = !on;
  const doseRequired = route !== 'patchRemove';
  $('f-dose').required = doseRequired;
}

function setKind(kind) {
  const dose = kind !== 'lab';
  document.querySelectorAll('[data-for="dose"]').forEach((el) => { el.hidden = !dose; });
  document.querySelectorAll('[data-for="lab"]').forEach((el) => { el.hidden = dose; });
  document.querySelectorAll('.extra').forEach((el) => { el.hidden = true; });
  if (dose) showExtras($('f-route').value);
  $('f-dose').required = dose && $('f-route').value !== 'patchRemove';
  $('f-conc').required = !dose;
}

function activeList() {
  return state.tab === 'lab' ? state.labResults : state.events;
}

function shortId(id) {
  const s = String(id || '');
  return s.length > 10 ? s.slice(0, 8) : s;
}

function logActions(r, kind) {
  if (!isAdmin()) return '<span class="log-cell log-actions"></span>';
  return `<div class="log-cell log-actions">
    <button type="button" class="log-link" data-edit="${esc(r.id)}" data-kind="${kind}">${esc(t('edit'))}</button>
    <button type="button" class="log-link log-link-danger" data-del="${esc(r.id)}">${esc(t('delete'))}</button>
  </div>`;
}

function doseDetail(r) {
  const ex = r.extras || {};
  const parts = [];
  if (r.doseMG != null && r.doseMG !== '') parts.push(`${r.doseMG} mg`);
  if (ex.concentrationMGmL != null) parts.push(`${ex.concentrationMGmL} mg/mL`);
  if (ex.areaCM2 != null) parts.push(`${ex.areaCM2} cm²`);
  if (ex.gelSite != null) parts.push(t(['site_arm', 'site_thigh', 'site_scrotal'][ex.gelSite] || 'site_arm'));
  if (ex.sublingualTheta != null) parts.push(`${ex.sublingualTheta} min`);
  if (ex.releaseRateUGPerDay != null) parts.push(`${ex.releaseRateUGPerDay} µg/d`);
  if (ex.patchWearH != null) parts.push(`${ex.patchWearH} h`);
  return parts.join(' · ') || '—';
}

function doseRow(r) {
  return `<article class="log-row log-row-dose">
    <div class="log-cell log-time" title="${esc(r.day || '')}">
      <span class="log-time-main">${esc(formatWhen(r.timeH))}</span>
      <span class="log-id">${esc(shortId(r.id))}</span>
    </div>
    <div class="log-cell log-item">
      <span class="log-badge log-badge-dose">${esc(t('route_' + r.route))}</span>
      <span class="log-title">${esc(t('ester_' + r.ester))}</span>
    </div>
    <div class="log-cell log-detail muted">${esc(doseDetail(r))}</div>
    <div class="log-cell log-notes muted">${esc(r.notes || '—')}</div>
    ${logActions(r, 'dose')}
  </article>`;
}

function labRow(r) {
  const analyte = r.unit === 'ng/dl' || r.unit === 'nmol/l' ? 'T' : 'E2';
  const assay = r.assay ? (r.assay === 'lcms' ? 'LC-MS/MS' : 'Immuno') : '';
  const detail = [assay, r.unit].filter(Boolean).join(' · ');
  return `<article class="log-row log-row-lab">
    <div class="log-cell log-time" title="${esc(r.day || '')}">
      <span class="log-time-main">${esc(formatWhen(r.timeH))}</span>
      <span class="log-id">${esc(shortId(r.id))}</span>
    </div>
    <div class="log-cell log-item">
      <span class="log-badge log-badge-lab">${esc(analyte)}</span>
      <span class="log-title">${esc(r.concValue)} <span class="log-unit">${esc(r.unit)}</span></span>
    </div>
    <div class="log-cell log-detail muted">${esc(detail || '—')}</div>
    <div class="log-cell log-notes muted">${esc(r.notes || '—')}</div>
    ${logActions(r, 'lab')}
  </article>`;
}

function logTableHead(kind) {
  const actions = isAdmin()
    ? `<div class="log-cell log-head-actions">${esc(t('col_actions'))}</div>`
    : '';
  return `<div class="log-row log-row-head" role="row">
    <div class="log-cell">${esc(t('col_time'))}</div>
    <div class="log-cell">${esc(t('col_item'))}</div>
    <div class="log-cell">${esc(t('col_detail'))}</div>
    <div class="log-cell">${esc(t('col_notes'))}</div>
    ${actions}
  </div>`;
}

function renderLogTable(items, kind) {
  const rowFn = kind === 'lab' ? labRow : doseRow;
  return `<div class="log-panel">
    ${logTableHead(kind)}
    <div class="log-body">${items.map(rowFn).join('')}</div>
  </div>`;
}

const SERIES_UNIT = { e2: 'pg/mL', t: 'ng/dL', cpa: 'ng/mL' };
const SERIES_KEY = { e2: 'e2', t: 't', cpa: 'cpa' };

function weightKg() {
  const n = Number($('weight').value);
  return n > 20 && n < 250 ? n : 60;
}

function niceMax(value) {
  if (!(value > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(value)));
  const n = value / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * pow;
}

function renderChart() {
  const svg = $('chart');
  const nowH = Date.now() / 3600000;
  const fromH = nowH - state.rangeDays * 24;
  const toH = nowH + 24 * 14;
  state.sim = PK.simulate(state.events, weightKg(), fromH, toH);
  const key = SERIES_KEY[state.series];
  const ys = state.sim[key] || [];
  const xs = state.sim.timeH;
  const labs = state.labResults.map((lab) => {
    const converted = PK.labToSeries(lab);
    if (!converted || converted.series !== state.series) return null;
    if (lab.timeH < fromH || lab.timeH > toH) return null;
    return { timeH: lab.timeH, value: converted.value };
  }).filter(Boolean);

  const hasCurve = ys.some((v) => v > 0.05);
  $('chart-empty').hidden = hasCurve || labs.length > 0;
  $('chart-empty').textContent = t('chart_empty');
  svg.style.opacity = hasCurve || labs.length ? '1' : '0.35';

  const W = 800;
  const H = 280;
  const pad = { l: 48, r: 16, t: 16, b: 28 };
  const peak = Math.max(1, ...ys, ...labs.map((l) => l.value));
  const yMax = niceMax(peak * 1.08);
  const x0 = pad.l;
  const y0 = pad.t;
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const xOf = (h) => x0 + ((h - fromH) / (toH - fromH)) * iw;
  const yOf = (v) => y0 + ih - (v / yMax) * ih;

  const ticks = 4;
  let grid = '';
  for (let i = 0; i <= ticks; i++) {
    const v = (yMax / ticks) * i;
    const y = yOf(v);
    const label = v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
    grid += `<line class="grid-line" x1="${x0}" x2="${W - pad.r}" y1="${y}" y2="${y}"></line>`;
    grid += `<text class="axis-label" x="${x0 - 8}" y="${y + 4}" text-anchor="end">${label}</text>`;
  }
  const spanDays = (toH - fromH) / 24;
  const dayStep = spanDays > 50 ? 14 : spanDays > 24 ? 7 : 2;
  for (let d = 0; d <= spanDays; d += dayStep) {
    const h = fromH + d * 24;
    const x = xOf(h);
    const date = new Date(h * 3600000);
    const label = `${date.getMonth() + 1}/${date.getDate()}`;
    grid += `<text class="axis-label" x="${x}" y="${H - 8}" text-anchor="middle">${label}</text>`;
  }

  let line = '';
  let area = '';
  if (hasCurve) {
    const pts = xs.map((h, i) => `${xOf(h).toFixed(1)},${yOf(ys[i]).toFixed(1)}`);
    line = `<path class="series-${state.series}" d="M${pts.join('L')}" fill="none" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"></path>`;
    area = `<path d="M${xOf(xs[0]).toFixed(1)},${yOf(0)} L${pts.join('L')} L${xOf(xs[xs.length - 1]).toFixed(1)},${yOf(0)} Z" fill="var(--${state.series === 'e2' ? 'e2' : state.series === 't' ? 't' : 'cpa'})" opacity="0.12"></path>`;
  }
  const nowX = xOf(nowH);
  const guide = `<line x1="${nowX}" x2="${nowX}" y1="${y0}" y2="${y0 + ih}" stroke="var(--text-muted)" stroke-dasharray="3 4" stroke-width="1" opacity="0.7"></line>`;
  const dots = labs.map((lab) =>
    `<circle class="lab-dot" data-lab="1" cx="${xOf(lab.timeH).toFixed(1)}" cy="${yOf(lab.value).toFixed(1)}" r="4.5" fill="var(--${state.series === 't' ? 't' : 'e2'})"></circle>`,
  ).join('');

  svg.innerHTML = grid + area + line + guide + dots;

  const nowIdx = xs.reduce((best, h, i) => (Math.abs(h - nowH) < Math.abs(xs[best] - nowH) ? i : best), 0);
  const nowVal = ys[nowIdx] || 0;
  const unit = SERIES_UNIT[state.series];
  const shown = hasCurve ? (nowVal >= 100 ? Math.round(nowVal) : Math.round(nowVal * 10) / 10) : '—';
  $('chart-now').innerHTML = `${shown}<span>${esc(unit)}</span>`;
  $('chart-now').style.color = `var(--${state.series === 'e2' ? 'e2' : state.series === 't' ? 't' : 'cpa'})`;

  document.querySelectorAll('#series-tabs .tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.series === state.series);
  });
  document.querySelectorAll('#range-tabs .tab').forEach((btn) => {
    btn.classList.toggle('active', Number(btn.dataset.range) === state.rangeDays);
  });
}

function render() {
  const list = $('records');
  const items = activeList();
  if (!items.length) {
    list.innerHTML = '';
    $('empty').hidden = false;
    $('empty').textContent = t(state.tab === 'lab' ? 'no_labs' : 'no_doses');
  } else {
    $('empty').hidden = true;
    list.innerHTML = renderLogTable(items, state.tab);
  }

  $('tab-dose').classList.toggle('active', state.tab === 'dose');
  $('tab-lab').classList.toggle('active', state.tab === 'lab');
  $('btn-add').hidden = !isAdmin();
  $('btn-add').textContent = t(state.tab === 'lab' ? 'new_lab' : 'new_dose');
  $('btn-import').hidden = !isAdmin();
  $('btn-export').hidden = !isAdmin();
  renderChart();
  if (state.role) {
    $('signed-in-as').textContent = t(state.role === 'admin' ? 'role_admin' : 'role_guest');
  }
  if (!$('modal').hidden) {
    $('modal-title').textContent = t(state.editingId
      ? (state.tab === 'lab' ? 'edit_lab' : 'edit_dose')
      : (state.tab === 'lab' ? 'new_lab' : 'new_dose'));
  }
}

async function loadRecords() {
  const params = new URLSearchParams();
  if ($('filter-from').value) params.set('from', $('filter-from').value);
  if ($('filter-to').value) params.set('to', $('filter-to').value);
  const qs = params.toString();
  const data = await api('/api/records' + (qs ? '?' + qs : ''));
  state.events = data.events || [];
  state.labResults = data.labResults || [];
  render();
}

function clearForm() {
  $('f-time').value = timeHToInput(Date.now() / 3600000);
  $('f-route').value = 'injection';
  $('f-ester').value = 'EV';
  $('f-dose').value = '';
  $('f-concentration').value = '';
  $('f-area').value = '';
  $('f-site').value = '0';
  $('f-hold').value = '';
  $('f-rate').value = '';
  $('f-wear').value = '';
  $('f-conc').value = '';
  $('f-unit').value = 'pg/ml';
  $('f-assay').value = '';
  $('f-notes').value = '';
  if (state.tab === 'lab') {
    document.querySelectorAll('.extra').forEach((el) => { el.hidden = true; });
  } else {
    showExtras($('f-route').value);
  }
}

function openForm(record) {
  if (!isAdmin()) return;
  syncChoices();
  state.editingId = record ? record.id : null;
  const kind = state.tab === 'lab' ? 'lab' : 'dose';
  setKind(kind);
  $('modal-title').textContent = t(record
    ? (kind === 'lab' ? 'edit_lab' : 'edit_dose')
    : (kind === 'lab' ? 'new_lab' : 'new_dose'));
  clearForm();
  if (record && kind === 'dose') {
    $('f-time').value = timeHToInput(record.timeH);
    $('f-route').value = record.route;
    $('f-ester').value = record.ester;
    $('f-dose').value = record.doseMG ?? '';
    const ex = record.extras || {};
    $('f-concentration').value = ex.concentrationMGmL ?? '';
    $('f-area').value = ex.areaCM2 ?? '';
    $('f-site').value = ex.gelSite != null ? String(ex.gelSite) : '0';
    $('f-hold').value = ex.sublingualTheta > 1 ? ex.sublingualTheta : PK.holdFromTheta(ex.sublingualTheta);
    $('f-rate').value = ex.releaseRateUGPerDay ?? '';
    $('f-wear').value = ex.patchWearH ?? '';
    $('f-notes').value = record.notes || '';
    showExtras(record.route);
  } else if (record) {
    $('f-time').value = timeHToInput(record.timeH);
    $('f-conc').value = record.concValue ?? '';
    $('f-unit').value = record.unit || 'pg/ml';
    $('f-assay').value = record.assay || '';
    $('f-notes').value = record.notes || '';
  }
  $('modal').hidden = false;
}

function closeForm() {
  $('modal').hidden = true;
  state.editingId = null;
}

function buildPayload() {
  const when = inputToTime($('f-time').value);
  if (!when) return null;
  if (state.tab === 'lab') {
    return {
      kind: 'lab',
      timeH: when.timeH,
      day: when.day,
      concValue: numOrNull($('f-conc').value),
      unit: $('f-unit').value,
      assay: $('f-assay').value || null,
      notes: $('f-notes').value.trim(),
    };
  }
  const route = $('f-route').value;
  const extras = {};
  if (route === 'injection') {
    const n = numOrNull($('f-concentration').value);
    if (n != null) extras.concentrationMGmL = n;
  } else if (route === 'gel') {
    const area = numOrNull($('f-area').value);
    if (area != null) extras.areaCM2 = area;
    extras.gelSite = Number($('f-site').value);
  } else if (route === 'sublingual') {
    const hold = numOrNull($('f-hold').value);
    if (hold != null) extras.sublingualTheta = PK.thetaFromHold(hold);
  } else if (route === 'patchApply') {
    const rate = numOrNull($('f-rate').value);
    const wear = numOrNull($('f-wear').value);
    if (rate != null) extras.releaseRateUGPerDay = rate;
    if (wear != null) extras.patchWearH = wear;
  }
  return {
    kind: 'dose',
    timeH: when.timeH,
    day: when.day,
    route,
    ester: $('f-ester').value,
    doseMG: numOrNull($('f-dose').value) ?? 0,
    extras,
    notes: $('f-notes').value.trim(),
  };
}

async function submitForm(e) {
  e.preventDefault();
  if (!isAdmin()) return;
  const payload = buildPayload();
  if (!payload) {
    toast(t('save_failed'), true);
    return;
  }
  try {
    if (state.editingId) {
      await api(`/api/records/${state.editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      await api('/api/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    closeForm();
    toast(t('save_success'));
    await loadRecords();
  } catch {
    toast(t('save_failed'), true);
  }
}

async function exportJson() {
  try {
    const data = await api('/api/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `myhrt-export-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    toast(t('export_failed'), true);
  }
}

async function importJson(file) {
  if (!isAdmin()) return;
  try {
    const data = JSON.parse(await file.text());
    await api('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    toast(t('import_success'));
    await loadRecords();
  } catch {
    toast(t('import_failed'), true);
  }
}

async function init() {
  const langSwitch = $('lang-switch');
  langSwitch.value = getLang();
  langSwitch.addEventListener('change', () => {
    setLang(langSwitch.value);
    syncChoices();
    render();
  });

  try {
    const s = await api('/api/session');
    state.role = s.role;
  } catch {
    state.role = null;
  }
  if (!state.role) {
    location.href = 'login.html';
    return;
  }

  document.body.dataset.role = state.role;
  syncChoices();
  const savedWeight = localStorage.getItem('myhrt_weight');
  if (savedWeight) $('weight').value = savedWeight;
  $('btn-add').hidden = !isAdmin();
  $('btn-import').hidden = !isAdmin();
  $('btn-export').hidden = !isAdmin();

  $('series-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-series]');
    if (!btn) return;
    state.series = btn.dataset.series;
    renderChart();
  });
  $('range-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-range]');
    if (!btn) return;
    state.rangeDays = Number(btn.dataset.range);
    renderChart();
  });
  $('weight').addEventListener('change', () => {
    const n = weightKg();
    $('weight').value = String(n);
    localStorage.setItem('myhrt_weight', String(n));
    renderChart();
  });
  $('chart-stage').addEventListener('mousemove', (e) => {
    const sim = state.sim;
    const tip = $('chart-tip');
    if (!sim || !sim.timeH.length) { tip.hidden = true; return; }
    const rect = $('chart').getBoundingClientRect();
    const px = e.clientX - rect.left;
    const fromH = sim.timeH[0];
    const toH = sim.timeH[sim.timeH.length - 1];
    const padL = 48 / 800 * rect.width;
    const padR = 16 / 800 * rect.width;
    const frac = (px - padL) / (rect.width - padL - padR);
    if (frac < 0 || frac > 1) { tip.hidden = true; return; }
    const hour = fromH + frac * (toH - fromH);
    let best = 0;
    for (let i = 1; i < sim.timeH.length; i++) {
      if (Math.abs(sim.timeH[i] - hour) < Math.abs(sim.timeH[best] - hour)) best = i;
    }
    const value = sim[state.series][best];
    const when = new Date(sim.timeH[best] * 3600000);
    const shown = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
    tip.hidden = false;
    tip.textContent = `${pad(when.getMonth() + 1)}-${pad(when.getDate())} ${pad(when.getHours())}:${pad(when.getMinutes())} · ${shown} ${SERIES_UNIT[state.series]}`;
    tip.style.left = `${px}px`;
    tip.style.top = `${e.clientY - rect.top}px`;
  });
  $('chart-stage').addEventListener('mouseleave', () => { $('chart-tip').hidden = true; });
  $('tab-dose').addEventListener('click', () => { state.tab = 'dose'; render(); });
  $('tab-lab').addEventListener('click', () => { state.tab = 'lab'; render(); });
  $('btn-add').addEventListener('click', () => openForm(null));
  $('btn-close').addEventListener('click', closeForm);
  $('btn-cancel').addEventListener('click', closeForm);
  $('record-form').addEventListener('submit', submitForm);
  $('f-route').addEventListener('change', () => showExtras($('f-route').value));
  $('btn-export').addEventListener('click', exportJson);
  $('btn-import').addEventListener('click', () => { if (isAdmin()) $('import-file').click(); });
  $('import-file').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importJson(file);
    e.target.value = '';
  });
  $('btn-filter').addEventListener('click', () => loadRecords());
  $('btn-clear-filter').addEventListener('click', () => {
    $('filter-from').value = '';
    $('filter-to').value = '';
    loadRecords();
  });
  $('btn-logout').addEventListener('click', async () => {
    try { await api('/api/logout', { method: 'POST' }); } catch { /* 忽略 */ }
    location.href = 'login.html';
  });
  $('records').addEventListener('click', async (e) => {
    if (!isAdmin()) return;
    const editBtn = e.target.closest('[data-edit]');
    const delBtn = e.target.closest('[data-del]');
    if (editBtn) {
      const pool = editBtn.dataset.kind === 'lab' ? state.labResults : state.events;
      const rec = pool.find((r) => r.id === editBtn.dataset.edit);
      if (rec) openForm(rec);
    } else if (delBtn) {
      if (!confirm(t('confirm_delete'))) return;
      try {
        await api(`/api/records/${encodeURIComponent(delBtn.dataset.del)}`, { method: 'DELETE' });
        toast(t('delete_success'));
        await loadRecords();
      } catch {
        toast(t('delete_failed'), true);
      }
    }
  });

  applyI18n();
  await loadRecords();
}

init();
