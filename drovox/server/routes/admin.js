// Master panel API: analytics, audit trail, users & roles, CRM, marketing, GST reports, WhatsApp, settings, automation.
import express from 'express';
import { all, get, run, round2, getSetting, setSetting, DEFAULT_SETTINGS } from '../db.js';
import { requireArea, requireRole, audit, hashPassword, publicUser, makeReferralCode, ROLES, PERMISSIONS } from '../auth.js';
import { trending, inventoryForecast, customerSegments, scoreLead } from '../services/engine.js';
import { orderDetail, transition, STATUS_LABEL } from '../services/orders.js';
import { sendWhatsApp } from '../services/whatsapp.js';
import { addPoints } from '../services/loyalty.js';
import { runJob, jobsStatus } from '../services/jobs.js';
import { STATES } from '../pricing.js';

export const admin = express.Router();
admin.use(requireRole('admin', 'marketing', 'support'));

admin.get('/permissions', (req, res) => res.json({ role: req.user.role, areas: PERMISSIONS[req.user.role] }));

// ---- analytics -------------------------------------------------------------------------------
const PAID = `status NOT IN ('cancelled','pending_payment','returned')`;
admin.get('/dashboard', requireArea('dashboard'), (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const since = `-${days} days`; const prevSince = `-${days * 2} days`;
  const kpi = (from, to) => get(`SELECT COUNT(*) orders, COALESCE(SUM(total),0) revenue, COALESCE(SUM(taxable),0) net, COUNT(DISTINCT user_id) buyers
                                 FROM orders WHERE ${PAID} AND created_at >= datetime('now', ?) AND created_at < datetime('now', ?)`, from, to);
  const cur = kpi(since, '+1 day'); const prev = kpi(prevSince, since);
  const cogs = get(`SELECT COALESCE(SUM(oi.qty * oi.unit_cost),0) c, COALESCE(SUM(oi.taxable),0) t FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.${PAID} AND o.created_at >= datetime('now', ?)`, since);
  const sessions = get(`SELECT COUNT(DISTINCT COALESCE(session_id, 'u' || user_id)) n FROM events WHERE created_at >= datetime('now', ?)`, since).n || 1;
  const funnel = Object.fromEntries(['view', 'add_to_cart', 'checkout', 'purchase'].map((t) => [t, get(`SELECT COUNT(DISTINCT COALESCE(session_id, 'u' || user_id)) n FROM events WHERE type = ? AND created_at >= datetime('now', ?)`, t, since).n]));
  const repeat = get(`SELECT COUNT(*) n FROM (SELECT user_id FROM orders WHERE ${PAID} GROUP BY user_id HAVING COUNT(*) > 1)`).n;
  const buyersAll = get(`SELECT COUNT(DISTINCT user_id) n FROM orders WHERE ${PAID}`).n || 1;
  const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
  res.json({
    days,
    kpis: {
      revenue: round2(cur.revenue), revenue_change: pct(cur.revenue, prev.revenue),
      orders: cur.orders, orders_change: pct(cur.orders, prev.orders),
      aov: cur.orders ? round2(cur.revenue / cur.orders) : 0,
      gross_margin_pct: cogs.t ? Math.round((1 - cogs.c / cogs.t) * 100) : 0, gross_profit: round2(cogs.t - cogs.c),
      buyers: cur.buyers, new_customers: get(`SELECT COUNT(*) n FROM users WHERE role = 'customer' AND created_at >= datetime('now', ?)`, since).n,
      conversion_pct: round2((funnel.purchase / sessions) * 100), repeat_rate_pct: Math.round((repeat / buyersAll) * 100),
      pending_fulfilment: get(`SELECT COUNT(*) n FROM orders WHERE status IN ('confirmed','packed')`).n,
      open_leads: get(`SELECT COUNT(*) n FROM leads WHERE stage NOT IN ('won','lost')`).n,
    },
    daily: all(`SELECT date(created_at) day, COUNT(*) orders, ROUND(SUM(total)) revenue FROM orders WHERE ${PAID} AND created_at >= datetime('now', ?) GROUP BY day ORDER BY day`, since),
    funnel,
    top_products: all(`SELECT oi.product_id id, oi.sku, oi.name, SUM(oi.qty) qty, ROUND(SUM(oi.total)) revenue FROM order_items oi JOIN orders o ON o.id = oi.order_id
                       WHERE o.${PAID} AND o.created_at >= datetime('now', ?) GROUP BY oi.product_id ORDER BY revenue DESC LIMIT 10`, since),
    trending: trending(8).map((p) => ({ id: p.id, sku: p.sku, name: p.name, stock: p.stock, sold_7d: p.sold_7d, growth_pct: p.growth_pct, trend_score: p.trend_score })),
    low_stock: inventoryForecast().filter((x) => x.status !== 'ok').slice(0, 10),
    by_category: all(`SELECT c.name, ROUND(SUM(oi.total)) revenue, SUM(oi.qty) qty FROM order_items oi JOIN orders o ON o.id = oi.order_id JOIN products p ON p.id = oi.product_id JOIN categories c ON c.id = p.category_id
                      WHERE o.${PAID} AND o.created_at >= datetime('now', ?) GROUP BY c.id ORDER BY revenue DESC`, since),
    by_state: all(`SELECT place_of_supply code, COUNT(*) orders, ROUND(SUM(total)) revenue FROM orders WHERE ${PAID} AND created_at >= datetime('now', ?) GROUP BY code ORDER BY revenue DESC LIMIT 10`, since).map((r) => ({ ...r, state: STATES[r.code] || r.code })),
    by_payment: all(`SELECT payment_method method, COUNT(*) orders, ROUND(SUM(total)) revenue FROM orders WHERE ${PAID} AND created_at >= datetime('now', ?) GROUP BY method`, since),
    by_status: all(`SELECT status, COUNT(*) n FROM orders WHERE created_at >= datetime('now', ?) GROUP BY status`, since).map((r) => ({ ...r, label: STATUS_LABEL[r.status] })),
    top_searches: all(`SELECT LOWER(query) q, COUNT(*) n FROM events WHERE type = 'search' AND query IS NOT NULL AND created_at >= datetime('now', ?) GROUP BY q ORDER BY n DESC LIMIT 10`, since),
    hourly: all(`SELECT CAST(strftime('%H', created_at, '+5 hours', '+30 minutes') AS INTEGER) hour, COUNT(*) orders FROM orders WHERE ${PAID} AND created_at >= datetime('now', ?) GROUP BY hour ORDER BY hour`, since),
  });
});

