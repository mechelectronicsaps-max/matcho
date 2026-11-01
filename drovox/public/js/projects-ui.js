// DIY Projects on the storefront: browse school / maker projects and add the whole parts kit to the cart.
import { $, $$, api, esc, money, toast, art, imgUrl } from './common.js';
import { share } from './native.js';

const LEVEL = { beginner: ['Beginner', 'green'], intermediate: ['Intermediate', 'amber'], advanced: ['Advanced', 'red'] };
const CAT_ICON = { Robotics: '🤖', 'IoT & Smart Home': '🏠', 'Arduino Basics': '🔌', 'School Science': '🔬', 'Drones & RC': '🚁', 'Electronics Basics': '💡', 'Sensors & Measurement': '📏', 'Raspberry Pi & AI': '🧠', 'Renewable Energy': '☀️' };
const levelBadge = (l) => `<span class="badge ${LEVEL[l]?.[1] || ''}">${LEVEL[l]?.[0] || esc(l)}</span>`;
const hours = (h) => (h < 1 ? `${Math.round(h * 60)} min` : `${h % 1 ? h : Math.round(h)} hr${h > 1 ? 's' : ''}`);

export function projectCard(p) {
  const pic = p.img ? `<img src="${imgUrl(p.img, 's')}" srcset="${imgUrl(p.img, 's')} 360w, ${imgUrl(p.img, 'm')} 900w" sizes="(max-width:600px) 90vw, 300px" alt="${esc(p.title)}" loading="lazy" decoding="async" width="360" height="240">`
    : `<span>${CAT_ICON[p.category] || '🛠️'}</span>`;
  return `<a class="pj-card card" href="#/projects/${esc(p.slug)}"><div class="pj-pic${p.img ? ' photo' : ''}">${pic}${p.featured ? '<span class="pj-flag">★ Featured</span>' : ''}</div>
    <div class="pj-body"><div class="row" style="gap:6px"><span class="badge">${esc(p.category)}</span>${levelBadge(p.level)}</div>
      <h3>${esc(p.title)}</h3><p class="small muted pj-sum">${esc(p.summary)}</p>
      <div class="pj-meta small"><span>⏱ ${hours(p.build_hours)}</span><span>🧩 ${p.parts_count} parts</span>${p.audience ? `<span>🎓 ${esc(p.audience)}</span>` : ''}</div>
      <div class="row between" style="margin-top:auto;padding-top:8px"><div>${p.kit_price ? `<b>${money(p.kit_price)}</b> <span class="tiny muted">full kit</span>` : '<span class="small muted">Kit coming soon</span>'}</div><span class="link small">View project →</span></div></div></a>`;
}

export async function pageProjects(app, params, setTitle) {
  setTitle('DIY Projects');
  const q = params.get('q') || ''; const category = params.get('category') || ''; const level = params.get('level') || ''; const sort = params.get('sort') || '';
  const d = await api(`/projects?${new URLSearchParams({ q, category, level, sort })}`);
  const link = (k, v) => { const p = new URLSearchParams({ q, category, level, sort }); if (v) p.set(k, v); else p.delete(k); for (const [kk, vv] of [...p]) if (!vv) p.delete(kk); return `#/projects?${p}`; };
  const total = Object.values(d.counts).reduce((s, n) => s + n, 0);
  app.innerHTML = `<div class="pj-hero"><div><h1>DIY Projects</h1><p>Pick a project, get the complete parts kit in one click and build it with our step-by-step guide — for school science fairs, ATL labs, college and hobby builds.</p>
      <form id="pjq" class="pj-search"><input name="q" value="${esc(q)}" placeholder="Search projects — robot, dustbin, weather, drone…"><button class="btn indigo">Search</button></form></div><div class="pj-hero-art">🤖🔧💡</div></div>
    <div class="opt-chips" style="margin:6px 0 10px"><a class="chip${category ? '' : ' on'}" href="${link('category', '')}">All projects <b>${total}</b></a>${d.categories.filter((c) => d.counts[c]).map((c) => `<a class="chip${c === category ? ' on' : ''}" href="${link('category', c)}">${CAT_ICON[c] || ''} ${esc(c)} <b>${d.counts[c]}</b></a>`).join('')}</div>
    <div class="row between" style="margin-bottom:14px"><div class="opt-chips"><a class="chip${level ? '' : ' on'}" href="${link('level', '')}">Any level</a>${d.levels.map((l) => `<a class="chip${l === level ? ' on' : ''}" href="${link('level', l)}">${LEVEL[l][0]}</a>`).join('')}</div>
      <select id="pjsort" style="width:auto"><option value="">Recommended</option><option value="popular" ${sort === 'popular' ? 'selected' : ''}>Most built</option><option value="newest" ${sort === 'newest' ? 'selected' : ''}>Newest</option><option value="time" ${sort === 'time' ? 'selected' : ''}>Quickest to build</option></select></div>
    ${d.rows.length ? `<div class="pj-grid">${d.rows.map(projectCard).join('')}</div>` : `<div class="empty card"><div class="big">🛠️</div><h3>${total ? 'No projects match' : 'Projects are coming soon'}</h3><p>${total ? 'Try another category or search.' : 'Meanwhile, describe your idea to the AI Builder and it will pick the parts for you.'}</p><a class="btn primary" href="#/builder">Open AI Builder</a></div>`}
    <div class="banner brand section" style="margin-top:20px"><div>💡 <b>Have your own idea?</b> Describe it to the AI Project Builder and it fills your cart with the right parts.</div><a class="btn sm primary" href="#/builder">Try AI Builder</a></div>`;
  $('#pjq').onsubmit = (e) => { e.preventDefault(); location.hash = link('q', new FormData(e.target).get('q').trim()); };
  $('#pjsort').onchange = (e) => { location.hash = link('sort', e.target.value); };
}

