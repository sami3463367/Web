/**
 * Boighor BD — storefront controller (single bundle, page-routed)
 */
import { store } from './store.js';
import { get, post, patch } from './api.js';
import { toast, ICONS, debounce, openSheet, fieldError, clearErrors, bindFieldClear } from './ui.js';
import { productCardHTML, lineItemHTML, esc, bdt, statusPill, stockState } from './tpl.js';
import { openOrderSheet, openChatSheet, bindFloatingCta, zoneSegHTML, bindZoneSeg } from './whatsapp.js';

const page = document.body.dataset.page || 'home';
const productCache = new Map();

/* ------------------------------- boot ---------------------------------- */
updateBadge();
document.addEventListener('bd:cart', updateBadge);
if (!store.settings) {
  store.ensureSettings()
    .then(() => document.dispatchEvent(new CustomEvent('bd:settings')))
    .catch(() => {});
}
bindHeader();
bindFloatingCta();
bindGlobalAdd();
markActiveNav();
document.querySelectorAll('[data-hero-wa]').forEach((b) =>
  b.addEventListener('click', () => (store.count() ? openOrderSheet() : openChatSheet())));

function markActiveNav() {
  const path = page === 'home' ? '/' : `/${page}`;
  document.querySelectorAll('.bnav').forEach((a) => {
    const href = a.getAttribute('href');
    const active = href === path || (href === '/shop' && page === 'product');
    a.classList.toggle('is-active', active);
    if (active) a.setAttribute('aria-current', 'page');
  });
}

if (page === 'home') initHome();
if (page === 'shop') initShop();
if (page === 'product') initProduct();
if (page === 'cart') initCart();
if (page === 'account') initAccount();

/* ------------------------------ header --------------------------------- */
function updateBadge() {
  const n = store.count();
  document.querySelectorAll('.cart-count').forEach((el) => {
    el.textContent = n > 99 ? '99+' : String(n);
    el.hidden = n === 0;
  });
}

let headerBound = false;
function bindHeader() {
  if (headerBound) return;
  headerBound = true;
  const form = document.querySelector('[data-search-form]');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = form.querySelector('input').value.trim();
      location.href = q ? `/shop?q=${encodeURIComponent(q)}` : '/shop';
    });
  }
}

/* delegated so dynamically rendered logout buttons always work */
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-logout]');
  if (!b) return;
  await post('/api/auth/logout', {});
  store.user = null;
  toast('Signed out', 'ok');
  if (page === 'account') initAccount(true);
  else location.href = '/';
});

/* --------------------- global "Add" button handling --------------------- */
function bindGlobalAdd() {
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-add]');
    if (!btn || btn.disabled) return;
    const slug = btn.dataset.add;
    try {
      const product = await loadProduct(slug);
      if (product.sizes?.length || product.colors?.length) openVariantSheet(product);
      else quickAdd(product, btn);
    } catch (err) {
      toast(err.message, 'err');
    }
  });
}

async function loadProduct(slug) {
  if (productCache.has(slug)) return productCache.get(slug);
  const { product } = await get(`/api/products/${slug}`);
  productCache.set(slug, product);
  return product;
}

function quickAdd(product, btn) {
  if (!product.in_stock) { toast('This item is sold out', 'err'); return; }
  store.add(product, { qty: 1 });
  toast(`${product.name} added to cart`, 'ok');
  pulse(btn);
}

function pulse(btn) {
  if (!btn) return;
  btn.animate([{ transform: 'scale(1)' }, { transform: 'scale(.94)' }, { transform: 'scale(1)' }], { duration: 220 });
}

