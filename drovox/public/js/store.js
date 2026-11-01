// Drovox storefront (hash-routed single-page app).
import { $, $$, api, esc, money, num, toast, modal, art, local, getToken, setToken, formData, badge, dt, printInvoice } from './common.js';

const S = { cfg: null, user: null, cats: [], quoteCache: null };
const app = $('#app');

// ---------------------------------------------------------------- cart (localStorage + server copy)
const cart = {
  items: () => local.get('drv_cart', []),
  save(items) { local.set('drv_cart', items); renderCartCount(); syncCart(); },
  add(id, qty = 1) { const it = cart.items(); const f = it.find((i) => i.product_id === id); if (f) f.qty += qty; else it.push({ product_id: id, qty }); cart.save(it); },
  set(id, qty) { cart.save(cart.items().map((i) => (i.product_id === id ? { ...i, qty } : i)).filter((i) => i.qty > 0)); },
  remove(id) { cart.save(cart.items().filter((i) => i.product_id !== id)); },
  clear() { cart.save([]); },
  count: () => cart.items().reduce((s, i) => s + i.qty, 0),
};
let syncT;
function syncCart() { if (!S.user) return; clearTimeout(syncT); syncT = setTimeout(() => api('/cart/sync', { method: 'POST', body: { items: cart.items() } }).catch(() => {}), 800); }
function renderCartCount() { const n = cart.count(); const el = $('#cart-count'); el.textContent = n; el.classList.toggle('hidden', !n); }
const recent = { get: () => local.get('drv_recent', []), push(id) { local.set('drv_recent', [id, ...recent.get().filter((x) => x !== id)].slice(0, 12)); } };

async function addToCart(p, qty = 1, opts = {}) {
  if (p.stock <= 0) return toast('This item is out of stock', 'err');
  cart.add(p.id, qty);
  api('/events', { method: 'POST', body: { type: 'add_to_cart', product_id: p.id } }).catch(() => {});
  if (opts.silent) return;
  try {
    const q = await api('/cart/quote', { method: 'POST', body: { items: cart.items(), state_code: S.user?.state_code } });
    const fs = q.free_shipping;
    toast(`✅ Added <b>${esc(p.name.slice(0, 40))}</b>${fs.unlocked ? ' · Free shipping unlocked 🎉' : ` · Add ${money(fs.remaining)} more for free shipping`} <a class="link" href="#/cart" style="color:#ffb347">View cart →</a>`);
  } catch { toast('Added to cart'); }
}

// ---------------------------------------------------------------- shared UI
function productCard(p) {
  const tags = [p.off_pct >= 30 ? `<span class="badge red">-${p.off_pct}%</span>` : '', p.growth_pct >= 50 && p.sold_7d ? '<span class="badge brand">🔥 Trending</span>' : '',
    p.stock <= 0 ? '<span class="badge">Sold out</span>' : p.low_stock ? `<span class="badge amber">Only ${p.stock} left</span>` : ''].join('');
  return `<div class="pcard"><div class="tags">${tags}</div>
    <a href="#/p/${esc(p.slug)}">${art(p)}</a>
    <a href="#/p/${esc(p.slug)}" class="name">${esc(p.name)}</a>
    <div><span class="price">${money(p.price)}</span>${p.mrp > p.price ? `<span class="mrp">${money(p.mrp)}</span>` : ''}</div>
    ${p.best_bulk_price ? `<div class="bulk">Bulk from ${money(p.best_bulk_price)}/pc</div>` : '<div class="bulk">&nbsp;</div>'}
    <button class="btn ${p.stock > 0 ? 'primary' : ''} sm add" data-add="${p.id}" ${p.stock > 0 ? '' : 'data-notify="1"'}>${p.stock > 0 ? 'Add to cart' : '🔔 Notify me'}</button></div>`;
}
const PRODUCT_CACHE = new Map();
function rememberProducts(list) { for (const p of list) PRODUCT_CACHE.set(p.id, p); return list; }
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-add]'); if (!b) return;
  e.preventDefault();
  const p = PRODUCT_CACHE.get(Number(b.dataset.add)); if (!p) return;
  if (b.dataset.notify) return notifyMe(p);
  addToCart(p, 1);
});
function notifyMe(p) {
  const m = modal(`<h2>Notify me</h2><p class="muted">We'll WhatsApp you as soon as <b>${esc(p.name)}</b> is back in stock.</p>
    <form class="form"><label class="f">WhatsApp number<input name="phone" required value="${esc(S.user?.phone || '')}" placeholder="10-digit mobile"></label><button class="btn primary">Notify me</button></form>`);
  $('form', m.el).onsubmit = async (e) => { e.preventDefault(); try { const r = await api('/stock-alerts', { method: 'POST', body: { product_id: p.id, phone: formData(e.target).phone } }); toast(r.message); m.close(); } catch (err) { toast(err.message, 'err'); } };
}
const grid = (list, cls = 'products') => `<div class="${cls}">${rememberProducts(list).map(productCard).join('')}</div>`;
const section = (title, sub, body, link) => `<section class="section"><div class="section-h"><div><h2>${title}</h2>${sub ? `<div class="muted small">${sub}</div>` : ''}</div>${link || ''}</div>${body}</section>`;
function requireLogin(next) { if (S.user) return true; location.hash = `#/login?next=${encodeURIComponent(next || location.hash)}`; return false; }
function setTitle(t) { document.title = t ? `${t} · Drovox` : 'Drovox Components'; }

// ---------------------------------------------------------------- header, search, categories
function renderHeader() {
  $('#nav-account-lbl').textContent = S.user ? `${S.user.name.split(' ')[0]} · ${num(S.user.points)} pts` : 'Sign in';
  $('#nav-account').href = S.user ? '#/account' : '#/login';
  const path = location.hash.split('?')[0];
  $('#catbar').innerHTML = `<a href="#/search" class="${path === '#/search' ? 'on' : ''}">All products</a>` + S.cats.map((c) => `<a href="#/c/${c.slug}" class="${path === '#/c/' + c.slug ? 'on' : ''}">${c.icon} ${esc(c.name)}</a>`).join('') + '<a href="#/builder">✨ AI Project Builder</a>';
}
let sugT;
$('#q').addEventListener('input', (e) => {
  clearTimeout(sugT); const q = e.target.value.trim(); const box = $('#suggest');
  if (q.length < 2) { box.classList.add('hidden'); return; }
  sugT = setTimeout(async () => {
    const r = await api(`/products?q=${encodeURIComponent(q)}&per=6`).catch(() => null);
    if (!r) return;
    box.innerHTML = (r.corrected ? `<div class="small muted" style="padding:6px 8px">Showing results for <b>${esc(r.corrected)}</b></div>` : '') +
      (r.items.map((p) => `<a href="#/p/${esc(p.slug)}">${art(p, 'xs')}<span class="small" style="flex:1">${esc(p.name)}</span><b class="small">${money(p.price)}</b></a>`).join('') ||
      `<div class="small" style="padding:8px">No matches. <a class="link" href="#/builder?idea=${encodeURIComponent(q)}">Ask the AI Project Builder →</a></div>`);
    box.classList.remove('hidden');
  }, 180);
});
$('#q').addEventListener('blur', () => setTimeout(() => $('#suggest').classList.add('hidden'), 200));
$('#search-form').addEventListener('submit', (e) => { e.preventDefault(); $('#suggest').classList.add('hidden'); location.hash = `#/search?q=${encodeURIComponent($('#q').value.trim())}`; });

