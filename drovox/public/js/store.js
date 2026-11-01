// Drovox storefront (hash-routed single-page app).
import { $, $$, api, esc, money, num, toast, modal, art, local, getToken, setToken, formData, badge, dt, printInvoice, imgUrl } from './common.js';
import { pageServices, pagePartner, accountServices } from './services.js';
import { policyPage, paymentBadges } from './policies.js';
import { pageProjects, pageProject, projectCard } from './projects-ui.js';
import { initNative, syncPushToken, unlinkPush, share, isApp } from './native.js';
import { isAppUI, mountShell, updateShell, setCounts, pageCategories, pageAccountApp, pageNotifications, pageWaitlist, pageAddresses, emptyCart, homeExtras } from './appshell.js';

const S = { cfg: null, user: null, cats: [], quoteCache: null, site: { site: {}, banners: [], reviews: [] } };
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
function renderCartCount() { const n = cart.count(); const el = $('#cart-count'); el.textContent = n; el.classList.toggle('hidden', !n); setCounts({ cart: n, wish: wish.get().length }); }
const idList = (key, max) => ({
  get: () => local.get(key, []),
  has(id) { return this.get().includes(id); },
  toggle(id) { const l = this.get(); const on = !l.includes(id); local.set(key, on ? [id, ...l].slice(0, max) : l.filter((x) => x !== id)); renderCounts(); return on; },
  remove(id) { local.set(key, this.get().filter((x) => x !== id)); renderCounts(); },
});
const wish = idList('drv_wish', 100); const compare = idList('drv_compare', 4);
function renderCounts() {
  for (const [id, n] of [['wish-count', wish.get().length], ['cmp-count', compare.get().length]]) { const el = $('#' + id); if (el) { el.textContent = n; el.classList.toggle('hidden', !n); } }
  setCounts({ cart: cart.count(), wish: wish.get().length });
}
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
  return `<div class="pcard"><div class="tags">${tags}</div><div class="pc-actions"><button data-wish="${p.id}" class="${wish.has(p.id) ? 'on' : ''}" title="Wishlist" aria-label="Add to wishlist">${wish.has(p.id) ? '♥' : '♡'}</button><button data-cmp="${p.id}" class="${compare.has(p.id) ? 'on' : ''}" title="Compare" aria-label="Add to compare">⇄</button></div>
    <a href="#/p/${esc(p.slug)}">${art(p)}</a>
    <a href="#/p/${esc(p.slug)}" class="name">${esc(p.name)}</a>
    <div><span class="price">${money(p.price)}</span>${p.mrp > p.price ? `<span class="mrp">${money(p.mrp)}</span>` : ''}</div>
    ${p.best_bulk_price ? `<div class="bulk">Bulk from ${money(p.best_bulk_price)}/pc</div>` : '<div class="bulk">&nbsp;</div>'}
    <button class="btn ${p.stock > 0 ? 'primary' : ''} sm add" data-add="${p.id}" ${p.stock > 0 ? '' : 'data-notify="1"'}>${p.stock > 0 ? 'Add to cart' : '🔔 Notify me'}</button></div>`;
}
const PRODUCT_CACHE = new Map();
function rememberProducts(list) { for (const p of list) PRODUCT_CACHE.set(p.id, p); return list; }
document.addEventListener('click', (e) => {
  const w = e.target.closest('[data-wish]');
  if (w) { e.preventDefault(); const on = wish.toggle(Number(w.dataset.wish)); $$(`[data-wish="${w.dataset.wish}"]`).forEach((x) => { x.classList.toggle('on', on); if (x.textContent.length <= 2) x.textContent = on ? '♥' : '♡'; }); toast(on ? '♥ Saved to your wishlist' : 'Removed from wishlist'); return; }
  const c = e.target.closest('[data-cmp]');
  if (c) { e.preventDefault(); const id = Number(c.dataset.cmp); if (!compare.has(id) && compare.get().length >= 4) return toast('You can compare up to 4 products — remove one first', 'err'); const on = compare.toggle(id); $$(`[data-cmp="${id}"]`).forEach((x) => x.classList.toggle('on', on)); toast(on ? `Added to compare (${compare.get().length}/4) <a class="link" href="#/compare" style="color:#ffb347">Compare now →</a>` : 'Removed from compare'); return; }
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
  $('#allcats-menu').innerHTML = `<a href="#/search"><span>All products</span><span>›</span></a>` + S.cats.map((c) => `<a href="#/c/${c.slug}"><span>${c.icon} ${esc(c.name)}</span><span class="tiny muted">${c.count || ''}</span></a>`).join('') + '<a href="#/services"><span>🛠️ Services</span><span>›</span></a>';
  $$('#mainlinks a').forEach((a) => { const h = a.getAttribute('href'); a.classList.toggle('on', h === (location.hash || '#/') || (h.length > 2 && !h.includes('?') && h !== '#/search' && path.startsWith(h))); });
  renderCounts();
  $('#catbar').innerHTML = `<a href="#/search" class="${path === '#/search' ? 'on' : ''}">All products</a>` + S.cats.filter((c) => c.count).map((c) => `<a href="#/c/${c.slug}" class="${path === '#/c/' + c.slug ? 'on' : ''}">${c.icon} ${esc(c.name)}</a>`).join('') + '<a href="#/builder">✨ AI Project Builder</a><a href="#/services">🛠️ 3D Print · PCB · Laser · Battery</a><a href="#/partner">🤝 Become a Partner</a>';
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
// ---- home page blocks (Robu-style): service tiles + banner slider, service cards, reviews
const TILE_SERVICES = [['pcb', 'PCB Manufacturing', '🟩'], ['print3d', '3D Printing', '🖨️'], ['laser', 'Laser Cutting', '🔥'], ['battery', 'Custom Battery Pack', '🔋']];
function sliderHtml() {
  const slides = S.site.banners.length ? S.site.banners.map((b) => b.image
    ? `<a class="slide img-only" href="${esc(b.link || '#/search')}" style="background-color:${esc(b.bg)};background-image:url('/uploads/site/${encodeURIComponent(b.image)}')" aria-label="${esc(b.title)}"></a>`
    : `<div class="slide" style="background:linear-gradient(120deg, ${esc(b.bg)}, #1e293b 75%)"><div><h2>${esc(b.title)}</h2>${b.subtitle ? `<p>${esc(b.subtitle)}</p>` : ''}${b.cta_text ? `<a class="btn primary lg" href="${esc(b.link || '#/search')}" style="margin-top:12px">${esc(b.cta_text)}</a>` : ''}</div></div>`)
    : [`<div class="slide" style="background:radial-gradient(1000px 400px at 90% -20%, #ffb34755, transparent), linear-gradient(135deg, #0f172a, #1e293b 60%, #3b1d12)"><div><span class="badge brand">Imported direct · Tested in India</span><h2 style="margin-top:12px">Every component for your next build.</h2>
        <p>Arduino, ESP32, sensors, motors, drone and 3D-printer parts — bulk pricing, GST invoices, same-day dispatch.</p><div class="row" style="margin-top:12px"><a class="btn primary" href="#/search">Shop all parts</a><a class="btn" style="background:transparent;color:#fff;border-color:#475569" href="#/bulk">Bulk quote</a></div></div>
        <form class="ai-box" id="hero-ai"><div style="font-weight:700;margin-bottom:6px">✨ Tell us what you want to build</div><textarea name="idea" placeholder="e.g. A line follower robot, 2 units, budget ₹3000"></textarea><button class="btn primary block" style="margin-top:10px">Build my parts list</button></form></div>`,
      `<div class="slide" style="background:linear-gradient(120deg, #2B1A7A, #13203A 70%)"><div><span class="badge brand">Drovox Services</span><h2 style="margin-top:12px">3D printing, PCBs, laser cutting & battery packs</h2><p>Upload your design and get an instant estimate.</p><a class="btn primary lg" href="#/services" style="margin-top:12px">Explore services</a></div></div>`,
      `<div class="slide" style="background:linear-gradient(120deg, #0d6b5e, #13203A 70%)"><div><span class="badge brand">Atal Tinkering Labs</span><h2 style="margin-top:12px">Complete ATL kits for schools</h2><p>Equipment lists, GST invoices and GeM-ready quotations.</p><a class="btn primary lg" href="#/atl" style="margin-top:12px">ATL kits enquiry</a></div></div>`];
  return `<div class="slider" id="slider">${slides.join('')}<div class="dots">${slides.map((_, i) => `<button data-dot="${i}" aria-label="Slide ${i + 1}"></button>`).join('')}</div></div>`;
}
let slideTimer;
function startSlider() {
  clearInterval(slideTimer);
  const el = $('#slider'); if (!el) return;
  const slides = $$('.slide', el); const dots = $$('[data-dot]', el); let i = 0;
  const show = (n) => { i = (n + slides.length) % slides.length; slides.forEach((x, k) => x.classList.toggle('on', k === i)); dots.forEach((x, k) => x.classList.toggle('on', k === i)); };
  dots.forEach((d) => { d.onclick = () => { show(Number(d.dataset.dot)); startAuto(); }; });
  const startAuto = () => { clearInterval(slideTimer); if (slides.length > 1) slideTimer = setInterval(() => { if (!document.body.contains(el)) return clearInterval(slideTimer); show(i + 1); }, Math.max(2, Number(S.site.site.banner_seconds) || 5) * 1000); };
  show(0); startAuto();
}
async function servicesSection() {
  const cat = await api('/services').catch(() => null);
  if (!cat?.services?.length) return '';
  return section('🛠️ Drovox services', 'Upload your design, see an instant price, get it made', `<div class="svc-cards">${cat.services.map((v) => `<a class="svc-card" href="#/services/${v.id}"><div class="txt"><h3>Drovox ${esc(v.title)}</h3><span class="btn indigo sm">Order now</span></div><div class="pic">${v.icon}</div></a>`).join('')}</div>`);
}
function reviewsSection() {
  const r = S.site.reviews; if (!r.length) return '';
  const avg = r.reduce((s, x) => s + x.rating, 0) / r.length;
  const colors = ['#8E44AD', '#2E86C1', '#117A65', '#CA6F1E', '#B03A2E', '#2E4053'];
  return section(esc(S.site.site.reviews_title || 'What our customers say'), '', `<div class="reviews"><div class="rev-summary"><h3 style="margin:0">Customer reviews</h3><div class="stars" style="font-size:1.4rem">${'★'.repeat(Math.round(avg))}</div><div class="small muted">${avg.toFixed(1)} average from ${r.length} review${r.length > 1 ? 's' : ''}</div>
    ${S.site.site.google_reviews_url ? `<a class="link small" target="_blank" rel="noopener" href="${esc(S.site.site.google_reviews_url)}">Read all / write a review on Google →</a>` : ''}</div>
    <div class="rev-track">${r.map((x, k) => `<div class="rev"><div class="row"><div class="av" style="background:${colors[k % colors.length]}">${esc(x.name[0] || '?')}</div><div><b class="small">${esc(x.name)}</b><div class="tiny muted">${[x.review_date, x.source].filter(Boolean).map(esc).join(' · ')}</div></div></div>
      <div class="stars" aria-label="${x.rating} out of 5">${'★'.repeat(x.rating)}${'☆'.repeat(5 - x.rating)} ${x.verified ? '<span class="badge blue" style="letter-spacing:0">verified</span>' : ''}</div><p class="small" style="margin:0">${esc(x.text)}</p></div>`).join('')}</div></div>`);
}

async function pageHome() {
  setTitle('');
  const [home, recentItems, svcHtml, proj, posts] = await Promise.all([api('/home'), recent.get().length ? api('/products/batch', { method: 'POST', body: { ids: recent.get() } }) : [], servicesSection(), api('/projects').catch(() => ({ rows: [] })), api('/posts').catch(() => [])]);
  const top = `<div class="home-top">${isAppUI() ? '' : `<div class="svc-tiles">${TILE_SERVICES.map(([id, name, ic]) => `<a href="#/services/${id}">${esc(name)}<span>${ic}</span></a>`).join('')}</div>`}${sliderHtml()}</div>`;
  const hasStock = home.trending.length || home.new_arrivals.length;
  const today = new Date().toISOString().slice(0, 10);
  const checkin = S.user && S.user.last_checkin !== today
    ? `<div class="banner brand section"><div>🎁 <b>Daily check-in:</b> collect ${S.cfg.loyalty.daily_checkin} Drovox points today${S.user.checkin_streak ? ` · ${S.user.checkin_streak}-day streak, keep it going for a 7-day bonus!` : ''}</div><button class="btn primary sm" id="checkin">Collect points</button></div>` : '';
  const refer = S.user ? `<div class="banner teal section"><div>🤝 <b>Refer a friend:</b> they get ${S.cfg.loyalty.referee_bonus} points, you get ${S.cfg.loyalty.referrer_bonus} when their first order is delivered. Your code <span class="code">${esc(S.user.referral_code)}</span></div><a class="btn sm" href="#/account">Share</a></div>`
    : `<div class="banner teal section"><div>🎉 New here? Sign up for <b>${S.cfg.loyalty.signup_bonus} bonus points</b>${S.cfg.engagement.welcome_coupon ? ` and use <span class="code">${esc(S.cfg.engagement.welcome_coupon)}</span> on your first order` : ''}.</div><a class="btn sm primary" href="#/register">Create account</a></div>`;
  app.innerHTML = `${top}
    <div class="usp"><div>🚀<span><b>Same-day dispatch</b>Order before 3 PM</span></div><div>🧾<span><b>GST invoice</b>Claim input credit</span></div><div>📦<span><b>Bulk pricing</b>Tiered per-unit rates</span></div><div>⭐<span><b>Earn points</b>${S.cfg.loyalty.earn_per_100} pts per ₹100</span></div></div>
    ${checkin}
    ${!S.cats.some((c) => c.count) ? '' : section('Categories', '', `<div class="cats">${S.cats.filter((c) => c.count).map((c) => `<a href="#/c/${c.slug}"><span>${c.icon}</span>${esc(c.name)}<div class="tiny muted">${c.count} items</div></a>`).join('')}</div>`, '<a class="btn sm" href="#/search">View all</a>')}
    ${hasStock ? section('🔥 Trending now', 'What makers across India are buying this week', grid(home.trending, 'hscroll'), '<a class="link small" href="#/search?sort=popular">See all →</a>') : `<div class="banner brand section"><div>🛒 Our catalogue is being stocked right now — services are open, and you can <a class="link" href="#/bulk">request any part</a>.</div></div>`}
    ${S.site.site.show_services_on_home === false || isAppUI() ? '' : svcHtml}
    ${proj.rows.length ? section('🛠️ DIY projects', 'Pick a project, add the whole parts kit in one click', `<div class="pj-grid">${proj.rows.slice(0, 4).map(projectCard).join('')}</div>`, '<a class="link small" href="#/projects">All projects →</a>') : ''}
    ${home.recommended.length ? section('Recommended for you', 'Based on what you browsed and what others bought with it', grid(home.recommended, 'hscroll')) : ''}
    ${refer}
    ${home.deals.length ? section('💸 Best deals', 'Biggest savings on MRP', grid(home.deals, 'hscroll'), '<a class="link small" href="#/search?sort=discount">All deals →</a>') : ''}
    ${recentItems.length ? section('Recently viewed', '', grid(recentItems, 'hscroll')) : ''}
    ${home.new_arrivals.length ? section('New arrivals', '', grid(home.new_arrivals, 'hscroll'), '<a class="link small" href="#/search?sort=newest">See all →</a>') : ''}
    ${reviewsSection()}
    ${homeExtras(S, posts)}`;
  startSlider();
  $('#hero-ai')?.addEventListener('submit', (e) => { e.preventDefault(); const idea = formData(e.target).idea.trim(); location.hash = `#/builder?idea=${encodeURIComponent(idea)}&go=1`; });
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
    <aside class="filters"><button type="button" class="btn filt-toggle" onclick="this.parentNode.classList.toggle('open')">⚙ Filters &amp; sort</button><div class="card flat stack">
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

/** Photo gallery: thumbnails, hover zoom (desktop), full-screen viewer with arrows / swipe. */
function gallery(p) {
  const n = p.images.length;
  return `<div class="gal"><div class="gal-thumbs">${n > 1 ? p.images.map((k, i) => `<button type="button" data-gi="${i}" class="${i ? '' : 'on'}" aria-label="Photo ${i + 1}"><img src="${imgUrl(k, 's')}" alt="" loading="lazy" decoding="async" width="72" height="72"></button>`).join('') : ''}</div>
    <div class="gal-main" id="gmain" role="button" tabindex="0" aria-label="Open photo viewer">${art(p, 'lg').replace(/^<div class="art photo lg">|<\/div>$/g, '')}<div class="zoom"></div>${n > 1 ? `<span class="gal-count" id="gcount">1 / ${n}</span>` : ''}</div></div>`;
}
function wireGallery(p) {
  if (!p.images.length) return;
  let cur = 0; const main = $('#gmain'); const img = $('img', main); const zoom = $('.zoom', main);
  p.images.forEach((k) => { const i = new Image(); i.src = imgUrl(k, 'm'); });   // preload the other photos
  const show = (i) => {
    cur = (i + p.images.length) % p.images.length; const k = p.images[cur];
    img.src = imgUrl(k, 'm'); img.srcset = `${imgUrl(k, 'm')} 900w, ${imgUrl(k, 'l')} 1600w`;
    zoom.classList.remove('ready'); zoom.style.backgroundImage = '';
    $$('[data-gi]').forEach((b) => b.classList.toggle('on', Number(b.dataset.gi) === cur));
    if ($('#gcount')) $('#gcount').textContent = `${cur + 1} / ${p.images.length}`;
  };
  $$('[data-gi]').forEach((b) => { b.onclick = () => show(Number(b.dataset.gi)); b.onmouseenter = () => show(Number(b.dataset.gi)); });
  main.addEventListener('mousemove', (e) => {
    if (!zoom.style.backgroundImage) { const big = new Image(); big.onload = () => zoom.classList.add('ready'); big.src = imgUrl(p.images[cur], 'l'); zoom.style.backgroundImage = `url('${big.src}')`; }
    const r = main.getBoundingClientRect(); zoom.style.backgroundPosition = `${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`;
  });
  let sx = null; main.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  main.addEventListener('touchend', (e) => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 40) show(cur + (dx < 0 ? 1 : -1)); sx = null; });
  const open = () => {
    const lb = document.createElement('div'); lb.className = 'lightbox';
    lb.innerHTML = `<img alt="${esc(p.name)}"><button class="lb-x" aria-label="Close">✕</button>${p.images.length > 1 ? '<button class="lb-p" aria-label="Previous">‹</button><button class="lb-n" aria-label="Next">›</button>' : ''}`;
    const set = () => { $('img', lb).src = imgUrl(p.images[cur], 'l'); };
    const close = () => { lb.remove(); document.removeEventListener('keydown', key); };
    const key = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') { show(cur + 1); set(); } if (e.key === 'ArrowLeft') { show(cur - 1); set(); } };
    lb.onclick = (e) => { if (e.target === lb || e.target.classList.contains('lb-x')) close(); };
    $('.lb-p', lb)?.addEventListener('click', () => { show(cur - 1); set(); }); $('.lb-n', lb)?.addEventListener('click', () => { show(cur + 1); set(); });
    document.addEventListener('keydown', key); document.body.appendChild(lb); set();
  };
  main.onclick = open; main.onkeydown = (e) => { if (e.key === 'Enter') open(); };
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
      <div>${p.images.length ? gallery(p) : art(p, 'lg')}</div>
      <div class="stack">
        <div class="row"><span class="badge">${esc(p.brand || 'Drovox')}</span><span class="badge">SKU ${esc(p.sku)}</span>${p.stock <= 0 ? '<span class="badge red">Out of stock</span>' : p.low_stock ? `<span class="badge amber">Hurry — only ${p.stock} left</span>` : '<span class="badge green">In stock · ships today</span>'}</div>
        <h1>${esc(p.name)}</h1>
        ${p.short_description ? `<p class="pdp-short">${esc(p.short_description)}</p>` : ''}
        ${p.highlights.length ? `<ul class="pdp-hl">${p.highlights.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
        ${proof ? `<div class="proof">${proof}</div>` : ''}
        <div><span class="price-big" id="unit">${money(p.price)}</span> ${p.mrp > p.price ? `<span class="muted" style="text-decoration:line-through">${money(p.mrp)}</span> <span class="badge red">${p.off_pct}% off</span>` : ''}
          <div class="small muted">Inclusive of ${p.gst_rate}% GST · HSN ${esc(p.hsn)} · GST invoice provided</div></div>
        ${p.tiers.length ? `<div><div class="f" style="margin-bottom:6px">Bulk pricing — buy more, pay less per unit</div><div class="tiers" id="tiers"><div data-q="1" class="on"><b>1+</b><br>${money(p.price)}/pc</div>${p.tiers.map((t) => `<div data-q="${t.min_qty}"><b>${t.min_qty}+</b><br>${money(t.price)}/pc <span class="tiny" style="color:var(--teal)">save ${Math.round((1 - t.price / p.price) * 100)}%</span></div>`).join('')}</div></div>` : ''}
        <div class="row"><div class="qty"><button id="minus" aria-label="Decrease">−</button><input id="qty" value="1" inputmode="numeric" aria-label="Quantity"><button id="plus" aria-label="Increase">+</button></div>
          <div><b id="line">${money(p.price)}</b> <span class="small muted" id="nudge"></span></div></div>
        <div class="row">${p.stock > 0 ? '<button class="btn primary lg" id="add">Add to cart</button><button class="btn dark lg" id="buy">Buy now</button>' : '<button class="btn primary lg" id="notify">🔔 Notify me when back</button>'}
          <a class="btn lg" href="#/bulk?sku=${esc(p.sku)}">Bulk quote</a><button class="btn lg ${wish.has(p.id) ? 'on' : ''}" data-wish="${p.id}" title="Wishlist">♡ Wishlist</button><button class="btn lg" id="pshare" title="Share">↗ Share</button><button class="btn lg" data-cmp="${p.id}" title="Compare">⇄ Compare</button></div>
        <div class="small muted">⭐ Earn ~${Math.floor(p.price / 100 * S.cfg.loyalty.earn_per_100)} Drovox points · 🚚 Free shipping above ${money(S.cfg.shipping.free_above)} · 💵 COD available</div>
        <hr class="sep"><div class="pdp-tabs">${p.description ? `<h3>Description</h3>${p.description.split(/\n{2,}/).map((x) => `<p>${esc(x)}</p>`).join('')}` : ''}
        ${p.in_box.length ? `<h3>What's in the box</h3><ul class="pdp-hl">${p.in_box.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
        ${Object.keys(p.specs).length ? '<h3>Specifications</h3>' : ''}</div>
        <table class="specs">${Object.entries(p.specs).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
      </div>
    </div>
    ${p.bundle ? section('🧩 Frequently bought together', 'Customers who bought this also added these', `<div class="card row between"><div class="row">${p.bundle.items.map((x, i) => `${i ? '<b>+</b>' : ''}<a href="#/p/${esc(x.slug)}" title="${esc(x.name)}">${art(x, 'sm')}</a>`).join('')}
        <div class="small">${p.bundle.items.map((x) => esc(x.name.split('(')[0])).join(' + ')}</div></div><div class="row"><b>${money(p.bundle.total)}</b><button class="btn primary" id="bundle">Add all ${p.bundle.items.length} to cart</button></div></div>`) : ''}
    ${p.bought_together.length > 2 ? section('Complete your build', '', grid(p.bought_together)) : ''}
    ${section('Similar products', '', grid(p.similar, 'hscroll'))}`;
  wireGallery(p);
  $('#pshare').onclick = () => share({ title: p.name, text: `${p.name} — ${money(p.price)} at Drovox`, url: `${location.origin}/#/p/${p.slug}` });
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
    ${q.partner_discount ? `<div class="r-line" style="color:var(--green)"><span>Partner discount ${q.partner_pct}%</span><span>−${money(q.partner_discount, 2)}</span></div>` : ''}
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
    app.innerHTML = `${emptyCart()}${rec.length ? section('You might like', '', grid(rec, 'hscroll')) : ''}`;
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
      ${q.coupon ? `<div class="small" style="color:var(--green);margin-top:6px">✓ ${esc(q.coupon.description || q.coupon.code)} <a class="link" id="rmcoupon">remove</a></div>` : (S.cfg.engagement.welcome_coupon ? `<div class="tiny muted" style="margin-top:6px">Try <span class="code">${esc(S.cfg.engagement.welcome_coupon)}</span> on your first order</div>` : '')}
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
      <p class="tiny muted" style="margin:8px 0 0;text-align:center">By placing this order you agree to our <a class="link" href="#/policy/terms">Terms</a>, <a class="link" href="#/policy/refunds">Cancellation &amp; Refund</a> and <a class="link" href="#/policy/shipping">Shipping</a> policies.${method === 'cod' ? '' : ' Payments are processed securely by Razorpay.'}</p>
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
      ${o.partner_discount ? `<div style="display:flex;justify-content:space-between;color:var(--green)"><span>Partner discount</span><span>−${money(o.partner_discount, 2)}</span></div>` : ''}
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
    <form class="form" id="af">${mode === 'register' ? '<label class="f">Full name<input name="name" required autocomplete="name"></label><label class="f">Mobile (for WhatsApp order updates)<input name="phone" required inputmode="tel" autocomplete="tel"></label><label class="f">Birthday (optional — for a birthday surprise 🎂)<input name="dob" type="date"></label>' : ''}
      <label class="f">Email<input name="email" type="email" required autocomplete="email"></label><label class="f">Password<input name="password" type="password" required minlength="6" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}"></label>
      ${mode === 'register' ? `<label class="f">Referral code (optional)<input name="referral_code" value="${esc(ref)}"></label>` : ''}
      <button class="btn primary lg">${mode === 'login' ? 'Sign in' : 'Create account'}</button></form>
    <p class="small" style="margin-top:14px">${mode === 'login' ? `New to Drovox? <a class="link" href="#/register?next=${encodeURIComponent(next)}">Create an account</a>` : `Already have an account? <a class="link" href="#/login?next=${encodeURIComponent(next)}">Sign in</a>`}</p>
    </div></div>`;
  $('#af').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api(`/auth/${mode}`, { method: 'POST', body: formData(e.target) });
      setToken(r.token); await loadMe(); syncPushToken();
      if (mode === 'register') { local.del('drv_ref'); toast(`Welcome to Drovox! ${num(r.user.points)} points added 🎉`); }
      // merge any cart saved on the server from another device
      const saved = await api('/cart/saved').catch(() => []);
      if (saved.length && !cart.items().length) local.set('drv_cart', saved);
      renderCartCount(); syncCart();
      location.hash = next;
    } catch (err) { toast(err.message, 'err'); }
  };
}

// ---------------------------------------------------------------- compare, wishlist, BOM tool, ATL, blog, careers, support
async function pageCompare() {
  setTitle('Compare products');
  const items = await api('/products/compare', { method: 'POST', body: { ids: compare.get() } });
  if (!items.length) { app.innerHTML = '<div class="empty card"><div class="big">⇄</div><h2>Nothing to compare yet</h2><p>Tap ⇄ on up to 4 products to compare price, bulk pricing and specifications side by side.</p><a class="btn primary" href="#/search">Browse products</a></div>'; return; }
  rememberProducts(items.map((p) => ({ ...p, best_bulk_price: p.tiers.at(-1)?.price })));
  const keys = [...new Set(items.flatMap((p) => Object.keys(p.specs)))];
  const row = (label, f) => `<tr><th>${esc(label)}</th>${items.map((p) => `<td>${f(p)}</td>`).join('')}</tr>`;
  app.innerHTML = `<div class="row between"><h1>Compare products</h1><button class="btn sm" id="clr">Clear all</button></div><div class="card table-wrap"><table class="t cmp">
    <tr><th></th>${items.map((p) => `<td><a href="#/p/${esc(p.slug)}">${art(p, 'sm')}<b class="small">${esc(p.name)}</b></a><div><a class="link tiny" data-rm="${p.id}">Remove</a></div></td>`).join('')}</tr>
    ${row('Price', (p) => `<b>${money(p.price)}</b> ${p.mrp > p.price ? `<span class="muted" style="text-decoration:line-through">${money(p.mrp)}</span>` : ''}`)}
    ${row('Bulk pricing', (p) => p.tiers.map((t) => `${t.min_qty}+ : ${money(t.price)}`).join('<br>') || '—')}
    ${row('Availability', (p) => (p.stock > 0 ? `<span class="badge green">In stock (${p.stock})</span>` : '<span class="badge red">Out of stock</span>'))}
    ${row('Category', (p) => esc(p.category || ''))}${row('Brand', (p) => esc(p.brand || '—'))}${row('SKU', (p) => `<span class="code">${esc(p.sku)}</span>`)}${row('GST / HSN', (p) => `${p.gst_rate}% · ${esc(p.hsn)}`)}
    ${keys.map((k) => row(k, (p) => esc(p.specs[k] ?? '—'))).join('')}
    <tr><th></th>${items.map((p) => `<td><button class="btn primary sm" data-add="${p.id}">Add to cart</button></td>`).join('')}</tr></table></div>`;
  $$('[data-rm]').forEach((a) => { a.onclick = () => { compare.remove(Number(a.dataset.rm)); pageCompare(); }; });
  $('#clr').onclick = () => { local.set('drv_compare', []); renderCounts(); pageCompare(); };
}

async function pageWishlist() {
  setTitle('Wishlist');
  const items = wish.get().length ? await api('/products/batch', { method: 'POST', body: { ids: wish.get() } }) : [];
  app.innerHTML = items.length ? `<div class="row between"><h1>My wishlist (${items.length})</h1><button class="btn primary" id="all">Add all in-stock items to cart</button></div>${grid(items)}`
    : '<div class="empty card"><div class="big">♡</div><h2>Your wishlist is empty</h2><p>Tap ♡ on any product to save it for later.</p><a class="btn primary" href="#/search">Browse products</a></div>';
  $('#all')?.addEventListener('click', () => { const ok = items.filter((p) => p.stock > 0); ok.forEach((p) => cart.add(p.id, 1)); toast(`Added ${ok.length} items to your cart`); location.hash = '#/cart'; });
}

function pageBom() {
  setTitle('BOM Tool');
  app.innerHTML = `<div style="max-width:1000px;margin:0 auto"><h1>BOM Tool</h1><p class="muted">Paste your bill of materials — one part per line, with quantity — and we’ll match each line to our catalogue and add everything to your cart in one click. Works with lists copied from Excel, KiCad/Eagle BOM exports or plain text.</p>
    <form class="card stack" id="bf"><textarea name="text" rows="9" placeholder="2 x Arduino Uno\nHC-SR04, 4\nL298N motor driver\t2\n10 jumper wires male to male\nSG90 servo 3"></textarea>
      <div class="row"><button class="btn primary">Match parts</button><label class="btn" style="cursor:pointer">Upload CSV / TXT<input type="file" id="bfile" accept=".csv,.txt,.tsv" hidden></label><span class="small muted">Format: quantity and part name in any order.</span></div></form>
    <div id="br"></div></div>`;
  $('#bfile').onchange = async (e) => { const f = e.target.files[0]; if (f) { $('#bf textarea').value = (await f.text()).split(/\r?\n/).map((l) => l.replace(/[",;]+/g, ' ').trim()).filter(Boolean).join('\n'); } };
  $('#bf').onsubmit = async (e) => {
    e.preventDefault();
    const r = await api('/bom/match', { method: 'POST', body: { text: formData(e.target).text } });
    rememberProducts(r.rows.flatMap((x) => [x.match, ...x.alternatives]).filter(Boolean));
    const total = r.rows.reduce((s, x) => s + (x.match ? x.match.unit_price * x.qty : 0), 0);
    $('#br').innerHTML = `<div class="card section"><div class="row between"><h3 style="margin:0">${r.matched} of ${r.total} lines matched</h3><b>≈ ${money(total)}</b></div>
      ${r.rows.map((x, i) => `<div class="bom-row"><div class="small"><b>${esc(x.name)}</b><div class="tiny muted">${esc(x.line)}</div></div><input type="number" min="1" value="${x.qty}" data-q="${i}">
        <div>${x.match ? `<select data-p="${i}">${[x.match, ...x.alternatives].map((p) => `<option value="${p.id}">${esc(p.name)} — ${money(p.unit_price)}${p.stock > 0 ? '' : ' (out of stock)'}</option>`).join('')}</select>` : '<span class="small" style="color:var(--amber)">No match — <a class="link" href="#/bulk">ask us to source it</a></span>'}</div>
        <label class="check small"><input type="checkbox" data-c="${i}" ${x.match && x.match.stock > 0 ? 'checked' : ''} ${x.match ? '' : 'disabled'}> Add</label></div>`).join('')}
      <div class="row" style="margin-top:14px"><button class="btn primary lg" id="badd">🛒 Add selected to cart</button><a class="btn" href="#/bulk">Need a bulk quote instead?</a></div></div>`;
    $('#badd').onclick = () => { let n = 0; for (const c of $$('[data-c]')) if (c.checked) { const i = c.dataset.c; cart.add(Number($(`[data-p="${i}"]`).value), Math.max(1, parseInt($(`[data-q="${i}"]`).value, 10) || 1)); n++; } toast(`Added ${n} parts to your cart`); location.hash = '#/cart'; };
  };
}

function pageAtl() {
  setTitle('ATL Kits Enquiry');
  const packs = ['Electronics, robotics & IoT kits', '3D printer & rapid prototyping', 'Mechanical, electrical & measurement tools', 'Power supply, accessories & safety', 'Complete new ATL setup', 'Consumables refill (annual)'];
  app.innerHTML = `<div class="hero" style="grid-template-columns:1fr"><div><span class="badge brand">Atal Tinkering Labs</span><h1 style="margin-top:10px">ATL kits for schools</h1><p>Equipment for every ATL package — Arduino and sensor kits, robotics, 3D printers, tools and safety gear — with GST invoices, GeM-ready quotations, installation support and teacher training.</p></div></div>
    <div class="cart-layout section"><form class="card form two" id="af"><h3 class="full" style="margin:0">Request equipment list & quotation</h3>
      <label class="f full">School name<input name="school" required></label><label class="f">Contact person<input name="name" required value="${esc(S.user?.name || '')}"></label><label class="f">WhatsApp number<input name="phone" required value="${esc(S.user?.phone || '')}"></label>
      <label class="f">Email<input name="email" type="email" value="${esc(S.user?.email || '')}"></label><label class="f">City / district<input name="city"></label>
      <label class="f">Number of students<select name="students"><option>Up to 60</option><option>60–150</option><option>150+</option></select></label><label class="f">Budget (₹, optional)<input name="budget" type="number" min="0"></label>
      <div class="full"><div class="f">What do you need?</div>${packs.map((p) => `<label class="check" style="margin-top:6px"><input type="checkbox" name="pk" value="${esc(p)}"> ${esc(p)}</label>`).join('')}</div>
      <label class="f full">Message<textarea name="message" rows="3" placeholder="New lab or top-up, deadline, GeM purchase, etc."></textarea></label><button class="btn primary lg full">Send enquiry</button></form>
      <div class="card stack"><h3>Why schools choose us</h3><p class="small">✓ Kits matched to the official ATL equipment packages<br>✓ GST invoice and GeM-ready quotation<br>✓ Installation, demo and teacher training<br>✓ Project ideas and student activity guides<br>✓ Fast replacement of consumables</p><a class="btn" href="#/search">Browse components</a></div></div>`;
  $('#af').onsubmit = async (e) => { e.preventDefault(); const f = formData(e.target); f.packages = $$('[name=pk]').filter((c) => c.checked).map((c) => c.value); try { const r = await api('/atl-enquiry', { method: 'POST', body: f }); app.innerHTML = `<div class="empty card"><div class="big">✅</div><h2>Enquiry received</h2><p>${esc(r.message)}</p><a class="btn primary" href="#/">Back to home</a></div>`; } catch (err) { toast(err.message, 'err'); } };
}

async function pageBlog(slug) {
  if (slug) {
    const p = await api(`/posts/${encodeURIComponent(slug)}`); setTitle(p.title);
    const para = esc(p.body).split(/\n{2,}/).map((x) => (x.startsWith('## ') ? `<h2>${x.slice(3)}</h2>` : `<p>${x.replace(/\n/g, '<br>')}</p>`)).join('');
    app.innerHTML = `<div class="prose" style="margin:0 auto"><div class="small muted"><a href="#/blog">Blog</a> · ${dt(p.created_at, false)}</div><h1>${p.cover ? `${esc(p.cover)} ` : ''}${esc(p.title)}</h1>${p.excerpt ? `<p class="muted" style="font-size:1.15rem">${esc(p.excerpt)}</p>` : ''}${para}<hr class="sep"><a class="btn" href="#/blog">← All posts</a></div>`;
    return;
  }
  setTitle('Blog');
  const posts = await api('/posts');
  app.innerHTML = `<h1>Blog</h1><p class="muted">Tutorials, project ideas and buying guides.</p>${posts.length ? `<div class="grid g3">${posts.map((p) => `<a class="card stack" href="#/blog/${esc(p.slug)}"><div style="font-size:2.4rem">${esc(p.cover || '📝')}</div><h3 style="margin:0">${esc(p.title)}</h3><p class="small muted" style="margin:0">${esc(p.excerpt || '')}</p><span class="tiny muted">${dt(p.created_at, false)}</span></a>`).join('')}</div>` : '<div class="empty card">No posts yet.</div>'}`;
}

async function pageCareers() {
  setTitle('Careers');
  const jobs = await api('/jobs');
  app.innerHTML = `<h1>Careers at ${esc(S.cfg.store.name)}</h1><p class="muted">Join a team that helps India’s makers, students and engineers build things.</p>
    ${jobs.length ? jobs.map((j) => `<div class="card section"><div class="row between"><div><h3 style="margin:0">${esc(j.title)}</h3><div class="small muted">${esc(j.location || '')}${j.type ? ` · ${esc(j.type)}` : ''}</div></div><button class="btn primary" data-apply="${j.id}">Apply</button></div><p class="small" style="white-space:pre-line">${esc(j.description)}</p></div>`).join('') : '<div class="empty card">No open positions right now — check back soon.</div>'}`;
  $$('[data-apply]').forEach((b) => { b.onclick = () => {
    const job = jobs.find((j) => j.id === Number(b.dataset.apply));
    const m = modal(`<h2>Apply: ${esc(job.title)}</h2><form class="form"><label class="f">Full name<input name="name" required></label><label class="f">Mobile<input name="phone" required></label><label class="f">Email<input name="email" type="email"></label>
      <label class="f">Resume (PDF/DOC, max 5 MB)<input type="file" id="cv" accept=".pdf,.doc,.docx"></label><label class="f">Why do you want to join?<textarea name="message" rows="3"></textarea></label><button class="btn primary">Submit application</button></form>`);
    $('form', m.el).onsubmit = async (e) => {
      e.preventDefault(); const f = formData(e.target); const file = $('#cv', m.el).files[0];
      if (file) { if (file.size > 5 * 1048576) return toast('Resume must be under 5 MB', 'err'); f.resume = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(file); }); }
      try { const r = await api(`/jobs/${job.id}/apply`, { method: 'POST', body: f }); toast(r.message); m.close(); } catch (err) { toast(err.message, 'err'); }
    };
  }; });
}

function pageSupport() {
  setTitle('Customer support');
  const site = S.site.site || {}; const st = S.cfg.store; const phone = site.toll_free || st.support_phone;
  const wa = String(st.support_phone || '').replace(/\D/g, '');
  app.innerHTML = `<div style="max-width:900px;margin:0 auto"><h1>Customer support</h1><p class="muted">${esc(site.support_hours || '')}</p>
    <div class="grid g3">${phone ? `<a class="card stack" href="tel:${esc(phone.replace(/[^\d+]/g, ''))}"><div style="font-size:2rem">📞</div><h3 style="margin:0">Call us</h3><p class="small" style="margin:0">${esc(phone)}</p></a>` : ''}
      ${wa ? `<a class="card stack" target="_blank" rel="noopener" href="https://wa.me/${wa.length === 10 ? '91' + wa : wa}"><div style="font-size:2rem">💬</div><h3 style="margin:0">WhatsApp</h3><p class="small" style="margin:0">Chat with our team</p></a>` : ''}
      ${st.support_email ? `<a class="card stack" href="mailto:${esc(st.support_email)}"><div style="font-size:2rem">✉️</div><h3 style="margin:0">Email</h3><p class="small" style="margin:0">${esc(st.support_email)}</p></a>` : ''}</div>
    <div class="grid g3 section"><a class="card" href="#/track"><h3>📦 Track an order</h3><p class="small muted">Order number + phone</p></a><a class="card" href="#/orders"><h3>🧾 Invoices & returns</h3><p class="small muted">From My Orders</p></a><a class="card" href="#/bulk"><h3>🏫 Bulk & institutional</h3><p class="small muted">Quotes within one working day</p></a></div></div>`;
}

async function pageAccount() {
  setTitle('My account');
  if (!requireLogin()) return;
  await loadMe();
  const [ledger, refs] = await Promise.all([api('/me/points'), api('/me/referrals')]);
  const u = S.user; const t = u.tier;
  const link = `${location.origin}/#/register?ref=${u.referral_code}`;
  const share = `Use my code ${u.referral_code} on Drovox to get ${S.cfg.loyalty.referee_bonus} bonus points on electronics & robotics parts: ${link}`;
  app.innerHTML = `<div class="row between"><h1>Hi, ${esc(u.name.split(' ')[0])} 👋</h1><div class="row">${u.can?.stock && !isAppUI() ? '<a class="btn sm" href="/stockist">Stockist panel</a>' : ''}${u.can?.admin && !isAppUI() ? '<a class="btn sm" href="/master">Master panel</a>' : ''}<a class="btn sm" href="#/orders">My orders</a><button class="btn sm" id="logout">Sign out</button></div></div>
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
    <div class="grid g2 section"><div class="card"><div class="row between"><h3 style="margin:0">🛠️ My service requests</h3><a class="link small" href="#/services">New request →</a></div><div id="svc" style="margin-top:10px"><span class="spinner"></span></div></div>
      <div class="card"><h3>🤝 Partner program</h3>${u.partner_type ? `<p>You are a <b>Drovox partner</b> (${esc(u.partner_type)}). <b>${u.partner_discount}%</b> partner discount applies to every order automatically.</p>` : '<p class="small">Resellers, schools, makerspaces and integrators get a fixed discount on every order.</p><a class="btn primary sm" href="#/partner">Become a partner</a>'}</div></div>
    <div class="card section"><h3>Profile</h3><form class="form two" id="pf"><label class="f">Name<input name="name" value="${esc(u.name)}"></label><label class="f">Mobile<input name="phone" value="${esc(u.phone || '')}"></label>
      <label class="f">Company / college<input name="company" value="${esc(u.company || '')}"></label><label class="f">GSTIN<input name="gstin" value="${esc(u.gstin || '')}" maxlength="15"></label>
      <label class="f">City<input name="city" value="${esc(u.city || '')}"></label><div></div>
      <label class="f">Birthday 🎂 <span class="muted">(we'll send you a wish)</span><input name="dob" type="date" value="${esc(u.dob || '')}"></label><label class="f">Anniversary 💐 (optional)<input name="anniversary" type="date" value="${esc(u.anniversary || '')}"></label>
      <label class="check full"><input type="checkbox" name="whatsapp_opt_in" ${u.whatsapp_opt_in ? 'checked' : ''}> Send me order updates and offers on WhatsApp</label>
      <label class="f">New password (optional)<input name="password" type="password" minlength="6" autocomplete="new-password"></label><div class="full"><button class="btn primary">Save</button></div></form></div>`;
  accountServices($('#svc'));
  $('#logout').onclick = async () => { await unlinkPush(); setToken(null); S.user = null; renderHeader(); location.hash = '#/'; };
  $('#copy').onclick = () => { navigator.clipboard?.writeText(link); toast('Referral link copied'); };
  $('#checkin').onclick = async () => { const r = await api('/me/checkin', { method: 'POST' }); toast(r.already ? 'Already collected today' : `+${r.points} points · ${r.streak}-day streak 🔥`); pageAccount(); };
  $('#pf').onsubmit = async (e) => { e.preventDefault(); const f = formData(e.target); if (!f.password) delete f.password; try { await api('/me', { method: 'PUT', body: f }); toast('Profile saved'); loadMe(); } catch (err) { toast(err.message, 'err'); } };
}

// ---------------------------------------------------------------- engagement: exit intent offer
function exitIntent() {
  if (!S.cfg.engagement.exit_intent || !S.cfg.engagement.welcome_coupon || local.get('drv_exit_shown') || S.user) return;
  document.addEventListener('mouseout', function onOut(e) {
    if (e.relatedTarget || e.clientY > 0) return;
    document.removeEventListener('mouseout', onOut); local.set('drv_exit_shown', 1);
    const m = modal(`<div style="text-align:center"><div style="font-size:3rem">🎁</div><h2>Wait — a welcome gift for your first order</h2><p class="muted">Create a free account to get <b>${S.cfg.loyalty.signup_bonus} bonus points</b>, then use this code at checkout:</p>
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
  $$('.modal-wrap, .lightbox').forEach((m) => m.remove());
  renderHeader(); window.scrollTo(0, 0); $('#allcats-menu')?.classList.add('hidden');
  updateShell(parts, { cart: cart.count(), wish: wish.get().length });
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
      case 'services': await pageServices(app, S, parts, setTitle); break;
      case 'projects': if (parts[1]) await pageProject(app, decodeURIComponent(parts[1]), setTitle, addToCart); else await pageProjects(app, params, setTitle); break;
      case 'partner': await pagePartner(app, S, setTitle, params); break;
      case 'compare': await pageCompare(); break;
      case 'wishlist': await pageWishlist(); break;
      case 'bom': pageBom(); break;
      case 'atl': pageAtl(); break;
      case 'blog': await pageBlog(parts[1]); break;
      case 'careers': await pageCareers(); break;
      case 'support': pageSupport(); break;
      case 'policy': pagePolicy(parts[1]); break;
      case 'login': pageAuth('login', params); break;
      case 'register': pageAuth('register', params); break;
      case 'account':
        if (parts[1] === 'addresses') await pageAddresses(app, S, setTitle);
        else if (isAppUI() && parts[1] !== 'details') pageAccountApp(app, S, setTitle, { logout: async () => { await unlinkPush(); setToken(null); S.user = null; renderHeader(); location.hash = '#/'; } });
        else await pageAccount();
        break;
      case 'categories': await pageCategories(app, S, setTitle); break;
      case 'notifications': await pageNotifications(app, S, setTitle); break;
      case 'waitlist': await pageWaitlist(app, S, setTitle, grid); break;
      default: app.innerHTML = '<div class="empty card"><div class="big">🤖</div><h2>Page not found</h2><a class="btn primary" href="#/">Go home</a></div>';
    }
  } catch (e) {
    app.innerHTML = `<div class="empty card"><div class="big">⚠️</div><h2>${esc(e.message)}</h2><a class="btn primary" href="#/">Go home</a></div>`;
  }
}

const APPLE = '<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M16.4 12.6c0-2.4 2-3.5 2-3.6-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.2-2.8.8-3.5.8s-1.8-.8-3-.8C6.9 7.3 5.4 8.2 4.6 9.7c-1.7 2.9-.4 7.2 1.2 9.6.8 1.2 1.7 2.4 3 2.4 1.2 0 1.6-.8 3.1-.8s1.8.8 3.1.8c1.3 0 2.1-1.2 2.9-2.3.9-1.3 1.3-2.6 1.3-2.7 0 0-2.8-1-2.8-4.1zM14.1 5.5c.6-.8 1.1-1.9 1-3-1 0-2.1.6-2.8 1.4-.6.7-1.2 1.8-1 2.9 1.1.1 2.1-.5 2.8-1.3z"/></svg>';
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 2.6 14.2 12 4 21.4c-.4-.2-.6-.6-.6-1.1V3.7c0-.5.2-.9.6-1.1z" fill="#34a853"/><path d="m17.6 8.9-3.4 3.1L4 2.6c.2-.1.5-.1.8 0l12.8 6.3z" fill="#fbbc04"/><path d="M17.6 15.1 4.8 21.4c-.3.1-.6.1-.8 0L14.2 12l3.4 3.1z" fill="#ea4335"/><path d="m21 12c0 .5-.3.9-.8 1.2l-2.6 1.9-3.4-3.1 3.4-3.1 2.6 1.9c.5.3.8.7.8 1.2z" fill="#4285f4"/></svg>';
function appBadges(site) {
  const one = (url, icon, top, name, label) => (url
    ? `<a class="app-badge" href="${esc(url)}" target="_blank" rel="noopener" aria-label="${label}">${icon}<span><small>${top}</small><b>${name}</b></span></a>`
    : `<a class="app-badge soon" aria-disabled="true" title="Coming soon">${icon}<span><small>Coming soon on</small><b>${name}</b></span></a>`);
  return one(site.app_ios_url, APPLE, 'Download on the', 'App Store', 'Download the Drovox iOS app') + one(site.app_android_url, PLAY, 'GET IT ON', 'Google Play', 'Get the Drovox Android app');
}

function pagePolicy(slug) {
  const { title, html } = policyPage(slug, S);
  setTitle(title); app.innerHTML = html; window.scrollTo(0, 0);
}

(async function boot() {
  [S.cfg, S.cats, S.site] = await Promise.all([api('/config'), api('/categories'), api('/site').catch(() => S.site)]);
  $('#tb-free').textContent = S.cfg.shipping.free_above;
  const site = S.site.site || {};
  const phone = site.toll_free || S.cfg.store.support_phone;
  if (phone) { $('#tb-phone-num').textContent = phone; $('#tb-phone').href = `tel:${phone.replace(/[^\d+]/g, '')}`; }
  $('#tb-social').innerHTML = [['facebook_url', 'f', 'Facebook'], ['x_url', '𝕏', 'X'], ['linkedin_url', 'in', 'LinkedIn'], ['instagram_url', 'IG', 'Instagram'], ['youtube_url', '▶', 'YouTube']]
    .filter(([k]) => site[k]).map(([k, t, l]) => `<a href="${esc(site[k])}" target="_blank" rel="noopener" title="${l}" aria-label="${l}">${t}</a>`).join('');
  if (!S.site.has_blog) $('#nav-blog')?.remove();
  if (!S.site.has_jobs) $('#nav-careers')?.remove();
  $('#allcats-btn').onclick = (e) => { e.stopPropagation(); const m = $('#allcats-menu'); m.classList.toggle('hidden'); $('#allcats-btn').setAttribute('aria-expanded', String(!m.classList.contains('hidden'))); };
  document.addEventListener('click', (e) => { if (!e.target.closest('.allcats')) $('#allcats-menu')?.classList.add('hidden'); });
  $('#ft-social').innerHTML = $('#tb-social').innerHTML;
  $('#ft-year').textContent = new Date().getFullYear();
  $('#ft-paylogos').innerHTML = paymentBadges();
  $('#ft-legal').textContent = S.cfg.store.legal_name && S.cfg.store.legal_name !== S.cfg.store.name ? ` · Operated by ${S.cfg.store.legal_name}` : '';
  $('#ft-apps').innerHTML = appBadges(site);
  $('#ft-contact').innerHTML = `${esc(S.cfg.store.support_phone)}<br>${esc(S.cfg.store.support_email)}<br>${esc(S.cfg.store.address)}`;
  initNative(); mountShell();
  if ('serviceWorker' in navigator && !isApp() && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('/sw.js').catch(() => {});
  await loadMe(); renderCartCount(); syncCart(); syncPushToken();
  if (isApp()) $('#ft-apps')?.closest('.ft-brand')?.querySelectorAll('h4, #ft-apps').forEach((x) => x.remove());
  window.addEventListener('hashchange', route); route(); exitIntent();
})();
