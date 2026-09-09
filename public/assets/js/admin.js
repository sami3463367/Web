/**
 * Boighor BD — merchant admin panel (single-file app, no framework)
 * Dashboard analytics · orders · product listings · inventory · settings
 */
import { get, post, patch, del } from './api.js';
import { esc, bdt, STATUS_META, primaryImage } from './tpl.js';
import { toast, openSheet } from './ui.js';

const root = document.getElementById('adminRoot');
const state = { me: null, tab: (location.hash || '#/dashboard').replace('#/', '') || 'dashboard', orderPage: 1, orderStatus: 'all', orderQ: '', invFilter: 'all' };

const ICON = {
  dash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="9" rx="2"/><rect x="13.5" y="3" width="7.5" height="5.5" rx="2"/><rect x="13.5" y="12" width="7.5" height="9" rx="2"/><rect x="3" y="15.5" width="7.5" height="5.5" rx="2"/></svg>',
  orders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6M9 13h7M9 17h7"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>',
  stock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19 12a7 7 0 0 0-.15-1.45l2-1.55-2-3.46-2.36.95A7 7 0 0 0 14 5.05L13.65 2.5h-3.3L10 5.05a7 7 0 0 0-2.49 1.44l-2.36-.95-2 3.46 2 1.55A7 7 0 0 0 5 12c0 .49.05.98.15 1.45l-2 1.55 2 3.46 2.36-.95A7 7 0 0 0 10 18.95l.35 2.55h3.3l.35-2.55a7 7 0 0 0 2.49-1.44l2.36.95 2-3.46-2-1.55c.1-.47.15-.96.15-1.45z"/></svg>'
};

boot();

async function boot() {
  try {
    const { user } = await get('/api/me');
    state.me = user;
  } catch { state.me = null; }
  if (!state.me || state.me.role !== 'admin') return renderLogin();
  renderShell();
  if (!boot.hashBound) {
    boot.hashBound = true;
    window.addEventListener('hashchange', () => {
      state.tab = (location.hash || '#/dashboard').replace('#/', '') || 'dashboard';
      renderTab();
    });
  }
  renderTab();
}

/* ================================ LOGIN ================================ */
function renderLogin() {
  root.innerHTML = `
  <div class="admin-login">
    <form class="admin-login__card" id="loginForm" novalidate>
      <div class="admin-login__logo">🧑💼</div>
      <h1>Merchant Admin</h1>
      <p class="sub">Sign in to manage orders, products and inventory.</p>
      <label class="field"><span>Mobile or email</span><input name="phone" autocomplete="username" placeholder="01700000000"></label>
      <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" placeholder="••••••••"></label>
      <button class="btn btn--primary btn--block" type="submit">Sign in to dashboard</button>
      <p style="font-size:11.5px;color:var(--muted);text-align:center;margin:12px 0 0">
        Demo access → <b>01700000000</b> / <b>admin123</b><br>
        <a href="/" style="color:var(--brand);font-weight:700">← Back to store</a>
      </p>
    </form>
  </div>`;
  root.querySelector('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'Signing in…';
    const fd = new FormData(e.target);
    try {
      await post('/api/auth/login', { phone: fd.get('phone'), password: fd.get('password') });
      boot();
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Sign in to dashboard';
      toast(err.message, 'err');
    }
  });
}

/* ================================ SHELL ================================ */
function renderShell() {
  root.innerHTML = `
  <div class="admin-top">
    <div class="admin-top__logo">🛍️</div>
    <div><b>${esc(state.me.name)}</b><small>MERCHANT ADMIN</small></div>
    <div class="admin-top__spacer"></div>
    <a class="toplink" href="/" target="_blank" rel="noopener">View store ↗</a>
    <button class="toplink" id="logout" type="button">Sign out</button>
  </div>
  <div class="admin">
    <nav class="anav" aria-label="Admin sections">
      <button data-tab="dashboard">${ICON.dash} Dashboard</button>
      <button data-tab="orders">${ICON.orders} Orders <span class="count-dot" data-pending hidden></span></button>
      <button data-tab="products">${ICON.box} Products</button>
      <button data-tab="inventory">${ICON.stock} Inventory</button>
      <button data-tab="settings">${ICON.gear} Settings</button>
    </nav>
    <main class="admin-main" id="view"></main>
  </div>`;
  root.querySelector('#logout').addEventListener('click', async () => {
    await post('/api/auth/logout', {});
    location.hash = '#/dashboard';
    boot();
  });
  root.querySelector('.anav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    if (state.tab === b.dataset.tab) return;
    location.hash = `#/${b.dataset.tab}`; // hashchange drives the render
  });
}

