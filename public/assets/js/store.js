/**
 * Boighor BD — client state: cart (localStorage), delivery zone, session, settings.
 * Everything dispatches DOM events so all UI pieces stay in sync.
 */
import { get as apiGet } from './api.js';

const LS_CART = 'bd_cart_v1';
const LS_ZONE = 'bd_zone_v1';
const LS_CHECKOUT = 'bd_checkout_v1';

const safeParse = (raw, fallback) => {
  try { const v = JSON.parse(raw); return v ?? fallback; } catch { return fallback; }
};

export const store = {
  cart: safeParse(localStorage.getItem(LS_CART), {}),
  zone: localStorage.getItem(LS_ZONE) === 'outside' ? 'outside' : 'dhaka',
  settings: window.__INITIAL__?.settings || null,
  user: undefined, // undefined = unknown, null = guest
  categories: window.__INITIAL__?.categories || [],

  /* ------------------------------- cart ------------------------------- */
  lineKey(slug, size, color) { return [slug, size || '-', color || '-'].join('::'); },

  lines() {
    return Object.entries(this.cart).map(([key, l]) => ({ key, ...l }));
  },
  count() { return this.lines().reduce((n, l) => n + l.qty, 0); },
  subtotal() { return this.lines().reduce((n, l) => n + l.qty * l.price, 0); },
  deliveryFee() {
    const d = this.settings?.delivery || { dhaka: 80, outside: 150, free_over: 0 };
    let fee = this.zone === 'outside' ? d.outside : d.dhaka;
    if (d.free_over > 0 && this.subtotal() >= d.free_over) fee = 0;
    return fee;
  },
  total() { return this.subtotal() + this.deliveryFee(); },

  add(product, { size = '', color = '', qty = 1 } = {}) {
    const key = this.lineKey(product.slug, size, color);
    const existing = this.cart[key];
    const nextQty = Math.min(product.stock ?? 99, (existing?.qty || 0) + qty);
    if (nextQty <= 0) return null;
    const img = Array.isArray(product.images) && product.images[0] ? product.images[0].s : '/assets/img/placeholder.svg';
    this.cart[key] = {
      slug: product.slug,
      product_id: product.id,
      name: product.name,
      price: product.price,
      stock: product.stock,
      size, color, img,
      qty: nextQty
    };
    this.persist();
    return this.cart[key];
  },
  setQty(key, qty) {
    const line = this.cart[key];
    if (!line) return;
    if (qty <= 0) { delete this.cart[key]; }
    else line.qty = Math.min(line.stock ?? 99, qty);
    this.persist();
  },
  remove(key) { delete this.cart[key]; this.persist(); },
  clear() { this.cart = {}; this.persist(); },

  persist() {
    localStorage.setItem(LS_CART, JSON.stringify(this.cart));
    document.dispatchEvent(new CustomEvent('bd:cart', { detail: { count: this.count() } }));
  },

  /* ------------------------------- zone ------------------------------- */
  setZone(zone) {
    this.zone = zone === 'outside' ? 'outside' : 'dhaka';
    localStorage.setItem(LS_ZONE, this.zone);
    document.dispatchEvent(new CustomEvent('bd:zone', { detail: { zone: this.zone } }));
  },

  /* --------------------------- checkout memory ------------------------ */
  checkoutDraft() { return safeParse(localStorage.getItem(LS_CHECKOUT), null); },
  saveCheckoutDraft(d) { localStorage.setItem(LS_CHECKOUT, JSON.stringify(d)); },

  /* ------------------------------ remote ------------------------------ */
  async ensureSettings() {
    if (!this.settings) this.settings = await apiGet('/api/settings');
    return this.settings;
  },
  async ensureUser() {
    if (this.user === undefined) {
      try { this.user = (await apiGet('/api/me')).user || null; } catch { this.user = null; }
    }
    return this.user;
  }
};

document.addEventListener('bd:zone', () => { /* hook for re-renderers */ });
