// Website content & tools: header/footer settings, home banners, reviews, blog, careers,
// ATL kits enquiry, BOM tool (paste a parts list → matched products → cart) and product compare.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { all, get, run, getSetting, DB_FILE } from '../db.js';
import { requireArea, audit } from '../auth.js';
import { scoreLead } from '../services/engine.js';
import { notify } from '../services/whatsapp.js';
import { parseTiers } from '../pricing.js';

const SITE_UPLOADS = path.join(path.dirname(DB_FILE), 'uploads', 'site');
const RESUMES = path.join(path.dirname(DB_FILE), 'uploads', 'resumes');
export const SITE_UPLOADS_DIR = SITE_UPLOADS;

const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80) || 'post';
function saveDataUrl(dir, dataUrl, allowed, maxBytes) {
  const m = String(dataUrl || '').match(/^data:([\w/+.-]+);base64,(.+)$/);
  if (!m) return null;
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf', 'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx' }[m[1]];
  if (!ext || !allowed.includes(ext)) throw Object.assign(new Error(`File type not allowed (${allowed.join(', ')})`), { status: 400 });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > maxBytes) throw Object.assign(new Error(`File is larger than ${Math.round(maxBytes / 1048576)} MB`), { status: 400 });
  fs.mkdirSync(dir, { recursive: true });
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(dir, name), buf);
  return name;
}

// ================================================================= public
export const content = express.Router();

content.get('/site', (_req, res) => {
  res.json({
    site: getSetting('site'),
    banners: all('SELECT id, title, subtitle, cta_text, link, bg, image FROM banners WHERE active = 1 ORDER BY sort, id'),
    reviews: all('SELECT id, name, rating, text, review_date, source, verified FROM reviews WHERE active = 1 ORDER BY sort, COALESCE(review_date, created_at) DESC LIMIT 30'),
    has_blog: !!get('SELECT 1 FROM posts WHERE published = 1'), has_jobs: !!get('SELECT 1 FROM jobs WHERE active = 1'),
  });
});

content.get('/posts', (_req, res) => res.json(all('SELECT id, slug, title, excerpt, cover, tags, created_at FROM posts WHERE published = 1 ORDER BY id DESC')));
content.get('/posts/:slug', (req, res) => {
  const p = get('SELECT * FROM posts WHERE slug = ? AND published = 1', req.params.slug);
  p ? res.json(p) : res.status(404).json({ error: 'Post not found' });
});

content.get('/jobs', (_req, res) => res.json(all('SELECT id, title, location, type, description, created_at FROM jobs WHERE active = 1 ORDER BY id DESC')));
content.post('/jobs/:id/apply', (req, res, next) => {
  try {
    const job = get('SELECT * FROM jobs WHERE id = ? AND active = 1', req.params.id);
    if (!job) return res.status(404).json({ error: 'This opening is closed' });
    const b = req.body || {};
    if (!String(b.name || '').trim() || String(b.phone || '').replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'Name and a 10-digit mobile number are required' });
    const resume = b.resume ? saveDataUrl(RESUMES, b.resume, ['pdf', 'doc', 'docx'], 5 * 1048576) : null;
    run('INSERT INTO job_applications(job_id, name, phone, email, message, resume) VALUES (?,?,?,?,?,?)', job.id, b.name.trim(), b.phone, b.email || null, String(b.message || '').slice(0, 2000) || null, resume);
    const store = getSetting('store');
    if (store.support_phone) notify(store.support_phone, `New job application for “${job.title}” from ${b.name} (${b.phone}).`);
    res.json({ ok: true, message: 'Application received. We will contact you if your profile matches.' });
  } catch (e) { next(e); }
});

