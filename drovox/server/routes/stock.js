// Stockist panel API: products, stock adjustments, China import batches with landed cost, and order fulfilment.
import express from 'express';
import { all, get, run, tx, round2, getSetting } from '../db.js';
import { requireArea, audit } from '../auth.js';
import { inventoryForecast } from '../services/engine.js';
import { orderDetail, transition, moveStock, STATUS_LABEL } from '../services/orders.js';
import { notify, sendWhatsApp } from '../services/whatsapp.js';
import { addCategory, addStarterCategories, nextSku } from '../catalog.js';
import { QuoteError } from '../pricing.js';
import { saveImage, deleteImage, parseImages, MAX_IMAGES } from '../images.js';
import { writeProductInfo } from '../services/ai.js';

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
    products: get('SELECT COUNT(*) n FROM products').n, categories: get('SELECT COUNT(*) n FROM categories').n,
    jobs_open: get(`SELECT COUNT(*) n FROM custom_jobs WHERE status IN ('pending','in_progress')`).n,
    jobs_ready: get(`SELECT COUNT(*) n FROM custom_jobs WHERE status = 'ready'`).n,
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

const list = (v, max, len) => (Array.isArray(v) ? v : String(v || '').split('\n')).map((x) => String(x).trim().slice(0, len)).filter(Boolean).slice(0, max);
function productFields(b) {
  const tiers = Array.isArray(b.tiers) ? b.tiers.filter((t) => Number(t.min_qty) > 1 && Number(t.price) > 0).map((t) => ({ min_qty: Number(t.min_qty), price: Number(t.price) })) : [];
  const f = {
    sku: String(b.sku || '').trim().toUpperCase(), name: String(b.name || '').trim(), category_id: Number(b.category_id) || null, brand: b.brand || null,
    description: b.description || '', specs: JSON.stringify(b.specs && typeof b.specs === 'object' ? b.specs : {}), tags: String(b.tags || ''),
    image: b.image || '📦', mrp: Number(b.mrp), price: Number(b.price), cost_price: Number(b.cost_price) || 0, hsn: String(b.hsn || '8542'),
    gst_rate: Number(b.gst_rate ?? 18), reorder_level: Number(b.reorder_level ?? 10), weight_g: Number(b.weight_g) || 50,
    tiers: JSON.stringify(tiers), supplier_id: Number(b.supplier_id) || null, active: b.active === false || b.active === 0 ? 0 : 1,
    barcode: String(b.barcode || '').trim() || null,
    short_description: String(b.short_description || '').trim().slice(0, 600) || null,
    highlights: JSON.stringify(list(b.highlights, 10, 200)), in_box: JSON.stringify(list(b.in_box, 20, 120)),
  };
  if (!f.sku || !f.name) throw new QuoteError('SKU and name are required');
  if (!(f.price > 0) || !(f.mrp >= f.price)) throw new QuoteError('Price must be above 0 and MRP must be at least the price');
  if (![0, 5, 12, 18, 28].includes(f.gst_rate)) throw new QuoteError('GST rate must be 0, 5, 12, 18 or 28');
  if (tiers.some((t) => t.price >= f.price)) throw new QuoteError('Bulk tier prices must be below the unit price');
  if (!/^[A-Z0-9][A-Z0-9-]{1,39}$/.test(f.sku)) throw new QuoteError('SKU may contain only letters, digits and dashes');
  return f;
}

