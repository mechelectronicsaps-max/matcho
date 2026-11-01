// Drovox master panel: analytics, orders, CRM, marketing, GST, WhatsApp, users, audit, automation and settings.
import { $, $$, api, esc, money, num, toast, modal, badge, ago, dt, formData, barChart, rankBars, downloadCsv } from './common.js';
import { startPanel, head, kpi } from './panel.js';
import { openOrder } from './orders-ui.js';

const A = '/admin';
const SEG = { champion: ['green', 'Champions'], loyal: ['teal', 'Loyal'], recent: ['blue', 'Recent'], at_risk: ['amber', 'At risk'], lost: ['red', 'Lost'], new: ['', 'New'], browser: ['violet', 'Browsers'] };
const STOCK = { out: ['red', 'Out'], critical: ['red', 'Critical'], low: ['amber', 'Low'], ok: ['green', 'OK'] };
const delta = (v) => (v == null ? '' : `<span class="delta ${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '▲' : '▼'} ${Math.abs(v)}%</span> vs previous period`);

// ------------------------------------------------------------------ dashboard / analytics
async function dashboard(el, params) {
  const days = Number(params.get('days') || 30);
  const d = await api(`${A}/dashboard?days=${days}`);
  const k = d.kpis; const f = d.funnel;
  const step = (a, b) => (a ? `${Math.round((b / a) * 100)}%` : '—');
  el.innerHTML = `${head('Business dashboard', `<div class="row">${[7, 30, 90, 365].map((n) => `<a class="chip ${n === days ? 'on' : ''}" href="#/dashboard?days=${n}">${n === 365 ? '12 months' : `${n} days`}</a>`).join('')}</div>`)}
    <div class="grid g4">${kpi('Revenue (incl. GST)', money(k.revenue), delta(k.revenue_change))}${kpi('Orders', num(k.orders), delta(k.orders_change))}${kpi('Avg. order value', money(k.aov))}${kpi('Gross margin', `${k.gross_margin_pct}%`, `${money(k.gross_profit)} gross profit on net sales`)}</div>
    <div class="grid g4" style="margin-top:16px">${kpi('Conversion', `${k.conversion_pct}%`, 'sessions → purchase')}${kpi('Repeat customers', `${k.repeat_rate_pct}%`, `${k.buyers} buyers · ${k.new_customers} new signups`)}${kpi('Awaiting fulfilment', k.pending_fulfilment, '<a class="link" href="#/orders?status=confirmed">open orders →</a>')}${kpi('Open leads', k.open_leads, '<a class="link" href="#/crm">CRM pipeline →</a>')}</div>
    <div class="grid g2" style="margin-top:16px;grid-template-columns:minmax(0,1.7fr) minmax(0,1fr)">
      <div class="card"><h3>Daily revenue</h3>${barChart(d.daily.map((x) => ({ label: x.day.slice(5), value: x.revenue })), { height: 200, fmt: (v) => money(v) })}</div>
      <div class="card"><h3>Conversion funnel</h3><div class="small muted" style="margin-bottom:8px">Unique sessions, last ${days} days</div>
        ${rankBars([{ label: 'Viewed', value: f.view }, { label: `Carted ${step(f.view, f.add_to_cart)}`, value: f.add_to_cart }, { label: `Checkout ${step(f.add_to_cart, f.checkout)}`, value: f.checkout }, { label: `Bought ${step(f.checkout, f.purchase)}`, value: f.purchase }])}<div class="tiny muted" style="margin-top:8px">Percentages are step-to-step conversion.</div></div>
    </div>
    <div class="grid g3" style="margin-top:16px">
      <div class="card"><h3>🔥 Trending now</h3><div class="small muted" style="margin-bottom:6px">Time-decayed score from views, carts and sales (3-day half-life)</div>
        <div class="table-wrap"><table class="t"><thead><tr><th>Product</th><th class="r">Sold 7d</th><th class="r">Trend</th><th class="r">Stock</th></tr></thead><tbody>${d.trending.map((p) => `<tr><td class="small">${esc(p.name.slice(0, 34))}</td><td class="r">${p.sold_7d}</td><td class="r"><span class="delta ${p.growth_pct >= 0 ? 'up' : 'down'}">${p.growth_pct >= 0 ? '▲' : '▼'}${Math.abs(p.growth_pct)}%</span></td><td class="r">${p.stock}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="card"><h3>Top products by revenue</h3>${rankBars(d.top_products.map((p) => ({ label: p.name, value: p.revenue })), { fmt: (v) => money(v) })}</div>
      <div class="card"><h3>⚠️ Trending stock running low</h3>${d.low_stock.map((x) => `<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--line)"><div class="small"><b>${esc(x.name.slice(0, 32))}</b><div class="tiny muted">${x.stock} left · ${x.velocity_per_day}/day${x.days_of_cover != null ? ` · ${x.days_of_cover}d cover` : ''}${x.suggested_reorder_qty ? ` · reorder ${x.suggested_reorder_qty}` : ''}</div></div><span class="badge ${STOCK[x.status][0]}">${STOCK[x.status][1]}</span></div>`).join('') || '<p class="muted">All good</p>'}</div>
    </div>
    <div class="grid g3" style="margin-top:16px">
      <div class="card"><h3>Revenue by category</h3>${rankBars(d.by_category.map((c) => ({ label: c.name, value: c.revenue })), { fmt: (v) => money(v) })}</div>
      <div class="card"><h3>Top states</h3>${rankBars(d.by_state.map((s) => ({ label: s.state, value: s.revenue })), { fmt: (v) => money(v) })}</div>
      <div class="card"><h3>Orders by hour (IST)</h3>${barChart(Array.from({ length: 24 }, (_, h) => ({ label: String(h), value: d.hourly.find((x) => x.hour === h)?.orders || 0 })), { height: 150 })}
        <div class="small muted">Payment mix: ${d.by_payment.map((p) => `${esc(p.method.toUpperCase())} ${p.orders}`).join(' · ')}</div></div>
    </div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Top searches</h3><div class="small muted">What customers look for — stock what they can't find</div>${rankBars(d.top_searches.map((s) => ({ label: s.q, value: s.n })))}</div>
      <div class="card"><h3>Order status (period)</h3>${d.by_status.map((s) => `<div class="row between" style="padding:4px 0">${badge(s.status, s.label)}<b>${s.n}</b></div>`).join('')}</div>
    </div>`;
}

// ------------------------------------------------------------------ orders
async function orders(el, params) {
  const p = Object.fromEntries(params);
  const rows = await api(`${A}/orders?${new URLSearchParams(p)}`);
  el.innerHTML = `${head('All orders', '<button class="btn" id="csv">⬇ Export CSV</button>')}
    <form class="card flat row" id="of" style="margin-bottom:14px"><input name="q" placeholder="Order, invoice, name, phone" value="${esc(p.q || '')}" style="flex:2;min-width:180px">
      <select name="status" style="flex:1;min-width:140px"><option value="">All statuses</option>${['pending_payment', 'confirmed', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'returned'].map((s) => `<option ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select name="payment" style="flex:1;min-width:120px"><option value="">All payments</option>${['razorpay', 'cod', 'test'].map((s) => `<option ${p.payment === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <input type="date" name="from" value="${esc(p.from || '')}" style="flex:1;min-width:130px"><input type="date" name="to" value="${esc(p.to || '')}" style="flex:1;min-width:130px"><button class="btn primary">Filter</button></form>
    <div class="small muted" style="margin-bottom:8px">${rows.length} orders · ${money(rows.filter((o) => !['cancelled', 'pending_payment', 'returned'].includes(o.status)).reduce((s, o) => s + o.total, 0))} billed</div>
    <div class="card table-wrap"><table class="t"><thead><tr><th>Order</th><th>Invoice</th><th>Customer</th><th>Total</th><th>Payment</th><th>Status</th><th>Placed</th></tr></thead><tbody>
    ${rows.map((o) => `<tr class="click" data-o="${o.id}"><td><b>${esc(o.order_no)}</b></td><td class="small">${esc(o.invoice_no || '—')}</td><td>${esc(o.ship_name)}<div class="tiny muted">${esc(o.ship_phone)}</div></td><td>${money(o.total)}</td><td><span class="badge ${o.payment_status === 'paid' ? 'green' : o.payment_status === 'refunded' ? 'red' : 'amber'}">${esc(o.payment_method)} · ${esc(o.payment_status)}</span></td><td>${badge(o.status, o.status_label)}</td><td class="small">${dt(o.created_at)}</td></tr>`).join('')}</tbody></table></div>`;
  $('#of').onsubmit = (e) => { e.preventDefault(); const f = Object.fromEntries(Object.entries(formData(e.target)).filter(([, v]) => v)); location.hash = `#/orders?${new URLSearchParams(f)}`; };
  $$('[data-o]', el).forEach((r) => { r.onclick = () => openOrder(A, r.dataset.o, () => orders(el, params)); });
  $('#csv').onclick = () => downloadCsv('drovox-orders.csv', rows.map(({ status_label, id, ...r }) => r));
}

// ------------------------------------------------------------------ customers (CRM 360)
async function customers(el, params) {
  const seg = params.get('segment') || '';
  const d = await api(`${A}/customers${seg ? `?segment=${seg}` : ''}`);
  el.innerHTML = `${head('Customers', '<button class="btn" id="csv">⬇ CSV</button>')}
    <p class="small muted">RFM segments: <b>Champions</b> 3+ orders & bought in 45 days · <b>Loyal</b> 2+ orders in 90 days · <b>Recent</b> bought in 30 days · <b>At risk</b> 30–120 days quiet · <b>Lost</b> 120+ days · <b>Browsers</b> visited, never bought. Use them as campaign audiences.</p>
    <div class="row" style="margin-bottom:12px"><a class="chip ${!seg ? 'on' : ''}" href="#/customers">All</a>${Object.entries(SEG).map(([k, [, l]]) => `<a class="chip ${seg === k ? 'on' : ''}" href="#/customers?segment=${k}">${l} <b>${d.counts[k] || 0}</b></a>`).join('')}</div>
    <div class="card table-wrap"><table class="t"><thead><tr><th>Customer</th><th>Segment</th><th class="r">Orders</th><th class="r">Lifetime spend</th><th class="r">AOV</th><th class="r">Last order</th><th class="r">Points</th></tr></thead><tbody>
    ${d.rows.map((c) => `<tr class="click" data-c="${c.id}"><td><b>${esc(c.name)}</b><div class="tiny muted">${esc(c.email)} · ${esc(c.phone || '')}</div></td><td><span class="badge ${SEG[c.segment][0]}">${SEG[c.segment][1]}</span></td><td class="r">${c.orders}</td><td class="r">${money(c.spend)}</td><td class="r">${money(c.aov)}</td><td class="r small">${c.days_since_order == null ? '—' : `${c.days_since_order}d ago`}</td><td class="r">${num(c.points)}</td></tr>`).join('')}</tbody></table></div>`;
  $('#csv').onclick = () => downloadCsv('drovox-customers.csv', d.rows.map(({ id, ...r }) => r));
  $$('[data-c]', el).forEach((r) => { r.onclick = () => customer360(r.dataset.c, () => customers(el, params)); });
}
async function customer360(id, reload) {
  const c = await api(`${A}/customers/${id}`);
  const s = c.segment || {};
  const m = modal(`<div class="row between"><div><h2 style="margin:0">${esc(c.user.name)}</h2><div class="small muted">${esc(c.user.email)} · ${esc(c.user.phone || 'no phone')} · since ${dt(c.user.created_at, false)} · code ${esc(c.user.referral_code)}</div></div>${s.segment ? `<span class="badge ${SEG[s.segment][0]}">${SEG[s.segment][1]}</span>` : ''}</div>
    <div class="grid g4" style="margin-top:12px">${kpi('Orders', s.orders || 0)}${kpi('Spend', money(s.spend))}${kpi('AOV', money(s.aov))}${kpi('Points', num(c.user.points))}</div>
    <div class="grid g2" style="margin-top:12px">
      <div class="card flat"><h3>Orders</h3>${c.orders.slice(0, 8).map((o) => `<div class="row between small" style="padding:3px 0"><span>${esc(o.order_no)} · ${dt(o.created_at, false)}</span><span>${money(o.total)} ${badge(o.status, o.status_label)}</span></div>`).join('') || '<div class="muted small">No orders</div>'}</div>
      <div class="card flat"><h3>Favourite products</h3>${c.favourite_products.map((p) => `<div class="small">${p.qty}× ${esc(p.name)}</div>`).join('') || '<div class="muted small">—</div>'}<h3 style="margin-top:10px">Cart now</h3><div class="small">${c.cart.length ? `${c.cart.length} items waiting` : 'Empty'}</div></div>
    </div>
    <div class="grid g2" style="margin-top:12px">
      <form class="card flat form" id="wa"><h3>💬 WhatsApp</h3><textarea name="message" rows="3" placeholder="Hi ${esc(c.user.name.split(' ')[0])}, …"></textarea><button class="btn primary" ${c.user.phone ? '' : 'disabled'}>Send WhatsApp</button>
        <div class="tiny muted">${c.messages.slice(0, 4).map((x) => `${ago(x.created_at)} · ${esc(x.status)} · ${esc(x.body.slice(0, 60))}`).join('<br>')}</div></form>
      <form class="card flat form" id="pts"><h3>⭐ Adjust points</h3><input name="change" type="number" placeholder="+100 or -50" required><input name="reason" placeholder="Reason (goodwill, correction…)"><button class="btn">Apply</button></form>
    </div>`, { wide: true });
  $('#wa', m.el).onsubmit = async (e) => { e.preventDefault(); const r = await api(`${A}/whatsapp/test`, { method: 'POST', body: { to: c.user.phone, message: formData(e.target).message } }); toast(r.ok ? (r.simulated ? 'Logged in outbox (WhatsApp not configured — simulated)' : 'WhatsApp sent') : r.error, r.ok ? 'ok' : 'err'); };
  $('#pts', m.el).onsubmit = async (e) => { e.preventDefault(); try { const r = await api(`${A}/users/${id}/points`, { method: 'POST', body: formData(e.target) }); toast(`Balance now ${r.points}`); m.close(); reload(); } catch (err) { toast(err.message, 'err'); } };
}

// ------------------------------------------------------------------ CRM pipeline
async function crm(el) {
  const d = await api(`${A}/leads`);
  const label = { new: 'New', contacted: 'Contacted', qualified: 'Qualified', proposal: 'Proposal sent', won: 'Won', lost: 'Lost' };
  const src = { bulk_quote: '📦 bulk quote', ai_builder: '✨ AI builder', website: '🌐 website', whatsapp: '💬 WhatsApp', referral: '🤝 referral', manual: '✍️ manual' };
  const today = new Date().toISOString().slice(0, 10);
  el.innerHTML = `${head('CRM — leads pipeline', '<button class="btn" id="csv">⬇ CSV</button><button class="btn primary" id="new">+ New lead</button>')}
    <div class="grid g4" style="margin-bottom:16px">${kpi('Open pipeline', money(d.pipeline.filter((p) => !['won', 'lost'].includes(p.stage)).reduce((s, p) => s + p.value, 0)))}${kpi('Won', money(d.pipeline.find((p) => p.stage === 'won').value))}
      ${kpi('Win rate', (() => { const w = d.pipeline.find((p) => p.stage === 'won').count; const l = d.pipeline.find((p) => p.stage === 'lost').count; return w + l ? `${Math.round((w / (w + l)) * 100)}%` : '—'; })())}${kpi('Follow-ups due', d.rows.filter((r) => r.next_followup && r.next_followup <= today && !['won', 'lost'].includes(r.stage)).length)}</div>
    <div class="kanban">${d.stages.map((s) => { const p = d.pipeline.find((x) => x.stage === s); return `<div class="col"><h4><span>${label[s]}</span><span>${p.count}</span></h4><div class="tiny muted">${money(p.value)}</div>
      ${d.rows.filter((r) => r.stage === s).map((r) => `<div class="lead" data-l="${r.id}"><b>${esc(r.name)}</b>${r.company ? `<div class="tiny muted">${esc(r.company)}</div>` : ''}<div class="tiny">${esc((r.interest || '').slice(0, 70))}</div>
        <div class="row between" style="margin-top:6px"><span class="tiny">${src[r.source] || esc(r.source)}</span><span class="badge ${r.score >= 60 ? 'green' : r.score >= 35 ? 'amber' : ''}" title="Lead score">${r.score}</span></div>
        <div class="row between tiny muted"><span>${money(r.value_estimate)}</span>${r.next_followup ? `<span style="color:${r.next_followup <= today ? 'var(--red)' : 'inherit'}">📅 ${esc(r.next_followup)}</span>` : ''}</div></div>`).join('')}</div>`; }).join('')}</div>`;
  $('#csv').onclick = () => downloadCsv('drovox-leads.csv', d.rows);
  const open = async (lead) => {
    const acts = lead ? await api(`${A}/leads/${lead.id}/activities`) : [];
    const l = lead || { stage: 'new', source: 'manual' };
    const m = modal(`<h2>${lead ? esc(l.name) : 'New lead'}</h2>${lead ? `<div class="small muted">Score ${l.score}/100 · source ${esc(l.source)} · created ${dt(l.created_at, false)}</div>` : ''}
      <form class="form two" id="lf" style="margin-top:12px"><label class="f">Name<input name="name" required value="${esc(l.name || '')}"></label><label class="f">Company<input name="company" value="${esc(l.company || '')}"></label>
        <label class="f">Phone<input name="phone" value="${esc(l.phone || '')}"></label><label class="f">Email<input name="email" value="${esc(l.email || '')}"></label>
        <label class="f">Stage<select name="stage">${d.stages.map((s) => `<option value="${s}" ${s === l.stage ? 'selected' : ''}>${label[s]}</option>`).join('')}</select></label>
        <label class="f">Estimated value (₹)<input name="value_estimate" type="number" value="${l.value_estimate || 0}"></label>
        <label class="f">Owner<select name="owner_id">${d.staff.map((s) => `<option value="${s.id}" ${s.id === l.owner_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <label class="f">Next follow-up<input name="next_followup" type="date" value="${esc((l.next_followup || '').slice(0, 10))}"></label>
        ${lead ? '' : `<label class="f">Source<select name="source">${Object.keys(src).map((s) => `<option value="${s}">${s}</option>`).join('')}</select></label>`}
        <label class="f full">Interest / requirement<textarea name="interest" rows="2">${esc(l.interest || '')}</textarea></label>
        <label class="f full">Notes<textarea name="notes" rows="2">${esc(l.notes || '')}</textarea></label><button class="btn primary full">${lead ? 'Save' : 'Create lead'}</button></form>
      ${lead ? `<hr class="sep"><h3>Activity</h3><form class="row" id="af" style="flex-wrap:nowrap"><select name="type" style="width:130px"><option value="note">Note</option><option value="call">Call log</option><option value="whatsapp">WhatsApp</option><option value="email">Email log</option></select><input name="content" placeholder="Add a note or message…" required><button class="btn">Add</button></form>
        <ul class="timeline" style="margin-top:12px">${acts.map((a) => `<li><b>${esc(a.type)}</b> — ${esc(a.content)}<div class="tiny muted">${esc(a.user || '')} · ${ago(a.created_at)}</div></li>`).join('')}</ul>` : ''}`, { wide: true });
    $('#lf', m.el).onsubmit = async (e) => { e.preventDefault(); try { await api(lead ? `${A}/leads/${lead.id}` : `${A}/leads`, { method: lead ? 'PUT' : 'POST', body: formData(e.target) }); toast('Lead saved'); m.close(); crm(el); } catch (err) { toast(err.message, 'err'); } };
    $('#af', m.el)?.addEventListener('submit', async (e) => { e.preventDefault(); try { const r = await api(`${A}/leads/${lead.id}/activities`, { method: 'POST', body: formData(e.target) }); if (r.whatsapp) toast(r.whatsapp.ok ? 'WhatsApp sent' : r.whatsapp.error, r.whatsapp.ok ? 'ok' : 'err'); m.close(); crm(el); open({ ...lead, ...(await api(`${A}/leads`)).rows.find((x) => x.id === lead.id) }); } catch (err) { toast(err.message, 'err'); } });
  };
  $('#new').onclick = () => open(null);
  $$('[data-l]', el).forEach((c) => { c.onclick = () => open(d.rows.find((r) => r.id === Number(c.dataset.l))); });
}

// ------------------------------------------------------------------ marketing
async function marketing(el, params) {
  const tab = params.get('tab') || 'coupons';
  const tabs = [['coupons', '🏷️ Coupons'], ['campaigns', '📣 WhatsApp campaigns'], ['carts', '🛒 Abandoned carts'], ['referrals', '🤝 Referrals & loyalty'], ['ai', '✨ AI builder insights']];
  el.innerHTML = `${head('Marketing tools')}<div class="tabs">${tabs.map(([t, l]) => `<a href="#/marketing?tab=${t}" class="${t === tab ? 'on' : ''}">${l}</a>`).join('')}</div><div id="mt"></div>`;
  const mt = $('#mt');
  if (tab === 'coupons') {
    const rows = await api(`${A}/coupons`);
    mt.innerHTML = `<div class="grid g2" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)"><div class="card table-wrap"><table class="t"><thead><tr><th>Code</th><th>Offer</th><th class="r">Used</th><th class="r">Discount given</th><th class="r">Revenue</th><th>Active</th></tr></thead><tbody>
      ${rows.map((c) => `<tr><td class="code">${esc(c.code)}</td><td class="small">${esc(c.description || `${c.type} ${c.value}`)}${c.min_order ? `<div class="tiny muted">min ${money(c.min_order)}</div>` : ''}</td><td class="r">${c.used}${c.max_uses ? `/${c.max_uses}` : ''}</td><td class="r">${money(c.given)}</td><td class="r">${money(c.revenue)}</td><td><input type="checkbox" data-c="${c.id}" ${c.active ? 'checked' : ''}></td></tr>`).join('')}</tbody></table></div>
      <form class="card form" id="cf"><h3>Create coupon</h3><label class="f">Code<input name="code" required placeholder="MAKER20" style="text-transform:uppercase"></label>
        <label class="f">Type<select name="type"><option value="percent">% off</option><option value="flat">Flat ₹ off</option><option value="free_ship">Free shipping</option></select></label>
        <div class="form two"><label class="f">Value<input name="value" type="number" value="10"></label><label class="f">Max discount ₹<input name="max_discount" type="number"></label>
        <label class="f">Min order ₹<input name="min_order" type="number" value="0"></label><label class="f">Total uses<input name="max_uses" type="number"></label>
        <label class="f">Uses per customer<input name="per_user" type="number" value="1"></label><label class="f">Expires<input name="expires_at" type="date"></label></div>
        <label class="check"><input type="checkbox" name="first_order_only"> First order only</label><label class="f">Description (shown to customers)<input name="description"></label><button class="btn primary">Create</button></form></div>`;
    $$('[data-c]', mt).forEach((c) => { c.onchange = async () => { await api(`${A}/coupons/${c.dataset.c}`, { method: 'PUT', body: { active: c.checked } }); toast('Coupon updated'); }; });
    $('#cf').onsubmit = async (e) => { e.preventDefault(); try { await api(`${A}/coupons`, { method: 'POST', body: formData(e.target) }); toast('Coupon created'); marketing(el, params); } catch (err) { toast(err.message, 'err'); } };
  } else if (tab === 'campaigns') {
    const d = await api(`${A}/campaigns`);
    mt.innerHTML = `<div class="grid g2" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)"><div class="card table-wrap"><table class="t"><thead><tr><th>Campaign</th><th>Audience</th><th class="r">Sent</th><th>Status</th><th></th></tr></thead><tbody>
      ${d.rows.map((c) => `<tr><td><b>${esc(c.name)}</b><div class="tiny muted">${esc(c.message.slice(0, 80))}</div></td><td>${esc(SEG[c.segment]?.[1] || 'Everyone')}</td><td class="r">${c.sent_count}</td><td><span class="badge ${c.status === 'sent' ? 'green' : ''}">${esc(c.status)}</span>${c.sent_at ? `<div class="tiny muted">${ago(c.sent_at)}</div>` : ''}</td><td>${c.status !== 'sent' ? `<button class="btn sm primary" data-send="${c.id}">Send now</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No campaigns yet</td></tr>'}</tbody></table></div>
      <form class="card form" id="cf"><h3>New WhatsApp campaign</h3><label class="f">Name<input name="name" required placeholder="Weekend drone sale"></label>
        <label class="f">Audience<select name="segment">${d.segments.map((s) => `<option value="${s.segment}">${s.segment === 'all' ? 'All opted-in customers' : SEG[s.segment][1]} (${s.recipients})</option>`).join('')}</select></label>
        <label class="f">Message<textarea name="message" rows="5" required>Hi {name}! 🚁 This weekend only: 15% off drone parts with code DRONE15. You also have {points} Drovox points to use. Shop now: </textarea></label>
        <div class="tiny muted">Placeholders: {name}, {points}. Marketing messages outside a 24-hour customer window need an approved WhatsApp template.</div>
        <label class="f">Coupon to promote (optional)<input name="coupon_code"></label><button class="btn primary">Save campaign</button></form></div>`;
    $('#cf').onsubmit = async (e) => { e.preventDefault(); try { await api(`${A}/campaigns`, { method: 'POST', body: formData(e.target) }); toast('Campaign saved — press Send when ready'); marketing(el, params); } catch (err) { toast(err.message, 'err'); } };
    $$('[data-send]', mt).forEach((b) => { b.onclick = async () => { if (!confirm('Send this campaign now?')) return; b.disabled = true; const r = await api(`${A}/campaigns/${b.dataset.send}/send`, { method: 'POST' }); toast(`Sent to ${r.sent} of ${r.recipients} customers`); marketing(el, params); }; });
  } else if (tab === 'carts') {
    const rows = await api(`${A}/abandoned-carts`);
    mt.innerHTML = `<div class="banner brand" style="margin-bottom:14px"><div>Automation sends a WhatsApp reminder with a comeback coupon to carts left alone for the configured number of hours (Settings → Engagement).</div><button class="btn primary sm" id="run">Run recovery now</button></div>
      <div class="card table-wrap"><table class="t"><thead><tr><th>Customer</th><th class="r">Items</th><th class="r">Cart value</th><th>Last change</th><th>Reminder</th></tr></thead><tbody>
      ${rows.map((c) => `<tr><td>${esc(c.name)}<div class="tiny muted">${esc(c.phone || '')}</div></td><td class="r">${c.items}</td><td class="r">${money(c.value)}</td><td>${ago(c.updated_at)}</td><td>${c.reminded_at ? `<span class="badge green">sent ${ago(c.reminded_at)}</span>` : '<span class="badge">pending</span>'}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No open carts</td></tr>'}</tbody></table></div>`;
    $('#run').onclick = async () => { const r = await api(`${A}/automation/abandoned_carts`, { method: 'POST' }); toast(r.result); marketing(el, params); };
  } else if (tab === 'referrals') {
    const r = await api(`${A}/referrals`);
    mt.innerHTML = `<div class="grid g4">${kpi('Referrals', r.total)}${kpi('Converted', r.rewarded, r.total ? `${Math.round((r.rewarded / r.total) * 100)}% conversion` : '')}${kpi('Points paid', num(r.points_paid))}${kpi('Points outstanding', num(r.points_outstanding), `liability ≈ ${money(r.points_outstanding)}`)}</div>
      <div class="card" style="margin-top:16px"><h3>Top referrers</h3><table class="t"><thead><tr><th>Customer</th><th>Code</th><th class="r">Referred</th><th class="r">Converted</th></tr></thead><tbody>${r.top.map((t) => `<tr><td>${esc(t.name)}</td><td class="code">${esc(t.referral_code)}</td><td class="r">${t.referrals}</td><td class="r">${t.converted}</td></tr>`).join('')}</tbody></table>
      <p class="small muted">Change point values, tiers, signup/referral bonuses and daily check-in rewards in Settings → Loyalty.</p></div>`;
  } else {
    const rows = await api(`${A}/ai-sessions`);
    mt.innerHTML = `<p class="small muted">Every idea customers type into the AI Project Builder — a direct line into what people want to build. Builds above ₹5,000 from signed-in customers are added to the CRM automatically.</p>
      <div class="card table-wrap"><table class="t"><thead><tr><th>Idea</th><th>Project</th><th class="r">Cart value</th><th>Customer</th><th>Engine</th><th>When</th></tr></thead><tbody>
      ${rows.map((a) => `<tr><td class="small">${esc(a.idea.slice(0, 120))}</td><td class="small">${esc(a.title || '')}</td><td class="r">${money(a.total)}</td><td class="small">${esc(a.name || 'guest')}</td><td><span class="badge ${a.engine === 'claude' ? 'brand' : ''}">${esc(a.engine)}</span></td><td class="small">${ago(a.created_at)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No sessions yet</td></tr>'}</tbody></table></div>`;
  }
}

// ------------------------------------------------------------------ GST
async function gst(el, params) {
  const q = new URLSearchParams(Object.fromEntries(params));
  const g = await api(`${A}/gst?${q}`);
  const s = g.summary;
  el.innerHTML = `${head('GST reports', `<form id="gf" class="row"><input type="date" name="from" value="${g.from}"><input type="date" name="to" value="${g.to}"><button class="btn primary">Apply</button></form>`)}
    <p class="small muted">Seller GSTIN <b>${esc(g.seller.gstin)}</b> (${esc(g.seller.state)}). Same-state sales are split into CGST + SGST; other states are IGST. Figures are prepared for GSTR-1 / GSTR-3B — verify with your CA before filing.</p>
    <div class="grid g4">${kpi('Invoices', s.invoices || 0)}${kpi('Taxable value', money(s.taxable, 2))}${kpi('CGST + SGST', money((s.cgst || 0) + (s.sgst || 0), 2))}${kpi('IGST', money(s.igst, 2))}</div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><div class="row between"><h3>Rate-wise summary</h3></div><table class="t"><thead><tr><th>GST rate</th><th class="r">Taxable</th><th class="r">Tax</th></tr></thead><tbody>${g.rates.map((r) => `<tr><td>${r.rate}%</td><td class="r">${money(r.taxable, 2)}</td><td class="r">${money(r.tax, 2)}</td></tr>`).join('')}
        <tr><td>18% — shipping &amp; COD (SAC 996812)</td><td class="r">${money(g.shipping.taxable, 2)}</td><td class="r">${money(g.shipping.tax, 2)}</td></tr></tbody></table></div>
      <div class="card"><div class="row between"><h3>B2C — state-wise (Table 7)</h3><button class="btn sm" data-csv="b2c">CSV</button></div><div class="table-wrap" style="max-height:300px;overflow-y:auto"><table class="t"><thead><tr><th>Place of supply</th><th class="r">Invoices</th><th class="r">Taxable</th><th class="r">CGST</th><th class="r">SGST</th><th class="r">IGST</th></tr></thead><tbody>
        ${g.b2c.map((r) => `<tr><td>${esc(r.place_of_supply)}-${esc(r.state)}</td><td class="r">${r.invoices}</td><td class="r">${money(r.taxable, 2)}</td><td class="r">${money(r.cgst, 2)}</td><td class="r">${money(r.sgst, 2)}</td><td class="r">${money(r.igst, 2)}</td></tr>`).join('')}</tbody></table></div></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="row between"><h3>HSN summary (Table 12)</h3><button class="btn sm" data-csv="hsn">CSV</button></div><div class="table-wrap"><table class="t"><thead><tr><th>HSN</th><th class="r">Rate</th><th class="r">Qty</th><th class="r">Taxable</th><th class="r">CGST+SGST</th><th class="r">IGST</th></tr></thead><tbody>
      ${g.hsn.map((h) => `<tr><td class="code">${esc(h.hsn)}</td><td class="r">${h.gst_rate}%</td><td class="r">${h.qty}</td><td class="r">${money(h.taxable, 2)}</td><td class="r">${money(h.intra_tax, 2)}</td><td class="r">${money(h.igst, 2)}</td></tr>`).join('')}</tbody></table></div></div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><div class="row between"><h3>B2B invoices (Table 4)</h3><button class="btn sm" data-csv="b2b">CSV</button></div>${g.b2b.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Invoice</th><th>GSTIN</th><th class="r">Taxable</th><th class="r">Tax</th></tr></thead><tbody>${g.b2b.map((b) => `<tr><td class="small">${esc(b.invoice_no)}</td><td class="code">${esc(b.gstin)}</td><td class="r">${money(b.taxable, 2)}</td><td class="r">${money(b.cgst + b.sgst + b.igst, 2)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">No B2B invoices in this period.</p>'}</div>
      <div class="card"><h3>Import IGST (input credit, estimate)</h3><p class="small muted">Import IGST paid on Bill of Entry is claimable as ITC. Estimate = 18% × (assessable value × 1.10 for duty).</p>${g.import_itc.length ? `<table class="t"><tbody>${g.import_itc.map((i) => `<tr><td>${esc(i.ref)}<div class="tiny muted">${esc(i.supplier || '')}</div></td><td class="r">${money(i.assessable)}</td><td class="r"><b>${money(i.est_import_igst)}</b></td></tr>`).join('')}</tbody></table>` : '<p class="muted small">No batches received in this period.</p>'}</div>
    </div>`;
  $('#gf').onsubmit = (e) => { e.preventDefault(); location.hash = `#/gst?${new URLSearchParams(formData(e.target))}`; };
  $$('[data-csv]', el).forEach((b) => { b.onclick = () => downloadCsv(`gst-${b.dataset.csv}-${g.from}-${g.to}.csv`, g[b.dataset.csv]); });
}

// ------------------------------------------------------------------ WhatsApp
async function whatsapp(el) {
  const d = await api(`${A}/notifications`);
  el.innerHTML = `${head('WhatsApp messages', '<a class="btn" href="#/settings?tab=whatsapp">⚙️ Configure API</a>')}
    ${d.configured ? '<div class="banner teal" style="margin-bottom:14px"><div>✅ Connected to WhatsApp Business Cloud API</div></div>' : '<div class="banner brand" style="margin-bottom:14px"><div>⚠️ WhatsApp API not configured — messages are <b>simulated</b> and logged here. Add your Meta phone number ID and access token in Settings → WhatsApp.</div></div>'}
    <div class="grid g2" style="grid-template-columns:minmax(0,1.8fr) minmax(0,1fr)"><div class="card table-wrap"><div class="row" style="margin-bottom:8px">${d.counts.map((c) => `<span class="badge ${c.status === 'sent' ? 'green' : c.status === 'failed' ? 'red' : ''}">${esc(c.status)} ${c.n}</span>`).join('')}</div>
      <table class="t"><thead><tr><th>When</th><th>To</th><th>Message</th><th>Status</th></tr></thead><tbody>${d.rows.map((n) => `<tr><td class="small nowrap">${ago(n.created_at)}</td><td class="small">${esc(n.to_phone)}</td><td class="small">${esc(n.body.slice(0, 140))}${n.error ? `<div style="color:var(--red)" class="tiny">${esc(n.error)}</div>` : ''}</td><td><span class="badge ${n.status === 'sent' ? 'green' : n.status === 'failed' ? 'red' : ''}">${esc(n.status)}</span></td></tr>`).join('')}</tbody></table></div>
      <form class="card form" id="tf"><h3>Send a test</h3><label class="f">To (mobile)<input name="to" required></label><label class="f">Message<textarea name="message" rows="3">Test message from Drovox ✅</textarea></label><button class="btn primary">Send</button>
      <div class="small muted">Automatic messages: order confirmed, packed, shipped (with AWB), out for delivery, delivered (+points), cancelled, back-in-stock, abandoned cart, campaigns, CRM follow-ups, daily low-stock digest to the store number.</div></form></div>`;
  $('#tf').onsubmit = async (e) => { e.preventDefault(); const r = await api(`${A}/whatsapp/test`, { method: 'POST', body: formData(e.target) }); toast(r.ok ? (r.simulated ? 'Simulated (API not configured)' : 'Sent') : r.error, r.ok ? 'ok' : 'err'); whatsapp(el); };
}

// ------------------------------------------------------------------ users & roles
async function users(el, params) {
  const role = params.get('role') || '';
  const rows = await api(`${A}/users?role=${role}`);
  const ROLE = { admin: ['brand', 'Full access'], marketing: ['violet', 'Dashboard, marketing, CRM, customers'], support: ['blue', 'Orders, CRM, customers, WhatsApp'], stockist: ['teal', 'Stockist panel'], customer: ['', 'Storefront'] };
  el.innerHTML = `${head('Users & roles', '<button class="btn primary" id="new">+ Add user</button>')}
    <div class="row" style="margin-bottom:12px"><a class="chip ${!role ? 'on' : ''}" href="#/users">All</a>${Object.keys(ROLE).map((r) => `<a class="chip ${r === role ? 'on' : ''}" href="#/users?role=${r}">${r}</a>`).join('')}</div>
    <div class="card table-wrap"><table class="t"><thead><tr><th>User</th><th>Role</th><th>Access</th><th class="r">Orders</th><th>Last seen</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map((u) => `<tr><td><b>${esc(u.name)}</b><div class="tiny muted">${esc(u.email)} · ${esc(u.phone || '')}</div></td><td><span class="badge ${ROLE[u.role][0]}">${u.role}</span></td><td class="small muted">${ROLE[u.role][1]}</td><td class="r">${u.orders}</td><td class="small">${u.last_seen ? ago(u.last_seen) : '—'}</td><td>${u.active ? '<span class="badge green">active</span>' : '<span class="badge red">disabled</span>'}</td><td><button class="btn sm" data-u="${u.id}">Edit</button></td></tr>`).join('')}</tbody></table></div>`;
  const form = (u) => `<form class="form two">${u ? '' : '<label class="f">Name<input name="name" required></label><label class="f">Email<input name="email" type="email" required></label>'}
    <label class="f">Phone<input name="phone" value="${esc(u?.phone || '')}"></label><label class="f">Role<select name="role">${Object.keys(ROLE).map((r) => `<option ${u?.role === r || (!u && r === 'stockist') ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
    <label class="f">${u ? 'Reset password (optional)' : 'Password'}<input name="password" type="password" ${u ? '' : 'required'} minlength="6"></label>${u ? `<label class="check"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Account active</label>` : '<div></div>'}<button class="btn primary full">${u ? 'Save' : 'Create user'}</button></form>`;
  const edit = (u) => {
    const m = modal(`<h2>${u ? esc(u.name) : 'Add user'}</h2>${form(u)}`);
    $('form', m.el).onsubmit = async (e) => { e.preventDefault(); const f = formData(e.target); if (!f.password) delete f.password; try { await api(u ? `${A}/users/${u.id}` : `${A}/users`, { method: u ? 'PUT' : 'POST', body: f }); toast('Saved'); m.close(); users(el, params); } catch (err) { toast(err.message, 'err'); } };
  };
  $('#new').onclick = () => edit(null);
  $$('[data-u]', el).forEach((b) => { b.onclick = () => edit(rows.find((u) => u.id === Number(b.dataset.u))); });
}

// ------------------------------------------------------------------ audit
async function audit(el, params) {
  const q = params.get('q') || '';
  const d = await api(`${A}/audit?q=${encodeURIComponent(q)}`);
  el.innerHTML = `${head('Audit trail', `<form id="af" class="row"><input name="q" placeholder="Search action, user, order, SKU…" value="${esc(q)}" style="width:260px"><button class="btn">Search</button></form><button class="btn" id="csv">⬇ CSV</button>`)}
    <div class="row" style="margin-bottom:12px">${d.actions.slice(0, 16).map((a) => `<a class="chip" href="#/audit?q=${encodeURIComponent(a.action)}">${esc(a.action)} <b>${a.n}</b></a>`).join('')}</div>
    <div class="card table-wrap"><table class="t"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Details</th><th>IP</th></tr></thead><tbody>
    ${d.rows.map((r) => `<tr><td class="small nowrap">${dt(r.created_at)}</td><td class="small">${esc(r.user_name)}<div class="tiny muted">${esc(r.role)}</div></td><td><span class="code">${esc(r.action)}</span></td><td class="small">${esc(r.entity || '')} ${esc(r.entity_id || '')}</td><td class="tiny" style="max-width:360px;word-break:break-word">${esc((r.details || '').slice(0, 220))}</td><td class="tiny muted">${esc(r.ip || '')}</td></tr>`).join('')}</tbody></table></div>`;
  $('#af').onsubmit = (e) => { e.preventDefault(); location.hash = `#/audit?q=${encodeURIComponent(formData(e.target).q)}`; };
  $('#csv').onclick = () => downloadCsv('drovox-audit.csv', d.rows);
}

// ------------------------------------------------------------------ automation
async function automation(el) {
  const jobs = await api(`${A}/automation`);
  el.innerHTML = `${head('Automation')}
    <div class="card" style="margin-bottom:16px"><h3>Order-to-delivery workflow</h3><ol class="small" style="margin:0;padding-left:18px;line-height:1.9">
      <li><b>Checkout</b> — server re-prices the cart (bulk tiers, coupon, points, GST by place of supply) and reserves stock.</li>
      <li><b>Payment</b> — Razorpay signature/webhook verified, or COD auto-confirmed. Unpaid online orders auto-cancel and release stock.</li>
      <li><b>Billing</b> — a sequential GST invoice number (DRV/FY/#####) is issued on confirmation; customer gets a WhatsApp confirmation.</li>
      <li><b>Fulfilment</b> — stockist sees it in “To pack”, prints the pick list and packing slip, marks packed, then ships with courier + AWB (customer notified with tracking).</li>
      <li><b>Delivery</b> — COD marked collected, loyalty points credited, referral bonus released on the friend's first delivery.</li>
      <li><b>After-sales</b> — cancellations and returns restore stock, refund points and reverse earned points.</li></ol></div>
    <div class="card table-wrap"><table class="t"><thead><tr><th>Background job</th><th>Runs every</th><th>Last run</th><th>Result</th><th></th></tr></thead><tbody>
    ${jobs.map((j) => `<tr><td><b>${esc(j.label)}</b><div class="tiny code">${esc(j.name)}</div></td><td>${j.every_min >= 60 ? `${j.every_min / 60}h` : `${j.every_min} min`}</td><td class="small">${j.last_run ? ago(j.last_run.replace('T', ' ').slice(0, 19)) : 'not yet'}</td><td class="small">${j.ok === false ? `<span style="color:var(--red)">${esc(j.result)}</span>` : esc(j.result || '')}</td><td><button class="btn sm" data-j="${j.name}">Run now</button></td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-j]', el).forEach((b) => { b.onclick = async () => { const r = await api(`${A}/automation/${b.dataset.j}`, { method: 'POST' }); toast(r.result); automation(el); }; });
}

// ------------------------------------------------------------------ settings
const SETTINGS_UI = {
  store: ['Store & GST', { name: 'Store name', tagline: 'Tagline', legal_name: 'Legal name (on invoices)', gstin: 'GSTIN', state_code: 'State code (e.g. 27 = Maharashtra)', address: 'Address', support_phone: 'Support WhatsApp number', support_email: 'Support email', public_url: 'Public website URL' }],
  payments: ['Payments', { razorpay_key_id: 'Razorpay key ID', razorpay_key_secret: 'Razorpay key secret', razorpay_webhook_secret: 'Razorpay webhook secret (webhook URL: /api/webhooks/razorpay)', cod_enabled: 'Enable cash on delivery', test_mode: 'Allow test-mode payments while Razorpay is not configured' }],
  whatsapp: ['WhatsApp', { enabled: 'Enable WhatsApp Cloud API', phone_number_id: 'Phone number ID (Meta)', access_token: 'Permanent access token', api_version: 'Graph API version', use_templates: 'Use approved templates for order updates' }],
  ai: ['AI (Claude)', { enabled: 'Enable AI Project Builder', anthropic_api_key: 'Anthropic API key (or set ANTHROPIC_API_KEY on the server)', model: 'Model' }],
  shipping: ['Shipping', { flat_fee: 'Flat shipping fee ₹', free_above: 'Free shipping above ₹', cod_fee: 'COD handling fee ₹', cod_max_order: 'Max COD order ₹' }],
  courier: ['Courier', { provider: 'Provider (manual / shiprocket)', shiprocket_email: 'Shiprocket email', shiprocket_password: 'Shiprocket password', tracking_url: 'Tracking URL template ({awb})' }],
  loyalty: ['Loyalty & referrals', { earn_per_100: 'Points per ₹100 spent', point_value: '₹ value of 1 point', max_redeem_pct: 'Max % of order payable with points', signup_bonus: 'Signup bonus points', referrer_bonus: 'Referrer bonus (on friend\'s first delivery)', referee_bonus: 'New friend bonus', daily_checkin: 'Daily check-in points', streak_bonus_7: '7-day streak bonus' }],
  engagement: ['Engagement', { welcome_coupon: 'Welcome coupon code', exit_intent: 'Show exit-intent offer to new visitors', social_proof: 'Show real-time social proof on product pages', abandoned_cart_hours: 'Abandoned cart reminder after (hours)', abandoned_cart_coupon: 'Abandoned cart coupon', unpaid_cancel_minutes: 'Cancel unpaid online orders after (minutes)' }],
  inventory: ['Inventory', { safety_days: 'Safety stock (days)', target_cover_days: 'Reorder to cover (days)', low_stock_default: 'Default reorder level' }],
};
async function settings(el, params) {
  const all = await api(`${A}/settings`);
  const tab = params.get('tab') || 'store';
  const [title, fields] = SETTINGS_UI[tab];
  const cur = all[tab];
  el.innerHTML = `${head('Settings')}<div class="tabs">${Object.entries(SETTINGS_UI).map(([k, [t]]) => `<a href="#/settings?tab=${k}" class="${k === tab ? 'on' : ''}">${t}</a>`).join('')}</div>
    <form class="card form two" id="sf" style="max-width:900px">${Object.entries(fields).map(([k, label]) => typeof cur[k] === 'boolean'
      ? `<label class="check full"><input type="checkbox" name="${k}" ${cur[k] ? 'checked' : ''}> ${esc(label)}</label>`
      : `<label class="f ${String(cur[k]).length > 40 || k.includes('url') ? 'full' : ''}">${esc(label)}<input name="${k}" ${typeof cur[k] === 'number' ? 'type="number" step="any"' : ''} value="${esc(cur[k] ?? '')}" ${/secret|token|password|api_key/.test(k) ? 'autocomplete="off"' : ''}></label>`).join('')}
      ${tab === 'loyalty' ? `<div class="full small muted">Tiers: ${cur.tiers.map((t) => `${esc(t.name)} from ${money(t.min_spend)} (${t.multiplier}×)`).join(' · ')}</div>` : ''}
      ${tab === 'whatsapp' ? '<div class="full small muted">Create an app at developers.facebook.com → WhatsApp → API setup to get the phone number ID and a permanent system-user token. For order updates outside the 24-hour window, approve templates named order_confirmed / order_shipped / order_delivered and enable “Use approved templates”.</div>' : ''}
      ${tab === 'payments' ? '<div class="full small muted">Get keys from dashboard.razorpay.com → Settings → API Keys. Add a webhook for payment.captured pointing to https://YOUR-DOMAIN/api/webhooks/razorpay with the same webhook secret.</div>' : ''}
      <div class="full"><button class="btn primary">Save ${esc(title)}</button></div></form>`;
  $('#sf').onsubmit = async (e) => { e.preventDefault(); try { await api(`${A}/settings/${tab}`, { method: 'PUT', body: formData(e.target) }); toast('Settings saved'); settings(el, params); } catch (err) { toast(err.message, 'err'); } };
}

async function inventory(el) {
  const rows = await api(`${A}/inventory`);
  el.innerHTML = `${head('Inventory health', '<a class="btn" href="/stockist#/reorder">Open reorder planning →</a>')}
    <div class="grid g4" style="margin-bottom:16px">${kpi('Stock value (cost)', money(rows.reduce((s, r) => s + r.stock_value, 0)))}${kpi('Out of stock', rows.filter((r) => r.status === 'out').length)}${kpi('Critical / low', rows.filter((r) => ['critical', 'low'].includes(r.status)).length)}${kpi('Dead stock (0 sold in 30d)', rows.filter((r) => r.sold_30d === 0 && r.stock > 0).length)}</div>
    <div class="card table-wrap"><table class="t"><thead><tr><th>Product</th><th class="r">Stock</th><th class="r">Sold 30d</th><th class="r">Demand/day</th><th class="r">Days cover</th><th class="r">Stock value</th><th>Status</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td class="small"><b>${esc(r.name)}</b><div class="tiny code">${esc(r.sku)}</div></td><td class="r">${r.stock}</td><td class="r">${r.sold_30d}</td><td class="r">${r.velocity_per_day}</td><td class="r">${r.days_of_cover ?? '∞'}</td><td class="r">${money(r.stock_value)}</td><td><span class="badge ${STOCK[r.status][0]}">${STOCK[r.status][1]}</span></td></tr>`).join('')}</tbody></table></div>`;
}

startPanel({
  scope: 'master', title: 'Master Panel', roles: ['admin', 'marketing', 'support'], permissions: `${A}/permissions`,
  demo: 'Admin: admin@drovox.in / admin123 · Marketing: marketing@drovox.in / market123 · Support: support@drovox.in / support123',
  switchLink: { href: '/stockist', label: '📦 Stockist panel' },
  nav: [
    { id: 'dashboard', label: 'Dashboard', icon: '📊', group: 'Overview', area: 'dashboard' },
    { id: 'inventory', label: 'Inventory health', icon: '📦', group: 'Overview', area: 'analytics' },
    { id: 'orders', label: 'Orders', icon: '🧾', group: 'Sales', area: 'orders' },
    { id: 'customers', label: 'Customers', icon: '👥', group: 'Sales', area: 'customers' },
    { id: 'crm', label: 'CRM pipeline', icon: '🎯', group: 'Sales', area: 'crm' },
    { id: 'marketing', label: 'Marketing', icon: '📣', group: 'Growth', area: 'marketing' },
    { id: 'whatsapp', label: 'WhatsApp', icon: '💬', group: 'Growth', area: 'whatsapp' },
    { id: 'gst', label: 'GST reports', icon: '🏛️', group: 'Admin', area: 'admin' },
    { id: 'users', label: 'Users & roles', icon: '🔐', group: 'Admin', area: 'admin' },
    { id: 'audit', label: 'Audit trail', icon: '🕵️', group: 'Admin', area: 'admin' },
    { id: 'automation', label: 'Automation', icon: '⚙️', group: 'Admin', area: 'admin' },
    { id: 'settings', label: 'Settings', icon: '🛠️', group: 'Admin', area: 'admin' },
  ],
  pages: { dashboard, inventory, orders, customers, crm, marketing, gst, whatsapp, users, audit, automation, settings },
});
