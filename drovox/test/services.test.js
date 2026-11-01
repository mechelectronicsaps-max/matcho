// Fabrication services (estimates, file upload, quote → approve → production) and the partner program.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drovox-svc-'));
process.env.DROVOX_DATA_DIR = dir;
const { createApp } = await import('../server/index.js');
const { seed } = await import('../server/seed.js');
const { get } = await import('../server/db.js');

let server; let base;
async function api(method, url, body, token) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const ct = r.headers.get('content-type') || '';
  return { status: r.status, data: ct.includes('json') ? await r.json() : await r.text() };
}
const login = async (email, password) => (await api('POST', '/api/auth/login', { email, password })).data.token;
before(async () => { seed(); await new Promise((ok) => { server = createApp().listen(0, ok); }); base = `http://127.0.0.1:${server.address().port}`; });
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('instant estimates for every service', async () => {
  const p = (await api('POST', '/api/services/estimate', { service: 'print3d', material: 'pla', grams: 100, quality: 'standard', quantity: 2 })).data;
  assert.equal(p.subtotal, 100 * 6 * 2 + 50);
  assert.equal(p.total, Math.round(p.subtotal * 1.18 * 100) / 100);
  const small = (await api('POST', '/api/services/estimate', { service: 'print3d', grams: 5 })).data;
  assert.equal(small.subtotal, 149); // minimum order
  const pcb = (await api('POST', '/api/services/estimate', { service: 'pcb', layers: 2, width_mm: 100, height_mm: 50, quantity: 10, colour: 'black', stencil: true })).data;
  assert.equal(pcb.subtotal, 600 + 50 * 10 * 1.3 + 300 + 450);
  const acr = (await api('POST', '/api/services/estimate', { service: 'acrylic', material: '3', width_mm: 200, height_mm: 100, quantity: 2 })).data;
  assert.ok(acr.lines.some((l) => l.label.startsWith('Acrylic 3 mm')));
  const bat = (await api('POST', '/api/services/estimate', { service: 'battery', mode: 'build', cell: '18650', series: 4, parallel: 3, bms_a: 20 })).data;
  assert.equal(bat.info.cells, 12); assert.equal(bat.info.nominal_v, 14.4); assert.equal(bat.info.capacity_ah, 7.8);
  const test_ = (await api('POST', '/api/services/estimate', { service: 'battery', mode: 'test', quantity: 2 })).data;
  assert.equal(test_.subtotal, 398);
  assert.equal((await api('POST', '/api/services/estimate', { service: 'pcb' })).status, 400);
  assert.equal((await api('POST', '/api/services/estimate', { service: 'nope' })).status, 400);
});

test('service request with file → quote → customer approves → production → ready', async () => {
  const tok = await login('demo@drovox.in', 'demo123');
  const bad = await api('POST', '/api/services/requests', { service: 'print3d', grams: 40, name: 'Demo', phone: '9876543210', files: [{ name: 'virus.exe', data: 'aGk=' }] }, tok);
  assert.equal(bad.status, 400);
  const stl = Buffer.from('solid test\nendsolid test\n').toString('base64');
  const r = await api('POST', '/api/services/requests', { service: 'print3d', material: 'petg', grams: 40, quantity: 3, name: 'Demo Maker', phone: '9876543210', notes: 'Bracket', files: [{ name: 'bracket.stl', data: stl }] }, tok);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.req_no, /^SR\d{7}$/);
  const st = await login('stockist@drovox.in', 'stock123');
  const list = (await api('GET', '/api/stock/services?status=new', null, st)).data;
  const job = list.rows.find((x) => x.req_no === r.data.req_no);
  assert.equal(job.files.length, 1);
  const file = await api('GET', `/api/stock/services/${job.id}/files/0`, null, st);
  assert.match(file.data, /solid test/);
  assert.equal((await api('PUT', `/api/stock/services/${job.id}`, { status: 'quoted', quoted_price: '' }, st)).status, 400); // a quote needs a price
});

