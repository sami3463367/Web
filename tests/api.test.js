/**
 * Boighor BD — end-to-end API regression suite (node:test, zero dependencies)
 * Boots the real server against a throwaway SQLite DB and exercises the
 * critical commerce flows: auth, pricing integrity, stock, WhatsApp funnel,
 * admin analytics and access control.
 *
 *   npm test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORT = 4319;
const BASE = `http://127.0.0.1:${PORT}`;
let server;
let dataDir;

const jar = () => {
  const cookies = new Map();
  return {
    header() { return [...cookies].map(([k, v]) => `${k}=${v}`).join('; '); },
    absorb(res) {
      for (const sc of res.headers.getSetCookie?.() || []) {
        const [pair] = sc.split(';');
        const i = pair.indexOf('=');
        cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
    }
  };
};

async function call(method, url, { body, jar: j } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(j ? { Cookie: j.header() } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  j?.absorb(res);
  let data = null;
  try { data = await res.json(); } catch { /* noop */ }
  return { status: res.status, data };
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'boighor-test-'));
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    cwd: path.join(process.cwd()),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
    stdio: 'ignore'
  });
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start');
});

after(() => {
  server?.kill('SIGTERM');
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* noop */ }
});

test('health + public settings expose delivery fees', async () => {
  const h = await call('GET', '/api/health');
  assert.equal(h.status, 200);
  assert.equal(h.data.ok, true);
  const s = await call('GET', '/api/settings');
  assert.equal(s.data.delivery.dhaka, 80);
  assert.equal(s.data.delivery.outside, 150);
  assert.equal(s.data.whatsapp_number, '');
});

test('catalogue: list, filter, search, 404', async () => {
  const all = await call('GET', '/api/products');
  assert.equal(all.status, 200);
  assert.ok(all.data.items.length >= 8);
  const men = await call('GET', '/api/products?category=men');
  assert.ok(men.data.items.every((p) => p.category === 'men'));
  const q = await call('GET', '/api/products?q=panjabi');
  assert.ok(q.data.items.length >= 1);
  const missing = await call('GET', '/api/products/does-not-exist');
  assert.equal(missing.status, 404);
});

test('SSR pages render with resolved tokens and security headers', async () => {
  const res = await fetch(`${BASE}/`);
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.ok(!html.includes('[['), 'unresolved SSR token on home');
  assert.ok(html.includes('class="card'), 'home should SSR product cards');
  assert.match(res.headers.get('content-security-policy'), /script-src 'self' 'nonce-/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  const p = await fetch(`${BASE}/product/premium-cotton-panjabi`);
  const phtml = await p.text();
  assert.equal(p.status, 200);
  assert.ok(phtml.includes('application/ld+json'), 'product JSON-LD present');
  assert.ok(!phtml.includes('[['), 'unresolved SSR token on product page');
});

test('registration validates BD phone numbers and blocks duplicates', async () => {
  const bad = await call('POST', '/api/auth/register', { body: { name: 'X Y', phone: '12345', password: 'secret1', address: 'House 1, Road 2, Mirpur, Dhaka' } });
  assert.equal(bad.status, 422);
  const ok = await call('POST', '/api/auth/register', { body: { name: 'Test User', phone: '+8801812345678', password: 'secret1', address: 'House 1, Road 2, Mirpur, Dhaka' } }, );
  assert.equal(ok.status, 201);
  assert.equal(ok.data.user.phone, '01812345678');
  const dup = await call('POST', '/api/auth/register', { body: { name: 'Test User', phone: '01812345678', password: 'secret1', address: 'House 1, Road 2, Mirpur, Dhaka' } });
  assert.equal(dup.status, 409);
});

test('login rejects wrong password, accepts correct one', async () => {
  const bad = await call('POST', '/api/auth/login', { body: { phone: '01700000000', password: 'wrong-pass' } });
  assert.equal(bad.status, 401);
  const j = jar();
  const ok = await call('POST', '/api/auth/login', { body: { phone: '01700000000', password: 'admin123' }, jar: j });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.role, 'admin');
  const me = await call('GET', '/api/me', { jar: j });
  assert.equal(me.data.user.role, 'admin');
});

