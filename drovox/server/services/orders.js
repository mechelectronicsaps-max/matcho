// Order lifecycle automation: checkout → payment → invoice → packing → shipping → delivery,
// with stock reservation, GST invoice numbering, WhatsApp updates, loyalty and referral rewards.
import crypto from 'node:crypto';
import { all, get, run, tx, getSetting, round2 } from '../db.js';
import { quote, QuoteError, validGstin } from '../pricing.js';
import { notify } from './whatsapp.js';
import { addPoints, onOrderDelivered } from './loyalty.js';

export const STATUS_FLOW = {
  pending_payment: ['confirmed', 'cancelled'],
  confirmed: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['out_for_delivery', 'delivered', 'returned'],
  out_for_delivery: ['delivered', 'returned'],
  delivered: ['returned'],
  cancelled: [], returned: [],
};
export const STATUS_LABEL = {
  pending_payment: 'Awaiting payment', confirmed: 'Order confirmed', packed: 'Packed', shipped: 'Shipped',
  out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled', returned: 'Returned',
};

function moveStock(productId, change, reason, ref, userId) {
  run('UPDATE products SET stock = stock + ?, updated_at = datetime(\'now\') WHERE id = ?', change, productId);
  const bal = get('SELECT stock FROM products WHERE id = ?', productId).stock;
  run('INSERT INTO stock_movements(product_id, change, balance, reason, ref, user_id) VALUES (?,?,?,?,?,?)', productId, change, bal, reason, ref, userId ?? null);
  return bal;
}
export { moveStock };

function newOrderNo() {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  for (;;) {
    const no = `DRV${ymd}${crypto.randomInt(10000, 99999)}`;
    if (!get('SELECT 1 FROM orders WHERE order_no = ?', no)) return no;
  }
}

function financialYear(d = new Date()) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${y}-${String(y + 1).slice(2)}`;
}
function nextInvoiceNo() {
  const fy = financialYear();
  const key = `invoice_seq_${fy}`;
  const row = get('SELECT value FROM settings WHERE key = ?', key);
  const n = (row ? Number(JSON.parse(row.value)) : 0) + 1;
  run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(n));
  return `DRV/${fy}/${String(n).padStart(5, '0')}`;
}

export function addEvent(orderId, status, note, userId) {
  run('INSERT INTO order_events(order_id, status, note, user_id) VALUES (?,?,?,?)', orderId, status, note ?? null, userId ?? null);
}

const money = (n) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
function trackUrl(o) {
  const store = getSetting('store');
  return `${store.public_url}/#/track/${o.order_no}`;
}

function messageFor(o, status) {
  const store = getSetting('store');
  const courier = getSetting('courier');
  const first = (o.ship_name || '').split(' ')[0] || 'there';
  switch (status) {
    case 'confirmed': return { template: 'order_confirmed', params: [first, o.order_no, money(o.total)],
      body: `Hi ${first}, thank you for shopping with ${store.name}! 🎉 Your order ${o.order_no} for ${money(o.total)} is confirmed${o.payment_method === 'cod' ? ' (Cash on Delivery)' : ''}. Invoice: ${o.invoice_no}. Track: ${trackUrl(o)}` };
    case 'packed': return { body: `${store.name}: your order ${o.order_no} is packed and will be handed to the courier shortly. Track: ${trackUrl(o)}` };
    case 'shipped': return { template: 'order_shipped', params: [first, o.order_no, o.courier || 'courier', o.awb || ''],
      body: `🚚 ${store.name}: order ${o.order_no} has shipped via ${o.courier || 'courier'}${o.awb ? `, AWB ${o.awb}` : ''}. Track: ${o.awb && courier.tracking_url ? courier.tracking_url.replace('{awb}', o.awb) : trackUrl(o)}` };
    case 'out_for_delivery': return { body: `📦 ${store.name}: order ${o.order_no} is out for delivery today.${o.payment_method === 'cod' && o.payment_status !== 'paid' ? ` Please keep ${money(o.total)} ready.` : ''}` };
    case 'delivered': return { template: 'order_delivered', params: [first, o.order_no, String(o.points_earned)],
      body: `✅ ${store.name}: order ${o.order_no} was delivered. You earned ${o.points_earned} Drovox points — use them on your next order! Happy building 🔧` };
    case 'cancelled': return { body: `${store.name}: order ${o.order_no} has been cancelled.${o.payment_status === 'refunded' ? ' Your refund has been initiated.' : ''} Need help? ${store.support_phone}` };
    case 'returned': return { body: `${store.name}: the return for order ${o.order_no} has been recorded. Our team will contact you about the refund.` };
    default: return null;
  }
}

function notifyCustomer(o, status) {
  const user = o.user_id ? get('SELECT whatsapp_opt_in FROM users WHERE id = ?', o.user_id) : null;
  if (user && !user.whatsapp_opt_in) return;
  const m = messageFor(o, status);
  if (m && o.ship_phone) {
    const tpl = getSetting('whatsapp').templates?.[m.template] || null;
    notify(o.ship_phone, m.body, { template: m.template ? tpl : null, params: m.params, order_id: o.id });
  }
}