/** ATL (Atal Tinkering Lab) kit enquiry → CRM lead. */
content.post('/atl-enquiry', (req, res) => {
  const b = req.body || {};
  if (!String(b.name || '').trim() || String(b.phone || '').replace(/\D/g, '').length < 10 || !String(b.school || '').trim()) return res.status(400).json({ error: 'School name, contact name and a 10-digit mobile number are required' });
  const packs = Array.isArray(b.packages) ? b.packages.slice(0, 8).map(String) : [];
  const interest = `ATL kits: ${packs.join(', ') || 'full lab'}${b.students ? ` · ${b.students} students` : ''}${b.city ? ` · ${b.city}` : ''}`;
  const r = run(`INSERT INTO leads(name, email, phone, company, source, interest, value_estimate, user_id, notes) VALUES (?,?,?,?, 'atl', ?, ?, ?, ?)`,
    b.name.trim(), b.email || null, b.phone, b.school.trim(), interest, Number(b.budget) || 0, req.user?.id ?? null, String(b.message || '').slice(0, 1000) || null);
  const l = get('SELECT * FROM leads WHERE id = ?', r.lastInsertRowid); run('UPDATE leads SET score = ? WHERE id = ?', scoreLead(l), l.id);
  const store = getSetting('store');
  notify(b.phone, `Thank you for your Atal Tinkering Lab enquiry, ${b.name.split(' ')[0]}. Our ATL team will share the equipment list and quotation for ${b.school} on WhatsApp shortly. — ${store.name}`);
  if (store.support_phone) notify(store.support_phone, `New ATL enquiry: ${b.school} (${b.phone}) — ${interest}`);
  res.json({ ok: true, message: 'Thank you! Our ATL team will send the equipment list and quotation on WhatsApp.' });
});

/**
 * BOM tool: paste a parts list ("2 x Arduino Uno", "HC-SR04, 5", "L298N\t2", CSV) and get catalogue matches.
 * Matching scores each product by shared words in name, SKU and tags.
 */
content.post('/bom/match', (req, res) => {
  const text = String(req.body?.text || '').slice(0, 20000);
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 200);
  const products = all(`SELECT id, sku, name, slug, price, mrp, stock, image, category_id, tags, tiers FROM products WHERE active = 1`);
  const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9.\- ]/g, ' ').split(/\s+/).filter((w) => w.length > 1);
  const out = rows.map((line) => {
    let qty = 1; let name = line;
    let m = line.match(/^(\d{1,5})\s*(?:x|×|pcs|nos|no\.?|units?)?\s*[-,:\t]?\s*(.+)$/i);
    if (m) { qty = Number(m[1]); name = m[2]; } else if ((m = line.match(/^(.+?)[\s,;\t]+(?:x|×|qty:?\s*)?(\d{1,5})\s*(?:pcs|nos|units?)?$/i))) { name = m[1]; qty = Number(m[2]); }
    const q = words(name);
    const scored = products.map((p) => {
      const hay = words(`${p.name} ${p.sku} ${p.tags}`); const sku = p.sku.toLowerCase();
      let s = 0; for (const w of q) { if (sku === w) s += 10; else if (hay.includes(w)) s += 2; else if (hay.some((h) => h.startsWith(w) || w.startsWith(h))) s += 1; }
      return { p, s: q.length ? s / q.length : 0 };
    }).filter((x) => x.s >= 0.75).sort((a, b) => b.s - a.s).slice(0, 3);
    const card = (p) => { const tiers = parseTiers(p); let unit = p.price; for (const t of tiers) if (qty >= t.min_qty) unit = Math.min(unit, t.price); return { id: p.id, sku: p.sku, name: p.name, slug: p.slug, image: p.image, category_id: p.category_id, stock: p.stock, price: p.price, unit_price: unit }; };
    return { line, name: name.trim(), qty: Math.max(1, Math.min(9999, qty)), match: scored[0] ? card(scored[0].p) : null, alternatives: scored.slice(1).map((x) => card(x.p)) };
  });
  res.json({ rows: out, matched: out.filter((r) => r.match).length, total: out.length });
});

content.post('/products/compare', (req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter(Boolean).slice(0, 4);
  res.json(ids.map((id) => get('SELECT p.*, c.name category FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ? AND p.active = 1', id)).filter(Boolean)
    .map((p) => ({ id: p.id, sku: p.sku, slug: p.slug, name: p.name, image: p.image, category: p.category, category_id: p.category_id, brand: p.brand, price: p.price, mrp: p.mrp, stock: p.stock, gst_rate: p.gst_rate, hsn: p.hsn, specs: JSON.parse(p.specs || '{}'), tiers: parseTiers(p) })));
});

// ================================================================= admin
export const contentAdmin = express.Router();
contentAdmin.use(requireArea('marketing'));

