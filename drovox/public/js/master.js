// Drovox master panel: analytics, orders, CRM, marketing, GST, WhatsApp, users, audit, automation and settings.
import { $, $$, api, esc, money, num, toast, modal, badge, ago, dt, formData, barChart, rankBars, downloadCsv, downloadAuthed } from './common.js';
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
  el.innerHTML = `${head('Customers', '<button class="btn" id="csv">⬇ CSV</button><a class="btn" href="#/greetings">🎂 Greetings</a><button class="btn primary" id="add">+ Add customer</button>')}
    <p class="small muted">RFM segments: <b>Champions</b> 3+ orders & bought in 45 days · <b>Loyal</b> 2+ orders in 90 days · <b>Recent</b> bought in 30 days · <b>At risk</b> 30–120 days quiet · <b>Lost</b> 120+ days · <b>Browsers</b> visited, never bought. Use them as campaign audiences.</p>
    <div class="row" style="margin-bottom:12px"><a class="chip ${!seg ? 'on' : ''}" href="#/customers">All</a>${Object.entries(SEG).map(([k, [, l]]) => `<a class="chip ${seg === k ? 'on' : ''}" href="#/customers?segment=${k}">${l} <b>${d.counts[k] || 0}</b></a>`).join('')}</div>
    <div class="card table-wrap"><table class="t"><thead><tr><th>Customer</th><th>Segment</th><th class="r">Orders</th><th class="r">Lifetime spend</th><th class="r">AOV</th><th class="r">Last order</th><th class="r">Points</th><th>Birthday / anniv.</th></tr></thead><tbody>
    ${d.rows.length ? '' : '<tr><td colspan="8" class="muted">No customers yet — they appear when people sign up on the store, or add walk-in / phone customers with “+ Add customer”.</td></tr>'}
    ${d.rows.map((c) => `<tr class="click" data-c="${c.id}"><td><b>${esc(c.name)}</b><div class="tiny muted">${c.email.endsWith('.drovox.local') ? '' : `${esc(c.email)} · `}${esc(c.phone || '')}${c.city ? ` · ${esc(c.city)}` : ''}</div></td><td><span class="badge ${SEG[c.segment][0]}">${SEG[c.segment][1]}</span></td><td class="r">${c.orders}</td><td class="r">${money(c.spend)}</td><td class="r">${money(c.aov)}</td><td class="r small">${c.days_since_order == null ? '—' : `${c.days_since_order}d ago`}</td><td class="r">${num(c.points)}</td><td class="small">${c.dob ? `🎂 ${esc(c.dob.slice(5))}` : ''} ${c.anniversary ? `💐 ${esc(c.anniversary.slice(5))}` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  $('#csv').onclick = () => downloadCsv('drovox-customers.csv', d.rows.map(({ id, ...r }) => r));
  $('#add').onclick = () => {
    const m = modal(`<h2>Add customer</h2><p class="small muted">For walk-in, phone or WhatsApp customers. Email is optional. Birthday and anniversary are used for automatic WhatsApp greetings.</p>${personalForm({ source: 'walk_in', whatsapp_opt_in: 1 }, true)}`, { wide: true });
    $('form', m.el).onsubmit = async (e) => { e.preventDefault(); try { await api(`${A}/customers`, { method: 'POST', body: formData(e.target) }); toast('Customer added'); m.close(); customers(el, params); } catch (err) { toast(err.message, 'err'); } };
  };
  $$('[data-c]', el).forEach((r) => { r.onclick = () => customer360(r.dataset.c, () => customers(el, params)); });
}
function personalForm(u, isNew) {
  return `<form class="form two"><label class="f">Full name<input name="name" required value="${esc(u.name || '')}"></label><label class="f">WhatsApp mobile<input name="phone" ${isNew ? 'required' : ''} value="${esc(u.phone || '')}" inputmode="tel"></label>
    ${isNew ? '<label class="f">Email (optional)<input name="email" type="email"></label>' : ''}<label class="f">City<input name="city" value="${esc(u.city || '')}"></label>
    <label class="f">Company / college<input name="company" value="${esc(u.company || '')}"></label>
    <label class="f">Date of birth<input name="dob" type="date" value="${esc(u.dob || '')}"></label><label class="f">Anniversary<input name="anniversary" type="date" value="${esc(u.anniversary || '')}"></label>
    ${isNew ? `<label class="f">Source<select name="source">${[['walk_in', 'Walk-in / counter'], ['phone', 'Phone call'], ['whatsapp', 'WhatsApp'], ['import', 'Imported list']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>` : ''}
    <label class="f full">Notes (interests, projects, preferences)<textarea name="notes" rows="2">${esc(u.notes || '')}</textarea></label>
    <label class="check full"><input type="checkbox" name="whatsapp_opt_in" ${u.whatsapp_opt_in ? 'checked' : ''}> Customer agrees to receive WhatsApp updates and greetings</label>
    <button class="btn primary full">Save</button></form>`;
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
      <div class="card flat full" style="grid-column:1/-1"><h3>👤 Personal details</h3><div id="pd"></div></div>
      <form class="card flat form" id="pts"><h3>⭐ Adjust points</h3><input name="change" type="number" placeholder="+100 or -50" required><input name="reason" placeholder="Reason (goodwill, correction…)"><button class="btn">Apply</button></form>
    </div>`, { wide: true });
  $('#wa', m.el).onsubmit = async (e) => { e.preventDefault(); const r = await api(`${A}/whatsapp/test`, { method: 'POST', body: { to: c.user.phone, message: formData(e.target).message } }); toast(r.ok ? (r.simulated ? 'Logged in outbox (WhatsApp not configured — simulated)' : 'WhatsApp sent') : r.error, r.ok ? 'ok' : 'err'); };
  const raw = (await api(`${A}/customers`)).rows.find((r) => r.id === Number(id)) || {};
  $('#pd', m.el).innerHTML = personalForm({ ...c.user, notes: raw.notes, whatsapp_opt_in: c.user.whatsapp_opt_in }, false);
  $('#pd form', m.el).onsubmit = async (e) => { e.preventDefault(); try { await api(`${A}/customers/${id}`, { method: 'PUT', body: formData(e.target) }); toast('Details saved'); m.close(); reload(); } catch (err) { toast(err.message, 'err'); } };
  $('#pts', m.el).onsubmit = async (e) => { e.preventDefault(); try { const r = await api(`${A}/users/${id}/points`, { method: 'POST', body: formData(e.target) }); toast(`Balance now ${r.points}`); m.close(); reload(); } catch (err) { toast(err.message, 'err'); } };
}

// ------------------------------------------------------------------ CRM pipeline
async function crm(el) {
  const d = await api(`${A}/leads`);
  const label = { new: 'New', contacted: 'Contacted', qualified: 'Qualified', proposal: 'Proposal sent', won: 'Won', lost: 'Lost' };
  const src = { bulk_quote: '📦 bulk quote', atl: '🏫 ATL enquiry', partner: '🤝 partner', ai_builder: '✨ AI builder', website: '🌐 website', whatsapp: '💬 WhatsApp', referral: '🤝 referral', manual: '✍️ manual' };
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

const FESTIVALS = {
  'Diwali': 'Hi {name}! 🪔 Wishing you and your family a very Happy Diwali — may your year be bright with new ideas and successful builds. Warm wishes from Team Drovox ✨',
  'Holi': 'Hi {name}! 🌈 Happy Holi from Team Drovox — have a colourful and safe celebration!',
  'New Year': 'Hi {name}! 🎉 Happy New Year from Team Drovox. Here’s to a year of great projects — thank you for building with us!',
  'Ganesh Chaturthi': 'Hi {name}! 🙏 Ganpati Bappa Morya! Wishing you a blessed Ganesh Chaturthi from Team Drovox.',
  'Eid': 'Hi {name}! 🌙 Eid Mubarak from Team Drovox — wishing you peace, happiness and prosperity.',
  'Christmas': 'Hi {name}! 🎄 Merry Christmas from Team Drovox — wishing you joy and a great holiday season.',
  'Independence Day': 'Hi {name}! 🇮🇳 Happy Independence Day from Team Drovox — proud to support India’s makers and engineers.',
  'Engineers Day': 'Hi {name}! 🔧 Happy Engineers’ Day from Team Drovox — celebrating everyone who builds the future.',
  'Weekend offer': 'Hi {name}! 🛒 This weekend only: special prices on popular parts at Drovox. You have {points} points to use too. Shop now: ',
};

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
        <label class="f">Quick template<select id="tpl"><option value="">— choose a festival or offer —</option>${Object.keys(FESTIVALS).map((k) => `<option>${k}</option>`).join('')}</select></label>
        <label class="f">Message<textarea name="message" rows="5" required>Hi {name}! </textarea></label>
        <div class="tiny muted">Placeholders: {name}, {points}. Marketing messages outside a 24-hour customer window need an approved WhatsApp template.</div>
        <label class="f">Coupon to promote (optional)<input name="coupon_code"></label><button class="btn primary">Save campaign</button></form></div>`;
    $('#tpl').onchange = (e) => { if (!e.target.value) return; const f = $('#cf'); f.elements.message.value = FESTIVALS[e.target.value]; if (!f.elements.name.value) f.elements.name.value = `${e.target.value} ${new Date().getFullYear()}`; };
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
/** Renders a gateway response: finds a QR image, a list of messages, or shows the raw JSON. */
function gatewayView(action, r) {
  const head = `<div class="row" style="margin-bottom:8px"><span class="badge ${r.ok ? 'green' : 'red'}">${r.ok ? 'OK' : 'Error'}</span><span class="small muted">HTTP ${r.status || '—'}${r.error ? ` · ${esc(r.error)}` : ''}</span></div>`;
  const j = r.json;
  const find = (o, test, depth = 0) => {
    if (!o || depth > 4) return null;
    if (typeof o === 'string') return test(o) ? o : null;
    if (typeof o === 'object') for (const v of Object.values(o)) { const f = find(v, test, depth + 1); if (f) return f; }
    return null;
  };
  let body = '';
  if (action === 'connect' && j) {
    const qr = find(j, (s) => s.startsWith('data:image') || /\.(png|jpg|jpeg|svg)(\?|$)/i.test(s) || (s.length > 200 && /^[A-Za-z0-9+/=]+$/.test(s)));
    if (qr) body = `<div style="text-align:center"><img alt="WhatsApp link QR" style="width:260px;max-width:100%;background:#fff;padding:8px;border-radius:12px" src="${esc(qr.startsWith('data:') || qr.startsWith('http') ? qr : `data:image/png;base64,${qr}`)}"><p class="small">Open WhatsApp on the shop phone → Settings → Linked devices → Link a device, and scan this code.</p></div>`;
  }
  if (!body && j) {
    const list = Array.isArray(j) ? j : Array.isArray(j.data) ? j.data : Array.isArray(j.messages) ? j.messages : Array.isArray(j.data?.data) ? j.data.data : null;
    if (list) {
      const cols = [...new Set(list.slice(0, 20).flatMap((x) => (x && typeof x === 'object' ? Object.keys(x) : [])))].slice(0, 6);
      body = list.length ? `<div class="table-wrap"><table class="t"><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${list.slice(0, 100).map((x) => `<tr>${cols.map((c) => `<td class="small">${esc(typeof x[c] === 'object' ? JSON.stringify(x[c]) : x[c] ?? '').slice(0, 120)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nothing here.</p>';
    }
  }
  if (!body) body = `<pre class="code">${esc(j ? JSON.stringify(j, null, 2) : r.text || '')}</pre>`;
  return head + body;
}

async function whatsapp(el) {
  const d = await api(`${A}/notifications`);
  const myrc = d.provider !== 'meta';
  el.innerHTML = `${head('WhatsApp messages', '<a class="btn" href="#/settings?tab=whatsapp">⚙️ Configure</a>')}
    ${d.configured ? `<div class="banner teal" style="margin-bottom:14px"><div>✅ WhatsApp is on — sending through ${myrc ? 'the msg.myrc.in gateway' : 'the Meta WhatsApp Cloud API'}.</div></div>` : '<div class="banner brand" style="margin-bottom:14px"><div>⚠️ WhatsApp is not switched on yet — messages are <b>simulated</b> and only logged here. Enter your gateway API key and tick “Enable WhatsApp” in Settings → WhatsApp.</div></div>'}
    ${myrc ? `<div class="card" style="margin-bottom:16px"><div class="row between"><h3 style="margin:0">📱 Gateway device (msg.myrc.in)</h3><div class="row"><button class="btn sm" data-gw="status">Device status</button><button class="btn sm primary" data-gw="connect">Connect / show QR</button><button class="btn sm" data-gw="pending">Pending messages</button><button class="btn sm" data-gw="logs">Gateway logs</button></div></div>
      <div id="gw" class="small muted" style="margin-top:10px">Check that your WhatsApp phone is linked. If it is disconnected, press “Connect / show QR” and scan the code from WhatsApp → Linked devices.</div></div>` : ''}
    <div class="grid g2" style="grid-template-columns:minmax(0,1.8fr) minmax(0,1fr)"><div class="card table-wrap"><div class="row" style="margin-bottom:8px">${d.counts.map((c) => `<span class="badge ${c.status === 'sent' ? 'green' : c.status === 'failed' ? 'red' : ''}">${esc(c.status)} ${c.n}</span>`).join('')}</div>
      <table class="t"><thead><tr><th>When</th><th>To</th><th>Message</th><th>Status</th></tr></thead><tbody>${d.rows.map((n) => `<tr><td class="small nowrap">${ago(n.created_at)}</td><td class="small">${esc(n.to_phone)}</td><td class="small">${esc(n.body.slice(0, 140))}${n.error ? `<div style="color:var(--red)" class="tiny">${esc(n.error)}</div>` : ''}</td><td><span class="badge ${n.status === 'sent' ? 'green' : n.status === 'failed' ? 'red' : ''}">${esc(n.status)}</span></td></tr>`).join('')}</tbody></table></div>
      <form class="card form" id="tf"><h3>Send a test</h3><label class="f">To (mobile)<input name="to" required></label><label class="f">Message<textarea name="message" rows="3">Test message from Drovox ✅</textarea></label><button class="btn primary">Send</button>
      <div class="small muted">Automatic messages: order confirmed, packed, shipped (with AWB), out for delivery, delivered (+points), cancelled, back-in-stock, abandoned cart, campaigns, CRM follow-ups, daily low-stock digest to the store number.</div></form></div>`;
  $$('[data-gw]', el).forEach((b) => { b.onclick = async () => {
    const box = $('#gw'); box.innerHTML = '<span class="spinner"></span> Contacting gateway…';
    try { box.innerHTML = gatewayView(b.dataset.gw, await api(`${A}/whatsapp/gateway/${b.dataset.gw}`)); } catch (e) { box.innerHTML = `<span style="color:var(--red)">${esc(e.message)}</span>`; }
  }; });
  $('#tf').onsubmit = async (e) => { e.preventDefault(); const r = await api(`${A}/whatsapp/test`, { method: 'POST', body: formData(e.target) }); toast(r.ok ? (r.simulated ? 'Simulated (API not configured)' : 'Sent') : r.error, r.ok ? 'ok' : 'err'); whatsapp(el); };
}

// ------------------------------------------------------------------ greetings
async function greetings(el, params) {
  const days = Number(params.get('days') || 30);
  const d = await api(`${A}/greetings?days=${days}`);
  const when = (n) => (n === 0 ? '<b style="color:var(--brand)">Today</b>' : n === 1 ? 'Tomorrow' : `in ${n} days`);
  el.innerHTML = `${head('🎂 Birthday & anniversary greetings', `<div class="row">${[7, 30, 90].map((n) => `<a class="chip ${n === days ? 'on' : ''}" href="#/greetings?days=${n}">${n} days</a>`).join('')}</div><a class="btn" href="#/settings?tab=greetings">⚙️ Messages</a>`)}
    <div class="banner ${d.settings.enabled ? 'teal' : 'brand'}" style="margin-bottom:14px"><div>${d.settings.enabled ? `✅ Automatic greetings are on — sent on WhatsApp each day after ${d.settings.send_hour}:00 IST.` : '⏸️ Automatic greetings are off — turn them on in Settings → Greetings.'} ${d.missing ? `<b>${d.missing}</b> customers have no birthday or anniversary saved — add them from the customer’s page.` : ''}</div></div>
    <div class="grid g2" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)"><div class="card table-wrap"><table class="t"><thead><tr><th>When</th><th>Customer</th><th>Occasion</th><th>Status</th><th></th></tr></thead><tbody>
      ${d.rows.map((r) => `<tr><td class="small">${when(r.in_days)}<div class="tiny muted">${esc(r.date.slice(5))}</div></td><td>${esc(r.name)}<div class="tiny muted">${esc(r.phone || 'no phone')}</div></td>
        <td>${r.kind === 'birthday' ? `🎂 Birthday${r.turning ? ` (${r.turning})` : ''}` : '💐 Anniversary'}</td>
        <td>${r.sent ? '<span class="badge green">sent</span>' : !r.opted_in ? '<span class="badge">opted out</span>' : !r.phone ? '<span class="badge red">no phone</span>' : '<span class="badge">scheduled</span>'}</td>
        <td>${!r.sent && r.phone && r.opted_in ? `<button class="btn sm" data-send="${r.user_id}" data-kind="${r.kind}" data-year="${r.year}">Send now</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No birthdays or anniversaries in this period.</td></tr>'}</tbody></table></div>
      <div class="card stack"><h3>Message preview</h3><div class="small"><b>Birthday</b><div class="card flat" style="margin-top:4px">${esc(d.preview.birthday)}</div></div><div class="small"><b>Anniversary</b><div class="card flat" style="margin-top:4px">${esc(d.preview.anniversary)}</div></div>
        <hr class="sep"><h3>Festival greetings</h3><p class="small muted">Send Diwali, Holi, New Year and other wishes to all customers (or a segment) as a WhatsApp campaign.</p><a class="btn" href="#/marketing?tab=campaigns">Create festival campaign →</a></div></div>`;
  $$('[data-send]', el).forEach((b) => { b.onclick = async () => {
    b.disabled = true; const r = await api(`${A}/greetings/send`, { method: 'POST', body: { user_id: b.dataset.send, kind: b.dataset.kind, year: b.dataset.year } });
    toast(r.ok ? (r.simulated ? 'Greeting logged (WhatsApp not enabled — simulated)' : 'Greeting sent 🎉') : r.error, r.ok ? 'ok' : 'err'); greetings(el, params);
  }; });
}

// ------------------------------------------------------------------ website content
const CONTENT = {
  banners: { label: '🖼️ Home banners', cols: [['title', 'Title'], ['subtitle', 'Subtitle'], ['link', 'Link'], ['sort', 'Order'], ['active', 'Live']],
    form: (r) => `<label class="f full">Headline<input name="title" required value="${esc(r.title || '')}"></label><label class="f full">Subtitle<input name="subtitle" value="${esc(r.subtitle || '')}"></label>
      <label class="f">Button text<input name="cta_text" value="${esc(r.cta_text || 'Shop now')}"></label><label class="f">Button link<input name="link" value="${esc(r.link || '#/search')}" placeholder="#/c/drone or https://…"></label>
      <label class="f">Background colour<input name="bg" type="color" value="${esc(r.bg || '#13203A')}"></label><label class="f">Order<input name="sort" type="number" value="${r.sort ?? 0}"></label>
      <label class="f full">Banner image (optional, replaces the text; 1600×500 px, JPG/PNG/WebP, max 3 MB)<input type="file" id="img" accept="image/png,image/jpeg,image/webp"></label>
      ${r.image ? `<div class="full"><img src="/uploads/site/${encodeURIComponent(r.image)}" alt="Current banner" style="max-width:100%;border-radius:10px"><label class="check"><input type="checkbox" name="remove_image"> Remove image</label></div>` : ''}
      <label class="check full"><input type="checkbox" name="active" ${r.active !== 0 ? 'checked' : ''}> Show on the home page</label>` },
  reviews: { label: '⭐ Reviews', cols: [['name', 'Name'], ['rating', 'Stars'], ['text', 'Review'], ['source', 'Source'], ['active', 'Live']],
    note: 'Add real reviews only — copy them from your Google Business profile or customer feedback, with the customer’s name as shown there.',
    form: (r) => `<label class="f">Customer name<input name="name" required value="${esc(r.name || '')}"></label><label class="f">Stars<select name="rating">${[5, 4, 3, 2, 1].map((n) => `<option ${Number(r.rating || 5) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="f full">Review text<textarea name="text" rows="3" required>${esc(r.text || '')}</textarea></label><label class="f">Date<input name="review_date" type="date" value="${esc(r.review_date || '')}"></label>
      <label class="f">Source<select name="source">${['Google', 'Website', 'WhatsApp', 'Amazon', 'IndiaMART'].map((x) => `<option ${r.source === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label><label class="f">Order<input name="sort" type="number" value="${r.sort ?? 0}"></label>
      <label class="check"><input type="checkbox" name="verified" ${r.verified !== 0 ? 'checked' : ''}> Verified purchase</label><label class="check full"><input type="checkbox" name="active" ${r.active !== 0 ? 'checked' : ''}> Show on the home page</label>` },
  posts: { label: '📝 Blog', cols: [['title', 'Title'], ['excerpt', 'Summary'], ['published', 'Published'], ['created_at', 'Date']],
    form: (r) => `<label class="f full">Title<input name="title" required value="${esc(r.title || '')}"></label><label class="f">Cover emoji<input name="cover" maxlength="4" value="${esc(r.cover || '📝')}"></label><label class="f">Tags<input name="tags" value="${esc(r.tags || '')}" placeholder="arduino, tutorial"></label>
      <label class="f full">Summary<input name="excerpt" value="${esc(r.excerpt || '')}"></label><label class="f full">Article (blank line = new paragraph, start a line with “## ” for a heading)<textarea name="body" rows="12" required>${esc(r.body || '')}</textarea></label>
      <label class="check full"><input type="checkbox" name="published" ${r.published !== 0 ? 'checked' : ''}> Published</label>` },
  jobs: { label: '💼 Careers', cols: [['title', 'Role'], ['location', 'Location'], ['type', 'Type'], ['active', 'Open']],
    form: (r) => `<label class="f full">Role<input name="title" required value="${esc(r.title || '')}"></label><label class="f">Location<input name="location" value="${esc(r.location || '')}"></label>
      <label class="f">Type<select name="type">${['Full-time', 'Part-time', 'Internship', 'Contract'].map((x) => `<option ${r.type === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="f full">Description (responsibilities, skills, salary range)<textarea name="description" rows="8" required>${esc(r.description || '')}</textarea></label><label class="check full"><input type="checkbox" name="active" ${r.active !== 0 ? 'checked' : ''}> Accepting applications</label>` },
};
async function website(el, params) {
  const tab = params.get('tab') || 'banners'; const C = CONTENT[tab] ? CONTENT[tab] : null;
  el.innerHTML = `${head('Website content', '<a class="btn" href="#/settings?tab=site">⚙️ Header, social & reviews link</a><a class="btn" href="/" target="_blank">View store ↗</a>')}
    <div class="tabs">${Object.entries(CONTENT).map(([k, v]) => `<a href="#/website?tab=${k}" class="${k === tab ? 'on' : ''}">${v.label}</a>`).join('')}<a href="#/website?tab=applications" class="${tab === 'applications' ? 'on' : ''}">📄 Job applications</a></div><div id="wc"></div>`;
  const wc = $('#wc');
  if (tab === 'applications') {
    const rows = await api(`${A}/content/applications/list`);
    wc.innerHTML = `<div class="card table-wrap"><table class="t"><thead><tr><th>Applicant</th><th>Role</th><th>Message</th><th>Received</th><th></th></tr></thead><tbody>${rows.map((a) => `<tr><td><b>${esc(a.name)}</b><div class="tiny muted">${esc(a.phone)} ${esc(a.email || '')}</div></td><td>${esc(a.job || '')}</td><td class="small">${esc((a.message || '').slice(0, 160))}</td><td class="small">${ago(a.created_at)}</td><td>${a.resume ? `<button class="btn sm" data-cv="${a.id}" data-n="${esc(a.name)}">Resume</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No applications yet</td></tr>'}</tbody></table></div>`;
    $$('[data-cv]', wc).forEach((b) => { b.onclick = () => downloadAuthed(`${A}/content/applications/${b.dataset.cv}/resume`, `${b.dataset.n}-resume`).catch((e) => toast(e.message, 'err')); });
    return;
  }
  const rows = await api(`${A}/content/${tab}`);
  wc.innerHTML = `${C.note ? `<div class="banner brand" style="margin-bottom:12px"><div class="small">${C.note}</div></div>` : ''}<div class="row" style="margin-bottom:12px"><button class="btn primary" id="new">+ Add</button></div>
    <div class="card table-wrap"><table class="t"><thead><tr>${C.cols.map(([, l]) => `<th>${l}</th>`).join('')}<th></th></tr></thead><tbody>
    ${rows.map((r) => `<tr>${C.cols.map(([k]) => `<td class="small">${['active', 'published'].includes(k) ? (r[k] ? '<span class="badge green">yes</span>' : '<span class="badge">no</span>') : k === 'rating' ? '★'.repeat(r[k]) : esc(String(r[k] ?? '').slice(0, 90))}</td>`).join('')}
      <td class="nowrap"><button class="btn sm" data-ed="${r.id}">Edit</button> <button class="btn sm danger" data-del="${r.id}">Delete</button></td></tr>`).join('') || `<tr><td colspan="${C.cols.length + 1}" class="muted">Nothing here yet</td></tr>`}</tbody></table></div>`;
  const open = (r) => {
    const m = modal(`<h2>${r.id ? 'Edit' : 'Add'} — ${C.label.replace(/^\S+\s/, '')}</h2><form class="form two">${C.form(r)}<button class="btn primary full">Save</button></form>`, { wide: true });
    $('form', m.el).onsubmit = async (e) => {
      e.preventDefault(); const f = formData(e.target);
      const file = $('#img', m.el)?.files?.[0];
      if (file) { if (file.size > 3 * 1048576) return toast('Image must be under 3 MB', 'err'); f.image_data = await new Promise((ok) => { const rd = new FileReader(); rd.onload = () => ok(rd.result); rd.readAsDataURL(file); }); }
      try { await api(r.id ? `${A}/content/${tab}/${r.id}` : `${A}/content/${tab}`, { method: r.id ? 'PUT' : 'POST', body: f }); toast('Saved'); m.close(); website(el, params); } catch (err) { toast(err.message, 'err'); }
    };
  };
  $('#new').onclick = () => open({});
  $$('[data-ed]', wc).forEach((b) => { b.onclick = () => open(rows.find((r) => r.id === Number(b.dataset.ed))); });
  $$('[data-del]', wc).forEach((b) => { b.onclick = async () => { if (!confirm('Delete this item?')) return; await api(`${A}/content/${tab}/${b.dataset.del}`, { method: 'DELETE' }); toast('Deleted'); website(el, params); }; });
}

// ------------------------------------------------------------------ partners
async function partners(el) {
  const d = await api(`${A}/partners`);
  const pending = d.applications.filter((a) => a.status === 'pending');
  el.innerHTML = `${head('Partner program', '<a class="btn" href="#/settings?tab=partners">⚙️ Discounts</a><a class="btn" href="/#/partner" target="_blank">Public page ↗</a>')}
    <div class="grid g3" style="margin-bottom:16px">${kpi('Pending applications', pending.length)}${kpi('Active partners', d.partners.length)}${kpi('Partner revenue', money(d.partners.reduce((s, p) => s + p.revenue, 0)))}</div>
    <div class="card" style="margin-bottom:16px"><h3>Applications</h3><div class="table-wrap"><table class="t"><thead><tr><th>Applicant</th><th>Type</th><th>Volume</th><th>Message</th><th>Status</th><th></th></tr></thead><tbody>
      ${d.applications.map((a) => `<tr><td><b>${esc(a.company || a.name)}</b><div class="tiny muted">${esc(a.name)} · ${esc(a.phone)}${a.city ? ` · ${esc(a.city)}` : ''}${a.gstin ? ` · ${esc(a.gstin)}` : ''}</div></td><td class="small">${esc(d.types[a.type] || a.type)}</td>
        <td class="small">${esc(a.monthly_volume || '')}</td><td class="small" style="max-width:320px">${esc((a.message || '').slice(0, 160))}${a.website ? `<div class="tiny">${esc(a.website)}</div>` : ''}</td>
        <td><span class="badge ${a.status === 'approved' ? 'green' : a.status === 'rejected' ? 'red' : 'amber'}">${esc(a.status)}</span>${a.status !== 'pending' ? `<div class="tiny muted">${a.discount_pct}%</div>` : ''}</td>
        <td class="nowrap">${a.status === 'pending' ? `<input type="number" value="${a.discount_pct}" min="0" max="50" style="width:70px" data-pct="${a.id}"> % <button class="btn sm primary" data-ok="${a.id}">Approve</button> <button class="btn sm danger" data-no="${a.id}">Reject</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No applications yet</td></tr>'}</tbody></table></div></div>
    <div class="card"><h3>Active partners</h3><div class="table-wrap"><table class="t"><thead><tr><th>Partner</th><th>Type</th><th class="r">Orders</th><th class="r">Revenue</th><th>Discount</th><th></th></tr></thead><tbody>
      ${d.partners.map((p) => `<tr><td><b>${esc(p.company || p.name)}</b><div class="tiny muted">${esc(p.email)} · ${esc(p.phone || '')}</div></td><td class="small">${esc(d.types[p.partner_type] || p.partner_type)}</td><td class="r">${p.orders}</td><td class="r">${money(p.revenue)}</td>
        <td><input type="number" value="${p.partner_discount}" min="0" max="50" style="width:70px" data-disc="${p.id}"> %</td><td class="nowrap"><button class="btn sm" data-save="${p.id}">Save</button> <button class="btn sm danger" data-revoke="${p.id}">Revoke</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No partners yet</td></tr>'}</tbody></table></div></div>`;
  const decide = async (id, approve) => {
    const note = approve ? '' : prompt('Reason (sent to the applicant on WhatsApp, optional):') ?? null;
    if (note === null) return;
    const r = await api(`${A}/partners/${id}/decision`, { method: 'POST', body: { approve, discount_pct: Number($(`[data-pct="${id}"]`).value), note } });
    toast(`${approve ? 'Approved' : 'Rejected'}${r.whatsapp?.ok ? (r.whatsapp.simulated ? ' · WhatsApp simulated' : ' · applicant notified on WhatsApp') : ''}`); partners(el);
  };
  $$('[data-ok]', el).forEach((b) => { b.onclick = () => decide(b.dataset.ok, true).catch((e) => toast(e.message, 'err')); });
  $$('[data-no]', el).forEach((b) => { b.onclick = () => decide(b.dataset.no, false).catch((e) => toast(e.message, 'err')); });
  $$('[data-save]', el).forEach((b) => { b.onclick = async () => { await api(`${A}/partners/user/${b.dataset.save}`, { method: 'PUT', body: { discount_pct: Number($(`[data-disc="${b.dataset.save}"]`).value) } }); toast('Discount updated'); partners(el); }; });
  $$('[data-revoke]', el).forEach((b) => { b.onclick = async () => { if (!confirm('Remove partner status and discount?')) return; await api(`${A}/partners/user/${b.dataset.revoke}`, { method: 'PUT', body: { revoke: true } }); toast('Partner revoked'); partners(el); }; });
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
  store: ['Store & GST', { name: 'Store name', tagline: 'Tagline', legal_name: 'Legal business name — same as on your bank / Razorpay account', gstin: 'GSTIN', state_code: 'State code (e.g. 27 = Maharashtra)', address: 'Registered business address (shown on invoices and policy pages)', business_type: 'Business type (Proprietorship / Partnership / LLP / Pvt Ltd)', jurisdiction_city: 'City for legal jurisdiction (e.g. Pune)', grievance_officer: 'Grievance officer name', grievance_email: 'Grievance officer email', support_phone: 'Support WhatsApp number', support_email: 'Support email', public_url: 'Public website URL', sku_prefix: 'SKU prefix (DRV → DRV-SEN-0001)' }],
  payments: ['Payments', { razorpay_key_id: 'Razorpay key ID', razorpay_key_secret: 'Razorpay key secret', razorpay_webhook_secret: 'Razorpay webhook secret (webhook URL: /api/webhooks/razorpay)', cod_enabled: 'Enable cash on delivery', test_mode: 'Allow test-mode payments while Razorpay is not configured' }],
  whatsapp: ['WhatsApp', { enabled: 'Enable WhatsApp messages (otherwise they are only simulated and logged)', provider: 'Provider', myrc_base_url: 'Gateway API URL (msg.myrc.in)', myrc_api_key: 'Gateway API key (Bearer token)',
    phone_number_id: 'Meta: phone number ID', access_token: 'Meta: permanent access token', api_version: 'Meta: Graph API version', use_templates: 'Meta: use approved templates for order updates' }],
  greetings: ['Greetings', { enabled: 'Send birthday & anniversary greetings automatically on WhatsApp', send_hour: 'Send after (hour, IST, 0–23)', birthday: 'Birthday message', anniversary: 'Anniversary message', coupon: 'Gift coupon code (optional — create it in Marketing first)', coupon_line: 'Coupon sentence added to the message' }],
  ai: ['AI (Claude)', { enabled: 'Enable AI Project Builder', anthropic_api_key: 'Anthropic API key (or set ANTHROPIC_API_KEY on the server)', model: 'Model' }],
  shipping: ['Shipping', { flat_fee: 'Flat shipping fee ₹', free_above: 'Free shipping above ₹', cod_fee: 'COD handling fee ₹', cod_max_order: 'Max COD order ₹' }],
  courier: ['Courier', { provider: 'Provider (manual / shiprocket)', shiprocket_email: 'Shiprocket email', shiprocket_password: 'Shiprocket password', tracking_url: 'Tracking URL template ({awb})' }],
  loyalty: ['Loyalty & referrals', { earn_per_100: 'Points per ₹100 spent', point_value: '₹ value of 1 point', max_redeem_pct: 'Max % of order payable with points', signup_bonus: 'Signup bonus points', referrer_bonus: 'Referrer bonus (on friend\'s first delivery)', referee_bonus: 'New friend bonus', daily_checkin: 'Daily check-in points', streak_bonus_7: '7-day streak bonus' }],
  engagement: ['Engagement', { welcome_coupon: 'Welcome coupon code', exit_intent: 'Show exit-intent offer to new visitors', social_proof: 'Show real-time social proof on product pages', abandoned_cart_hours: 'Abandoned cart reminder after (hours)', abandoned_cart_coupon: 'Abandoned cart coupon', unpaid_cancel_minutes: 'Cancel unpaid online orders after (minutes)' }],
  site: ['Website', { toll_free: 'Toll-free / support number in the top bar', support_hours: 'Support hours', facebook_url: 'Facebook URL', x_url: 'X (Twitter) URL', linkedin_url: 'LinkedIn URL', instagram_url: 'Instagram URL', youtube_url: 'YouTube URL',
    google_reviews_url: 'Google reviews link (Google Business profile)', reviews_title: 'Reviews section title', show_services_on_home: 'Show services cards on the home page', banner_seconds: 'Banner slide time (seconds)', app_ios_url: 'iOS app — App Store link', app_android_url: 'Android app — Google Play link', return_days: 'Return window (days) shown in the returns policy', dispatch_days: 'Dispatch time shown in the shipping policy', delivery_days: 'Delivery time after dispatch (shipping policy)', refund_days: 'Refund credit time (refund policy)', policy_updated: 'Policies last updated (YYYY-MM-DD)' }],
  partners: ['Partners', { enabled: 'Accept partner applications', reseller_discount: 'Reseller / dealer discount %', institution_discount: 'School / college / ATL discount %', makerspace_discount: 'Makerspace / academy discount %', integrator_discount: 'Integrator / industrial discount %', affiliate_discount: 'Affiliate / creator discount %', max_discount: 'Maximum partner discount allowed %' }],
  services: ['Services', { enabled: 'Accept service requests (3D print, PCB, laser, acrylic, battery)', gst_rate: 'GST % on services',
    pla_per_g: '3D print PLA ₹/g', petg_per_g: 'PETG ₹/g', abs_per_g: 'ABS ₹/g', tpu_per_g: 'TPU ₹/g', resin_per_g: 'Resin ₹/g', print_setup: '3D print setup ₹/order', print_min: '3D print minimum order ₹',
    pcb_setup: 'PCB setup ₹/design', pcb_1l_cm2: 'PCB 1-layer ₹/cm²', pcb_2l_cm2: 'PCB 2-layer ₹/cm²', pcb_4l_cm2: 'PCB 4-layer ₹/cm²', pcb_color_extra: 'PCB non-green mask ₹', pcb_enig_extra: 'PCB ENIG ₹', pcb_stencil: 'SMT stencil ₹', pcb_assembly_per_board: 'PCB assembly labour ₹/board',
    acrylic_2mm_cm2: 'Acrylic 2 mm ₹/cm²', acrylic_3mm_cm2: 'Acrylic 3 mm ₹/cm²', acrylic_5mm_cm2: 'Acrylic 5 mm ₹/cm²', acrylic_8mm_cm2: 'Acrylic 8 mm ₹/cm²', mdf_3mm_cm2: 'MDF 3 mm ₹/cm²', mdf_6mm_cm2: 'MDF 6 mm ₹/cm²', ply_4mm_cm2: 'Plywood 4 mm ₹/cm²', cardboard_cm2: 'Cardboard ₹/cm²',
    cut_per_m: 'Laser cutting ₹/metre', engrave_per_cm2: 'Engraving ₹/cm²', cut_min: 'Cutting minimum order ₹',
    cell_18650: '18650 cell ₹ (BIS)', cell_21700: '21700 cell ₹ (BIS)', cell_lfp_32700: 'LiFePO4 32700 cell ₹', bms_base: 'BMS base ₹', bms_per_s: 'BMS ₹ per series cell', bms_per_10a: 'BMS ₹ per 10 A', assembly_per_cell: 'Spot-weld assembly ₹/cell', pack_base: 'Pack base charge ₹', battery_test_fee: 'Battery test fee ₹/pack', cell_18650_hd: '18650 high-drain 3000 mAh cell ₹', cell_21700_hc: '21700 5000 mAh cell ₹', casing_abs_base: 'ABS battery box base ₹', casing_abs_per_cell: 'ABS box ₹ per cell', casing_metal_base: 'Aluminium battery box base ₹', casing_metal_per_cell: 'Aluminium box ₹ per cell', wire_per_10cm: 'Extra output wire ₹ per 10 cm', ntc_sensor: 'NTC sensor ₹', charger_base: 'Charger base ₹', charger_per_s: 'Charger ₹ per series cell',
    sla_standard_per_cm3: 'Industrial: standard resin ₹/cm³', sla_tough_per_cm3: 'Tough resin ₹/cm³', sla_clear_per_cm3: 'Clear resin ₹/cm³', sls_nylon_per_cm3: 'SLS nylon ₹/cm³', mjf_nylon_per_cm3: 'MJF nylon ₹/cm³', industrial_setup: 'Industrial setup ₹', industrial_min: 'Industrial minimum ₹', sla_black_per_cm3: 'Black resin ₹/cm³', sla_hightemp_per_cm3: 'High-temp resin ₹/cm³', mjf_pa11_per_cm3: 'MJF PA11 ₹/cm³', sls_pa12gf_per_cm3: 'SLS glass-filled PA12 ₹/cm³', wjp_rigid_per_cm3: 'Multi-jet rigid resin ₹/cm³', wjp_colour_per_cm3: 'Full-colour resin ₹/cm³', slm_ss316l_per_cm3: 'SLM stainless 316L ₹/cm³', slm_alsi10mg_per_cm3: 'SLM aluminium ₹/cm³', slm_ti64_per_cm3: 'SLM titanium ₹/cm³', bj_ss316l_per_cm3: 'Binder-jet stainless ₹/cm³', industrial_metal_setup: 'Metal printing setup ₹', metal_pierce: 'Metal laser ₹ per pierce (per 2 mm thickness)', laser_pierce: 'Non-metal laser ₹ per pierce',
    ms_cm2_mm: 'Metal: mild steel ₹/cm²·mm', ss_cm2_mm: 'Stainless ₹/cm²·mm', al_cm2_mm: 'Aluminium ₹/cm²·mm', brass_cm2_mm: 'Brass ₹/cm²·mm', gi_cm2_mm: 'GI ₹/cm²·mm', metal_cut_per_m_mm: 'Metal cutting ₹ per metre per mm', metal_bend_each: 'Bending ₹ per bend', metal_setup: 'Metal setup ₹', metal_min: 'Metal minimum ₹',
    leather_cm2: 'Leather ₹/cm²', eva_foam_cm2: 'EVA foam ₹/cm²' }],
  inventory: ['Inventory', { safety_days: 'Safety stock (days)', target_cover_days: 'Reorder to cover (days)', low_stock_default: 'Default reorder level' }],
};
const SELECTS = { provider: [['myrc', 'msg.myrc.in gateway'], ['meta', 'Meta WhatsApp Cloud API']] };
const TEXTAREAS = ['birthday', 'anniversary', 'coupon_line'];
async function settings(el, params) {
  const all = await api(`${A}/settings`);
  const tab = params.get('tab') || 'store';
  const [title, fields] = SETTINGS_UI[tab];
  const cur = all[tab];
  el.innerHTML = `${head('Settings')}<div class="tabs">${Object.entries(SETTINGS_UI).map(([k, [t]]) => `<a href="#/settings?tab=${k}" class="${k === tab ? 'on' : ''}">${t}</a>`).join('')}</div>
    <form class="card form two" id="sf" style="max-width:900px">${Object.entries(fields).map(([k, label]) => SELECTS[k]
      ? `<label class="f">${esc(label)}<select name="${k}">${SELECTS[k].map(([v, l]) => `<option value="${v}" ${cur[k] === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`
      : TEXTAREAS.includes(k) ? `<label class="f full">${esc(label)}<textarea name="${k}" rows="3">${esc(cur[k] ?? '')}</textarea></label>`
      : typeof cur[k] === 'boolean'
      ? `<label class="check full"><input type="checkbox" name="${k}" ${cur[k] ? 'checked' : ''}> ${esc(label)}</label>`
      : `<label class="f ${String(cur[k]).length > 40 || k.includes('url') ? 'full' : ''}">${esc(label)}<input name="${k}" ${typeof cur[k] === 'number' ? 'type="number" step="any"' : ''} value="${esc(cur[k] ?? '')}" ${/secret|token|password|api_key/.test(k) ? 'autocomplete="off"' : ''}></label>`).join('')}
      ${tab === 'loyalty' ? `<div class="full small muted">Tiers: ${cur.tiers.map((t) => `${esc(t.name)} from ${money(t.min_spend)} (${t.multiplier}×)`).join(' · ')}</div>` : ''}
      ${tab === 'whatsapp' ? '<div class="full small muted"><b>msg.myrc.in:</b> paste the API key from your gateway account (the same key your PHP backend used), tick “Enable”, save, then open the WhatsApp page and press “Device status” to check the phone is linked. <b>Meta Cloud API</b> (alternative): create an app at developers.facebook.com → WhatsApp → API setup.</div>' : ''}
      ${tab === 'greetings' ? '<div class="full small muted">Placeholders: {name} = first name, {store} = shop name, {coupon} = gift coupon. Greetings go to customers with a birthday/anniversary saved and WhatsApp updates allowed — once per year per occasion.</div>' : ''}
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
  demo: '', setup: true,
  switchLink: { href: '/stockist', label: '📦 Stockist panel' },
  nav: [
    { id: 'dashboard', label: 'Dashboard', icon: '📊', group: 'Overview', area: 'dashboard' },
    { id: 'inventory', label: 'Inventory health', icon: '📦', group: 'Overview', area: 'analytics' },
    { id: 'orders', label: 'Orders', icon: '🧾', group: 'Sales', area: 'orders' },
    { id: 'customers', label: 'Customers', icon: '👥', group: 'Sales', area: 'customers' },
    { id: 'crm', label: 'CRM pipeline', icon: '🎯', group: 'Sales', area: 'crm' },
    { id: 'marketing', label: 'Marketing', icon: '📣', group: 'Growth', area: 'marketing' },
    { id: 'greetings', label: 'Greetings', icon: '🎂', group: 'Growth', area: 'customers' },
    { id: 'partners', label: 'Partners', icon: '🤝', group: 'Growth', area: 'marketing' },
    { id: 'website', label: 'Website content', icon: '🖼️', group: 'Growth', area: 'marketing' },
    { id: 'whatsapp', label: 'WhatsApp', icon: '💬', group: 'Growth', area: 'whatsapp' },
    { id: 'gst', label: 'GST reports', icon: '🏛️', group: 'Admin', area: 'admin' },
    { id: 'users', label: 'Users & roles', icon: '🔐', group: 'Admin', area: 'admin' },
    { id: 'audit', label: 'Audit trail', icon: '🕵️', group: 'Admin', area: 'admin' },
    { id: 'automation', label: 'Automation', icon: '⚙️', group: 'Admin', area: 'admin' },
    { id: 'settings', label: 'Settings', icon: '🛠️', group: 'Admin', area: 'admin' },
  ],
  pages: { dashboard, inventory, orders, customers, crm, marketing, gst, greetings, partners, website, whatsapp, users, audit, automation, settings },
});