// ---------------------------------------------------------------- pages
async function pageHome() {
  setTitle('');
  const [home, recentItems] = await Promise.all([api('/home'), recent.get().length ? api('/products/batch', { method: 'POST', body: { ids: recent.get() } }) : []]);
  const today = new Date().toISOString().slice(0, 10);
  const checkin = S.user && S.user.last_checkin !== today
    ? `<div class="banner brand section"><div>🎁 <b>Daily check-in:</b> collect ${S.cfg.loyalty.daily_checkin} Drovox points today${S.user.checkin_streak ? ` · ${S.user.checkin_streak}-day streak, keep it going for a 7-day bonus!` : ''}</div><button class="btn primary sm" id="checkin">Collect points</button></div>` : '';
  const refer = S.user ? `<div class="banner teal section"><div>🤝 <b>Refer a friend:</b> they get ${S.cfg.loyalty.referee_bonus} points, you get ${S.cfg.loyalty.referrer_bonus} when their first order is delivered. Your code <span class="code">${esc(S.user.referral_code)}</span></div><a class="btn sm" href="#/account">Share</a></div>`
    : `<div class="banner teal section"><div>🎉 New here? Sign up for <b>${S.cfg.loyalty.signup_bonus} bonus points</b> and use <span class="code">${esc(S.cfg.engagement.welcome_coupon)}</span> for 10% off your first order.</div><a class="btn sm primary" href="#/register">Create account</a></div>`;
  app.innerHTML = `
    <div class="hero">
      <div><span class="badge brand">Imported direct · Tested in India</span><h1 style="margin-top:12px">Every component for your next build.</h1>
        <p>Arduino, ESP32, Raspberry Pi, sensors, motors, drone and 3D-printer parts — with bulk pricing, GST invoices and same-day dispatch.</p>
        <div class="row" style="margin-top:16px"><a class="btn primary lg" href="#/search">Shop all parts</a><a class="btn lg" style="background:transparent;color:#fff;border-color:#475569" href="#/bulk">Bulk / college quote</a></div></div>
      <form class="ai-box" id="hero-ai"><div style="font-weight:700;margin-bottom:6px">✨ Tell us what you want to build</div>
        <textarea name="idea" placeholder="e.g. A line follower robot for a college competition, 2 units, budget ₹3000"></textarea>
        <button class="btn primary block" style="margin-top:10px">Build my parts list &amp; fill my cart</button>
        <div class="tiny" style="color:#94a3b8;margin-top:6px">Powered by Claude AI — picks real in-stock parts from our catalogue.</div></form>
    </div>
    <div class="usp"><div>🚀<span><b>Same-day dispatch</b>Order before 3 PM</span></div><div>🧾<span><b>GST invoice</b>Claim input credit</span></div><div>📦<span><b>Bulk pricing</b>Tiered per-unit rates</span></div><div>⭐<span><b>Earn points</b>${S.cfg.loyalty.earn_per_100} pts per ₹100</span></div></div>
    ${checkin}
    ${section('Shop by category', '', `<div class="cats">${S.cats.map((c) => `<a href="#/c/${c.slug}"><span>${c.icon}</span>${esc(c.name)}<div class="tiny muted">${c.count} items</div></a>`).join('')}</div>`)}
    ${section('🔥 Trending now', 'What makers across India are buying this week', grid(home.trending, 'hscroll'), '<a class="link small" href="#/search?sort=popular">See all →</a>')}
    ${home.recommended.length ? section('Recommended for you', 'Based on what you browsed and what others bought with it', grid(home.recommended, 'hscroll')) : ''}
    ${refer}
    ${section('💸 Best deals', 'Biggest savings on MRP', grid(home.deals, 'hscroll'), '<a class="link small" href="#/search?sort=discount">All deals →</a>')}
    ${recentItems.length ? section('Recently viewed', '', grid(recentItems, 'hscroll')) : ''}
    ${section('New arrivals', '', grid(home.new_arrivals, 'hscroll'), '<a class="link small" href="#/search?sort=newest">See all →</a>')}`;
  $('#hero-ai').onsubmit = (e) => { e.preventDefault(); const idea = formData(e.target).idea.trim(); location.hash = `#/builder?idea=${encodeURIComponent(idea)}&go=1`; };
  $('#checkin')?.addEventListener('click', async () => { const r = await api('/me/checkin', { method: 'POST' }); toast(r.already ? 'Already collected today' : `+${r.points} points · ${r.streak}-day streak 🔥`); await loadMe(); pageHome(); });
}