admin.get('/inventory', requireArea('analytics'), (_req, res) => res.json(inventoryForecast()));

// ---- audit trail -------------------------------------------------------------------------------
admin.get('/audit', requireRole('admin'), (req, res) => {
  const q = `%${String(req.query.q || '')}%`; const page = Math.max(1, Number(req.query.page) || 1);
  const rows = all(`SELECT * FROM audit_logs WHERE action LIKE ? OR user_name LIKE ? OR entity_id LIKE ? OR details LIKE ? ORDER BY id DESC LIMIT 100 OFFSET ?`, q, q, q, q, (page - 1) * 100);
  res.json({ page, rows, actions: all('SELECT action, COUNT(*) n FROM audit_logs GROUP BY action ORDER BY n DESC LIMIT 30') });
});

// ---- users & roles -----------------------------------------------------------------------------
admin.get('/users', requireRole('admin'), (req, res) => {
  const role = req.query.role; const q = `%${String(req.query.q || '')}%`;
  res.json(all(`SELECT u.*, (SELECT COUNT(*) FROM orders WHERE user_id = u.id) orders FROM users u WHERE (? IS NULL OR role = ?) AND (name LIKE ? OR email LIKE ? OR IFNULL(phone,'') LIKE ?) ORDER BY u.id DESC LIMIT 300`,
    role || null, role || null, q, q, q).map((u) => ({ ...publicUser(u), active: !!u.active, last_seen: u.last_seen, orders: u.orders })));
});
admin.post('/users', requireRole('admin'), (req, res) => {
  const { name, email, phone, password, role = 'customer' } = req.body || {};
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role' });
  if (!name?.trim() || !email?.includes('@') || String(password || '').length < 6) return res.status(400).json({ error: 'Name, email and a 6+ character password are required' });
  if (get('SELECT 1 FROM users WHERE email = ?', email.trim())) return res.status(409).json({ error: 'Email already in use' });
  const r = run('INSERT INTO users(name, email, phone, password_hash, role, referral_code) VALUES (?,?,?,?,?,?)', name.trim(), email.trim(), phone || null, hashPassword(password), role, makeReferralCode(name));
  audit(req, 'user.create', 'user', r.lastInsertRowid, { email, role });
  res.json(publicUser(get('SELECT * FROM users WHERE id = ?', r.lastInsertRowid)));
});
admin.put('/users/:id', requireRole('admin'), (req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const { role, active, password, name, phone } = req.body || {};
  if (role && !ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role' });
  if (u.id === req.user.id && ((role && role !== 'admin') || active === false)) return res.status(400).json({ error: 'You cannot remove your own admin access' });
  run('UPDATE users SET role = COALESCE(?, role), active = COALESCE(?, active), name = COALESCE(?, name), phone = COALESCE(?, phone) WHERE id = ?',
    role || null, active == null ? null : active ? 1 : 0, name || null, phone || null, u.id);
  if (password) run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), u.id);
  audit(req, 'user.update', 'user', u.id, { role, active, password_reset: !!password });
  res.json(publicUser(get('SELECT * FROM users WHERE id = ?', u.id)));
});
admin.post('/users/:id/points', requireRole('admin', 'marketing'), (req, res) => {
  const change = Math.trunc(Number(req.body?.change)); const reason = String(req.body?.reason || 'manual adjustment');
  if (!change) return res.status(400).json({ error: 'Enter points to add or remove' });
  addPoints(Number(req.params.id), change, 'manual', reason);
  audit(req, 'points.adjust', 'user', req.params.id, { change, reason });
  res.json({ points: get('SELECT points FROM users WHERE id = ?', req.params.id).points });
});

