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

test('product photos: upload 3 sizes, reorder, delete, shown in listings; AI fill needs a key', async () => {
  const st = await login('stockist@drovox.in', 'stock123');
  const p = get(`SELECT id, slug FROM products WHERE sku = 'DRV-ARD-UNO'`);
  const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP////////////////////////////////////////////////////////////////////////////////////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/AABEIAAEAAQMBIgACEQEDEQH/xAAUAAEAAAAAAAAAAAAAAAAAAAAA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEAMQAAABn//Z';
  const v = { s: JPG, m: JPG, l: JPG };
  const a = (await api('POST', `/api/stock/products/${p.id}/images`, { variants: v }, st)).data;
  const b = (await api('POST', `/api/stock/products/${p.id}/images`, { variants: v }, st)).data;
  assert.equal(b.images.length, 2); assert.match(a.images[0], /^[a-f0-9]{16}\.jpg$/);
  assert.equal((await api('POST', `/api/stock/products/${p.id}/images`, { variants: { s: PNG, m: PNG, l: PNG } }, st)).status, 400, 'PNG must be converted in the browser');
  const img = await fetch(`${base}/img/p/${a.images[0].replace('.jpg', '')}-s.jpg`);
  assert.equal(img.status, 200); assert.match(img.headers.get('cache-control'), /immutable/);
  const re = (await api('PUT', `/api/stock/products/${p.id}/images`, { images: [...b.images].reverse() }, st)).data;
  assert.equal(re.images[0], b.images[1]);
  const pd = (await api('GET', `/api/products/${p.slug}`)).data;
  assert.deepEqual(pd.images, re.images); assert.equal(pd.img, re.images[0]);
  const del = (await api('DELETE', `/api/stock/products/${p.id}/images/${re.images[0]}`, null, st)).data;
  assert.equal(del.images.length, 1);
  assert.equal((await fetch(`${base}/img/p/${re.images[0].replace('.jpg', '')}-s.jpg`)).status, 404);
  for (let i = 0; i < 4; i++) await api('POST', `/api/stock/products/${p.id}/images`, { variants: v }, st);
  assert.equal((await api('POST', `/api/stock/products/${p.id}/images`, { variants: v }, st)).status, 400, 'max 5 photos');
  // listing info fields
  const up = (await api('PUT', `/api/stock/products/${p.id}`, { short_description: 'Classic ATmega328P board.', highlights: 'USB-B\n14 digital I/O', in_box: ['1 × Uno board'] }, st)).data;
  assert.deepEqual(JSON.parse(up.highlights), ['USB-B', '14 digital I/O']);
  const pd2 = (await api('GET', `/api/products/${p.slug}`)).data;
  assert.equal(pd2.short_description, 'Classic ATmega328P board.'); assert.deepEqual(pd2.in_box, ['1 × Uno board']);
  const ai = await api('POST', '/api/stock/products/ai-fill', { name: 'HC-SR04' }, st);
  assert.equal(ai.status, 400); assert.match(ai.data.error, /API key/);
});

