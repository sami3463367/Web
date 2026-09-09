/**
 * Boighor BD — Database layer
 * ------------------------------------------------------------------
 * Built on Node's native `node:sqlite` (no external DB server, no ORM,
 * no npm package). The database is a single SQLite file in ./data and
 * ships with every free-tier host (Render, Railway, Fly.io, a $5 VPS).
 *
 * Everything is parameterised — raw string interpolation never touches SQL.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const DB_PATH = path.join(DATA_DIR, 'shop.db');

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous  = NORMAL;
  PRAGMA foreign_keys = ON;
`);

/* ------------------------------------------------------------------ *
 *  Schema (idempotent migrations)
 * ------------------------------------------------------------------ */
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  phone         TEXT    NOT NULL UNIQUE,
  email         TEXT    UNIQUE,
  password_hash TEXT    NOT NULL,
  address       TEXT    NOT NULL DEFAULT '',
  role          TEXT    NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS categories (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  slug  TEXT NOT NULL UNIQUE,
  name  TEXT NOT NULL,
  icon  TEXT NOT NULL DEFAULT '🛍️',
  sort  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,
  category_id  INTEGER NOT NULL REFERENCES categories(id),
  name         TEXT NOT NULL,
  summary      TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  price        REAL NOT NULL CHECK (price >= 0),
  compare_price REAL,
  images       TEXT NOT NULL DEFAULT '[]',   -- JSON array of {s: src480, l: src800}
  sizes        TEXT NOT NULL DEFAULT '[]',   -- JSON array of strings
  colors       TEXT NOT NULL DEFAULT '[]',   -- JSON array of {name, hex}
  stock        INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  low_stock_at INTEGER NOT NULL DEFAULT 5,
  rating       REAL NOT NULL DEFAULT 4.5,
  rating_count INTEGER NOT NULL DEFAULT 0,
  sold         INTEGER NOT NULL DEFAULT 0,
  featured     INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','draft','archived')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_status   ON products(status);

CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  code           TEXT NOT NULL UNIQUE,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  customer_name  TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_address TEXT NOT NULL,
  zone           TEXT NOT NULL DEFAULT 'dhaka' CHECK (zone IN ('dhaka','outside')),
  subtotal       REAL NOT NULL,
  delivery_fee   REAL NOT NULL,
  discount       REAL NOT NULL DEFAULT 0,
  total          REAL NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','confirmed','shipped','delivered','cancelled')),
  note           TEXT,
  channel        TEXT NOT NULL DEFAULT 'whatsapp',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  variant      TEXT NOT NULL DEFAULT '',
  qty          INTEGER NOT NULL CHECK (qty > 0),
  unit_price   REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

/* ------------------------------------------------------------------ *
 *  Tiny query helpers
 * ------------------------------------------------------------------ */
export const all = (sql, ...params) => db.prepare(sql).all(...params);
export const get = (sql, ...params) => db.prepare(sql).get(...params);
export const run = (sql, ...params) => db.prepare(sql).run(...params);

/** Run `fn` inside a transaction; rolls back on throw. */
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Key/value settings with in-process cache. */
const SETTINGS_DEFAULTS = {
  shop_name: 'Boighor BD',
  shop_tagline: 'Premium picks, delivered across Bangladesh',
  whatsapp_number: '',            // e.g. 8801712345678 — leave empty in demo mode
  delivery_dhaka: '80',
  delivery_outside: '150',
  free_delivery_over: '0',        // 0 = disabled
  announcement: '🎉 Eid Collection live — Cash on Delivery available nationwide',
  currency: '৳'
};

export function getSettings() {
  const rows = all('SELECT key, value FROM settings');
  const out = { ...SETTINGS_DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  out.delivery_dhaka = Number(out.delivery_dhaka) || 0;
  out.delivery_outside = Number(out.delivery_outside) || 0;
  out.free_delivery_over = Number(out.free_delivery_over) || 0;
  return out;
}

export function setSetting(key, value) {
  run(
    `INSERT INTO settings(key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key, String(value)
  );
}

export function seedSettingsIfEmpty() {
  const count = get('SELECT COUNT(*) AS c FROM settings').c;
  if (count > 0) return;
  for (const [k, v] of Object.entries(SETTINGS_DEFAULTS)) setSetting(k, v);
}
