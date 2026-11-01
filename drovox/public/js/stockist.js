// Drovox stockist panel: fulfilment queue, products & stock, China import batches with landed cost, reorder planning.
import { $, $$, api, esc, money, num, toast, modal, badge, ago, art, formData, downloadCsv } from './common.js';
import { startPanel, head, kpi } from './panel.js';
import { openOrder } from './orders-ui.js';

let CATS = []; let SUPPLIERS = [];
const B = '/stock';

async function refs() {
  if (!CATS.length) [CATS, SUPPLIERS] = await Promise.all([api('/categories'), api(`${B}/suppliers`)]);
}

const STOCK_BADGE = { out: ['red', 'Out of stock'], critical: ['red', 'Critical'], low: ['amber', 'Low'], ok: ['green', 'Healthy'] };

async function dashboard(el) {
  const d = await api(`${B}/dashboard`);
  el.innerHTML = `${head('Warehouse overview', '<a class="btn" href="#/orders?status=confirmed">Start packing →</a><button class="btn" id="pick">📋 Pick list</button>')}
    <div class="grid g4">${kpi('To pack', d.to_pack, 'confirmed orders')}${kpi('To ship', d.to_ship, 'packed, awaiting courier')}${kpi('In transit', d.in_transit)}${kpi("Today's orders", d.today_orders)}</div>
    <div class="grid g4" style="margin-top:16px">${kpi('Low / critical SKUs', d.low_stock, `${d.out_of_stock} out of stock`)}${kpi('Stock value (cost)', money(d.stock_value))}${kpi('Incoming import batches', d.incoming_batches)}<div class="card kpi"><div class="l">Quick actions</div><div class="row" style="margin-top:8px"><a class="btn sm primary" href="#/products?new=1">+ Product</a><a class="btn sm" href="#/imports?new=1">+ Import batch</a></div></div></div>
    <div class="grid g2" style="margin-top:16px;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)">
      <div class="card"><div class="row between"><h3>Latest orders</h3><a class="link small" href="#/orders">All orders →</a></div><div class="table-wrap"><table class="t"><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th></tr></thead><tbody>
        ${d.latest_orders.map((o) => `<tr class="click" data-o="${o.id}"><td><b>${esc(o.order_no)}</b><div class="tiny muted">${ago(o.created_at)}</div></td><td>${esc(o.ship_name)}</td><td class="small">${esc((o.summary || '').slice(0, 60))}</td><td>${money(o.total)}${o.payment_method === 'cod' ? ' <span class="badge amber">COD</span>' : ''}</td><td>${badge(o.status, o.status_label)}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="card"><div class="row between"><h3>⚠️ Stock alerts</h3><a class="link small" href="#/reorder">Reorder plan →</a></div>
        ${d.alerts.map((a) => `<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line)"><div><b class="small">${esc(a.name)}</b><div class="tiny muted">${esc(a.sku)} · ${a.stock} left${a.days_of_cover != null ? ` · ~${a.days_of_cover} days cover` : ''}${a.incoming ? ` · ${a.incoming} incoming` : ''}</div></div><span class="badge ${STOCK_BADGE[a.status][0]}">${STOCK_BADGE[a.status][1]}</span></div>`).join('') || '<p class="muted">All stock levels healthy 🎉</p>'}</div>
    </div>`;
  $$('[data-o]', el).forEach((r) => { r.onclick = () => openOrder(B, r.dataset.o, () => dashboard(el)); });
  $('#pick').onclick = pickList;
}

async function pickList() {
  const rows = await api(`${B}/picklist`);
  modal(`<h2>Pick list — confirmed orders</h2><p class="muted small">Total quantity to pull from the shelves for every order waiting to be packed.</p><div class="table-wrap"><table class="t"><thead><tr><th>SKU</th><th>Item</th><th class="r">Qty</th><th class="r">Orders</th><th class="r">On hand</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td class="code">${esc(r.sku)}</td><td>${esc(r.name)}</td><td class="r"><b>${r.qty}</b></td><td class="r">${r.orders}</td><td class="r">${r.stock}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nothing to pick</td></tr>'}</tbody></table></div><button class="btn" style="margin-top:12px" onclick="print()">Print</button>`, { wide: true });
}

