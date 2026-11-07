import { json, requireRole } from '../../shared/auth.js';
import { rowToDose, rowToLab, sanitizeDose, sanitizeLab, upsertStatement } from '../../shared/records.js';

function splitRows(rows) {
  const events = [];
  const labResults = [];
  for (const row of rows) {
    if (row.kind === 'lab') labResults.push(rowToLab(row));
    else events.push(rowToDose(row));
  }
  return { events, labResults };
}

// GET /api/records —— { events, labResults }，可选 ?from=&to= 按本地日历日过滤
export const onRequestGet = async (context) => {
  const guard = requireRole(context);
  if (guard) return guard;

  const url = new URL(context.request.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const conds = [];
  const params = [];
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    conds.push('day >= ?');
    params.push(from);
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    conds.push('day <= ?');
    params.push(to);
  }

  let sql = 'SELECT * FROM records';
  if (conds.length) sql += ' WHERE ' + conds.join(' AND ');
  sql += ' ORDER BY time_h DESC, id DESC';

  const { results } = await context.env.DB.prepare(sql).bind(...params).all();
  return json(splitRows(results));
};

// POST /api/records —— 新建一条用药或检查（仅管理员）
export const onRequestPost = async (context) => {
  const guard = requireRole(context, 'admin');
  if (guard) return guard;

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }

  const kind = body && body.kind;
  const parsed = kind === 'lab' ? sanitizeLab(body) : kind === 'dose' ? sanitizeDose(body) : { error: 'invalid_kind' };
  if (parsed.error) return json({ error: parsed.error }, 400);

  const rec = parsed.record;
  rec.updated_at = Date.now();
  await upsertStatement(context.env.DB, rec).run();
  const { results } = await context.env.DB.prepare('SELECT * FROM records WHERE id = ?').bind(rec.id).all();
  const row = results[0];
  return json(row.kind === 'lab' ? rowToLab(row) : rowToDose(row), 201);
};
