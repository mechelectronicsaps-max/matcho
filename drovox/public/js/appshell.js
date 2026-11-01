// App look & feel (Android / iOS app): purple header with search, floating bottom tab bar (Home · Categories ·
// Cart · Account) and app-style Categories, Account, Notifications, Waitlist and Address pages.
// Active inside the app, or in any browser with ?app=1 (to preview it on a laptop).
import { $, $$, api, esc, money, num, toast, art, imgUrl, dt } from './common.js';
import { isApp } from './native.js';

const PHRASES = ['how to make a drone', 'build a line follower robot', 'Arduino Uno', 'ESP32 weather station', 'smart dustbin project', '18650 battery pack', 'servo motor SG90', 'PCB manufacturing'];

export function isAppUI() {
  try {
    if (/[?&]app=1\b/.test(location.search)) sessionStorage.setItem('drv_appui', '1');
    if (/[?&]app=0\b/.test(location.search)) sessionStorage.removeItem('drv_appui');
    return isApp() || sessionStorage.getItem('drv_appui') === '1';
  } catch { return isApp(); }
}

const I = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/></svg>',
  cart: '<svg viewBox="0 0 24 24"><path d="M2.5 4h2.6l2.3 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 8H6.1"/><circle cx="9.5" cy="20" r="1.4"/><circle cx="17.5" cy="20" r="1.4"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4.2"/><path d="M4 21c.8-4 4-6.2 8-6.2s7.2 2.2 8 6.2"/></svg>',
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-9.2-9.3C1.6 7.8 3.9 4.5 7.3 4.5c2 0 3.6 1.1 4.7 2.8 1.1-1.7 2.7-2.8 4.7-2.8 3.4 0 5.7 3.3 4.5 6.7-1.7 4.7-9.2 9.3-9.2 9.3z"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2H4.5z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
  pen: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>',
};

/** Insert the app header and tab bar (once). */
export function mountShell() {
  if (!isAppUI() || $('#tabbar')) return;
  document.documentElement.classList.add('app-ui');
  document.body.insertAdjacentHTML('afterbegin', `<div id="apphead" class="apphead"><div class="ah-top">
      <a href="#/" class="ah-logo" aria-label="Drovox home"><span class="ah-mark">D</span><span class="ah-name"><b>Dro<em>vox</em></b><small>Build Tech with Our Parts</small></span></a>
      <a class="ah-btn" href="#/wishlist" aria-label="Wishlist">${I.heart}<i class="ah-dot hidden" id="ah-wish"></i></a><a class="ah-btn" href="#/notifications" aria-label="Notifications">${I.bell}</a></div>
      <form class="ah-search" id="ah-form" role="search" autocomplete="off"><span class="ah-ic">${I.search}</span><input id="ah-q" aria-label="Search products"><span class="ah-ph" id="ah-ph"><span>Search</span> <b id="ah-word">${PHRASES[0]}</b></span></form></div>`);
  document.body.insertAdjacentHTML('beforeend', `<nav id="tabbar" class="tabbar" aria-label="App">
      <a href="#/" data-tab="home" aria-label="Home">${I.home}</a><a href="#/categories" data-tab="cats" aria-label="Categories">${I.grid}</a>
      <a href="#/cart" data-tab="cart" aria-label="Cart">${I.cart}<span class="tb-count hidden" id="tb-cart">0</span></a><a href="#/account" data-tab="acct" aria-label="Account">${I.user}</a></nav>`);
  const q = $('#ah-q'); const ph = $('#ah-ph');
  const showPh = () => ph.classList.toggle('hidden', !!q.value || document.activeElement === q);
  q.addEventListener('focus', showPh); q.addEventListener('blur', showPh); q.addEventListener('input', showPh);
  $('#ah-form').onsubmit = (e) => { e.preventDefault(); const v = q.value.trim(); if (v) { q.blur(); location.hash = `#/search?q=${encodeURIComponent(v)}`; } };
  ph.onclick = () => q.focus();
  let i = 0;
  setInterval(() => { const w = $('#ah-word'); if (!w || !ph.offsetParent) return; w.classList.add('out'); setTimeout(() => { i = (i + 1) % PHRASES.length; w.textContent = PHRASES[i]; w.classList.remove('out'); }, 260); }, 2600);
}