test('responses are compressed and public config is micro-cached', async () => {
  const r = await fetch(`${base}/api/categories`, { headers: { 'Accept-Encoding': 'gzip' } });
  await r.arrayBuffer();
  const r2 = await fetch(`${base}/api/categories`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(r2.headers.get('x-cache'), 'HIT');
  const big = await fetch(`${base}/api/home`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(big.headers.get('content-encoding'), 'gzip');
});

test('laser cutting: DXF measured (size, cut length, pierces), required to order, preview kept for staff', async () => {
  const { plateDxf } = await import('./fixtures/make-dxf.mjs');
  const data = Buffer.from(plateDxf()).toString('base64');
  const d = (await api('POST', '/api/services/dxf', { data, unit: 'mm' })).data;
  assert.equal(d.width_mm, 100); assert.equal(d.height_mm, 50); assert.equal(d.cut_length_m, 0.4); assert.equal(d.pierces, 3); assert.match(d.svg, /^<svg/);
  const inch = (await api('POST', '/api/services/dxf', { data, unit: 'inch' })).data;
  assert.equal(inch.width_mm, 2540);
  assert.equal((await api('POST', '/api/services/dxf', { data: Buffer.from('hello').toString('base64') })).status, 400);
  const tok = await login('demo@drovox.in', 'demo123');
  assert.equal((await api('POST', '/api/services/requests', { service: 'metal_laser', material: 'ss', thickness: 2, name: 'Demo', phone: '9876543210' }, tok)).status, 400, 'DXF required');
  const r = await api('POST', '/api/services/requests', { service: 'metal_laser', material: 'ss', thickness: 2, width_mm: 1, height_mm: 1, bends: 1, finish: 'powder', quantity: 2, name: 'Demo', phone: '9876543210', files: [{ name: 'plate.dxf', data }] }, tok);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.estimate.specs.width_mm, 100, 'size comes from the DXF, not the browser');
  assert.equal(r.data.estimate.specs.pierces, 3);
  assert.ok(r.data.estimate.lines.some((l) => l.label.startsWith('Pierces 3')));
  assert.ok(r.data.estimate.lines.some((l) => l.label.startsWith('Powder coating')));
  const st = await login('stockist@drovox.in', 'stock123');
  const svg = await fetch(`${base}/api/stock/services/${r.data.id}/dxf`, { headers: { Authorization: `Bearer ${st}` } });
  assert.equal(svg.status, 200); assert.match(svg.headers.get('content-type'), /svg/);
  const cat = (await api('GET', '/api/services')).data;
  assert.equal(cat.sheets.metal.length, 5); assert.ok(cat.battery.cells.length >= 5);
});

test('battery builder: specs, current limit warning, casing / charger / extras priced', async () => {
  const e = (await api('POST', '/api/services/estimate', { service: 'battery', mode: 'build', cell: '18650', series: 10, parallel: 2, bms_a: 30, casing: 'abs', charger: true, ntc: true, wire_cm: 30 })).data;
  assert.equal(e.info.nominal_v, 36); assert.equal(e.info.max_v, 42); assert.equal(e.info.capacity_ah, 5.2);
  assert.equal(e.info.max_current_a, 10); assert.match(e.info.warn, /high-drain/);
  for (const l of ['ABS plastic box', 'Output wire 30 cm', 'NTC temperature sensor', '42 V matching charger']) assert.ok(e.lines.some((x) => x.label.startsWith(l)), l);
  const lfp = (await api('POST', '/api/services/estimate', { service: 'battery', cell: 'lfp', series: 4, parallel: 3 })).data;
  assert.equal(lfp.info.nominal_v, 12.8); assert.equal(lfp.info.capacity_ah, 18);
});

test('DIY projects: starter set matched to the catalogue, public list/detail, staff CRUD', async () => {
  const list = (await api('GET', '/api/projects')).data;
  assert.ok(list.rows.length >= 8, 'demo seeds starter projects');
  const lf = list.rows.find((r) => r.slug === 'line-follower-robot');
  assert.ok(lf.parts_count >= 5 && lf.kit_price > 0);
  const d = (await api('GET', '/api/projects/line-follower-robot')).data;
  assert.ok(d.steps.length >= 4); assert.ok(d.parts.some((p) => p.sku === 'DRV-MD-L298N'));
  assert.equal((await api('GET', '/api/projects?category=Robotics')).data.rows.every((r) => r.category === 'Robotics'), true);
  const st = await login('stockist@drovox.in', 'stock123');
  const tok = await login('demo@drovox.in', 'demo123');
  assert.equal((await api('POST', '/api/stock/projects', { title: 'x' }, tok)).status, 403);
  const uno = get(`SELECT id FROM products WHERE sku = 'DRV-ARD-UNO'`).id;
  const c = (await api('POST', '/api/stock/projects', { title: 'Traffic Light Model', category: 'Arduino Basics', level: 'beginner', summary: '3 LEDs', steps: 'Wire LEDs\nUpload code', items: [{ product_id: uno, qty: 1 }, { product_id: uno, qty: 3 }] }, st)).data;
  assert.equal(c.slug, 'traffic-light-model');
  const got = (await api('GET', `/api/stock/projects/${c.id}`, null, st)).data;
  assert.equal(got.items.length, 1, 'duplicate parts merged'); assert.deepEqual(got.steps, ['Wire LEDs', 'Upload code']);
  assert.equal((await api('POST', '/api/stock/projects', { title: 'Bad', items: [{ product_id: 999999, qty: 1 }] }, st)).status, 400);
  await api('PUT', `/api/stock/projects/${c.id}`, { active: false }, st);
  assert.equal((await api('GET', '/api/projects/traffic-light-model')).status, 404);
  assert.equal((await api('POST', '/api/stock/projects/starter', {}, st)).data.added, 0, 'starter set is not duplicated');
  assert.equal((await api('DELETE', `/api/stock/projects/${c.id}`, null, st)).data.ok, true);
});

test('app: push token registration, assetlinks.json, FCM push for order updates', async () => {
  const crypto = await import('node:crypto');
  const { setSetting, getSetting } = await import('../server/db.js');
  const tok = await login('demo@drovox.in', 'demo123');
  assert.equal((await api('POST', '/api/me/push-token', { token: 'short' }, tok)).status, 400);
  assert.equal((await api('POST', '/api/me/push-token', { token: 'fcm-token-abcdefghijklmnopqrstuvwxyz' }, tok)).data.ok, true);
  assert.equal((await api('POST', '/api/me/push-token', { token: 'fcm-token-abcdefghijklmnopqrstuvwxyz' })).status, 401);
  assert.deepEqual(await (await fetch(`${base}/.well-known/assetlinks.json`)).json(), []);
  const fp = Array.from({ length: 32 }, () => 'AB').join(':');
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  setSetting('app', { ...getSetting('app'), android_sha256: fp, push_enabled: true, fcm_project_id: 'drovox-test', fcm_client_email: 'push@drovox-test.iam.gserviceaccount.com', fcm_private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const links = await (await fetch(`${base}/.well-known/assetlinks.json`)).json();
  assert.equal(links[0].target.package_name, 'in.drovox.app'); assert.deepEqual(links[0].target.sha256_cert_fingerprints, [fp]);
  const real = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, opt) => {
    if (String(url).startsWith('https://oauth2.googleapis.com')) { calls.push(['auth', String(opt.body)]); return new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 }); }
    if (String(url).startsWith('https://fcm.googleapis.com')) { calls.push(['send', String(url), JSON.parse(opt.body)]); return new Response('{}', { status: 200 }); }
    return real(url, opt);
  };
  try {
    const { pushToPhone } = await import('../server/services/push.js');
    const demo = get(`SELECT phone FROM users WHERE email = 'demo@drovox.in'`);
    pushToPhone(demo.phone, 'Your order DRV2611001 has been shipped');
    await new Promise((r) => setTimeout(r, 200));
  } finally { globalThis.fetch = real; setSetting('app', { ...getSetting('app'), push_enabled: false }); }
  assert.match(calls[0][1], /grant_type=urn/);
  const send = calls.find((c) => c[0] === 'send');
  assert.match(send[1], /projects\/drovox-test\/messages:send/);
  assert.equal(send[2].message.token, 'fcm-token-abcdefghijklmnopqrstuvwxyz');
  assert.equal(send[2].message.data.link, '#/order/DRV2611001');
});

