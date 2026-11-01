// Stockist panel API: products, stock adjustments, China import batches with landed cost, and order fulfilment.
import express from 'express';
import { all, get, run, tx, round2, getSetting } from '../db.js';
import { requireArea, audit } from '../auth.js';
import { inventoryForecast } from '../services/engine.js';
import { orderDetail, transition, moveStock, STATUS_LABEL } from '../services/orders.js';
import { notify } from '../services/whatsapp.js';
import { QuoteError } from '../pricing.js';

export const stock = express.Router();
stock.use(requireArea('stock'));

stock.get('/dashboard', (_req, res) => {
  const f = inventoryForecast();
  res.json({
    to_pack: get(`SELECT COUNT(*) n FROM orders WHERE status = 'confirmed'`).n,
    to_ship: get(`SELECT COUNT(*) n FROM orders WHERE status = 'packed'`).n,
    in_transit: get(`SELECT COUNT(*) n FROM orders WHERE status IN ('shipped','out_for_delivery')`).n,
    today_orders: get(`SELECT COUNT(*) n FROM orders WHERE date(created_at) = date('now')`).n,
    low_stock: f.filter((x) => x.status !== 'ok').length, out_of_stock: f.filter((x) => x.status === 'out').length,
    stock_value: round2(f.reduce((s, x) => s + x.stock_value, 0)),
    incoming_batches: get(`SELECT COUNT(*) n FROM stock_batches WHERE status != 'received'`).n,
    latest_orders: all(`SELECT o.id, o.order_no, o.status, o.payment_method, o.payment_status, o.total, o.ship_name, o.created_at,
                          (SELECT GROUP_CONCAT(qty || '× ' || sku, ', ') FROM order_items WHERE order_id = o.id) summary
                        FROM orders o ORDER BY o.id DESC LIMIT 15`).map((o) => ({ ...o, status_label: STATUS_LABEL[o.status] })),
    alerts: f.filter((x) => x.status !== 'ok').slice(0, 10),
  });
});