/** Highlight the tab for this page and choose the header style. */
export function updateShell(parts, counts) {
  if (!$('#tabbar')) return;
  const p = parts[0] || '';
  const tab = !p ? 'home' : ['categories', 'c', 'search', 'p', 'projects', 'services'].includes(p) ? 'cats' : ['cart', 'checkout'].includes(p) ? 'cart' : ['account', 'orders', 'order', 'login', 'register', 'notifications', 'waitlist', 'wishlist', 'policy', 'support', 'track'].includes(p) ? 'acct' : '';
  $$('#tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  document.documentElement.dataset.appPage = p === 'account' && !parts[1] ? 'account' : ['cart', 'checkout'].includes(p) ? 'cart' : 'main';
  if (p !== 'search') $('#ah-q').value = ''; else $('#ah-q').value = new URLSearchParams(location.hash.split('?')[1] || '').get('q') || '';
  $('#ah-ph').classList.toggle('hidden', !!$('#ah-q').value);
  setCounts(counts);
}
export function setCounts({ cart = 0, wish = 0 } = {}) {
  const c = $('#tb-cart'); if (!c) return;
  c.textContent = cart > 99 ? '99+' : cart; c.classList.toggle('hidden', !cart);
  $('#ah-wish').classList.toggle('hidden', !wish);
}

// ---- Categories -------------------------------------------------------------------------------
export async function pageCategories(app, S, setTitle) {
  setTitle('Categories');
  const svc = await api('/services').catch(() => ({ services: [] }));
  const cats = S.cats.filter((c) => c.count || !S.cats.some((x) => x.count));
  const extra = [['#/projects', '🧩', 'DIY Projects'], ['#/builder', '✨', 'AI Project Builder'], ['#/search?sort=newest', '🆕', 'New Arrivals'], ['#/search?sort=discount', '💸', 'Best Deals']];
  const tile = (href, pic, name) => `<a class="cat-tile" href="${href}"><span class="cat-pic">${pic}</span><b>${esc(name)}</b></a>`;
  app.innerHTML = `${svc.services.length ? `<h3 class="acc-h" style="margin-top:4px">Fabrication Services</h3><div class="cat-grid svc">${svc.services.map((x) => tile(`#/services/${esc(x.id)}`, `<i>${esc(x.icon || '🛠️')}</i>`, x.short || x.title)).join('')}</div>` : ''}
    <h3 class="acc-h">Shop by Category</h3><div class="cat-grid">${cats.map((c) => tile(`#/c/${esc(c.slug)}`, c.image ? `<img src="${imgUrl(c.image, 's')}" alt="" loading="lazy" decoding="async" width="360" height="360">` : `<i>${esc(c.icon || '📦')}</i>`, c.name)).join('')}
    ${extra.map(([h, e, n]) => tile(h, `<i>${e}</i>`, n)).join('')}</div>`;
}

// ---- Account (app menu) -----------------------------------------------------------------------
export function pageAccountApp(app, S, setTitle, { logout }) {
  setTitle('Account');
  const u = S.user;
  const row = (href, ic, label, extra = '') => `<a class="acc-row" href="${href}"><span class="acc-ic">${ic}</span><span class="acc-l">${label}</span>${extra}<span class="acc-chev">${I.chev}</span></a>`;
  const group = (title, rows) => `<h3 class="acc-h">${title}</h3><div class="acc-card">${rows.join('')}</div>`;
  app.innerHTML = `<div class="acc-top">${u
    ? `<div class="acc-av">${esc((u.name || '?').trim()[0].toUpperCase())}</div><div class="acc-who"><h2>Hello ${esc(u.name.split(' ')[0])}</h2><div class="acc-mail">${esc(u.email || u.phone || '')}</div>
        <div class="acc-pts">🪙 <b>${num(u.points)} points</b> <span>|</span> 🏅 ${esc(u.tier?.name || 'Member')}</div></div><a class="acc-edit" href="#/account/details" aria-label="Edit profile">${I.pen}</a>`
    : `<div class="acc-av">👋</div><div class="acc-who"><h2>Hello there</h2><div class="acc-mail">Sign in for orders, points and faster checkout</div><a class="btn acc-signin" href="#/login?next=%23%2Faccount">Sign in / Create account</a></div>`}</div>
    <h3 class="acc-h">Quick Actions</h3>
    <div class="acc-card acc-quick"><a href="#/orders"><span>📦</span>Orders</a><a href="#/wishlist"><span>♡</span>Wishlist</a><a href="#/account/details"><span>🪙</span>Drovox Points</a><a href="#/track"><span>🚚</span>Track Order</a></div>
    ${group('Shopping', [
    row('#/account/addresses', '📍', 'Saved Addresses'), row('#/waitlist', '🔔', 'My Waitlist'), row('#/projects', '🧩', 'DIY Project Kits'),
    row('#/bom', '📋', 'BOM Tool'), row('#/search', '🛍️', 'Shop Now'), row('#/categories', '🗂️', 'Shop by Category'), row('#/compare', '⇄', 'Compare Products')])}
    ${group('Services & Business', [
    row('#/services', '🛠️', 'PCB, 3D Printing & Laser Cutting'), row('#/account/details', '🧾', 'My Service Requests'), row('#/builder', '✨', 'AI Project Builder'),
    row('#/bulk', '🏫', 'Bulk / College Orders'), row('#/partner', '🤝', 'Become a Partner'), row('#/account/details', '🎁', 'Refer & Earn')])}
    ${group('Help & Information', [
    row('#/notifications', '🔔', 'Notifications'), row('#/support', '🎧', 'Customer Support'), row('#/policy/refunds', '↩️', 'Cancellation & Refunds'),
    row('#/policy/shipping', '🚚', 'Shipping & Delivery'), row('#/policy/privacy', '🔒', 'Privacy Policy'), row('#/policy/terms', '📄', 'Terms & Conditions'), row('#/policy/about', 'ℹ️', 'About Drovox')])}
    ${u ? '<button class="acc-out" id="acc-out">Sign out</button>' : ''}
    <div class="acc-ver">Drovox · Build Tech with Our Parts</div>`;
  $('#acc-out')?.addEventListener('click', logout);
}

// ---- Notifications, waitlist, addresses ---------------------------------------------------------
export async function pageNotifications(app, S, setTitle) {
  setTitle('Notifications');
  if (!S.user) { location.hash = '#/login?next=%23%2Fnotifications'; return; }
  const rows = await api('/me/notifications');
  app.innerHTML = `<h1 class="app-h1">Notifications</h1>${rows.length ? `<div class="acc-card">${rows.map((n) => `<a class="ntf" href="${n.order_no ? `#/order/${esc(n.order_no)}` : '#/orders'}"><span class="ntf-ic">🔔</span><span><span class="ntf-b">${esc(n.body)}</span><span class="tiny muted">${dt(n.created_at)}</span></span></a>`).join('')}</div>`
    : '<div class="app-empty"><span class="ae-ic">🔔</span><h2>No notifications yet</h2><p>Order, delivery and service updates will appear here.</p><a class="btn indigo lg" href="#/">Continue Shopping</a></div>'}`;
}
export async function pageWaitlist(app, S, setTitle, grid) {
  setTitle('My Waitlist');
  if (!S.user) { location.hash = '#/login?next=%23%2Fwaitlist'; return; }
  const rows = await api('/me/waitlist');
  app.innerHTML = `<h1 class="app-h1">My Waitlist</h1>${rows.length ? `<p class="small muted">We'll notify you on WhatsApp and in the app when these are back in stock.</p>${grid(rows)}`
    : '<div class="app-empty"><span class="ae-ic">🔔</span><h2>Your waitlist is empty</h2><p>Tap “Notify me” on an out-of-stock product to get an alert when it’s back.</p><a class="btn indigo lg" href="#/search">Continue Shopping</a></div>'}`;
}
export async function pageAddresses(app, S, setTitle) {
  setTitle('Saved Addresses');
  if (!S.user) { location.hash = '#/login?next=%23%2Faccount%2Faddresses'; return; }
  const rows = await api('/me/addresses');
  app.innerHTML = `<h1 class="app-h1">Saved Addresses</h1>${rows.length ? `<div class="stack">${rows.map((a) => `<div class="acc-card addr"><div><b>${esc(a.name || S.user.name)}</b>${a.is_default ? ' <span class="badge green">Default</span>' : ''}<div class="small">${esc([a.line1, a.line2, a.city, a.pincode].filter(Boolean).join(', '))}</div>${a.phone ? `<div class="small muted">📞 ${esc(a.phone)}</div>` : ''}</div><button class="btn sm ghost" data-del="${a.id}">Delete</button></div>`).join('')}</div><p class="small muted" style="margin-top:12px">New addresses are saved when you check out.</p>`
    : '<div class="app-empty"><span class="ae-ic">📍</span><h2>No saved addresses</h2><p>Your delivery address is saved automatically at checkout.</p><a class="btn indigo lg" href="#/search">Continue Shopping</a></div>'}`;
  $$('[data-del]', app).forEach((b) => { b.onclick = async () => { if (!confirm('Delete this address?')) return; await api(`/me/addresses/${b.dataset.del}`, { method: 'DELETE' }); toast('Address deleted'); pageAddresses(app, S, setTitle); }; });
}

/** Empty cart (also used on the website). */
export function emptyCart() {
  return '<div class="app-empty"><span class="ae-ic">🛒</span><h2>Your cart is empty</h2><p>Looks like you haven’t added any products yet</p><div class="row" style="justify-content:center"><a class="btn indigo lg" href="#/search">Continue Shopping</a><a class="btn lg" href="#/builder">✨ AI Project Builder</a></div></div>';
}

/** Home extras: blog carousel + YouTube banner (website and app). */
export function homeExtras(S, posts) {
  const site = S.site.site || {};
  const blogs = posts.length ? `<section class="section card blog-rail"><div class="section-h"><h2>Blogs</h2><a class="link" href="#/blog">View All →</a></div><div class="blog-row">${posts.slice(0, 8).map((p) => `<a class="blog-card" href="#/blog/${esc(p.slug)}"><span class="bc-pic"><i>${esc(p.cover || '📝')}</i><span class="bc-date">${new Date(String(p.created_at).replace(' ', 'T') + 'Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span></span><span class="bc-t">${esc(p.title)}</span><span class="bc-r">● Read Article</span></a>`).join('')}</div></section>` : '';
  const yt = site.youtube_url ? `<a class="yt-banner section" href="${esc(site.youtube_url)}" target="_blank" rel="noopener"><div><div class="yt-t">Find awesome hacks, tips, projects &amp; tutorials</div><div class="yt-s">Subscribe to our <span class="yt-logo">▶</span> Channel</div></div><span class="yt-mark">D</span><span class="yt-btn">SUBSCRIBE</span></a>` : '';
  return blogs + yt;
}
