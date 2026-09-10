/**
 * Boighor BD — Database layer (dual driver, zero paid services)
 * ------------------------------------------------------------------
 *  • local / preview / tests  → embedded `node:sqlite` (single file, free)
 *  • Vercel / serverless      → Turso (libsql) over HTTP when TURSO_URL is set
 *
 * The whole app speaks one tiny async API: all() get() run() txBatch() batch().
 * On SQLite, transactions are BEGIN/COMMIT; on Turso they are a single atomic
 * Hrana pipeline ([begin,…,commit]) — same statement lists work on both, and
 * later statements may use last_insert_rowid() to reference earlier inserts.
 *
 * All queries are parameterised — raw interpolation never touches SQL.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { libsqlConfigured, libsqlExecute, libsqlTransaction, libsqlBatch } from './libsql.js';

export const DRIVER = libsqlConfigured() ? 'libsql' : 'sqlite';

/* ------------------------------- sqlite driver ------------------------------ */
/* createRequire keeps node:sqlite lazy so serverless bundles that never use it
   don't pay for it at import time */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let sqliteDb = null;
function sq() {
  if (!sqliteDb) {
    const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    mkdirSync(DATA_DIR, { recursive: true });
    const { DatabaseSync } = require('node:sqlite');
    sqliteDb = new DatabaseSync(path.join(DATA_DIR, 'shop.db'));
    sqliteDb.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous  = NORMAL;
      PRAGMA foreign_keys = ON;
    `);
  }
  return sqliteDb;
}

/* --------------------------------- schema --------------------------------- */
const SCHEMA = `
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
  images       TEXT NOT NULL DEFAULT '[]',
  sizes        TEXT NOT NULL DEFAULT '[]',
  colors       TEXT NOT NULL DEFAULT '[]',
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
);`;

let schemaReady = false;
export async function ensureSchema() {
  if (schemaReady) return;
  if (DRIVER === 'sqlite') {
    sq().exec(SCHEMA);
  } else {
    for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
      await libsqlExecute(stmt);
    }
  }
  schemaReady = true;
}

/* ------------------------------ unified API ------------------------------ */
export async function all(sql, ...params) {
  if (DRIVER === 'sqlite') return sq().prepare(sql).all(...params);
  return (await libsqlExecute(sql, params)).rows;
}

export async function get(sql, ...params) {
  if (DRIVER === 'sqlite') return sq().prepare(sql).get(...params);
  const rows = (await libsqlExecute(sql, params)).rows;
  return rows[0] || undefined;
}

export async function run(sql, ...params) {
  if (DRIVER === 'sqlite') {
    const r = sq().prepare(sql).run(...params);
    return { lastInsertRowid: Number(r.lastInsertRowid), changes: Number(r.changes) };
  }
  const r = await libsqlExecute(sql, params);
  return { lastInsertRowid: r.lastInsertRowid, changes: r.changes };
}

/**
 * Atomic transaction from a statement list.
 * @param {{sql:string, params?:any[]}[]} stmts
 * @returns {Promise<{rows:any[],changes:number,lastInsertRowid:number}[]>}
 */
export async function txBatch(stmts) {
  if (!stmts.length) return [];
  if (DRIVER === 'sqlite') {
    const db = sq();
    db.exec('BEGIN');
    try {
      const out = stmts.map((s) => {
        const r = db.prepare(s.sql).run(...(s.params || []));
        return { rows: [], changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
      });
      db.exec('COMMIT');
      return out;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return libsqlTransaction(stmts.map((s) => ({ sql: s.sql, params: s.params || [] })));
}

/** Atomic chunked batch (seeding, bulk writes) — no id chaining inside. */
export async function batch(stmts) {
  if (!stmts.length) return [];
  if (DRIVER === 'sqlite') return txBatch(stmts);
  return libsqlBatch(stmts.map((s) => ({ sql: s.sql, params: s.params || [] })));
}

/* --------------------------- settings (KV cache) --------------------------- */
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

let settingsCache = null;

function normalise(raw) {
  const out = { ...SETTINGS_DEFAULTS, ...raw };
  out.delivery_dhaka = Number(out.delivery_dhaka) || 0;
  out.delivery_outside = Number(out.delivery_outside) || 0;
  out.free_delivery_over = Number(out.free_delivery_over) || 0;
  return out;
}

/** Synchronous getter (reads the in-process cache). Call loadSettings() at boot. */
export function getSettings() {
  if (!settingsCache) settingsCache = normalise({});
  return settingsCache;
}

export async function loadSettings() {
  const rows = await all('SELECT key, value FROM settings');
  const raw = {};
  for (const r of rows) raw[r.key] = r.value;
  settingsCache = normalise(raw);
  return settingsCache;
}

export async function setSetting(key, value) {
  await run(
    `INSERT INTO settings(key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key, String(value)
  );
  await loadSettings();
}

export async function seedSettingsIfEmpty() {
  const row = await get('SELECT COUNT(*) AS c FROM settings');
  if ((row?.c || 0) > 0) { await loadSettings(); return; }
  if (DRIVER === 'sqlite') {
    await batch(Object.entries(SETTINGS_DEFAULTS).map(([k, v]) => ({
      sql: 'INSERT INTO settings(key, value) VALUES (?, ?)', params: [k, v]
    })));
  } else {
    for (const [k, v] of Object.entries(SETTINGS_DEFAULTS)) {
      await run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, v);
    }
  }
  await loadSettings();
}