// ---- orders / fulfilment --------------------------------------------------------------------
stock.get('/orders', (req, res) => {
  const st = req.query.status; const q = String(req.query.q || '').trim();
  const where = []; const vals = [];
  if (st) { where.push('o.status = ?'); vals.push(st); }
  if (q) { where.push('(o.order_no LIKE ? OR o.ship_name LIKE ? OR o.ship_phone LIKE ?)'); vals.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  res.json(all(`SELECT o.id, o.order_no, o.status, o.payment_method, o.payment_status, o.total, o.ship_name, o.ship_phone, o.ship_address, o.courier, o.awb, o.created_at,
                  (SELECT GROUP_CONCAT(qty || '× ' || sku, ', ') FROM order_items WHERE order_id = o.id) summary
                FROM orders o ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.id DESC LIMIT 200`, ...vals)
    .map((o) => ({ ...o, status_label: STATUS_LABEL[o.status] })));
});
stock.get('/orders/:id', (req, res) => { const o = orderDetail(Number(req.params.id)); o ? res.json(o) : res.status(404).json({ error: 'Not found' }); });
stock.post('/orders/:id/status', (req, res, next) => {
  try {
    const { to, courier, awb, note } = req.body || {};
    const o = transition(Number(req.params.id), to, req.user, { courier, awb, note });
    audit(req, `order.${to}`, 'order', o.order_no, { courier: o.courier, awb: o.awb, note });
    res.json(orderDetail(o.id));
  } catch (e) { next(e); }
});
/** Bulk move, e.g. mark every packed order as shipped after the courier pickup. */
stock.post('/orders/bulk-status', (req, res) => {
  const { ids = [], to, courier } = req.body || {};
  const done = []; const failed = [];
  for (const id of ids.slice(0, 200)) {
    try { const o = transition(Number(id), to, req.user, { courier }); done.push(o.order_no); } catch (e) { failed.push({ id, error: e.message }); }
  }
  audit(req, `order.bulk_${to}`, 'order', null, { count: done.length });
  res.json({ done, failed });
});
/** Pick list: total quantity per SKU across all confirmed orders, for the warehouse. */
stock.get('/picklist', (_req, res) => {
  res.json(all(`SELECT oi.sku, oi.name, SUM(oi.qty) qty, COUNT(DISTINCT o.id) orders, p.stock
                FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN products p ON p.id = oi.product_id
                WHERE o.status = 'confirmed' GROUP BY oi.sku ORDER BY oi.sku`));
});

// ---- products --------------------------------------------------------------------------------
stock.get('/products', (req, res) => {
  const q = `%${String(req.query.q || '').trim()}%`;
  res.json(all(`SELECT p.*, c.name category, s.name supplier FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN suppliers s ON s.id = p.supplier_id
                WHERE p.name LIKE ? OR p.sku LIKE ? OR p.tags LIKE ? ORDER BY p.id DESC`, q, q, q));
});
stock.get('/products/:id/movements', (req, res) => res.json(all('SELECT m.*, u.name user FROM stock_movements m LEFT JOIN users u ON u.id = m.user_id WHERE product_id = ? ORDER BY m.id DESC LIMIT 100', req.params.id)));

function productFields(b) {
  const tiers = Array.isArray(b.tiers) ? b.tiers.filter((t) => Number(t.min_qty) > 1 && Number(t.price) > 0).map((t) => ({ min_qty: Number(t.min_qty), price: Number(t.price) })) : [];
  const f = {
    sku: String(b.sku || '').trim().toUpperCase(), name: String(b.name || '').trim(), category_id: Number(b.category_id) || null, brand: b.brand || null,
    description: b.description || '', specs: JSON.stringify(b.specs && typeof b.specs === 'object' ? b.specs : {}), tags: String(b.tags || ''),
    image: b.image || '📦', mrp: Number(b.mrp), price: Number(b.price), cost_price: Number(b.cost_price) || 0, hsn: String(b.hsn || '8542'),
    gst_rate: Number(b.gst_rate ?? 18), reorder_level: Number(b.reorder_level ?? 10), weight_g: Number(b.weight_g) || 50,
    tiers: JSON.stringify(tiers), supplier_id: Number(b.supplier_id) || null, active: b.active === false || b.active === 0 ? 0 : 1,
  };
  if (!f.sku || !f.name) throw new QuoteError('SKU and name are required');
  if (!(f.price > 0) || !(f.mrp >= f.price)) throw new QuoteError('Price must be above 0 and MRP must be at least the price');
  if (![0, 5, 12, 18, 28].includes(f.gst_rate)) throw new QuoteError('GST rate must be 0, 5, 12, 18 or 28');
  if (tiers.some((t) => t.price >= f.price)) throw new QuoteError('Bulk tier prices must be below the unit price');
  return f;
}

stock.post('/products', (req, res, next) => {
  try {
    const f = productFields(req.body || {});
    if (get('SELECT 1 FROM products WHERE sku = ?', f.sku)) throw new QuoteError('SKU already exists');
    const slug = f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) + '-' + f.sku.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const r = run(`INSERT INTO products(sku, name, slug, category_id, brand, description, specs, tags, image, mrp, price, cost_price, hsn, gst_rate, stock, reorder_level, weight_g, tiers, supplier_id, active, created_by)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?)`,
      f.sku, f.name, slug, f.category_id, f.brand, f.description, f.specs, f.tags, f.image, f.mrp, f.price, f.cost_price, f.hsn, f.gst_rate, f.reorder_level, f.weight_g, f.tiers, f.supplier_id, f.active, req.user.id);
    const id = Number(r.lastInsertRowid);
    const opening = Math.floor(Number(req.body.stock) || 0);
    if (opening > 0) moveStock(id, opening, 'adjust', 'opening stock', req.user.id);
    audit(req, 'product.create', 'product', f.sku, { price: f.price, stock: opening });
    res.json(get('SELECT * FROM products WHERE id = ?', id));
  } catch (e) { next(e); }
});