// ---- customers (CRM 360) -----------------------------------------------------------------------
admin.get('/customers', requireArea('customers'), (req, res) => {
  let rows = customerSegments();
  if (req.query.segment) rows = rows.filter((r) => r.segment === req.query.segment);
  const counts = {}; for (const r of customerSegments()) counts[r.segment] = (counts[r.segment] || 0) + 1;
  res.json({ counts, rows: rows.sort((a, b) => b.spend - a.spend) });
});
admin.get('/customers/:id', requireArea('customers'), (req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  res.json({
    user: publicUser(u), segment: customerSegments().find((s) => s.id === u.id),
    orders: all('SELECT order_no, status, total, created_at FROM orders WHERE user_id = ? ORDER BY id DESC', u.id).map((o) => ({ ...o, status_label: STATUS_LABEL[o.status] })),
    points: all('SELECT change, reason, ref, created_at FROM points_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 30', u.id),
    leads: all('SELECT id, stage, interest, value_estimate FROM leads WHERE user_id = ? OR email = ?', u.id, u.email),
    favourite_products: all(`SELECT oi.name, SUM(oi.qty) qty FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.user_id = ? GROUP BY oi.product_id ORDER BY qty DESC LIMIT 5`, u.id),
    cart: JSON.parse(get('SELECT items FROM carts WHERE user_id = ?', u.id)?.items || '[]'),
    messages: all('SELECT body, status, created_at FROM notifications WHERE to_phone LIKE ? ORDER BY id DESC LIMIT 20', `%${String(u.phone || 'none').slice(-10)}`),
  });
});

// ---- orders ------------------------------------------------------------------------------------
admin.get('/orders', requireArea('orders'), (req, res) => {
  const { status, q, from, to, payment } = req.query; const where = []; const vals = [];
  if (status) { where.push('status = ?'); vals.push(status); }
  if (payment) { where.push('payment_method = ?'); vals.push(payment); }
  if (from) { where.push('date(created_at) >= date(?)'); vals.push(from); }
  if (to) { where.push('date(created_at) <= date(?)'); vals.push(to); }
  if (q) { where.push('(order_no LIKE ? OR ship_name LIKE ? OR ship_phone LIKE ? OR invoice_no LIKE ?)'); vals.push(...Array(4).fill(`%${q}%`)); }
  res.json(all(`SELECT id, order_no, invoice_no, status, payment_method, payment_status, total, ship_name, ship_phone, place_of_supply, created_at FROM orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 500`, ...vals)
    .map((o) => ({ ...o, status_label: STATUS_LABEL[o.status] })));
});
admin.get('/orders/:id', requireArea('orders'), (req, res) => { const o = orderDetail(Number(req.params.id)); o ? res.json(o) : res.status(404).json({ error: 'Not found' }); });
admin.post('/orders/:id/status', requireArea('orders'), (req, res, next) => {
  try { const o = transition(Number(req.params.id), req.body?.to, req.user, req.body || {}); audit(req, `order.${req.body?.to}`, 'order', o.order_no, { note: req.body?.note }); res.json(orderDetail(o.id)); } catch (e) { next(e); }
});

