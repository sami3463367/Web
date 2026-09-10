/**
 * Boighor BD — Merchant admin API
 * Dashboard analytics · order management · product listings · inventory · settings
 */
import path from 'node:path';
import { readdirSync } from 'node:fs';
import { Router } from '../core/router.js';
import { all, get, run, txBatch, getSettings, setSetting } from '../core/db.js';
import { readJson, HttpError } from '../core/http.js';
import { requireAdmin } from '../core/auth.js';
import { asNumber, asInt, oneOf, slugify, requireName } from '../core/validate.js';
import { PRODUCT_COLUMNS, PRODUCT_JOIN, parseProduct, toPublic } from '../lib/products.js';

const router = new Router();
router.add('GET', '/api/admin/*', requireAdmin);
router.add('POST', '/api/admin/*', requireAdmin);
router.add('PATCH', '/api/admin/*', requireAdmin);
router.add('DELETE', '/api/admin/*', requireAdmin);

/* ------------------------------- dashboard ------------------------------ */
router.get('/api/admin/stats', async (req, res) => {
  const money = (s) => `SUM(CASE WHEN o.status IN ('pending','confirmed','shipped','delivered') THEN ${s} ELSE 0 END)`;

  const totals = await get(`
    SELECT
      COALESCE(${money('o.total')},0)            AS revenue,
      COUNT(CASE WHEN o.status != 'cancelled' THEN 1 END) AS orders,
      COUNT(CASE WHEN o.status = 'pending'   THEN 1 END) AS pending,
      COUNT(CASE WHEN o.status = 'cancelled' THEN 1 END) AS cancelled
    FROM orders o`);

  const itemsAgg = await get(`
    SELECT COALESCE(SUM(oi.qty),0) AS units
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.status != 'cancelled'`);

  const daily = await all(`
    SELECT date(o.created_at) AS day,
           SUM(CASE WHEN o.status != 'cancelled' THEN o.total ELSE 0 END) AS revenue,
           COUNT(CASE WHEN o.status != 'cancelled' THEN 1 END) AS orders
    FROM orders o
    WHERE o.created_at >= datetime('now','-13 days')
    GROUP BY date(o.created_at)
    ORDER BY day`);

  const zoneSplit = await all(`
    SELECT zone, COUNT(*) AS orders, SUM(total) AS revenue
    FROM orders WHERE status != 'cancelled'
    GROUP BY zone`);

  const statusSplit = await all(`SELECT status, COUNT(*) AS count FROM orders GROUP BY status ORDER BY count DESC`);

  const topProducts = await all(`
    SELECT oi.product_id, oi.product_name AS name, SUM(oi.qty) AS units, SUM(oi.qty * oi.unit_price) AS revenue
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE o.status != 'cancelled'
    GROUP BY oi.product_id, oi.product_name
    ORDER BY units DESC LIMIT 5`);

  const lowStock = await all(`
    SELECT ${PRODUCT_COLUMNS} ${PRODUCT_JOIN}
    WHERE p.status = 'active' AND p.stock <= p.low_stock_at
    ORDER BY p.stock ASC LIMIT 8`);

  const inventory = await get(`SELECT COALESCE(SUM(stock),0) AS units, COUNT(*) AS skus,
                         COUNT(CASE WHEN stock = 0 THEN 1 END) AS out_of_stock
                         FROM products WHERE status='active'`);

  const recentOrders = await all(`SELECT * FROM orders ORDER BY created_at DESC, id DESC LIMIT 6`);

  const orders = Number(totals.orders) || 0;
  res.json(200, {
    kpis: {
      revenue: Math.round(Number(totals.revenue) || 0),
      orders,
      pending: Number(totals.pending) || 0,
      cancelled: Number(totals.cancelled) || 0,
      units: Number(itemsAgg.units) || 0,
      aov: orders ? Math.round((Number(totals.revenue) || 0) / orders) : 0,
      inventory_units: Number(inventory.units) || 0,
      skus: Number(inventory.skus) || 0,
      out_of_stock: Number(inventory.out_of_stock) || 0
    },
    daily,
    zone_split: zoneSplit,
    status_split: statusSplit,
    top_products: topProducts,
    low_stock: lowStock.map(toPublic),
    recent_orders: recentOrders
  });
});

