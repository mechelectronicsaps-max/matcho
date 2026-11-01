// Drovox stockist panel: fulfilment queue, products & stock, China import batches with landed cost, reorder planning.
import { $, $$, api, esc, money, num, toast, modal, badge, ago, art, formData, downloadCsv, downloadAuthed, dt, getToken, imgUrl, photoVariants } from './common.js';
import { startPanel, head, kpi } from './panel.js';
import { openOrder } from './orders-ui.js';
import { mountModel3d } from './model3d.js';
import { LABEL_SIZES, printProductLabels, printBoxLabels, printJobLabel } from './labels.js';
import { scanWithCamera } from './scanner.js';

let CATS = []; let SUPPLIERS = []; let STORE = null;
const B = '/stock';

/** Drops ?new=1 from the URL so re-rendering a page doesn't reopen the "new" form. */
function clearNew(params) {
  if (!params.has('new')) return;
  params.delete('new');
  history.replaceState(null, '', `${location.pathname}${location.hash.split('?')[0]}${params.toString() ? `?${params}` : ''}`);
}

async function refs(force = false) {
  if (force || !STORE) [CATS, SUPPLIERS, STORE] = await Promise.all([api(`${B}/categories`), api(`${B}/suppliers`), api(`${B}/store-info`)]);
}

const STOCK_BADGE = { out: ['red', 'Out of stock'], critical: ['red', 'Critical'], low: ['amber', 'Low'], ok: ['green', 'Healthy'] };

