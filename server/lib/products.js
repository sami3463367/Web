/**
 * Boighor BD — Product serialisation helpers
 */

const JSON_FIELDS = ['images', 'sizes', 'colors'];

export function parseProduct(row) {
  if (!row) return row;
  const out = { ...row };
  for (const f of JSON_FIELDS) {
    try { out[f] = JSON.parse(row[f] || '[]'); } catch { out[f] = []; }
  }
  out.featured = !!row.featured;
  out.category_slug = row.category_slug ?? null;
  out.category_name = row.category_name ?? null;
  return out;
}

export const PRODUCT_COLUMNS = `
  p.id, p.slug, p.category_id, p.name, p.summary, p.description, p.price, p.compare_price,
  p.images, p.sizes, p.colors, p.stock, p.low_stock_at, p.rating, p.rating_count, p.sold,
  p.featured, p.status, p.created_at, p.updated_at,
  c.slug AS category_slug, c.name AS category_name, c.icon AS category_icon
`;

export const PRODUCT_JOIN = `FROM products p JOIN categories c ON c.id = p.category_id`;

export function discountPercent(p) {
  if (!p.compare_price || p.compare_price <= p.price) return 0;
  return Math.round(((p.compare_price - p.price) / p.compare_price) * 100);
}

export function toPublic(p) {
  const parsed = parseProduct(p);
  return {
    id: parsed.id,
    slug: parsed.slug,
    category: parsed.category_slug,
    category_name: parsed.category_name,
    category_icon: parsed.category_icon,
    name: parsed.name,
    summary: parsed.summary,
    description: parsed.description,
    price: parsed.price,
    compare_price: parsed.compare_price,
    discount: discountPercent(parsed),
    images: parsed.images,
    sizes: parsed.sizes,
    colors: parsed.colors,
    stock: parsed.stock,
    rating: parsed.rating,
    rating_count: parsed.rating_count,
    sold: parsed.sold,
    featured: parsed.featured,
    in_stock: parsed.stock > 0
  };
}
