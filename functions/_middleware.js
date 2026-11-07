import { verifyToken } from '../shared/auth.js';

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

export const onRequest = async (context) => {
  const cookies = parseCookies(context.request.headers.get('Cookie'));
  const token = cookies['myhrt_session'];
  const payload = await verifyToken(token, context.env.COOKIE_SECRET);
  context.data.role = payload ? payload.role : null;
  return context.next();
};