/** Places an order from a cart. Stock is reserved immediately so two buyers can't take the last unit. */
export function createOrder(user, b) {
  const pm = b.payment_method;
  const pay = getSetting('payments');
  if (!['razorpay', 'cod', 'test'].includes(pm)) throw new QuoteError('Choose a payment method');
  if (pm === 'cod' && !pay.cod_enabled) throw new QuoteError('Cash on delivery is not available');
  const a = b.address || {};
  for (const f of ['name', 'phone', 'line1', 'city', 'state_code', 'pincode']) if (!String(a[f] || '').trim()) throw new QuoteError(`Address ${f.replace('_', ' ')} is required`);
  if (!/^[1-9][0-9]{5}$/.test(String(a.pincode))) throw new QuoteError('Enter a valid 6-digit PIN code');
  if (b.gstin && !validGstin(b.gstin)) throw new QuoteError('GSTIN is not valid');
  // For a registered business buyer, place of supply follows the GSTIN state.
  const pos = b.gstin ? String(b.gstin).slice(0, 2) : String(a.state_code);

  return tx(() => {
    const q = quote({ items: b.items, user, coupon_code: b.coupon_code, redeem_points: b.redeem_points, state_code: pos, payment_method: pm, strict: true });
    if (!q.lines.length) throw new QuoteError('Your cart is empty');
    const orderNo = newOrderNo();
    const addr = [a.line1, a.line2, a.city, a.pincode].filter(Boolean).join(', ');
    const r = run(`INSERT INTO orders(order_no, user_id, status, payment_method, payment_status, subtotal, discount, coupon_code, points_redeemed,
        shipping, cod_fee, taxable, cgst, sgst, igst, total, points_earned, ship_name, ship_phone, ship_address, ship_pincode, place_of_supply, gstin, notes, source)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      orderNo, user.id, 'pending_payment', pm, pm === 'cod' ? 'cod_due' : 'pending', q.subtotal, q.discount, q.coupon?.code ?? null, q.points_redeemed,
      q.shipping, q.cod_fee, q.gst.taxable, q.gst.cgst, q.gst.sgst, q.gst.igst, q.total, q.points_earned,
      a.name.trim(), a.phone.trim(), addr, String(a.pincode), pos, b.gstin ? String(b.gstin).toUpperCase() : null, b.notes || null, b.source || 'web');
    const orderId = Number(r.lastInsertRowid);
    for (const l of q.lines) {
      run(`INSERT INTO order_items(order_id, product_id, sku, name, hsn, qty, unit_price, gst_rate, taxable, tax, total, unit_cost) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        orderId, l.product_id, l.sku, l.name, l.hsn, l.qty, l.unit_price, l.gst_rate, l.taxable, l.tax, l.net_total, l.unit_cost);
      moveStock(l.product_id, -l.qty, 'order', orderNo, user.id);
      run('INSERT INTO events(user_id, type, product_id) VALUES (?,?,?)', user.id, 'purchase', l.product_id);
    }
    if (q.coupon) run('UPDATE coupons SET used = used + 1 WHERE code = ? COLLATE NOCASE', q.coupon.code);
    if (q.points_redeemed) addPoints(user.id, -q.points_redeemed, 'redeem', orderNo);
    run(`UPDATE carts SET items = '[]', value = 0, updated_at = datetime('now') WHERE user_id = ?`, user.id);
    if (a.save) {
      run('INSERT INTO addresses(user_id, name, phone, line1, line2, city, state_code, pincode, is_default) VALUES (?,?,?,?,?,?,?,?,?)',
        user.id, a.name, a.phone, a.line1, a.line2 || null, a.city, a.state_code, a.pincode, get('SELECT COUNT(*) n FROM addresses WHERE user_id=?', user.id).n ? 0 : 1);
    }
    addEvent(orderId, 'pending_payment', 'Order placed');
    if (pm === 'cod') confirmOrder(orderId, null, 'Cash on delivery order auto-confirmed');
    return get('SELECT * FROM orders WHERE id = ?', orderId);
  });
}

/** Confirms an order: assigns the GST invoice number, notifies the customer and the stock team. */
export function confirmOrder(orderId, userId, note) {
  const o = get('SELECT * FROM orders WHERE id = ?', orderId);
  if (o.status !== 'pending_payment') return o;
  run(`UPDATE orders SET status = 'confirmed', invoice_no = COALESCE(invoice_no, ?), updated_at = datetime('now') WHERE id = ?`, nextInvoiceNo(), orderId);
  addEvent(orderId, 'confirmed', note || 'Payment received', userId);
  const fresh = get('SELECT * FROM orders WHERE id = ?', orderId);
  notifyCustomer(fresh, 'confirmed');
  return fresh;
}