function renderTab() {
  root.querySelectorAll('.anav [data-tab]').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === state.tab));
  const view = root.querySelector('#view');
  view.innerHTML = '<div class="skel" style="height:180px"></div>';
  const loaders = { dashboard: renderDashboard, orders: renderOrders, products: renderProducts, inventory: renderInventory, settings: renderSettings };
  (loaders[state.tab] || renderDashboard)(view);
}

/* ============================== DASHBOARD ============================== */
async function renderDashboard(view) {
  let s;
  try { s = await get('/api/admin/stats'); } catch (e) { view.innerHTML = `<div class="empty"><span>⚠️</span>${esc(e.message)}</div>`; return; }

  const dot = root.querySelector('[data-pending]');
  if (dot) { dot.hidden = !s.kpis.pending; dot.textContent = s.kpis.pending; }

  const days = last14Days();
  const byDay = new Map(s.daily.map((d) => [d.day, d]));
  const max = Math.max(1, ...days.map((d) => byDay.get(d.iso)?.revenue || 0));
  const chart = days.map((d) => {
    const rec = byDay.get(d.iso);
    const rev = rec?.revenue || 0;
    const h = Math.round((rev / max) * 100);
    return `<div class="chart__col">
      <div class="chart__bar" style="height:${Math.max(3, h)}%" data-label="${d.label}: ${bdt(rev)} · ${rec?.orders || 0} orders"></div>
      <span class="chart__day">${d.label}</span>
    </div>`;
  }).join('');

  const topMax = Math.max(1, ...s.top_products.map((t) => t.units));
  const zoneTotal = Math.max(1, s.zone_split.reduce((n, z) => n + z.orders, 0));

  view.innerHTML = `
  <div class="view-head">
    <h1>Dashboard</h1>
    <div class="view-head__spacer"></div>
    <span class="pill pill--mute">Last 14 days</span>
    <p>Live overview of sales, orders and stock — updated in real time.</p>
  </div>

  <div class="kpis">
    <div class="kpi kpi--accent"><small>Revenue</small><b>${bdt(s.kpis.revenue)}</b></div>
    <div class="kpi"><small>Orders</small><b>${s.kpis.orders}</b></div>
    <div class="kpi ${s.kpis.pending ? 'kpi--warn' : ''}"><small>Pending</small><b>${s.kpis.pending}</b></div>
    <div class="kpi"><small>Avg order</small><b>${bdt(s.kpis.aov)}</b></div>
    <div class="kpi"><small>Units sold</small><b>${s.kpis.units}</b></div>
    <div class="kpi ${s.kpis.out_of_stock ? 'kpi--warn' : ''}"><small>Stock units</small><b>${s.kpis.inventory_units}</b></div>
  </div>

  <div class="panel">
    <div class="panel__head"><h3>📈 Revenue — last 14 days</h3><span class="pill pill--ok">${bdt(s.daily.reduce((n, d) => n + (d.revenue || 0), 0))}</span></div>
    <div class="panel__body"><div class="chart" role="img" aria-label="Revenue bar chart for the last 14 days">${chart}</div></div>
  </div>

  <div class="grid-2">
    <div class="panel">
      <div class="panel__head"><h3>🏆 Top products</h3></div>
      <div class="rows">
        ${s.top_products.length ? s.top_products.map((t) => `
          <div class="row">
            <div class="row__main">
              <div class="row__title">${esc(t.name)}</div>
              <div class="bar-mini"><i style="width:${Math.round((t.units / topMax) * 100)}%"></i></div>
            </div>
            <div class="row__end"><b>${t.units} sold</b><div class="row__sub">${bdt(t.revenue)}</div></div>
          </div>`).join('') : '<div class="empty"><span>📦</span>No sales yet</div>'}
      </div>
    </div>
    <div>
      <div class="panel">
        <div class="panel__head"><h3>🚚 Delivery zones</h3></div>
        <div class="rows">
          ${s.zone_split.map((z) => `
            <div class="row">
              <div class="row__main">
                <div class="row__title">${z.zone === 'dhaka' ? 'Inside Dhaka' : 'Outside Dhaka'}</div>
                <div class="row__sub">${z.orders} orders · ${Math.round((z.orders / zoneTotal) * 100)}%</div>
              </div>
              <div class="row__end"><b>${bdt(z.revenue)}</b></div>
            </div>`).join('') || '<div class="empty"><span>🗺️</span>No data</div>'}
        </div>
      </div>
      <div class="panel">
        <div class="panel__head"><h3>🔖 Order pipeline</h3></div>
        <div class="panel__body" style="display:flex;gap:7px;flex-wrap:wrap">
          ${s.status_split.map((st) => `<span class="pill pill--${(STATUS_META[st.status] || {}).tone || 'mute'}">${(STATUS_META[st.status] || {}).label || st.status} · ${st.count}</span>`).join('')}
        </div>
      </div>
    </div>
  </div>

  <div class="grid-2">
    <div class="panel">
      <div class="panel__head"><h3>🕑 Latest orders</h3><button class="btn btn--ghost btn--sm" data-goto-orders type="button">View all</button></div>
      <div class="rows">
        ${s.recent_orders.map((o) => `
          <button class="row" style="border:0;background:none;text-align:left;width:100%" data-order="${o.id}">
            <div class="row__main">
              <div class="row__title">${esc(o.code)} · ${esc(o.customer_name)}</div>
              <div class="row__sub">${esc(o.customer_phone)} · ${fmtDate(o.created_at)}</div>
            </div>
            <div class="row__end"><b>${bdt(o.total)}</b><div>${pill(o.status)}</div></div>
          </button>`).join('')}
      </div>
    </div>
    <div class="panel">
      <div class="panel__head"><h3>⚠️ Low stock alerts</h3><button class="btn btn--ghost btn--sm" data-goto-inv type="button">Restock</button></div>
      <div class="rows">
        ${s.low_stock.length ? s.low_stock.map((p) => `
          <div class="row">
            <img class="row__thumb" src="${esc(primaryImage(p).s)}" alt="">
            <div class="row__main">
              <div class="row__title">${esc(p.name)}</div>
              <div class="row__sub">${p.stock === 0 ? 'Out of stock' : `${p.stock} left (alert at ${p.low_stock_at})`}</div>
            </div>
            <span class="pill ${p.stock === 0 ? 'pill--bad' : 'pill--warn'}">${p.stock}</span>
          </div>`).join('') : '<div class="empty"><span>✅</span>All stock levels healthy</div>'}
      </div>
    </div>
  </div>`;

  view.querySelector('[data-goto-orders]')?.addEventListener('click', () => { location.hash = '#/orders'; state.tab = 'orders'; renderTab(); });
  view.querySelector('[data-goto-inv]')?.addEventListener('click', () => { location.hash = '#/inventory'; state.tab = 'inventory'; renderTab(); });
  view.querySelectorAll('[data-order]').forEach((b) => b.addEventListener('click', () => openOrderSheet(Number(b.dataset.order))));
}