// ---- CRM leads ----------------------------------------------------------------------------------
const STAGES = ['new', 'contacted', 'qualified', 'proposal', 'won', 'lost'];
admin.get('/leads', requireArea('crm'), (req, res) => {
  const rows = all(`SELECT l.*, u.name owner FROM leads l LEFT JOIN users u ON u.id = l.owner_id ORDER BY l.score DESC, l.id DESC`);
  const pipeline = STAGES.map((s) => ({ stage: s, count: rows.filter((r) => r.stage === s).length, value: round2(rows.filter((r) => r.stage === s).reduce((a, r) => a + r.value_estimate, 0)) }));
  res.json({ stages: STAGES, pipeline, rows, staff: all(`SELECT id, name FROM users WHERE role IN ('admin','marketing','support')`) });
});
admin.post('/leads', requireArea('crm'), (req, res) => {
  const b = req.body || {};
  if (!b.name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const r = run(`INSERT INTO leads(name, email, phone, company, source, stage, interest, value_estimate, owner_id, next_followup, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    b.name.trim(), b.email || null, b.phone || null, b.company || null, b.source || 'manual', STAGES.includes(b.stage) ? b.stage : 'new', b.interest || null, Number(b.value_estimate) || 0, Number(b.owner_id) || req.user.id, b.next_followup || null, b.notes || null);
  const lead = get('SELECT * FROM leads WHERE id = ?', r.lastInsertRowid); run('UPDATE leads SET score = ? WHERE id = ?', scoreLead(lead), lead.id);
  audit(req, 'lead.create', 'lead', lead.id, { name: lead.name });
  res.json(get('SELECT * FROM leads WHERE id = ?', lead.id));
});
admin.put('/leads/:id', requireArea('crm'), (req, res) => {
  const l = get('SELECT * FROM leads WHERE id = ?', req.params.id);
  if (!l) return res.status(404).json({ error: 'Not found' });
  const b = { ...l, ...req.body };
  if (!STAGES.includes(b.stage)) return res.status(400).json({ error: 'Unknown stage' });
  run(`UPDATE leads SET name=?, email=?, phone=?, company=?, stage=?, interest=?, value_estimate=?, owner_id=?, next_followup=?, notes=?, updated_at=datetime('now') WHERE id = ?`,
    b.name, b.email, b.phone, b.company, b.stage, b.interest, Number(b.value_estimate) || 0, b.owner_id || null, b.next_followup || null, b.notes, l.id);
  if (b.stage !== l.stage) run('INSERT INTO lead_activities(lead_id, type, content, user_id) VALUES (?,?,?,?)', l.id, 'stage', `Stage: ${l.stage} → ${b.stage}`, req.user.id);
  const lead = get('SELECT * FROM leads WHERE id = ?', l.id); run('UPDATE leads SET score = ? WHERE id = ?', scoreLead(lead), l.id);
  audit(req, 'lead.update', 'lead', l.id, { stage: b.stage });
  res.json(get('SELECT * FROM leads WHERE id = ?', l.id));
});
admin.get('/leads/:id/activities', requireArea('crm'), (req, res) => res.json(all('SELECT a.*, u.name user FROM lead_activities a LEFT JOIN users u ON u.id = a.user_id WHERE lead_id = ? ORDER BY a.id DESC', req.params.id)));
admin.post('/leads/:id/activities', requireArea('crm'), async (req, res) => {
  const l = get('SELECT * FROM leads WHERE id = ?', req.params.id);
  if (!l) return res.status(404).json({ error: 'Not found' });
  const { type = 'note', content } = req.body || {};
  if (!content?.trim()) return res.status(400).json({ error: 'Write something first' });
  let status = null;
  if (type === 'whatsapp') {
    if (!l.phone) return res.status(400).json({ error: 'This lead has no phone number' });
    status = await sendWhatsApp(l.phone, content.trim());
  }
  run('INSERT INTO lead_activities(lead_id, type, content, user_id) VALUES (?,?,?,?)', l.id, type, content.trim(), req.user.id);
  run(`UPDATE leads SET stage = CASE WHEN stage = 'new' THEN 'contacted' ELSE stage END, updated_at = datetime('now') WHERE id = ?`, l.id);
  const lead = get('SELECT * FROM leads WHERE id = ?', l.id); run('UPDATE leads SET score = ? WHERE id = ?', scoreLead(lead), l.id);
  res.json({ ok: true, whatsapp: status });
});

// ---- marketing ------------------------------------------------------------------------------------
admin.get('/coupons', requireArea('marketing'), (_req, res) => res.json(all(`SELECT c.*, (SELECT COALESCE(SUM(discount),0) FROM orders WHERE coupon_code = c.code COLLATE NOCASE AND status != 'cancelled') given,
  (SELECT COALESCE(SUM(total),0) FROM orders WHERE coupon_code = c.code COLLATE NOCASE AND status != 'cancelled') revenue FROM coupons c ORDER BY id DESC`)));
admin.post('/coupons', requireArea('marketing'), (req, res) => {
  const b = req.body || {};
  const code = String(b.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{3,20}$/.test(code)) return res.status(400).json({ error: 'Code must be 3–20 letters/digits' });
  if (!['percent', 'flat', 'free_ship'].includes(b.type)) return res.status(400).json({ error: 'Unknown coupon type' });
  if (b.type === 'percent' && !(b.value > 0 && b.value <= 90)) return res.status(400).json({ error: 'Percent must be 1–90' });
  if (get('SELECT 1 FROM coupons WHERE code = ?', code)) return res.status(409).json({ error: 'Code already exists' });
  run('INSERT INTO coupons(code, type, value, min_order, max_discount, max_uses, per_user, first_order_only, expires_at, description) VALUES (?,?,?,?,?,?,?,?,?,?)',
    code, b.type, Number(b.value) || 0, Number(b.min_order) || 0, b.max_discount ? Number(b.max_discount) : null, b.max_uses ? Number(b.max_uses) : null,
    Number(b.per_user ?? 1), b.first_order_only ? 1 : 0, b.expires_at || null, b.description || null);
  audit(req, 'coupon.create', 'coupon', code, b);
  res.json({ ok: true });
});
admin.put('/coupons/:id', requireArea('marketing'), (req, res) => {
  run('UPDATE coupons SET active = ? WHERE id = ?', req.body?.active ? 1 : 0, req.params.id);
  audit(req, 'coupon.toggle', 'coupon', req.params.id, { active: !!req.body?.active });
  res.json({ ok: true });
});

function segmentRecipients(segment) {
  const rows = customerSegments().filter((c) => segment === 'all' || c.segment === segment);
  return rows.filter((c) => c.phone && get('SELECT whatsapp_opt_in o FROM users WHERE id = ?', c.id).o);
}
admin.get('/campaigns', requireArea('marketing'), (_req, res) => res.json({
  rows: all('SELECT * FROM campaigns ORDER BY id DESC'),
  segments: ['all', 'champion', 'loyal', 'recent', 'at_risk', 'lost', 'new', 'browser'].map((s) => ({ segment: s, recipients: segmentRecipients(s).length })),
}));
admin.post('/campaigns', requireArea('marketing'), (req, res) => {
  const b = req.body || {};
  if (!b.name?.trim() || !b.message?.trim()) return res.status(400).json({ error: 'Name and message are required' });
  const r = run('INSERT INTO campaigns(name, channel, segment, message, coupon_code, created_by) VALUES (?,?,?,?,?,?)', b.name.trim(), 'whatsapp', b.segment || 'all', b.message.trim(), b.coupon_code || null, req.user.id);
  audit(req, 'campaign.create', 'campaign', r.lastInsertRowid, { name: b.name, segment: b.segment });
  res.json({ id: Number(r.lastInsertRowid) });
});
admin.post('/campaigns/:id/send', requireArea('marketing'), async (req, res) => {
  const c = get('SELECT * FROM campaigns WHERE id = ?', req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (c.status === 'sent') return res.status(400).json({ error: 'Campaign already sent' });
  const recips = segmentRecipients(c.segment);
  let sent = 0;
  for (const r of recips) {
    const body = c.message.replaceAll('{name}', r.name.split(' ')[0]).replaceAll('{points}', String(r.points));
    const out = await sendWhatsApp(r.phone, body, { campaign_id: c.id });
    if (out.ok) sent++;
  }
  run(`UPDATE campaigns SET status = 'sent', sent_count = ?, sent_at = datetime('now') WHERE id = ?`, sent, c.id);
  audit(req, 'campaign.send', 'campaign', c.id, { recipients: recips.length, sent });
  res.json({ sent, recipients: recips.length });
});
admin.get('/abandoned-carts', requireArea('marketing'), (_req, res) => {
  res.json(all(`SELECT c.user_id, u.name, u.phone, c.items, c.value, c.updated_at, c.reminded_at FROM carts c JOIN users u ON u.id = c.user_id WHERE c.value > 0 ORDER BY c.updated_at DESC`)
    .map((c) => ({ ...c, items: JSON.parse(c.items).length })));
});
admin.get('/referrals', requireArea('marketing'), (_req, res) => res.json({
  total: get('SELECT COUNT(*) n FROM referrals').n, rewarded: get(`SELECT COUNT(*) n FROM referrals WHERE status = 'rewarded'`).n,
  points_paid: get(`SELECT COALESCE(SUM(reward_points),0) n FROM referrals`).n,
  top: all(`SELECT u.name, u.referral_code, COUNT(r.id) referrals, SUM(r.status = 'rewarded') converted FROM referrals r JOIN users u ON u.id = r.referrer_id GROUP BY r.referrer_id ORDER BY referrals DESC LIMIT 10`),
  points_outstanding: get(`SELECT COALESCE(SUM(points),0) n FROM users`).n,
}));
admin.get('/ai-sessions', requireArea('marketing'), (_req, res) => res.json(all(`SELECT a.id, a.idea, a.engine, a.created_at, u.name, json_extract(a.result, '$.estimated_total') total, json_extract(a.result, '$.project_title') title
  FROM ai_sessions a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 100`)));

// ---- GST reports --------------------------------------------------------------------------------
admin.get('/gst', requireRole('admin'), (req, res) => {
  const from = req.query.from || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  const range = `o.invoice_no IS NOT NULL AND o.status NOT IN ('cancelled') AND date(o.created_at) BETWEEN date(?) AND date(?)`;
  const store = getSetting('store');
  const summary = get(`SELECT COUNT(*) invoices, ROUND(SUM(taxable),2) taxable, ROUND(SUM(cgst),2) cgst, ROUND(SUM(sgst),2) sgst, ROUND(SUM(igst),2) igst, ROUND(SUM(total),2) total FROM orders o WHERE ${range}`, from, to);
  const b2b = all(`SELECT invoice_no, order_no, gstin, place_of_supply, created_at, taxable, cgst, sgst, igst, total FROM orders o WHERE ${range} AND gstin IS NOT NULL ORDER BY o.id`, from, to);
  const b2c = all(`SELECT place_of_supply, ROUND(SUM(taxable),2) taxable, ROUND(SUM(cgst),2) cgst, ROUND(SUM(sgst),2) sgst, ROUND(SUM(igst),2) igst, COUNT(*) invoices FROM orders o WHERE ${range} AND gstin IS NULL GROUP BY place_of_supply ORDER BY taxable DESC`, from, to)
    .map((r) => ({ ...r, state: STATES[r.place_of_supply] || r.place_of_supply }));
  const hsn = all(`SELECT oi.hsn, oi.gst_rate, SUM(oi.qty) qty, ROUND(SUM(oi.taxable),2) taxable, ROUND(SUM(oi.tax),2) tax,
                    ROUND(SUM(CASE WHEN o.place_of_supply = ? THEN oi.tax ELSE 0 END),2) intra_tax, ROUND(SUM(CASE WHEN o.place_of_supply != ? THEN oi.tax ELSE 0 END),2) igst
                   FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE ${range} GROUP BY oi.hsn, oi.gst_rate ORDER BY taxable DESC`, store.state_code, store.state_code, from, to);
  const rates = all(`SELECT oi.gst_rate rate, ROUND(SUM(oi.taxable),2) taxable, ROUND(SUM(oi.tax),2) tax FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE ${range} GROUP BY oi.gst_rate`, from, to);
  const shipping = get(`SELECT ROUND(SUM((shipping + cod_fee) / 1.18), 2) taxable, ROUND(SUM((shipping + cod_fee) - (shipping + cod_fee) / 1.18), 2) tax FROM orders o WHERE ${range}`, from, to);
  const itc = all(`SELECT b.ref, b.received_at, s.name supplier, ROUND(SUM(bi.qty * bi.unit_cost_foreign * b.fx_rate) + b.freight_inr, 2) assessable FROM stock_batches b LEFT JOIN suppliers s ON s.id = b.supplier_id
                   JOIN stock_batch_items bi ON bi.batch_id = b.id WHERE b.status = 'received' AND date(b.received_at) BETWEEN date(?) AND date(?) GROUP BY b.id`, from, to)
    .map((r) => ({ ...r, est_import_igst: round2(r.assessable * 1.1 * 0.18) }));
  res.json({ from, to, seller: { gstin: store.gstin, state: STATES[store.state_code] }, summary, b2b, b2c, hsn, rates, shipping, import_itc: itc });
});

// ---- WhatsApp -----------------------------------------------------------------------------------
admin.get('/notifications', requireArea('whatsapp'), (_req, res) => res.json({
  rows: all('SELECT * FROM notifications ORDER BY id DESC LIMIT 200'),
  counts: all('SELECT status, COUNT(*) n FROM notifications GROUP BY status'),
  configured: (() => { const w = getSetting('whatsapp'); return !!(w.enabled && w.phone_number_id && w.access_token); })(),
}));
admin.post('/whatsapp/test', requireArea('whatsapp'), async (req, res) => {
  const out = await sendWhatsApp(req.body?.to, req.body?.message || `Test message from ${getSetting('store').name} ✅`);
  audit(req, 'whatsapp.test', 'notification', null, { to: req.body?.to, ok: out.ok });
  res.json(out);
});

// ---- settings & automation ---------------------------------------------------------------------
const SECRET_KEYS = ['razorpay_key_secret', 'razorpay_webhook_secret', 'access_token', 'anthropic_api_key', 'shiprocket_password'];
const mask = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, SECRET_KEYS.includes(k) && v ? '••••' + String(v).slice(-4) : v]));
admin.get('/settings', requireRole('admin'), (_req, res) => res.json(Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map((k) => [k, mask(getSetting(k))]))));
admin.put('/settings/:key', requireRole('admin'), (req, res) => {
  const key = req.params.key;
  if (!(key in DEFAULT_SETTINGS)) return res.status(400).json({ error: 'Unknown settings group' });
  const cur = getSetting(key); const next = { ...cur };
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!(k in DEFAULT_SETTINGS[key])) continue;
    if (SECRET_KEYS.includes(k) && typeof v === 'string' && v.startsWith('••••')) continue; // unchanged masked secret
    const def = DEFAULT_SETTINGS[key][k];
    next[k] = typeof def === 'number' ? Number(v) : typeof def === 'boolean' ? !!v : v;
  }
  setSetting(key, next);
  audit(req, 'settings.update', 'settings', key, Object.fromEntries(Object.keys(req.body || {}).map((k) => [k, SECRET_KEYS.includes(k) ? '(secret)' : req.body[k]])));
  res.json(mask(next));
});
admin.get('/automation', requireRole('admin'), (_req, res) => res.json(jobsStatus()));
admin.post('/automation/:job', requireRole('admin'), (req, res) => {
  try { const r = runJob(req.params.job); audit(req, 'automation.run', 'job', req.params.job, r); res.json(r); } catch (e) { res.status(400).json({ error: e.message }); }
});
