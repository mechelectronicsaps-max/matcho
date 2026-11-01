// Fabrication services (3D print, PCB, laser/acrylic cutting, battery packs) and the partner program.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, get, run, getSetting, DB_FILE } from '../db.js';
import { requireUser, requireArea, requireRole, audit } from '../auth.js';
import { SERVICES, SERVICE_STATUS, estimate, publicCatalog } from '../services/fabrication.js';
import { sendWhatsApp, notify } from '../services/whatsapp.js';
import { validGstin } from '../pricing.js';
import { scoreLead } from '../services/engine.js';

const UPLOADS = path.join(path.dirname(DB_FILE), 'uploads');
const MAX_FILE = 20 * 1024 * 1024; const MAX_FILES = 5;
const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

function newReqNo() {
  const y = String(new Date().getFullYear()).slice(2);
  for (;;) { const no = `SR${y}${crypto.randomInt(10000, 99999)}`; if (!get('SELECT 1 FROM service_requests WHERE req_no = ?', no)) return no; }
}
const parse = (r) => r && ({ ...r, specs: JSON.parse(r.specs || '{}'), files: JSON.parse(r.files || '[]'), estimate_lines: JSON.parse(r.estimate_lines || '[]'), title: SERVICES[r.service]?.title || r.service });

// =============================================================== public: services
export const extras = express.Router();

extras.get('/services', (_req, res) => res.json(publicCatalog()));

extras.post('/services/estimate', (req, res, next) => {
  try { res.json(estimate(req.body?.service, req.body || {})); } catch (e) { next(e); }
});