function last14Days() {
  const out = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5);
    out.push({ iso: d.toISOString().slice(0, 10), label: String(d.getUTCDate()).padStart(2, '0') });
  }
  return out;
}
const fmtDate = (iso) => new Date(iso + 'Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) +
  ', ' + new Date(iso + 'Z').toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const pill = (status) => {
  const m = STATUS_META[status] || { label: status, tone: 'mute' };
  return `<span class="pill pill--${m.tone}">${m.label}</span>`;
};

/* ================================ ORDERS =============================== */
async function renderOrders(view) {
  view.innerHTML = `
  <div class="view-head"><h1>Orders</h1><div class="view-head__spacer"></div>
    <p>Every WhatsApp order lands here instantly — update status with one tap.</p>
  </div>
  <div class="filters" id="orderFilters">
    ${['all', 'pending', 'confirmed', 'shipped', 'delivered', 'cancelled'].map((s) =>
      `<button class="fchip ${state.orderStatus === s ? 'is-active' : ''}" data-status="${s}">${s === 'all' ? 'All' : (STATUS_META[s] || {}).label}</button>`).join('')}
    <label class="searchbox"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="orderSearch" placeholder="Code, name or phone…" value="${esc(state.orderQ)}"></label>
  </div>
  <div class="panel"><div class="rows" id="orderRows"><div class="skel" style="height:120px;margin:12px"></div></div></div>
  <div style="display:flex;gap:8px;justify-content:center;margin-top:12px" id="orderPager"></div>`;

  view.querySelector('#orderFilters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-status]'); if (!b) return;
    state.orderStatus = b.dataset.status; state.orderPage = 1;
    view.querySelectorAll('[data-status]').forEach((x) => x.classList.toggle('is-active', x === b));
    loadOrders(view);
  });
  let t;
  view.querySelector('#orderSearch').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { state.orderQ = e.target.value.trim(); state.orderPage = 1; loadOrders(view); }, 300);
  });
  loadOrders(view);
}

