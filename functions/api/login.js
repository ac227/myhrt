import { json, signToken, verifyPassword } from '../../shared/auth.js';

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 天

export const onRequestPost = async (context) => {
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }

  const { role, password } = body || {};
  if ((role !== 'admin' && role !== 'guest') || typeof password !== 'string') {
    return json({ error: 'invalid_request' }, 400);
  }

  const stored = role === 'admin' ? context.env.ADMIN_PASSWORD_HASH : context.env.GUEST_PASSWORD_HASH;
  const ok = await verifyPassword(password, stored);
  if (!ok) return json({ error: 'invalid_credentials' }, 401);

  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const token = await signToken({ role, exp }, context.env.COOKIE_SECRET);

  return new Response(JSON.stringify({ role }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': `myhrt_session=${token}; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=${SESSION_TTL_SECONDS}`,
    },
  });
};