async function orders(el, params) {
  const status = params.get('status') || ''; const q = params.get('q') || '';
  const rows = await api(`${B}/orders?status=${status}&q=${encodeURIComponent(q)}`);
  const tabs = [['', 'All'], ['confirmed', 'To pack'], ['packed', 'To ship'], ['shipped', 'Shipped'], ['out_for_delivery', 'Out for delivery'], ['delivered', 'Delivered'], ['pending_payment', 'Awaiting payment'], ['cancelled', 'Cancelled']];
  const bulk = { confirmed: ['packed', 'Mark selected packed'], packed: ['shipped', 'Ship selected'], shipped: ['delivered', 'Mark selected delivered'], out_for_delivery: ['delivered', 'Mark selected delivered'] }[status];
  el.innerHTML = `${head('Orders', `<form id="of" class="row"><input name="q" placeholder="Order no, name, phone" value="${esc(q)}" style="width:220px"><button class="btn">Search</button></form>`)}
    <div class="tabs">${tabs.map(([s, l]) => `<a href="#/orders?status=${s}" class="${s === status ? 'on' : ''}">${l}</a>`).join('')}</div>
    ${bulk ? `<div class="row" style="margin-bottom:10px"><label class="check"><input type="checkbox" id="all"> Select all</label>${status === 'packed' ? '<select id="courier" style="width:160px"><option>Delhivery</option><option>Blue Dart</option><option>DTDC</option><option>Ekart</option><option>XpressBees</option></select>' : ''}<button class="btn primary sm" id="bulk">${bulk[1]}</button></div>` : ''}
    <div class="card table-wrap"><table class="t"><thead><tr>${bulk ? '<th></th>' : ''}<th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th></tr></thead><tbody>
    ${rows.map((o) => `<tr class="click" data-o="${o.id}">${bulk ? `<td><input type="checkbox" data-sel="${o.id}"></td>` : ''}<td><b>${esc(o.order_no)}</b><div class="tiny muted">${ago(o.created_at)}</div></td><td>${esc(o.ship_name)}<div class="tiny muted">${esc((o.ship_address || '').split(', ').slice(-2).join(', '))}</div></td>
      <td class="small">${esc((o.summary || '').slice(0, 70))}</td><td>${money(o.total)}</td><td>${o.payment_method === 'cod' ? `<span class="badge amber">COD${o.payment_status === 'paid' ? ' ✓' : ''}</span>` : `<span class="badge ${o.payment_status === 'paid' ? 'green' : ''}">${esc(o.payment_status)}</span>`}</td><td>${badge(o.status, o.status_label)}${o.awb ? `<div class="tiny muted">${esc(o.courier)} ${esc(o.awb)}</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No orders here</td></tr>'}</tbody></table></div>`;
  $('#of').onsubmit = (e) => { e.preventDefault(); location.hash = `#/orders?status=${status}&q=${encodeURIComponent(formData(e.target).q)}`; };
  $$('[data-o]', el).forEach((r) => { r.onclick = (e) => { if (e.target.matches('input')) return; openOrder(B, r.dataset.o, () => orders(el, params)); }; });
  $('#all')?.addEventListener('change', (e) => $$('[data-sel]').forEach((c) => { c.checked = e.target.checked; }));
  $('#bulk')?.addEventListener('click', async () => {
    const ids = $$('[data-sel]').filter((c) => c.checked).map((c) => c.dataset.sel);
    if (!ids.length) return toast('Select at least one order', 'err');
    const r = await api(`${B}/orders/bulk-status`, { method: 'POST', body: { ids, to: bulk[0], courier: $('#courier')?.value } });
    toast(`${r.done.length} orders updated${r.failed.length ? `, ${r.failed.length} failed` : ''} · customers notified on WhatsApp`); orders(el, params);
  });
}

function productForm(p = {}) {
  const tiers = p.tiers ? (typeof p.tiers === 'string' ? JSON.parse(p.tiers) : p.tiers) : [];
  const specs = p.specs ? (typeof p.specs === 'string' ? JSON.parse(p.specs) : p.specs) : {};
  return `<form class="form two" id="pf">
    <label class="f">SKU<input name="sku" required value="${esc(p.sku || 'DRV-')}"></label><label class="f">Icon (emoji)<input name="image" value="${esc(p.image || '📦')}" maxlength="4"></label>
    <label class="f full">Product name<input name="name" required value="${esc(p.name || '')}"></label>
    <label class="f">Category<select name="category_id">${CATS.map((c) => `<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('')}</select></label>
    <label class="f">Supplier<select name="supplier_id"><option value="">—</option>${SUPPLIERS.map((s) => `<option value="${s.id}" ${s.id === p.supplier_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    <label class="f">Brand<input name="brand" value="${esc(p.brand || '')}"></label><label class="f">HSN code<input name="hsn" value="${esc(p.hsn || '8542')}"></label>
    <label class="f">Selling price (₹, incl. GST)<input name="price" type="number" step="0.01" required value="${p.price ?? ''}"></label><label class="f">MRP (₹)<input name="mrp" type="number" step="0.01" required value="${p.mrp ?? ''}"></label>
    <label class="f">Landed cost (₹, ex-GST)<input name="cost_price" type="number" step="0.01" value="${p.cost_price ?? ''}"></label><label class="f">GST rate<select name="gst_rate">${[0, 5, 12, 18, 28].map((r) => `<option ${Number(p.gst_rate ?? 18) === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
    <label class="f">Reorder level<input name="reorder_level" type="number" value="${p.reorder_level ?? 10}"></label>${p.id ? '<div></div>' : '<label class="f">Opening stock<input name="stock" type="number" value="0"></label>'}
    <label class="f full">Search tags (comma separated)<input name="tags" value="${esc(p.tags || '')}" placeholder="arduino,robot,beginner"></label>
    <div class="full"><div class="f">Bulk price tiers</div><div id="tiers" class="stack" style="margin-top:6px">${[...tiers, {}, {}].slice(0, Math.max(3, tiers.length + 1)).map((t) => `<div class="row" style="flex-wrap:nowrap"><input type="number" placeholder="Min qty" data-tq value="${t.min_qty ?? ''}"><input type="number" step="0.01" placeholder="Unit price ₹" data-tp value="${t.price ?? ''}"></div>`).join('')}</div></div>
    <label class="f full">Specifications (one per line, “Key: Value”)<textarea name="specs" rows="4">${esc(Object.entries(specs).map(([k, v]) => `${k}: ${v}`).join('\n'))}</textarea></label>
    <label class="f full">Description<textarea name="description" rows="3">${esc(p.description || '')}</textarea></label>
    <div id="margin" class="full small muted"></div>
    <label class="check"><input type="checkbox" name="active" ${p.active === 0 ? '' : 'checked'}> Visible in store</label>
    <div class="full row"><button class="btn primary">${p.id ? 'Save changes' : 'Create product'}</button></div></form>`;
}
function readProductForm(form) {
  const f = formData(form);
  f.specs = Object.fromEntries(f.specs.split('\n').map((l) => l.split(':')).filter((x) => x.length >= 2 && x[0].trim()).map(([k, ...v]) => [k.trim(), v.join(':').trim()]));
  f.tiers = $$('[data-tq]', form).map((q, i) => ({ min_qty: Number(q.value), price: Number($$('[data-tp]', form)[i].value) })).filter((t) => t.min_qty > 1 && t.price > 0);
  return f;
}
function wireMargin(form) {
  const upd = () => {
    const f = formData(form); const net = f.price / (1 + Number(f.gst_rate) / 100);
    $('#margin', form).textContent = f.price && f.cost_price ? `Margin: ${money(net - f.cost_price, 2)} per unit (${Math.round((1 - f.cost_price / net) * 100)}% on net price ${money(net, 2)}) · ${f.mrp ? `${Math.round((1 - f.price / f.mrp) * 100)}% off MRP` : ''}` : '';
  };
  form.addEventListener('input', upd); upd();
}

async function products(el, params) {
  await refs();
  const q = params.get('q') || '';
  const rows = await api(`${B}/products?q=${encodeURIComponent(q)}`);
  el.innerHTML = `${head('Products & stock', `<form id="sf" class="row"><input name="q" placeholder="Search name, SKU, tag" value="${esc(q)}" style="width:220px"><button class="btn">Search</button></form><button class="btn" id="csv">⬇ CSV</button><button class="btn primary" id="new">+ Add product</button>`)}
    <div class="card table-wrap"><table class="t"><thead><tr><th></th><th>Product</th><th>Category</th><th class="r">Price</th><th class="r">Cost</th><th class="r">Margin</th><th class="r">Stock</th><th></th></tr></thead><tbody>
    ${rows.map((p) => { const net = p.price / (1 + p.gst_rate / 100); const mg = p.cost_price ? Math.round((1 - p.cost_price / net) * 100) : null; return `<tr>
      <td>${art(p, 'xs')}</td><td><b>${esc(p.name)}</b><div class="tiny muted"><span class="code">${esc(p.sku)}</span> ${p.active ? '' : '<span class="badge">hidden</span>'} ${esc(p.supplier || '')}</div></td><td class="small">${esc(p.category || '')}</td>
      <td class="r">${money(p.price)}<div class="tiny muted">MRP ${money(p.mrp)}</div></td><td class="r">${money(p.cost_price, 2)}</td><td class="r">${mg == null ? '—' : `<span class="badge ${mg >= 40 ? 'green' : mg >= 20 ? 'amber' : 'red'}">${mg}%</span>`}</td>
      <td class="r"><b style="color:${p.stock <= 0 ? 'var(--red)' : p.stock <= p.reorder_level ? 'var(--amber)' : 'inherit'}">${num(p.stock)}</b><div class="tiny muted">reorder at ${p.reorder_level}</div></td>
      <td class="nowrap"><button class="btn sm" data-adj="${p.id}">± Stock</button> <button class="btn sm" data-edit="${p.id}">Edit</button> <button class="btn sm ghost" data-hist="${p.id}">History</button></td></tr>`; }).join('')}</tbody></table></div>`;
  const byId = (id) => rows.find((p) => p.id === Number(id));
  const edit = (p) => {
    const m = modal(`<h2>${p ? 'Edit product' : 'New product'}</h2>${productForm(p || {})}`, { wide: true });
    const form = $('#pf', m.el); wireMargin(form);
    form.onsubmit = async (e) => {
      e.preventDefault();
      try { await api(p ? `${B}/products/${p.id}` : `${B}/products`, { method: p ? 'PUT' : 'POST', body: readProductForm(form) }); toast(p ? 'Product saved' : 'Product created'); m.close(); products(el, params); } catch (err) { toast(err.message, 'err'); }
    };
  };
  $('#new').onclick = () => edit(null);
  if (params.get('new')) edit(null);
  $('#sf').onsubmit = (e) => { e.preventDefault(); location.hash = `#/products?q=${encodeURIComponent(formData(e.target).q)}`; };
  $('#csv').onclick = () => downloadCsv('drovox-products.csv', rows.map((p) => ({ sku: p.sku, name: p.name, category: p.category, price: p.price, mrp: p.mrp, cost: p.cost_price, gst: p.gst_rate, hsn: p.hsn, stock: p.stock, reorder_level: p.reorder_level })));
  $$('[data-edit]', el).forEach((b) => { b.onclick = () => edit(byId(b.dataset.edit)); });
  $$('[data-adj]', el).forEach((b) => { b.onclick = () => {
    const p = byId(b.dataset.adj);
    const m = modal(`<h2>Adjust stock</h2><p>${esc(p.name)} — currently <b>${p.stock}</b></p><form class="form two"><label class="f">Change (+ add / − remove)<input name="change" type="number" required></label>
      <label class="f">Reason<select name="reason"><option>Physical count correction</option><option>Damaged / defective</option><option>Customer return restock</option><option>Local purchase</option><option>Sample / internal use</option></select></label><button class="btn primary full">Apply</button></form>`);
    $('form', m.el).onsubmit = async (e) => { e.preventDefault(); try { const r = await api(`${B}/products/${p.id}/adjust`, { method: 'POST', body: formData(e.target) }); toast(`Stock now ${r.stock}`); m.close(); products(el, params); } catch (err) { toast(err.message, 'err'); } };
  }; });
  $$('[data-hist]', el).forEach((b) => { b.onclick = async () => {
    const p = byId(b.dataset.hist); const h = await api(`${B}/products/${p.id}/movements`);
    modal(`<h2>Stock history</h2><p class="muted">${esc(p.name)}</p><div class="table-wrap"><table class="t"><thead><tr><th>When</th><th>Change</th><th>Balance</th><th>Reason</th><th>Ref</th><th>By</th></tr></thead><tbody>
      ${h.map((x) => `<tr><td class="small">${ago(x.created_at)}</td><td style="color:${x.change > 0 ? 'var(--green)' : 'var(--red)'}">${x.change > 0 ? '+' : ''}${x.change}</td><td>${x.balance}</td><td>${esc(x.reason)}</td><td class="small">${esc(x.ref || '')}</td><td class="small">${esc(x.user || '')}</td></tr>`).join('')}</tbody></table></div>`, { wide: true });
  }; });
}

async function imports(el, params) {
  await refs();
  const batches = await api(`${B}/batches`);
  const prods = await api(`${B}/products`);
  const STATUS = { ordered: 'blue', in_transit: 'violet', customs: 'amber', received: 'green' };
  el.innerHTML = `${head('China import batches', '<button class="btn primary" id="new">+ New import batch</button>')}
    <p class="muted small">Record each shipment from your suppliers. Landed cost = goods (at FX rate) + freight + customs duty on CIF value + clearing charges, allocated by value. Receiving a batch adds the stock and updates each product's weighted-average cost.</p>
    ${batches.map((b) => `<div class="card" style="margin-bottom:14px"><div class="row between"><div><h3 style="margin:0">${esc(b.ref)} <span class="badge ${STATUS[b.status]}">${esc(b.status.replace('_', ' '))}</span></h3>
      <div class="small muted">${esc(b.supplier || 'No supplier')} · ${esc(b.currency)} @ ₹${b.fx_rate} · freight ${money(b.freight_inr)} · duty ${b.duty_pct}% · other ${money(b.other_inr)} · ${ago(b.created_at)}${b.notes ? ` · ${esc(b.notes)}` : ''}</div></div>
      <div class="row"><b>Landed ${money(b.total_landed)}</b>${b.status !== 'received' ? `<select data-st="${b.id}" style="width:auto">${['ordered', 'in_transit', 'customs', 'received'].map((s) => `<option value="${s}" ${s === b.status ? 'selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}</select>` : `<span class="small muted">received ${ago(b.received_at)}</span>`}</div></div>
      <div class="table-wrap"><table class="t" style="margin-top:10px"><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Unit (${esc(b.currency)})</th><th class="r">Value ₹</th><th class="r">Freight</th><th class="r">Duty</th><th class="r">Other</th><th class="r">Landed / unit</th><th class="r">Sell price</th><th class="r">Margin</th></tr></thead><tbody>
      ${b.items.map((i) => `<tr><td>${esc(i.name)}<div class="tiny code">${esc(i.sku)}</div></td><td class="r">${i.qty}</td><td class="r">${i.unit_cost_foreign}</td><td class="r">${money(i.value_inr)}</td><td class="r">${money(i.freight)}</td><td class="r">${money(i.duty)}</td><td class="r">${money(i.other)}</td><td class="r"><b>${money(i.landed_unit_cost, 2)}</b></td><td class="r">${money(i.price)}</td><td class="r"><span class="badge ${i.margin_pct >= 40 ? 'green' : i.margin_pct >= 20 ? 'amber' : 'red'}">${i.margin_pct}%</span></td></tr>`).join('')}</tbody></table></div></div>`).join('') || '<div class="empty card">No import batches yet</div>'}`;
  $$('[data-st]', el).forEach((s) => { s.onchange = async () => {
    if (s.value === 'received' && !confirm('Receive this batch into stock? This adds the quantities and updates product costs.')) { s.value = batches.find((b) => b.id == s.dataset.st).status; return; }
    try { await api(`${B}/batches/${s.dataset.st}/status`, { method: 'POST', body: { status: s.value } }); toast(s.value === 'received' ? 'Batch received — stock and costs updated, back-in-stock alerts sent' : 'Status updated'); imports(el, params); } catch (e) { toast(e.message, 'err'); }
  }; });
  const open = (prefill = []) => {
    const row = (it = {}) => `<div class="row" style="flex-wrap:nowrap" data-row><select data-p style="flex:3">${prods.map((p) => `<option value="${p.id}" ${p.id === it.product_id ? 'selected' : ''}>${esc(p.sku)} — ${esc(p.name.slice(0, 40))}</option>`).join('')}</select><input type="number" placeholder="Qty" data-q style="flex:1" value="${it.qty ?? ''}"><input type="number" step="0.01" placeholder="Unit cost" data-c style="flex:1"></div>`;
    const m = modal(`<h2>New import batch</h2><form class="form two" id="bf">
      <label class="f">PO / reference<input name="ref" required value="PO-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}"></label>
      <label class="f">Supplier<select name="supplier_id">${SUPPLIERS.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
      <label class="f">Currency<select name="currency"><option>CNY</option><option>USD</option></select></label><label class="f">FX rate (₹ per unit)<input name="fx_rate" type="number" step="0.01" value="11.8"></label>
      <label class="f">Freight (₹)<input name="freight_inr" type="number" value="0"></label><label class="f">Customs duty % (BCD + SWS)<input name="duty_pct" type="number" step="0.1" value="22"></label>
      <label class="f">Other charges (₹) — CHA, port, transport<input name="other_inr" type="number" value="0"></label><label class="f">Status<select name="status"><option value="ordered">ordered</option><option value="in_transit">in transit</option><option value="customs">at customs</option></select></label>
      <div class="full"><div class="f">Items</div><div id="rows" class="stack" style="margin-top:6px">${(prefill.length ? prefill : [{}]).map(row).join('')}</div><button type="button" class="btn sm" id="addrow" style="margin-top:8px">+ Add item</button></div>
      <label class="f full">Notes<input name="notes" placeholder="Air cargo, sea freight, tracking…"></label><div id="est" class="full small"></div><button class="btn primary full">Create batch</button></form>`, { wide: true });
    const form = $('#bf', m.el);
    const read = () => $$('[data-row]', form).map((r) => ({ product_id: Number($('[data-p]', r).value), qty: Number($('[data-q]', r).value), unit_cost_foreign: Number($('[data-c]', r).value) })).filter((i) => i.qty > 0);
    const est = () => { const f = formData(form); const items = read(); const v = items.reduce((s, i) => s + i.qty * i.unit_cost_foreign * f.fx_rate, 0); const total = v + f.freight_inr + (v + f.freight_inr) * f.duty_pct / 100 + f.other_inr; $('#est', form).innerHTML = v ? `Estimated landed total <b>${money(total)}</b> (goods ${money(v)})` : ''; };
    form.addEventListener('input', est);
    $('#addrow', m.el).onclick = () => { $('#rows', m.el).insertAdjacentHTML('beforeend', row()); };
    form.onsubmit = async (e) => { e.preventDefault(); try { await api(`${B}/batches`, { method: 'POST', body: { ...formData(form), items: read() } }); toast('Import batch created'); m.close(); imports(el, new URLSearchParams()); } catch (err) { toast(err.message, 'err'); } };
  };
  $('#new').onclick = () => open();
  if (params.get('new')) open(JSON.parse(sessionStorage.getItem('drv_prefill') || '[]'));
  sessionStorage.removeItem('drv_prefill');
}

async function reorder(el) {
  const rows = await api(`${B}/forecast`);
  const need = rows.filter((r) => r.suggested_reorder_qty > 0);
  el.innerHTML = `${head('Reorder planning', `<button class="btn primary" id="po" ${need.length ? '' : 'disabled'}>Create import batch from ${need.length} suggestions</button>`)}
    <p class="muted small">Daily demand = 60% × last-7-day rate + 40% × last-30-day rate. Days of cover = stock ÷ daily demand. A reorder is suggested when cover drops below supplier lead time + safety days; the quantity covers lead time + 45 days, net of stock already incoming.</p>
    <div class="card table-wrap"><table class="t"><thead><tr><th>Product</th><th>Supplier</th><th class="r">Stock</th><th class="r">Incoming</th><th class="r">Sold 7d / 30d</th><th class="r">Demand/day</th><th class="r">Days cover</th><th class="r">Lead time</th><th>Status</th><th class="r">Reorder qty</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td><b class="small">${esc(r.name)}</b><div class="tiny code">${esc(r.sku)}</div></td><td class="small">${esc(r.supplier || '')}</td><td class="r">${r.stock}</td><td class="r">${r.incoming || ''}</td><td class="r">${r.sold_7d} / ${r.sold_30d}</td><td class="r">${r.velocity_per_day}</td><td class="r">${r.days_of_cover ?? '∞'}</td><td class="r">${r.lead_time_days}d</td>
      <td><span class="badge ${STOCK_BADGE[r.status][0]}">${STOCK_BADGE[r.status][1]}</span></td><td class="r"><b>${r.suggested_reorder_qty || ''}</b></td></tr>`).join('')}</tbody></table></div>`;
  $('#po').onclick = () => { sessionStorage.setItem('drv_prefill', JSON.stringify(need.map((r) => ({ product_id: r.id, qty: r.suggested_reorder_qty })))); location.hash = '#/imports?new=1'; };
}

async function suppliers(el) {
  const rows = await api(`${B}/suppliers`); SUPPLIERS = rows;
  el.innerHTML = `${head('Suppliers', '<button class="btn primary" id="new">+ Add supplier</button>')}<div class="grid g3">${rows.map((s) => `<div class="card"><h3>${esc(s.name)}</h3><div class="small muted">${esc(s.city || '')}, ${esc(s.country)} · lead time ${s.lead_time_days} days · ${s.products} products</div>
    <div class="small" style="margin-top:8px">${s.contact ? `👤 ${esc(s.contact)}<br>` : ''}${s.email ? `✉️ ${esc(s.email)}<br>` : ''}${s.wechat ? `💬 WeChat ${esc(s.wechat)}` : ''}</div>${s.notes ? `<p class="small">${esc(s.notes)}</p>` : ''}</div>`).join('')}</div>`;
  $('#new').onclick = () => {
    const m = modal(`<h2>New supplier</h2><form class="form two"><label class="f full">Company name<input name="name" required></label><label class="f">City<input name="city" value="Shenzhen"></label><label class="f">Country<input name="country" value="China"></label>
      <label class="f">Contact person<input name="contact"></label><label class="f">Email<input name="email" type="email"></label><label class="f">WeChat ID<input name="wechat"></label><label class="f">Lead time (days)<input name="lead_time_days" type="number" value="21"></label>
      <label class="f full">Notes<textarea name="notes" rows="2"></textarea></label><button class="btn primary full">Save supplier</button></form>`);
    $('form', m.el).onsubmit = async (e) => { e.preventDefault(); try { await api(`${B}/suppliers`, { method: 'POST', body: formData(e.target) }); toast('Supplier added'); m.close(); suppliers(el); } catch (err) { toast(err.message, 'err'); } };
  };
}

startPanel({
  scope: 'stockist', title: 'Stockist Panel', roles: ['stockist'],
  demo: 'Demo stockist: stockist@drovox.in / stock123',
  switchLink: { href: '/master', label: '🛡️ Master panel' },
  nav: [
    { id: 'dashboard', label: 'Overview', icon: '📊' }, { id: 'orders', label: 'Orders & dispatch', icon: '📦' },
    { id: 'products', label: 'Products & stock', icon: '🗃️' }, { id: 'imports', label: 'Import batches', icon: '🚢' },
    { id: 'reorder', label: 'Reorder planning', icon: '📈' }, { id: 'suppliers', label: 'Suppliers', icon: '🏭' },
  ],
  pages: { dashboard, orders, products, imports, reorder, suppliers },
});