test('quote needs a price; approval flow and WhatsApp messages', async () => {
  const tok = await login('demo@drovox.in', 'demo123');
  const st = await login('stockist@drovox.in', 'stock123');
  const r = (await api('POST', '/api/services/requests', { service: 'acrylic', material: '3', width_mm: 150, height_mm: 100, name: 'Demo Maker', phone: '9876543210' }, tok)).data;
  const id = r.id;
  assert.equal((await api('PUT', `/api/stock/services/${id}`, { status: 'quoted' }, st)).status, 400);
  const q = await api('PUT', `/api/stock/services/${id}`, { status: 'quoted', quoted_price: 499, lead_days: 2 }, st);
  assert.equal(q.data.request.status, 'quoted');
  assert.equal(q.data.whatsapp.ok, true);
  assert.ok(get(`SELECT 1 FROM notifications WHERE body LIKE ? AND body LIKE '%₹499%'`, `%${r.req_no}%`));
  const mine = (await api('GET', '/api/me/services', null, tok)).data;
  assert.ok(mine.some((x) => x.req_no === r.req_no && x.status === 'quoted'));
  assert.equal((await api('POST', `/api/me/services/${r.req_no}/accept`, {}, tok)).data.status, 'approved');
  assert.equal((await api('POST', `/api/me/services/${r.req_no}/accept`, {}, tok)).status, 400);
  await api('PUT', `/api/stock/services/${id}`, { status: 'in_production' }, st);
  const ready = await api('PUT', `/api/stock/services/${id}`, { status: 'ready' }, st);
  assert.equal(ready.data.request.status, 'ready');
  assert.ok(get(`SELECT 1 FROM notifications WHERE body LIKE ? AND body LIKE '%READY%'`, `%${r.req_no}%`));
  // customers cannot reach staff endpoints
  assert.equal((await api('GET', '/api/stock/services', null, tok)).status, 403);
});

test('partner program: apply → approve → partner discount at checkout', async () => {
  const reg = await api('POST', '/api/auth/register', { name: 'Shop Owner', email: 'shop@partner.test', phone: '9123400000', password: 'secret12' });
  const tok = reg.data.token;
  const uno = get(`SELECT id FROM products WHERE sku = 'DRV-ARD-UNO'`).id;
  const before = (await api('POST', '/api/cart/quote', { items: [{ product_id: uno, qty: 2 }], state_code: '27' }, tok)).data;
  assert.equal(before.partner_discount, 0);
  assert.equal((await api('POST', '/api/partner/apply', { type: 'nope' }, tok)).status, 400);
  const ap = await api('POST', '/api/partner/apply', { type: 'reseller', company: 'Shop Electronics', name: 'Shop Owner', phone: '9123400000', monthly_volume: '₹25,000 – ₹1 lakh' }, tok);
  assert.equal(ap.status, 200);
  assert.equal((await api('POST', '/api/partner/apply', { type: 'reseller', name: 'x', phone: '9123400000' }, tok)).status, 409);
  assert.ok(get(`SELECT 1 FROM leads WHERE source = 'partner' AND phone = '9123400000'`));
  const ad = await login('admin@drovox.in', 'admin123');
  const list = (await api('GET', '/api/admin/partners', null, ad)).data;
  const app_ = list.applications.find((a) => a.company === 'Shop Electronics');
  assert.ok(app_, JSON.stringify(list).slice(0, 300));
  assert.equal(app_.discount_pct, 10);
  assert.equal((await api('POST', `/api/admin/partners/${app_.id}/decision`, { approve: true, discount_pct: 12 }, ad)).status, 200);
  const prog = (await api('GET', '/api/partner/program', null, tok)).data;
  assert.equal(prog.partner.discount, 12);
  const after_ = (await api('POST', '/api/cart/quote', { items: [{ product_id: uno, qty: 2 }], state_code: '27', payment_method: 'cod' }, tok)).data;
  assert.equal(after_.partner_discount, Math.round(before.subtotal * 0.12 * 100) / 100);
  assert.ok(after_.total < before.total);
  const o = await api('POST', '/api/orders', { items: [{ product_id: uno, qty: 2 }], payment_method: 'cod', address: { name: 'Shop', phone: '9123400000', line1: 'MG Road', city: 'Pune', state_code: '27', pincode: '411001' } }, tok);
  assert.equal(o.data.order.partner_discount, after_.partner_discount);
  assert.equal(o.data.order.total, after_.total);
  // marketing can manage partners; stockists cannot
  assert.equal((await api('GET', '/api/admin/partners', null, await login('stockist@drovox.in', 'stock123'))).status, 403);
  await api('PUT', `/api/admin/partners/user/${reg.data.user.id}`, { revoke: true }, ad);
  assert.equal((await api('POST', '/api/cart/quote', { items: [{ product_id: uno, qty: 2 }], state_code: '27' }, tok)).data.partner_discount, 0);
});