async function loadOrders(view) {
  const rows = view.querySelector('#orderRows');
  const pager = view.querySelector('#orderPager');
  rows.innerHTML = '<div class="skel" style="height:120px;margin:12px"></div>';
  const qs = new URLSearchParams({ status: state.orderStatus, page: String(state.orderPage) });
  if (state.orderQ) qs.set('q', state.orderQ);
  let data;
  try { data = await get(`/api/admin/orders?${qs}`); } catch (e) { rows.innerHTML = `<div class="empty"><span>⚠️</span>${esc(e.message)}</div>`; return; }

  if (!data.items.length) {
    rows.innerHTML = '<div class="empty"><span>🧾</span>No orders match this filter</div>';
    pager.innerHTML = '';
    return;
  }
  rows.innerHTML = data.items.map((o) => `
    <button class="row" style="border:0;background:none;text-align:left;width:100%;display:flex" data-order="${o.id}">
      <div class="row__main">
        <div class="row__title">${esc(o.code)} · ${esc(o.customer_name)}</div>
        <div class="row__sub">${o.item_count} item${o.item_count === 1 ? '' : 's'} · ${o.zone === 'dhaka' ? 'Dhaka' : 'Outside Dhaka'} · ${fmtDate(o.created_at)}</div>
      </div>
      <div class="row__end"><b>${bdt(o.total)}</b><div>${pill(o.status)}</div></div>
    </button>`).join('');
  rows.querySelectorAll('[data-order]').forEach((b) => b.addEventListener('click', () => openOrderSheet(Number(b.dataset.order), () => loadOrders(view))));

  pager.innerHTML = `
    <button class="btn btn--ghost btn--sm" data-pg="-1" ${data.page <= 1 ? 'disabled' : ''}>← Prev</button>
    <span class="pill pill--mute">Page ${data.page} / ${data.pages}</span>
    <button class="btn btn--ghost btn--sm" data-pg="1" ${data.page >= data.pages ? 'disabled' : ''}>Next →</button>`;
  pager.querySelectorAll('[data-pg]').forEach((b) => b.addEventListener('click', () => {
    state.orderPage = Math.max(1, state.orderPage + Number(b.dataset.pg));
    loadOrders(view);
  }));
}

