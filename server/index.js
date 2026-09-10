/**
 * Boighor BD — application entry
 * Zero-dependency Node HTTP server: SSR pages + JSON API + static assets.
 *
 *   PORT=3000 npm start
 */
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { seed } from './seed.js';
import { all, get, getSettings, seedSettingsIfEmpty } from './core/db.js';
import { purgeExpiredSessions } from './core/auth.js';
import { Router } from './core/router.js';
import { json, html, HttpError, serveStatic, redirect } from './core/http.js';
import { render } from './core/ssr.js';
import { productCardHTML, esc, bdt, primaryImage, stars } from '../public/assets/js/tpl.js';

const starsHtml = (rating) => `<span aria-hidden="true">${stars(rating)}</span>`;
import { toPublic, PRODUCT_COLUMNS, PRODUCT_JOIN } from './lib/products.js';
import publicRouter from './routes/public.js';
import authRouter from './routes/auth.routes.js';
import ordersRouter from './routes/orders.routes.js';
import adminRouter from './routes/admin.routes.js';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

/* ------------------------------ boot ------------------------------ */
seedSettingsIfEmpty();
seed();

const api = new Router();
for (const r of [publicRouter, authRouter, ordersRouter, adminRouter]) {
  for (const route of r.routes) api.routes.push(route);
}

/* --------------------------- security headers --------------------------- */
function cspFor(nonce) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors *",          // allow the Arena/sandbox preview iframe
    "base-uri 'self'",
    "form-action 'self'"
  ].join('; ');
}

function securityHeaders(res, nonce) {
  res.setHeader('Content-Security-Policy', cspFor(nonce));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

/* ------------------------------ SSR helpers ----------------------------- */
function homeTokens() {
  const s = getSettings();
  const categories = all('SELECT slug, name, icon FROM categories ORDER BY sort, name');
  const featured = all(
    `SELECT ${PRODUCT_COLUMNS} ${PRODUCT_JOIN} WHERE p.status='active' AND p.featured=1 ORDER BY p.sold DESC LIMIT 8`
  ).map(toPublic);
  const newest = all(
    `SELECT ${PRODUCT_COLUMNS} ${PRODUCT_JOIN} WHERE p.status='active' ORDER BY p.created_at DESC, p.id DESC LIMIT 8`
  ).map(toPublic);
  return {
    tokens: {
      SHOP_NAME: esc(s.shop_name),
      TAGLINE: esc(s.shop_tagline),
      ANNOUNCEMENT: esc(s.announcement),
      CATEGORY_CHIPS: categories
        .map((c) => `<button class="chip" data-category="${esc(c.slug)}">${esc(c.icon)} ${esc(c.name)}</button>`)
        .join(''),
      FEATURED_GRID: featured.map(productCardHTML).join('\n'),
      NEW_GRID: newest.map(productCardHTML).join('\n'),
      INITIAL_JSON: JSON.stringify({ settings: publicSettings(s), categories, featured, newest }).replace(/</g, '\\u003c')
    },
    featured
  };
}

function publicSettings(s) {
  return {
    shop_name: s.shop_name,
    shop_tagline: s.shop_tagline,
    announcement: s.announcement,
    whatsapp_number: s.whatsapp_number,
    delivery: { dhaka: s.delivery_dhaka, outside: s.delivery_outside, free_over: s.free_delivery_over },
    currency: s.currency
  };
}

function servePage(res, name, tokens = {}, status = 200) {
  html(res, status, render(name, { NONCE: res.nonce, ...tokens }));
}

/* -------------------------------- pages -------------------------------- */
const pages = new Router();

pages.get('/', (req, res) => {
  const { tokens } = homeTokens();
  servePage(res, 'index.html', tokens);
});

pages.get('/shop', (req, res) => {
  const s = getSettings();
  const categories = all('SELECT slug, name, icon FROM categories ORDER BY sort, name');
  servePage(res, 'shop.html', {
    SHOP_NAME: esc(s.shop_name),
    ANNOUNCEMENT: esc(s.announcement),
    INITIAL_JSON: JSON.stringify({ settings: publicSettings(s), categories }).replace(/</g, '\\u003c')
  });
});

pages.get('/product/:slug', (req, res) => {
  const row = get(`SELECT ${PRODUCT_COLUMNS} ${PRODUCT_JOIN} WHERE p.slug = ? AND p.status = 'active'`, req.params.slug);
  if (!row) throw new HttpError(404, 'Product not found');
  const p = toPublic(row);
  const related = all(
    `SELECT ${PRODUCT_COLUMNS} ${PRODUCT_JOIN} WHERE p.category_id = ? AND p.id != ? AND p.status='active' ORDER BY p.sold DESC LIMIT 4`,
    row.category_id, row.id
  ).map(toPublic);
  const s = getSettings();
  const img = primaryImage(p);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    image: [img.l],
    description: p.summary,
    sku: p.slug,
    brand: { '@type': 'Brand', name: s.shop_name },
    aggregateRating: { '@type': 'AggregateRating', ratingValue: p.rating, reviewCount: p.rating_count },
    offers: {
      '@type': 'Offer',
      priceCurrency: 'BDT',
      price: p.price,
      availability: p.in_stock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      url: `/product/${p.slug}`
    }
  };
  servePage(res, 'product.html', {
    TITLE: `${esc(p.name)} — ${esc(s.shop_name)}`,
    META_DESCRIPTION: esc(p.summary),
    OG_IMAGE: img.l,
    JSON_LD: `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`,
    PRODUCT_NAME: esc(p.name),
    PRODUCT_SUMMARY: esc(p.summary),
    PRODUCT_DESCRIPTION: esc(p.description),
    PRODUCT_PRICE_TEXT: bdt(p.price),
    PRODUCT_IMG_SRC: img.s,
    PRODUCT_IMG_SRCSET: `${img.s} 480w, ${img.l} 800w`,
    BADGE_HTML: p.discount > 0 ? `<span class="badge badge--sale">-${p.discount}%</span>` : (p.in_stock ? '' : '<span class="badge badge--out">Sold out</span>'),
    THUMBS_HTML: p.images.map((im, i) => `<img data-p-thumb data-full="${esc(im.l)}" src="${esc(im.s)}" width="62" height="62" class="${i === 0 ? 'is-active' : ''}" alt="${esc(p.name)} view ${i + 1}">`).join(''),
    CATEGORY_SLUG: esc(p.category),
    CATEGORY_NAME: esc(p.category_name || ''),
    STARS_HTML: starsHtml(p.rating),
    RATING: String(p.rating),
    RATING_COUNT: String(p.rating_count),
    SOLD: String(p.sold),
    STOCK_PILL: p.in_stock
      ? (p.stock <= 5 ? `<span class="pill pill--warn">Only ${p.stock} left</span>` : '<span class="pill pill--ok">In stock</span>')
      : '<span class="pill pill--bad">Sold out</span>',
    COMPARE_HTML: p.compare_price ? `<s>${bdt(p.compare_price)}</s>` : '',
    SAVE_HTML: p.discount > 0 ? `<span class="pdp__save">Save ${bdt(p.compare_price - p.price)}</span>` : '',
    SIZES_HTML: p.sizes.length
      ? `<div class="variant-label">Size</div><div class="sizes" data-p-sizes>${p.sizes.map((sz, i) => `<button type="button" class="size-btn ${i === 0 ? 'is-active' : ''}" data-size="${esc(sz)}">${esc(sz)}</button>`).join('')}</div>`
      : '',
    COLORS_HTML: p.colors.length
      ? `<div class="variant-label">Colour: <b data-p-color-label>${esc(p.colors[0].name)}</b></div><div class="swatches" data-p-colors>${p.colors.map((c, i) => `<button type="button" class="swatch ${i === 0 ? 'is-active' : ''}" data-color="${esc(c.name)}"><i style="background:${esc(c.hex)}"></i>${esc(c.name)}</button>`).join('')}</div>`
      : '',
    SHOP_NAME: esc(s.shop_name),
    ANNOUNCEMENT: esc(s.announcement),
    PRODUCT_JSON: JSON.stringify({ product: p, related, settings: publicSettings(s) }).replace(/</g, '\\u003c')
  });
});

