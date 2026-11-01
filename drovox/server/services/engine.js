// Drovox intelligence engine: trending scores, recommendations, demand forecasting / reorder
// suggestions, customer segmentation and lead scoring. Pure SQL + JS, no external services.
import { all, get, getSetting, round2 } from '../db.js';

const HALF_LIFE_H = 72; // a signal loses half its weight every 3 days
const WEIGHT = { view: 1, search: 0.5, add_to_cart: 4, checkout: 5, purchase: 8 };

/**
 * Trending score = Σ weight(event) · 0.5^(age_hours / half-life), normalised by 1 + log(views)
 * dampening so cheap, heavily-browsed items don't always win over items that actually sell.
 */
export function trending(limit = 12, days = 14) {
  const rows = all(`SELECT product_id, type, (julianday('now') - julianday(created_at)) * 24 AS age_h
                    FROM events WHERE product_id IS NOT NULL AND created_at >= datetime('now', ?)`, `-${days} days`);
  const score = new Map();
  for (const r of rows) {
    const w = (WEIGHT[r.type] || 0) * Math.pow(0.5, r.age_h / HALF_LIFE_H);
    score.set(r.product_id, (score.get(r.product_id) || 0) + w);
  }
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit * 2);
  const out = [];
  for (const [id, s] of ranked) {
    const p = get('SELECT * FROM products WHERE id = ? AND active = 1', id);
    if (!p) continue;
    const sold7 = get(`SELECT COALESCE(SUM(oi.qty),0) q FROM order_items oi JOIN orders o ON o.id = oi.order_id
                       WHERE oi.product_id = ? AND o.status != 'cancelled' AND o.created_at >= datetime('now','-7 days')`, id).q;
    const soldPrev = get(`SELECT COALESCE(SUM(oi.qty),0) q FROM order_items oi JOIN orders o ON o.id = oi.order_id
                       WHERE oi.product_id = ? AND o.status != 'cancelled' AND o.created_at >= datetime('now','-14 days') AND o.created_at < datetime('now','-7 days')`, id).q;
    out.push({ ...p, trend_score: round2(s), sold_7d: sold7, growth_pct: soldPrev ? Math.round(((sold7 - soldPrev) / soldPrev) * 100) : (sold7 ? 100 : 0) });
    if (out.length >= limit) break;
  }
  if (out.length < limit) {
    const have = new Set(out.map((p) => p.id));
    for (const p of all('SELECT * FROM products WHERE active = 1 ORDER BY views DESC LIMIT ?', limit * 2)) {
      if (!have.has(p.id)) out.push({ ...p, trend_score: 0, sold_7d: 0, growth_pct: 0 });
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** "Frequently bought together": products that co-occur in orders with the given product (lift-ranked). */
export function boughtTogether(productId, limit = 4) {
  const totalOrders = get(`SELECT COUNT(*) n FROM orders WHERE status != 'cancelled'`).n || 1;
  const rows = all(`
    SELECT b.product_id id, COUNT(DISTINCT a.order_id) together,
           (SELECT COUNT(DISTINCT order_id) FROM order_items WHERE product_id = b.product_id) freq
    FROM order_items a JOIN order_items b ON a.order_id = b.order_id AND b.product_id != a.product_id
    JOIN orders o ON o.id = a.order_id AND o.status != 'cancelled'
    WHERE a.product_id = ? GROUP BY b.product_id`, productId);
  const base = get('SELECT COUNT(DISTINCT order_id) n FROM order_items WHERE product_id = ?', productId).n || 1;
  const scored = rows.map((r) => ({ id: r.id, lift: (r.together / base) / ((r.freq || 1) / totalOrders), together: r.together }))
    .filter((r) => r.together >= 1).sort((a, b) => b.together * b.lift - a.together * a.lift);
  const out = [];
  for (const r of scored) {
    const p = get('SELECT * FROM products WHERE id = ? AND active = 1 AND stock > 0', r.id);
    if (p) out.push(p);
    if (out.length >= limit) break;
  }
  if (out.length < limit) {
    // fall back to items from the same category that share tags (content-based)
    const p = get('SELECT * FROM products WHERE id = ?', productId);
    if (p) {
      const tags = p.tags.split(',').map((t) => t.trim()).filter(Boolean);
      const cands = all('SELECT * FROM products WHERE id != ? AND active = 1 AND stock > 0', productId)
        .map((c) => ({ c, s: (c.category_id === p.category_id ? 1 : 0) + c.tags.split(',').filter((t) => tags.includes(t.trim())).length * 2 }))
        .filter((x) => x.s > 0 && !out.find((o) => o.id === x.c.id)).sort((a, b) => b.s - a.s);
      for (const x of cands) { out.push(x.c); if (out.length >= limit) break; }
    }
  }
  return out;
}

/**
 * Personalised "Recommended for you": blends the user's recent category affinity, co-purchase
 * neighbours of what they bought/carted, and global trending — excluding items they already bought.
 */
export function recommendFor({ userId, sessionId, recentIds = [] }, limit = 8) {
  const seen = new Set();
  const bought = new Set(userId ? all(`SELECT DISTINCT oi.product_id id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.user_id = ?`, userId).map((r) => r.id) : []);
  const evts = all(`SELECT product_id, type FROM events WHERE product_id IS NOT NULL AND (user_id = ? OR session_id = ?) AND created_at >= datetime('now','-30 days') ORDER BY id DESC LIMIT 200`, userId ?? -1, sessionId ?? '');
  const ids = [...new Set([...recentIds.map(Number), ...evts.map((e) => e.product_id)])].slice(0, 12);
  const catW = new Map();
  for (const e of evts) {
    const c = get('SELECT category_id FROM products WHERE id = ?', e.product_id)?.category_id;
    if (c) catW.set(c, (catW.get(c) || 0) + (WEIGHT[e.type] || 1));
  }
  const score = new Map();
  const bump = (id, s) => { if (!bought.has(id) && !ids.includes(id)) score.set(id, (score.get(id) || 0) + s); };
  for (const id of ids.slice(0, 6)) for (const p of boughtTogether(id, 6)) bump(p.id, 5);
  for (const p of all('SELECT id, category_id FROM products WHERE active = 1 AND stock > 0')) if (catW.has(p.category_id)) bump(p.id, Math.log2(1 + catW.get(p.category_id)));
  trending(12).forEach((p, i) => bump(p.id, (12 - i) / 6));
  const out = [];
  for (const [id] of [...score.entries()].sort((a, b) => b[1] - a[1])) {
    if (seen.has(id)) continue; seen.add(id);
    const p = get('SELECT * FROM products WHERE id = ? AND active = 1 AND stock > 0', id);
    if (p) out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

/** Real social-proof numbers shown on product pages (never invented). */
export function socialProof(productId) {
  const sold24 = get(`SELECT COALESCE(SUM(oi.qty),0) q FROM order_items oi JOIN orders o ON o.id = oi.order_id
                      WHERE oi.product_id = ? AND o.status != 'cancelled' AND o.created_at >= datetime('now','-1 day')`, productId).q;
  const buyers30 = get(`SELECT COUNT(DISTINCT o.user_id) n FROM order_items oi JOIN orders o ON o.id = oi.order_id
                      WHERE oi.product_id = ? AND o.status != 'cancelled' AND o.created_at >= datetime('now','-30 days')`, productId).n;
  const viewers = get(`SELECT COUNT(DISTINCT COALESCE(session_id, user_id)) n FROM events WHERE product_id = ? AND type = 'view' AND created_at >= datetime('now','-1 hour')`, productId).n;
  return { sold_24h: sold24, buyers_30d: buyers30, viewing_now: viewers };
}

/**
 * Inventory forecast. Velocity is an exponentially weighted blend of 7-day and 30-day sales
 * (recent demand counts more). Days of cover = stock / velocity. A reorder is suggested when
 * cover falls below supplier lead time + safety days; suggested qty covers the target horizon.
 */
export function inventoryForecast() {
  const inv = getSetting('inventory');
  const rows = all(`
    SELECT p.*, c.name category, s.name supplier, COALESCE(s.lead_time_days, 21) lead_time,
      COALESCE((SELECT SUM(oi.qty) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.status != 'cancelled' AND o.created_at >= datetime('now','-7 days')),0) s7,
      COALESCE((SELECT SUM(oi.qty) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.status != 'cancelled' AND o.created_at >= datetime('now','-30 days')),0) s30,
      COALESCE((SELECT SUM(bi.qty) FROM stock_batch_items bi JOIN stock_batches b ON b.id = bi.batch_id WHERE bi.product_id = p.id AND b.status != 'received'),0) incoming
    FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN suppliers s ON s.id = p.supplier_id
    WHERE p.active = 1`);
  return rows.map((p) => {
    const velocity = 0.6 * (p.s7 / 7) + 0.4 * (p.s30 / 30);
    const cover = velocity > 0 ? p.stock / velocity : Infinity;
    let need = velocity * (p.lead_time + inv.target_cover_days) - p.stock - p.incoming;
    // No sales history (e.g. out of stock for a while): restock to twice the reorder level.
    if (velocity === 0 && p.stock + p.incoming <= p.reorder_level) need = p.reorder_level * 2 - p.stock - p.incoming;
    const reorder = (cover < p.lead_time + inv.safety_days || p.stock <= p.reorder_level) && need > 0;
    let status = 'ok';
    if (p.stock <= 0) status = 'out';
    else if (p.stock <= p.reorder_level || cover < p.lead_time) status = 'critical';
    else if (cover < p.lead_time + inv.safety_days) status = 'low';
    return {
      id: p.id, sku: p.sku, name: p.name, category: p.category, supplier: p.supplier, stock: p.stock, incoming: p.incoming,
      reorder_level: p.reorder_level, sold_7d: p.s7, sold_30d: p.s30, velocity_per_day: round2(velocity),
      days_of_cover: Number.isFinite(cover) ? Math.round(cover) : null, lead_time_days: p.lead_time, status,
      suggested_reorder_qty: reorder ? Math.max(Math.ceil(need / 10) * 10, p.reorder_level) : 0, cost_price: p.cost_price,
      stock_value: round2(p.stock * p.cost_price),
    };
  }).sort((a, b) => ({ out: 0, critical: 1, low: 2, ok: 3 }[a.status] - { out: 0, critical: 1, low: 2, ok: 3 }[b.status]) || (a.days_of_cover ?? 1e9) - (b.days_of_cover ?? 1e9));
}

/** RFM segmentation of customers for CRM and campaign targeting. */
export function customerSegments() {
  const rows = all(`
    SELECT u.id, u.name, u.email, u.phone, u.points, u.created_at, u.last_seen,
      COUNT(o.id) orders, COALESCE(SUM(o.total),0) spend, MAX(o.created_at) last_order
    FROM users u LEFT JOIN orders o ON o.user_id = u.id AND o.status NOT IN ('cancelled','pending_payment')
    WHERE u.role = 'customer' GROUP BY u.id`);
  return rows.map((r) => {
    const recency = r.last_order ? (Date.now() - new Date(r.last_order.replace(' ', 'T') + 'Z').getTime()) / 864e5 : null;
    let segment = 'new';
    if (!r.orders) segment = recency === null && r.last_seen ? 'browser' : 'new';
    else if (r.orders >= 3 && recency <= 45) segment = 'champion';
    else if (r.orders >= 2 && recency <= 90) segment = 'loyal';
    else if (recency <= 30) segment = 'recent';
    else if (recency <= 120) segment = 'at_risk';
    else segment = 'lost';
    return { ...r, spend: round2(r.spend), aov: r.orders ? round2(r.spend / r.orders) : 0, days_since_order: recency == null ? null : Math.round(recency), segment };
  });
}

/** Lead score 0-100 from source, value, engagement and recency. */
export function scoreLead(l) {
  const src = { bulk_quote: 30, ai_builder: 25, referral: 25, whatsapp: 20, website: 15, manual: 10 }[l.source] ?? 10;
  const value = Math.min(30, Math.log10(1 + (l.value_estimate || 0)) * 7);
  const acts = l.id ? get('SELECT COUNT(*) n FROM lead_activities WHERE lead_id = ?', l.id).n : 0;
  const engage = Math.min(20, acts * 4);
  const contact = (l.phone ? 8 : 0) + (l.email ? 4 : 0) + (l.company ? 8 : 0);
  return Math.min(100, Math.round(src + value + engage + contact));
}