async function openOrderSheet(id, onDone) {
  let data;
  try { data = await get(`/api/admin/orders/${id}`); } catch (e) { toast(e.message, 'err'); return; }
  const { order, items } = data;
  const sheet = openSheet({
    title: `Order ${esc(order.code)}`,
    body: `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap">
        ${pill(order.status)}
        <span class="pill pill--mute">${order.zone === 'dhaka' ? 'Inside Dhaka' : 'Outside Dhaka'}</span>
        <span class="pill pill--mute">${fmtDate(order.created_at)}</span>
      </div>
      <div class="rows" style="border:1px solid var(--line);border-radius:12px;overflow:hidden">
        ${items.map((i) => `
          <div class="row">
            <div class="row__main"><div class="row__title">${esc(i.product_name)}</div><div class="row__sub">${esc(i.variant || '—')} · ${bdt(i.unit_price)} each</div></div>
            <div class="row__end"><b>× ${i.qty}</b><div class="row__sub">${bdt(i.unit_price * i.qty)}</div></div>
          </div>`).join('')}
      </div>
      <div style="margin-top:12px;font-size:13px">
        <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Subtotal</span><b>${bdt(order.subtotal)}</b></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--muted)">Delivery</span><b>${bdt(order.delivery_fee)}</b></div>
        <div style="display:flex;justify-content:space-between;font-size:15px;margin-top:4px"><b>Total</b><b style="color:var(--brand)">${bdt(order.total)}</b></div>
      </div>
      <div style="margin-top:14px;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:10px 12px;font-size:13px">
        <b>${esc(order.customer_name)}</b> · ${esc(order.customer_phone)}<br>
        <span style="color:var(--muted)">📍 ${esc(order.customer_address)}</span>
      </div>
      <div style="margin-top:14px">
        <span style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.4px">Update status</span>
        <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:7px" id="statusBtns">
          ${Object.keys(STATUS_META).map((s) => `<button class="fchip ${order.status === s ? 'is-active' : ''}" data-set="${s}">${STATUS_META[s].label}</button>`).join('')}
        </div>
      </div>`,
    foot: `<button class="btn btn--ghost" data-close type="button">Close</button>`
  });
  sheet.el.querySelector('[data-close]').addEventListener('click', () => sheet.close());
  sheet.el.querySelector('#statusBtns').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-set]'); if (!b) return;
    try {
      const updated = await patch(`/api/admin/orders/${id}`, { status: b.dataset.set });
      toast(`Order ${updated.order.code} → ${STATUS_META[updated.order.status].label}`, 'ok');
      sheet.close();
      onDone?.();
      if (state.tab === 'orders') return;
    } catch (err) { toast(err.message, 'err'); }
  });
}

/* =============================== PRODUCTS ============================== */
let imageLibrary = null;
async function ensureImages() {
  if (!imageLibrary) imageLibrary = await get('/api/admin/images');
  return imageLibrary;
}

async function renderProducts(view) {
  view.innerHTML = `
  <div class="view-head"><h1>Products</h1><div class="view-head__spacer"></div>
    <button class="btn btn--primary" id="addProduct" type="button">+ Add product</button>
    <p>Update listings, prices and visibility — changes go live instantly.</p>
  </div>
  <div class="filters">
    <label class="searchbox"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="prodSearch" placeholder="Search products…"></label>
    <button class="fchip is-active" data-pstatus="active">Active</button>
    <button class="fchip" data-pstatus="all">All</button>
    <button class="fchip" data-pstatus="archived">Archived</button>
  </div>
  <div class="panel"><div class="rows" id="prodRows"><div class="skel" style="height:140px;margin:12px"></div></div></div>`;

  let pstatus = 'active';
  const load = async (q = '') => {
    const rows = view.querySelector('#prodRows');
    rows.innerHTML = '<div class="skel" style="height:140px;margin:12px"></div>';
    const items = await get(`/api/admin/products?status=${pstatus}&q=${encodeURIComponent(q)}`);
    if (!items.length) { rows.innerHTML = '<div class="empty"><span>🛍️</span>No products here yet</div>'; return; }
    rows.innerHTML = items.map((p) => `
      <div class="row">
        <img class="row__thumb" src="${esc(primaryImage(p).s)}" alt="" loading="lazy">
        <div class="row__main">
          <div class="row__title">${esc(p.name)}</div>
          <div class="row__sub">${esc(p.category_name)} · ${bdt(p.price)}${p.compare_price ? ` <s>${bdt(p.compare_price)}</s>` : ''} · stock ${p.stock}</div>
        </div>
        ${p.stock === 0 ? '<span class="pill pill--bad">Out</span>' : p.stock <= p.low_stock_at ? '<span class="pill pill--warn">Low</span>' : '<span class="pill pill--ok">OK</span>'}
        ${p.status !== 'active' ? `<span class="pill pill--mute">${p.status}</span>` : ''}
        <button class="btn btn--ghost btn--sm" data-edit="${p.id}">Edit</button>
      </div>`).join('');
    rows.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openProductSheet(items.find((x) => x.id === Number(b.dataset.edit)), load, q)));
  };

  view.querySelector('#addProduct').addEventListener('click', () => openProductSheet(null, load, view.querySelector('#prodSearch').value));
  view.querySelector('.filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pstatus]'); if (!b) return;
    pstatus = b.dataset.pstatus;
    view.querySelectorAll('[data-pstatus]').forEach((x) => x.classList.toggle('is-active', x === b));
    load(view.querySelector('#prodSearch').value);
  });
  let t;
  view.querySelector('#prodSearch').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => load(e.target.value.trim()), 300); });
  load();
}

