# 🛍️ Boighor BD — WhatsApp-first commerce for Bangladesh

A complete, production-shaped e-commerce platform built for Bangladeshi mobile shoppers:
a lightning-light storefront, a **3-field WhatsApp checkout funnel**, customer accounts,
and a sleek **merchant admin panel** (`/admin`) with order analytics, listing management
and one-tap inventory control.

**Zero dependencies. Zero subscriptions. Zero paid services.**
The entire backend runs on Node.js built-ins (`node:http`, `node:sqlite`, `node:crypto`,
`node:zlib`). The database is a single SQLite file. The frontend is hand-written
HTML/CSS/vanilla JS with server-side rendering for first paint. Nothing to licence,
nothing to bill, deployable on any free tier (Render, Railway, Fly.io, a cheap VPS).

---

## Quick start

```bash
npm start          # → http://localhost:3000
npm run dev        # same, with file-watch restarts
npm test           # 12 end-to-end regression tests (boots a real server)
npm run seed -- --force   # wipe & re-seed demo data
```

Requires **Node 22.5+** (for the built-in `node:sqlite`). No `npm install` needed —
there are no dependencies. For Vercel, `package.json` pins the project to the
**Node 22 major line** via `engines.node`, which is the supported way to choose the
runtime for standard Node.js functions.

| Surface            | URL                            | Credentials                        |
| ------------------ | ------------------------------ | ---------------------------------- |
| Storefront         | `/`                            | —                                  |
| Customer account   | `/account`                     | `01712345678` / `demo123`          |
| Merchant admin     | `/admin`                       | `01700000000` / `admin123`         |

---

## The conversion engine: Order via WhatsApp

Complex card checkouts lose mobile customers in Bangladesh. Here the whole checkout is
one lightweight bottom-sheet with **3 fields — Name, Phone, Address** — plus a delivery
zone toggle (Dhaka ৳80 / Outside Dhaka ৳150).

On submit the server:

1. validates the BD phone number and address,
2. **re-prices the order from the database** (client prices are never trusted),
3. decrements stock atomically inside a transaction,
4. persists the order + line items (visible instantly in `/admin`),
5. returns a structured, pre-filled WhatsApp message and deep link:

```
🛍️ *NEW ORDER — Boighor BD*
Order ID: *BD-260909-0001*

 *Order Details*
1. Premium Cotton Panjabi — Eid Collection
   • Variant: L / Emerald
   • Qty: 2 × ৳1,850 = ৳3,700

💰 *Payment Summary*
Subtotal: ৳3,700
Delivery (Inside Dhaka): ৳80
*Total Payable: ৳3,780*
Payment: Cash on Delivery

📍 *Delivery Information*
Name: …  Phone: …  Address: …
```

The customer sees a WhatsApp-styled confirmation (message bubble, ticks, order code)
and an **Open in WhatsApp** button pointing at `https://wa.me/<number>?text=<encoded>`.

> **Demo mode:** with no merchant number configured the funnel still works end-to-end —
> orders are captured, analytics update, and the confirmation shows the exact message.
> Add your number in **Admin → Settings** (e.g. `8801712345678`) and orders additionally
> auto-open `wa.me` with the pre-filled text. That one field is the only configuration
> the shop needs to go live.

A floating, pulsing WhatsApp button sits bottom-right on every page: with items in the
cart it opens the order sheet, otherwise a "chat with the shop" composer.

---

## Feature map

**Storefront (mobile-first, ~95% mobile traffic)**
- Server-side rendered home / product pages → meaningful first paint on 3G, real SEO
  (JSON-LD `Product`, Open Graph, `sitemap.xml`, `robots.txt`)
- 2-column thumb-friendly grid, sticky product conversion bar, bottom tab navigation,
  44px+ tap targets, `env(safe-area-inset-*)` aware
- Variants (size / colour swatches), quantity steppers, live stock badges
  (`Only 3 left`, `Sold out`), ratings, discount badges
- Cart persisted in `localStorage`; delivery-zone toggle recalculates totals everywhere
- Accounts: register / sign in (BD mobile number), profile editing, order history,
  guest order tracking by code + phone
- No webfonts, no CDNs, no analytics: **~484 KB of WebP covers the entire catalogue**

**Merchant admin (`/admin`)**
- Dashboard KPIs (revenue, orders, pending, AOV, units, stock), 14-day revenue bar
  chart, delivery-zone split, order pipeline, top products, low-stock alerts
- Orders: filter / search / paginate, detail sheet, one-tap status changes
  (cancelling restocks automatically; reopening re-reserves stock)
- Products: create / edit / archive / restore, categories, pricing, compare-at price,
  variants, photo picker, homepage featuring — changes go live instantly
