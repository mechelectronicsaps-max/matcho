// Storefront + customer account API.
import express from 'express';
import { all, get, run, getSetting, setSetting } from '../db.js';
import { hashPassword, verifyPassword, signToken, publicUser, requireUser, audit, makeReferralCode, can } from '../auth.js';
import { quote, STATES, parseTiers, unitPriceFor, loyaltyTier, QuoteError, validGstin } from '../pricing.js';
import { trending, boughtTogether, recommendFor, socialProof, scoreLead } from '../services/engine.js';
import { createOrder, orderDetail, markPaid, transition, invoiceData, STATUS_LABEL } from '../services/orders.js';
import { publicPaymentConfig, createRazorpayOrder, razorpayConfigured, verifyRazorpaySignature, verifyRazorpayWebhook } from '../services/payments.js';
import { addPoints, dailyCheckin } from '../services/loyalty.js';
import { buildProject } from '../services/ai.js';

import { parseImages } from '../images.js';

export const store = express.Router();
export const validDate = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? String(d) : null);
const sid = (req) => String(req.headers['x-session'] || '').slice(0, 64) || null;
const logEvent = (req, type, productId, query) =>
  run('INSERT INTO events(session_id, user_id, type, product_id, query) VALUES (?,?,?,?,?)', sid(req), req.user?.id ?? null, type, productId ?? null, query ?? null);

const firstImg = (p) => { if (!p.images) return null; const [k] = parseImages(p.images); return k || null; };
function card(p) {
  const tiers = parseTiers(p);
  return {
    id: p.id, sku: p.sku, name: p.name, slug: p.slug, image: p.image, img: firstImg(p), brand: p.brand, category_id: p.category_id,
    price: p.price, mrp: p.mrp, off_pct: p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0,
    stock: p.stock, low_stock: p.stock > 0 && p.stock <= Math.max(5, p.reorder_level), gst_rate: p.gst_rate,
    best_bulk_price: tiers.length ? tiers[tiers.length - 1].price : null,
    sold_7d: p.sold_7d, growth_pct: p.growth_pct,
  };
}

// ---- catalogue -----------------------------------------------------------------------------
store.get('/config', (req, res) => {
  const s = getSetting('store'); const sh = getSetting('shipping'); const L = getSetting('loyalty'); const e = getSetting('engagement');
  res.json({
    store: { name: s.name, tagline: s.tagline, support_phone: s.support_phone, support_email: s.support_email, state_code: s.state_code, address: s.address,
      legal_name: s.legal_name, gstin: s.gstin, business_type: s.business_type, jurisdiction_city: s.jurisdiction_city, grievance_officer: s.grievance_officer, grievance_email: s.grievance_email },
    shipping: sh, payments: publicPaymentConfig(),
    loyalty: { earn_per_100: L.earn_per_100, point_value: L.point_value, max_redeem_pct: L.max_redeem_pct, signup_bonus: L.signup_bonus, referrer_bonus: L.referrer_bonus, referee_bonus: L.referee_bonus, daily_checkin: L.daily_checkin, tiers: L.tiers },
    engagement: { welcome_coupon: e.welcome_coupon, exit_intent: e.exit_intent, social_proof: e.social_proof },
    ai_enabled: !!getSetting('ai').enabled, states: STATES,
  });
});

