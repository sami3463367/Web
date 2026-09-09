/**
 * Boighor BD — Public storefront API
 */
import { Router } from '../core/router.js';
import { all, get, getSettings } from '../core/db.js';
import { toPublic, PRODUCT_COLUMNS, PRODUCT_JOIN } from '../lib/products.js';
import { HttpError } from '../core/http.js';

const router = new Router();

router.get('/api/health', (req, res) => {
  res.json(200, { ok: true, service: 'boighor-bd', time: new Date().toISOString() });
});

/** Public shop settings the storefront needs (delivery fees, WA number…). */
router.get('/api/settings', (req, res) => {
  const s = getSettings();
  res.json(200, {
    shop_name: s.shop_name,
    shop_tagline: s.shop_tagline,
    announcement: s.announcement,
    whatsapp_number: s.whatsapp_number,
    delivery: { dhaka: s.delivery_dhaka, outside: s.delivery_outside, free_over: s.free_delivery_over },
    currency: s.currency
  });
});

router.get('/api/categories', (req, res) => {
  const rows = all(
    `SELECT c.id, c.slug, c.name, c.icon, c.sort,
            (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.status='active') AS product_count
     FROM categories c ORDER BY c.sort, c.name`
  );
  res.json(200, rows);
});

const SORTS = {
  popular: 'p.sold DESC, p.rating DESC',
  new: 'p.created_at DESC, p.id DESC',
  price_asc: 'p.price ASC',
  price_desc: 'p.price DESC',
  rating: 'p.rating DESC'
};

router.get('/api/products', (req, res) => {
  const q = req.url.searchParams;
  const where = [`p.status = 'active'`];
  const params = [];
  const category = q.get('category');
  if (category) { where.push('c.slug = ?'); params.push(category); }
  const search = (q.get('q') || '').trim();
  if (search) {
    where.push('(p.name LIKE ? OR p.summary LIKE ? OR c.name LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  if (q.get('featured') === '1') where.push('p.featured = 1');
  if (q.get('in_stock') === '1') where.push('p.stock > 0');

  const sort = SORTS[q.get('sort')] || SORTS.popular;
  const page = Math.max(1, parseInt(q.get('page') || '1', 10) || 1);
  const per = Math.min(48, Math.max(1, parseInt(q.get('per') || '24', 10) || 24));

  const total = get(`SELECT COUNT(*) AS c ${PRODUCT_JOIN} WHERE ${where.join(' AND ')}`, ...params).c;
  const rows = all(
    `SELECT ${PRODUCT_COLUMNS} ${PRODUCT_JOIN}
     WHERE ${where.join(' AND ')}
     ORDER BY ${sort}
     LIMIT ? OFFSET ?`,
    ...params, per, (page - 1) * per
  );
  res.json(200, {
    items: rows.map(toPublic),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / per))
  });
});

router.get('/api/products/:slug', (req, res) => {
  const row = get(
    `SELECT ${PRODUCT_COLUMNS} ${PRODUCT_JOIN} WHERE p.slug = ?`,
    req.params.slug
  );
  if (!row || row.status !== 'active') throw new HttpError(404, 'Product not found');
  const related = all(
    `SELECT ${PRODUCT_COLUMNS} ${PRODUCT_JOIN}
     WHERE p.category_id = ? AND p.id != ? AND p.status='active'
     ORDER BY p.sold DESC LIMIT 4`,
    row.category_id, row.id
  );
  res.json(200, { product: toPublic(row), related: related.map(toPublic) });
});

export default router;
