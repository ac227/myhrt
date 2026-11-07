// 用药与检查的清洗、导入合并。形状参考 Oyama's HRT Tracker：
// DoseEvent = { id, route, timeH, doseMG, ester, extras, updatedAt }
// LabResult = { id, timeH, concValue, unit, assay?, updatedAt }
// 同一 id 以较新的 updatedAt 为准；删除用 tombstone，避免导入把删掉的记录又写回来。

export const ROUTES = ['sublingual', 'injection', 'oral', 'gel', 'patchApply', 'patchRemove'];
export const ESTERS = [
  'E2', 'EB', 'EV', 'EC', 'EN', 'EU',
  'CPA', 'SPIRO', 'BICA', 'MPA', 'LEUP', 'TRIP', 'RLX',
  'T', 'TC', 'TE', 'TU',
];
export const LAB_UNITS = ['pg/ml', 'pmol/l', 'ng/dl', 'nmol/l'];
export const ASSAYS = ['immuno', 'lcms'];
export const EXTRA_KEYS = [
  'concentrationMGmL',
  'areaCM2',
  'releaseRateUGPerDay',
  'sublingualTheta',
  'sublingualTier',
  'gelSite',
  'patchWearH',
];
export const T_ESTERS = new Set(['T', 'TC', 'TE', 'TU']);
export const DOSE_MG_MAX = 10000;
export const EVENT_TIME_H_MIN = 0;
export const EVENT_TIME_H_MAX = 1_500_000;

const ROUTE_SET = new Set(ROUTES);
const ESTER_SET = new Set(ESTERS);
const UNIT_SET = new Set(LAB_UNITS);
const ASSAY_SET = new Set(ASSAYS);
const EXTRA_SET = new Set(EXTRA_KEYS);

export function isTUnit(unit) {
  return unit === 'ng/dl' || unit === 'nmol/l';
}

export function isTEster(ester) {
  return T_ESTERS.has(ester);
}

function finiteNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function cleanNotes(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, 2000);
}

export function dayFromTimeH(timeH) {
  const d = new Date(timeH * 3600000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function cleanDay(value, timeH) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return dayFromTimeH(timeH);
}

function cleanTimeH(value) {
  const n = finiteNumber(value);
  if (n === null || n < EVENT_TIME_H_MIN || n > EVENT_TIME_H_MAX) return null;
  return n;
}

function cleanExtras(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const key of EXTRA_KEYS) {
    if (!(key in raw)) continue;
    const n = finiteNumber(raw[key]);
    if (n === null || n < 0 || n > 1_000_000) continue;
    out[key] = n;
  }
  return out;
}

function cleanId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  if (!id || id.length > 128) return null;
  return id;
}

export function newId() {
  return crypto.randomUUID();
}

// 返回 { record } 或 { error }。record 已是可写入的列值。
export function sanitizeDose(input, { id } = {}) {
  if (!input || typeof input !== 'object') return { error: 'invalid_row' };
  const timeH = cleanTimeH(input.timeH);
  if (timeH === null) return { error: 'invalid_time' };
  if (!ROUTE_SET.has(input.route)) return { error: 'invalid_route' };
  if (!ESTER_SET.has(input.ester)) return { error: 'invalid_ester' };
  const doseMG = finiteNumber(input.doseMG);
  const patchRemove = input.route === 'patchRemove';
  if (doseMG === null || doseMG < 0 || doseMG > DOSE_MG_MAX) return { error: 'invalid_dose' };
  if (!patchRemove && doseMG <= 0 && finiteNumber(input.extras?.releaseRateUGPerDay) === null) {
    return { error: 'invalid_dose' };
  }
  const now = Date.now();
  const updatedAt = finiteNumber(input.updatedAt);
  return {
    record: {
      id: id || cleanId(input.id) || newId(),
      kind: 'dose',
      time_h: timeH,
      day: cleanDay(input.day, timeH),
      route: input.route,
      ester: input.ester,
      dose_mg: doseMG,
      extras: JSON.stringify(cleanExtras(input.extras)),
      conc_value: null,
      unit: null,
      assay: null,
      notes: cleanNotes(input.notes),
      updated_at: updatedAt && updatedAt > 0 ? Math.floor(updatedAt) : now,
      created_at: now,
    },
  };
}