export function markPaid(orderId, paymentRef, note) {
  return tx(() => {
    const o = get('SELECT * FROM orders WHERE id = ?', orderId);
    if (!o) throw new Error('order not found');
    if (o.payment_status === 'paid') return o;
    if (o.status === 'cancelled') {
      // Paid after auto-cancel: keep the record so the team can refund or re-open.
      run(`UPDATE orders SET payment_status = 'paid', payment_ref = ?, updated_at = datetime('now') WHERE id = ?`, paymentRef, orderId);
      addEvent(orderId, 'cancelled', `Payment ${paymentRef} received after cancellation — refund required`);
      return get('SELECT * FROM orders WHERE id = ?', orderId);
    }
    run(`UPDATE orders SET payment_status = 'paid', payment_ref = ?, updated_at = datetime('now') WHERE id = ?`, paymentRef, orderId);
    return confirmOrder(orderId, null, note || `Payment received (${paymentRef})`);
  });
}

/** Moves an order to a new status, applying all side effects of that step. */
export function transition(orderId, to, actor, extra = {}) {
  return tx(() => {
    const o = get('SELECT * FROM orders WHERE id = ?', orderId);
    if (!o) throw new QuoteError('Order not found');
    if (!(STATUS_FLOW[o.status] || []).includes(to)) throw new QuoteError(`Cannot move an order from "${STATUS_LABEL[o.status]}" to "${STATUS_LABEL[to] || to}"`);
    if (to === 'confirmed') return confirmOrder(orderId, actor?.id, extra.note || 'Confirmed manually');

    const sets = ['status = ?', "updated_at = datetime('now')"]; const vals = [to];
    if (to === 'shipped') {
      const courier = (extra.courier || o.courier || 'Delhivery').trim();
      const awb = (extra.awb || o.awb || `DRVX${Date.now().toString().slice(-8)}${crypto.randomInt(10, 99)}`).trim();
      sets.push('courier = ?', 'awb = ?'); vals.push(courier, awb);
    }
    if (to === 'delivered' && o.payment_method === 'cod') sets.push(`payment_status = 'paid'`, `payment_ref = COALESCE(payment_ref, 'COD-collected')`);
    if (to === 'cancelled' || to === 'returned') {
      for (const it of all('SELECT * FROM order_items WHERE order_id = ?', orderId)) if (it.product_id) moveStock(it.product_id, it.qty, to === 'cancelled' ? 'cancel' : 'return', o.order_no, actor?.id);
      if (o.points_redeemed && o.user_id) addPoints(o.user_id, o.points_redeemed, 'refund', o.order_no);
      if (to === 'cancelled' && o.coupon_code) run('UPDATE coupons SET used = MAX(0, used - 1) WHERE code = ? COLLATE NOCASE', o.coupon_code);
      if (to === 'returned' && o.user_id) {
        const earned = get(`SELECT COALESCE(SUM(change),0) s FROM points_ledger WHERE user_id = ? AND reason = 'order' AND ref = ?`, o.user_id, o.order_no).s;
        if (earned > 0) addPoints(o.user_id, -earned, 'return', o.order_no);
      }
      if (o.payment_status === 'paid' && o.payment_method !== 'cod') sets.push(`payment_status = 'refunded'`);
      if (o.payment_status === 'cod_due') sets.push(`payment_status = 'void'`);
    }
    run(`UPDATE orders SET ${sets.join(', ')} WHERE id = ?`, ...vals, orderId);
    const fresh = get('SELECT * FROM orders WHERE id = ?', orderId);
    addEvent(orderId, to, extra.note || (to === 'shipped' ? `Shipped via ${fresh.courier}, AWB ${fresh.awb}` : STATUS_LABEL[to]), actor?.id);
    if (to === 'delivered') onOrderDelivered(fresh);
    notifyCustomer(fresh, to);
    return fresh;
  });
}

export function orderDetail(orderId) {
  const o = get('SELECT * FROM orders WHERE id = ?', orderId);
  if (!o) return null;
  o.items = all('SELECT * FROM order_items WHERE order_id = ?', orderId);
  o.events = all('SELECT status, note, created_at FROM order_events WHERE order_id = ? ORDER BY id', orderId);
  o.status_label = STATUS_LABEL[o.status];
  o.next = STATUS_FLOW[o.status];
  return o;
}

/** GST tax invoice data for an order. */
export function invoiceData(orderId) {
  const o = orderDetail(orderId);
  if (!o) return null;
  const store = getSetting('store');
  const intra = o.place_of_supply === store.state_code;
  const charges = o.shipping + o.cod_fee;
  return {
    seller: store, order: o, intra_state: intra,
    lines: o.items.map((i) => ({ ...i, cgst: intra ? round2(i.tax / 2) : 0, sgst: intra ? round2(i.tax / 2) : 0, igst: intra ? 0 : i.tax })),
    charges: charges ? { label: 'Shipping & handling (SAC 996812)', total: charges, taxable: round2(charges / 1.18), tax: round2(charges - charges / 1.18) } : null,
  };
}