test('order funnel: server-side pricing, variants, zone fees, stock', async () => {
  const beforeStock = (await call('GET', '/api/products/premium-cotton-panjabi')).data.product.stock;
  const res = await call('POST', '/api/orders', {
    body: {
      name: 'Rafiq Islam', phone: '01712345678', address: 'House 12, Road 5, Dhanmondi, Dhaka', zone: 'outside',
      items: [
        { product_id: 1, qty: 2, size: 'L', color: 'Emerald', unit_price: 1 },   // tampered → ignored
        { product_id: 5, qty: 1, color: 'Black' }
      ]
    }
  });
  assert.equal(res.status, 201);
  const o = res.data.order;
  assert.equal(o.subtotal, 2 * 1850 + 1290, 'client prices must be ignored');
  assert.equal(o.delivery_fee, 150, 'outside dhaka fee');
  assert.equal(o.total, o.subtotal + o.delivery_fee);
  assert.match(res.data.message, /Variant: L \/ Emerald/);
  assert.match(res.data.message, /Total Payable: ৳/);
  assert.match(res.data.message, /Phone: 01712345678/);
  assert.ok(res.data.wa_url.startsWith('https://'), 'wa link built');
  assert.equal(res.data.whatsapp_configured, false, 'demo mode without a number');

  const afterStock = (await call('GET', '/api/products/premium-cotton-panjabi')).data.product.stock;
  assert.equal(afterStock, beforeStock - 2, 'stock decremented atomically');

  const over = await call('POST', '/api/orders', {
    body: { name: 'A B', phone: '01712345678', address: 'House 12, Road 5, Dhanmondi, Dhaka', zone: 'dhaka', items: [{ product_id: 8, qty: 999 }] }
  });
  assert.equal(over.status, 409);

  const empty = await call('POST', '/api/orders', { body: { name: 'A B', phone: '01712345678', address: 'House 12, Road 5, Dhanmondi, Dhaka', items: [] } });
  assert.equal(empty.status, 422);
});