stock.put('/products/:id', (req, res, next) => {
  try {
    const old = get('SELECT * FROM products WHERE id = ?', req.params.id);
    if (!old) return res.status(404).json({ error: 'Not found' });
    const f = productFields({ ...old, specs: JSON.parse(old.specs), tiers: JSON.parse(old.tiers), ...req.body });
    run(`UPDATE products SET sku=?, name=?, category_id=?, brand=?, description=?, specs=?, tags=?, image=?, mrp=?, price=?, cost_price=?, hsn=?, gst_rate=?, reorder_level=?, weight_g=?, tiers=?, supplier_id=?, active=?, updated_at=datetime('now') WHERE id = ?`,
      f.sku, f.name, f.category_id, f.brand, f.description, f.specs, f.tags, f.image, f.mrp, f.price, f.cost_price, f.hsn, f.gst_rate, f.reorder_level, f.weight_g, f.tiers, f.supplier_id, f.active, old.id);
    const changed = Object.fromEntries(Object.entries(f).filter(([k, v]) => String(old[k]) !== String(v)).map(([k, v]) => [k, { from: old[k], to: v }]));
    audit(req, 'product.update', 'product', f.sku, changed);
    const now = get('SELECT * FROM products WHERE id = ?', old.id);
    res.json(now);
  } catch (e) { next(e); }
});

stock.post('/products/:id/adjust', (req, res) => {
  const change = Math.trunc(Number(req.body?.change)); const reason = String(req.body?.reason || 'adjust');
  const p = get('SELECT * FROM products WHERE id = ?', req.params.id);
  if (!p || !change) return res.status(400).json({ error: 'Enter a quantity to add or remove' });
  if (p.stock + change < 0) return res.status(400).json({ error: `Stock cannot go below zero (current ${p.stock})` });
  const bal = tx(() => moveStock(p.id, change, 'adjust', reason.slice(0, 120), req.user.id));
  audit(req, 'stock.adjust', 'product', p.sku, { change, reason, balance: bal });
  if (p.stock <= 0 && bal > 0) notifyBackInStock(p.id);
  res.json({ stock: bal });
});

stock.get('/forecast', (_req, res) => res.json(inventoryForecast()));

// ---- suppliers & China import batches ---------------------------------------------------------
stock.get('/suppliers', (_req, res) => res.json(all('SELECT s.*, (SELECT COUNT(*) FROM products WHERE supplier_id = s.id) products FROM suppliers s ORDER BY name')));
stock.post('/suppliers', (req, res) => {
  const b = req.body || {};
  if (!b.name?.trim()) return res.status(400).json({ error: 'Supplier name is required' });
  const r = run('INSERT INTO suppliers(name, country, city, contact, email, wechat, lead_time_days, notes) VALUES (?,?,?,?,?,?,?,?)',
    b.name.trim(), b.country || 'China', b.city || null, b.contact || null, b.email || null, b.wechat || null, Number(b.lead_time_days) || 21, b.notes || null);
  audit(req, 'supplier.create', 'supplier', r.lastInsertRowid, { name: b.name });
  res.json(get('SELECT * FROM suppliers WHERE id = ?', r.lastInsertRowid));
});

/**
 * Landed cost per unit for an import batch:
 *   goods value (INR)   = qty × unit price × FX rate
 *   freight             allocated to each line by value share
 *   customs duty        = (value + freight share) × duty %      (BCD + SWS on CIF value)
 *   other charges       allocated by value share (CHA, port, local transport)
 * Import IGST is excluded because it is claimed back as input tax credit.
 */
export function landedCosts(batch, items) {
  const value = items.reduce((s, i) => s + i.qty * i.unit_cost_foreign * batch.fx_rate, 0) || 1;
  return items.map((i) => {
    const v = i.qty * i.unit_cost_foreign * batch.fx_rate; const share = v / value;
    const freight = batch.freight_inr * share; const duty = (v + freight) * batch.duty_pct / 100; const other = batch.other_inr * share;
    return { ...i, value_inr: round2(v), freight: round2(freight), duty: round2(duty), other: round2(other), landed_unit_cost: round2((v + freight + duty + other) / i.qty) };
  });
}

stock.get('/batches', (_req, res) => {
  const batches = all('SELECT b.*, s.name supplier FROM stock_batches b LEFT JOIN suppliers s ON s.id = b.supplier_id ORDER BY b.id DESC');
  res.json(batches.map((b) => {
    const items = all('SELECT bi.*, p.sku, p.name, p.price, p.gst_rate FROM stock_batch_items bi JOIN products p ON p.id = bi.product_id WHERE batch_id = ?', b.id);
    const lc = landedCosts(b, items);
    return { ...b, items: lc.map((i) => ({ ...i, margin_pct: Math.round((1 - i.landed_unit_cost / (i.price / (1 + i.gst_rate / 100))) * 100) })), total_landed: round2(lc.reduce((s, i) => s + i.landed_unit_cost * i.qty, 0)) };
  }));
});

