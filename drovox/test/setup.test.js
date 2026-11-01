// Fresh-install flow: empty database, owner setup, categories + Drovox SKUs, scanning, custom jobs,
// customer personal data + greetings, and the msg.myrc.in WhatsApp gateway (against a local mock).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drovox-setup-'));
process.env.DROVOX_DATA_DIR = dir;
const { createApp } = await import('../server/index.js');
const { get, setSetting, getSetting } = await import('../server/db.js');
const { istToday } = await import('../server/services/greetings.js');

let server; let base; let gateway; const gwCalls = [];
async function api(method, url, body, token) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
}
let admin;

before(async () => {
  await new Promise((ok) => { server = createApp().listen(0, ok); });
  base = `http://127.0.0.1:${server.address().port}`;
  // mock of https://msg.myrc.in/api
  gateway = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      gwCalls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/send-message') return res.end(JSON.stringify({ status: true, message: 'queued', id: 'm1' }));
      if (req.url === '/api/device/status') return res.end(JSON.stringify({ status: true, connected: true }));
      if (req.url === '/api/device/connect') return res.end(JSON.stringify({ status: true, qr: 'data:image/png;base64,AAAA' }));
      res.end(JSON.stringify({ status: true, data: [] }));
    });
  });
  await new Promise((ok) => gateway.listen(0, ok));
});
after(() => { server.close(); gateway.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('starts empty and creates the owner account once', async () => {
  assert.equal(get('SELECT COUNT(*) n FROM products').n, 0);
  assert.equal(get('SELECT COUNT(*) n FROM users').n, 0);
  assert.equal(get('SELECT COUNT(*) n FROM categories').n, 0);
  assert.equal((await api('GET', '/api/setup')).data.needs_setup, true);
  const r = await api('POST', '/api/setup', { store_name: 'Drovox', gstin: '27ABCDE1234F1Z5', name: 'Owner', email: 'owner@drovox.in', password: 'longpassword', address: 'Pune' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  admin = r.data.token;
  assert.equal(r.data.user.role, 'admin');
  assert.equal(getSetting('store').gstin, '27ABCDE1234F1Z5');
  assert.equal((await api('POST', '/api/setup', { name: 'X', email: 'x@y.z', password: 'longpassword' })).status, 403);
  assert.equal((await api('GET', '/api/home')).data.trending.length, 0);
});

test('categories get codes and products get sequential Drovox SKUs', async () => {
  const c = (await api('POST', '/api/stock/categories', { name: 'Sensors & Modules', icon: '📡' }, admin)).data;
  assert.equal(c.code, 'SEN');
  assert.equal((await api('GET', `/api/stock/sku-next?category_id=${c.id}`, null, admin)).data.sku, 'DRV-SEN-0001');
  const p1 = (await api('POST', '/api/stock/products', { name: 'HC-SR04', category_id: c.id, price: 69, mrp: 149, barcode: '8901234567890' }, admin)).data;
  const p2 = (await api('POST', '/api/stock/products', { name: 'DHT22', category_id: c.id, price: 269, mrp: 449 }, admin)).data;
  assert.equal(p1.sku, 'DRV-SEN-0001');
  assert.equal(p2.sku, 'DRV-SEN-0002');
  const dup = await api('POST', '/api/stock/products', { name: 'Other', category_id: c.id, price: 10, mrp: 10, barcode: '8901234567890' }, admin);
  assert.equal(dup.status, 400);
  assert.equal((await api('POST', '/api/stock/categories/starter', {}, admin)).data.added > 5, true);
});

test('scan in / out by SKU, manufacturer barcode and label QR URL', async () => {
  let r = await api('POST', '/api/stock/scan-adjust', { code: 'DRV-SEN-0001', change: 10 }, admin);
  assert.equal(r.data.stock, 10);
  r = await api('POST', '/api/stock/scan-adjust', { code: '8901234567890', change: 5 }, admin);
  assert.equal(r.data.stock, 15);
  r = await api('POST', '/api/stock/scan-adjust', { code: 'http://localhost:3000/#/p/DRV-SEN-0001', change: -3 }, admin);
  assert.equal(r.data.stock, 12);
  assert.equal((await api('POST', '/api/stock/scan-adjust', { code: 'DRV-SEN-0001', change: -50 }, admin)).status, 400);
  assert.equal((await api('GET', '/api/stock/scan/NOPE', null, admin)).status, 404);
  assert.equal((await api('GET', '/api/stock/scan/drv-sen-0002', null, admin)).data.type, 'product');
});

test('custom job: create, ready → WhatsApp through the msg.myrc.in gateway', async () => {
  setSetting('whatsapp', { ...getSetting('whatsapp'), enabled: true, provider: 'myrc', myrc_base_url: `http://127.0.0.1:${gateway.address().port}/api`, myrc_api_key: 'test-key' });
  const j = (await api('POST', '/api/stock/jobs', { customer_name: 'Asha Rao', phone: '9876543210', title: 'Line follower kit, assembled', qty: 2, price: 3000, advance: 1000 }, admin)).data;
  assert.match(j.job_no, /^CJ\d{6}$/);
  const r = await api('POST', `/api/stock/jobs/${j.id}/status`, { status: 'ready' }, admin);
  assert.equal(r.data.job.status, 'ready');
  assert.equal(r.data.whatsapp.ok, true);
  const call = gwCalls.find((c) => c.url === '/api/send-message');
  assert.equal(call.auth, 'Bearer test-key');
  assert.equal(call.body.number, '919876543210');
  assert.match(call.body.message, /READY/);
  assert.match(call.body.message, /Balance payable: ₹2000/);
  assert.equal((await api('GET', `/api/stock/scan/${j.job_no}`, null, admin)).data.type, 'job');
  const st = await api('GET', '/api/admin/whatsapp/gateway/status', null, admin);
  assert.equal(st.data.ok, true);
  assert.equal(st.data.json.connected, true);
});

test('walk-in customer with birthday today gets one greeting', async () => {
  const today = istToday();
  const c = await api('POST', '/api/admin/customers', { name: 'Vikram Shah', phone: '98200 11111', dob: `1995-${today.md}`, city: 'Pune' }, admin);
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.equal(c.data.dob, `1995-${today.md}`);
  assert.equal((await api('POST', '/api/admin/customers', { name: 'Dup', phone: '+91 9820011111' }, admin)).status, 409);
  const g = (await api('GET', '/api/admin/greetings?days=0', null, admin)).data;
  const row = g.rows.find((r) => r.name === 'Vikram Shah');
  assert.equal(row.kind, 'birthday');
  setSetting('greetings', { ...getSetting('greetings'), send_hour: 0 });
  const before = gwCalls.length;
  assert.match((await api('POST', '/api/admin/automation/greetings', {}, admin)).data.result, /1 greetings sent/);
  assert.match(gwCalls.at(-1).body.message, /Happy Birthday Vikram/);
  assert.match((await api('POST', '/api/admin/automation/greetings', {}, admin)).data.result, /0 greetings sent/);
  assert.equal(gwCalls.length, before + 1);
});
