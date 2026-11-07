import { json, requireRole } from '../../shared/auth.js';
import { rowToDose, rowToLab } from '../../shared/records.js';

// GET /api/export —— 全量备份，仅管理员。
export const onRequestGet = async (context) => {
  const guard = requireRole(context, 'admin');
  if (guard) return guard;

  const { results } = await context.env.DB.prepare(
    'SELECT * FROM records ORDER BY time_h ASC, id ASC',
  ).all();

  const events = [];
  const labResults = [];
  for (const row of results) {
    if (row.kind === 'lab') labResults.push(rowToLab(row));
    else events.push(rowToDose(row));
  }
  return json({ version: 2, events, labResults });
};
