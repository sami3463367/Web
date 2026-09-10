/** Boighor BD — UI primitives: toasts, bottom sheets, icons. */

export const ICONS = {
  wa: '<svg viewBox="0 0 32 32" aria-hidden="true"><path fill="currentColor" d="M16 3C9.4 3 4 8.3 4 14.9c0 2.6.8 5 2.3 7L4 29l7.3-2.3c1.9 1 4 1.6 6.2 1.6h.1c6.6 0 12-5.3 12-11.9S22.6 3 16 3zm0 21.8c-2 0-3.9-.5-5.6-1.5l-.4-.2-4.3 1.3 1.4-4.2-.3-.4a9.7 9.7 0 0 1-1.5-5.2c0-5.4 4.5-9.8 10-9.8s10 4.4 10 9.8-4.5 10.2-9.3 10.2zm5.5-7.3c-.3-.2-1.8-.9-2-1-.3-.1-.5-.2-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.2-1.3-.5-2.4-1.5-.9-.8-1.5-1.8-1.7-2.1-.2-.3 0-.5.1-.6l.5-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.2-.3-.2-.6-.4z"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1.6"/><circle cx="19" cy="21" r="1.6"/><path d="M2.5 3h3l2.6 12.4a2 2 0 0 0 2 1.6h8.7a2 2 0 0 0 2-1.6L22 7H6.1"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h5v-6h4v6h5V9.5"/></svg>',
  shop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16l-1 13H5L4 7z"/><path d="M8 7a4 4 0 0 1 8 0"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 12.5 5.5 5.5L20 6.5"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M21 8 12 3 3 8v8l9 5 9-5V8z"/><path d="M3 8l9 5 9-5M12 13v8"/></svg>'
};

/* ---------------------------------- toast --------------------------------- */
let toastWrap;
export function toast(message, type = 'ok', ms = 2600) {
  if (!toastWrap) {
    toastWrap = document.createElement('div');
    toastWrap.className = 'toast-wrap';
    toastWrap.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastWrap);
  }
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = message;
  toastWrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 320);
  }, ms);
}

/* ------------------------------- bottom sheet ----------------------------- */
let activeSheet = null;

export function openSheet({ title, body, foot = '', icon = '' }) {
  closeSheet();
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  const sheet = document.createElement('div');
  sheet.className = 'sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', title);
  sheet.innerHTML = `
    <div class="sheet__grip"></div>
    <div class="sheet__head">${icon}<h3>${title}</h3><button class="sheet__close" aria-label="Close">✕</button></div>
    <div class="sheet__body">${body}</div>
    ${foot ? `<div class="sheet__foot">${foot}</div>` : ''}`;
  document.body.appendChild(backdrop);
  document.body.appendChild(sheet);
  document.body.style.overflow = 'hidden';

  const close = () => closeSheet();
  backdrop.addEventListener('click', close);
  sheet.querySelector('.sheet__close').addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  requestAnimationFrame(() => {
    backdrop.classList.add('is-open');
    sheet.classList.add('is-open');
    const focusable = sheet.querySelector('input, textarea, select, button.btn');
    if (focusable && window.matchMedia('(min-width:700px)').matches) setTimeout(() => focusable.focus(), 260);
  });

  activeSheet = { backdrop, sheet, close };
  return { el: sheet, close, body: sheet.querySelector('.sheet__body'), foot: sheet.querySelector('.sheet__foot') };
}

function onKey(e) { if (e.key === 'Escape') closeSheet(); }

export function closeSheet() {
  if (!activeSheet) return;
  const { backdrop, sheet } = activeSheet;
  document.removeEventListener('keydown', onKey);
  backdrop.classList.remove('is-open');
  sheet.classList.remove('is-open');
  document.body.style.overflow = '';
  setTimeout(() => { backdrop.remove(); sheet.remove(); }, 260);
  activeSheet = null;
}

export function sheetEl() { return activeSheet?.sheet || null; }

/* ------------------------------ misc helpers ------------------------------ */
export function fieldError(form, field, message) {
  const wrap = form.querySelector(`[data-field="${field}"]`);
  if (!wrap) return;
  wrap.classList.add('has-err');
  const err = wrap.querySelector('.field__err');
  if (err) err.textContent = message;
}

export function clearErrors(form) {
  form.querySelectorAll('.field.has-err').forEach((f) => f.classList.remove('has-err'));
}

export function bindFieldClear(form) {
  form.addEventListener('input', (e) => {
    const wrap = e.target.closest('.field');
    if (wrap) wrap.classList.remove('has-err');
  });
}

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