stock.post('/batches', (req, res, next) => {
  try {
    const b = req.body || {};
    const items = (b.items || []).map((i) => ({ product_id: Number(i.product_id), qty: Math.floor(Number(i.qty)), unit_cost_foreign: Number(i.unit_cost_foreign) }))
      .filter((i) => i.product_id && i.qty > 0 && i.unit_cost_foreign >= 0);
    if (!String(b.ref || '').trim() || !items.length) throw new QuoteError('A reference and at least one item are required');
    const id = tx(() => {
      const r = run('INSERT INTO stock_batches(ref, supplier_id, currency, fx_rate, freight_inr, duty_pct, other_inr, status, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)',
        b.ref.trim(), Number(b.supplier_id) || null, b.currency || 'CNY', Number(b.fx_rate) || 11.8, Number(b.freight_inr) || 0, Number(b.duty_pct) || 0, Number(b.other_inr) || 0,
        ['ordered', 'in_transit', 'customs'].includes(b.status) ? b.status : 'ordered', b.notes || null, req.user.id);
      for (const i of items) run('INSERT INTO stock_batch_items(batch_id, product_id, qty, unit_cost_foreign) VALUES (?,?,?,?)', r.lastInsertRowid, i.product_id, i.qty, i.unit_cost_foreign);
      return Number(r.lastInsertRowid);
    });
    audit(req, 'batch.create', 'batch', b.ref, { items: items.length });
    res.json({ id });
  } catch (e) { next(e); }
});

/** Receiving a batch adds the stock and updates each product's cost to the weighted-average landed cost. */
stock.post('/batches/:id/status', (req, res) => {
  const to = req.body?.status;
  const b = get('SELECT * FROM stock_batches WHERE id = ?', req.params.id);
  if (!b) return res.status(404).json({ error: 'Not found' });
  if (b.status === 'received') return res.status(400).json({ error: 'Batch already received' });
  if (!['ordered', 'in_transit', 'customs', 'received'].includes(to)) return res.status(400).json({ error: 'Unknown status' });
  const restocked = [];
  tx(() => {
    if (to === 'received') {
      const items = landedCosts(b, all('SELECT * FROM stock_batch_items WHERE batch_id = ?', b.id));
      for (const i of items) {
        const p = get('SELECT stock, cost_price FROM products WHERE id = ?', i.product_id);
        const avg = (Math.max(0, p.stock) * p.cost_price + i.qty * i.landed_unit_cost) / (Math.max(0, p.stock) + i.qty);
        run('UPDATE products SET cost_price = ? WHERE id = ?', round2(avg), i.product_id);
        run('UPDATE stock_batch_items SET landed_unit_cost = ? WHERE id = ?', i.landed_unit_cost, i.id);
        moveStock(i.product_id, i.qty, 'grn', b.ref, req.user.id);
        if (p.stock <= 0) restocked.push(i.product_id);
      }
      run(`UPDATE stock_batches SET status = 'received', received_at = datetime('now') WHERE id = ?`, b.id);
    } else run('UPDATE stock_batches SET status = ? WHERE id = ?', to, b.id);
  });
  restocked.forEach(notifyBackInStock);
  audit(req, `batch.${to}`, 'batch', b.ref);
  res.json({ ok: true });
});

export function notifyBackInStock(productId) {
  const p = get('SELECT name, slug FROM products WHERE id = ?', productId);
  for (const a of all('SELECT * FROM stock_alerts WHERE product_id = ? AND notified_at IS NULL', productId)) {
    notify(a.phone, `Good news! ${p.name} is back in stock at Drovox. Grab it before it sells out: ${getSetting('store').public_url}/#/p/${p.slug}`);
    run(`UPDATE stock_alerts SET notified_at = datetime('now') WHERE id = ?`, a.id);
  }
}
