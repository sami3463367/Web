/**
 * Boighor BD — WhatsApp conversion funnel
 * Lightweight 3-field modal (Name · Phone · Address) → server validates &
 * persists the order → structured pre-filled wa.me message with variant,
 * quantity, calculated total and delivery details.
 */
import { store } from './store.js';
import { post } from './api.js';
import { openSheet, toast, ICONS, fieldError, clearErrors, bindFieldClear } from './ui.js';
import { esc, bdt } from './tpl.js';

const PHONE_RE = /^01[3-9]\d{8}$/;
const normPhone = (v) => {
  let p = String(v || '').replace(/[\s\-()]/g, '');
  if (p.startsWith('+880')) p = '0' + p.slice(4);
  else if (p.startsWith('880')) p = '0' + p.slice(3);
  return p;
};

export function zoneSegHTML(activeZone, id = 'waZone') {
  const d = store.settings?.delivery || { dhaka: 80, outside: 150 };
  return `
  <div class="seg" data-zone-seg="${id}" role="group" aria-label="Delivery area">
    <button type="button" data-zone="dhaka" class="${activeZone === 'dhaka' ? 'is-active' : ''}" aria-pressed="${activeZone === 'dhaka'}">
      Inside Dhaka <small>Delivery ৳${d.dhaka}</small>
    </button>
    <button type="button" data-zone="outside" class="${activeZone === 'outside' ? 'is-active' : ''}" aria-pressed="${activeZone === 'outside'}">
      Outside Dhaka <small>Delivery ৳${d.outside}</small>
    </button>
  </div>`;
}

export function bindZoneSeg(root, onChange) {
  root.querySelectorAll('[data-zone-seg]').forEach((seg) => {
    seg.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-zone]');
      if (!btn) return;
      seg.querySelectorAll('button').forEach((b) => { b.classList.toggle('is-active', b === btn); b.setAttribute('aria-pressed', b === btn); });
      store.setZone(btn.dataset.zone);
      onChange?.(btn.dataset.zone);
    });
  });
}

function summaryBlock() {
  const lines = store.lines();
  const rows = lines.map((l) => `
    <div class="sumrow">
      <span>${esc(l.name)}${l.size || l.color ? ` <small style="color:var(--muted)">(${esc([l.size, l.color].filter(Boolean).join('/'))})</small>` : ''} × ${l.qty}</span>
      <b>${bdt(l.price * l.qty)}</b>
    </div>`).join('');
  return `
    <div style="background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin-bottom:14px">
      ${rows}
      <div class="sumrow" data-sum-subtotal><span>Subtotal</span><b>${bdt(store.subtotal())}</b></div>
      <div class="sumrow" data-sum-delivery><span>Delivery (${store.zone === 'outside' ? 'Outside Dhaka' : 'Inside Dhaka'})</span><b>${bdt(store.deliveryFee())}</b></div>
      <div class="sumrow sumrow--total" data-sum-total><span>Total payable</span><b>${bdt(store.total())}</b></div>
      <div class="sumrow" style="padding-top:6px"><span style="font-size:11.5px">💵 Cash on Delivery available</span><span></span></div>
    </div>`;
}

function refreshTotals(sheet) {
  const sub = sheet.querySelector('[data-sum-subtotal] b');
  const del = sheet.querySelector('[data-sum-delivery]');
  const tot = sheet.querySelector('[data-sum-total] b');
  if (sub) sub.textContent = bdt(store.subtotal());
  if (del) {
    del.querySelector('span').textContent = `Delivery (${store.zone === 'outside' ? 'Outside Dhaka' : 'Inside Dhaka'})`;
    del.querySelector('b').textContent = store.deliveryFee() === 0 ? 'FREE' : bdt(store.deliveryFee());
  }
  if (tot) tot.textContent = bdt(store.total());
}

/** WhatsApp-style markdown (*bold*, _italic_) → safe HTML */
export function waMarkdown(text) {
  return esc(text)
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>');
}