store.get('/categories', (_req, res) => {
  res.json(all(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) count FROM categories c ORDER BY sort`));
});

function editDistance1(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; let j = 0; let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

store.get('/products', (req, res) => {
  const { q = '', cat, sort = 'popular', in_stock, min, max } = req.query;
  const page = Math.max(1, Number(req.query.page) || 1); const per = Math.min(60, Number(req.query.per) || 24);
  let rows = all(`SELECT p.*, c.slug cat_slug, c.name cat_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.active = 1`);
  if (cat) rows = rows.filter((p) => p.cat_slug === cat);
  if (in_stock === '1') rows = rows.filter((p) => p.stock > 0);
  if (min) rows = rows.filter((p) => p.price >= Number(min));
  if (max) rows = rows.filter((p) => p.price <= Number(max));
  let corrected = null;
  if (q.trim()) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hay = (p) => `${p.name} ${p.sku} ${p.tags} ${p.brand} ${p.cat_name}`.toLowerCase();
    const score = (p, ts) => ts.reduce((s, t) => s + (hay(p).includes(t) ? (p.name.toLowerCase().includes(t) ? 3 : 1) : 0), 0);
    let scored = rows.map((p) => ({ p, s: score(p, terms) })).filter((x) => x.s >= terms.length);
    if (!scored.length) {
      // typo tolerance: replace each unknown term with the closest catalogue word (edit distance 1)
      const vocab = [...new Set(rows.flatMap((p) => hay(p).split(/[^a-z0-9]+/)).filter((w) => w.length > 2))];
      const fixed = terms.map((t) => (vocab.includes(t) ? t : vocab.find((w) => editDistance1(t, w)) || t));
      if (fixed.join(' ') !== terms.join(' ')) { corrected = fixed.join(' '); scored = rows.map((p) => ({ p, s: score(p, fixed) })).filter((x) => x.s >= fixed.length); }
    }
    if (!scored.length) scored = rows.map((p) => ({ p, s: score(p, terms) })).filter((x) => x.s > 0); // any-term match
    rows = scored.sort((a, b) => b.s - a.s).map((x) => x.p);
    logEvent(req, 'search', null, q.slice(0, 120));
  }
  const sorters = {
    popular: (a, b) => b.views - a.views, price_asc: (a, b) => a.price - b.price, price_desc: (a, b) => b.price - a.price,
    newest: (a, b) => b.id - a.id, discount: (a, b) => (b.mrp - b.price) / b.mrp - (a.mrp - a.price) / a.mrp,
  };
  if (!q.trim() || sort !== 'popular') rows.sort(sorters[sort] || sorters.popular);
  // keep in-stock items ahead of sold-out ones
  rows.sort((a, b) => (b.stock > 0) - (a.stock > 0));
  res.json({ total: rows.length, page, per, corrected, items: rows.slice((page - 1) * per, page * per).map(card) });
});

store.get('/products/:slug', (req, res) => {
  const p = get(`SELECT p.*, c.name cat_name, c.slug cat_slug FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE (p.slug = ? OR p.sku = ?) AND p.active = 1`, req.params.slug, req.params.slug);
  if (!p) return res.status(404).json({ error: 'Product not found' });
  run('UPDATE products SET views = views + 1 WHERE id = ?', p.id);
  logEvent(req, 'view', p.id);
  const together = boughtTogether(p.id, 4);
  const bundleItems = [p, ...together.slice(0, 2)];
  const bundleTotal = bundleItems.reduce((s, x) => s + x.price, 0);
  res.json({
    ...card(p), images: parseImages(p.images), short_description: p.short_description || '', highlights: JSON.parse(p.highlights || '[]'), in_box: JSON.parse(p.in_box || '[]'), description: p.description, specs: JSON.parse(p.specs || '{}'), tags: p.tags.split(',').map((t) => t.trim()).filter(Boolean),
    hsn: p.hsn, tiers: parseTiers(p), category: { name: p.cat_name, slug: p.cat_slug },
    social: getSetting('engagement').social_proof ? socialProof(p.id) : null,
    bought_together: together.map(card),
    bundle: together.length >= 1 ? { items: bundleItems.map(card), total: bundleTotal } : null,
    similar: all('SELECT * FROM products WHERE category_id = ? AND id != ? AND active = 1 ORDER BY stock > 0 DESC, views DESC LIMIT 6', p.category_id, p.id).map(card),
  });
});

store.get('/home', (req, res) => {
  res.json({
    trending: trending(8).map(card),
    deals: all('SELECT * FROM products WHERE active = 1 AND stock > 0 ORDER BY (mrp - price) / mrp DESC LIMIT 8').map(card),
    new_arrivals: all('SELECT * FROM products WHERE active = 1 ORDER BY id DESC LIMIT 8').map(card),
    recommended: recommendFor({ userId: req.user?.id, sessionId: sid(req) }, 8).map(card),
  });
});

store.post('/recommendations', (req, res) => {
  const recent = Array.isArray(req.body?.recent_ids) ? req.body.recent_ids.slice(0, 12) : [];
  res.json(recommendFor({ userId: req.user?.id, sessionId: sid(req), recentIds: recent }, Number(req.body?.limit) || 8).map(card));
});

store.post('/products/batch', (req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter(Boolean).slice(0, 100);
  res.json(ids.map((id) => get('SELECT * FROM products WHERE id = ?', id)).filter(Boolean).map(card));
});

store.post('/events', (req, res) => {
  const { type, product_id, query } = req.body || {};
  if (!['view', 'add_to_cart', 'checkout', 'search'].includes(type)) return res.status(400).json({ error: 'bad event' });
  logEvent(req, type, product_id ? Number(product_id) : null, query ? String(query).slice(0, 120) : null);
  res.json({ ok: true });
});

store.post('/stock-alerts', (req, res) => {
  const pid = Number(req.body?.product_id); const phone = String(req.body?.phone || req.user?.phone || '').trim();
  if (!pid || !phone) return res.status(400).json({ error: 'Phone number is required' });
  run('INSERT INTO stock_alerts(product_id, user_id, phone) VALUES (?,?,?)', pid, req.user?.id ?? null, phone);
  res.json({ ok: true, message: 'We will WhatsApp you as soon as it is back in stock' });
});

// ---- cart & pricing -------------------------------------------------------------------------
store.post('/cart/quote', (req, res) => {
  const b = req.body || {};
  res.json(quote({ items: b.items, user: req.user, coupon_code: b.coupon_code, redeem_points: b.redeem_points, state_code: b.gstin && validGstin(b.gstin) ? String(b.gstin).slice(0, 2) : b.state_code, payment_method: b.payment_method }));
});

store.post('/cart/sync', requireUser, (req, res) => {
  const items = (req.body?.items || []).filter((i) => i.product_id && i.qty > 0).slice(0, 100);
  const value = items.reduce((s, i) => { const p = get('SELECT * FROM products WHERE id = ?', i.product_id); return s + (p ? unitPriceFor(p, i.qty) * i.qty : 0); }, 0);
  run(`INSERT INTO carts(user_id, items, value, updated_at, reminded_at) VALUES (?,?,?, datetime('now'), NULL)
       ON CONFLICT(user_id) DO UPDATE SET items = excluded.items, value = excluded.value, updated_at = excluded.updated_at, reminded_at = NULL`, req.user.id, JSON.stringify(items), value);
  res.json({ ok: true });
});
store.get('/cart/saved', requireUser, (req, res) => {
  const c = get('SELECT items FROM carts WHERE user_id = ?', req.user.id);
  res.json(c ? JSON.parse(c.items) : []);
});

// ---- first-run setup: creates the owner account on an empty system -------------------------------
const needsSetup = () => !get(`SELECT 1 FROM users WHERE role = 'admin' AND active = 1`);
store.get('/setup', (_req, res) => res.json({ needs_setup: needsSetup() }));
store.post('/setup', (req, res) => {
  if (!needsSetup()) return res.status(403).json({ error: 'Setup is already complete — sign in instead' });
  const b = req.body || {};
  if (!b.name?.trim() || !b.email?.includes('@') || String(b.password || '').length < 8) return res.status(400).json({ error: 'Your name, a valid email and a password of at least 8 characters are required' });
  if (b.gstin && !validGstin(b.gstin)) return res.status(400).json({ error: 'GSTIN is not valid' });
  if (get('SELECT 1 FROM users WHERE email = ?', b.email.trim())) return res.status(409).json({ error: 'That email is already registered' });
  const s = getSetting('store');
  setSetting('store', { ...s, name: b.store_name?.trim() || s.name, legal_name: b.legal_name?.trim() || b.store_name?.trim() || s.legal_name,
    gstin: b.gstin ? String(b.gstin).toUpperCase() : '', state_code: b.gstin ? String(b.gstin).slice(0, 2) : (b.state_code || s.state_code),
    address: b.address || '', support_phone: b.support_phone || b.phone || '', support_email: b.support_email || b.email.trim() });
  const r = run(`INSERT INTO users(name, email, phone, password_hash, role, referral_code, source) VALUES (?,?,?,?, 'admin', ?, 'setup')`,
    b.name.trim(), b.email.trim(), b.phone || null, hashPassword(b.password), makeReferralCode(b.name));
  const user = get('SELECT * FROM users WHERE id = ?', r.lastInsertRowid);
  req.user = user; audit(req, 'system.setup', 'user', user.id, { store: b.store_name });
  res.json({ token: signToken(user), user: publicUser(user) });
});

// ---- auth & account -------------------------------------------------------------------------
store.post('/auth/register', (req, res) => {
  const { name, email, phone, password, referral_code, company, gstin, dob, anniversary, city } = req.body || {};
  if (!name?.trim() || !email?.includes('@') || String(password || '').length < 6) return res.status(400).json({ error: 'Name, a valid email and a 6+ character password are required' });
  if (gstin && !validGstin(gstin)) return res.status(400).json({ error: 'GSTIN is not valid' });
  if (get('SELECT 1 FROM users WHERE email = ?', email.trim())) return res.status(409).json({ error: 'An account with this email already exists' });
  const referrer = referral_code ? get('SELECT * FROM users WHERE referral_code = ? COLLATE NOCASE', String(referral_code).trim()) : null;
  if (referral_code && !referrer) return res.status(400).json({ error: 'Referral code not found' });
  const L = getSetting('loyalty');
  const r = run(`INSERT INTO users(name, email, phone, password_hash, role, referral_code, referred_by, company, gstin, state_code, dob, anniversary, city) VALUES (?,?,?,?, 'customer', ?,?,?,?,?,?,?,?)`,
    name.trim(), email.trim(), phone || null, hashPassword(password), makeReferralCode(name), referrer?.id ?? null, company || null, gstin ? gstin.toUpperCase() : null, gstin ? gstin.slice(0, 2) : null,
    validDate(dob), validDate(anniversary), city || null);
  const uid = Number(r.lastInsertRowid);
  addPoints(uid, L.signup_bonus, 'signup', null);
  if (referrer) { run('INSERT INTO referrals(referrer_id, referee_id) VALUES (?,?)', referrer.id, uid); addPoints(uid, L.referee_bonus, 'referred', referrer.referral_code); }
  const user = get('SELECT * FROM users WHERE id = ?', uid);
  req.user = user; audit(req, 'user.register', 'user', uid, { referral: referrer?.referral_code });
  res.json({ token: signToken(user), user: publicUser(user) });
});

store.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = get('SELECT * FROM users WHERE email = ?', String(email || '').trim());
  if (!u || !u.active || !verifyPassword(password || '', u.password_hash)) return res.status(401).json({ error: 'Email or password is incorrect' });
  req.user = u; if (u.role !== 'customer') audit(req, 'staff.login', 'user', u.id);
  res.json({ token: signToken(u), user: publicUser(u) });
});

store.get('/me', requireUser, (req, res) => {
  const tier = loyaltyTier(req.user);
  const L = getSetting('loyalty');
  const next = L.tiers.find((t) => t.min_spend > tier.spend);
  res.json({ ...publicUser(req.user), tier: { name: tier.name, multiplier: tier.multiplier, spend: tier.spend, next: next ? { name: next.name, remaining: next.min_spend - tier.spend } : null },
    can: { stock: can(req.user, 'stock'), admin: req.user.role !== 'customer' && req.user.role !== 'stockist' } });
});
store.put('/me', requireUser, (req, res) => {
  const { name, phone, company, gstin, whatsapp_opt_in, password, dob, anniversary, city } = req.body || {};
  if (gstin && !validGstin(gstin)) return res.status(400).json({ error: 'GSTIN is not valid' });
  run(`UPDATE users SET name = COALESCE(?, name), phone = COALESCE(?, phone), company = ?, gstin = ?, whatsapp_opt_in = COALESCE(?, whatsapp_opt_in), dob = ?, anniversary = ?, city = ? WHERE id = ?`,
    name || null, phone || null, company || null, gstin ? gstin.toUpperCase() : null, whatsapp_opt_in == null ? null : whatsapp_opt_in ? 1 : 0,
    dob === undefined ? req.user.dob : validDate(dob), anniversary === undefined ? req.user.anniversary : validDate(anniversary), city === undefined ? req.user.city : (city || null), req.user.id);
  if (password) { if (String(password).length < 6) return res.status(400).json({ error: 'Password must be 6+ characters' }); run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), req.user.id); }
  res.json(publicUser(get('SELECT * FROM users WHERE id = ?', req.user.id)));
});
store.post('/me/checkin', requireUser, (req, res) => res.json(dailyCheckin(req.user)));
store.get('/me/points', requireUser, (req, res) => res.json(all('SELECT change, reason, ref, created_at FROM points_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 100', req.user.id)));
store.get('/me/referrals', requireUser, (req, res) => res.json({
  code: req.user.referral_code,
  friends: all(`SELECT u.name, r.status, r.reward_points, r.created_at FROM referrals r JOIN users u ON u.id = r.referee_id WHERE r.referrer_id = ? ORDER BY r.id DESC`, req.user.id),
}));
store.get('/me/addresses', requireUser, (req, res) => res.json(all('SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC', req.user.id)));
store.delete('/me/addresses/:id', requireUser, (req, res) => { run('DELETE FROM addresses WHERE id = ? AND user_id = ?', req.params.id, req.user.id); res.json({ ok: true }); });

// ---- orders --------------------------------------------------------------------------------
store.post('/orders', requireUser, async (req, res, next) => {
  try {
    const order = createOrder(req.user, req.body || {});
    audit(req, 'order.place', 'order', order.order_no, { total: order.total, method: order.payment_method });
    const out = { order: orderDetail(order.id), payment: null };
    if (order.payment_method === 'razorpay') {
      if (!razorpayConfigured()) throw new QuoteError('Online payment is not configured yet');
      const rp = await createRazorpayOrder(order.total, order.order_no, { order_no: order.order_no });
      run('UPDATE orders SET gateway_order_id = ? WHERE id = ?', rp.id, order.id);
      const s = getSetting('store');
      out.payment = { provider: 'razorpay', key_id: getSetting('payments').razorpay_key_id, order_id: rp.id, amount: rp.amount, currency: 'INR', name: s.name,
        prefill: { name: req.user.name, email: req.user.email, contact: order.ship_phone } };
    } else if (order.payment_method === 'test') {
      if (razorpayConfigured() || !getSetting('payments').test_mode) throw new QuoteError('Test payments are disabled');
      out.payment = { provider: 'test' };
    }
    res.json(out);
  } catch (e) { next(e); }
});

function myOrder(req, res) {
  const o = get('SELECT * FROM orders WHERE order_no = ?', req.params.no);
  if (!o || (o.user_id !== req.user.id && req.user.role === 'customer')) { res.status(404).json({ error: 'Order not found' }); return null; }
  return o;
}

store.post('/orders/:no/pay/verify', requireUser, (req, res) => {
  const o = myOrder(req, res); if (!o) return;
  const { razorpay_payment_id: pid, razorpay_order_id: oid, razorpay_signature: sig } = req.body || {};
  if (oid !== o.gateway_order_id || !verifyRazorpaySignature(oid, pid, sig)) return res.status(400).json({ error: 'Payment could not be verified' });
  markPaid(o.id, pid, `Paid online (${pid})`);
  audit(req, 'order.paid', 'order', o.order_no, { payment_id: pid });
  res.json(orderDetail(o.id));
});

store.post('/orders/:no/pay/test', requireUser, (req, res) => {
  const o = myOrder(req, res); if (!o) return;
  if (razorpayConfigured() || !getSetting('payments').test_mode || o.payment_method !== 'test') return res.status(400).json({ error: 'Test payments are disabled' });
  markPaid(o.id, 'test_' + Date.now(), 'Test-mode payment');
  res.json(orderDetail(o.id));
});

store.get('/orders', requireUser, (req, res) => {
  res.json(all('SELECT id, order_no, status, payment_method, payment_status, total, created_at, (SELECT COUNT(*) FROM order_items WHERE order_id = orders.id) items FROM orders WHERE user_id = ? ORDER BY id DESC', req.user.id)
    .map((o) => ({ ...o, status_label: STATUS_LABEL[o.status] })));
});
store.get('/orders/:no', requireUser, (req, res) => { const o = myOrder(req, res); if (o) res.json(orderDetail(o.id)); });
store.get('/orders/:no/invoice', requireUser, (req, res) => {
  const o = myOrder(req, res); if (!o) return;
  if (!o.invoice_no) return res.status(400).json({ error: 'The invoice is issued once the order is confirmed' });
  res.json(invoiceData(o.id));
});
// ---- app: register this phone for push notifications --------------------------------------
// ---- app: notifications bell and back-in-stock waitlist -----------------------------------------
store.get('/me/notifications', requireUser, (req, res) => {
  const d = String(req.user.phone || '').replace(/\D/g, '').slice(-10);
  if (d.length !== 10) return res.json([]);
  res.json(all(`SELECT id, body, created_at, order_id FROM notifications WHERE substr(replace(replace(to_phone, ' ', ''), '+', ''), -10) = ? AND status != 'failed' AND campaign_id IS NULL ORDER BY id DESC LIMIT 40`, d)
    .map((n) => ({ ...n, order_no: n.order_id ? get('SELECT order_no FROM orders WHERE id = ?', n.order_id)?.order_no || null : null })));
});
store.get('/me/waitlist', requireUser, (req, res) => {
  res.json(all(`SELECT a.id alert_id, a.created_at alert_at, a.notified_at, p.* FROM stock_alerts a JOIN products p ON p.id = a.product_id WHERE a.user_id = ? AND p.active = 1 ORDER BY a.id DESC`, req.user.id)
    .map((p) => ({ ...card(p), alert_id: p.alert_id, alert_at: p.alert_at, notified_at: p.notified_at })));
});
store.delete('/me/waitlist/:id', requireUser, (req, res) => { run('DELETE FROM stock_alerts WHERE id = ? AND user_id = ?', req.params.id, req.user.id); res.json({ ok: true }); });

store.post('/me/push-token', requireUser, (req, res) => {
  const token = String(req.body?.token || '').trim(); const platform = req.body?.platform === 'ios' ? 'ios' : 'android';
  if (token.length < 20 || token.length > 4096) return res.status(400).json({ error: 'Invalid token' });
  run(`INSERT INTO push_tokens(token, user_id, platform) VALUES (?,?,?) ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, seen_at = datetime('now')`, token, req.user.id, platform);
  res.json({ ok: true });
});
store.delete('/me/push-token', requireUser, (req, res) => {
  run('DELETE FROM push_tokens WHERE token = ? AND user_id = ?', String(req.body?.token || ''), req.user.id);
  res.json({ ok: true });
});

store.post('/orders/:no/cancel', requireUser, (req, res, next) => {
  const o = myOrder(req, res); if (!o) return;
  if (!['pending_payment', 'confirmed'].includes(o.status)) return res.status(400).json({ error: 'This order has already been packed and can no longer be cancelled online' });
  try { const r = transition(o.id, 'cancelled', req.user, { note: 'Cancelled by customer' }); audit(req, 'order.cancel', 'order', o.order_no); res.json(orderDetail(r.id)); } catch (e) { next(e); }
});
store.post('/orders/:no/reorder', requireUser, (req, res) => {
  const o = myOrder(req, res); if (!o) return;
  res.json(all('SELECT product_id, qty FROM order_items WHERE order_id = ? AND product_id IS NOT NULL', o.id));
});

/** Public tracking: order number plus the last 4 digits of the delivery phone. */
store.get('/track/:no', (req, res) => {
  const o = get('SELECT * FROM orders WHERE order_no = ?', String(req.params.no).toUpperCase());
  const owner = o && req.user && (o.user_id === req.user.id || req.user.role !== 'customer');
  if (!o || (!owner && String(o.ship_phone || '').replace(/\D/g, '').slice(-4) !== String(req.query.phone || '').slice(-4))) return res.status(404).json({ error: 'No order matches that number and phone' });
  const courier = getSetting('courier');
  res.json({
    order_no: o.order_no, status: o.status, status_label: STATUS_LABEL[o.status], created_at: o.created_at, total: o.total,
    courier: o.courier, awb: o.awb, tracking_url: o.awb && courier.tracking_url ? courier.tracking_url.replace('{awb}', o.awb) : null,
    city: (o.ship_address || '').split(', ').slice(-2, -1)[0] || null,
    events: all('SELECT status, note, created_at FROM order_events WHERE order_id = ? ORDER BY id', o.id),
    items: get('SELECT COALESCE(SUM(qty),0) n FROM order_items WHERE order_id = ?', o.id).n,
  });
});

// ---- AI project builder & leads -------------------------------------------------------------
const aiHits = new Map();
store.post('/ai/build', async (req, res, next) => {
  const idea = String(req.body?.idea || '').trim();
  if (idea.length < 8) return res.status(400).json({ error: 'Describe your project in a sentence or two' });
  if (idea.length > 2000) return res.status(400).json({ error: 'Please keep the description under 2000 characters' });
  const key = req.user?.id ? `u${req.user.id}` : `ip${req.ip}`;
  const hits = (aiHits.get(key) || []).filter((t) => t > Date.now() - 36e5);
  if (hits.length >= 20) return res.status(429).json({ error: 'You have reached the hourly limit for the project builder' });
  aiHits.set(key, [...hits, Date.now()]);
  try {
    const plan = await buildProject(idea, req.user);
    // Big or multi-unit builds become CRM leads so the sales team can offer a bulk quote.
    if (plan.estimated_total >= 5000 && req.user) {
      const r = run(`INSERT INTO leads(name, email, phone, source, stage, interest, value_estimate, user_id) VALUES (?,?,?, 'ai_builder', 'new', ?, ?, ?)`,
        req.user.name, req.user.email, req.user.phone, `${plan.project_title}: ${idea.slice(0, 200)}`, plan.estimated_total, req.user.id);
      const lead = get('SELECT * FROM leads WHERE id = ?', r.lastInsertRowid); run('UPDATE leads SET score = ? WHERE id = ?', scoreLead(lead), lead.id);
    }
    res.json(plan);
  } catch (e) { next(e); }
});

store.post('/leads', (req, res) => {
  const { name, email, phone, company, interest, quantity, source } = req.body || {};
  if (!name?.trim() || (!email && !phone)) return res.status(400).json({ error: 'Name and an email or phone number are required' });
  const value = Number(req.body?.value_estimate) || 0;
  const r = run(`INSERT INTO leads(name, email, phone, company, source, interest, value_estimate, user_id, notes) VALUES (?,?,?,?,?,?,?,?,?)`,
    name.trim(), email || null, phone || null, company || null, ['bulk_quote', 'website'].includes(source) ? source : 'website', interest || null, value, req.user?.id ?? null, quantity ? `Quantity: ${quantity}` : null);
  const lead = get('SELECT * FROM leads WHERE id = ?', r.lastInsertRowid); run('UPDATE leads SET score = ? WHERE id = ?', scoreLead(lead), lead.id);
  res.json({ ok: true, message: 'Thanks! Our team will send you a quote within one working day.' });
});

// ---- payment gateway webhook ---------------------------------------------------------------
export const razorpayWebhook = (req, res) => {
  const raw = req.body instanceof Buffer ? req.body : Buffer.from('');
  if (!verifyRazorpayWebhook(raw, req.headers['x-razorpay-signature'])) return res.status(400).json({ error: 'bad signature' });
  let evt; try { evt = JSON.parse(raw.toString()); } catch { return res.status(400).end(); }
  const pay = evt?.payload?.payment?.entity;
  if ((evt.event === 'payment.captured' || evt.event === 'order.paid') && pay?.order_id) {
    const o = get('SELECT * FROM orders WHERE gateway_order_id = ?', pay.order_id);
    if (o) markPaid(o.id, pay.id, `Paid online (${pay.method || 'razorpay'}) — webhook`);
  }
  res.json({ ok: true });
};