for (const [route, file] of [['/cart', 'cart.html'], ['/account', 'account.html'], ['/admin', 'admin.html']]) {
  pages.get(route, (req, res) => {
    const s = getSettings();
    servePage(res, file, { SHOP_NAME: esc(s.shop_name), ANNOUNCEMENT: esc(s.announcement) });
  });
}

pages.get('/sitemap.xml', (req, res) => {
  const products = all(`SELECT slug, updated_at FROM products WHERE status='active'`);
  const base = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host || 'localhost'}`;
  const urls = [
    '/', '/shop', '/cart', '/account',
    ...products.map((p) => `/product/${p.slug}`)
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${base}${u}</loc></url>`).join('\n') +
    `\n</urlset>`;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.end(xml);
});

pages.get('/robots.txt', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end('User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: /sitemap.xml\n');
});

/* ------------------------------ dispatcher ------------------------------ */
const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  req.url = url;
  req.ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '0.0.0.0';
  res.reqHeaders = req.headers;
  res.json = (status, data, headers) => json(res, status, data, headers);
  res.nonce = crypto.randomBytes(12).toString('base64url');

  securityHeaders(res, res.nonce);
  res.setHeader('Server', 'boighor-bd');

  try {
    if (url.pathname.startsWith('/api/')) {
      const handled = await api.handle(req, res, url);
      if (!handled) throw new HttpError(404, 'Not found');
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      const handled = await pages.handle(req, res, url);
      if (handled) { /* done */ }
      else if (await serveStatic(req, res, url.pathname)) { /* done */ }
      else if (url.pathname === '/favicon.ico') redirect(res, '/favicon.svg', 301);
      else servePage(res, '404.html', { SHOP_NAME: 'Boighor BD', ANNOUNCEMENT: '' }, 404);
    } else {
      throw new HttpError(405, 'Method not allowed');
    }
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error('[error]', req.method, url.pathname, err);
    if (!res.writableEnded) {
      if (url.pathname.startsWith('/api/')) {
        json(res, status, { error: err.message || 'Server error', details: err.details });
      } else {
        html(res, status, status === 404 ? render('404.html', { SHOP_NAME: 'Boighor BD', ANNOUNCEMENT: '' }) : `<h1>${status}</h1><p>${esc(err.message)}</p>`);
      }
    }
  } finally {
    if (!res.writableEnded) res.end();
    const ms = Date.now() - started;
    if (ms > 250 || status4xx(res)) console.log(`${req.method} ${url.pathname} ${res.statusCode} ${ms}ms`);
  }
});

function status4xx(res) { return res.statusCode >= 400; }

server.listen(PORT, HOST, () => {
  console.log(`
  ┌──────────────────────────────────────────────────────┐
  │  🛍️  Boighor BD commerce is running                    │
  │  Storefront  http://localhost:${String(PORT).padEnd(5)}                   │
  │  Admin panel http://localhost:${String(PORT).padEnd(5)}/admin             │
  │      admin login → 01700000000 / admin123              │
  │  Dependencies: none · DB: SQLite (data/shop.db)       │
  └──────────────────────────────────────────────────────┘`);
});

/* housekeeping */
setInterval(() => { try { purgeExpiredSessionsDb(); } catch {} }, 60 * 60 * 1000).unref();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}