export function sanitizeLab(input, { id } = {}) {
  if (!input || typeof input !== 'object') return { error: 'invalid_row' };
  const timeH = cleanTimeH(input.timeH);
  if (timeH === null) return { error: 'invalid_time' };
  const concValue = finiteNumber(input.concValue);
  if (concValue === null || concValue < 0 || concValue > 1_000_000) return { error: 'invalid_lab' };
  const unit = typeof input.unit === 'string' ? input.unit.toLowerCase() : '';
  if (!UNIT_SET.has(unit)) return { error: 'invalid_unit' };
  let assay = null;
  if (input.assay !== undefined && input.assay !== null && input.assay !== '') {
    if (!ASSAY_SET.has(input.assay)) return { error: 'invalid_assay' };
    assay = input.assay;
  }
  const now = Date.now();
  const updatedAt = finiteNumber(input.updatedAt);
  return {
    record: {
      id: id || cleanId(input.id) || newId(),
      kind: 'lab',
      time_h: timeH,
      day: cleanDay(input.day, timeH),
      route: null,
      ester: null,
      dose_mg: null,
      extras: '{}',
      conc_value: concValue,
      unit,
      assay,
      notes: cleanNotes(input.notes),
      updated_at: updatedAt && updatedAt > 0 ? Math.floor(updatedAt) : now,
      created_at: now,
    },
  };
}

