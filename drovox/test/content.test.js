// Robu-style site features: six services, banners/reviews/blog/careers content, ATL enquiry, BOM tool, compare.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drovox-content-'));
process.env.DROVOX_DATA_DIR = dir;
const { createApp } = await import('../server/index.js');
const { seed } = await import('../server/seed.js');
const { get } = await import('../server/db.js');

let server; let base;
async function api(method, url, body, token) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, data: ct.includes('json') ? await r.json() : await r.arrayBuffer() };
}
const login = async (email, password) => (await api('POST', '/api/auth/login', { email, password })).data.token;
before(async () => { seed(); await new Promise((ok) => { server = createApp().listen(0, ok); }); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('six services in catalogue order with new estimators', async () => {
  const cat = (await api('GET', '/api/services')).data;
  assert.deepEqual(cat.services.map((s) => s.id), ['industrial3d', 'print3d', 'metal_laser', 'battery', 'laser', 'pcb']);
  assert.ok(cat.services.every((s) => s.materials.length && s.features.length));
  const ind = (await api('POST', '/api/services/estimate', { service: 'industrial3d', material: 'sls_nylon', volume_cm3: 50, quantity: 2 })).data;
  assert.equal(ind.subtotal, 50 * 22 * 2 + 300);
  const met = (await api('POST', '/api/services/estimate', { service: 'metal_laser', material: 'ss', thickness: 2, width_mm: 100, height_mm: 100, bends: 2 })).data;
  assert.equal(met.specs.thickness, 2);
  assert.ok(met.lines.some((l) => l.label.startsWith('Stainless steel SS304 2 mm')));
  assert.ok(met.lines.some((l) => l.label.startsWith('Bending 2')));
  const bad = (await api('POST', '/api/services/estimate', { service: 'metal_laser', material: 'brass', thickness: 6, width_mm: 50, height_mm: 50 })).data;
  assert.ok(bad.specs.thickness <= 2, 'thickness snaps to what brass supports');
  const acr = (await api('POST', '/api/services/estimate', { service: 'laser', material: 'acr5', colour: 'Black', width_mm: 100, height_mm: 100 })).data;
  assert.ok(acr.lines[0].label.startsWith('Acrylic 5 mm Black'));
  assert.equal((await api('POST', '/api/services/estimate', { service: 'industrial3d' })).status, 400);
});

test('banners, reviews, blog and careers managed from the master panel', async () => {
  const mk = await login('marketing@drovox.in', 'market123');
  const st = await login('stockist@drovox.in', 'stock123');
  assert.equal((await api('GET', '/api/admin/content/banners', null, st)).status, 403);
  const b = await api('POST', '/api/admin/content/banners', { title: 'Diwali Sale', subtitle: 'Up to 25% off', link: '#/c/drone', image_data: PNG, active: true }, mk);
  assert.equal(b.status, 200, JSON.stringify(b.data));
  assert.match(b.data.image, /\.png$/);
  const img = await fetch(`${base}/uploads/site/${b.data.image}`); assert.equal(img.status, 200);
  await api('POST', '/api/admin/content/reviews', { name: 'Samuel', rating: 5, text: 'Great and reliable', source: 'Google', review_date: '2026-04-23' }, mk);
  await api('POST', '/api/admin/content/reviews', { name: 'Hidden', rating: 4, text: 'x', active: false }, mk);
  const site = (await api('GET', '/api/site')).data;
  assert.equal(site.banners.length, 1);
  assert.deepEqual(site.reviews.map((r) => r.name), ['Samuel']);
  assert.equal(site.has_blog, false);
  const p1 = (await api('POST', '/api/admin/content/posts', { title: 'How to make a drone', excerpt: 'F450 guide', body: 'Intro\n\n## Parts\nFrame' }, mk)).data;
  const p2 = (await api('POST', '/api/admin/content/posts', { title: 'How to make a drone', body: 'Second' }, mk)).data;
  assert.equal(p1.slug, 'how-to-make-a-drone'); assert.equal(p2.slug, 'how-to-make-a-drone-2');
  assert.equal((await api('GET', '/api/posts/how-to-make-a-drone')).data.title, 'How to make a drone');
  await api('PUT', `/api/admin/content/posts/${p2.id}`, { published: false }, mk);
  assert.equal((await api('GET', '/api/posts')).data.length, 1);
  const job = (await api('POST', '/api/admin/content/jobs', { title: 'Warehouse executive', location: 'Pune', type: 'Full-time', description: 'Packing & dispatch' }, mk)).data;
  const apply = await api('POST', `/api/jobs/${job.id}/apply`, { name: 'Ravi', phone: '9000012345', resume: 'data:application/pdf;base64,JVBERi0xLjQK' });
  assert.equal(apply.status, 200);
  assert.equal((await api('POST', `/api/jobs/${job.id}/apply`, { name: 'Ravi', phone: '9000012345', resume: 'data:text/html;base64,PGI+' })).status, 400);
  const apps = (await api('GET', '/api/admin/content/applications/list', null, mk)).data;
  assert.equal(apps[0].job, 'Warehouse executive');
  const cv = await api('GET', `/api/admin/content/applications/${apps[0].id}/resume`, null, mk);
  assert.equal(cv.status, 200);
  assert.ok(get(`SELECT 1 FROM audit_logs WHERE action = 'content.banners.create'`));
});

test('ATL enquiry creates a CRM lead', async () => {
  const r = await api('POST', '/api/atl-enquiry', { school: 'Govt High School Pune', name: 'Mrs Patil', phone: '9822012345', packages: ['Electronics, robotics & IoT kits'], students: 'Up to 60' });
  assert.equal(r.status, 200);
  const lead = get(`SELECT * FROM leads WHERE source = 'atl' AND company = 'Govt High School Pune'`);
  assert.match(lead.interest, /Electronics, robotics/);
  assert.equal((await api('POST', '/api/atl-enquiry', { name: 'x', phone: '1' })).status, 400);
});

test('BOM tool matches pasted lines to catalogue with quantities and bulk prices', async () => {
  const r = (await api('POST', '/api/bom/match', { text: '10 x Arduino Uno\nHC-SR04 ultrasonic, 4\nL298N motor driver\t2\nflux capacitor 1' })).data;
  assert.equal(r.total, 4);
  assert.equal(r.rows[0].qty, 10); assert.equal(r.rows[0].match.sku, 'DRV-ARD-UNO'); assert.equal(r.rows[0].match.unit_price, 359);
  assert.equal(r.rows[1].qty, 4); assert.equal(r.rows[1].match.sku, 'DRV-SEN-HCSR04');
  assert.equal(r.rows[2].qty, 2); assert.equal(r.rows[2].match.sku, 'DRV-MD-L298N');
  assert.equal(r.rows[3].match, null);
});

test('compare returns specs and tiers for up to 4 products', async () => {
  const ids = ['DRV-ARD-UNO', 'DRV-ARD-NANO', 'DRV-ESP-32', 'DRV-ESP-8266', 'DRV-ARD-MEGA'].map((s) => get('SELECT id FROM products WHERE sku = ?', s).id);
  const r = (await api('POST', '/api/products/compare', { ids })).data;
  assert.equal(r.length, 4);
  assert.ok(r[0].specs.MCU && r[0].tiers.length);
});

test('sell-on-Drovox partner type is offered', async () => {
  const p = (await api('GET', '/api/partner/program')).data;
  assert.ok(p.types.some((t) => t.id === 'seller'));
});
