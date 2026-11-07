// 共享鉴权工具：PBKDF2 密码校验 + HMAC 签名 Cookie + 角色守卫。
// 运行于 Pages Functions（Web Crypto 可用）。

const enc = new TextEncoder();
const dec = new TextDecoder();

function base64url(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBytes(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// 常数时间比较（Web Crypto 无内置 timingSafeEqual）
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// ---- 密码校验（PBKDF2-SHA256）----
// stored 格式：pbkdf2_sha256$<iterations>$<salt_b64url>$<hash_b64url>
export async function verifyPassword(password, stored) {
  if (!password || !stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  const salt = base64urlToBytes(parts[2]);
  const expected = base64urlToBytes(parts[3]);
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    expected.length * 8,
  );
  return timingSafeEqual(new Uint8Array(bits), expected);
}

// ---- HMAC 签名 Cookie ----
async function getHmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signToken(payloadObj, secret) {
  const payload = base64url(enc.encode(JSON.stringify(payloadObj)));
  const key = await getHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return `${payload}.${base64url(sig)}`;
}

export async function verifyToken(token, secret) {
  if (!token || !secret) return null;
  const dot = token.indexOf('.');
  if (dot === -1) return null;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  if (!payloadB64 || !sigB64) return null;
  try {
    const key = await getHmacKey(secret);
    const sigBytes = base64urlToBytes(sigB64);
    // HMAC 对象是 base64url 载荷字符串本身，而非解码后的字节
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payloadB64));
    if (!valid) return null;
    const payload = JSON.parse(dec.decode(base64urlToBytes(payloadB64)));
    if (typeof payload.exp === 'number' && payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---- 角色守卫 ----
// requireRole(ctx)         —— 任意已登录用户（未登录返回 401）
// requireRole(ctx, 'admin')—— 仅管理员（访客返回 403）
export function requireRole(context, role) {
  const current = context.data && context.data.role;
  if (!current) {
    return json({ error: 'unauthorized' }, 401);
  }
  if (role && current !== role) {
    return json({ error: 'forbidden' }, 403);
  }
  return null;
}