/* --------------------------- variant picker ---------------------------- */
export function openVariantSheet(product, { orderNow = false } = {}) {
  let size = product.sizes?.[0] || '';
  let color = product.colors?.[0]?.name || '';
  let qty = 1;

  const sheet = openSheet({
    title: product.name,
    body: `
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:12px">
        <img src="${esc(product.images[0]?.s || '/assets/img/placeholder.svg')}" width="64" height="64" style="border-radius:12px;object-fit:cover" alt="">
        <div>
          <div style="font-weight:800;font-size:16px">${bdt(product.price)} ${product.compare_price ? `<s style="color:var(--muted);font-size:13px;font-weight:500">${bdt(product.compare_price)}</s>` : ''}</div>
          <div style="font-size:12px;color:var(--muted)">${esc(stockState(product).label)}</div>
        </div>
      </div>
      ${product.sizes?.length ? `
        <div class="variant-label">Size</div>
        <div class="sizes" data-v-sizes>
          ${product.sizes.map((s, i) => `<button type="button" class="size-btn ${i === 0 ? 'is-active' : ''}" data-size="${esc(s)}">${esc(s)}</button>`).join('')}
        </div>` : ''}
      ${product.colors?.length ? `
        <div class="variant-label">Colour</div>
        <div class="swatches" data-v-colors>
          ${product.colors.map((c, i) => `<button type="button" class="swatch ${i === 0 ? 'is-active' : ''}" data-color="${esc(c.name)}"><i style="background:${esc(c.hex)}"></i>${esc(c.name)}</button>`).join('')}
        </div>` : ''}
      <div class="variant-label">Quantity</div>
      <div class="stepper" data-v-qty>
        <button type="button" data-step="-1" aria-label="Decrease">−</button>
        <output>1</output>
        <button type="button" data-step="1" aria-label="Increase">+</button>
      </div>`,
    foot: `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button class="btn btn--ghost" id="vAdd" type="button">Add to cart</button>
        <button class="btn btn--wa" id="vOrder" type="button">${ICONS.wa} Order now</button>
      </div>`
  });

  const el = sheet.el;
  el.querySelector('[data-v-sizes]')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-size]'); if (!b) return;
    size = b.dataset.size;
    el.querySelectorAll('[data-size]').forEach((x) => x.classList.toggle('is-active', x === b));
  });
  el.querySelector('[data-v-colors]')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]'); if (!b) return;
    color = b.dataset.color;
    el.querySelectorAll('[data-color]').forEach((x) => x.classList.toggle('is-active', x === b));
  });
  el.querySelector('[data-v-qty]')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]'); if (!b) return;
    qty = Math.max(1, Math.min(product.stock || 1, qty + Number(b.dataset.step)));
    el.querySelector('[data-v-qty] output').textContent = qty;
  });

  el.querySelector('#vAdd').addEventListener('click', () => {
    store.add(product, { size, color, qty });
    sheet.close();
    toast(`${product.name} added to cart`, 'ok');
  });
  el.querySelector('#vOrder').addEventListener('click', () => {
    store.add(product, { size, color, qty });
    sheet.close();
    openOrderSheet();
  });
  if (orderNow) el.querySelector('#vOrder').focus();
  return sheet;
}

/* -------------------------------- home --------------------------------- */
function initHome() {
  const chips = document.querySelector('[data-home-chips]');
  const grid = document.querySelector('[data-home-grid]');
  if (!chips || !grid) return;

  const featBtn = document.createElement('button');
  featBtn.className = 'chip is-active';
  featBtn.dataset.category = '';
  featBtn.dataset.featured = '1';
  featBtn.textContent = '⭐ Featured';
  chips.prepend(featBtn);

  chips.addEventListener('click', async (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-active', c === chip));
    const cat = chip.dataset.category;
    grid.innerHTML = Array(8).fill('<div class="skel" style="aspect-ratio:.82"></div>').join('');
    try {
      const qs = cat ? `?category=${encodeURIComponent(cat)}` : '?featured=1';
      const { items } = await get(`/api/products${qs}`);
      grid.innerHTML = items.length ? items.map(productCardHTML).join('') : emptyGrid();
    } catch {
      grid.innerHTML = emptyGrid();
    }
  });
}