export async function pageProject(app, slug, setTitle, addToCart) {
  const p = await api(`/projects/${encodeURIComponent(slug)}`);
  setTitle(p.title);
  const qty = Object.fromEntries(p.parts.map((x) => [x.id, x.qty])); const pick = Object.fromEntries(p.parts.map((x) => [x.id, true]));
  const yt = String(p.video_url || '').match(/(?:youtu\.be\/|v=|shorts\/|embed\/)([\w-]{11})/)?.[1];
  const imgs = p.images;
  app.innerHTML = `<div class="small muted" style="margin-bottom:12px"><a href="#/">Home</a> / <a href="#/projects">DIY Projects</a> / <a href="#/projects?category=${encodeURIComponent(p.category)}">${esc(p.category)}</a></div>
    <div class="pdp">
      <div>${imgs.length ? `<div class="pj-main"><img id="pjimg" src="${imgUrl(imgs[0], 'm')}" srcset="${imgUrl(imgs[0], 'm')} 900w, ${imgUrl(imgs[0], 'l')} 1600w" sizes="(max-width:800px) 100vw, 560px" alt="${esc(p.title)}" fetchpriority="high"></div>
        ${imgs.length > 1 ? `<div class="pj-thumbs">${imgs.map((k, i) => `<button type="button" data-pi="${i}" class="${i ? '' : 'on'}"><img src="${imgUrl(k, 's')}" alt="" loading="lazy" width="72" height="72"></button>`).join('')}</div>` : ''}`
    : `<div class="pj-main empty-art"><span>${CAT_ICON[p.category] || '🛠️'}</span></div>`}</div>
      <div class="stack">
        <div class="row" style="gap:6px"><span class="badge">${esc(p.category)}</span>${levelBadge(p.level)}${p.audience ? `<span class="badge">🎓 ${esc(p.audience)}</span>` : ''}</div>
        <h1 style="margin:0">${esc(p.title)}</h1>
        <p class="pdp-short">${esc(p.summary)}</p>
        <div class="pj-facts"><div><span>Build time</span><b>${hours(p.build_hours)}</b></div><div><span>Parts</span><b>${p.parts.length}</b></div><div><span>Built by</span><b>${p.kits_added || 0} makers</b></div></div>
        ${p.learn.length ? `<div><div class="f" style="margin-bottom:6px">What you'll learn</div><div class="opt-chips">${p.learn.map((l) => `<span class="chip">✔ ${esc(l)}</span>`).join('')}</div></div>` : ''}
        ${p.parts.length ? `<div class="card pj-kit"><div class="row between"><div><div class="small muted">Complete kit · ${p.parts.length} parts</div><div><span class="price-big" id="kitp">${money(p.kit_price)}</span> ${p.kit_mrp > p.kit_price ? `<span class="muted" style="text-decoration:line-through">${money(p.kit_mrp)}</span>` : ''}</div></div>
          <span class="badge ${p.in_stock ? 'green' : 'amber'}">${p.in_stock ? 'All parts in stock' : 'Some parts low / out of stock'}</span></div>
          <div class="row" style="margin-top:10px"><button class="btn primary lg" id="kitadd">🛒 Add all parts to cart</button><button class="btn dark lg" id="kitbuy">Buy kit now</button><button class="btn lg" id="pjshare">↗ Share</button></div>
          <div class="tiny muted" style="margin-top:6px">Already have some parts? Untick them in the list below.</div></div>` : '<div class="banner">The parts list for this project is being prepared — <a class="link" href="#/bulk">ask us for a kit quote</a>.</div>'}
      </div>
    </div>
    ${p.parts.length ? `<section class="section"><div class="section-h"><h2>Parts list</h2></div><div class="card table-wrap"><table class="t"><thead><tr><th></th><th></th><th>Part</th><th class="r">Price</th><th class="r">Qty</th><th class="r">Total</th></tr></thead><tbody>
      ${p.parts.map((x) => `<tr><td><input type="checkbox" data-pick="${x.id}" checked aria-label="Include ${esc(x.name)}"></td><td><a href="#/p/${esc(x.slug)}">${art(x, 'xs')}</a></td><td><a href="#/p/${esc(x.slug)}"><b>${esc(x.name)}</b></a><div class="tiny muted">${esc(x.sku)}${x.note ? ` · ${esc(x.note)}` : ''}${x.stock < x.qty ? ' · <span style="color:var(--amber)">low stock</span>' : ''}</div></td>
        <td class="r">${money(x.price)}</td><td class="r"><input type="number" min="1" value="${x.qty}" data-q="${x.id}" style="width:64px;text-align:right"></td><td class="r" data-t="${x.id}">${money(x.price * x.qty)}</td></tr>`).join('')}
      </tbody></table></div></section>` : ''}
    ${p.description ? `<section class="section"><div class="section-h"><h2>About this project</h2></div><div class="card prose">${p.description.split(/\n{2,}/).map((x) => `<p>${esc(x)}</p>`).join('')}</div></section>` : ''}
    ${p.steps.length ? `<section class="section"><div class="section-h"><h2>How to build it</h2></div><ol class="pj-steps">${p.steps.map((s) => `<li class="card">${esc(s)}</li>`).join('')}</ol>
      ${p.code_url ? `<a class="btn" href="${esc(p.code_url)}" target="_blank" rel="noopener">💾 Download the code</a>` : ''}</section>` : ''}
    ${yt ? `<section class="section"><div class="section-h"><h2>Video guide</h2></div><div class="pj-video"><iframe src="https://www.youtube-nocookie.com/embed/${yt}" title="${esc(p.title)} video" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div></section>`
    : p.video_url ? `<p><a class="btn" href="${esc(p.video_url)}" target="_blank" rel="noopener">▶ Watch the video guide</a></p>` : ''}
    ${p.related.length ? `<section class="section"><div class="section-h"><h2>More ${esc(p.category)} projects</h2><a class="link small" href="#/projects?category=${encodeURIComponent(p.category)}">See all →</a></div><div class="pj-grid">${p.related.map(projectCard).join('')}</div></section>` : ''}`;
  $$('[data-pi]').forEach((b) => { b.onclick = () => { const k = imgs[Number(b.dataset.pi)]; $('#pjimg').src = imgUrl(k, 'm'); $('#pjimg').srcset = `${imgUrl(k, 'm')} 900w, ${imgUrl(k, 'l')} 1600w`; $$('[data-pi]').forEach((x) => x.classList.toggle('on', x === b)); }; });
  const total = () => { const t = p.parts.reduce((s, x) => s + (pick[x.id] ? x.price * qty[x.id] : 0), 0); if ($('#kitp')) $('#kitp').textContent = money(t); return t; };
  $$('[data-pick]').forEach((c) => { c.onchange = () => { pick[c.dataset.pick] = c.checked; total(); }; });
  $$('[data-q]').forEach((i) => { i.onchange = () => { const n = Math.max(1, Math.floor(Number(i.value) || 1)); i.value = n; qty[i.dataset.q] = n; const x = p.parts.find((y) => String(y.id) === i.dataset.q); $(`[data-t="${x.id}"]`).textContent = money(x.price * n); total(); }; });
  const addKit = async () => {
    const chosen = p.parts.filter((x) => pick[x.id] && x.stock > 0); const skipped = p.parts.filter((x) => pick[x.id] && x.stock <= 0);
    if (!chosen.length) { toast(skipped.length ? 'The selected parts are out of stock right now' : 'Select at least one part', 'err'); return false; }
    for (const x of chosen) await addToCart(x, Math.min(qty[x.id], x.stock), { silent: true });
    api(`/projects/${encodeURIComponent(p.slug)}/kit`, { method: 'POST' }).catch(() => {});
    toast(`Added ${chosen.length} parts for “${p.title}” to your cart${skipped.length ? ` · ${skipped.length} out of stock (${skipped.map((x) => x.name.split('(')[0].trim()).join(', ')})` : ''}`); return true;
  };
  $('#kitadd')?.addEventListener('click', addKit);
  $('#pjshare')?.addEventListener('click', () => share({ title: p.title, text: `${p.title} — DIY project with the complete parts kit`, url: `${location.origin}/#/projects/${p.slug}` }));
  $('#kitbuy')?.addEventListener('click', async () => { if (await addKit()) location.hash = '#/checkout'; });
}
