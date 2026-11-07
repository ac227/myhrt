// 一次性工具：生成密码哈希字符串，用于存进 Pages secret。
// 用法：node scripts/hash-password.mjs '你的密码'
// 输出格式：pbkdf2_sha256$<iterations>$<salt_b64url>$<hash_b64url>
// 与 shared/auth.js 中 Web Crypto 的 PBKDF2-SHA256 对相同盐/迭代/密码产出相同字节，可互认。

import crypto from 'node:crypto';

const password = process.argv[2];
if (!password) {
  console.error('用法：node scripts/hash-password.mjs <密码>');
  process.exit(1);
}

const iterations = 100000;
const salt = crypto.randomBytes(16);
const hash = crypto.pbkdf2Sync(password, salt, iterations, 32, 'sha256');

const fmt = [
  'pbkdf2_sha256',
  iterations,
  salt.toString('base64url'),
  hash.toString('base64url'),
].join('$');

console.log(fmt);