stock.post('/products', (req, res, next) => {
  try {
    const b = { ...(req.body || {}) };
    if (!String(b.sku || '').trim() || String(b.sku).trim().toUpperCase() === 'AUTO') b.sku = nextSku(Number(b.category_id) || null);
    const f = productFields(b);
    if (get('SELECT 1 FROM products WHERE sku = ?', f.sku)) throw new QuoteError('SKU already exists');
    if (f.barcode && get('SELECT 1 FROM products WHERE barcode = ? OR sku = ?', f.barcode, f.barcode)) throw new QuoteError('That barcode is already used by another product');
    const slug = f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) + '-' + f.sku.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const r = run(`INSERT INTO products(sku, name, slug, category_id, brand, description, specs, tags, image, mrp, price, cost_price, hsn, gst_rate, stock, reorder_level, weight_g, tiers, supplier_id, active, created_by, barcode, short_description, highlights, in_box)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,?)`,
      f.sku, f.name, slug, f.category_id, f.brand, f.description, f.specs, f.tags, f.image, f.mrp, f.price, f.cost_price, f.hsn, f.gst_rate, f.reorder_level, f.weight_g, f.tiers, f.supplier_id, f.active, req.user.id, f.barcode, f.short_description, f.highlights, f.in_box);
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
    const f = productFields({ ...old, specs: JSON.parse(old.specs), tiers: JSON.parse(old.tiers), highlights: JSON.parse(old.highlights || '[]'), in_box: JSON.parse(old.in_box || '[]'), ...req.body });
    if (f.sku !== old.sku && get('SELECT 1 FROM products WHERE sku = ? AND id != ?', f.sku, old.id)) throw new QuoteError('SKU already exists');
    if (f.barcode && get('SELECT 1 FROM products WHERE (barcode = ? OR sku = ?) AND id != ?', f.barcode, f.barcode, old.id)) throw new QuoteError('That barcode is already used by another product');
    run(`UPDATE products SET sku=?, name=?, category_id=?, brand=?, description=?, specs=?, tags=?, image=?, mrp=?, price=?, cost_price=?, hsn=?, gst_rate=?, reorder_level=?, weight_g=?, tiers=?, supplier_id=?, active=?, barcode=?, short_description=?, highlights=?, in_box=?, updated_at=datetime('now') WHERE id = ?`,
      f.sku, f.name, f.category_id, f.brand, f.description, f.specs, f.tags, f.image, f.mrp, f.price, f.cost_price, f.hsn, f.gst_rate, f.reorder_level, f.weight_g, f.tiers, f.supplier_id, f.active, f.barcode, f.short_description, f.highlights, f.in_box, old.id);
    const changed = Object.fromEntries(Object.entries(f).filter(([k, v]) => String(old[k]) !== String(v)).map(([k, v]) => [k, { from: old[k], to: v }]));
    audit(req, 'product.update', 'product', f.sku, changed);
    const now = get('SELECT * FROM products WHERE id = ?', old.id);
    res.json(now);
  } catch (e) { next(e); }
});

