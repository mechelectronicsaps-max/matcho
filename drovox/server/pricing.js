// Pricing, GST and cart quotation. Every amount the customer pays is computed here, on the server.
// Prices are stored GST-inclusive (as Indian B2C stores display them); GST is back-calculated per line.
import { get, getSetting, round2 } from './db.js';

export const STATES = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand',
  '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim',
  '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya',
  '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh',
  '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
};

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export function validGstin(g) {
  return !g || (GSTIN_RE.test(String(g).toUpperCase()) && STATES[String(g).slice(0, 2)] !== undefined);
}

export function parseTiers(p) {
  try { return (JSON.parse(p.tiers || '[]') || []).filter((t) => t.min_qty > 1 && t.price > 0).sort((a, b) => a.min_qty - b.min_qty); } catch { return []; }
}

/** Unit price for a quantity, honouring bulk tiers. */
export function unitPriceFor(p, qty) {
  let price = p.price;
  for (const t of parseTiers(p)) if (qty >= t.min_qty) price = Math.min(price, t.price);
  return price;
}

/** Splits a GST-inclusive amount into taxable value and tax. */
export function splitInclusive(amountIncl, rate) {
  const taxable = amountIncl / (1 + rate / 100);
  return { taxable, tax: amountIncl - taxable };
}

export class QuoteError extends Error { constructor(msg) { super(msg); this.status = 400; } }

export function loyaltyTier(user) {
  const L = getSetting('loyalty');
  if (!user) return L.tiers[0];
  const spend = get(`SELECT COALESCE(SUM(total),0) s FROM orders WHERE user_id = ? AND status = 'delivered'`, user.id).s;
  let tier = L.tiers[0];
  for (const t of L.tiers) if (spend >= t.min_spend) tier = t;
  return { ...tier, spend };
}

export function validateCoupon(code, user, subtotal) {
  if (!code) return null;
  const c = get('SELECT * FROM coupons WHERE code = ? AND active = 1', String(code).trim());
  if (!c) throw new QuoteError('Coupon code is not valid');
  if (c.expires_at && new Date(c.expires_at) < new Date()) throw new QuoteError('Coupon has expired');
  if (c.max_uses != null && c.used >= c.max_uses) throw new QuoteError('Coupon usage limit reached');
  if (subtotal < c.min_order) throw new QuoteError(`Coupon needs a minimum order of ₹${c.min_order}`);
  if (user) {
    const used = get(`SELECT COUNT(*) n FROM orders WHERE user_id = ? AND coupon_code = ? COLLATE NOCASE AND status != 'cancelled'`, user.id, c.code).n;
    if (c.per_user && used >= c.per_user) throw new QuoteError('You have already used this coupon');
    if (c.first_order_only) {
      const prior = get(`SELECT COUNT(*) n FROM orders WHERE user_id = ? AND status != 'cancelled'`, user.id).n;
      if (prior > 0) throw new QuoteError('This coupon is for first orders only');
    }
  } else if (c.first_order_only || c.per_user) {
    // anonymous quote: allowed for preview, re-checked at checkout with the account
  }
  return c;
}

/**
 * Builds a full quotation for a cart.
 * @param {object} o { items:[{product_id, qty}], user, coupon_code, redeem_points, state_code, payment_method, strict }
 */