test('PCB: Gerber ZIP is rendered, measured and required for orders', async () => {
  const zip = fs.readFileSync(new URL('./fixtures/sample-gerber.zip', import.meta.url)).toString('base64');
  const g = (await api('POST', '/api/services/pcb/gerber', { name: 'board.zip', data: zip })).data;
  assert.equal(g.width_mm, 50); assert.equal(g.height_mm, 30); assert.equal(g.layers, 2);
  assert.equal(g.has_outline, true); assert.equal(g.drill_hits, 2);
  assert.match(g.top_svg, /^<svg/); assert.match(g.bottom_svg, /^<svg/);
  assert.equal((await api('POST', '/api/services/pcb/gerber', { name: 'x.zip', data: Buffer.from('not a zip').toString('base64') })).status, 400);
  // full option pricing
  const e = (await api('POST', '/api/services/estimate', { service: 'pcb', layers: 4, width_mm: 50, height_mm: 30, quantity: 10, finish: 'hasl_lf', copper: '2', gold_fingers: true, impedance: true, build: 'express' })).data;
  assert.ok(e.lines.some((l) => l.label.startsWith('Multilayer engineering')));
  assert.ok(e.lines.some((l) => l.label.includes('2 oz')));
  assert.ok(e.lines.some((l) => l.label.startsWith('Express build')));
  assert.match(e.info.build_days, /express/);
  assert.equal((await api('POST', '/api/services/estimate', { service: 'pcb', material: 'aluminium', layers: 2, width_mm: 50, height_mm: 30 })).status, 400);
  // ordering needs the Gerber ZIP; the order keeps the render and detected size
  const tok = await login('demo@drovox.in', 'demo123');
  const no = await api('POST', '/api/services/requests', { service: 'pcb', width_mm: 50, height_mm: 30, name: 'Demo', phone: '9876543210' }, tok);
  assert.equal(no.status, 400);
  const r = await api('POST', '/api/services/requests', { service: 'pcb', layers: 2, width_mm: 50, height_mm: 30, quantity: 5, name: 'Demo', phone: '9876543210', files: [{ name: 'board.zip', data: zip }] }, tok);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const st = await login('stockist@drovox.in', 'stock123');
  const list = (await api('GET', '/api/stock/services?service=pcb', null, st)).data;
  assert.ok(list.rows.every((x) => x.service === 'pcb'));
  assert.ok(list.by_service.pcb >= 1);
  const job = list.rows.find((x) => x.req_no === r.data.req_no);
  assert.equal(job.specs.gerber.width_mm, 50);
  const svg = await api('GET', `/api/stock/services/${job.id}/gerber/top`, null, st);
  assert.equal(svg.status, 200); assert.match(svg.data, /<svg/);
});

test('loose, unordered outline segments are joined into one closed board shape', async () => {
  const { fixOutline } = await import('../server/services/gerber.js');
  const svg = '<svg viewBox="0 0 50000 30000" width="50mm"><defs><clipPath id="X_top_outline"><path d="M 0 0 50000 0 M 50000 30000 50000 5 M 0 30000 50000 30000 M 0 0 0 30000" fill="none"/></clipPath></defs></svg>';
  const f = fixOutline(svg, 50);
  assert.match(f.apply(svg), /<clipPath id="X_top_outline"><path d="M 0 0 L 50000 0 L 50000 30000 L 0 30000 L 0 0 Z"\/>/);
  assert.equal(f.note, '');
  assert.deepEqual(f.polygon[2], [50, 30]);
  const open = fixOutline(svg.replace('M 0 0 0 30000', ''), 50);
  assert.match(open.note, /not a closed shape/);
  assert.match(open.apply(svg), /<rect x="0" y="0" width="50000" height="30000"\/>/);
});