extras.post('/services/requests', (req, res, next) => {
  try {
    if (!getSetting('services').enabled) return res.status(400).json({ error: 'Services are not taking new requests right now' });
    const b = req.body || {};
    const name = String(b.name || req.user?.name || '').trim(); const phone = String(b.phone || req.user?.phone || '').trim();
    if (!name || phone.replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'Your name and a 10-digit WhatsApp number are required' });
    const est = estimate(b.service, b);
    const files = Array.isArray(b.files) ? b.files.slice(0, MAX_FILES + 1) : [];
    if (files.length > MAX_FILES) return res.status(400).json({ error: `Upload at most ${MAX_FILES} files (zip them if you have more)` });
    const allowed = SERVICES[b.service].files;
    const decoded = files.map((f) => {
      const base = path.basename(String(f.name || 'file')).replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 100) || 'file';
      const ext = base.split('.').pop().toLowerCase();
      if (!allowed.includes(ext)) throw Object.assign(new Error(`${base}: allowed file types are ${allowed.join(', ')}`), { status: 400 });
      const buf = Buffer.from(String(f.data || '').replace(/^data:[^,]*,/, ''), 'base64');
      if (!buf.length) throw Object.assign(new Error(`${base} is empty`), { status: 400 });
      if (buf.length > MAX_FILE) throw Object.assign(new Error(`${base} is larger than 20 MB`), { status: 400 });
      return { base, buf };
    });
    const reqNo = newReqNo();
    const stored = [];
    if (decoded.length) {
      const dir = path.join(UPLOADS, reqNo); fs.mkdirSync(dir, { recursive: true });
      decoded.forEach((d, i) => { const fname = `${i + 1}-${d.base}`; fs.writeFileSync(path.join(dir, fname), d.buf); stored.push({ name: d.base, stored: fname, size: d.buf.length }); });
    }
    const r = run(`INSERT INTO service_requests(req_no, service, user_id, name, phone, email, specs, quantity, notes, files, estimate, estimate_lines) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      reqNo, b.service, req.user?.id ?? null, name, phone, b.email || req.user?.email || null, JSON.stringify(est.specs), est.quantity,
      String(b.notes || '').slice(0, 2000) || null, JSON.stringify(stored), est.total, JSON.stringify(est.lines));
    const store = getSetting('store');
    notify(phone, `Hi ${name.split(' ')[0]}, we received your ${est.title} request ${reqNo} (${est.summary}). Estimate: ${money(est.total)} incl. GST. Our team will check your files and send the final quote on WhatsApp. — ${store.name}`);
    if (store.support_phone) notify(store.support_phone, `New ${est.title} request ${reqNo} from ${name} (${phone}): ${est.summary}. Estimate ${money(est.total)}.`);
    req.user && audit(req, 'service.request', 'service', reqNo, { service: b.service, estimate: est.total });
    res.json({ ok: true, req_no: reqNo, id: Number(r.lastInsertRowid), estimate: est });
  } catch (e) { next(e); }
});

extras.get('/me/services', requireUser, (req, res) => {
  res.json(all('SELECT * FROM service_requests WHERE user_id = ? ORDER BY id DESC', req.user.id).map(parse));
});
extras.post('/me/services/:no/accept', requireUser, (req, res) => {
  const r = get('SELECT * FROM service_requests WHERE req_no = ? AND user_id = ?', req.params.no, req.user.id);
  if (!r) return res.status(404).json({ error: 'Request not found' });
  if (r.status !== 'quoted') return res.status(400).json({ error: 'There is no quote waiting for approval' });
  run(`UPDATE service_requests SET status = 'approved', updated_at = datetime('now') WHERE id = ?`, r.id);
  const store = getSetting('store');
  if (store.support_phone) notify(store.support_phone, `${r.req_no} quote of ${money(r.quoted_price)} ACCEPTED by ${r.name} — start production.`);
  audit(req, 'service.accept', 'service', r.req_no, { price: r.quoted_price });
  res.json(parse(get('SELECT * FROM service_requests WHERE id = ?', r.id)));
});

// =============================================================== public: partner program
const PARTNER_TYPES = {
  reseller: 'Reseller / dealer / retail shop',
  institution: 'School, college or Atal Tinkering Lab',
  makerspace: 'Makerspace, trainer or robotics academy',
  integrator: 'System integrator / industrial buyer',
  affiliate: 'YouTuber, blogger or affiliate',
};
const defaultDiscount = (type) => Number(getSetting('partners')[`${type}_discount`] || 0);

extras.get('/partner/program', (req, res) => {
  const P = getSetting('partners');
  const mine = req.user ? get('SELECT id, type, status, discount_pct, created_at, review_note FROM partner_applications WHERE user_id = ? ORDER BY id DESC LIMIT 1', req.user.id) : null;
  res.json({ enabled: !!P.enabled, types: Object.entries(PARTNER_TYPES).map(([id, label]) => ({ id, label, discount: defaultDiscount(id) })),
    application: mine, partner: req.user?.partner_type ? { type: req.user.partner_type, discount: req.user.partner_discount } : null });
});

extras.post('/partner/apply', requireUser, (req, res) => {
  if (!getSetting('partners').enabled) return res.status(400).json({ error: 'The partner program is closed right now' });
  const b = req.body || {};
  if (!PARTNER_TYPES[b.type]) return res.status(400).json({ error: 'Choose what kind of partner you are' });
  const phone = String(b.phone || req.user.phone || '').trim();
  if (!String(b.name || req.user.name).trim() || phone.replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'Name and a 10-digit mobile number are required' });
  if (b.gstin && !validGstin(b.gstin)) return res.status(400).json({ error: 'GSTIN is not valid' });
  if (get(`SELECT 1 FROM partner_applications WHERE user_id = ? AND status = 'pending'`, req.user.id)) return res.status(409).json({ error: 'Your application is already under review' });
  if (req.user.partner_type) return res.status(409).json({ error: 'You are already a Drovox partner' });
  const r = run(`INSERT INTO partner_applications(user_id, name, phone, email, company, gstin, city, state_code, type, monthly_volume, website, message, discount_pct) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    req.user.id, String(b.name || req.user.name).trim(), phone, b.email || req.user.email, b.company || null, b.gstin ? String(b.gstin).toUpperCase() : null,
    b.city || null, b.gstin ? String(b.gstin).slice(0, 2) : (b.state_code || null), b.type, b.monthly_volume || null, b.website || null,
    String(b.message || '').slice(0, 1000) || null, defaultDiscount(b.type));
  // Every application is also a CRM lead so the sales team can follow up.
  const lead = run(`INSERT INTO leads(name, email, phone, company, source, interest, value_estimate, user_id, notes) VALUES (?,?,?,?, 'partner', ?, 0, ?, ?)`,
    String(b.name || req.user.name).trim(), b.email || req.user.email, phone, b.company || null, `Partner application: ${PARTNER_TYPES[b.type]}`, req.user.id, b.monthly_volume ? `Monthly volume: ${b.monthly_volume}` : null);
  const l = get('SELECT * FROM leads WHERE id = ?', lead.lastInsertRowid); run('UPDATE leads SET score = ? WHERE id = ?', scoreLead(l), l.id);
  const store = getSetting('store');
  notify(phone, `Thank you for applying to the ${store.name} Partner Program! We'll review your application and reply on WhatsApp within 2 working days.`);
  if (store.support_phone) notify(store.support_phone, `New partner application: ${b.company || b.name} (${PARTNER_TYPES[b.type]}), ${phone}.`);
  audit(req, 'partner.apply', 'partner', r.lastInsertRowid, { type: b.type });
  res.json({ ok: true, message: 'Application received — we will reply on WhatsApp within 2 working days.' });
});