const emptyGrid = () => `<div class="empty" style="grid-column:1/-1"><span>🛒</span><h3>No products found</h3><p>Try another category or check back soon.</p></div>`;

/* -------------------------------- shop --------------------------------- */
function initShop() {
  const grid = document.querySelector('[data-shop-grid]');
  const countEl = document.querySelector('[data-shop-count]');
  const sortEl = document.querySelector('[data-shop-sort]');
  const chips = document.querySelector('[data-shop-chips]');
  const params = new URLSearchParams(location.search);
  let state = {
    category: params.get('category') || '',
    q: params.get('q') || '',
    sort: params.get('sort') || 'popular'
  };
  if (sortEl) sortEl.value = state.sort;

  // inject category chips from SSR/initial payload
  for (const c of store.categories) {
    const b = document.createElement('button');
    b.className = `chip ${state.category === c.slug ? 'is-active' : ''}`;
    b.dataset.category = c.slug;
    b.textContent = `${c.icon} ${c.name}`;
    chips?.appendChild(b);
  }
  if (state.category) chips?.querySelector('[data-category=""]')?.classList.remove('is-active');

  const title = document.querySelector('[data-shop-title]');
  const apply = async () => {
    grid.innerHTML = Array(8).fill('<div class="skel" style="aspect-ratio:.82"></div>').join('');
    const qs = new URLSearchParams();
    if (state.category) qs.set('category', state.category);
    if (state.q) qs.set('q', state.q);
    qs.set('sort', state.sort);
    history.replaceState(null, '', `/shop${qs.toString() ? `?${qs}` : ''}`);
    try {
      const { items, total } = await get(`/api/products?${qs}`);
      grid.innerHTML = items.length ? items.map(productCardHTML).join('') : emptyGrid();
      if (countEl) countEl.textContent = `${total} item${total === 1 ? '' : 's'}`;
      if (title) title.textContent = state.q ? `Results for “${state.q}”` : state.category ? (store.categories.find((c) => c.slug === state.category)?.name || 'Shop') : 'All products';
    } catch {
      grid.innerHTML = emptyGrid();
    }
  };

  chips?.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip'); if (!chip) return;
    state.category = chip.dataset.category || '';
    chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-active', c === chip));
    apply();
  });
  sortEl?.addEventListener('change', () => { state.sort = sortEl.value; apply(); });
  apply();
}

/* ------------------------------- product ------------------------------- */
function initProduct() {
  const data = window.__INITIAL__;
  if (!data?.product) return;
  const p = data.product;
  const root = document.querySelector('[data-pdp]');
  if (!root) return;

  let size = p.sizes?.[0] || '';
  let color = p.colors?.[0]?.name || '';
  let qty = 1;

  const zoneMount = root.querySelector('[data-zone-mount]');
  if (zoneMount) {
    const paintZone = () => { zoneMount.innerHTML = zoneSegHTML(store.zone, 'pdpZone'); };
    paintZone();
    bindZoneSeg(zoneMount, paintZone);
    document.addEventListener('bd:settings', paintZone, { once: true });
  }

  root.querySelector('[data-p-sizes]')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-size]'); if (!b) return;
    size = b.dataset.size;
    root.querySelectorAll('[data-size]').forEach((x) => x.classList.toggle('is-active', x === b));
  });
  root.querySelector('[data-p-colors]')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]'); if (!b) return;
    color = b.dataset.color;
    root.querySelectorAll('[data-p-colors] .swatch').forEach((x) => x.classList.toggle('is-active', x === b));
    const label = root.querySelector('[data-p-color-label]');
    if (label) label.textContent = color;
  });
  root.querySelectorAll('[data-p-qty]').forEach((st) => {
    st.addEventListener('click', (e) => {
      const b = e.target.closest('[data-step]'); if (!b) return;
      qty = Math.max(1, Math.min(p.stock || 1, qty + Number(b.dataset.step)));
      root.querySelectorAll('[data-p-qty] output').forEach((o) => { o.textContent = qty; });
    });
  });
  root.querySelectorAll('[data-p-thumb]').forEach((img) => {
    img.addEventListener('click', () => {
      root.querySelector('[data-p-main]').src = img.dataset.full || img.src;
      root.querySelectorAll('[data-p-thumb]').forEach((t) => t.classList.toggle('is-active', t === img));
    });
  });

  const addToCart = () => {
    if (!p.in_stock) { toast('This item is sold out', 'err'); return; }
    store.add(p, { size, color, qty });
    toast(`${p.name} added to cart`, 'ok');
  };
  root.querySelectorAll('[data-p-add]').forEach((b) => b.addEventListener('click', addToCart));
  root.querySelectorAll('[data-p-order]').forEach((b) => b.addEventListener('click', () => {
    if (!p.in_stock) { toast('This item is sold out', 'err'); return; }
    store.add(p, { size, color, qty });
    openOrderSheet();
  }));
  root.querySelectorAll('[data-p-chat]').forEach((b) => b.addEventListener('click', () => openChatSheet(`Assalamu alaikum! I'm interested in "${p.name}" (${bdt(p.price)}). Is it available?`)));

  const rel = document.querySelector('[data-related]');
  if (rel && data.related?.length) rel.innerHTML = data.related.map(productCardHTML).join('');
}

