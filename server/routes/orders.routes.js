/**
 * Boighor BD — Order API · the WhatsApp conversion engine
 *
 * POST /api/orders  → validates against DB prices (never client prices),
 *                     reserves stock atomically, persists the order, then
 *                     returns the structured WhatsApp message + wa.me link.
 */
import { Router } from '../core/router.js';
import { all, get, run, tx, getSettings } from '../core/db.js';
import { readJson, HttpError } from '../core/http.js';
import { requireName, requireBdPhone, requireAddress, asInt, oneOf } from '../core/validate.js';
import { computeTotals, buildWhatsAppMessage, buildWhatsAppUrl, formatTaka } from '../lib/money.js';
import { currentUser, requireUser, throttle } from '../core/auth.js';

const router = new Router();

function nextOrderCode() {
  const d = new Date();
  const yy = String(d.getUTCFullYear()).slice(2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const row = get(`SELECT COUNT(*) AS c FROM orders WHERE code LIKE ?`, `BD-${yy}${mm}${dd}-%`);
  return `BD-${yy}${mm}${dd}-${String(row.c + 1).padStart(4, '0')}`;
}

const serializeOrder = (o, items) => ({
  id: o.id,
  code: o.code,
  status: o.status,
  zone: o.zone,
  subtotal: o.subtotal,
  delivery_fee: o.delivery_fee,
  discount: o.discount,
  total: o.total,
  customer: { name: o.customer_name, phone: o.customer_phone, address: o.customer_address },
  items: items.map((i) => ({
    product_id: i.product_id,
    name: i.product_name,
    variant: i.variant,
    qty: i.qty,
    unit_price: i.unit_price
  })),
  created_at: o.created_at
});

const itemsOf = (orderId) =>
  all('SELECT product_id, product_name, variant, qty, unit_price FROM order_items WHERE order_id=? ORDER BY id', orderId);

router.post('/api/orders', async (req, res) => {
  throttle(`order:${req.ip}`, 20, 10 * 60 * 1000);
  const body = await readJson(req);
  const user = currentUser(req);

  const customer_name = requireName(body.name);
  const customer_phone = requireBdPhone(body.phone);
  const customer_address = requireAddress(body.address);
  const zone = oneOf(body.zone, ['dhaka', 'outside'], 'dhaka');
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 300) : null;

  const lines = Array.isArray(body.items) ? body.items : [];
  if (!lines.length) throw new HttpError(422, 'Your cart is empty');
  if (lines.length > 30) throw new HttpError(422, 'Too many items in one order');

  const settings = getSettings();

  const order = tx(() => {
    const resolved = [];
    for (const line of lines) {
      const productId = asInt(line.product_id, 0);
      const qty = Math.min(20, Math.max(1, asInt(line.qty, 0)));
      const product = get(
        `SELECT id, name, price, stock, status, sizes, colors FROM products WHERE id = ?`,
        productId
      );
      if (!product || product.status !== 'active') throw new HttpError(409, 'An item in your cart is no longer available');
      if (product.stock < qty) {
        throw new HttpError(409, `Only ${product.stock} left of "${product.name}" — please adjust quantity`, { field: 'stock', product: product.name, stock: product.stock });
      }
      const sizes = JSON.parse(product.sizes || '[]');
      const colors = JSON.parse(product.colors || '[]');
      const size = sizes.length ? String(line.size || sizes[0]) : '';
      const color = colors.length ? String(line.color || colors[0].name) : '';
      const variant = [size, color].filter(Boolean).join(' / ');

      run("UPDATE products SET stock = stock - ?, sold = sold + ?, updated_at = datetime('now') WHERE id = ? AND stock >= ?", qty, qty, productId, qty);
      resolved.push({ product, qty, variant, unitPrice: product.price });
    }

    const totals = computeTotals(resolved.map((r) => ({ unitPrice: r.unitPrice, qty: r.qty })), zone, settings);
    const code = nextOrderCode();
    const result = run(
      `INSERT INTO orders(code,user_id,customer_name,customer_phone,customer_address,zone,subtotal,delivery_fee,discount,total,status,note,channel)
       VALUES(?,?,?,?,?,?,?,?,?,?, 'pending', ?, 'whatsapp')`,
      code, user ? user.id : null, customer_name, customer_phone, customer_address, zone,
      totals.subtotal, totals.delivery_fee, totals.discount, totals.total, note
    );
    const orderId = Number(result.lastInsertRowid);
    for (const r of resolved) {
      run(
        'INSERT INTO order_items(order_id,product_id,product_name,variant,qty,unit_price) VALUES(?,?,?,?,?,?)',
        orderId, r.product.id, r.product.name, r.variant, r.qty, r.unitPrice
      );
    }
    return get('SELECT * FROM orders WHERE id=?', orderId);
  });

  const items = itemsOf(order.id);
  const message = buildWhatsAppMessage(order, items, settings);
  const wa_url = buildWhatsAppUrl(message, settings);

  res.json(201, {
    order: serializeOrder(order, items),
    message,
    wa_url,
    whatsapp_configured: Boolean(String(settings.whatsapp_number || '').replace(/\D/g, ''))
  });
});

/** Signed-in customer's order history */
router.get('/api/orders', (req, res) => {
  const user = requireUser(req);
  const rows = all('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 50', user.id);
  res.json(200, rows.map((o) => serializeOrder(o, itemsOf(o.id))));
});

/** Guest lookup: order code + phone used at checkout */
router.post('/api/orders/lookup', async (req, res) => {
  throttle(`lookup:${req.ip}`, 15);
  const body = await readJson(req);
  const code = String(body.code || '').trim().toUpperCase();
  const phone = requireBdPhone(body.phone);
  const order = get('SELECT * FROM orders WHERE code = ? AND customer_phone = ?', code, phone);
  if (!order) throw new HttpError(404, 'No order found with that code and mobile number');
  res.json(200, serializeOrder(order, itemsOf(order.id)));
});

export { serializeOrder, itemsOf, formatTaka };
export default router;