// =============================================================== staff: service jobs
export const servicesStaff = express.Router();
servicesStaff.use(requireArea('stock'));

servicesStaff.get('/', (req, res) => {
  const st = req.query.status;
  const rows = all(`SELECT * FROM service_requests ${st ? 'WHERE status = ?' : ''} ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'approved' THEN 1 WHEN 'in_production' THEN 2 WHEN 'quoted' THEN 3 WHEN 'ready' THEN 4 ELSE 5 END, id DESC LIMIT 300`, ...(st ? [st] : [])).map(parse);
  const counts = Object.fromEntries(SERVICE_STATUS.map((s) => [s, get('SELECT COUNT(*) n FROM service_requests WHERE status = ?', s).n]));
  res.json({ rows, counts, statuses: SERVICE_STATUS });
});
servicesStaff.get('/:id', (req, res) => { const r = parse(get('SELECT * FROM service_requests WHERE id = ?', req.params.id)); r ? res.json(r) : res.status(404).json({ error: 'Not found' }); });

servicesStaff.get('/:id/files/:idx', (req, res) => {
  const r = parse(get('SELECT * FROM service_requests WHERE id = ?', req.params.id));
  const f = r?.files[Number(req.params.idx)];
  if (!f) return res.status(404).json({ error: 'File not found' });
  const p = path.join(UPLOADS, r.req_no, path.basename(f.stored));
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'File missing on disk' });
  res.download(p, f.name);
});

