import { json, requireRole } from '../../shared/auth.js';
import { collectImport, sanitizeDose, sanitizeLab, upsertStatement } from '../../shared/records.js';

// POST /api/import —— 按 id 合并。较新的 updatedAt 覆盖旧的；tombstone 删除更早的记录。
export const onRequestPost = async (context) => {
  const guard = requireRole(context, 'admin');
  if (guard) return guard;

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }

  const collected = collectImport(body);
  if (collected.error) return json({ error: collected.error }, 400);

  const statements = [];
  let skipped = 0;

  const take = (parsed) => {
    if (parsed.error) return parsed.error;
    statements.push(upsertStatement(context.env.DB, parsed.record));
    return null;
  };

  for (const item of collected.doses) {
    const err = take(sanitizeDose(item));
    if (err) return json({ error: err }, 400);
  }
  for (const item of collected.labs) {
    const err = take(sanitizeLab(item));
    if (err) return json({ error: err }, 400);
  }

  if (statements.length) await context.env.DB.batch(statements);

  const deletions = [
    ...Object.entries(collected.deletions.dose),
    ...Object.entries(collected.deletions.lab),
  ];
  let removed = 0;
  for (const [id, at] of deletions) {
    const info = await context.env.DB.prepare(
      'DELETE FROM records WHERE id = ? AND updated_at <= ?',
    ).bind(id, at).run();
    removed += info.meta.changes || 0;
  }

  return json({ ok: true, count: statements.length, skipped, removed });
};
