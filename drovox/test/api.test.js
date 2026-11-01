// End-to-end API tests against a fresh seeded database in a temp directory.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drovox-test-'));
process.env.DROVOX_DATA_DIR = dir;

let server; let base;
const { createApp } = await import('../server/index.js');
const { seed } = await import('../server/seed.js');
const { get } = await import('../server/db.js');

async function api(method, url, body, token) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => null);
  return { status: r.status, data };
}
const login = async (email, password) => (await api('POST', '/api/auth/login', { email, password })).data.token;

before(async () => {
  seed();
  await new Promise((ok) => { server = createApp().listen(0, ok); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const addr = { name: 'Test Buyer', phone: '9123456789', line1: '1 Test Street', city: 'Pune', state_code: '27', pincode: '411001' };

test('catalogue, search with typo correction and product detail', async () => {
  const cats = await api('GET', '/api/categories');
  assert.ok(cats.data.length >= 10);
  const s = await api('GET', '/api/products?q=arduno');
  assert.equal(s.data.corrected, 'arduino');
  assert.ok(s.data.items.some((p) => p.sku === 'DRV-ARD-UNO'));
  const d = await api('GET', '/api/products/DRV-ARD-UNO');
  assert.equal(d.status, 200);
  assert.ok(d.data.tiers.length > 0);
  assert.ok(Array.isArray(d.data.bought_together));
});

test('quote applies bulk tiers and splits GST intra vs inter state', async () => {
  const uno = get(`SELECT id FROM products WHERE sku = 'DRV-ARD-UNO'`).id;
  const intra = (await api('POST', '/api/cart/quote', { items: [{ product_id: uno, qty: 10 }], state_code: '27' })).data;
  assert.equal(intra.lines[0].unit_price, 359);
  assert.equal(intra.subtotal, 3590);
  assert.equal(intra.shipping, 0);
  assert.ok(intra.gst.cgst > 0 && intra.gst.cgst === intra.gst.sgst && intra.gst.igst === 0);
  assert.ok(Math.abs(intra.gst.taxable + intra.gst.total_tax - intra.total) < 0.05);
  const inter = (await api('POST', '/api/cart/quote', { items: [{ product_id: uno, qty: 1 }], state_code: '29' })).data;
  assert.equal(inter.gst.cgst, 0);
  assert.ok(inter.gst.igst > 0);
  assert.equal(inter.shipping, 59);
  assert.equal(inter.lines[0].nudge.add, 4);
});

test('register with referral, checkout with coupon + points, pay, fulfil, deliver → points and referral bonus', async () => {
  const reg = await api('POST', '/api/auth/register', { name: 'New Maker', email: 'new@maker.test', phone: '9123456789', password: 'secret12', referral_code: 'DEMO100' });
  assert.equal(reg.status, 200);
  const tok = reg.data.token;
  const me = (await api('GET', '/api/me', null, tok)).data;
  assert.equal(me.points, 150); // 50 signup + 100 referee
  const esp = get(`SELECT id, stock FROM products WHERE sku = 'DRV-ESP-32'`);
  const items = [{ product_id: esp.id, qty: 3 }];
  const q = (await api('POST', '/api/cart/quote', { items, coupon_code: 'WELCOME10', redeem_points: 'max', state_code: '27' }, tok)).data;
  assert.equal(q.coupon.code, 'WELCOME10');
  assert.ok(q.points_redeemed > 0 && q.points_redeemed <= 150);

  const placed = await api('POST', '/api/orders', { items, coupon_code: 'WELCOME10', redeem_points: 'max', payment_method: 'test', address: addr }, tok);
  assert.equal(placed.status, 200, JSON.stringify(placed.data));
  const no = placed.data.order.order_no;
  assert.equal(placed.data.order.total, q.total);
  assert.equal(get('SELECT stock FROM products WHERE id = ?', esp.id).stock, esp.stock - 3);

  const paid = await api('POST', `/api/orders/${no}/pay/test`, {}, tok);
  assert.equal(paid.data.status, 'confirmed');
  assert.match(paid.data.invoice_no, /^DRV\/\d{4}-\d{2}\/\d{5}$/);
  const inv = await api('GET', `/api/orders/${no}/invoice`, null, tok);
  assert.equal(inv.status, 200);

  // coupon is single use per user
  const again = await api('POST', '/api/orders', { items, coupon_code: 'WELCOME10', payment_method: 'test', address: addr }, tok);
  assert.equal(again.status, 400);

  const st = await login('stockist@drovox.in', 'stock123');
  const id = paid.data.id;
  assert.equal((await api('POST', `/api/stock/orders/${id}/status`, { to: 'packed' }, st)).status, 200);
  const shipped = await api('POST', `/api/stock/orders/${id}/status`, { to: 'shipped', courier: 'Delhivery', awb: 'AWB123' }, st);
  assert.equal(shipped.data.awb, 'AWB123');
  const bad = await api('POST', `/api/stock/orders/${id}/status`, { to: 'packed' }, st);
  assert.equal(bad.status, 400);
  const demoBefore = get(`SELECT points FROM users WHERE email = 'demo@drovox.in'`).points;
  await api('POST', `/api/stock/orders/${id}/status`, { to: 'delivered' }, st);
  const after = (await api('GET', '/api/me', null, tok)).data;
  assert.equal(after.points, 150 - q.points_redeemed + q.points_earned);
  assert.equal(get(`SELECT points FROM users WHERE email = 'demo@drovox.in'`).points, demoBefore + 150);

  const track = await api('GET', `/api/track/${no}?phone=6789`);
  assert.equal(track.data.status, 'delivered');
  assert.equal((await api('GET', `/api/track/${no}?phone=0000`)).status, 404);
  const wa = get(`SELECT COUNT(*) n FROM notifications WHERE order_id = ?`, id).n;
  assert.ok(wa >= 3, 'WhatsApp updates recorded');
});

test('COD auto-confirms; customer cancel restores stock', async () => {
  const tok = await login('demo@drovox.in', 'demo123');
  const p = get(`SELECT id, stock FROM products WHERE sku = 'DRV-SRV-SG90'`);
  const r = await api('POST', '/api/orders', { items: [{ product_id: p.id, qty: 2 }], payment_method: 'cod', address: addr }, tok);
  assert.equal(r.data.order.status, 'confirmed');
  assert.equal(r.data.order.cod_fee, 40);
  const c = await api('POST', `/api/orders/${r.data.order.order_no}/cancel`, {}, tok);
  assert.equal(c.data.status, 'cancelled');
  assert.equal(get('SELECT stock FROM products WHERE id = ?', p.id).stock, p.stock);
});

test('stock cannot be oversold', async () => {
  const tok = await login('demo@drovox.in', 'demo123');
  const p = get(`SELECT id, stock FROM products WHERE sku = 'DRV-DRN-FC'`);
  const r = await api('POST', '/api/orders', { items: [{ product_id: p.id, qty: p.stock + 1 }], payment_method: 'cod', address: addr }, tok);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Only \d+ units/);
});

test('stockist: create product, import batch with landed cost, receive', async () => {
  const st = await login('stockist@drovox.in', 'stock123');
  const cat = get(`SELECT id FROM categories WHERE slug = 'sensors'`).id;
  const p = await api('POST', '/api/stock/products', { sku: 'drv-test-1', name: 'Test Sensor', category_id: cat, mrp: 200, price: 150, gst_rate: 18, stock: 5, tiers: [{ min_qty: 10, price: 130 }] }, st);
  assert.equal(p.status, 200, JSON.stringify(p.data));
  assert.equal(p.data.sku, 'DRV-TEST-1');
  const b = await api('POST', '/api/stock/batches', { ref: 'PO-T1', supplier_id: 1, currency: 'CNY', fx_rate: 12, freight_inr: 1200, duty_pct: 20, other_inr: 600, items: [{ product_id: p.data.id, qty: 100, unit_cost_foreign: 5 }] }, st);
  const batches = (await api('GET', '/api/stock/batches', null, st)).data;
  const mine = batches.find((x) => x.id === b.data.id);
  // value 6000, freight 1200, duty (7200 × 20%) 1440, other 600 → 9240 / 100
  assert.equal(mine.items[0].landed_unit_cost, 92.4);
  await api('POST', `/api/stock/batches/${b.data.id}/status`, { status: 'received' }, st);
  const now = get('SELECT stock, cost_price FROM products WHERE id = ?', p.data.id);
  assert.equal(now.stock, 105);
  assert.ok(now.cost_price > 87 && now.cost_price < 93);
  // stockist cannot open the master panel
  assert.equal((await api('GET', '/api/admin/dashboard', null, st)).status, 403);
});

test('master panel: dashboard, GST report, CRM, coupons, campaigns, audit, users, settings masking', async () => {
  const ad = await login('admin@drovox.in', 'admin123');
  const d = (await api('GET', '/api/admin/dashboard?days=30', null, ad)).data;
  assert.ok(d.kpis.revenue > 0 && d.daily.length > 0 && d.trending.length > 0);
  const g = (await api('GET', '/api/admin/gst', null, ad)).data;
  assert.ok(g.summary.invoices > 0 && g.hsn.length > 0);
  const lead = await api('POST', '/api/admin/leads', { name: 'Lab Buyer', phone: '9000011111', value_estimate: 50000, source: 'bulk_quote' }, ad);
  assert.ok(lead.data.score > 0);
  await api('PUT', `/api/admin/leads/${lead.data.id}`, { stage: 'qualified' }, ad);
  await api('POST', `/api/admin/leads/${lead.data.id}/activities`, { type: 'whatsapp', content: 'Sharing the quote' }, ad);
  assert.ok((await api('GET', `/api/admin/leads/${lead.data.id}/activities`, null, ad)).data.length >= 2);
  assert.equal((await api('POST', '/api/admin/coupons', { code: 'test20', type: 'percent', value: 20 }, ad)).status, 200);
  const camp = await api('POST', '/api/admin/campaigns', { name: 'T', segment: 'all', message: 'Hi {name}' }, ad);
  const sent = await api('POST', `/api/admin/campaigns/${camp.data.id}/send`, {}, ad);
  assert.ok(sent.data.sent > 0);
  const u = await api('POST', '/api/admin/users', { name: 'New Stockist', email: 'ns@drovox.in', password: 'pass123', role: 'stockist' }, ad);
  assert.equal(u.data.role, 'stockist');
  await api('PUT', '/api/admin/settings/ai', { anthropic_api_key: 'sk-ant-secret-1234' }, ad);
  const s = (await api('GET', '/api/admin/settings', null, ad)).data;
  assert.equal(s.ai.anthropic_api_key, '••••1234');
  await api('PUT', '/api/admin/settings/ai', { anthropic_api_key: '' }, ad);
  const audit = (await api('GET', '/api/admin/audit', null, ad)).data;
  assert.ok(audit.rows.some((r) => r.action === 'user.create'));
  assert.ok(audit.rows.some((r) => r.action === 'settings.update' && r.details.includes('(secret)')));
  const jobs = (await api('POST', '/api/admin/automation/abandoned_carts', {}, ad)).data;
  assert.equal(jobs.ok, true);
});

test('AI project builder falls back to the keyword planner without an API key', async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const r = await api('POST', '/api/ai/build', { idea: 'I want to build 2 line follower robots for a college competition' });
  assert.equal(r.status, 200);
  assert.equal(r.data.engine, 'keyword');
  assert.ok(r.data.items.some((i) => i.sku === 'DRV-MD-L298N'));
  assert.equal(r.data.items.find((i) => i.sku === 'DRV-ARD-UNO').qty, 2);
});
