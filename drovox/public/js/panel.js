// Shared shell for the stockist and master panels: login screen, sidebar navigation, routing.
import { $, $$, api, esc, toast, setScope, getToken, setToken, formData } from './common.js';

/**
 * @param {object} o { scope, title, roles:[...], demo, nav:[{id,label,icon,group?,area?}], pages:{id: async (el, params, ctx)} }
 */
export async function startPanel(o) {
  setScope(o.scope);
  const root = document.body;
  let me = null;
  if (getToken()) { try { me = await api('/me'); } catch { me = null; } }
  const allowed = (u) => u && (o.roles.includes(u.role) || u.role === 'admin');
  if (!allowed(me)) {
    let needsSetup = false;
    try { needsSetup = (await api('/setup')).needs_setup; } catch { /* offline */ }
    return needsSetup ? setupScreen() : loginScreen();
  }

  let areas = ['*'];
  if (o.permissions) { try { areas = (await api(o.permissions)).areas; } catch { /* default */ } }
  const canSee = (n) => !n.area || areas.includes('*') || areas.includes(n.area);
  const nav = o.nav.filter(canSee);

  root.innerHTML = `<div class="mobile-nav"><button class="btn sm" id="menu">☰</button><b>${esc(o.title)}</b></div>
    <div class="panel"><aside class="side" id="side"><a href="/" class="logo"><span class="mark">D</span><span>Dro<b>vox</b></span></a>
      <div class="role">${esc(o.title)} · ${esc(me.role)}</div>
      ${nav.map((n, i) => `${n.group && n.group !== nav[i - 1]?.group ? `<div class="grp">${esc(n.group)}</div>` : ''}<a href="#/${n.id}" data-nav="${n.id}"><span>${n.icon}</span>${esc(n.label)}</a>`).join('')}
      <div class="grp">Account</div><a href="/" target="_blank">🛍️ View store</a>${o.switchLink ? `<a href="${o.switchLink.href}">${o.switchLink.label}</a>` : ''}<a href="#" id="logout">🚪 Sign out (${esc(me.name.split(' ')[0])})</a>
    </aside><main class="panel-main" id="view"></main></div>`;
  $('#menu').onclick = () => $('#side').classList.toggle('open');
  $('#side').addEventListener('click', (e) => { if (e.target.closest('a')) $('#side').classList.remove('open'); });
  $('#logout').onclick = (e) => { e.preventDefault(); setToken(null); location.reload(); };

  const route = async () => {
    const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
    const [id, ...rest] = (path || nav[0].id).split('/');
    const page = nav.find((n) => n.id === id) ? id : nav[0].id;
    $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === page));
    $$('.modal-wrap').forEach((m) => m.remove());
    const el = $('#view'); el.innerHTML = '<div class="skeleton"></div>';
    try { await o.pages[page](el, new URLSearchParams(qs || ''), { me, rest, areas }); } catch (e) { el.innerHTML = `<div class="card" style="color:var(--red)">${esc(e.message)}</div>`; }
  };
  window.addEventListener('hashchange', route); route();

  function setupScreen() {
    if (!o.setup) {
      root.innerHTML = `<div class="login-screen"><div class="card"><h2>Setup needed</h2><p>No owner account exists yet. Open the <a class="link" href="/master">Master panel</a> to set up your shop first.</p>
        <p class="small muted">Or create it from the terminal in the drovox folder: <span class="code">npm run create-admin</span></p></div></div>`;
      return;
    }
    root.innerHTML = `<div class="login-screen"><div class="card" style="width:min(560px,100%)"><a href="/" class="logo" style="margin-bottom:12px"><span class="mark">D</span><span>Dro<b>vox</b></span></a>
      <h2>Welcome! Set up your shop</h2><p class="small muted">This creates the owner (admin) account. You can change every detail later in Settings.</p>
      <form class="form two" id="sf">
        <label class="f">Shop / brand name<input name="store_name" value="Drovox" required></label><label class="f">Legal business name (on invoices)<input name="legal_name" placeholder="e.g. Drovox Technologies"></label>
        <label class="f">GSTIN (optional)<input name="gstin" maxlength="15" placeholder="27ABCDE1234F1Z5" style="text-transform:uppercase"></label><label class="f">Shop WhatsApp / phone<input name="support_phone" inputmode="tel"></label>
        <label class="f full">Business address (printed on invoices and box labels)<input name="address"></label>
        <hr class="sep full"><label class="f">Your name<input name="name" required autocomplete="name"></label><label class="f">Your mobile<input name="phone" inputmode="tel"></label>
        <label class="f">Login email<input name="email" type="email" required autocomplete="username"></label><label class="f">Password (8+ characters)<input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
        <button class="btn primary lg full">Create owner account</button></form></div></div>`;
    $('#sf').onsubmit = async (e) => {
      e.preventDefault();
      try { const r = await api('/setup', { method: 'POST', body: formData(e.target) }); setToken(r.token); toast('Shop created — welcome!'); setTimeout(() => location.reload(), 400); } catch (err) { toast(err.message, 'err'); }
    };
  }

  function loginScreen() {
    root.innerHTML = `<div class="login-screen"><div class="card"><a href="/" class="logo" style="margin-bottom:12px"><span class="mark">D</span><span>Dro<b>vox</b></span></a>
      <h2>${esc(o.title)}</h2>${me ? `<p class="small" style="color:var(--red)">Signed in as ${esc(me.email)}, which does not have access here.</p>` : ''}
      <form class="form" id="lf"><label class="f">Email<input name="email" type="email" required autocomplete="username"></label><label class="f">Password<input name="password" type="password" required autocomplete="current-password"></label><button class="btn primary lg">Sign in</button></form>
      ${o.demo ? `<p class="tiny muted" style="margin-top:12px">${o.demo}</p>` : ''}</div></div>`;
    $('#lf').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = await api('/auth/login', { method: 'POST', body: formData(e.target) });
        if (!allowed(r.user)) { toast('This account does not have access to this panel', 'err'); return; }
        setToken(r.token); location.reload();
      } catch (err) { toast(err.message, 'err'); }
    };
  }
}

export const head = (title, actions = '') => `<div class="panel-head"><h1>${title}</h1><div class="row">${actions}</div></div>`;
export const kpi = (label, value, sub = '') => `<div class="card kpi"><div class="l">${label}</div><div class="v">${value}</div>${sub ? `<div class="small muted">${sub}</div>` : ''}</div>`;