/* --------------------------------- cart -------------------------------- */
function initCart() {
  const mount = document.querySelector('[data-cart-mount]');
  if (!mount) return;
  document.addEventListener('bd:settings', render, { once: true });

  function render() {
    const lines = store.lines();
    if (!lines.length) {
      mount.innerHTML = `
        <div class="empty"><span>🧺</span><h3>Your cart is empty</h3>
        <p>Browse the Eid collection and add something you love.</p>
        <a class="btn btn--primary" href="/shop">Start shopping</a></div>`;
      return;
    }
    mount.innerHTML = `
      <ul class="lines">${lines.map((l) => lineItemHTML({ ...l, variant: [l.size, l.color].filter(Boolean).join(' / ') })).join('')}</ul>
      <div style="margin-top:14px" class="pdp__delivery">
        <h4>Delivery area</h4>
        ${zoneSegHTML(store.zone, 'cartZone')}
      </div>
      <div style="background:#fff;border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin-top:12px">
        <div class="sumrow"><span>Subtotal (${store.count()} items)</span><b data-c-sub>${bdt(store.subtotal())}</b></div>
        <div class="sumrow" data-c-del-row><span>Delivery</span><b data-c-del>${bdt(store.deliveryFee())}</b></div>
        <div class="sumrow sumrow--total"><span>Total</span><b data-c-total>${bdt(store.total())}</b></div>
      </div>
      <button class="btn btn--wa btn--block" style="margin-top:12px" data-checkout>${ICONS.wa} Order via WhatsApp</button>
      <a class="btn btn--ghost btn--block" style="margin-top:8px" href="/shop">Continue shopping</a>`;

    bindZoneSeg(mount, () => render());
    mount.querySelector('[data-checkout]')?.addEventListener('click', () => openOrderSheet());
  }

  mount.addEventListener('click', (e) => {
    const step = e.target.closest('[data-step]');
    if (step) {
      const key = step.dataset.key;
      const line = store.cart[key];
      if (!line) return;
      store.setQty(key, line.qty + Number(step.dataset.step));
      render();
      return;
    }
    const rm = e.target.closest('[data-remove]');
    if (rm) { store.remove(rm.dataset.remove); render(); }
  });

  render();
}

/* ------------------------------- account ------------------------------- */
async function initAccount(force = false) {
  const mount = document.querySelector('[data-account-mount]');
  if (!mount) return;
  const user = force ? await (store.user = null, store.ensureUser()) : await store.ensureUser();

  if (user) return renderProfile(mount, user);
  renderAuth(mount);
}