async function openProductSheet(product, onDone, searchQ = '') {
  const isNew = !product;
  const images = await ensureImages();
  const categories = await get('/api/admin/categories');
  let selectedImages = product?.images?.length ? product.images.map((i) => i.s) : [];

  const sheet = openSheet({
    title: isNew ? 'Add product' : `Edit — ${esc(product.name)}`,
    body: `
      <form id="pForm" novalidate>
        <label class="field"><span>Product name</span><input name="name" value="${esc(product?.name || '')}" placeholder="e.g. Premium Cotton Panjabi"></label>
        <div class="form-2">
          <label class="field"><span>Category</span>
            <select name="category_id">${categories.map((c) => `<option value="${c.id}" ${product?.category_id === c.id ? 'selected' : ''}>${esc(c.icon)} ${esc(c.name)}</option>`).join('')}</select></label>
          <label class="field"><span>Status</span>
            <select name="status">${['active', 'draft', 'archived'].map((s) => `<option ${product?.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        </div>
        <div class="form-2">
          <label class="field"><span>Price (৳)</span><input name="price" inputmode="numeric" value="${product?.price ?? ''}" placeholder="1850"></label>
          <label class="field"><span>Compare-at price (৳)</span><input name="compare_price" inputmode="numeric" value="${product?.compare_price ?? ''}" placeholder="2400"></label>
        </div>
        <div class="form-2">
          <label class="field"><span>Stock</span><input name="stock" inputmode="numeric" value="${product?.stock ?? 0}"></label>
          <label class="field"><span>Low-stock alert at</span><input name="low_stock_at" inputmode="numeric" value="${product?.low_stock_at ?? 5}"></label>
        </div>
        <label class="field"><span>Sizes (comma separated, leave empty if none)</span><input name="sizes" value="${esc((product?.sizes || []).join(', '))}" placeholder="S, M, L, XL"></label>
        <label class="field"><span>Colours (Name #hex, comma separated)</span><input name="colors" value="${esc((product?.colors || []).map((c) => `${c.name} ${c.hex}`).join(', '))}" placeholder="Emerald #0E5B43, Ivory #F1E8D8"></label>
        <label class="field"><span>Short summary</span><input name="summary" value="${esc(product?.summary || '')}" placeholder="One-line selling point"></label>
        <label class="field"><span>Description</span><textarea name="description" rows="4">${esc(product?.description || '')}</textarea></label>
        <label class="field"><span>Photos (tap to select, first = cover)</span>
          <div class="imgpick" id="imgPick">
            ${images.map((im) => `<button type="button" data-img="${esc(im.s)}" class="${selectedImages.includes(im.s) ? 'is-active' : ''}"><img src="${esc(im.s)}" alt="" loading="lazy"></button>`).join('')}
          </div>
        </label>
        <label style="display:flex;gap:8px;align-items:center;font-size:13px;font-weight:700">
          <input type="checkbox" name="featured" style="width:18px;height:18px" ${product?.featured ? 'checked' : ''}> Feature on homepage
        </label>
      </form>`,
    foot: `
      ${!isNew ? `<button class="btn btn--danger" data-archive type="button">${product.status === 'archived' ? 'Restore' : 'Archive'}</button>` : ''}
      <button class="btn btn--primary" data-save type="button">${isNew ? 'Create product' : 'Save changes'}</button>`
  });

  const el = sheet.el;
  el.querySelector('#imgPick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-img]'); if (!b) return;
    const src = b.dataset.img;
    if (selectedImages.includes(src)) selectedImages = selectedImages.filter((s) => s !== src);
    else selectedImages.push(src);
    b.classList.toggle('is-active', selectedImages.includes(src));
  });

  el.querySelector('[data-save]').addEventListener('click', async () => {
    const fd = new FormData(el.querySelector('#pForm'));
    const colors = String(fd.get('colors') || '').split(',').map((c) => c.trim()).filter(Boolean).map((c) => {
      const m = c.match(/^(.*?)\s*(#[0-9a-fA-F]{6})?$/);
      return { name: (m?.[1] || c).trim(), hex: m?.[2] || '#888888' };
    });
    const payload = {
      name: fd.get('name'), category_id: Number(fd.get('category_id')), status: fd.get('status'),
      price: Number(fd.get('price')), compare_price: fd.get('compare_price') ? Number(fd.get('compare_price')) : null,
      stock: Number(fd.get('stock')), low_stock_at: Number(fd.get('low_stock_at')),
      sizes: String(fd.get('sizes') || '').split(',').map((s) => s.trim()).filter(Boolean),
      colors, summary: fd.get('summary'), description: fd.get('description'),
      featured: fd.get('featured') ? 1 : 0,
      images: selectedImages.map((s) => { const lib = images.find((i) => i.s === s); return lib || { s, l: s }; })
    };
    const btn = el.querySelector('[data-save]');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      if (isNew) await post('/api/admin/products', payload);
      else await patch(`/api/admin/products/${product.id}`, payload);
      toast(isNew ? 'Product created 🎉' : 'Product updated', 'ok');
      sheet.close();
      onDone?.(searchQ);
    } catch (err) {
      btn.disabled = false; btn.textContent = isNew ? 'Create product' : 'Save changes';
      toast(err.message, 'err');
    }
  });

  el.querySelector('[data-archive]')?.addEventListener('click', async () => {
    try {
      if (product.status === 'archived') await post(`/api/admin/products/${product.id}/restore`, {});
      else await del(`/api/admin/products/${product.id}`);
      toast(product.status === 'archived' ? 'Product restored' : 'Product archived', 'ok');
      sheet.close();
      onDone?.(searchQ);
    } catch (err) { toast(err.message, 'err'); }
  });
}

/* ============================== INVENTORY ============================== */
async function renderInventory(view) {
  view.innerHTML = `
  <div class="view-head"><h1>Inventory</h1><div class="view-head__spacer"></div>
    <p>Adjust stock in one tap — the storefront updates instantly.</p>
  </div>
  <div class="filters">
    <button class="fchip is-active" data-inv="all">All</button>
    <button class="fchip" data-inv="low">Low stock</button>
    <button class="fchip" data-inv="out">Out of stock</button>
  </div>
  <div class="panel"><div class="rows" id="invRows"><div class="skel" style="height:140px;margin:12px"></div></div></div>`;

  let filter = state.invFilter === 'all' ? 'all' : state.invFilter;
  view.querySelectorAll('[data-inv]').forEach((b) => b.classList.toggle('is-active', b.dataset.inv === filter));

  const load = async () => {
    const rows = view.querySelector('#invRows');
    rows.innerHTML = '<div class="skel" style="height:140px;margin:12px"></div>';
    let items = await get('/api/admin/products?status=active');
    if (filter === 'low') items = items.filter((p) => p.stock > 0 && p.stock <= p.low_stock_at);
    if (filter === 'out') items = items.filter((p) => p.stock === 0);
    if (!items.length) { rows.innerHTML = '<div class="empty"><span>📦</span>Nothing in this bucket</div>'; return; }
    rows.innerHTML = items.map((p) => `
      <div class="row">
        <img class="row__thumb" src="${esc(primaryImage(p).s)}" alt="" loading="lazy">
        <div class="row__main">
          <div class="row__title">${esc(p.name)}</div>
          <div class="row__sub">${esc(p.category_name)} · alert at ${p.low_stock_at}</div>
        </div>
        <div class="stock-cell" data-id="${p.id}">
          <button class="stock-btn" data-d="-1" aria-label="Decrease stock">−</button>
          <input class="stock-val ${p.stock === 0 ? 'is-out' : p.stock <= p.low_stock_at ? 'is-low' : ''}" data-stock-input inputmode="numeric" value="${p.stock}" style="border:1px solid var(--line);border-radius:8px;min-height:32px" aria-label="Stock quantity">
          <button class="stock-btn" data-d="1" aria-label="Increase stock">+</button>
          <button class="stock-btn" data-d="10" title="+10" style="width:auto;padding:0 8px;font-size:12px">+10</button>
        </div>
      </div>`).join('');

    rows.querySelectorAll('.stock-cell').forEach((cell) => {
      const id = Number(cell.dataset.id);
      const input = cell.querySelector('[data-stock-input]');
      const refresh = (stock) => {
        input.value = stock;
        input.className = `stock-val ${stock === 0 ? 'is-out' : stock <= 5 ? 'is-low' : ''}`;
      };
      cell.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const r = await post(`/api/admin/products/${id}/stock`, { delta: Number(b.dataset.d) });
          refresh(r.stock);
        } catch (e) { toast(e.message, 'err'); }
        b.disabled = false;
      }));
      input.addEventListener('change', async () => {
        const v = Math.max(0, parseInt(input.value, 10) || 0);
        try {
          const r = await post(`/api/admin/products/${id}/stock`, { value: v });
          refresh(r.stock);
          toast(`${r.name}: stock set to ${r.stock}`, 'ok', 1600);
        } catch (e) { toast(e.message, 'err'); }
      });
    });
  };

  view.querySelector('.filters').addEventListener('click', (e) => {
    const b = e.target.closest('[data-inv]'); if (!b) return;
    filter = b.dataset.inv; state.invFilter = filter;
    view.querySelectorAll('[data-inv]').forEach((x) => x.classList.toggle('is-active', x === b));
    load();
  });
  load();
}

/* =============================== SETTINGS ============================== */
async function renderSettings(view) {
  let s;
  try { s = await get('/api/admin/settings'); } catch (e) { view.innerHTML = `<div class="empty"><span>⚠️</span>${esc(e.message)}</div>`; return; }
  view.innerHTML = `
  <div class="view-head"><h1>Settings</h1><p>Shop identity, WhatsApp gateway and delivery charges.</p></div>
  ${!s.whatsapp_number ? `<div class="note">📱 <b>WhatsApp demo mode:</b> orders are captured and shown here, and customers see a full WhatsApp-style confirmation. Add your number below (e.g. <b>8801712345678</b>) to send orders straight to your WhatsApp.</div>` : `<div class="note" style="background:#e6f4ec;border-color:#bfe3cf;color:#0b5d3b">✅ Orders are being forwarded to WhatsApp number <b>+${esc(s.whatsapp_number)}</b>.</div>`}
  <div class="panel"><div class="panel__body">
    <form id="sForm" novalidate>
      <div class="form-2">
        <label class="field"><span>Shop name</span><input name="shop_name" value="${esc(s.shop_name)}"></label>
        <label class="field"><span>Tagline</span><input name="shop_tagline" value="${esc(s.shop_tagline)}"></label>
      </div>
      <label class="field"><span>Announcement bar</span><input name="announcement" value="${esc(s.announcement)}"></label>
      <label class="field"><span>WhatsApp number (country code, digits only — e.g. 8801712345678)</span>
        <input name="whatsapp_number" inputmode="numeric" value="${esc(s.whatsapp_number)}" placeholder="8801712345678"></label>
      <div class="form-2">
        <label class="field"><span>Delivery — inside Dhaka (৳)</span><input name="delivery_dhaka" inputmode="numeric" value="${s.delivery_dhaka}"></label>
        <label class="field"><span>Delivery — outside Dhaka (৳)</span><input name="delivery_outside" inputmode="numeric" value="${s.delivery_outside}"></label>
      </div>
      <label class="field"><span>Free delivery over (৳, 0 = disabled)</span><input name="free_delivery_over" inputmode="numeric" value="${s.free_delivery_over}"></label>
      <button class="btn btn--primary" type="submit">Save settings</button>
    </form>
  </div></div>`;

  view.querySelector('#sForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await patch('/api/admin/settings', Object.fromEntries(fd.entries()));
      toast('Settings saved ✓', 'ok');
      renderSettings(view);
    } catch (err) {
      btn.disabled = false; btn.textContent = 'Save settings';
      toast(err.message, 'err');
    }
  });
}