// ---- product photos (3–5 per product; resized in the browser) ---------------------------------
stock.post('/products/:id/images', (req, res, next) => {
  try {
    const p = get('SELECT id, sku, images FROM products WHERE id = ?', req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const imgs = parseImages(p.images);
    if (imgs.length >= MAX_IMAGES) return res.status(400).json({ error: `A product can have up to ${MAX_IMAGES} photos — delete one first` });
    const key = saveImage(req.body?.variants);
    imgs.push(key);
    run(`UPDATE products SET images = ?, updated_at = datetime('now') WHERE id = ?`, JSON.stringify(imgs), p.id);
    audit(req, 'product.image_add', 'product', p.sku, { key });
    res.json({ images: imgs });
  } catch (e) { next(e); }
});
stock.put('/products/:id/images', (req, res) => {
  const p = get('SELECT id, sku, images FROM products WHERE id = ?', req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const cur = parseImages(p.images); const want = Array.isArray(req.body?.images) ? req.body.images.map(String) : [];
  if (want.length !== cur.length || !want.every((k) => cur.includes(k))) return res.status(400).json({ error: 'Send the same photos in the new order' });
  run(`UPDATE products SET images = ?, updated_at = datetime('now') WHERE id = ?`, JSON.stringify(want), p.id);
  res.json({ images: want });
});
stock.delete('/products/:id/images/:key', (req, res) => {
  const p = get('SELECT id, sku, images FROM products WHERE id = ?', req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const imgs = parseImages(p.images);
  if (!imgs.includes(req.params.key)) return res.status(404).json({ error: 'Photo not found' });
  deleteImage(req.params.key);
  const left = imgs.filter((k) => k !== req.params.key);
  run(`UPDATE products SET images = ?, updated_at = datetime('now') WHERE id = ?`, JSON.stringify(left), p.id);
  audit(req, 'product.image_delete', 'product', p.sku, { key: req.params.key });
  res.json({ images: left });
});

/** ✨ Write the product listing (short description, highlights, specs, box contents, tags) with Claude. */
stock.post('/products/ai-fill', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!String(b.name || '').trim()) return res.status(400).json({ error: 'Enter the product name first' });
    const cat = b.category_id ? get('SELECT name FROM categories WHERE id = ?', b.category_id)?.name : '';
    const out = await writeProductInfo({ name: String(b.name).slice(0, 200), brand: String(b.brand || '').slice(0, 80), category: cat || '', specs: b.specs || {}, notes: String(b.description || '').slice(0, 2000) });
    audit(req, 'product.ai_fill', 'product', String(b.sku || b.name).slice(0, 60), {});
    res.json(out);
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

// ---- categories & SKU codes ---------------------------------------------------------------------
stock.get('/categories', (_req, res) => res.json(all('SELECT c.*, (SELECT COUNT(*) FROM products WHERE category_id = c.id) products FROM categories c ORDER BY sort, name')));
stock.post('/categories', (req, res) => {
  const b = req.body || {};
  if (!String(b.name || '').trim()) return res.status(400).json({ error: 'Category name is required' });
  const c = addCategory(b);
  audit(req, 'category.create', 'category', c.id, { name: c.name, code: c.code });
  res.json(c);
});
stock.post('/categories/starter', (req, res) => {
  const added = addStarterCategories();
  audit(req, 'category.starter', 'category', null, { added });
  res.json({ added });
});
// category photo (shown on the app's Categories grid and the home page tiles)
stock.post('/categories/:id/image', (req, res, next) => {
  try {
    const c = get('SELECT * FROM categories WHERE id = ?', req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    const key = saveImage(req.body?.variants);
    if (c.image) deleteImage(c.image);
    run('UPDATE categories SET image = ? WHERE id = ?', key, c.id);
    res.json({ image: key });
  } catch (e) { next(e); }
});
stock.delete('/categories/:id/image', (req, res) => {
  const c = get('SELECT * FROM categories WHERE id = ?', req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (c.image) deleteImage(c.image);
  run('UPDATE categories SET image = NULL WHERE id = ?', c.id);
  res.json({ ok: true });
});
stock.put('/categories/:id', (req, res) => {
  const c = get('SELECT * FROM categories WHERE id = ?', req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const code = b.code ? String(b.code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) : c.code;
  run('UPDATE categories SET name = ?, icon = ?, code = ?, sort = ? WHERE id = ?', String(b.name || c.name).trim(), b.icon || c.icon, code, Number(b.sort ?? c.sort), c.id);
  audit(req, 'category.update', 'category', c.id, b);
  res.json(get('SELECT * FROM categories WHERE id = ?', c.id));
});
stock.delete('/categories/:id', (req, res) => {
  const n = get('SELECT COUNT(*) n FROM products WHERE category_id = ?', req.params.id).n;
  if (n) return res.status(400).json({ error: `Move or delete its ${n} product(s) first` });
  run('DELETE FROM categories WHERE id = ?', req.params.id);
  audit(req, 'category.delete', 'category', req.params.id);
  res.json({ ok: true });
});
stock.get('/sku-next', (req, res) => res.json({ sku: nextSku(Number(req.query.category_id) || null) }));
stock.get('/store-info', (_req, res) => {
  const s = getSetting('store');
  res.json({ name: s.name, legal_name: s.legal_name, address: s.address, gstin: s.gstin, support_phone: s.support_phone, public_url: s.public_url, sku_prefix: s.sku_prefix || 'DRV' });
});

// ---- barcode / QR scanning ---------------------------------------------------------------------
/** Resolves a scanned code: product SKU or barcode, order number, or custom job number. */
function lookupCode(raw) {
  let code = String(raw || '').trim();
  // QR labels encode the product URL (…/#/p/<sku-or-slug>); take the last path part.
  const m = code.match(/#\/p\/([^/?#\s]+)/); if (m) code = decodeURIComponent(m[1]);
  const t = code.match(/#\/track\/([^/?#\s]+)/); if (t) code = decodeURIComponent(t[1]);
  if (!code) return null;
  const p = get('SELECT * FROM products WHERE sku = ? COLLATE NOCASE OR barcode = ? OR slug = ?', code, code, code);
  if (p) return { type: 'product', product: p };
  const o = get('SELECT id, order_no, status FROM orders WHERE order_no = ? COLLATE NOCASE', code);
  if (o) return { type: 'order', order: o };
  const j = get('SELECT * FROM custom_jobs WHERE job_no = ? COLLATE NOCASE', code);
  if (j) return { type: 'job', job: j };
  return null;
}
stock.get('/scan/:code', (req, res) => {
  const r = lookupCode(req.params.code);
  r ? res.json(r) : res.status(404).json({ error: `No product, order or job matches “${req.params.code}”` });
});
/** Stock in / out by scan. change > 0 adds, < 0 removes. */
stock.post('/scan-adjust', (req, res) => {
  const r = lookupCode(req.body?.code);
  if (!r || r.type !== 'product') return res.status(404).json({ error: `No product matches “${req.body?.code}”` });
  const p = r.product; const change = Math.trunc(Number(req.body?.change));
  if (!change) return res.status(400).json({ error: 'Quantity is required' });
  if (p.stock + change < 0) return res.status(400).json({ error: `Only ${p.stock} in stock for ${p.sku}` });
  const reason = String(req.body?.reason || (change > 0 ? 'scan in' : 'scan out')).slice(0, 120);
  const bal = tx(() => moveStock(p.id, change, 'adjust', reason, req.user.id));
  audit(req, change > 0 ? 'stock.scan_in' : 'stock.scan_out', 'product', p.sku, { change, reason, balance: bal });
  if (p.stock <= 0 && bal > 0) notifyBackInStock(p.id);
  res.json({ product: { id: p.id, sku: p.sku, name: p.name, image: p.image, category_id: p.category_id }, change, stock: bal });
});

// ---- custom / made-to-order jobs ---------------------------------------------------------------
const JOB_STATUS = ['pending', 'in_progress', 'ready', 'delivered', 'cancelled'];
function newJobNo() {
  const y = String(new Date().getFullYear()).slice(2);
  const n = get(`SELECT COUNT(*) n FROM custom_jobs WHERE job_no LIKE ?`, `CJ${y}%`).n + 1;
  let no = `CJ${y}${String(n).padStart(4, '0')}`; let k = n;
  while (get('SELECT 1 FROM custom_jobs WHERE job_no = ?', no)) no = `CJ${y}${String(++k).padStart(4, '0')}`;
  return no;
}
stock.get('/jobs', (req, res) => {
  const st = req.query.status;
  const rows = all(`SELECT * FROM custom_jobs ${st ? 'WHERE status = ?' : ''} ORDER BY CASE status WHEN 'ready' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END, COALESCE(due_date, '9999') , id DESC`, ...(st ? [st] : []));
  const counts = Object.fromEntries(JOB_STATUS.map((s) => [s, get('SELECT COUNT(*) n FROM custom_jobs WHERE status = ?', s).n]));
  res.json({ rows, counts });
});
stock.post('/jobs', (req, res) => {
  const b = req.body || {};
  if (!String(b.customer_name || '').trim() || !String(b.title || '').trim()) return res.status(400).json({ error: 'Customer name and what to make are required' });
  const user = b.phone ? get(`SELECT id FROM users WHERE phone LIKE ?`, `%${String(b.phone).replace(/\D/g, '').slice(-10)}`) : null;
  const r = run(`INSERT INTO custom_jobs(job_no, customer_name, phone, user_id, title, details, qty, price, advance, due_date, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    newJobNo(), b.customer_name.trim(), b.phone || null, user?.id ?? null, b.title.trim(), b.details || null, Math.max(1, Number(b.qty) || 1),
    Number(b.price) || 0, Number(b.advance) || 0, b.due_date || null, b.notes || null, req.user.id);
  const job = get('SELECT * FROM custom_jobs WHERE id = ?', r.lastInsertRowid);
  audit(req, 'job.create', 'job', job.job_no, { title: job.title, customer: job.customer_name });
  res.json(job);
});
stock.put('/jobs/:id', (req, res) => {
  const j = get('SELECT * FROM custom_jobs WHERE id = ?', req.params.id);
  if (!j) return res.status(404).json({ error: 'Not found' });
  const b = { ...j, ...req.body };
  run(`UPDATE custom_jobs SET customer_name=?, phone=?, title=?, details=?, qty=?, price=?, advance=?, due_date=?, notes=?, updated_at=datetime('now') WHERE id = ?`,
    b.customer_name, b.phone, b.title, b.details, Math.max(1, Number(b.qty) || 1), Number(b.price) || 0, Number(b.advance) || 0, b.due_date || null, b.notes, j.id);
  audit(req, 'job.update', 'job', j.job_no);
  res.json(get('SELECT * FROM custom_jobs WHERE id = ?', j.id));
});
stock.post('/jobs/:id/status', async (req, res) => {
  const j = get('SELECT * FROM custom_jobs WHERE id = ?', req.params.id);
  const to = req.body?.status;
  if (!j) return res.status(404).json({ error: 'Not found' });
  if (!JOB_STATUS.includes(to)) return res.status(400).json({ error: 'Unknown status' });
  const stamp = to === 'ready' ? ', ready_at = datetime(\'now\')' : to === 'delivered' ? ', delivered_at = datetime(\'now\')' : '';
  run(`UPDATE custom_jobs SET status = ?, updated_at = datetime('now')${stamp} WHERE id = ?`, to, j.id);
  let whatsapp = null;
  if (req.body?.notify !== false && j.phone && (to === 'ready' || to === 'delivered' || to === 'in_progress')) {
    const store = getSetting('store'); const first = j.customer_name.split(' ')[0];
    const due = Math.max(0, j.price - j.advance);
    const msg = to === 'ready'
      ? `Hi ${first}, good news! 🎉 Your custom order ${j.job_no} (${j.title}${j.qty > 1 ? ` × ${j.qty}` : ''}) is READY.${due ? ` Balance payable: ₹${due}.` : ''} Reply here to arrange pickup or delivery. — ${store.name}`
      : to === 'in_progress' ? `Hi ${first}, work has started on your custom order ${j.job_no} (${j.title}).${j.due_date ? ` Expected ready by ${j.due_date}.` : ''} — ${store.name}`
        : `Hi ${first}, your custom order ${j.job_no} (${j.title}) has been delivered. Thank you for choosing ${store.name}! 🙏`;
    whatsapp = await sendWhatsApp(j.phone, msg);
  }
  audit(req, `job.${to}`, 'job', j.job_no, { notified: !!whatsapp?.ok });
  res.json({ job: get('SELECT * FROM custom_jobs WHERE id = ?', j.id), whatsapp });
});

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