function parseExtras(raw) {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    return obj && typeof obj === 'object' && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

export function rowToDose(row) {
  const event = {
    id: row.id,
    route: row.route,
    ester: row.ester,
    doseMG: row.dose_mg,
    timeH: row.time_h,
    day: row.day,
    extras: parseExtras(row.extras),
    updatedAt: row.updated_at,
  };
  if (row.notes) event.notes = row.notes;
  return event;
}

export function rowToLab(row) {
  const lab = {
    id: row.id,
    timeH: row.time_h,
    day: row.day,
    concValue: row.conc_value,
    unit: row.unit,
    updatedAt: row.updated_at,
  };
  if (row.assay) lab.assay = row.assay;
  if (row.notes) lab.notes = row.notes;
  return lab;
}

const UPSERT_SQL = `INSERT INTO records (
  id, kind, time_h, day, route, ester, dose_mg, extras, conc_value, unit, assay, notes, updated_at, created_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  kind = excluded.kind,
  time_h = excluded.time_h,
  day = excluded.day,
  route = excluded.route,
  ester = excluded.ester,
  dose_mg = excluded.dose_mg,
  extras = excluded.extras,
  conc_value = excluded.conc_value,
  unit = excluded.unit,
  assay = excluded.assay,
  notes = excluded.notes,
  updated_at = excluded.updated_at
WHERE excluded.updated_at >= records.updated_at`;

export function upsertStatement(db, rec) {
  return db.prepare(UPSERT_SQL).bind(
    rec.id, rec.kind, rec.time_h, rec.day, rec.route, rec.ester, rec.dose_mg, rec.extras,
    rec.conc_value, rec.unit, rec.assay, rec.notes, rec.updated_at, rec.created_at,
  );
}

function legacyRoute(text) {
  const s = String(text || '');
  if (s.includes('舌下') || /sublingual/i.test(s)) return 'sublingual';
  if (s.includes('凝胶') || s.includes('透皮') || /gel/i.test(s)) return 'gel';
  if (s.includes('贴') || /patch/i.test(s)) return 'patchApply';
  if (s.includes('口服') || /oral/i.test(s)) return 'oral';
  if (s.includes('注射') || /\b(im|sc)\b/i.test(s) || /injection/i.test(s)) return 'injection';
  return 'oral';
}

function legacyEster(name, nameEn) {
  const s = `${name || ''} ${nameEn || ''}`.toLowerCase();
  if (/螺内酯|spironolactone|spiro/.test(s)) return 'SPIRO';
  if (/比卡|bicalutamide|bica/.test(s)) return 'BICA';
  if (/环丙|cyproterone|\bcpa\b/.test(s)) return 'CPA';
  if (/甲羟孕酮|medroxyprogesterone|\bmpa\b/.test(s)) return 'MPA';
  if (/亮丙|leuprorelin|leuprolide/.test(s)) return 'LEUP';
  if (/曲普|triptorelin/.test(s)) return 'TRIP';
  if (/雷洛|raloxifene/.test(s)) return 'RLX';
  if (/十一酸睾|testosterone undecanoate|\btu\b/.test(s)) return 'TU';
  if (/庚酸睾|testosterone enanthate|\bte\b/.test(s)) return 'TE';
  if (/环戊丙酸睾|testosterone cypionate|\btc\b/.test(s)) return 'TC';
  if (/睾酮|testosterone/.test(s)) return 'T';
  if (/苯甲酸|benzoate|\beb\b/.test(s)) return 'EB';
  if (/戊酸|valerate|\bev\b/.test(s)) return 'EV';
  if (/环戊丙酸雌|estradiol cypionate|\bec\b/.test(s)) return 'EC';
  if (/庚酸雌|estradiol enanthate|\ben\b/.test(s)) return 'EN';
  if (/十一酸雌|estradiol undecanoate|\beu\b/.test(s)) return 'EU';
  return 'E2';
}

function legacyTimeH(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const ms = Date.parse(`${date}T12:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return ms / 3600000;
}

function legacyDoseMG(item) {
  const dose = finiteNumber(item.dose);
  const conc = finiteNumber(item.concentration);
  const unit = String(item.dose_unit || '').toLowerCase();
  if (dose === null) return null;
  if (unit === 'ml' && conc !== null && conc > 0) return dose * conc;
  if (unit === 'μg' || unit === 'ug' || unit === 'mcg') return dose / 1000;
  return dose;
}

function legacyLab(item, field, unit) {
  const raw = String(item[field] || '').trim();
  if (!raw) return null;
  const concValue = finiteNumber(raw.split(/\s+/)[0]);
  if (concValue === null) return null;
  const timeH = legacyTimeH(item.date);
  if (timeH === null) return null;
  return {
    timeH,
    day: item.date,
    concValue,
    unit,
    notes: null,
    updatedAt: item.updated_at ? Date.parse(item.updated_at) : undefined,
  };
}

// 把一份导入 JSON 收成 doses / labs / deletions。兼容：
// - Oyama v2：{ modes: { transfem, transmasc } }
// - Oyama 扁平：{ events, labResults }
// - 纯用药数组
// - 本站旧版：带 drug_name 的记录数组（血检 E2/T 会拆成检查记录）
export function collectImport(body) {
  const doses = [];
  const labs = [];
  const deletions = { dose: {}, lab: {} };

  const pushEvent = (ev) => { if (ev && typeof ev === 'object') doses.push(ev); };
  const pushLab = (lab) => { if (lab && typeof lab === 'object') labs.push(lab); };
  const takeTombstones = (block) => {
    const del = block && block.deletions;
    if (!del || typeof del !== 'object') return;
    for (const [id, at] of Object.entries(del.events || {})) {
      const ts = finiteNumber(at);
      if (id && ts && ts > 0) deletions.dose[id] = Math.floor(ts);
    }
    for (const [id, at] of Object.entries(del.labResults || {})) {
      const ts = finiteNumber(at);
      if (id && ts && ts > 0) deletions.lab[id] = Math.floor(ts);
    }
  };

  if (Array.isArray(body)) {
    const legacy = body.some((item) => item && typeof item === 'object' && item.drug_name && item.doseMG == null && item.concValue == null);
    if (!legacy) {
      for (const item of body) pushEvent(item);
      return { doses, labs, deletions };
    }
    for (const item of body) {
      if (!item || typeof item !== 'object') continue;
      const timeH = legacyTimeH(item.date);
      const doseMG = legacyDoseMG(item);
      if (timeH !== null && doseMG !== null && doseMG > 0) {
        const notes = [item.drug_name, item.drug_name_en, item.frequency, item.notes].filter(Boolean).join(' · ');
        doses.push({
          id: item.id != null ? `legacy-dose-${item.id}` : undefined,
          route: legacyRoute(item.route),
          ester: legacyEster(item.drug_name, item.drug_name_en),
          doseMG,
          timeH,
          day: item.date,
          extras: {},
          notes,
          updatedAt: item.updated_at ? Date.parse(item.updated_at) : undefined,
        });
        const conc = finiteNumber(item.concentration);
        if (conc !== null && conc > 0 && String(item.concentration_unit || '').toLowerCase().includes('mg/ml')) {
          doses[doses.length - 1].extras = { concentrationMGmL: conc };
        }
      }
      const e2 = legacyLab(item, 'e2', 'pg/ml');
      if (e2) {
        e2.id = item.id != null ? `legacy-e2-${item.id}` : undefined;
        labs.push(e2);
      }
      const t = legacyLab(item, 't', 'ng/dl');
      if (t) {
        t.id = item.id != null ? `legacy-t-${item.id}` : undefined;
        labs.push(t);
      }
    }
    return { doses, labs, deletions };
  }

  if (!body || typeof body !== 'object') return { error: 'expected_object' };

  if (body.modes && typeof body.modes === 'object') {
    for (const block of Object.values(body.modes)) {
      if (!block || typeof block !== 'object') continue;
      for (const ev of block.events || []) pushEvent(ev);
      for (const lab of block.labResults || []) pushLab(lab);
      takeTombstones(block);
    }
  } else {
    for (const ev of body.events || []) pushEvent(ev);
    for (const lab of body.labResults || []) pushLab(lab);
    takeTombstones(body);
  }
  return { doses, labs, deletions };
}