function renderAuth(mount) {
  mount.innerHTML = `
    <div class="auth-card">
      <div class="tabs" role="tablist">
        <button class="is-active" data-tab="login" role="tab">Sign in</button>
        <button data-tab="register" role="tab">Create account</button>
      </div>
      <form id="loginForm" novalidate>
        <label class="field" data-field="phone"><span>Mobile number or email</span>
          <input name="phone" inputmode="tel" placeholder="01XXXXXXXXX" autocomplete="username"><em class="field__err"></em></label>
        <label class="field" data-field="password"><span>Password</span>
          <input name="password" type="password" placeholder="••••••" autocomplete="current-password"><em class="field__err"></em></label>
        <button class="btn btn--primary btn--block" type="submit">Sign in</button>
        <p style="font-size:11.5px;color:var(--muted);text-align:center;margin-top:10px">
          Demo customer: <b>01712345678</b> / <b>demo123</b>
        </p>
      </form>
      <form id="registerForm" hidden novalidate>
        <label class="field" data-field="name"><span>Full name</span><input name="name" autocomplete="name" placeholder="Your name"><em class="field__err"></em></label>
        <label class="field" data-field="phone"><span>Mobile number</span><input name="phone" inputmode="numeric" placeholder="01XXXXXXXXX" autocomplete="tel"><em class="field__err"></em></label>
        <label class="field" data-field="password"><span>Password</span><input name="password" type="password" placeholder="Min 6 characters" autocomplete="new-password"><em class="field__err"></em></label>
        <label class="field" data-field="address"><span>Default delivery address</span><textarea name="address" placeholder="House, road, area, district"></textarea><em class="field__err"></em></label>
        <button class="btn btn--primary btn--block" type="submit">Create account</button>
      </form>
      <div style="border-top:1px dashed var(--line);margin:16px 0 12px"></div>
      <form id="trackForm" novalidate>
        <div class="variant-label" style="margin-top:0">Track an order</div>
        <div class="form-row form-row--2" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <label class="field" style="margin-bottom:8px"><input name="code" placeholder="Order code (BD-…)"></label>
          <label class="field" style="margin-bottom:8px"><input name="phone" inputmode="numeric" placeholder="01XXXXXXXXX"></label>
        </div>
        <button class="btn btn--ghost btn--block btn--sm" type="submit">Track order</button>
      </form>
    </div>`;

  mount.querySelector('.tabs').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]'); if (!t) return;
    mount.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('is-active', b === t));
    mount.querySelector('#loginForm').hidden = t.dataset.tab !== 'login';
    mount.querySelector('#registerForm').hidden = t.dataset.tab !== 'register';
  });

  const login = mount.querySelector('#loginForm');
  const register = mount.querySelector('#registerForm');
  bindFieldClear(login); bindFieldClear(register);

  login.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(login);
    const fd = new FormData(login);
    try {
      const { user } = await post('/api/auth/login', { phone: fd.get('phone'), password: fd.get('password') });
      store.user = user;
      toast(`Welcome back, ${user.name.split(' ')[0]}!`, 'ok');
      initAccount(true);
    } catch (err) { fieldError(login, 'phone', err.message); }
  });

  register.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(register);
    const fd = new FormData(register);
    try {
      const { user } = await post('/api/auth/register', {
        name: fd.get('name'), phone: fd.get('phone'), password: fd.get('password'), address: fd.get('address')
      });
      store.user = user;
      toast('Account created — welcome!', 'ok');
      initAccount(true);
    } catch (err) { fieldError(register, err.details?.field || 'phone', err.message); }
  });

  mount.querySelector('#trackForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const order = await post('/api/orders/lookup', { code: fd.get('code'), phone: fd.get('phone') });
      showOrderDetail(order);
    } catch (err) { toast(err.message, 'err'); }
  });
}

