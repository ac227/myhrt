import { json } from '../../shared/auth.js';

export const onRequestGet = async (context) => {
  return json({ role: context.data.role || null });
};