const TABLES = {
  banners: { cols: ['title', 'subtitle', 'cta_text', 'link', 'bg', 'sort', 'active'], order: 'sort, id', required: ['title'] },
  reviews: { cols: ['name', 'rating', 'text', 'review_date', 'source', 'verified', 'active', 'sort'], order: 'sort, id DESC', required: ['name', 'text'] },
  posts: { cols: ['title', 'excerpt', 'body', 'cover', 'tags', 'published'], order: 'id DESC', required: ['title', 'body'] },
  jobs: { cols: ['title', 'location', 'type', 'description', 'active'], order: 'id DESC', required: ['title', 'description'] },
};
const clean = (t, b) => {
  const o = {};
  for (const c of TABLES[t].cols) if (b[c] !== undefined) o[c] = typeof b[c] === 'boolean' ? (b[c] ? 1 : 0) : b[c];
  if (o.rating !== undefined) o.rating = Math.max(1, Math.min(5, Math.round(Number(o.rating) || 5)));
  if (o.sort !== undefined) o.sort = Number(o.sort) || 0;
  return o;
};

contentAdmin.get('/:table', (req, res) => {
  const t = TABLES[req.params.table]; if (!t) return res.status(404).json({ error: 'Unknown content type' });
  res.json(all(`SELECT * FROM ${req.params.table} ORDER BY ${t.order}`));
});
contentAdmin.post('/:table', (req, res, next) => {
  try {
    const name = req.params.table; const t = TABLES[name]; if (!t) return res.status(404).json({ error: 'Unknown content type' });
    const o = clean(name, req.body || {});
    for (const r of t.required) if (!String(o[r] ?? '').trim()) return res.status(400).json({ error: `${r} is required` });
    if (name === 'banners' && req.body?.image_data) o.image = saveDataUrl(SITE_UPLOADS, req.body.image_data, ['png', 'jpg', 'webp', 'gif'], 3 * 1048576);
    if (name === 'posts') { let slug = slugify(o.title); let n = 2; while (get('SELECT 1 FROM posts WHERE slug = ?', slug)) slug = `${slugify(o.title)}-${n++}`; o.slug = slug; }
    const cols = Object.keys(o);
    const r = run(`INSERT INTO ${name}(${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...cols.map((c) => o[c]));
    audit(req, `content.${name}.create`, name, r.lastInsertRowid, { title: o.title || o.name });
    res.json(get(`SELECT * FROM ${name} WHERE id = ?`, r.lastInsertRowid));
  } catch (e) { next(e); }
});
contentAdmin.put('/:table/:id', (req, res, next) => {
  try {
    const name = req.params.table; if (!TABLES[name]) return res.status(404).json({ error: 'Unknown content type' });
    const old = get(`SELECT * FROM ${name} WHERE id = ?`, req.params.id); if (!old) return res.status(404).json({ error: 'Not found' });
    const o = clean(name, req.body || {});
    if (name === 'banners' && req.body?.image_data) o.image = saveDataUrl(SITE_UPLOADS, req.body.image_data, ['png', 'jpg', 'webp', 'gif'], 3 * 1048576);
    if (name === 'banners' && req.body?.remove_image) o.image = null;
    if (name === 'posts') o.updated_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const cols = Object.keys(o); if (!cols.length) return res.json(old);
    run(`UPDATE ${name} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...cols.map((c) => o[c]), old.id);
    audit(req, `content.${name}.update`, name, old.id, { fields: cols });
    res.json(get(`SELECT * FROM ${name} WHERE id = ?`, old.id));
  } catch (e) { next(e); }
});
contentAdmin.delete('/:table/:id', (req, res) => {
  const name = req.params.table; if (!TABLES[name]) return res.status(404).json({ error: 'Unknown content type' });
  run(`DELETE FROM ${name} WHERE id = ?`, req.params.id);
  audit(req, `content.${name}.delete`, name, req.params.id);
  res.json({ ok: true });
});
contentAdmin.get('/applications/list', (_req, res) => res.json(all('SELECT a.*, j.title job FROM job_applications a LEFT JOIN jobs j ON j.id = a.job_id ORDER BY a.id DESC LIMIT 300')));
contentAdmin.get('/applications/:id/resume', (req, res) => {
  const a = get('SELECT * FROM job_applications WHERE id = ?', req.params.id);
  if (!a?.resume) return res.status(404).json({ error: 'No resume uploaded' });
  res.download(path.join(RESUMES, path.basename(a.resume)), `${a.name.replace(/[^A-Za-z0-9]+/g, '_')}-resume${path.extname(a.resume)}`);
});