export function openOrderSheet() {
  if (!store.count()) { openChatSheet(); return null; }
  const draft = store.checkoutDraft() || {};
  const user = store.user && store.user !== undefined ? store.user : null;

  const sheet = openSheet({
    icon: `<span style="width:34px;height:34px;border-radius:10px;background:#e3f8ec;color:var(--wa-deep);display:grid;place-items:center;flex:none">${ICONS.wa.replace('viewBox="0 0 32 32"', 'viewBox="0 0 32 32" width="20" height="20"')}</span>`,
    title: 'Order via WhatsApp',
    body: `
      <p style="font-size:12.5px;color:var(--muted);margin-bottom:12px">
        Fill in 3 details — we'll open WhatsApp with your complete order summary ready to send. No card, no app installs.
      </p>
      <form id="waForm" novalidate>
        <label class="field" data-field="name">
          <span>Your name</span>
          <input name="name" autocomplete="name" placeholder="e.g. Rafiq Islam" value="${esc(user?.name || draft.name || '')}" required>
          <em class="field__err"></em>
        </label>
        <label class="field" data-field="phone">
          <span>Mobile number</span>
          <input name="phone" inputmode="numeric" autocomplete="tel" placeholder="01XXXXXXXXX" value="${esc(user?.phone || draft.phone || '')}" required>
          <em class="field__err"></em>
        </label>
        <label class="field" data-field="address">
          <span>Delivery address</span>
          <textarea name="address" autocomplete="street-address" placeholder="House, road, area, district" required>${esc(user?.address || draft.address || '')}</textarea>
          <em class="field__err"></em>
        </label>
        <div class="variant-label">Delivery area</div>
        ${zoneSegHTML(store.zone)}
        <div style="height:12px"></div>
        ${summaryBlock()}
      </form>`,
    foot: `
      <button class="btn btn--wa btn--block" id="waSubmit" type="button">
        ${ICONS.wa} <span>Send order on WhatsApp</span>
      </button>
      <p style="text-align:center;font-size:11px;color:var(--muted);margin:8px 0 0">
        🔒 Your details are used only for this delivery.
      </p>`
  });

  const form = sheet.el.querySelector('#waForm');
  bindFieldClear(form);
  bindZoneSeg(sheet.el, () => refreshTotals(sheet.el));

  sheet.el.querySelector('#waSubmit').addEventListener('click', submit);
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(); });

  async function submit() {
    const btn = sheet.el.querySelector('#waSubmit');
    clearErrors(form);
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const phone = normPhone(data.get('phone'));
    const address = String(data.get('address') || '').trim();

    let bad = false;
    if (name.length < 2) { fieldError(form, 'name', 'Please enter your full name'); bad = true; }
    if (!PHONE_RE.test(phone)) { fieldError(form, 'phone', 'Enter a valid 11-digit mobile number (01…)'); bad = true; }
    if (address.length < 8) { fieldError(form, 'address', 'Please enter a complete address'); bad = true; }
    if (bad) return;

    store.saveCheckoutDraft({ name, phone, address });
    btn.disabled = true;
    btn.innerHTML = 'Placing order…';
    try {
      const res = await post('/api/orders', {
        name, phone, address, zone: store.zone,
        items: store.lines().map((l) => ({ product_id: l.product_id, qty: l.qty, size: l.size, color: l.color }))
      });
      store.clear();
      showSuccess(sheet, res);
    } catch (err) {
      btn.disabled = false;
      btn.innerHTML = `${ICONS.wa} <span>Send order on WhatsApp</span>`;
      if (err.details?.field) fieldError(form, err.details.field, err.message);
      else toast(err.message, 'err', 3600);
    }
  }

  return sheet;
}

function showSuccess(sheet, res) {
  const { order, message, wa_url: waUrl, whatsapp_configured: configured } = res;
  const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  sheet.body.innerHTML = `
    <div class="wa-success">
      <div class="wa-success__ring">${ICONS.check}</div>
      <h3 style="font-size:19px;font-weight:800">Order ${esc(order.code)} placed!</h3>
      <p style="font-size:13px;color:var(--muted);margin-top:6px">
        Total <b style="color:var(--brand)">${bdt(order.total)}</b> · Cash on Delivery<br>
        Your order summary below is ready in WhatsApp.
      </p>
      <div class="wa-thread">
        <div class="wa-bubble">${waMarkdown(message)}</div>
        <div class="wa-meta">${time} ✓✓</div>
      </div>
    </div>`;
  sheet.foot.innerHTML = `
    <a class="btn btn--wa btn--block" href="${esc(waUrl)}" target="_blank" rel="noopener noreferrer" id="waOpen">
      ${ICONS.wa} <span>Open in WhatsApp</span>
    </a>
    <button class="btn btn--ghost btn--block" style="margin-top:8px" data-close-after type="button">Continue shopping</button>`;
  sheet.el.querySelector('[data-close-after]').addEventListener('click', () => sheet.close());

  toast(`Order ${order.code} confirmed ✓`, 'wa', 3200);
  if (configured) {
    // Merchant number connected → hand straight over to WhatsApp.
    setTimeout(() => { window.open(waUrl, '_blank', 'noopener'); }, 1100);
  }
}

/* ------------------------- "chat with the shop" ------------------------- */
export function openChatSheet(prefill = '') {
  const s = store.settings || {};
  const sheet = openSheet({
    icon: `<span style="width:34px;height:34px;border-radius:10px;background:#e3f8ec;color:var(--wa-deep);display:grid;place-items:center;flex:none">${ICONS.wa.replace('viewBox="0 0 32 32"', 'viewBox="0 0 32 32" width="20" height="20"')}</span>`,
    title: `Message ${esc(s.shop_name || 'the shop')}`,
    body: `
      <p style="font-size:13px;color:var(--muted);margin-bottom:12px">Questions about a product, size or delivery? Send us a WhatsApp message — we usually reply within minutes.</p>
      <label class="field"><span>Your message</span>
        <textarea id="chatMsg" rows="4">${esc(prefill || 'Assalamu alaikum! I have a question about your products.')}</textarea>
      </label>`,
    foot: `<button class="btn btn--wa btn--block" id="chatSend" type="button">${ICONS.wa} <span>Open WhatsApp chat</span></button>`
  });
  sheet.el.querySelector('#chatSend').addEventListener('click', () => {
    const text = encodeURIComponent(sheet.el.querySelector('#chatMsg').value.trim() || 'Hello!');
    const num = String(s.whatsapp_number || '').replace(/\D/g, '');
    const url = num ? `https://wa.me/${num}?text=${text}` : `https://api.whatsapp.com/send?text=${text}`;
    window.open(url, '_blank', 'noopener');
    sheet.close();
  });
  return sheet;
}

export function bindFloatingCta() {
  const fab = document.querySelector('.fab-wa');
  if (!fab) return;
  fab.addEventListener('click', () => {
    if (store.count() > 0) openOrderSheet();
    else openChatSheet();
  });
}