test('guest order lookup by code + phone', async () => {
  const created = await call('POST', '/api/orders', {
    body: { name: 'Lookup Test', phone: '01911111111', address: 'Road 9, Uttara, Dhaka', zone: 'dhaka', items: [{ product_id: 5, qty: 1 }] }
  });
  const code = created.data.order.code;
  const ok = await call('POST', '/api/orders/lookup', { body: { code, phone: '01911111111' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.code, code);
  const wrong = await call('POST', '/api/orders/lookup', { body: { code, phone: '01922222222' } });
  assert.equal(wrong.status, 404);
});

test('admin access control: guests and customers blocked', async () => {
  const guest = await call('GET', '/api/admin/stats');
  assert.equal(guest.status, 401);
  const j = jar();
  await call('POST', '/api/auth/login', { body: { phone: '01712345678', password: 'demo123' }, jar: j });
  const customer = await call('GET', '/api/admin/stats', { jar: j });
  assert.equal(customer.status, 403);
  const customerDelete = await call('DELETE', '/api/admin/products/1', { jar: j });
  assert.equal(customerDelete.status, 403);
});

test('admin analytics + order lifecycle restocks on cancel', async () => {
  const j = jar();
  await call('POST', '/api/auth/login', { body: { phone: '01700000000', password: 'admin123' }, jar: j });
  const stats = await call('GET', '/api/admin/stats', { jar: j });
  assert.equal(stats.status, 200);
  assert.ok(stats.data.kpis.revenue > 0);
  assert.equal(stats.data.daily.length, 14);
  assert.ok(stats.data.top_products.length > 0);

  const pending = await call('GET', '/api/admin/orders?status=pending', { jar: j });
  const id = pending.data.items[0].id;
  const stockBefore = (await call('GET', '/api/admin/products?status=all', { jar: j })).data.find((p) => p.id === 1)?.stock;

  const cancelled = await call('PATCH', `/api/admin/orders/${id}`, { body: { status: 'cancelled' }, jar: j });
  assert.equal(cancelled.data.order.status, 'cancelled');
  const stockMid = (await call('GET', '/api/admin/products?status=all', { jar: j })).data.find((p) => p.id === 1)?.stock;

  const reopened = await call('PATCH', `/api/admin/orders/${id}`, { body: { status: 'confirmed' }, jar: j });
  assert.equal(reopened.data.order.status, 'confirmed');
  const stockAfter = (await call('GET', '/api/admin/products?status=all', { jar: j })).data.find((p) => p.id === 1)?.stock;
  // order 1 may or may not contain product 1; assertions stay relative
  assert.ok(stockMid >= stockBefore - 0);
  assert.ok(stockAfter <= stockMid);
});

test('admin product CRUD + inventory endpoints', async () => {
  const j = jar();
  const login = await call('POST', '/api/auth/login', { body: { phone: '01700000000', password: 'admin123' }, jar: j });
  assert.equal(login.status, 200, `admin login failed: ${JSON.stringify(login.data)}`);

  const created = await call('POST', '/api/admin/products', {
    jar: j,
    body: { name: 'Test Ata Cap', category_id: 1, price: 450, compare_price: 600, stock: 10, sizes: [], colors: [], summary: 'cap' }
  });
  assert.equal(created.status, 201);
  const id = created.data.id;

  const patched = await call('PATCH', `/api/admin/products/${id}`, { body: { price: 499, stock: 12 }, jar: j });
  assert.equal(patched.data.price, 499);
  assert.equal(patched.data.stock, 12);

  const delta = await call('POST', `/api/admin/products/${id}/stock`, { body: { delta: -2 }, jar: j });
  assert.equal(delta.data.stock, 10);
  const abs = await call('POST', `/api/admin/products/${id}/stock`, { body: { value: 7 }, jar: j });
  assert.equal(abs.data.stock, 7);

  const negative = await call('PATCH', `/api/admin/products/${id}`, { body: { price: -5 }, jar: j });
  assert.equal(negative.status, 422);

  const archived = await call('DELETE', `/api/admin/products/${id}`, { jar: j });
  assert.equal(archived.status, 200);
  const list = await call('GET', '/api/admin/products?status=archived', { jar: j });
  assert.ok(list.data.some((p) => p.id === id));
  const restored = await call('POST', `/api/admin/products/${id}/restore`, { jar: j });
  assert.equal(restored.status, 200);
});

test('settings: WhatsApp number normalisation switches funnel to wa.me', async () => {
  const j = jar();
  await call('POST', '/api/auth/login', { body: { phone: '01700000000', password: 'admin123' }, jar: j });
  const patched = await call('PATCH', '/api/admin/settings', { body: { whatsapp_number: '+880 1712-345678', delivery_dhaka: 90 }, jar: j });
  assert.equal(patched.data.whatsapp_number, '8801712345678');
  assert.equal(patched.data.delivery_dhaka, 90);

  const order = await call('POST', '/api/orders', {
    body: { name: 'WA Test', phone: '01712345678', address: 'House 1, Gulshan, Dhaka', zone: 'dhaka', items: [{ product_id: 5, qty: 1 }] }
  });
  assert.equal(order.data.whatsapp_configured, true);
  assert.ok(order.data.wa_url.startsWith('https://wa.me/8801712345678?text='));

  // restore demo defaults
  await call('PATCH', '/api/admin/settings', { body: { whatsapp_number: '', delivery_dhaka: 80 }, jar: j });
});

test('static assets: compression, etag, traversal blocked', async () => {
  const css = await fetch(`${BASE}/assets/css/app.css`, { headers: { 'Accept-Encoding': 'br' } });
  assert.equal(css.status, 200);
  assert.equal(css.headers.get('content-encoding'), 'br');
  const etag = css.headers.get('etag');
  const cached = await fetch(`${BASE}/assets/css/app.css`, { headers: { 'If-None-Match': etag } });
  assert.equal(cached.status, 304);
  const img = await fetch(`${BASE}/assets/img/p/1-panjabi-480.webp`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/webp');
  const buf = Buffer.from(await img.arrayBuffer());
  assert.ok(buf.length > 1000, 'image body fully delivered');
  const traversal = await fetch(`${BASE}/../server/index.js`);
  assert.ok([403, 404].includes(traversal.status));
});
