/**
 * Boighor BD — shared view templates (isomorphic: no DOM APIs)
 * Used by the server for SSR first-paint AND by the browser for dynamic lists.
 * Keeping one source of truth means SSR and client markup never drift.
 */

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** ৳1,850 */
export function bdt(n) {
  return `৳${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
}

export function stars(rating) {
  const r = Math.max(0, Math.min(5, Number(rating) || 0));
  const full = Math.round(r);
  let out = '';
  for (let i = 1; i <= 5; i++) out += i <= full ? '★' : '☆';
  return out;
}

export function primaryImage(p) {
  const imgs = Array.isArray(p.images) ? p.images : [];
  return imgs[0] || { s: '/assets/img/placeholder.svg', l: '/assets/img/placeholder.svg' };
}

export function stockState(p) {
  if (p.stock <= 0) return { key: 'out', label: 'Sold out' };
  if (p.stock <= (p.low_stock_at ?? 5)) return { key: 'low', label: `Only ${p.stock} left` };
  return { key: 'in', label: 'In stock' };
}

export function productCardHTML(p) {
  const img = primaryImage(p);
  const st = stockState(p);
  const badge = p.discount > 0 ? `<span class="badge badge--sale">-${p.discount}%</span>` : '';
  const soldOut = st.key === 'out';
  return `
  <article class="card${soldOut ? ' card--out' : ''}" data-slug="${esc(p.slug)}">
    <a class="card__media" href="/product/${esc(p.slug)}" aria-label="${esc(p.name)}">
      <img src="${esc(img.s)}" srcset="${esc(img.s)} 480w, ${esc(img.l)} 800w" sizes="(max-width:640px) 46vw, 240px"
           width="480" height="480" loading="lazy" decoding="async" alt="${esc(p.name)}">
      ${badge}
      ${soldOut ? '<span class="badge badge--out">Sold out</span>' : ''}
      ${st.key === 'low' ? `<span class="badge badge--low">${esc(st.label)}</span>` : ''}
    </a>
    <div class="card__body">
      <span class="card__cat">${esc(p.category_icon || '🛍️')} ${esc(p.category_name || '')}</span>
      <h3 class="card__name"><a href="/product/${esc(p.slug)}">${esc(p.name)}</a></h3>
      <div class="card__rating" aria-label="Rated ${esc(p.rating)} out of 5">
        <span class="stars">${stars(p.rating)}</span><span class="card__count">(${esc(p.rating_count)})</span>
      </div>
      <div class="card__price">
        <strong>${bdt(p.price)}</strong>
        ${p.compare_price ? `<s>${bdt(p.compare_price)}</s>` : ''}
      </div>
      <button class="btn btn--add" data-add="${esc(p.slug)}" ${soldOut ? 'disabled' : ''} aria-label="Add ${esc(p.name)} to cart">
        ${soldOut ? 'Sold out' : '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M11 9h2V6h3V4h-3V1h-2v3H8v2h3v3zm-4 9c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zm10 0c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2zm-9.83-3.25.7-2.1h8.37v2H8.1l-.93 2.85c-.1.3.05.5.35.5h9.98v2H7.5a2 2 0 0 1-2-2c0-.22.03-.43.1-.63l2.66-7.92H4V7.5h6.2l-.75 2.25-2.28 5z"/></svg> Add'}
      </button>
    </div>
  </article>`;
}

export function lineItemHTML(line) {
  return `
  <li class="line" data-line="${esc(line.key)}">
    <img class="line__img" src="${esc(line.img)}" width="72" height="72" alt="${esc(line.name)}" loading="lazy">
    <div class="line__info">
      <a class="line__name" href="/product/${esc(line.slug)}">${esc(line.name)}</a>
      ${line.variant ? `<span class="line__variant">${esc(line.variant)}</span>` : ''}
      <span class="line__unit">${bdt(line.price)} each</span>
      <div class="line__controls">
        <div class="stepper" role="group" aria-label="Quantity">
          <button data-step="-1" data-key="${esc(line.key)}" aria-label="Decrease quantity">−</button>
          <output>${line.qty}</output>
          <button data-step="1" data-key="${esc(line.key)}" aria-label="Increase quantity">+</button>
        </div>
        <button class="line__remove" data-remove="${esc(line.key)}" aria-label="Remove item">Remove</button>
      </div>
    </div>
    <div class="line__total">${bdt(line.price * line.qty)}</div>
  </li>`;
}

export const STATUS_META = {
  pending: { label: 'Pending', tone: 'warn' },
  confirmed: { label: 'Confirmed', tone: 'info' },
  shipped: { label: 'Shipped', tone: 'info' },
  delivered: { label: 'Delivered', tone: 'ok' },
  cancelled: { label: 'Cancelled', tone: 'bad' }
};

export function statusPill(status) {
  const m = STATUS_META[status] || { label: status, tone: 'info' };
  return `<span class="pill pill--${m.tone}">${esc(m.label)}</span>`;
}