async function dashboard(el) {
  const d = await api(`${B}/dashboard`);
  const step = (done, n, text, href, cta) => `<div class="row between" style="padding:10px 0;border-bottom:1px solid var(--line)"><div class="row"><span class="badge ${done ? 'green' : ''}">${done ? '✓' : n}</span><span>${text}</span></div>${done ? '' : `<a class="btn sm primary" href="${href}">${cta}</a>`}</div>`;
  const onboarding = d.products ? '' : `<div class="card" style="margin-bottom:16px"><h3>👋 Let's set up your warehouse</h3><p class="small muted">Your shop is empty — nothing is shown to customers until you add products with stock.</p>
    ${step(d.categories > 0, 1, 'Create product categories (each gets a short code used in Drovox SKUs, e.g. SEN → DRV-SEN-0001)', '#/categories', 'Add categories')}
    ${step(d.products > 0, 2, 'Add your first product — the SKU is generated automatically', '#/products?new=1', 'Add product')}
    ${step(false, 3, 'Print barcode stickers for the boxes and bins', '#/labels', 'Labels')}
    ${step(false, 4, 'Receive stock by scanning (USB scanner or phone camera)', '#/scan', 'Scan stock')}</div>`;
  el.innerHTML = `${head('Warehouse overview', '<a class="btn primary" href="#/scan">📷 Scan stock</a><a class="btn" href="#/orders?status=confirmed">Start packing →</a><button class="btn" id="pick">📋 Pick list</button>')}${onboarding}
    <div class="grid g4">${kpi('To pack', d.to_pack, 'confirmed orders')}${kpi('To ship', d.to_ship, 'packed, awaiting courier')}${kpi('In transit', d.in_transit)}${kpi("Today's orders", d.today_orders)}</div>
    <div class="grid g4" style="margin-top:16px">${kpi('Low / critical SKUs', d.low_stock, `${d.out_of_stock} out of stock`)}${kpi('Stock value (cost)', money(d.stock_value))}${kpi('Custom orders', d.jobs_open, `${d.jobs_ready ? `<a class="link" href="#/jobs?status=ready">${d.jobs_ready} ready for pickup →</a>` : 'in progress / pending'}`)}<div class="card kpi"><div class="l">Quick actions</div><div class="row" style="margin-top:8px"><a class="btn sm primary" href="#/products?new=1">+ Product</a><a class="btn sm" href="#/imports?new=1">+ Import</a><a class="btn sm" href="#/jobs?new=1">+ Custom</a></div></div></div>
    <div class="grid g2" style="margin-top:16px;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)">
      <div class="card"><div class="row between"><h3>Latest orders</h3><a class="link small" href="#/orders">All orders →</a></div><div class="table-wrap"><table class="t"><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th></tr></thead><tbody>
        ${d.latest_orders.length ? '' : '<tr><td colspan="5" class="muted">No orders yet</td></tr>'}${d.latest_orders.map((o) => `<tr class="click" data-o="${o.id}"><td><b>${esc(o.order_no)}</b><div class="tiny muted">${ago(o.created_at)}</div></td><td>${esc(o.ship_name)}</td><td class="small">${esc((o.summary || '').slice(0, 60))}</td><td>${money(o.total)}${o.payment_method === 'cod' ? ' <span class="badge amber">COD</span>' : ''}</td><td>${badge(o.status, o.status_label)}</td></tr>`).join('')}</tbody></table></div></div>
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
    ${bulk ? `<div class="row" style="margin-bottom:10px"><label class="check"><input type="checkbox" id="all"> Select all</label>${status === 'packed' ? '<select id="courier" style="width:160px"><option>Delhivery</option><option>Blue Dart</option><option>DTDC</option><option>Ekart</option><option>XpressBees</option></select>' : ''}<button class="btn primary sm" id="bulk">${bulk[1]}</button><button class="btn sm" id="boxlbl">🏷️ Box labels for selected</button></div>` : ''}
    <div class="card table-wrap"><table class="t"><thead><tr>${bulk ? '<th></th>' : ''}<th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th></tr></thead><tbody>
    ${rows.map((o) => `<tr class="click" data-o="${o.id}">${bulk ? `<td><input type="checkbox" data-sel="${o.id}"></td>` : ''}<td><b>${esc(o.order_no)}</b><div class="tiny muted">${ago(o.created_at)}</div></td><td>${esc(o.ship_name)}<div class="tiny muted">${esc((o.ship_address || '').split(', ').slice(-2).join(', '))}</div></td>
      <td class="small">${esc((o.summary || '').slice(0, 70))}</td><td>${money(o.total)}</td><td>${o.payment_method === 'cod' ? `<span class="badge amber">COD${o.payment_status === 'paid' ? ' ✓' : ''}</span>` : `<span class="badge ${o.payment_status === 'paid' ? 'green' : ''}">${esc(o.payment_status)}</span>`}</td><td>${badge(o.status, o.status_label)}${o.awb ? `<div class="tiny muted">${esc(o.courier)} ${esc(o.awb)}</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No orders here</td></tr>'}</tbody></table></div>`;
  $('#of').onsubmit = (e) => { e.preventDefault(); location.hash = `#/orders?status=${status}&q=${encodeURIComponent(formData(e.target).q)}`; };
  $$('[data-o]', el).forEach((r) => { r.onclick = (e) => { if (e.target.matches('input')) return; openOrder(B, r.dataset.o, () => orders(el, params)); }; });
  $('#all')?.addEventListener('change', (e) => $$('[data-sel]').forEach((c) => { c.checked = e.target.checked; }));
  $('#boxlbl')?.addEventListener('click', async () => {
    const ids = $$('[data-sel]').filter((c) => c.checked).map((c) => c.dataset.sel);
    if (!ids.length) return toast('Select at least one order', 'err');
    await refs();
    printBoxLabels(await Promise.all(ids.map((id) => api(`${B}/orders/${id}`))), STORE);
  });
  $('#bulk')?.addEventListener('click', async () => {
    const ids = $$('[data-sel]').filter((c) => c.checked).map((c) => c.dataset.sel);
    if (!ids.length) return toast('Select at least one order', 'err');
    const r = await api(`${B}/orders/bulk-status`, { method: 'POST', body: { ids, to: bulk[0], courier: $('#courier')?.value } });
    toast(`${r.done.length} orders updated${r.failed.length ? `, ${r.failed.length} failed` : ''} · customers notified on WhatsApp`); orders(el, params);
  });
}

const jsonList = (v) => { if (Array.isArray(v)) return v; try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const MAX_PHOTOS = 5;

/** Photo manager in the product form. Existing products save each change at once; new ones upload after create. */
function wirePhotos(m, p) {
  let images = jsonList(p?.images); const queued = [];
  const grid = $('#phs', m.el); const input = $('#phfile', m.el);
  const render = () => {
    const total = images.length + queued.length;
    grid.innerHTML = images.map((k, i) => `<div class="ph"><img src="${imgUrl(k, 's')}" alt="">${i ? '' : '<span class="main">Main</span>'}<div class="acts">${i ? `<button type="button" data-mv="${i}" title="Move left">◀</button>` : ''}${i < images.length - 1 ? `<button type="button" data-mv="${i + 1}" title="Move right">▶</button>` : ''}<button type="button" data-del="${esc(k)}" title="Delete">✕</button></div></div>`).join('')
      + queued.map((q, i) => `<div class="ph"><img src="${q.variants.s}" alt=""><span class="main" style="background:var(--amber)">Saves with product</span><div class="acts"><button type="button" data-unq="${i}">✕</button></div></div>`).join('')
      + (total < MAX_PHOTOS ? `<div class="ph add" id="phadd">➕<br>Add photo${total ? '' : 's'}<br><span class="tiny">${total}/${MAX_PHOTOS}</span></div>` : '');
    $('#phadd', grid)?.addEventListener('click', () => input.click());
    $$('[data-del]', grid).forEach((b) => { b.onclick = async () => { if (!confirm('Delete this photo?')) return; try { images = (await api(`${B}/products/${p.id}/images/${b.dataset.del}`, { method: 'DELETE' })).images; render(); } catch (e) { toast(e.message, 'err'); } }; });
    $$('[data-mv]', grid).forEach((b) => { b.onclick = async () => { const i = Number(b.dataset.mv); const next = [...images]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; try { images = (await api(`${B}/products/${p.id}/images`, { method: 'PUT', body: { images: next } })).images; render(); } catch (e) { toast(e.message, 'err'); } }; });
    $$('[data-unq]', grid).forEach((b) => { b.onclick = () => { queued.splice(Number(b.dataset.unq), 1); render(); }; });
  };
  input.onchange = async () => {
    const files = [...input.files].slice(0, MAX_PHOTOS - images.length - queued.length); input.value = '';
    for (const f of files) {
      grid.insertAdjacentHTML('beforeend', '<div class="ph add" data-busy><span class="spinner"></span></div>');
      try {
        const variants = await photoVariants(f);
        if (p?.id) images = (await api(`${B}/products/${p.id}/images`, { method: 'POST', body: { variants } })).images; else queued.push({ variants });
      } catch (e) { toast(e.message, 'err'); }
      render();
    }
  };
  render();
  return { async uploadQueued(id) { for (const q of queued) await api(`${B}/products/${id}/images`, { method: 'POST', body: { variants: q.variants } }); } };
}

function wireAiFill(m, form) {
  $('#aifill', m.el).onclick = async (e) => {
    const btn = e.currentTarget; const f = readProductForm(form);
    if (!f.name.trim()) { toast('Enter the product name first', 'err'); form.elements.name.focus(); return; }
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Writing…';
    try {
      const r = await api(`${B}/products/ai-fill`, { method: 'POST', body: { name: f.name, brand: f.brand, category_id: f.category_id, sku: f.sku, specs: f.specs, description: f.description } });
      const set = (n, v) => { if (v && form.elements[n]) { form.elements[n].value = v; form.elements[n].classList.add('ai-filled'); } };
      set('short_description', r.short_description); set('highlights', r.highlights.join('\n')); set('description', r.description); set('in_box', r.in_box.join('\n'));
      set('specs', Object.entries({ ...r.specs, ...f.specs }).map(([k, v]) => `${k}: ${v}`).join('\n'));
      set('tags', [...new Set([...String(f.tags || '').split(','), ...r.tags.split(',')].map((t) => t.trim()).filter(Boolean))].join(','));
      if (r.hsn && (!f.hsn || f.hsn === '8542')) set('hsn', r.hsn);
      toast(r.confidence === 'low' ? 'Filled — Claude was unsure this is the exact part, please check carefully' : 'Filled with AI — review and save', r.confidence === 'low' ? 'err' : 'ok');
    } catch (err) { toast(err.message, 'err'); }
    btn.disabled = false; btn.textContent = '✨ Fill with AI';
  };
}

function productForm(p = {}) {
  const tiers = p.tiers ? (typeof p.tiers === 'string' ? JSON.parse(p.tiers) : p.tiers) : [];
  const specs = p.specs ? (typeof p.specs === 'string' ? JSON.parse(p.specs) : p.specs) : {};
  return `<form class="form two" id="pf">
    ${CATS.length ? '' : '<div class="full banner brand"><div>Create a category first — its code becomes part of the SKU.</div><a class="btn sm primary" href="#/categories">Add categories</a></div>'}
    <label class="f">Category<select name="category_id">${CATS.map((c) => `<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${c.icon} ${esc(c.name)} (${esc(c.code || '')})</option>`).join('')}</select></label>
    <label class="f">Drovox SKU <span class="muted">(auto from category)</span><div class="row" style="flex-wrap:nowrap;margin-top:4px"><input name="sku" value="${esc(p.sku || '')}" placeholder="auto e.g. DRV-SEN-0001" style="text-transform:uppercase"><button type="button" class="btn sm" id="gen-sku" title="Generate next SKU">↻</button></div></label>
    <label class="f">Manufacturer barcode (EAN/UPC, optional)<div class="row" style="flex-wrap:nowrap;margin-top:4px"><input name="barcode" value="${esc(p.barcode || '')}" placeholder="scan or type"><button type="button" class="btn sm" id="scan-bc" title="Scan with camera">📷</button></div></label>
    <label class="f">Icon (emoji, shown until photos are added)<input name="image" value="${esc(p.image || '📦')}" maxlength="4"></label>
    <label class="f full">Product name<input name="name" required value="${esc(p.name || '')}" placeholder="e.g. HC-SR04 Ultrasonic Distance Sensor Module"></label>
    <div class="full ai-box row between"><div class="small"><b>✨ Fill with AI</b> — Claude writes the short description, highlights, specifications, box contents and search tags from the name and brand. Check the details before saving.</div><button type="button" class="btn sm indigo" id="aifill">✨ Fill with AI</button></div>
    <div class="full"><div class="f">Photos <span class="muted">(3–5 recommended · first photo is the main one · resized automatically for fast loading)</span></div><div class="ph-grid" id="phs" style="margin-top:6px"></div><input type="file" id="phfile" accept="image/*" multiple hidden></div>
    <label class="f">Supplier<select name="supplier_id"><option value="">—</option>${SUPPLIERS.map((s) => `<option value="${s.id}" ${s.id === p.supplier_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    <label class="f">Brand<input name="brand" value="${esc(p.brand || '')}"></label><label class="f">HSN code<input name="hsn" value="${esc(p.hsn || '8542')}"></label>
    <label class="f">Selling price (₹, incl. GST)<input name="price" type="number" step="0.01" required value="${p.price ?? ''}"></label><label class="f">MRP (₹)<input name="mrp" type="number" step="0.01" required value="${p.mrp ?? ''}"></label>
    <label class="f">Landed cost (₹, ex-GST)<input name="cost_price" type="number" step="0.01" value="${p.cost_price ?? ''}"></label><label class="f">GST rate<select name="gst_rate">${[0, 5, 12, 18, 28].map((r) => `<option ${Number(p.gst_rate ?? 18) === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
    <label class="f">Reorder level<input name="reorder_level" type="number" value="${p.reorder_level ?? 10}"></label>${p.id ? '<div></div>' : '<label class="f">Opening stock<input name="stock" type="number" value="0"></label>'}
    <label class="f full">Search tags (comma separated)<input name="tags" value="${esc(p.tags || '')}" placeholder="arduino,robot,beginner"></label>
    <div class="full"><div class="f">Bulk price tiers</div><div id="tiers" class="stack" style="margin-top:6px">${[...tiers, {}, {}].slice(0, Math.max(3, tiers.length + 1)).map((t) => `<div class="row" style="flex-wrap:nowrap"><input type="number" placeholder="Min qty" data-tq value="${t.min_qty ?? ''}"><input type="number" step="0.01" placeholder="Unit price ₹" data-tp value="${t.price ?? ''}"></div>`).join('')}</div></div>
    <label class="f full">Specifications (one per line, “Key: Value”)<textarea name="specs" rows="4">${esc(Object.entries(specs).map(([k, v]) => `${k}: ${v}`).join('\n'))}</textarea></label>
    <label class="f full">Short description <span class="muted">(shown under the product name)</span><textarea name="short_description" rows="2" maxlength="600">${esc(p.short_description || '')}</textarea></label>
    <label class="f full">Highlights <span class="muted">(one per line)</span><textarea name="highlights" rows="4">${esc(jsonList(p.highlights).join('\n'))}</textarea></label>
    <label class="f full">Description<textarea name="description" rows="4">${esc(p.description || '')}</textarea></label>
    <label class="f full">What's in the box <span class="muted">(one per line)</span><textarea name="in_box" rows="2">${esc(jsonList(p.in_box).join('\n'))}</textarea></label>
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
    ${rows.length ? '' : `<div class="empty card"><div class="big">📦</div><h3>No products yet</h3><p>Add your first product — the Drovox SKU is created for you.</p><button class="btn primary" onclick="location.hash='#/products?new=1'">+ Add product</button></div>`}
    <div class="card table-wrap ${rows.length ? '' : 'hidden'}"><table class="t"><thead><tr><th></th><th>Product</th><th>Category</th><th class="r">Price</th><th class="r">Cost</th><th class="r">Margin</th><th class="r">Stock</th><th></th></tr></thead><tbody>
    ${rows.map((p) => { const net = p.price / (1 + p.gst_rate / 100); const mg = p.cost_price ? Math.round((1 - p.cost_price / net) * 100) : null; return `<tr>
      <td>${art(p, 'xs')}</td><td><b>${esc(p.name)}</b><div class="tiny muted"><span class="code">${esc(p.sku)}</span>${p.barcode ? ` · ${esc(p.barcode)}` : ''} ${p.active ? '' : '<span class="badge">hidden</span>'} ${esc(p.supplier || '')}</div></td><td class="small">${esc(p.category || '')}</td>
      <td class="r">${money(p.price)}<div class="tiny muted">MRP ${money(p.mrp)}</div></td><td class="r">${money(p.cost_price, 2)}</td><td class="r">${mg == null ? '—' : `<span class="badge ${mg >= 40 ? 'green' : mg >= 20 ? 'amber' : 'red'}">${mg}%</span>`}</td>
      <td class="r"><b style="color:${p.stock <= 0 ? 'var(--red)' : p.stock <= p.reorder_level ? 'var(--amber)' : 'inherit'}">${num(p.stock)}</b><div class="tiny muted">reorder at ${p.reorder_level}</div></td>
      <td class="nowrap"><button class="btn sm" data-adj="${p.id}">± Stock</button> <button class="btn sm" data-lbl="${p.id}" title="Print labels">🏷️</button> <button class="btn sm" data-edit="${p.id}">Edit</button> <button class="btn sm ghost" data-hist="${p.id}">History</button></td></tr>`; }).join('')}</tbody></table></div>`;
  const byId = (id) => rows.find((p) => p.id === Number(id));
  const edit = (p) => {
    const m = modal(`<h2>${p ? 'Edit product' : 'New product'}</h2>${productForm(p || {})}`, { wide: true });
    const form = $('#pf', m.el); wireMargin(form); const photos = wirePhotos(m, p); wireAiFill(m, form);
    const skuIn = form.elements.sku; let skuTouched = !!p;
    skuIn.addEventListener('input', () => { skuTouched = true; });
    const genSku = async () => { if (!form.elements.category_id.value) return; skuIn.value = (await api(`${B}/sku-next?category_id=${form.elements.category_id.value}`)).sku; };
    $('#gen-sku', m.el).onclick = () => { skuTouched = false; genSku(); };
    form.elements.category_id?.addEventListener('change', () => { if (!skuTouched) genSku(); });
    if (!p) genSku();
    $('#scan-bc', m.el).onclick = () => scanWithCamera((code) => { form.elements.barcode.value = code; }, { continuous: false, title: 'Scan the manufacturer barcode' });
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = $('button.primary', form); btn.disabled = true;
      try {
        const saved = await api(p ? `${B}/products/${p.id}` : `${B}/products`, { method: p ? 'PUT' : 'POST', body: readProductForm(form) });
        if (!p) await photos.uploadQueued(saved.id);
        toast(p ? 'Product saved' : 'Product created'); m.close(); clearNew(params); products(el, params);
      } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
    };
  };
  $('#new').onclick = () => edit(null);
  if (params.get('new')) edit(null);
  $('#sf').onsubmit = (e) => { e.preventDefault(); location.hash = `#/products?q=${encodeURIComponent(formData(e.target).q)}`; };
  $('#csv').onclick = () => downloadCsv('drovox-products.csv', rows.map((p) => ({ sku: p.sku, name: p.name, category: p.category, price: p.price, mrp: p.mrp, cost: p.cost_price, gst: p.gst_rate, hsn: p.hsn, stock: p.stock, reorder_level: p.reorder_level, barcode: p.barcode || '' })));
  $$('[data-edit]', el).forEach((b) => { b.onclick = () => edit(byId(b.dataset.edit)); });
  $$('[data-lbl]', el).forEach((b) => { b.onclick = () => labelDialog([byId(b.dataset.lbl)]); });
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

// ------------------------------------------------------------------ labels
async function labelDialog(products) {
  await refs();
  const m = modal(`<h2>Print labels</h2><form class="form" id="lf">
    <label class="f">Label size<select name="size">${Object.entries(LABEL_SIZES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
    ${products.map((p) => `<div class="row between"><span class="small"><b>${esc(p.name)}</b> <span class="code">${esc(p.sku)}</span></span><label class="row small">Copies <input type="number" min="1" value="${Math.max(1, Math.min(p.stock || 1, 200))}" data-copies="${p.id}" style="width:80px"></label></div>`).join('')}
    <label class="check"><input type="checkbox" name="price" checked> Show MRP on the label</label>
    <button class="btn primary">🖨️ Print</button></form>`);
  $('#lf', m.el).onsubmit = (e) => {
    e.preventDefault(); const f = formData(e.target);
    printProductLabels(products.map((p) => ({ product: p, copies: Number($(`[data-copies="${p.id}"]`, m.el).value) || 1 })), f.size, STORE, { showPrice: f.price });
  };
}

async function labels(el) {
  await refs();
  const rows = await api(`${B}/products`);
  el.innerHTML = `${head('Labels & stickers', '<button class="btn primary" id="print">🖨️ Print selected</button>')}
    <p class="small muted">Product stickers carry the Drovox SKU as a Code128 barcode (or the manufacturer barcode if set) plus a QR code on larger sizes — scanning either one in <a class="link" href="#/scan">Scan stock</a> finds the product. Box / shipping labels (100 × 150 mm) are printed from <a class="link" href="#/orders?status=confirmed">Orders</a>; custom-order tags from <a class="link" href="#/jobs">Custom orders</a>.</p>
    <div class="card flat row" style="margin-bottom:12px"><input id="flt" placeholder="Filter by name or SKU" style="max-width:280px"><label class="row small">Size <select id="size" style="width:auto">${Object.entries(LABEL_SIZES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" id="price" checked> Show MRP</label><label class="check"><input type="checkbox" id="all"> Select all</label></div>
    <div class="card table-wrap"><table class="t"><thead><tr><th></th><th>Product</th><th>SKU / barcode</th><th class="r">Stock</th><th class="r">Copies</th></tr></thead><tbody>
    ${rows.map((p) => `<tr data-row="${esc(`${p.name} ${p.sku}`.toLowerCase())}"><td><input type="checkbox" data-pick="${p.id}"></td><td>${esc(p.name)}</td><td class="small"><span class="code">${esc(p.sku)}</span>${p.barcode ? ` · ${esc(p.barcode)}` : ''}</td><td class="r">${p.stock}</td><td class="r"><input type="number" min="1" value="${Math.max(1, p.stock)}" data-copies="${p.id}" style="width:80px"></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Add products first</td></tr>'}</tbody></table></div>`;
  $('#flt').oninput = (e) => $$('[data-row]', el).forEach((r) => r.classList.toggle('hidden', !r.dataset.row.includes(e.target.value.toLowerCase())));
  $('#all').onchange = (e) => $$('[data-row]:not(.hidden) [data-pick]', el).forEach((c) => { c.checked = e.target.checked; });
  $('#print').onclick = () => {
    const items = $$('[data-pick]', el).filter((c) => c.checked).map((c) => ({ product: rows.find((p) => p.id === Number(c.dataset.pick)), copies: Number($(`[data-copies="${c.dataset.pick}"]`, el).value) || 1 }));
    if (!items.length) return toast('Tick the products to print', 'err');
    printProductLabels(items, $('#size').value, STORE, { showPrice: $('#price').checked });
  };
}

// ------------------------------------------------------------------ categories
async function categories(el) {
  await refs();
  const rows = await api(`${B}/categories`);
  el.innerHTML = `${head('Categories & SKU codes', `${rows.length ? '' : '<button class="btn" id="starter">Add starter categories</button>'}<button class="btn primary" id="new">+ New category</button>`)}
    <p class="small muted">Each category has a short code. New products get the next Drovox SKU automatically: <span class="code">${esc((STORE?.sku_prefix) || 'DRV')}-&lt;CODE&gt;-0001</span>, e.g. Sensors (SEN) → <span class="code">DRV-SEN-0001</span>, <span class="code">DRV-SEN-0002</span>…</p>
    ${rows.length ? `<div class="card table-wrap"><table class="t"><thead><tr><th>Icon</th><th>Name</th><th>Code</th><th>Next SKU</th><th class="r">Products</th><th class="r">Order</th><th></th></tr></thead><tbody>
      ${rows.map((c) => `<tr><td style="font-size:1.4rem">${esc(c.icon || '📦')}</td><td><b>${esc(c.name)}</b></td><td class="code">${esc(c.code || '')}</td><td class="code" data-next="${c.id}">…</td><td class="r">${c.products}</td><td class="r">${c.sort}</td>
        <td class="nowrap"><button class="btn sm" data-ed="${c.id}">Edit</button> ${c.products ? '' : `<button class="btn sm danger" data-del="${c.id}">Delete</button>`}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty card"><div class="big">🗂️</div><h3>No categories yet</h3><p>Create your own, or start from the standard electronics list (boards, sensors, motors, drone, power, displays, IoT, mechanical, tools, 3D printing, LEDs) and edit it.</p></div>'}`;
  $$('[data-next]', el).forEach(async (td) => { td.textContent = (await api(`${B}/sku-next?category_id=${td.dataset.next}`)).sku; });
  const form = (c = {}) => `<form class="form two"><label class="f full">Name<input name="name" required value="${esc(c.name || '')}" placeholder="e.g. Sensors & Modules"></label>
    <label class="f">Code (2–5 letters, used in SKU)<input name="code" maxlength="5" value="${esc(c.code || '')}" placeholder="auto: first 3 letters" style="text-transform:uppercase"></label>
    <label class="f">Icon (emoji)<input name="icon" maxlength="4" value="${esc(c.icon || '📦')}"></label><label class="f">Display order<input name="sort" type="number" value="${c.sort ?? rows.length}"></label>
    ${c.id && c.products ? '<div class="full small muted">Changing the code only affects new SKUs; existing products keep theirs.</div>' : ''}<button class="btn primary full">Save</button></form>`;
  const open = (c) => {
    const m = modal(`<h2>${c ? 'Edit category' : 'New category'}</h2>${form(c || {})}`);
    $('form', m.el).onsubmit = async (e) => { e.preventDefault(); try { await api(c ? `${B}/categories/${c.id}` : `${B}/categories`, { method: c ? 'PUT' : 'POST', body: formData(e.target) }); await refs(true); toast('Category saved'); m.close(); categories(el); } catch (err) { toast(err.message, 'err'); } };
  };
  $('#new').onclick = () => open(null);
  $('#starter')?.addEventListener('click', async () => { const r = await api(`${B}/categories/starter`, { method: 'POST' }); await refs(true); toast(`${r.added} categories added`); categories(el); });
  $$('[data-ed]', el).forEach((b) => { b.onclick = () => open(rows.find((c) => c.id === Number(b.dataset.ed))); });
  $$('[data-del]', el).forEach((b) => { b.onclick = async () => { if (!confirm('Delete this category?')) return; try { await api(`${B}/categories/${b.dataset.del}`, { method: 'DELETE' }); await refs(true); categories(el); } catch (err) { toast(err.message, 'err'); } }; });
}

// ------------------------------------------------------------------ scan stock in / out
async function scan(el) {
  const log = [];
  el.innerHTML = `${head('Scan stock in / out')}
    <div class="grid g2" style="grid-template-columns:minmax(0,1fr) minmax(0,1.2fr)">
      <div class="card stack">
        <div class="tabs" id="mode" style="margin-bottom:0"><a data-m="in" class="on">⬇ Stock IN</a><a data-m="out">⬆ Stock OUT</a><a data-m="find">🔍 Look up</a></div>
        <div class="form two"><label class="f">Quantity per scan<input type="number" id="qty" min="1" value="1"></label>
          <label class="f">Reason<select id="reason"><option>Received from supplier</option><option>Physical count correction</option><option>Customer return</option><option>Counter sale</option><option>Damaged / defective</option><option>Used for custom order</option><option>Sample / internal use</option></select></label></div>
        <form id="sf"><label class="f">Scan here (USB / Bluetooth scanner types into this box)<input id="code" autocomplete="off" placeholder="Click here, then scan a barcode or QR" style="font-size:1.2rem;padding:14px"></label></form>
        <button class="btn primary lg" id="cam">📷 Scan with camera</button>
        <div class="small muted">Works with Drovox SKU stickers, manufacturer barcodes and the QR codes on labels. Scanning an order or custom-job number opens it. Repeat scans add up (5 scans × qty 1 = 5 units).</div>
      </div>
      <div class="card"><div class="row between"><h3>This session</h3><span class="small muted" id="sum"></span></div><div id="log"><p class="muted small">Nothing scanned yet.</p></div></div>
    </div>`;
  let mode = 'in';
  const input = $('#code');
  const focus = () => setTimeout(() => input.focus(), 50); focus();
  $$('#mode a', el).forEach((a) => { a.onclick = () => { mode = a.dataset.m; $$('#mode a', el).forEach((x) => x.classList.toggle('on', x === a)); $('#reason').value = mode === 'out' ? 'Counter sale' : 'Received from supplier'; focus(); }; });
  const render = () => {
    $('#log').innerHTML = log.length ? `<table class="t"><tbody>${log.map((l) => `<tr><td>${art(l.product || {}, 'xs')}</td><td class="small"><b>${esc(l.product?.name || l.code)}</b><div class="tiny muted">${esc(l.product?.sku || '')} ${l.note ? `· ${esc(l.note)}` : ''}</div></td>
      <td class="r" style="color:${l.change > 0 ? 'var(--green)' : l.change < 0 ? 'var(--red)' : 'inherit'}">${l.change ? (l.change > 0 ? '+' : '') + l.change : ''}</td><td class="r small">${l.stock != null ? `now ${l.stock}` : ''}</td><td>${l.ok ? '✅' : '⚠️'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">Nothing scanned yet.</p>';
    const inn = log.filter((l) => l.ok && l.change > 0).reduce((s, l) => s + l.change, 0); const out = log.filter((l) => l.ok && l.change < 0).reduce((s, l) => s - l.change, 0);
    $('#sum').textContent = `${inn} in · ${out} out`;
  };
  const handle = async (code) => {
    code = String(code).trim(); if (!code) return;
    const qty = Math.max(1, Number($('#qty').value) || 1);
    try {
      const found = await api(`${B}/scan/${encodeURIComponent(code)}`);
      if (found.type === 'order') { openOrder(B, found.order.id, () => {}); log.unshift({ code, ok: true, note: `order ${found.order.order_no}` }); }
      else if (found.type === 'job') { log.unshift({ code, ok: true, note: `custom order ${found.job.job_no} — ${found.job.title} (${found.job.status})` }); }
      else if (mode === 'find') { const p = found.product; log.unshift({ code, ok: true, product: p, stock: p.stock, note: `${money(p.price)} · ${p.active ? 'live' : 'hidden'}` }); }
      else {
        const r = await api(`${B}/scan-adjust`, { method: 'POST', body: { code, change: mode === 'in' ? qty : -qty, reason: $('#reason').value } });
        log.unshift({ code, ok: true, product: r.product, change: r.change, stock: r.stock });
        if (navigator.vibrate) navigator.vibrate(60);
      }
    } catch (e) { log.unshift({ code, ok: false, note: e.message }); toast(e.message, 'err'); }
    render();
  };
  $('#sf').onsubmit = (e) => { e.preventDefault(); const c = input.value; input.value = ''; handle(c); focus(); };
  $('#cam').onclick = () => scanWithCamera(handle, { title: mode === 'in' ? 'Scan to add stock' : mode === 'out' ? 'Scan to remove stock' : 'Scan to look up' });
}

// ------------------------------------------------------------------ custom / made-to-order jobs
const JOB = { pending: ['', 'Pending'], in_progress: ['blue', 'In progress'], ready: ['green', 'Ready ✓'], delivered: ['teal', 'Delivered'], cancelled: ['red', 'Cancelled'] };
async function jobs(el, params) {
  await refs();
  const st = params.get('status') || '';
  const d = await api(`${B}/jobs${st ? `?status=${st}` : ''}`);
  el.innerHTML = `${head('Custom orders', '<button class="btn primary" id="new">+ New custom order</button>')}
    <p class="small muted">Made-to-order work — assembled kits, wired modules, custom PCBs, project builds. Mark a job <b>Ready</b> and the customer gets a WhatsApp message automatically.</p>
    <div class="tabs"><a href="#/jobs" class="${!st ? 'on' : ''}">All</a>${Object.entries(JOB).map(([k, [, l]]) => `<a href="#/jobs?status=${k}" class="${st === k ? 'on' : ''}">${l} <b>${d.counts[k] || 0}</b></a>`).join('')}</div>
    <div class="card table-wrap"><table class="t"><thead><tr><th>Job</th><th>Customer</th><th>What</th><th class="r">Amount</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>
    ${d.rows.map((j) => { const late = j.due_date && j.due_date < new Date().toISOString().slice(0, 10) && ['pending', 'in_progress'].includes(j.status); return `<tr>
      <td><b>${esc(j.job_no)}</b><div class="tiny muted">${ago(j.created_at)}</div></td><td>${esc(j.customer_name)}<div class="tiny muted">${esc(j.phone || '')}</div></td>
      <td class="small"><b>${esc(j.title)}</b>${j.qty > 1 ? ` × ${j.qty}` : ''}${j.details ? `<div class="tiny muted">${esc(j.details.slice(0, 80))}</div>` : ''}</td>
      <td class="r">${money(j.price)}${j.advance ? `<div class="tiny muted">paid ${money(j.advance)} · due ${money(j.price - j.advance)}</div>` : ''}</td>
      <td class="small" style="color:${late ? 'var(--red)' : 'inherit'}">${esc(j.due_date || '—')}${late ? ' · late' : ''}</td><td><span class="badge ${JOB[j.status][0]}">${JOB[j.status][1]}</span></td>
      <td class="nowrap">${j.status === 'pending' ? `<button class="btn sm" data-st="in_progress" data-j="${j.id}">Start</button>` : ''}${['pending', 'in_progress'].includes(j.status) ? ` <button class="btn sm primary" data-st="ready" data-j="${j.id}">Mark ready</button>` : ''}${j.status === 'ready' ? `<button class="btn sm primary" data-st="delivered" data-j="${j.id}">Delivered</button>` : ''}
        <button class="btn sm" data-tag="${j.id}" title="Print tag">🏷️</button> <button class="btn sm ghost" data-ed="${j.id}">Edit</button></td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">No custom orders here</td></tr>'}</tbody></table></div>`;
  const byId = (id) => d.rows.find((j) => j.id === Number(id));
  const open = (j) => {
    const m = modal(`<h2>${j ? `Edit ${esc(j.job_no)}` : 'New custom order'}</h2><form class="form two">
      <label class="f">Customer name<input name="customer_name" required value="${esc(j?.customer_name || '')}"></label><label class="f">WhatsApp number<input name="phone" value="${esc(j?.phone || '')}" inputmode="tel"></label>
      <label class="f full">What to make<input name="title" required value="${esc(j?.title || '')}" placeholder="e.g. Line follower robot kit, assembled & tested"></label>
      <label class="f full">Details / specification<textarea name="details" rows="3">${esc(j?.details || '')}</textarea></label>
      <label class="f">Quantity<input name="qty" type="number" min="1" value="${j?.qty || 1}"></label><label class="f">Due date<input name="due_date" type="date" value="${esc(j?.due_date || '')}"></label>
      <label class="f">Total price ₹<input name="price" type="number" step="0.01" value="${j?.price || 0}"></label><label class="f">Advance received ₹<input name="advance" type="number" step="0.01" value="${j?.advance || 0}"></label>
      <label class="f full">Internal notes<textarea name="notes" rows="2">${esc(j?.notes || '')}</textarea></label>
      ${j && j.status !== 'cancelled' ? `<button type="button" class="btn danger" id="cx">Cancel job</button>` : '<div></div>'}<button class="btn primary">Save</button></form>`, { wide: true });
    $('form', m.el).onsubmit = async (e) => { e.preventDefault(); try { await api(j ? `${B}/jobs/${j.id}` : `${B}/jobs`, { method: j ? 'PUT' : 'POST', body: formData(e.target) }); toast('Saved'); m.close(); clearNew(params); jobs(el, params); } catch (err) { toast(err.message, 'err'); } };
    $('#cx', m.el)?.addEventListener('click', async () => { if (!confirm('Cancel this custom order?')) return; await api(`${B}/jobs/${j.id}/status`, { method: 'POST', body: { status: 'cancelled', notify: false } }); m.close(); jobs(el, params); });
  };
  $('#new').onclick = () => open(null);
  if (params.get('new')) open(null);
  $$('[data-ed]', el).forEach((b) => { b.onclick = () => open(byId(b.dataset.ed)); });
  $$('[data-tag]', el).forEach((b) => { b.onclick = () => printJobLabel(byId(b.dataset.tag), STORE); });
  $$('[data-st]', el).forEach((b) => { b.onclick = async () => {
    const r = await api(`${B}/jobs/${b.dataset.j}/status`, { method: 'POST', body: { status: b.dataset.st } });
    toast(`${r.job.job_no} → ${JOB[r.job.status][1]}${r.whatsapp ? (r.whatsapp.ok ? (r.whatsapp.simulated ? ' · WhatsApp simulated (gateway not configured)' : ' · customer notified on WhatsApp') : ` · WhatsApp failed: ${r.whatsapp.error}`) : ''}`, r.whatsapp && !r.whatsapp.ok ? 'err' : 'ok');
    jobs(el, params);
  }; });
}

// ------------------------------------------------------------------ fabrication services (3D print, PCB, cutting, battery)
const SVC_LABEL = { new: 'New', quoted: 'Quote sent', approved: 'Approved', in_production: 'In production', ready: 'Ready', delivered: 'Delivered', cancelled: 'Cancelled' };
const SVC_COLOR = { new: 'amber', quoted: 'blue', approved: 'violet', in_production: 'teal', ready: 'green', delivered: '', cancelled: 'red' };
const SVC_ICON = { industrial3d: '🏭', print3d: '🖨️', metal_laser: '⚙️', pcb: '🟩', laser: '🔥', acrylic: '💎', battery: '🔋' };
async function services(el, params) {
  const st = params.get('status') || ''; const svc = params.get('service') || '';
  const q = new URLSearchParams({ ...(st ? { status: st } : {}), ...(svc ? { service: svc } : {}) });
  const d = await api(`${B}/services?${q}`);
  const link = (o) => { const p = new URLSearchParams({ ...(svc ? { service: svc } : {}), ...(st ? { status: st } : {}), ...o }); for (const [k, v] of [...p]) if (!v) p.delete(k); return `#/services${p.toString() ? `?${p}` : ''}`; };
  const cur = d.services.find((x) => x.id === svc);
  el.innerHTML = `${head(cur ? `${cur.icon} ${esc(cur.title)} orders` : 'Service orders', '<a class="btn" href="/#/services" target="_blank">View services page ↗</a>')}
    <div class="row" style="margin-bottom:12px;gap:8px"><a class="chip ${!svc ? 'on' : ''}" href="${link({ service: '' })}">All services <b>${d.all_open}</b></a>${d.services.map((x) => `<a class="chip ${svc === x.id ? 'on' : ''}" href="${link({ service: x.id })}">${x.icon} ${esc(x.short)} <b>${d.by_service[x.id] || 0}</b></a>`).join('')}</div>
    <p class="small muted">Counts are open jobs. Check the files${svc === 'pcb' || !svc ? ' (PCB orders include a rendered Gerber view)' : ''}, send the final quote (the customer gets it on WhatsApp and can approve online), then move the job through production.</p>
    <div class="tabs"><a href="${link({ status: '' })}" class="${!st ? 'on' : ''}">All</a>${d.statuses.map((s) => `<a href="${link({ status: s })}" class="${st === s ? 'on' : ''}">${SVC_LABEL[s]} <b>${d.counts[s] || 0}</b></a>`).join('')}</div>
    <div class="card table-wrap"><table class="t"><thead><tr><th>Request</th><th>Customer</th><th>Job</th><th class="r">Estimate</th><th class="r">Quote</th><th>Status</th></tr></thead><tbody>
    ${d.rows.map((r) => `<tr class="click" data-s="${r.id}"><td><b>${esc(r.req_no)}</b><div class="tiny muted">${ago(r.created_at)}</div></td><td>${esc(r.name)}<div class="tiny muted">${esc(r.phone)}</div></td>
      <td class="small">${SVC_ICON[r.service] || ''} <b>${esc(r.title)}</b> × ${r.quantity}${r.files.length ? ` · 📎 ${r.files.length}` : ''}</td><td class="r">${money(r.estimate)}</td><td class="r">${r.quoted_price ? money(r.quoted_price) : '—'}</td>
      <td><span class="badge ${SVC_COLOR[r.status]}">${SVC_LABEL[r.status]}</span></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No service requests here yet</td></tr>'}</tbody></table></div>`;
  $$('[data-s]', el).forEach((row) => { row.onclick = () => serviceJob(row.dataset.s, () => services(el, params)); });
}
async function serviceJob(id, reload) {
  const r = await api(`${B}/services/${id}`);
  const next = { new: ['quoted', 'cancelled'], quoted: ['approved', 'cancelled'], approved: ['in_production', 'cancelled'], in_production: ['ready'], ready: ['delivered'], delivered: [], cancelled: [] }[r.status];
  const m = modal(`<div class="row between"><div><h2 style="margin:0">${SVC_ICON[r.service] || ''} ${esc(r.req_no)}</h2><div class="small muted">${esc(r.title)} · ${dt(r.created_at)}</div></div><span class="badge ${SVC_COLOR[r.status]}">${SVC_LABEL[r.status]}</span></div>
    <div class="grid g2" style="margin-top:12px">
      <div class="card flat"><b>Customer</b><div>${esc(r.name)} · <a class="link" href="tel:${esc(r.phone)}">${esc(r.phone)}</a></div>${r.email ? `<div class="small muted">${esc(r.email)}</div>` : ''}${r.notes ? `<div class="small" style="margin-top:6px">📝 ${esc(r.notes)}</div>` : ''}</div>
      <div class="card flat"><b>Specification</b><div class="small">Quantity: ${r.quantity}<br>${Object.entries(r.specs).filter(([k]) => !['gerber', 'model', 'drawing'].includes(k)).map(([k, v]) => `${esc(k.replace(/_/g, ' '))}: <b>${esc(typeof v === 'boolean' ? (v ? 'yes' : 'no') : v)}</b>`).join('<br>')}</div></div>
    </div>
    <div class="card flat" style="margin-top:12px"><b>Estimate shown to customer</b>${r.estimate_lines.map((l) => `<div class="row between small"><span>${esc(l.label)}</span><span>${money(l.amount, 2)}</span></div>`).join('')}<div class="row between"><b>Total incl. GST</b><b>${money(r.estimate, 2)}</b></div></div>
    ${r.specs.gerber ? `<div class="card flat" style="margin-top:12px"><div class="row between"><b>Gerber view</b><div class="row"><button type="button" class="chip on" data-gs="top">Top</button><button type="button" class="chip" data-gs="bottom">Bottom</button></div></div>
      <div style="background:#0b1220;border-radius:12px;padding:14px;margin-top:8px;display:grid;place-items:center;min-height:200px"><img id="gimg" alt="Rendered PCB" style="max-width:100%;max-height:360px"></div>
      <div class="small" style="margin-top:6px">Detected: <b>${r.specs.gerber.width_mm} × ${r.specs.gerber.height_mm} mm</b>, ${r.specs.gerber.layers} layers, ${r.specs.gerber.drill_hits} holes, ${r.specs.gerber.files} Gerber files${(r.specs.width_mm !== r.specs.gerber.width_mm || r.specs.height_mm !== r.specs.gerber.height_mm || r.specs.layers !== r.specs.gerber.layers) ? ' — <b style="color:var(--amber)">differs from the ordered spec, check before quoting</b>' : ''}</div>
      ${(r.specs.gerber.warnings || []).map((w) => `<div class="small" style="color:var(--amber)">⚠ ${esc(w)}</div>`).join('')}</div>` : ''}
    ${r.specs.drawing ? `<div class="card flat" style="margin-top:12px"><b>Drawing (DXF)</b><div class="lz-preview" style="margin-top:8px;min-height:220px;color:#94a3b8"><img id="dxfimg" alt="DXF preview" style="max-width:100%;max-height:320px"></div>
      <div class="small" style="margin-top:6px">${r.specs.drawing.width_mm} × ${r.specs.drawing.height_mm} mm (file unit ${esc(r.specs.drawing.unit)}) · cut ${r.specs.drawing.cut_length_m} m · ${r.specs.drawing.pierces} pierces · part area ${r.specs.drawing.part_area_cm2} cm²${r.specs.drawing.open_paths ? ` · <b style="color:var(--amber)">${r.specs.drawing.open_paths} open lines</b>` : ''}</div>
      ${(r.specs.drawing.warnings || []).map((w) => `<div class="small" style="color:var(--amber)">⚠ ${esc(w)}</div>`).join('')}</div>` : ''}
    ${r.specs.model ? `<div class="card flat" style="margin-top:12px"><div class="row between"><b>3D model</b><button type="button" class="btn sm" id="m3load">🧊 Show 3D view</button></div>
      <div class="small" style="margin-top:4px">${esc(r.specs.model.file)}: <b>${r.specs.model.size_mm.join(' × ')} mm</b> · ${r.specs.model.volume_cm3} cm³ · surface ${r.specs.model.area_cm2} cm² · ${Number(r.specs.model.triangles).toLocaleString('en-IN')} triangles · ${r.specs.model.closed === false ? '<b style="color:var(--amber)">not watertight — repair before printing</b>' : 'watertight'}</div>
      ${(r.specs.model.warnings || []).map((w) => `<div class="small" style="color:var(--amber)">⚠ ${esc(w)}</div>`).join('')}
      <div id="m3s" class="m3-stage hidden" style="margin-top:8px;height:320px"></div></div>` : ''}
    ${r.files.length ? `<div class="card flat" style="margin-top:12px"><b>Files</b>${r.files.map((f, i) => `<div class="row between small"><span>📎 ${esc(f.name)} <span class="muted">(${(f.size / 1048576).toFixed(2)} MB)</span></span><button class="btn sm" data-f="${i}">Download</button></div>`).join('')}</div>` : ''}
    <form class="form two" id="qf" style="margin-top:12px"><label class="f">Final price ₹ incl. GST<input name="quoted_price" type="number" step="0.01" value="${r.quoted_price ?? Math.round(r.estimate)}"></label>
      <label class="f">Lead time (days)<input name="lead_days" type="number" value="${r.lead_days ?? ''}"></label>
      <label class="f full">Internal notes<textarea name="staff_notes" rows="2">${esc(r.staff_notes || '')}</textarea></label>
      <div class="full row"><button type="button" class="btn" id="save">Save</button>${next.map((s) => `<button type="button" class="btn ${s === 'cancelled' ? 'danger' : 'primary'}" data-to="${s}">${s === 'quoted' ? '📨 Send quote on WhatsApp' : s === 'approved' ? 'Mark approved (customer said yes)' : s === 'in_production' ? '⚙️ Start production' : s === 'ready' ? '✅ Mark ready' : s === 'delivered' ? '📦 Delivered' : 'Cancel'}</button>`).join('')}</div></form>`, { wide: true });
  if (r.specs.gerber) {
    const urls = {};
    const showSide = async (side) => {
      try {
        if (!urls[side]) { const t = getToken(); const resp = await fetch(`/api${B}/services/${r.id}/gerber/${side}`, { headers: { Authorization: `Bearer ${t}` } }); if (!resp.ok) throw new Error('Render not available'); urls[side] = URL.createObjectURL(await resp.blob()); }
        $('#gimg', m.el).src = urls[side]; $$('[data-gs]', m.el).forEach((x) => x.classList.toggle('on', x.dataset.gs === side));
      } catch (e) { toast(e.message, 'err'); }
    };
    $$('[data-gs]', m.el).forEach((b) => { b.onclick = () => showSide(b.dataset.gs); }); showSide('top');
  }
  if (r.specs.drawing) fetch(`/api${B}/services/${r.id}/dxf`, { headers: { Authorization: `Bearer ${getToken()}` } }).then((x) => (x.ok ? x.blob() : null)).then((b) => { if (b && $('#dxfimg', m.el)) $('#dxfimg', m.el).src = URL.createObjectURL(b); });
  if (r.specs.model) $('#m3load', m.el).onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true; b.innerHTML = '<span class="spinner"></span> Loading…';
    try { const d = await api(`${B}/services/${r.id}/model`); $('#m3s', m.el).classList.remove('hidden'); await mountModel3d($('#m3s', m.el), d.mesh, { colour: r.specs.colour }); b.remove(); } catch (err) { toast(err.message, 'err'); b.disabled = false; b.textContent = '🧊 Show 3D view'; }
  };
  $$('[data-f]', m.el).forEach((b) => { b.onclick = () => downloadAuthed(`${B}/services/${r.id}/files/${b.dataset.f}`, r.files[b.dataset.f].name).catch((e) => toast(e.message, 'err')); });
  const send = async (status) => {
    try {
      const out = await api(`${B}/services/${r.id}`, { method: 'PUT', body: { ...formData($('#qf', m.el)), ...(status ? { status } : {}) } });
      toast(status ? `${r.req_no} → ${SVC_LABEL[status]}${out.whatsapp ? (out.whatsapp.ok ? (out.whatsapp.simulated ? ' · WhatsApp simulated' : ' · customer notified on WhatsApp') : ` · WhatsApp failed: ${out.whatsapp.error}`) : ''}` : 'Saved', out.whatsapp && !out.whatsapp.ok ? 'err' : 'ok');
      m.close(); reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  $('#save', m.el).onclick = () => send(null);
  $$('[data-to]', m.el).forEach((b) => { b.onclick = () => (b.dataset.to === 'cancelled' && !confirm('Cancel this request? The customer is told on WhatsApp.') ? null : send(b.dataset.to)); });
}

startPanel({
  scope: 'stockist', title: 'Stockist Panel', roles: ['stockist'],
  demo: 'Stockist accounts are created by the owner in Master → Users & roles.',
  switchLink: { href: '/master', label: '🛡️ Master panel' },
  nav: [
    { id: 'dashboard', label: 'Overview', icon: '📊' }, { id: 'orders', label: 'Orders & dispatch', icon: '📦' },
    { id: 'jobs', label: 'Custom orders', icon: '🛠️' }, { id: 'services', label: 'Service orders', icon: '🖨️' },
    { id: 'scan', label: 'Scan stock in / out', icon: '📷' },
    { id: 'products', label: 'Products & stock', icon: '🗃️' }, { id: 'categories', label: 'Categories & SKU codes', icon: '🗂️' },
    { id: 'labels', label: 'Labels & stickers', icon: '🏷️' }, { id: 'imports', label: 'Import batches', icon: '🚢' },
    { id: 'reorder', label: 'Reorder planning', icon: '📈' }, { id: 'suppliers', label: 'Suppliers', icon: '🏭' },
  ],
  pages: { dashboard, orders, jobs, services, scan, products, categories, labels, imports, reorder, suppliers },
});
