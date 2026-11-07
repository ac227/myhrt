import { json } from '../../shared/auth.js';

export const onRequestPost = async () => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'myhrt_session=; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=0',
    },
  });
};