servicesStaff.put('/:id', async (req, res) => {
  const r = get('SELECT * FROM service_requests WHERE id = ?', req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const to = b.status || r.status;
  if (!SERVICE_STATUS.includes(to)) return res.status(400).json({ error: 'Unknown status' });
  const price = b.quoted_price != null && b.quoted_price !== '' ? Number(b.quoted_price) : r.quoted_price;
  if (to === 'quoted' && !(price > 0)) return res.status(400).json({ error: 'Enter the final price before sending the quote' });
  const lead = b.lead_days != null && b.lead_days !== '' ? Math.max(0, Math.floor(Number(b.lead_days))) : r.lead_days;
  run(`UPDATE service_requests SET status = ?, quoted_price = ?, lead_days = ?, staff_notes = ?, updated_at = datetime('now') WHERE id = ?`,
    to, price ?? null, lead ?? null, b.staff_notes ?? r.staff_notes, r.id);
  let whatsapp = null;
  if (to !== r.status && b.notify !== false) {
    const store = getSetting('store'); const first = r.name.split(' ')[0]; const title = SERVICES[r.service]?.title || 'service';
    const msg = {
      quoted: `Hi ${first}, your ${title} quote for ${r.req_no} is ready: ${money(price)} incl. GST${lead ? `, ready in about ${lead} days after approval` : ''}. Approve it from My Account → Services on our website or reply YES here. — ${store.name}`,
      in_production: `Hi ${first}, production has started on your ${title} request ${r.req_no}.${lead ? ` Expected in about ${lead} days.` : ''} — ${store.name}`,
      ready: `Hi ${first}, good news! Your ${title} order ${r.req_no} is READY${price ? ` (${money(price)})` : ''}. Reply to arrange pickup or delivery. — ${store.name}`,
      delivered: `Hi ${first}, your ${title} order ${r.req_no} has been delivered. Thank you for choosing ${store.name}! 🙏`,
      cancelled: `Hi ${first}, your ${title} request ${r.req_no} has been cancelled. Reply here if you have any questions. — ${store.name}`,
    }[to];
    if (msg) whatsapp = await sendWhatsApp(r.phone, msg);
  }
  audit(req, `service.${to}`, 'service', r.req_no, { price, lead });
  res.json({ request: parse(get('SELECT * FROM service_requests WHERE id = ?', r.id)), whatsapp });
});

// =============================================================== admin: partners
export const partnersAdmin = express.Router();
partnersAdmin.use(requireRole('admin', 'marketing'));

partnersAdmin.get('/', (_req, res) => res.json({
  types: PARTNER_TYPES,
  applications: all(`SELECT a.*, u.email user_email FROM partner_applications a LEFT JOIN users u ON u.id = a.user_id ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END, a.id DESC`),
  partners: all(`SELECT u.id, u.name, u.email, u.phone, u.company, u.partner_type, u.partner_discount,
    (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id AND o.status NOT IN ('cancelled','pending_payment')) orders,
    (SELECT COALESCE(SUM(total),0) FROM orders o WHERE o.user_id = u.id AND o.status NOT IN ('cancelled','pending_payment')) revenue
    FROM users u WHERE u.partner_type IS NOT NULL ORDER BY revenue DESC`),
}));

partnersAdmin.post('/:id/decision', async (req, res) => {
  const a = get('SELECT * FROM partner_applications WHERE id = ?', req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  if (a.status !== 'pending') return res.status(400).json({ error: 'This application was already decided' });
  const approve = !!req.body?.approve;
  const P = getSetting('partners');
  const pct = Math.max(0, Math.min(Number(P.max_discount || 25), Number(req.body?.discount_pct ?? a.discount_pct) || 0));
  run(`UPDATE partner_applications SET status = ?, discount_pct = ?, review_note = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?`,
    approve ? 'approved' : 'rejected', pct, req.body?.note || null, req.user.id, a.id);
  if (approve) {
    run('UPDATE users SET partner_type = ?, partner_discount = ?, company = COALESCE(company, ?), gstin = COALESCE(gstin, ?) WHERE id = ?', a.type, pct, a.company, a.gstin, a.user_id);
    run(`UPDATE leads SET stage = 'won', updated_at = datetime('now') WHERE user_id = ? AND source = 'partner' AND stage NOT IN ('won','lost')`, a.user_id);
  } else run(`UPDATE leads SET stage = 'lost', updated_at = datetime('now') WHERE user_id = ? AND source = 'partner' AND stage NOT IN ('won','lost')`, a.user_id);
  const store = getSetting('store');
  const whatsapp = await sendWhatsApp(a.phone, approve
    ? `🎉 Welcome to the ${store.name} Partner Program! Your account now gets ${pct}% partner discount on every order automatically. Sign in at ${store.public_url} to start ordering.`
    : `Thank you for applying to the ${store.name} Partner Program. We can't approve the application right now${req.body?.note ? `: ${req.body.note}` : ''}. You can still buy at our regular and bulk prices.`);
  audit(req, approve ? 'partner.approve' : 'partner.reject', 'partner', a.id, { user: a.user_id, discount: pct });
  res.json({ ok: true, whatsapp });
});

partnersAdmin.put('/user/:userId', (req, res) => {
  const u = get('SELECT * FROM users WHERE id = ?', req.params.userId);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const P = getSetting('partners');
  if (req.body?.revoke) run('UPDATE users SET partner_type = NULL, partner_discount = 0 WHERE id = ?', u.id);
  else run('UPDATE users SET partner_discount = ? WHERE id = ?', Math.max(0, Math.min(Number(P.max_discount || 25), Number(req.body?.discount_pct) || 0)), u.id);
  audit(req, req.body?.revoke ? 'partner.revoke' : 'partner.discount', 'user', u.id, req.body);
  res.json({ ok: true });
});