async function renderProfile(mount, user) {
  mount.innerHTML = `
    <div class="auth-card" style="max-width:640px">
      <div style="display:flex;gap:12px;align-items:center;margin-bottom:14px">
        <div style="width:52px;height:52px;border-radius:16px;background:var(--brand);color:#fff;display:grid;place-items:center;font-size:20px;font-weight:800">${esc(user.name[0] || '?')}</div>
        <div style="flex:1">
          <div style="font-weight:800;font-size:16px">${esc(user.name)}</div>
          <div style="font-size:12.5px;color:var(--muted)">${esc(user.phone)}${user.email ? ` · ${esc(user.email)}` : ''}</div>
        </div>
        <button class="btn btn--ghost btn--sm" data-logout type="button">Sign out</button>
      </div>
      <form id="profileForm" novalidate>
        <div class="form-row form-row--2">
          <label class="field" data-field="name"><span>Name</span><input name="name" value="${esc(user.name)}"><em class="field__err"></em></label>
          <label class="field" data-field="email"><span>Email (optional)</span><input name="email" value="${esc(user.email || '')}"><em class="field__err"></em></label>
        </div>
        <label class="field" data-field="address"><span>Default address</span><textarea name="address">${esc(user.address)}</textarea><em class="field__err"></em></label>
        <button class="btn btn--primary btn--sm" type="submit">Save changes</button>
      </form>
      <div class="variant-label" style="margin:18px 0 8px">My orders</div>
      <div data-my-orders><div class="skel" style="height:70px"></div></div>
    </div>`;

  const form = mount.querySelector('#profileForm');
  bindFieldClear(form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const fd = new FormData(form);
    try {
      const { user: updated } = await patch('/api/me', { name: fd.get('name'), email: fd.get('email'), address: fd.get('address') });
      store.user = updated;
      toast('Profile updated', 'ok');
    } catch (err) { fieldError(form, err.details?.field || 'name', err.message); }
  });

  const box = mount.querySelector('[data-my-orders]');
  try {
    const orders = await get('/api/orders');
    if (!orders.length) {
      box.innerHTML = `<div class="empty" style="padding:24px"><span>📦</span><h3>No orders yet</h3><p>Your WhatsApp orders will appear here.</p></div>`;
    } else {
      box.innerHTML = orders.map((o) => `
        <div class="order-card">
          <div class="order-card__head"><b>${esc(o.code)}</b>${statusPill(o.status)}</div>
          <div class="order-card__items">${o.items.map((i) => `${esc(i.name)}${i.variant ? ` (${esc(i.variant)})` : ''} × ${i.qty}`).join('<br>')}</div>
          <div class="order-card__foot">
            <span style="color:var(--muted);font-size:12px">${new Date(o.created_at + 'Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
            <b style="color:var(--brand)">${bdt(o.total)}</b>
          </div>
        </div>`).join('');
    }
  } catch {
    box.innerHTML = `<p style="color:var(--muted);font-size:13px">Could not load orders.</p>`;
  }
}

function showOrderDetail(order) {
  openSheet({
    title: `Order ${esc(order.code)}`,
    body: `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        ${statusPill(order.status)}
        <span style="font-size:12px;color:var(--muted)">${new Date(order.created_at + 'Z').toLocaleString('en-GB')}</span>
      </div>
      ${order.items.map((i) => `<div class="sumrow"><span>${esc(i.name)}${i.variant ? ` (${esc(i.variant)})` : ''} × ${i.qty}</span><b>${bdt(i.unit_price * i.qty)}</b></div>`).join('')}
      <div class="sumrow"><span>Delivery (${order.zone === 'outside' ? 'Outside Dhaka' : 'Inside Dhaka'})</span><b>${bdt(order.delivery_fee)}</b></div>
      <div class="sumrow sumrow--total"><span>Total</span><b>${bdt(order.total)}</b></div>
      <div style="margin-top:12px;font-size:13px;color:var(--muted)">
        📍 ${esc(order.customer.address)}<br>📞 ${esc(order.customer.phone)}
      </div>`
  });
}
