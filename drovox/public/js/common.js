// Shared browser helpers for the storefront and both panels.
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
export { store as local };

export function sessionId() {
  let s = store.get('drv_sid');
  if (!s) { s = Math.random().toString(36).slice(2) + Date.now().toString(36); store.set('drv_sid', s); }
  return s;
}

export function tokenKey(scope) { return `drv_token_${scope}`; }
let SCOPE = 'store';
export function setScope(s) { SCOPE = s; }
export const getToken = () => store.get(tokenKey(SCOPE));
export const setToken = (t) => (t ? store.set(tokenKey(SCOPE), t) : store.del(tokenKey(SCOPE)));

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'X-Session': sessionId() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const t = getToken(); if (t) headers.Authorization = `Bearer ${t}`;
  const r = await fetch('/api' + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let data = null; try { data = await r.json(); } catch { /* empty */ }
  if (!r.ok) {
    const err = new Error(data?.error || `Request failed (${r.status})`); err.status = r.status;
    if (r.status === 401 && t) setToken(null);
    throw err;
  }
  return data;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (n, dp = 0) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const num = (n) => Number(n || 0).toLocaleString('en-IN');
export function dt(s, withTime = true) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T') + (String(s).includes('Z') || String(s).length <= 10 ? '' : 'Z'));
  return d.toLocaleString('en-IN', withTime ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' });
}
export function ago(s) {
  const d = new Date(String(s).replace(' ', 'T') + 'Z'); const m = Math.round((Date.now() - d) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`; const h = Math.round(m / 60); if (h < 24) return `${h}h ago`; return `${Math.round(h / 24)}d ago`;
}

export function toast(msg, kind = 'ok', ms = 3200) {
  let host = $('#toasts'); if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.append(host); }
  const el = document.createElement('div'); el.className = `toast ${kind}`; el.innerHTML = msg; host.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

/** Opens a modal; returns { el, close }. */
export function modal(html, { wide = false, onClose } = {}) {
  const wrap = document.createElement('div'); wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true"><button class="modal-x" aria-label="Close">×</button>${html}</div>`;
  const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.classList.contains('modal-x')) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(wrap);
  return { el: wrap.querySelector('.modal'), close };
}

/** Product artwork: category emoji on a tinted tile (works without product photos). */
export function art(p, size = '') {
  const hue = ((p.category_id || 1) * 47) % 360;
  return `<div class="art ${size}" style="--h:${hue}"><span>${esc(p.image || '📦')}</span></div>`;
}

export function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'number') o[el.name] = el.value === '' ? null : Number(el.value);
    else o[el.name] = el.value;
  }
  return o;
}

export const STATUS_COLORS = { pending_payment: 'amber', confirmed: 'blue', packed: 'violet', shipped: 'teal', out_for_delivery: 'teal', delivered: 'green', cancelled: 'red', returned: 'red' };
export const badge = (status, label) => `<span class="badge ${STATUS_COLORS[status] || ''}">${esc(label || status)}</span>`;

/** Simple SVG bar/line chart; values: [{label, value}] */
export function barChart(values, { height = 160, color = 'var(--brand)', fmt = num } = {}) {
  if (!values.length) return '<div class="muted small">No data yet</div>';
  const max = Math.max(...values.map((v) => v.value), 1); const w = 100 / values.length;
  const bars = values.map((v, i) => {
    const h = (v.value / max) * (height - 22);
    return `<g><title>${esc(v.label)}: ${esc(fmt(v.value))}</title><rect x="${i * w + w * 0.15}%" y="${height - 18 - h}" width="${w * 0.7}%" height="${h}" rx="3" fill="${color}"/></g>`;
  }).join('');
  const step = Math.ceil(values.length / 8);
  const labels = values.map((v, i) => (i % step === 0 ? `<text x="${i === 0 ? 0 : i * w + w / 2}%" y="${height - 4}" text-anchor="${i === 0 ? 'start' : 'middle'}">${esc(v.label)}</text>` : '')).join('');
  return `<svg class="chart" width="100%" height="${height}" role="img">${bars}${labels}</svg>`;
}

/** Horizontal bars for rankings. */
export function rankBars(rows, { fmt = num } = {}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return `<div class="rank">${rows.map((r) => `<div class="rank-row"><div class="rank-label" title="${esc(r.label)}">${esc(r.label)}</div><div class="rank-bar"><i style="width:${(r.value / max) * 100}%"></i></div><div class="rank-val">${esc(fmt(r.value))}</div></div>`).join('')}</div>`;
}