async function pageListing(params, catSlug) {
  const cat = S.cats.find((c) => c.slug === catSlug);
  const q = params.get('q') || ''; const sort = params.get('sort') || 'popular';
  setTitle(cat ? cat.name : q ? `Search: ${q}` : 'All products');
  $('#q').value = q;
  const qs = new URLSearchParams({ q, sort, per: 60, ...(catSlug ? { cat: catSlug } : {}), ...(params.get('in_stock') ? { in_stock: '1' } : {}), ...(params.get('max') ? { max: params.get('max') } : {}) });
  const r = await api(`/products?${qs}`);
  const set = (k, v) => { const p = new URLSearchParams(params); v ? p.set(k, v) : p.delete(k); return `${location.hash.split('?')[0]}?${p}`; };
  app.innerHTML = `<div class="listing">
    <aside class="filters"><div class="card flat stack">
      <h3>Filters</h3>
      <label class="f">Sort by<select id="sort">${[['popular', 'Most popular'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low'], ['discount', 'Biggest discount'], ['newest', 'Newest']].map(([v, l]) => `<option value="${v}" ${v === sort ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="check"><input type="checkbox" id="instock" ${params.get('in_stock') ? 'checked' : ''}> In stock only</label>
      <div><div class="f">Max price</div><div class="row" style="gap:6px;margin-top:6px">${[200, 500, 1000, 5000].map((m) => `<a class="chip ${params.get('max') == m ? 'on' : ''}" href="${set('max', params.get('max') == m ? '' : m)}">≤ ${money(m)}</a>`).join('')}</div></div>
      <hr class="sep"><div class="small muted">Can't find a part? <a class="link" href="#/builder">Ask the AI builder</a> or <a class="link" href="#/bulk">request a quote</a>.</div>
    </div></aside>
    <div><div class="row between" style="margin-bottom:12px"><div><h1 style="margin:0">${cat ? `${cat.icon} ${esc(cat.name)}` : q ? `Results for “${esc(r.corrected || q)}”` : 'All products'}</h1>
      <div class="muted small">${r.total} products${r.corrected ? ` · corrected from “${esc(q)}”` : ''}</div></div></div>
      ${r.items.length ? grid(r.items) : `<div class="empty card"><div class="big">🔍</div><h3>No products found</h3><p>Describe your project and our AI will find the right parts.</p><a class="btn primary" href="#/builder?idea=${encodeURIComponent(q)}">Open AI Project Builder</a></div>`}
    </div></div>`;
  $('#sort').onchange = (e) => { location.hash = set('sort', e.target.value); };
  $('#instock').onchange = (e) => { location.hash = set('in_stock', e.target.checked ? '1' : ''); };
}

async function pageProduct(slug) {
  const p = await api(`/products/${encodeURIComponent(slug)}`);
  rememberProducts([p, ...p.bought_together, ...p.similar, ...(p.bundle?.items || [])]);
  recent.push(p.id); setTitle(p.name);
  let qty = 1;
  const unitFor = (n) => p.tiers.reduce((u, t) => (n >= t.min_qty ? Math.min(u, t.price) : u), p.price);
  const proof = p.social ? [p.social.viewing_now > 1 ? `<span>👀 ${p.social.viewing_now} people viewing now</span>` : '', p.social.sold_24h ? `<span>🛒 ${p.social.sold_24h} sold in the last 24h</span>` : '', p.social.buyers_30d ? `<span>⭐ ${p.social.buyers_30d} buyers this month</span>` : ''].join('') : '';
  app.innerHTML = `<div class="small muted" style="margin-bottom:12px"><a href="#/">Home</a> / <a href="#/c/${p.category.slug}">${esc(p.category.name)}</a> / ${esc(p.sku)}</div>
    <div class="pdp">
      <div>${art(p, 'lg')}</div>
      <div class="stack">
        <div class="row"><span class="badge">${esc(p.brand || 'Drovox')}</span><span class="badge">SKU ${esc(p.sku)}</span>${p.stock <= 0 ? '<span class="badge red">Out of stock</span>' : p.low_stock ? `<span class="badge amber">Hurry — only ${p.stock} left</span>` : '<span class="badge green">In stock · ships today</span>'}</div>
        <h1>${esc(p.name)}</h1>
        ${proof ? `<div class="proof">${proof}</div>` : ''}
        <div><span class="price-big" id="unit">${money(p.price)}</span> ${p.mrp > p.price ? `<span class="muted" style="text-decoration:line-through">${money(p.mrp)}</span> <span class="badge red">${p.off_pct}% off</span>` : ''}
          <div class="small muted">Inclusive of ${p.gst_rate}% GST · HSN ${esc(p.hsn)} · GST invoice provided</div></div>
        ${p.tiers.length ? `<div><div class="f" style="margin-bottom:6px">Bulk pricing — buy more, pay less per unit</div><div class="tiers" id="tiers"><div data-q="1" class="on"><b>1+</b><br>${money(p.price)}/pc</div>${p.tiers.map((t) => `<div data-q="${t.min_qty}"><b>${t.min_qty}+</b><br>${money(t.price)}/pc <span class="tiny" style="color:var(--teal)">save ${Math.round((1 - t.price / p.price) * 100)}%</span></div>`).join('')}</div></div>` : ''}
        <div class="row"><div class="qty"><button id="minus" aria-label="Decrease">−</button><input id="qty" value="1" inputmode="numeric" aria-label="Quantity"><button id="plus" aria-label="Increase">+</button></div>
          <div><b id="line">${money(p.price)}</b> <span class="small muted" id="nudge"></span></div></div>
        <div class="row">${p.stock > 0 ? '<button class="btn primary lg" id="add">Add to cart</button><button class="btn dark lg" id="buy">Buy now</button>' : '<button class="btn primary lg" id="notify">🔔 Notify me when back</button>'}
          <a class="btn lg" href="#/bulk?sku=${esc(p.sku)}">Bulk quote</a></div>
        <div class="small muted">⭐ Earn ~${Math.floor(p.price / 100 * S.cfg.loyalty.earn_per_100)} Drovox points · 🚚 Free shipping above ${money(S.cfg.shipping.free_above)} · 💵 COD available</div>
        <hr class="sep"><p>${esc(p.description)}</p>
        <table class="specs">${Object.entries(p.specs).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
      </div>
    </div>
    ${p.bundle ? section('🧩 Frequently bought together', 'Customers who bought this also added these', `<div class="card row between"><div class="row">${p.bundle.items.map((x, i) => `${i ? '<b>+</b>' : ''}<a href="#/p/${esc(x.slug)}" title="${esc(x.name)}">${art(x, 'sm')}</a>`).join('')}
        <div class="small">${p.bundle.items.map((x) => esc(x.name.split('(')[0])).join(' + ')}</div></div><div class="row"><b>${money(p.bundle.total)}</b><button class="btn primary" id="bundle">Add all ${p.bundle.items.length} to cart</button></div></div>`) : ''}
    ${p.bought_together.length > 2 ? section('Complete your build', '', grid(p.bought_together)) : ''}
    ${section('Similar products', '', grid(p.similar, 'hscroll'))}`;
  const qtyEl = $('#qty');
  const update = () => {
    qty = Math.max(1, Math.min(999, parseInt(qtyEl.value, 10) || 1)); qtyEl.value = qty;
    const u = unitFor(qty); $('#unit').textContent = money(u); $('#line').textContent = money(u * qty);
    const next = p.tiers.find((t) => t.min_qty > qty);
    $('#nudge').innerHTML = next ? `Add ${next.min_qty - qty} more to pay ${money(next.price)}/pc` : p.tiers.length ? '✓ Best bulk price applied' : '';
    $$('#tiers > div').forEach((d) => d.classList.toggle('on', Number(d.dataset.q) <= qty && !p.tiers.some((t) => t.min_qty > Number(d.dataset.q) && t.min_qty <= qty)));
  };
  qtyEl.oninput = update; $('#minus').onclick = () => { qtyEl.value = qty - 1; update(); }; $('#plus').onclick = () => { qtyEl.value = qty + 1; update(); };
  $$('#tiers > div').forEach((d) => { d.onclick = () => { qtyEl.value = d.dataset.q; update(); }; });
  $('#add')?.addEventListener('click', () => addToCart(p, qty));
  $('#buy')?.addEventListener('click', () => { addToCart(p, qty, { silent: true }); location.hash = '#/checkout'; });
  $('#notify')?.addEventListener('click', () => notifyMe(p));
  $('#bundle')?.addEventListener('click', () => { p.bundle.items.forEach((x) => addToCart(x, 1, { silent: true })); toast(`Added ${p.bundle.items.length} items to your cart`); });
}

function summaryHtml(q, { showGst = true } = {}) {
  return `<div class="summary">
    <div class="r-line"><span>Items (${q.lines.reduce((s, l) => s + l.qty, 0)})</span><span>${money(q.subtotal, 2)}</span></div>
    ${q.discount ? `<div class="r-line" style="color:var(--green)"><span>Coupon ${esc(q.coupon.code)}</span><span>−${money(q.discount, 2)}</span></div>` : ''}
    ${q.points_redeemed ? `<div class="r-line" style="color:var(--green)"><span>${q.points_redeemed} points redeemed</span><span>−${money(q.points_value, 2)}</span></div>` : ''}
    <div class="r-line"><span>Shipping</span><span>${q.shipping ? money(q.shipping, 2) : '<b style="color:var(--green)">FREE</b>'}</span></div>
    ${q.cod_fee ? `<div class="r-line"><span>COD handling</span><span>${money(q.cod_fee, 2)}</span></div>` : ''}
    <div class="r-line total"><span>Total</span><span>${money(q.total, 2)}</span></div>
    ${showGst ? `<div class="small muted" style="margin-top:6px">Includes GST ${money(q.gst.total_tax, 2)} — ${q.gst.intra_state ? `CGST ${money(q.gst.cgst, 2)} + SGST ${money(q.gst.sgst, 2)}` : `IGST ${money(q.gst.igst, 2)}`} · Taxable ${money(q.gst.taxable, 2)} · Place of supply ${esc(q.gst.state)}</div>` : ''}
    ${q.savings > 0 ? `<div class="badge green" style="margin-top:10px">🎉 You save ${money(q.savings)} on this order</div>` : ''}
    <div class="small" style="margin-top:8px">⭐ You'll earn <b>${q.points_earned} points</b> (${esc(q.tier.name)} tier${q.tier.multiplier > 1 ? `, ${q.tier.multiplier}× bonus` : ''})</div></div>`;
}

async function pageCart() {
  setTitle('Cart');
  const items = cart.items();
  if (!items.length) {
    const rec = await api('/recommendations', { method: 'POST', body: { recent_ids: recent.get() } });
    app.innerHTML = `<div class="empty card"><div class="big">🛒</div><h2>Your cart is empty</h2><p>Not sure what you need? Describe your project and let the AI fill your cart.</p><div class="row" style="justify-content:center"><a class="btn primary" href="#/builder">✨ AI Project Builder</a><a class="btn" href="#/search">Browse products</a></div></div>${section('You might like', '', grid(rec, 'hscroll'))}`;
    return;
  }
  const st = local.get('drv_checkout', {});
  const q = await api('/cart/quote', { method: 'POST', body: { items, coupon_code: st.coupon, redeem_points: st.points ? 'max' : 0, state_code: S.user?.state_code } });
  if (q.coupon_error && st.coupon) { toast(q.coupon_error, 'err'); local.set('drv_checkout', { ...st, coupon: '' }); }
  // drop lines that vanished, clamp quantities to stock
  const valid = q.lines.map((l) => ({ product_id: l.product_id, qty: l.qty }));
  if (JSON.stringify(valid) !== JSON.stringify(items)) local.set('drv_cart', valid);
  q.warnings.forEach((w) => toast(w, 'err'));
  const rec = await api('/recommendations', { method: 'POST', body: { recent_ids: q.lines.map((l) => l.product_id), limit: 6 } });
  const fs = q.free_shipping;
  app.innerHTML = `<h1>Your cart</h1><div class="cart-layout"><div class="stack">
      <div class="card flat">${fs.unlocked ? '<div>🎉 <b>Free shipping unlocked!</b></div>' : `<div class="small">Add <b>${money(fs.remaining)}</b> more for <b>FREE shipping</b></div>`}<div class="progress" style="margin-top:8px"><i style="width:${Math.min(100, ((fs.threshold - fs.remaining) / fs.threshold) * 100)}%"></i></div></div>
      <div class="card">${q.lines.map((l) => `<div class="line">${art(l, 'sm')}
        <div><a href="#/p/${esc(l.slug)}" style="font-weight:600">${esc(l.name)}</a><div class="small muted">${money(l.unit_price)} each${l.unit_price < l.list_price ? ` <span class="badge green">bulk price</span>` : ''} · ${l.gst_rate}% GST incl.</div>
          ${l.nudge ? `<span class="nudge" data-nudge="${l.product_id}" data-add-qty="${l.nudge.add}">💡 Add ${l.nudge.add} more → ${money(l.nudge.unit_price)}/pc (save ${money(l.nudge.save)})</span>` : ''}
          ${l.stock <= 5 ? `<div class="tiny" style="color:var(--amber)">Only ${l.stock} left in stock</div>` : ''}</div>
        <div class="r"><div class="qty"><button data-dec="${l.product_id}">−</button><input value="${l.qty}" data-qty="${l.product_id}" inputmode="numeric"><button data-inc="${l.product_id}">+</button></div>
          <div style="font-weight:700;margin-top:6px">${money(l.line_total)}</div><a class="small link" data-rm="${l.product_id}">Remove</a></div></div>`).join('')}</div>
      ${rec.length ? section('Don’t forget these', 'Often needed with the parts in your cart', grid(rec, 'hscroll')) : ''}
    </div>
    <div class="sticky stack"><div class="card">
      <form id="coupon" class="row" style="flex-wrap:nowrap"><input name="code" placeholder="Coupon code" value="${esc(q.coupon?.code || '')}"><button class="btn">${q.coupon ? 'Change' : 'Apply'}</button></form>
      ${q.coupon ? `<div class="small" style="color:var(--green);margin-top:6px">✓ ${esc(q.coupon.description || q.coupon.code)} <a class="link" id="rmcoupon">remove</a></div>` : `<div class="tiny muted" style="margin-top:6px">Try <span class="code">${esc(S.cfg.engagement.welcome_coupon)}</span> on your first order</div>`}
      <hr class="sep">
      ${S.user ? (q.points_available ? `<label class="check"><input type="checkbox" id="usepts" ${st.points ? 'checked' : ''}> Use ${q.points_max_redeemable} of my ${num(q.points_available)} points (−${money(q.points_max_redeemable * S.cfg.loyalty.point_value)})</label><hr class="sep">` : '') : `<div class="small"><a class="link" href="#/login?next=%23%2Fcart">Sign in</a> to use your Drovox points</div><hr class="sep">`}
      ${summaryHtml(q)}
      <a class="btn primary lg block" style="margin-top:14px" href="#/checkout">Proceed to checkout</a>
      <div class="tiny muted" style="text-align:center;margin-top:8px">🔒 Secure payments · UPI · Cards · Netbanking · COD</div></div></div></div>`;
  rememberProducts(rec);
  const change = (id, qty) => { cart.set(id, qty); pageCart(); };
  $$('[data-dec]').forEach((b) => { b.onclick = () => { const l = q.lines.find((x) => x.product_id == b.dataset.dec); change(l.product_id, l.qty - 1); }; });
  $$('[data-inc]').forEach((b) => { b.onclick = () => { const l = q.lines.find((x) => x.product_id == b.dataset.inc); change(l.product_id, l.qty + 1); }; });
  $$('[data-qty]').forEach((i) => { i.onchange = () => change(Number(i.dataset.qty), Math.max(0, parseInt(i.value, 10) || 0)); });
  $$('[data-rm]').forEach((a) => { a.onclick = () => change(Number(a.dataset.rm), 0); });
  $$('[data-nudge]').forEach((a) => { a.onclick = () => { const l = q.lines.find((x) => x.product_id == a.dataset.nudge); change(l.product_id, l.qty + Number(a.dataset.addQty)); }; });
  $('#coupon').onsubmit = (e) => { e.preventDefault(); local.set('drv_checkout', { ...st, coupon: formData(e.target).code.trim() }); pageCart(); };
  $('#rmcoupon')?.addEventListener('click', () => { local.set('drv_checkout', { ...st, coupon: '' }); pageCart(); });
  $('#usepts')?.addEventListener('change', (e) => { local.set('drv_checkout', { ...st, points: e.target.checked }); pageCart(); });
}

async function pageCheckout() {
  setTitle('Checkout');
  if (!requireLogin('#/checkout')) return;
  if (!cart.items().length) { location.hash = '#/cart'; return; }
  api('/events', { method: 'POST', body: { type: 'checkout' } }).catch(() => {});
  const st = local.get('drv_checkout', {});
  const addrs = await api('/me/addresses');
  const pay = S.cfg.payments; const states = S.cfg.states;
  const def = addrs[0] || { name: S.user.name, phone: S.user.phone || '', state_code: S.user.state_code || S.cfg.store.state_code };
  let method = st.method || (pay.razorpay ? 'razorpay' : pay.test_mode ? 'test' : 'cod');
  app.innerHTML = `<h1>Checkout</h1><div class="cart-layout"><form id="co" class="stack">
      <div class="card"><h3>1. Delivery address</h3>
        ${addrs.length ? `<div class="row" style="margin-bottom:12px">${addrs.map((a, i) => `<label class="chip ${i === 0 ? 'on' : ''}"><input type="radio" name="saved" value="${a.id}" ${i === 0 ? 'checked' : ''} hidden>${esc(a.name)} · ${esc(a.city)} ${a.pincode}</label>`).join('')}<label class="chip"><input type="radio" name="saved" value="" hidden>+ New address</label></div>` : ''}
        <div class="form two" id="addr">
          <label class="f">Full name<input name="name" required value="${esc(def.name || '')}"></label>
          <label class="f">Mobile (WhatsApp updates)<input name="phone" required value="${esc(def.phone || '')}" inputmode="tel"></label>
          <label class="f full">Address line 1<input name="line1" required value="${esc(def.line1 || '')}" placeholder="House / flat, street"></label>
          <label class="f full">Address line 2 (optional)<input name="line2" value="${esc(def.line2 || '')}" placeholder="Area, landmark"></label>
          <label class="f">City<input name="city" required value="${esc(def.city || '')}"></label>
          <label class="f">PIN code<input name="pincode" required pattern="[1-9][0-9]{5}" value="${esc(def.pincode || '')}" inputmode="numeric"></label>
          <label class="f">State<select name="state_code" id="state">${Object.entries(states).map(([c, n]) => `<option value="${c}" ${c === def.state_code ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
          <label class="f">GSTIN (optional, for business invoice)<input name="gstin" id="gstin" value="${esc(S.user.gstin || '')}" placeholder="27ABCDE1234F1Z5" maxlength="15"></label>
          ${addrs.length ? '' : '<label class="check full"><input type="checkbox" name="save" checked> Save this address</label>'}
        </div></div>
      <div class="card"><h3>2. Payment</h3><div class="stack" id="pm">
        ${pay.razorpay ? `<label class="check card flat"><input type="radio" name="pm" value="razorpay" ${method === 'razorpay' ? 'checked' : ''}> <b>Pay online</b> — UPI, cards, netbanking, wallets (Razorpay)</label>` : ''}
        ${pay.test_mode ? `<label class="check card flat"><input type="radio" name="pm" value="test" ${method === 'test' ? 'checked' : ''}> <b>Pay online (test mode)</b> — simulated gateway until Razorpay keys are added</label>` : ''}
        ${pay.cod ? `<label class="check card flat"><input type="radio" name="pm" value="cod" ${method === 'cod' ? 'checked' : ''}> <b>Cash on delivery</b> — ${money(S.cfg.shipping.cod_fee)} handling, up to ${money(S.cfg.shipping.cod_max_order)}</label>` : ''}
      </div></div>
      <div class="card"><label class="f">Order notes (optional)<textarea name="notes" rows="2" placeholder="Anything we should know?"></textarea></label></div>
    </form>
    <div class="sticky"><div class="card" id="co-sum"><div class="skeleton" style="min-height:200px"></div></div></div></div>`;
  const form = $('#co');
  const refresh = async () => {
    const f = formData(form);
    const q = await api('/cart/quote', { method: 'POST', body: { items: cart.items(), coupon_code: st.coupon, redeem_points: st.points ? 'max' : 0, state_code: f.state_code, gstin: f.gstin, payment_method: method } });
    $('#co-sum').innerHTML = `<h3>Order summary</h3>${q.lines.map((l) => `<div class="r-line small" style="display:flex;justify-content:space-between;gap:8px"><span>${l.qty}× ${esc(l.name)}</span><span class="nowrap">${money(l.line_total)}</span></div>`).join('')}<hr class="sep">${summaryHtml(q)}
      ${q.warnings.map((w) => `<div class="small" style="color:var(--red)">${esc(w)}</div>`).join('')}
      <button class="btn primary lg block" id="place" style="margin-top:14px">${method === 'cod' ? 'Place order' : `Pay ${money(q.total, 2)}`}</button>
      <div class="tiny muted" style="margin-top:8px">By placing the order you agree to our terms. Order updates are sent on WhatsApp.</div>`;
    $('#place').onclick = placeOrder;
  };
  const placeOrder = async () => {
    if (!form.reportValidity()) return;
    const f = formData(form); const btn = $('#place'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Placing order…';
    try {
      const r = await api('/orders', { method: 'POST', body: { items: cart.items(), coupon_code: st.coupon, redeem_points: st.points ? 'max' : 0, payment_method: method, gstin: f.gstin || null, notes: f.notes,
        address: { name: f.name, phone: f.phone, line1: f.line1, line2: f.line2, city: f.city, pincode: f.pincode, state_code: f.state_code, save: f.save } } });
      cart.clear(); local.set('drv_checkout', {});
      const no = r.order.order_no;
      if (r.payment?.provider === 'razorpay') await payRazorpay(r, no);
      else if (r.payment?.provider === 'test') await payTest(r.order, no);
      else location.hash = `#/order/${no}?placed=1`;
      loadMe();
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; refresh(); }
  };
  form.addEventListener('change', (e) => {
    if (e.target.name === 'pm') { method = e.target.value; local.set('drv_checkout', { ...st, method }); }
    if (e.target.name === 'saved') {
      $$('label.chip', form).forEach((c) => c.classList.toggle('on', c.contains(e.target)));
      const a = addrs.find((x) => String(x.id) === e.target.value) || { name: S.user.name, phone: S.user.phone, state_code: S.user.state_code || S.cfg.store.state_code };
      for (const k of ['name', 'phone', 'line1', 'line2', 'city', 'pincode', 'state_code']) form.elements[k].value = a[k] || '';
    }
    if (['pm', 'state_code', 'gstin', 'saved'].includes(e.target.name)) refresh();
  });
  refresh();
}

function loadScript(src) { return new Promise((ok, fail) => { if ($(`script[src="${src}"]`)) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = fail; document.head.append(s); }); }
async function payRazorpay(r, no) {
  await loadScript('https://checkout.razorpay.com/v1/checkout.js');
  const p = r.payment;
  const rz = new window.Razorpay({ key: p.key_id, amount: p.amount, currency: p.currency, name: p.name, order_id: p.order_id, prefill: p.prefill, theme: { color: '#ff5a1f' },
    handler: async (resp) => { try { await api(`/orders/${no}/pay/verify`, { method: 'POST', body: resp }); location.hash = `#/order/${no}?placed=1`; } catch (e) { toast(e.message, 'err'); location.hash = `#/order/${no}`; } },
    modal: { ondismiss: () => { toast('Payment not completed — you can retry from your order page within 30 minutes', 'err'); location.hash = `#/order/${no}`; } } });
  rz.open();
}
function payTest(order, no) {
  return new Promise((done) => {
    const m = modal(`<h2>Test payment gateway</h2><p class="muted">Razorpay keys are not configured yet, so this simulates the payment step. Add keys in Master → Settings → Payments to accept real payments.</p>
      <div class="card flat"><div class="row between"><span>Order ${esc(no)}</span><b>${money(order.total, 2)}</b></div></div>
      <div class="row" style="margin-top:16px"><button class="btn primary lg" id="ok">✓ Simulate successful payment</button><button class="btn" id="no">Cancel</button></div>`, { onClose: () => { location.hash = `#/order/${no}`; done(); } });
    $('#ok', m.el).onclick = async () => { await api(`/orders/${no}/pay/test`, { method: 'POST' }); m.close(); location.hash = `#/order/${no}?placed=1`; done(); };
    $('#no', m.el).onclick = () => m.close();
  });
}

const FLOW = ['confirmed', 'packed', 'shipped', 'out_for_delivery', 'delivered'];
const FLOW_LABEL = { confirmed: 'Confirmed', packed: 'Packed', shipped: 'Shipped', out_for_delivery: 'Out for delivery', delivered: 'Delivered' };
const stepsHtml = (status) => { const i = FLOW.indexOf(status); return `<div class="steps">${FLOW.map((s, k) => `<div class="${k <= i ? 'on' : ''}"><i></i>${FLOW_LABEL[s]}</div>`).join('')}</div>`; };

async function pageOrder(no, params) {
  if (!requireLogin()) return;
  const o = await api(`/orders/${encodeURIComponent(no)}`);
  setTitle(`Order ${o.order_no}`);
  const placed = params.get('placed') && o.status !== 'pending_payment';
  app.innerHTML = `${placed ? `<div class="banner teal" style="margin-bottom:16px"><div><h2 style="margin:0">🎉 Thank you! Your order is confirmed.</h2><div class="small">We've sent the confirmation on WhatsApp to ${esc(o.ship_phone)}. You'll earn <b>${o.points_earned} points</b> when it's delivered.</div></div></div>` : ''}
    <div class="row between"><div><h1 style="margin:0">Order ${esc(o.order_no)}</h1><div class="muted small">Placed ${dt(o.created_at)} · ${o.items.length} items</div></div><div class="row">${badge(o.status, o.status_label)}
      ${o.invoice_no ? '<button class="btn sm" id="inv">🧾 GST invoice</button>' : ''}<button class="btn sm" id="reorder">↻ Buy again</button>${['pending_payment', 'confirmed'].includes(o.status) ? '<button class="btn sm danger" id="cancel">Cancel order</button>' : ''}</div></div>
    ${!['cancelled', 'returned', 'pending_payment'].includes(o.status) ? stepsHtml(o.status) : ''}
    ${o.status === 'pending_payment' ? `<div class="banner brand" style="margin:14px 0"><div>⏳ Awaiting payment. Unpaid online orders are released after 30 minutes.</div>${o.payment_method === 'test' ? '<button class="btn primary sm" id="paynow">Complete payment</button>' : ''}</div>` : ''}
    <div class="cart-layout" style="margin-top:16px"><div class="stack">
      <div class="card">${o.items.map((i) => `<div class="line">${art(i, 'sm')}<div><b>${esc(i.name)}</b><div class="small muted">${esc(i.sku)} · ${i.qty} × ${money(i.unit_price)}</div></div><b>${money(i.unit_price * i.qty)}</b></div>`).join('')}</div>
      <div class="card"><h3>Tracking</h3>${o.awb ? `<p>Shipped via <b>${esc(o.courier)}</b> · AWB <span class="code">${esc(o.awb)}</span></p>` : ''}<ul class="timeline">${o.events.map((e) => `<li><b>${esc(e.note || e.status)}</b><div class="small muted">${dt(e.created_at)}</div></li>`).join('')}</ul></div>
    </div><div class="stack"><div class="card"><h3>Payment</h3>
      <div class="r-line" style="display:flex;justify-content:space-between"><span>Subtotal</span><span>${money(o.subtotal, 2)}</span></div>
      ${o.discount ? `<div style="display:flex;justify-content:space-between;color:var(--green)"><span>Coupon ${esc(o.coupon_code)}</span><span>−${money(o.discount, 2)}</span></div>` : ''}
      ${o.points_redeemed ? `<div style="display:flex;justify-content:space-between;color:var(--green)"><span>Points</span><span>−${money(o.points_redeemed * S.cfg.loyalty.point_value, 2)}</span></div>` : ''}
      <div style="display:flex;justify-content:space-between"><span>Shipping${o.cod_fee ? ' + COD' : ''}</span><span>${money(o.shipping + o.cod_fee, 2)}</span></div>
      <div style="display:flex;justify-content:space-between;font-weight:800;font-size:1.15rem;border-top:1px solid var(--line);margin-top:8px;padding-top:8px"><span>Total</span><span>${money(o.total, 2)}</span></div>
      <div class="small muted" style="margin-top:6px">GST: ${o.igst ? `IGST ${money(o.igst, 2)}` : `CGST ${money(o.cgst, 2)} + SGST ${money(o.sgst, 2)}`} · ${esc(o.payment_method.toUpperCase())} · ${esc(o.payment_status)}</div></div>
      <div class="card"><h3>Delivery to</h3><div>${esc(o.ship_name)}</div><div class="small muted">${esc(o.ship_address)}<br>${esc(o.ship_phone)}</div>${o.gstin ? `<div class="small">GSTIN ${esc(o.gstin)}</div>` : ''}</div></div></div>`;
  $('#inv')?.addEventListener('click', async () => printInvoice(await api(`/orders/${o.order_no}/invoice`)));
  $('#reorder').onclick = async () => { const items = await api(`/orders/${o.order_no}/reorder`, { method: 'POST' }); items.forEach((i) => cart.add(i.product_id, i.qty)); toast('Items added to your cart'); location.hash = '#/cart'; };
  $('#cancel')?.addEventListener('click', async () => { if (!confirm('Cancel this order?')) return; try { await api(`/orders/${o.order_no}/cancel`, { method: 'POST' }); toast('Order cancelled'); pageOrder(no, new URLSearchParams()); loadMe(); } catch (e) { toast(e.message, 'err'); } });
  $('#paynow')?.addEventListener('click', () => payTest(o, o.order_no));
}

async function pageOrders() {
  setTitle('My orders');
  if (!requireLogin()) return;
  const rows = await api('/orders');
  app.innerHTML = `<h1>My orders</h1>${rows.length ? `<div class="card table-wrap"><table class="t"><thead><tr><th>Order</th><th>Date</th><th>Items</th><th>Total</th><th>Status</th></tr></thead><tbody>
    ${rows.map((o) => `<tr class="click" data-href="#/order/${o.order_no}"><td><b>${esc(o.order_no)}</b></td><td>${dt(o.created_at)}</td><td>${o.items}</td><td>${money(o.total)}</td><td>${badge(o.status, o.status_label)}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty card"><div class="big">📦</div><h3>No orders yet</h3><a class="btn primary" href="#/">Start shopping</a></div>'}`;
  $$('[data-href]').forEach((r) => { r.onclick = () => { location.hash = r.dataset.href; }; });
}

async function pageTrack(no, params) {
  setTitle('Track order');
  app.innerHTML = `<div style="max-width:640px;margin:0 auto"><h1>Track your order</h1><form class="card form two" id="tf"><label class="f">Order number<input name="no" required value="${esc(no || '')}" placeholder="DRV2611…"></label>
    <label class="f">Last 4 digits of phone<input name="phone" maxlength="4" inputmode="numeric" value="${esc(params.get('phone') || '')}" ${S.user ? '' : 'required'}></label><button class="btn primary full">Track</button></form><div id="tr"></div></div>`;
  const show = async (n, ph) => {
    try {
      const t = await api(`/track/${encodeURIComponent(n)}?phone=${encodeURIComponent(ph || '')}`);
      $('#tr').innerHTML = `<div class="card" style="margin-top:16px"><div class="row between"><h2 style="margin:0">${esc(t.order_no)}</h2>${badge(t.status, t.status_label)}</div>
        ${!['cancelled', 'returned', 'pending_payment'].includes(t.status) ? stepsHtml(t.status) : ''}
        ${t.awb ? `<p>Courier <b>${esc(t.courier)}</b> · AWB <span class="code">${esc(t.awb)}</span> ${t.tracking_url ? `<a class="link" target="_blank" rel="noopener" href="${esc(t.tracking_url)}">Live courier tracking →</a>` : ''}</p>` : ''}
        <ul class="timeline">${t.events.map((e) => `<li><b>${esc(e.note || e.status)}</b><div class="small muted">${dt(e.created_at)}</div></li>`).join('')}</ul></div>`;
    } catch (e) { $('#tr').innerHTML = `<div class="card" style="margin-top:16px;color:var(--red)">${esc(e.message)}</div>`; }
  };
  $('#tf').onsubmit = (e) => { e.preventDefault(); const f = formData(e.target); show(f.no.trim(), f.phone); };
  if (no && (S.user || params.get('phone'))) show(no, params.get('phone'));
}

async function pageBuilder(params) {
  setTitle('AI Project Builder');
  const examples = ['Line follower robot for a college competition, 2 units', 'ESP32 weather station with OLED display', 'Quadcopter drone with 450 mm frame', 'Smart plant watering system', 'Robotic arm with 4 servos', 'WiFi home automation for 4 appliances'];
  app.innerHTML = `<div style="max-width:900px;margin:0 auto"><div class="hero" style="grid-template-columns:1fr"><div><span class="badge brand">✨ AI Project Builder</span><h1 style="margin-top:10px">Describe your idea. Get a ready cart.</h1>
      <p>Our Claude-powered engineer reads your idea, picks compatible in-stock parts from the Drovox catalogue, sets quantities and adds everything to your cart in one click.</p>
      <form id="bf" class="ai-box stack"><textarea name="idea" rows="3" placeholder="What do you want to build? Mention quantity and budget if you have one.">${esc(params.get('idea') || '')}</textarea>
        <div class="row">${examples.map((x) => `<span class="chip" style="background:rgba(255,255,255,.1);color:#fff;border-color:rgba(255,255,255,.2)" data-ex="${esc(x)}">${esc(x)}</span>`).join('')}</div>
        <button class="btn primary lg">Generate parts list</button></form></div></div><div id="br"></div></div>`;
  const run = async (idea) => {
    const out = $('#br'); out.innerHTML = '<div class="card" style="margin-top:16px"><span class="spinner"></span> Designing your build and checking stock…</div>';
    try {
      const r = await api('/ai/build', { method: 'POST', body: { idea } });
      rememberProducts(r.items.map((i) => ({ ...i, id: i.product_id })));
      out.innerHTML = `<div class="card ai-result" style="margin-top:16px"><div class="row between"><div><h2 style="margin:0">${esc(r.project_title)}</h2><div class="small muted">${esc(r.difficulty)} · ~${r.est_build_hours}h build · ${r.engine === 'claude' ? 'designed by Claude AI' : 'matched by keywords'}</div></div><b style="font-size:1.3rem">≈ ${money(r.estimated_total)}</b></div>
        <p>${esc(r.summary)}</p>
        ${r.items.map((i) => `<div class="line"><input type="checkbox" checked data-pick="${i.product_id}">${art(i, 'sm')}<div><a class="link" href="#/p/${esc(i.slug)}"><b>${esc(i.name)}</b></a><div class="small muted">${esc(i.reason)}</div></div>
          <div class="r"><div class="qty"><input value="${i.qty}" data-q="${i.product_id}" inputmode="numeric" style="width:60px"></div><div class="small">${money(i.price)} each</div></div></div>`).join('') || '<p class="muted">No matching parts found — try describing the project differently, or request a quote.</p>'}
        ${r.missing?.length ? `<div class="banner brand" style="margin-top:10px"><div><b>Not in our catalogue yet:</b> ${r.missing.map((m) => `${esc(m.part)} (${esc(m.note)})`).join(', ')} — <a class="link" href="#/bulk">ask us to source it</a></div></div>` : ''}
        ${r.steps?.length ? `<details style="margin-top:12px"><summary><b>Build steps</b></summary><ol>${r.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></details>` : ''}
        <div class="row" style="margin-top:16px"><button class="btn primary lg" id="addall">🛒 Add selected to cart</button><a class="btn" href="#/bulk">Need ${r.estimated_total > 5000 ? 'a bulk discount' : 'more units'}? Get a quote</a></div></div>`;
      $('#addall')?.addEventListener('click', () => {
        let n = 0;
        for (const cb of $$('[data-pick]')) if (cb.checked) { const id = Number(cb.dataset.pick); const q = Math.max(1, parseInt($(`[data-q="${id}"]`).value, 10) || 1); cart.add(id, q); n++; }
        toast(`Added ${n} parts to your cart 🎉`); location.hash = '#/cart';
      });
    } catch (e) { out.innerHTML = `<div class="card" style="margin-top:16px;color:var(--red)">${esc(e.message)}</div>`; }
  };
  $('#bf').onsubmit = (e) => { e.preventDefault(); const idea = formData(e.target).idea.trim(); if (idea) run(idea); };
  $$('[data-ex]').forEach((c) => { c.onclick = () => { $('#bf textarea').value = c.dataset.ex; run(c.dataset.ex); }; });
  if (params.get('go') && params.get('idea')) run(params.get('idea'));
}

function pageBulk(params) {
  setTitle('Bulk quote');
  app.innerHTML = `<div style="max-width:720px;margin:0 auto"><h1>Bulk &amp; institutional orders</h1><p class="muted">Colleges, labs, startups and resellers — get special pricing on large quantities, PO-based billing and sourcing of parts not on the site. We reply within one working day.</p>
    <form class="card form two" id="lf"><label class="f">Your name<input name="name" required value="${esc(S.user?.name || '')}"></label><label class="f">Organisation<input name="company"></label>
      <label class="f">Email<input name="email" type="email" value="${esc(S.user?.email || '')}"></label><label class="f">Phone / WhatsApp<input name="phone" value="${esc(S.user?.phone || '')}"></label>
      <label class="f full">What do you need?<textarea name="interest" rows="4" required placeholder="e.g. 60 × Arduino UNO, 60 × HC-SR04 for our robotics lab">${params.get('sku') ? esc(`SKU ${params.get('sku')} — quantity: `) : ''}</textarea></label>
      <label class="f">Approx. quantity<input name="quantity" placeholder="e.g. 100 units"></label><label class="f">Budget (₹, optional)<input name="value_estimate" type="number" min="0"></label>
      <button class="btn primary lg full">Request quote</button></form></div>`;
  $('#lf').onsubmit = async (e) => { e.preventDefault(); try { const r = await api('/leads', { method: 'POST', body: { ...formData(e.target), source: 'bulk_quote' } }); app.innerHTML = `<div class="empty card"><div class="big">✅</div><h2>Request received</h2><p>${esc(r.message)}</p><a class="btn primary" href="#/">Continue shopping</a></div>`; } catch (err) { toast(err.message, 'err'); } };
}

function pageAuth(mode, params) {
  setTitle(mode === 'login' ? 'Sign in' : 'Create account');
  const next = params.get('next') || '#/account';
  const ref = params.get('ref') || local.get('drv_ref', '');
  app.innerHTML = `<div style="max-width:440px;margin:0 auto"><div class="card"><h1>${mode === 'login' ? 'Welcome back' : 'Create your Drovox account'}</h1>
    ${mode === 'register' ? `<p class="muted small">Get ${S.cfg.loyalty.signup_bonus} bonus points${ref ? ` + ${S.cfg.loyalty.referee_bonus} referral points` : ''} instantly.</p>` : ''}
    <form class="form" id="af">${mode === 'register' ? '<label class="f">Full name<input name="name" required autocomplete="name"></label><label class="f">Mobile (for WhatsApp order updates)<input name="phone" required inputmode="tel" autocomplete="tel"></label>' : ''}
      <label class="f">Email<input name="email" type="email" required autocomplete="email"></label><label class="f">Password<input name="password" type="password" required minlength="6" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></label>
      ${mode === 'register' ? `<label class="f">Referral code (optional)<input name="referral_code" value="${esc(ref)}"></label>` : ''}
      <button class="btn primary lg">${mode === 'login' ? 'Sign in' : 'Create account'}</button></form>
    <p class="small" style="margin-top:14px">${mode === 'login' ? `New to Drovox? <a class="link" href="#/register?next=${encodeURIComponent(next)}">Create an account</a>` : `Already have an account? <a class="link" href="#/login?next=${encodeURIComponent(next)}">Sign in</a>`}</p>
    ${mode === 'login' ? '<p class="tiny muted">Demo customer: demo@drovox.in / demo123</p>' : ''}</div></div>`;
  $('#af').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api(`/auth/${mode}`, { method: 'POST', body: formData(e.target) });
      setToken(r.token); await loadMe();
      if (mode === 'register') { local.del('drv_ref'); toast(`Welcome to Drovox! ${num(r.user.points)} points added 🎉`); }
      // merge any cart saved on the server from another device
      const saved = await api('/cart/saved').catch(() => []);
      if (saved.length && !cart.items().length) local.set('drv_cart', saved);
      renderCartCount(); syncCart();
      location.hash = next;
    } catch (err) { toast(err.message, 'err'); }
  };
}

async function pageAccount() {
  setTitle('My account');
  if (!requireLogin()) return;
  await loadMe();
  const [ledger, refs] = await Promise.all([api('/me/points'), api('/me/referrals')]);
  const u = S.user; const t = u.tier;
  const link = `${location.origin}/#/register?ref=${u.referral_code}`;
  const share = `Use my code ${u.referral_code} on Drovox to get ${S.cfg.loyalty.referee_bonus} bonus points on electronics & robotics parts: ${link}`;
  app.innerHTML = `<div class="row between"><h1>Hi, ${esc(u.name.split(' ')[0])} 👋</h1><div class="row">${u.can?.stock ? '<a class="btn sm" href="/stockist">Stockist panel</a>' : ''}${u.can?.admin ? '<a class="btn sm" href="/master">Master panel</a>' : ''}<a class="btn sm" href="#/orders">My orders</a><button class="btn sm" id="logout">Sign out</button></div></div>
    <div class="grid g3">
      <div class="card kpi"><div class="l">Drovox points</div><div class="v">${num(u.points)}</div><div class="small muted">Worth ${money(u.points * S.cfg.loyalty.point_value)} · use up to ${S.cfg.loyalty.max_redeem_pct}% of an order</div></div>
      <div class="card kpi"><div class="l">Tier</div><div class="v">${esc(t.name)}</div><div class="small muted">${t.multiplier}× points${t.next ? ` · spend ${money(t.next.remaining)} more for ${esc(t.next.name)}` : ' · top tier!'}</div>${t.next ? `<div class="progress" style="margin-top:8px"><i style="width:${Math.min(100, (t.spend / (t.spend + t.next.remaining)) * 100)}%"></i></div>` : ''}</div>
      <div class="card kpi"><div class="l">Check-in streak</div><div class="v">${u.checkin_streak || 0} 🔥</div><button class="btn sm primary" id="checkin" ${u.last_checkin === new Date().toISOString().slice(0, 10) ? 'disabled' : ''}>Collect today's ${S.cfg.loyalty.daily_checkin} points</button></div>
    </div>
    <div class="grid g2 section">
      <div class="card"><h3>🤝 Refer &amp; earn</h3><p class="small">Friends get <b>${S.cfg.loyalty.referee_bonus} points</b> on signup. You get <b>${S.cfg.loyalty.referrer_bonus} points</b> when their first order is delivered.</p>
        <div class="row"><span class="code" style="font-size:1.1rem">${esc(u.referral_code)}</span><button class="btn sm" id="copy">Copy link</button><a class="btn sm primary" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(share)}">Share on WhatsApp</a></div>
        <hr class="sep">${refs.friends.length ? `<table class="t"><tbody>${refs.friends.map((f) => `<tr><td>${esc(f.name)}</td><td>${f.status === 'rewarded' ? `<span class="badge green">+${f.reward_points} pts</span>` : '<span class="badge amber">awaiting first delivery</span>'}</td></tr>`).join('')}</tbody></table>` : '<div class="small muted">No referrals yet.</div>'}</div>
      <div class="card"><h3>Points history</h3><div class="table-wrap" style="max-height:280px;overflow-y:auto"><table class="t"><tbody>${ledger.map((l) => `<tr><td>${esc({ order: 'Order delivered', redeem: 'Redeemed', signup: 'Signup bonus', referred: 'Referral bonus', referral: 'Friend’s first order', checkin: 'Daily check-in', refund: 'Refunded', return: 'Order returned', manual: 'Adjustment' }[l.reason] || l.reason)} <span class="tiny muted">${esc(l.ref || '')}</span></td><td class="r" style="color:${l.change > 0 ? 'var(--green)' : 'var(--red)'}">${l.change > 0 ? '+' : ''}${l.change}</td><td class="small muted nowrap">${dt(l.created_at, false)}</td></tr>`).join('') || '<tr><td class="muted">No activity yet</td></tr>'}</tbody></table></div></div>
    </div>
    <div class="card section"><h3>Profile</h3><form class="form two" id="pf"><label class="f">Name<input name="name" value="${esc(u.name)}"></label><label class="f">Mobile<input name="phone" value="${esc(u.phone || '')}"></label>
      <label class="f">Company<input name="company" value="${esc(u.company || '')}"></label><label class="f">GSTIN<input name="gstin" value="${esc(u.gstin || '')}" maxlength="15"></label>
      <label class="check full"><input type="checkbox" name="whatsapp_opt_in" ${u.whatsapp_opt_in ? 'checked' : ''}> Send me order updates and offers on WhatsApp</label>
      <label class="f">New password (optional)<input name="password" type="password" minlength="6" autocomplete="new-password"></label><div class="full"><button class="btn primary">Save</button></div></form></div>`;
  $('#logout').onclick = () => { setToken(null); S.user = null; renderHeader(); location.hash = '#/'; };
  $('#copy').onclick = () => { navigator.clipboard?.writeText(link); toast('Referral link copied'); };
  $('#checkin').onclick = async () => { const r = await api('/me/checkin', { method: 'POST' }); toast(r.already ? 'Already collected today' : `+${r.points} points · ${r.streak}-day streak 🔥`); pageAccount(); };
  $('#pf').onsubmit = async (e) => { e.preventDefault(); const f = formData(e.target); if (!f.password) delete f.password; try { await api('/me', { method: 'PUT', body: f }); toast('Profile saved'); loadMe(); } catch (err) { toast(err.message, 'err'); } };
}

// ---------------------------------------------------------------- engagement: exit intent offer
function exitIntent() {
  if (!S.cfg.engagement.exit_intent || local.get('drv_exit_shown') || S.user) return;
  document.addEventListener('mouseout', function onOut(e) {
    if (e.relatedTarget || e.clientY > 0) return;
    document.removeEventListener('mouseout', onOut); local.set('drv_exit_shown', 1);
    const m = modal(`<div style="text-align:center"><div style="font-size:3rem">🎁</div><h2>Wait — here's 10% off your first order</h2><p class="muted">Create a free account to get <b>${S.cfg.loyalty.signup_bonus} bonus points</b>, then use this code at checkout:</p>
      <div class="code" style="font-size:1.5rem;display:inline-block;padding:8px 16px;margin:6px 0 14px">${esc(S.cfg.engagement.welcome_coupon)}</div><div class="row" style="justify-content:center"><a class="btn primary lg" href="#/register" id="go">Claim my offer</a></div></div>`);
    $('#go', m.el).onclick = () => { local.set('drv_checkout', { ...local.get('drv_checkout', {}), coupon: S.cfg.engagement.welcome_coupon }); m.close(); };
  });
}

// ---------------------------------------------------------------- router & boot
async function loadMe() {
  if (!getToken()) { S.user = null; renderHeader(); return; }
  try { S.user = await api('/me'); } catch { S.user = null; }
  renderHeader();
}

async function route() {
  const [path, qs] = location.hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(qs || '');
  const parts = (path || '/').split('/').filter(Boolean);
  $$('.modal-wrap').forEach((m) => m.remove());
  renderHeader(); window.scrollTo(0, 0);
  if (params.get('ref')) local.set('drv_ref', params.get('ref'));
  try {
    switch (parts[0]) {
      case undefined: await pageHome(); break;
      case 'c': await pageListing(params, parts[1]); break;
      case 'search': await pageListing(params); break;
      case 'p': await pageProduct(decodeURIComponent(parts[1])); break;
      case 'cart': await pageCart(); break;
      case 'checkout': await pageCheckout(); break;
      case 'orders': await pageOrders(); break;
      case 'order': await pageOrder(parts[1], params); break;
      case 'track': await pageTrack(parts[1], params); break;
      case 'builder': await pageBuilder(params); break;
      case 'bulk': pageBulk(params); break;
      case 'login': pageAuth('login', params); break;
      case 'register': pageAuth('register', params); break;
      case 'account': await pageAccount(); break;
      default: app.innerHTML = '<div class="empty card"><div class="big">🤖</div><h2>Page not found</h2><a class="btn primary" href="#/">Go home</a></div>';
    }
  } catch (e) {
    app.innerHTML = `<div class="empty card"><div class="big">⚠️</div><h2>${esc(e.message)}</h2><a class="btn primary" href="#/">Go home</a></div>`;
  }
}

(async function boot() {
  [S.cfg, S.cats] = await Promise.all([api('/config'), api('/categories')]);
  $('#tb-free').textContent = S.cfg.shipping.free_above;
  $('#ft-contact').innerHTML = `${esc(S.cfg.store.support_phone)}<br>${esc(S.cfg.store.support_email)}<br>${esc(S.cfg.store.address)}`;
  await loadMe(); renderCartCount(); syncCart();
  window.addEventListener('hashchange', route); route(); exitIntent();
})();