/* --------------------------------- orders -------------------------------- */
router.get('/api/admin/orders', async (req, res) => {
  const q = req.url.searchParams;
  const where = ['1=1'];
  const params = [];
  const status = q.get('status');
  if (status && status !== 'all') { where.push('o.status = ?'); params.push(status); }
  const search = (q.get('q') || '').trim();
  if (search) {
    where.push('(o.code LIKE ? OR o.customer_name LIKE ? OR o.customer_phone LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  const page = Math.max(1, asInt(q.get('page'), 1));
  const per = 15;
  const total = (await get(`SELECT COUNT(*) AS c FROM orders o WHERE ${where.join(' AND ')}`, ...params)).c;
  const rows = await all(
    `SELECT o.*, (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS item_count
     FROM orders o WHERE ${where.join(' AND ')}
     ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`,
    ...params, per, (page - 1) * per
  );
  res.json(200, { items: rows, total, page, pages: Math.max(1, Math.ceil(total / per)) });
});

router.get('/api/admin/orders/:id', async (req, res) => {
  const order = await get('SELECT * FROM orders WHERE id = ?', asInt(req.params.id, 0));
  if (!order) throw new HttpError(404, 'Order not found');
  const items = await all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', order.id);
  res.json(200, { order, items });
});

router.patch('/api/admin/orders/:id', async (req, res) => {
  const body = await readJson(req);
  const status = oneOf(body.status, ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'], null);
  if (!status) throw new HttpError(422, 'Invalid order status');
  const id = asInt(req.params.id, 0);

  const order = await get('SELECT * FROM orders WHERE id = ?', id);
  if (!order) throw new HttpError(404, 'Order not found');
  if (order.status !== status) {
    const items = await all('SELECT product_id, qty FROM order_items WHERE order_id = ?', id);
    const wasCancelled = order.status === 'cancelled';
    const stmts = [];

    if (status === 'cancelled' && !wasCancelled) {
      for (const it of items) {
        if (it.product_id) stmts.push({ sql: 'UPDATE products SET stock = stock + ?, sold = MAX(0, sold - ?) WHERE id = ?', params: [it.qty, it.qty, it.product_id] });
      }
    }
    if (wasCancelled && status !== 'cancelled') {
      for (const it of items) {
        if (!it.product_id) continue;
        const p = await get('SELECT stock, name FROM products WHERE id = ?', it.product_id);
        if (!p || p.stock < it.qty) throw new HttpError(409, `Not enough stock to reopen this order (${p ? p.name : 'item'})`);
        stmts.push({ sql: 'UPDATE products SET stock = stock - ?, sold = sold + ? WHERE id = ?', params: [it.qty, it.qty, it.product_id] });
      }
    }
    stmts.push({ sql: `UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`, params: [status, id] });
    await txBatch(stmts);
  }

  const updated = await get('SELECT * FROM orders WHERE id = ?', id);
  const items = await all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', id);
  res.json(200, { order: updated, items });
});

/* -------------------------------- products ------------------------------- */
function validateProductPayload(body, partial = false) {
  const out = {};
  if (!partial || body.name !== undefined) out.name = requireName(body.name, 'name').slice(0, 140);
  if (!partial || body.price !== undefined) {
    out.price = Math.round(asNumber(body.price, -1));
    if (out.price < 0) throw new HttpError(422, 'Price must be zero or more', { field: 'price' });
  }
  if (body.compare_price !== undefined && body.compare_price !== null && body.compare_price !== '') {
    out.compare_price = Math.round(asNumber(body.compare_price, 0)) || null;
    if (out.compare_price && out.compare_price <= (out.price ?? 0)) out.compare_price = null;
  }
  if (body.summary !== undefined) out.summary = String(body.summary || '').trim().slice(0, 220);
  if (body.description !== undefined) out.description = String(body.description || '').trim().slice(0, 4000);
  if (body.stock !== undefined) out.stock = Math.max(0, asInt(body.stock, 0));
  if (body.low_stock_at !== undefined) out.low_stock_at = Math.max(0, asInt(body.low_stock_at, 5));
  if (body.status !== undefined) out.status = oneOf(body.status, ['active', 'draft', 'archived'], 'active');
  if (body.featured !== undefined) out.featured = body.featured ? 1 : 0;
  if (body.sizes !== undefined) out.sizes = JSON.stringify(Array.isArray(body.sizes) ? body.sizes.map((s) => String(s).trim()).filter(Boolean).slice(0, 12) : []);
  if (body.colors !== undefined) {
    const colors = Array.isArray(body.colors)
      ? body.colors.filter((c) => c && c.name).map((c) => ({ name: String(c.name).trim().slice(0, 30), hex: /^#[0-9a-fA-F]{6}$/.test(String(c.hex)) ? String(c.hex) : '#888888' })).slice(0, 8)
      : [];
    out.colors = JSON.stringify(colors);
  }
  if (body.images !== undefined) {
    const images = Array.isArray(body.images)
      ? body.images.filter((i) => i && typeof (i.s || i.l || i) === 'string')
          .map((i) => (typeof i === 'string' ? { s: i, l: i } : { s: i.s || i.l, l: i.l || i.s })).slice(0, 5)
      : [];
    out.images = JSON.stringify(images);
  }
  if (body.category_id !== undefined) out.category_id = asInt(body.category_id, 0);
  if (body.rating !== undefined) out.rating = Math.min(5, Math.max(0, asNumber(body.rating, 4.5)));
  if (body.rating_count !== undefined) out.rating_count = Math.max(0, asInt(body.rating_count, 0));
  return out;
}

router.get('/api/admin/products', async (req, res) => {
  const q = req.url.searchParams;
  const where = ['1=1'];
  const params = [];
  const status = q.get('status');
  if (status && status !== 'all') { where.push('p.status = ?'); params.push(status); }
  if (q.get('low') === '1') where.push('p.stock <= p.low_stock_at');
  const search = (q.get('q') || '').trim();
  if (search) { where.push('p.name LIKE ?'); params.push(`%${search}%`); }
  const rows = await all(
    `SELECT ${PRODUCT_COLUMNS} ${PRODUCT_JOIN} WHERE ${where.join(' AND ')} ORDER BY p.updated_at DESC, p.id DESC`,
    ...params
  );
  res.json(200, rows.map(parseProduct));
});

router.post('/api/admin/products', async (req, res) => {
  const body = await readJson(req);
  const data = validateProductPayload(body);
  if (!data.name || data.price === undefined || data.price < 0) throw new HttpError(422, 'Name and price are required');
  if (data.category_id !== undefined) {
    const cat = await get('SELECT id FROM categories WHERE id = ?', data.category_id);
    if (!cat) throw new HttpError(422, 'Unknown category', { field: 'category_id' });
  }
  let slug = slugify(body.slug || data.name);
  if (await get('SELECT id FROM products WHERE slug = ?', slug)) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
  const categoryId = data.category_id || (await get('SELECT id FROM categories ORDER BY sort LIMIT 1')).id;
  const result = await run(
    `INSERT INTO products(slug,category_id,name,summary,description,price,compare_price,images,sizes,colors,stock,low_stock_at,featured,status)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    slug, categoryId, data.name, data.summary || '', data.description || '', data.price,
    data.compare_price ?? null, data.images || '[]', data.sizes || '[]', data.colors || '[]',
    data.stock ?? 0, data.low_stock_at ?? 5, data.featured ?? 0, data.status ?? 'active'
  );
  res.json(201, parseProduct(await get(`SELECT ${PRODUCT_COLUMNS} ${PRODUCT_JOIN} WHERE p.id = ?`, Number(result.lastInsertRowid))));
});

router.patch('/api/admin/products/:id', async (req, res) => {
  const id = asInt(req.params.id, 0);
  const existing = await get('SELECT * FROM products WHERE id = ?', id);
  if (!existing) throw new HttpError(404, 'Product not found');
  const body = await readJson(req);
  const data = validateProductPayload(body, true);
  if (data.category_id !== undefined) {
    const cat = await get('SELECT id FROM categories WHERE id = ?', data.category_id);
    if (!cat) throw new HttpError(422, 'Unknown category', { field: 'category_id' });
  }
  const fields = Object.keys(data);
  if (!fields.length) throw new HttpError(422, 'Nothing to update');
  const sets = fields.map((f) => `${f} = ?`).join(', ');
  await run(`UPDATE products SET ${sets}, updated_at = datetime('now') WHERE id = ?`, ...fields.map((f) => data[f]), id);
  res.json(200, parseProduct(await get(`SELECT ${PRODUCT_COLUMNS} ${PRODUCT_JOIN} WHERE p.id = ?`, id)));
});

/** Fast inventory adjustment: {value} absolute or {delta} relative */
router.post('/api/admin/products/:id/stock', async (req, res) => {
  const id = asInt(req.params.id, 0);
  const body = await readJson(req);
  const product = await get('SELECT id, stock, name FROM products WHERE id = ?', id);
  if (!product) throw new HttpError(404, 'Product not found');
  let next;
  if (body.value !== undefined) next = Math.max(0, asInt(body.value, product.stock));
  else next = Math.max(0, product.stock + asInt(body.delta, 0));
  await run(`UPDATE products SET stock = ?, updated_at = datetime('now') WHERE id = ?`, next, id);
  res.json(200, { id, stock: next, name: product.name });
});

router.delete('/api/admin/products/:id', async (req, res) => {
  const id = asInt(req.params.id, 0);
  const existing = await get('SELECT id FROM products WHERE id = ?', id);
  if (!existing) throw new HttpError(404, 'Product not found');
  // Soft delete keeps order history & analytics intact.
  await run(`UPDATE products SET status = 'archived', updated_at = datetime('now') WHERE id = ?`, id);
  res.json(200, { ok: true });
});

router.post('/api/admin/products/:id/restore', async (req, res) => {
  const id = asInt(req.params.id, 0);
  await run(`UPDATE products SET status = 'active', updated_at = datetime('now') WHERE id = ? AND status = 'archived'`, id);
  res.json(200, { ok: true });
});

router.get('/api/admin/categories', async (req, res) => {
  res.json(200, await all('SELECT * FROM categories ORDER BY sort, name'));
});

/** Library of product imagery already on disk (keeps listings consistent). */
router.get('/api/admin/images', (req, res) => {
  const dir = path.join(process.cwd(), 'public', 'assets', 'img', 'p');
  let files = [];
  try { files = readdirSync(dir); } catch { files = []; }
  const bases = [...new Set(files.map((f) => f.replace(/-(480|800)\.webp$/, '')).filter((b) => b))];
  res.json(200, bases
    .filter((b) => files.includes(`${b}-480.webp`))
    .map((b) => ({ s: `/assets/img/p/${b}-480.webp`, l: `/assets/img/p/${b}-800.webp` })));
});

/* -------------------------------- settings ------------------------------- */
router.get('/api/admin/settings', (req, res) => {
  res.json(200, getSettings());
});

router.patch('/api/admin/settings', async (req, res) => {
  const body = await readJson(req);
  const allowed = ['shop_name', 'shop_tagline', 'whatsapp_number', 'delivery_dhaka', 'delivery_outside', 'free_delivery_over', 'announcement'];
  for (const key of allowed) {
    if (body[key] === undefined) continue;
    if (key === 'whatsapp_number') {
      const digits = String(body[key]).replace(/\D/g, '').slice(0, 15);
      await setSetting(key, digits);
    } else if (key.startsWith('delivery_') || key === 'free_delivery_over') {
      const n = Math.max(0, Math.round(asNumber(body[key], 0)));
      await setSetting(key, n);
    } else {
      await setSetting(key, String(body[key]).trim().slice(0, 200));
    }
  }
  res.json(200, getSettings());
});

export default router;