export function downloadCsv(filename, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Printable GST tax invoice in a new window. */
export function printInvoice(inv) {
  const o = inv.order; const s = inv.seller; const intra = inv.intra_state;
  const rows = inv.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}<br><small>${esc(l.sku)}</small></td><td>${esc(l.hsn)}</td><td class="r">${l.qty}</td><td class="r">${l.unit_price.toFixed(2)}</td>
    <td class="r">${l.taxable.toFixed(2)}</td><td class="r">${l.gst_rate}%</td>${intra ? `<td class="r">${l.cgst.toFixed(2)}</td><td class="r">${l.sgst.toFixed(2)}</td>` : `<td class="r">${l.igst.toFixed(2)}</td>`}<td class="r">${l.total.toFixed(2)}</td></tr>`).join('');
  const ch = inv.charges ? `<tr><td></td><td>${esc(inv.charges.label)}</td><td>996812</td><td class="r">1</td><td class="r">${inv.charges.total.toFixed(2)}</td><td class="r">${inv.charges.taxable.toFixed(2)}</td><td class="r">18%</td>${intra ? `<td class="r">${(inv.charges.tax / 2).toFixed(2)}</td><td class="r">${(inv.charges.tax / 2).toFixed(2)}</td>` : `<td class="r">${inv.charges.tax.toFixed(2)}</td>`}<td class="r">${inv.charges.total.toFixed(2)}</td></tr>` : '';
  const w = window.open('', '_blank');
  if (!w) { toast('Allow pop-ups to view the invoice', 'err'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(o.invoice_no)}</title><style>
    body{font:13px/1.45 system-ui,sans-serif;color:#111;margin:32px;background:#fff} h1{font-size:20px;margin:0} table{width:100%;border-collapse:collapse;margin-top:16px}
    th,td{border:1px solid #ccc;padding:6px;text-align:left;vertical-align:top} th{background:#f3f4f6} .r{text-align:right} .grid{display:flex;justify-content:space-between;gap:24px;margin-top:16px}
    .tot td{font-weight:600} small{color:#555} @media print{button{display:none}}</style></head><body>
    <div class="grid"><div><h1>${esc(s.legal_name)}</h1><div>${esc(s.address)}</div><div>GSTIN: <b>${esc(s.gstin)}</b></div></div>
    <div style="text-align:right"><h1>TAX INVOICE</h1><div>Invoice: <b>${esc(o.invoice_no)}</b></div><div>Date: ${esc(dt(o.created_at, false))}</div><div>Order: ${esc(o.order_no)}</div></div></div>
    <div class="grid"><div><b>Bill / Ship to</b><br>${esc(o.ship_name)}<br>${esc(o.ship_address)}<br>${esc(o.ship_phone)}${o.gstin ? `<br>GSTIN: <b>${esc(o.gstin)}</b>` : ''}</div>
    <div style="text-align:right">Place of supply: <b>${esc(o.place_of_supply)}</b><br>Payment: ${esc(o.payment_method.toUpperCase())} (${esc(o.payment_status)})</div></div>
    <table><thead><tr><th>#</th><th>Item</th><th>HSN</th><th class="r">Qty</th><th class="r">Rate (incl.)</th><th class="r">Taxable</th><th class="r">GST</th>${intra ? '<th class="r">CGST</th><th class="r">SGST</th>' : '<th class="r">IGST</th>'}<th class="r">Amount</th></tr></thead>
    <tbody>${rows}${ch}
    <tr class="tot"><td colspan="5" class="r">Totals</td><td class="r">${o.taxable.toFixed(2)}</td><td></td>${intra ? `<td class="r">${o.cgst.toFixed(2)}</td><td class="r">${o.sgst.toFixed(2)}</td>` : `<td class="r">${o.igst.toFixed(2)}</td>`}<td class="r">${o.total.toFixed(2)}</td></tr></tbody></table>
    <p>${o.discount ? `Coupon ${esc(o.coupon_code)}: −₹${o.discount.toFixed(2)} · ` : ''}${o.points_redeemed ? `Points redeemed: ${o.points_redeemed} · ` : ''}Amount payable: <b>₹${o.total.toFixed(2)}</b> (inclusive of GST)</p>
    <p><small>Line amounts are net of discounts allocated pro-rata. This is a computer-generated invoice and does not require a signature.</small></p>
    <button onclick="print()">Print / Save as PDF</button></body></html>`);
  w.document.close();
}