test('app pages: notifications bell, waitlist, category photo', async () => {
  const tok = await login('demo@drovox.in', 'demo123');
  const st = await login('stockist@drovox.in', 'stock123');
  const n = (await api('GET', '/api/me/notifications', null, tok)).data;
  assert.ok(Array.isArray(n)); assert.ok(n.every((x) => x.body && x.created_at));
  assert.equal((await api('GET', '/api/me/notifications')).status, 401);
  const demo = get(`SELECT id, phone FROM users WHERE email = 'demo@drovox.in'`);
  const p = get(`SELECT id FROM products WHERE sku = 'DRV-ESP-32'`);
  const { run: dbRun } = await import('../server/db.js');
  const a = dbRun('INSERT INTO stock_alerts(product_id, user_id, phone) VALUES (?,?,?)', p.id, demo.id, demo.phone);
  const w = (await api('GET', '/api/me/waitlist', null, tok)).data;
  assert.ok(w.some((x) => x.sku === 'DRV-ESP-32' && x.alert_id === Number(a.lastInsertRowid)));
  await api('DELETE', `/api/me/waitlist/${a.lastInsertRowid}`, null, tok);
  assert.ok(!(await api('GET', '/api/me/waitlist', null, tok)).data.some((x) => x.alert_id === Number(a.lastInsertRowid)));
  const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP////////////////////////////////////////////////////////////////////////////////////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/AABEIAAEAAQMBIgACEQEDEQH/xAAUAAEAAAAAAAAAAAAAAAAAAAAA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEAMQAAABn//Z';
  const cat = get('SELECT id FROM categories ORDER BY id LIMIT 1');
  const r = (await api('POST', `/api/stock/categories/${cat.id}/image`, { variants: { s: JPG, m: JPG, l: JPG } }, st)).data;
  assert.match(r.image, /\.jpg$/);
  assert.equal((await api('GET', '/api/categories')).data.find((c) => c.id === cat.id).image, r.image);
  await api('DELETE', `/api/stock/categories/${cat.id}/image`, null, st);
  assert.equal((await api('GET', '/api/categories')).data.find((c) => c.id === cat.id).image, null);
});