- Inventory: `− / + / +10` steppers and direct values, low & out-of-stock buckets
- Settings: shop identity, announcement bar, WhatsApp number, delivery charges,
  free-delivery threshold

**Engineering guarantees**
- Server-authoritative pricing & stock; transactions roll back cleanly on conflict
- scrypt password hashing, opaque session tokens stored as SHA-256, `HttpOnly`
  `SameSite=Lax` cookies, login/register throttling, per-IP order throttling
- Content-Security-Policy with per-request nonces, `nosniff`, referrer & permissions
  policies; path-traversal-safe static serving; parameterised SQL everywhere
- Brotli/gzip compression with ETag + immutable caching; streamed images
- Full API regression suite (`npm test`) covering auth, pricing integrity, stock
  lifecycle, admin RBAC, WhatsApp link generation and asset delivery

---

## Architecture

```
server/
  index.js            entry: HTTP server, CSP, SSR pages, static, sitemap
  core/
    db.js             node:sqlite wrapper, schema, settings KV
    router.js         micro router (params, wildcards, middleware fall-through)
    http.js           json/cookies/body limits/static + brotli/gzip + ETag
    auth.js           scrypt hashing, sessions, RBAC guards, throttling
    validate.js       BD phone/address/name/price normalisation
    ssr.js            [[TOKEN]] template renderer with mtime cache
  lib/                money & totals (single source of truth), product serializers
  routes/             public · auth · orders (WA funnel) · admin
  seed.js             demo catalogue, accounts, 14 days of order history
public/
  index|shop|product|cart|account|admin.html   (SSR tokens + nonce inline bootstrap)
  assets/css/app.css  storefront design system (mobile-first)
  assets/css/admin.css admin design system
  assets/js/tpl.js    isomorphic view templates (shared by SSR and browser)
  assets/js/*.js      api client, store, ui primitives, WA funnel, app, admin
tests/api.test.js     end-to-end regression suite (node:test)
data/shop.db          SQLite database (gitignored, auto-created & seeded)
```

Design decisions worth knowing:

- **`public/assets/js/tpl.js` is isomorphic** — the same card/line-item markup is used
  by the server for SSR and by the browser for dynamic lists, so they can never drift.
- **Totals live in one place** (`server/lib/money.js`); seed data, checkout and the
  WhatsApp message all derive from it.
- **Soft-delete products** (`archived`) so historical orders and analytics stay intact.

---

## Deploying for free (no credit card) — Vercel + Turso

The app is **dual-driver**: embedded SQLite for local/VPS/preview, and **Turso
(libsql) over HTTP** automatically when `TURSO_URL` + `TURSO_AUTH_TOKEN` are set.
`vercel.json` is already configured: static assets (CSS/JS/WebP) are served by
Vercel's CDN from `public/`, and every dynamic route (SSR pages + API + admin)
runs in one standard Node.js serverless function (`api/index.js`). The Node version
is selected from `package.json#engines` (pinned to the Node 22 line) because Vercel
rejects custom Node runtime strings inside `vercel.json` for regular Node functions.

**1 · Turso (free tier, sign up with GitHub — no card)**
```bash
# either the dashboard (turso.com → Create database) or the CLI:
npm i -g @tursodatabase/cli        # one-time, on your machine
turso db create boighor-bd
turso db show boighor-bd --url     # → libsql://….turso.io   (TURSO_URL)
turso db tokens create boighor-bd  # → eyJhbGci…              (TURSO_AUTH_TOKEN)
```

**2 · Vercel (Hobby = free, no card)**
1. Push this repo to GitHub (done) → vercel.com → *Add New… → Project* → import it.
2. Framework: **Other**. Root directory: default. No build command needed.
3. Environment variables: `TURSO_URL`, `TURSO_AUTH_TOKEN` (values from step 1).
4. Deploy. First request creates the schema and seeds the demo catalogue
   automatically (`ensureSeeded()`), so `/`, `/admin` work immediately.

**3 · Seed / reseed the remote database from anywhere**
```bash
TURSO_URL=libsql://….turso.io TURSO_AUTH_TOKEN=eyJ… npm run seed -- --force
```

Notes: Vercel functions are ephemeral, so the SQLite *file* mode is disabled
there by design; all state lives in Turso. You can export your Turso data back
to a local `.db` at any time (`turso db dump`) — no lock-in. Local development
and the test-suite still run on embedded SQLite with zero configuration.

### Other free hosts (process-based, keeps embedded SQLite)
Any host that runs a persistent Node process works unchanged: a VPS behind
nginx/Caddy, or free-tier process hosts that don't require a card in your
region. `npm start` is the whole deployment; env vars: `PORT`, `HOST`,
`DATA_DIR` (see `.env.example`).

## Licence

MIT — use it for your shop.