export function quote(o) {
  const store = getSetting('store');
  const ship = getSetting('shipping');
  const L = getSetting('loyalty');
  const lines = [];
  const warnings = [];
  const merged = new Map();
  for (const it of o.items || []) {
    const id = Number(it.product_id); const qty = Math.floor(Number(it.qty));
    if (!id || !(qty > 0)) continue;
    merged.set(id, (merged.get(id) || 0) + qty);
  }
  for (const [id, qtyWanted] of merged) {
    const p = get('SELECT * FROM products WHERE id = ? AND active = 1', id);
    if (!p) { warnings.push(`A product in your cart is no longer available`); continue; }
    let qty = Math.min(qtyWanted, 999);
    if (p.stock <= 0) { if (o.strict) throw new QuoteError(`${p.name} is out of stock`); warnings.push(`${p.name} is out of stock`); continue; }
    if (qty > p.stock) {
      if (o.strict) throw new QuoteError(`Only ${p.stock} units of ${p.name} are in stock`);
      warnings.push(`Only ${p.stock} units of ${p.name} available — quantity adjusted`); qty = p.stock;
    }
    const unit = unitPriceFor(p, qty);
    const tiers = parseTiers(p);
    const next = tiers.find((t) => t.min_qty > qty);
    lines.push({
      product_id: p.id, sku: p.sku, name: p.name, image: p.image, hsn: p.hsn, gst_rate: p.gst_rate, qty,
      unit_price: unit, list_price: p.price, mrp: p.mrp, line_total: round2(unit * qty), stock: p.stock,
      unit_cost: p.cost_price,
      nudge: next ? { add: next.min_qty - qty, unit_price: next.price, save: round2((unit - next.price) * next.min_qty) } : null,
    });
  }
  const subtotal = round2(lines.reduce((s, l) => s + l.line_total, 0));

  let coupon = null; let discount = 0; let couponError = null;
  try { coupon = validateCoupon(o.coupon_code, o.user, subtotal); } catch (e) { if (o.strict) throw e; couponError = e.message; }
  if (coupon) {
    if (coupon.type === 'percent') discount = subtotal * coupon.value / 100;
    else if (coupon.type === 'flat') discount = coupon.value;
    if (coupon.max_discount) discount = Math.min(discount, coupon.max_discount);
    discount = round2(Math.min(discount, subtotal));
  }

  // Loyalty points
  const userPoints = o.user ? (get('SELECT points FROM users WHERE id = ?', o.user.id)?.points || 0) : 0;
  const maxByOrder = Math.floor(((subtotal - discount) * L.max_redeem_pct / 100) / L.point_value);
  const maxRedeemable = Math.max(0, Math.min(userPoints, maxByOrder));
  let points = 0;
  if (o.redeem_points) {
    const want = o.redeem_points === true || o.redeem_points === 'max' ? maxRedeemable : Math.floor(Number(o.redeem_points));
    points = Math.max(0, Math.min(want, maxRedeemable));
  }
  const pointsValue = round2(points * L.point_value);

  const afterDiscount = subtotal - discount - pointsValue;
  const freeShip = (coupon && coupon.type === 'free_ship') || subtotal - discount >= ship.free_above || lines.length === 0;
  const shipping = freeShip ? 0 : ship.flat_fee;
  const isCod = o.payment_method === 'cod';
  const codFee = isCod ? ship.cod_fee : 0;

  // Allocate order-level reductions over lines in proportion to their value, then back out GST.
  const reduce = discount + pointsValue;
  const placeOfSupply = o.state_code || store.state_code;
  const intra = placeOfSupply === store.state_code;
  let taxable = 0; let tax = 0;
  const byRate = {};
  for (const l of lines) {
    const share = subtotal > 0 ? l.line_total / subtotal : 0;
    const net = l.line_total - reduce * share;
    const s = splitInclusive(net, l.gst_rate);
    l.taxable = round2(s.taxable); l.tax = round2(s.tax); l.net_total = round2(net);
    taxable += s.taxable; tax += s.tax;
    const k = String(l.gst_rate); byRate[k] = byRate[k] || { rate: l.gst_rate, taxable: 0, tax: 0 };
    byRate[k].taxable += s.taxable; byRate[k].tax += s.tax;
  }
  const charges = shipping + codFee;
  if (charges > 0) {
    const s = splitInclusive(charges, 18);
    taxable += s.taxable; tax += s.tax;
    byRate['18'] = byRate['18'] || { rate: 18, taxable: 0, tax: 0 };
    byRate['18'].taxable += s.taxable; byRate['18'].tax += s.tax;
  }
  const total = round2(afterDiscount + charges);
  const tier = loyaltyTier(o.user);
  const pointsEarned = Math.floor((total / 100) * L.earn_per_100 * (tier.multiplier || 1));

  if (isCod && total > ship.cod_max_order) {
    if (o.strict) throw new QuoteError(`Cash on delivery is available up to ₹${ship.cod_max_order}`);
    warnings.push(`Cash on delivery is available up to ₹${ship.cod_max_order}`);
  }

  return {
    lines, subtotal, coupon: coupon ? { code: coupon.code, type: coupon.type, value: coupon.value, description: coupon.description } : null,
    coupon_error: couponError, discount, points_redeemed: points, points_value: pointsValue,
    points_available: userPoints, points_max_redeemable: maxRedeemable,
    shipping, cod_fee: codFee, total,
    gst: {
      place_of_supply: placeOfSupply, state: STATES[placeOfSupply] || placeOfSupply, intra_state: intra,
      taxable: round2(taxable), total_tax: round2(tax),
      cgst: intra ? round2(tax / 2) : 0, sgst: intra ? round2(tax / 2) : 0, igst: intra ? 0 : round2(tax),
      by_rate: Object.values(byRate).map((r) => ({ rate: r.rate, taxable: round2(r.taxable), tax: round2(r.tax) })),
    },
    savings: round2(lines.reduce((s, l) => s + (l.mrp - l.unit_price) * l.qty, 0) + discount + pointsValue + (freeShip && lines.length ? ship.flat_fee : 0)),
    free_shipping: { threshold: ship.free_above, remaining: freeShip ? 0 : round2(ship.free_above - (subtotal - discount)), unlocked: freeShip },
    points_earned: pointsEarned, tier: { name: tier.name, multiplier: tier.multiplier },
    warnings,
  };
}
