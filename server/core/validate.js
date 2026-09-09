/**
 * Boighor BD — Input validation & normalisation (zero dependencies)
 * Bangladeshi phone numbers, addresses, slugs, prices.
 */
import { HttpError } from './http.js';

const str = (v, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '');

/** Accepts 01XXXXXXXXX, +8801XXXXXXXXX, 8801XXXXXXXXX → returns 01XXXXXXXXX */
export function normalizeBdPhone(raw) {
  let p = str(raw, 20).replace(/[\s\-()]/g, '');
  if (p.startsWith('+880')) p = '0' + p.slice(4);
  else if (p.startsWith('880')) p = '0' + p.slice(3);
  return p;
}

export function isValidBdPhone(p) {
  return /^01[3-9]\d{8}$/.test(p);
}

export function requireBdPhone(raw, field = 'phone') {
  const p = normalizeBdPhone(raw);
  if (!isValidBdPhone(p)) {
    throw new HttpError(422, `Enter a valid Bangladeshi mobile number (e.g. 01712345678)`, { field });
  }
  return p;
}

export function requireName(raw, field = 'name') {
  const v = str(raw, 80);
  if (v.length < 2) throw new HttpError(422, 'Please enter your full name', { field });
  return v;
}

export function requireAddress(raw, field = 'address') {
  const v = str(raw, 300);
  if (v.length < 8) throw new HttpError(422, 'Please enter a complete delivery address', { field });
  return v;
}

export function optionalEmail(raw) {
  const v = str(raw, 120).toLowerCase();
  if (!v) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) throw new HttpError(422, 'Email address looks invalid', { field: 'email' });
  return v;
}

export function requirePassword(raw) {
  const v = typeof raw === 'string' ? raw : '';
  if (v.length < 6) throw new HttpError(422, 'Password must be at least 6 characters', { field: 'password' });
  if (v.length > 128) throw new HttpError(422, 'Password is too long', { field: 'password' });
  return v;
}

export function asNumber(raw, fallback = 0) {
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^\d.\-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

export function asInt(raw, fallback = 0) {
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : fallback;
}

export function slugify(s) {
  return str(s, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || `item-${Date.now().toString(36)}`;
}

export function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}
