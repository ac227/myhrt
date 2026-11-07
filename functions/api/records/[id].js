import { json, requireRole } from '../../../shared/auth.js';
import { rowToDose, rowToLab, sanitizeDose, sanitizeLab, upsertStatement } from '../../../shared/records.js';

function parseId(context) {
  const id = context.params.id;
  if (typeof id !== 'string' || !id || id.length > 128) return null;
  return id;
}

async function findById(env, id) {
  const { results } = await env.DB.prepare('SELECT * FROM records WHERE id = ?').bind(id).all();
  return results[0] || null;
}

export const onRequestGet = async (context) => {
  const guard = requireRole(context);
  if (guard) return guard;
  const id = parseId(context);
  if (id === null) return json({ error: 'invalid_id' }, 400);
  const row = await findById(context.env, id);
  if (!row) return json({ error: 'not_found' }, 404);
  return json(row.kind === 'lab' ? rowToLab(row) : rowToDose(row));
};

// PUT /api/records/:id —— 整条覆盖（仅管理员）。kind 以库里的为准。
export const onRequestPut = async (context) => {
  const guard = requireRole(context, 'admin');
  if (guard) return guard;
  const id = parseId(context);
  if (id === null) return json({ error: 'invalid_id' }, 400);

  const existing = await findById(context.env, id);
  if (!existing) return json({ error: 'not_found' }, 404);

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }

  const parsed = existing.kind === 'lab'
    ? sanitizeLab({ ...body, id }, { id })
    : sanitizeDose({ ...body, id }, { id });
  if (parsed.error) return json({ error: parsed.error }, 400);

  const rec = parsed.record;
  rec.updated_at = Date.now();
  rec.created_at = existing.created_at;
  await upsertStatement(context.env.DB, rec).run();
  const updated = await findById(context.env, id);
  return json(updated.kind === 'lab' ? rowToLab(updated) : rowToDose(updated));
};

export const onRequestDelete = async (context) => {
  const guard = requireRole(context, 'admin');
  if (guard) return guard;
  const id = parseId(context);
  if (id === null) return json({ error: 'invalid_id' }, 400);

  const existing = await findById(context.env, id);
  if (!existing) return json({ error: 'not_found' }, 404);

  await context.env.DB.prepare('DELETE FROM records WHERE id = ?').bind(id).run();
  return json({ ok: true });
};
