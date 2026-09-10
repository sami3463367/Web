/**
 * Boighor BD — Authentication (zero dependencies)
 * scrypt password hashing (Node native), opaque session tokens stored
 * as SHA-256 hashes, httpOnly SameSite=Lax cookies. Async (dual DB driver).
 */
import crypto from 'node:crypto';
import { get, run } from './db.js';
import { parseCookies, setCookie, HttpError } from './http.js';

const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 };
const SESSION_DAYS = 30;
export const SESSION_COOKIE = 'bd_session';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT_OPTS).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [algo, salt, hash] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const a = Buffer.from(hash, 'hex');
    const b = crypto.scryptSync(password, salt, 64, SCRYPT_OPTS);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const nowStamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

export async function createSession(res, userId) {
  const token = crypto.randomBytes(24).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString().replace('T', ' ').slice(0, 19);
  await run('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?,?,?)', sha256(token), userId, expires);
  setCookie(res, SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86400 });
  return token;
}

export async function destroySession(req, res) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) await run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
  setCookie(res, SESSION_COOKIE, '', { maxAge: 0 });
}

const PUBLIC_USER_SQL = `SELECT id, name, phone, email, address, role, created_at FROM users WHERE id = ?`;

/** Returns the signed-in user row or null. */
export async function currentUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const session = await get('SELECT s.user_id, s.expires_at FROM sessions s WHERE s.token_hash = ?', sha256(token));
  if (!session) return null;
  if (session.expires_at < nowStamp()) {
    await run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
    return null;
  }
  return (await get(PUBLIC_USER_SQL, session.user_id)) || null;
}

export async function requireUser(req) {
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, 'Please sign in to continue');
  return user;
}

export async function requireAdmin(req) {
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, 'Admin sign-in required');
  if (user.role !== 'admin') throw new HttpError(403, 'Admin access only');
  return user;
}

/* ------------------- brute-force throttle (in-memory) ------------------- */
const attempts = new Map(); // key -> {count, resetAt}
export function throttle(key, max = 12, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || rec.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  rec.count += 1;
  if (rec.count > max) throw new HttpError(429, 'Too many attempts — please wait a few minutes');
}

export async function purgeExpiredSessions() {
  await run(`DELETE FROM sessions WHERE expires_at < datetime('now')`);
}

export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, phone: u.phone, email: u.email, address: u.address, role: u.role, created_at: u.created_at };
}
