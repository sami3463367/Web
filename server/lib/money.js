/**
 * Boighor BD — Money & totals (single source of truth)
 * The SERVER always recomputes order totals from database prices.
 * Client-supplied prices are never trusted.
 */
import { getSettings } from '../core/db.js';

/** Integer taka with thousands separators, e.g. 1850 -> "1,850" */
export function formatTaka(amount) {
  const n = Math.round(Number(amount) || 0);
  return n.toLocaleString('en-US');
}

export function deliveryFeeFor(zone, settings = getSettings()) {
  const fee = zone === 'outside' ? settings.delivery_outside : settings.delivery_dhaka;
  return Number(fee) || 0;
}

/**
 * @param {{unitPrice:number, qty:number}[]} lines
 * @param {'dhaka'|'outside'} zone
 */
export function computeTotals(lines, zone, settings = getSettings()) {
  const subtotal = lines.reduce((sum, l) => sum + (Number(l.unitPrice) || 0) * (Number(l.qty) || 0), 0);
  let delivery = deliveryFeeFor(zone, settings);
  if (settings.free_delivery_over > 0 && subtotal >= settings.free_delivery_over) delivery = 0;
  const discount = 0;
  const total = Math.max(0, subtotal + delivery - discount);
  return {
    subtotal: Math.round(subtotal),
    delivery_fee: Math.round(delivery),
    discount: Math.round(discount),
    total: Math.round(total),
    zone
  };
}

/**
 * Build the structured WhatsApp message for an order.
 * WhatsApp markdown: *bold*, _italic_, line breaks.
 */
export function buildWhatsAppMessage(order, items, settings = getSettings()) {
  const zoneLabel = order.zone === 'outside' ? 'Outside Dhaka' : 'Inside Dhaka';
  const L = [];
  L.push(`🛍️ *NEW ORDER — ${settings.shop_name}*`);
  L.push(`Order ID: *${order.code}*`);
  L.push('');
  L.push(' *Order Details*');
  items.forEach((it, i) => {
    L.push(`${i + 1}. ${it.product_name}`);
    if (it.variant) L.push(`   • Variant: ${it.variant}`);
    L.push(`   • Qty: ${it.qty} × ৳${formatTaka(it.unit_price)} = ৳${formatTaka(it.unit_price * it.qty)}`);
  });
  L.push('');
  L.push('💰 *Payment Summary*');
  L.push(`Subtotal: ৳${formatTaka(order.subtotal)}`);
  L.push(`Delivery (${zoneLabel}): ${order.delivery_fee === 0 ? 'FREE' : `৳${formatTaka(order.delivery_fee)}`}`);
  if (order.discount > 0) L.push(`Discount: -৳${formatTaka(order.discount)}`);
  L.push(`*Total Payable: ৳${formatTaka(order.total)}*`);
  L.push('Payment: Cash on Delivery');
  L.push('');
  L.push('📍 *Delivery Information*');
  L.push(`Name: ${order.customer_name}`);
  L.push(`Phone: ${order.customer_phone}`);
  L.push(`Address: ${order.customer_address}`);
  L.push('');
  L.push('ধন্যবাদ! Please confirm my order. 🙏');
  return L.join('\n');
}

/** wa.me deep link. Empty merchant number ⇒ demo mode (share sheet link). */
export function buildWhatsAppUrl(message, settings = getSettings()) {
  const text = encodeURIComponent(message);
  const num = String(settings.whatsapp_number || '').replace(/\D/g, '');
  return num
    ? `https://wa.me/${num}?text=${text}`
    : `https://api.whatsapp.com/send?text=${text}`;
}
