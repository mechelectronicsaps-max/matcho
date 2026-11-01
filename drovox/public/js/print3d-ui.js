// Industrial & FDM 3D printing order page (robu.in style): upload a model → 3D view, size, volume →
// pick technology / material / colour → automatic price. Price stays ₹0 until a model is uploaded.
import { $, $$, api, esc, money, toast } from './common.js';
import { mountModel3d, colourSwatch } from './model3d.js';

const EXT = ['stl', 'stp', 'step', '3mf', 'obj'];
const QUALITY = [['standard', 'Standard 0.2 mm'], ['draft', 'Draft 0.28 mm'], ['fine', 'Fine 0.12 mm']];
const INFILL = [10, 20, 30, 50, 75, 100];

const readFile = (file) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => fail(new Error(`Could not read ${file.name}`)); r.readAsDataURL(file); });
const chips = (key, list, cur, extra = () => '') => `<div class="opt-chips">${list.map(([v, l]) => `<button type="button" class="chip opt${String(v) === String(cur) ? ' on' : ''}" data-k="${key}" data-v="${esc(v)}">${extra(v)}${esc(l)}</button>`).join('')}</div>`;

export async function pageModelService(app, S, svc, cat, id) {
  const P = cat.print; const industrial = id === 'industrial3d';
  const st = {
    tech: 'sla', material: industrial ? 'sla_standard' : 'pla', colour: '', finish: 'standard', quality: 'standard', infill: 20, quantity: 1, notes: '',
    model: null, file: null, est: null,
  };
  const mats = () => (industrial ? P.industrial.filter((m) => m.tech === st.tech) : P.fdm);
  const mat = () => (industrial ? P.industrial : P.fdm).find((m) => m.id === st.material) || mats()[0];
  const tech = () => P.techs.find((t) => t.id === st.tech);
  st.colour = mat().colours[0];

  app.innerHTML = `<div class="svc-hero"><a href="#/services">Drovox Services</a><h1>${esc(svc.title)}</h1>
      <div class="svc-hero-meta"><span>⭐ Instant online price</span><span>Availability: <b class="pill-in">Open for orders</b></span><span>Lead time: <b>${esc(svc.lead)}</b></span></div></div>
    <div class="m3-layout">
      <div class="stack">
        <div class="card m3-drop" id="drop">
          <div id="m3empty" class="m3-empty"><div class="m3-icon">⬆<br>📦</div><b>Drop your 3D model here</b>
            <label class="btn indigo lg" style="cursor:pointer">Upload Model<input type="file" id="mfile" accept=".${EXT.join(',.')}" hidden></label>
            <div class="m3-ext">${EXT.map((e) => `<span>${e.toUpperCase()}</span>`).join('')}</div><div class="tiny muted">Max 60 MB · your files are private and secure</div></div>
          <div id="m3view" class="hidden"><div class="m3-bar"><b id="m3name"></b><span class="grow"></span><label class="chip" style="cursor:pointer">Replace<input type="file" id="mfile2" accept=".${EXT.join(',.')}" hidden></label></div>
            <div class="m3-stage" id="m3stage"></div>
            <div class="m3-views"><button type="button" class="chip" data-view="iso">Angle</button><button type="button" class="chip" data-view="front">Front</button><button type="button" class="chip" data-view="top">Top</button><button type="button" class="chip" data-view="side">Side</button><button type="button" class="chip" data-view="spin">⟳ Spin</button><span class="tiny muted">Drag to rotate · scroll to zoom</span></div>
            <div class="m3-stats" id="m3stats"></div><div id="m3warn"></div></div>
          <div id="m3busy" class="m3-empty hidden"><span class="spinner"></span><b>Reading your model…</b><span class="tiny muted">Measuring size, volume and surface</span></div>
        </div>
        <div class="card m3-rules" id="rules"></div>
        <div class="card"><h3>Your details</h3><div class="form two"><label class="f">Name<input id="c-name" required value="${esc(S.user?.name || '')}"></label><label class="f">WhatsApp number<input id="c-phone" required inputmode="tel" value="${esc(S.user?.phone || '')}"></label>
          <label class="f">Email (optional)<input id="c-email" type="email" value="${esc(S.user?.email || '')}"></label></div>
          ${S.user ? '' : `<p class="small muted">Tip: <a class="link" href="#/login?next=%23%2Fservices%2F${id}">sign in</a> to track this request and approve the quote from your account.</p>`}
          <p class="small muted">For bulk orders or B2B enquiries, use <a class="link" href="#/bulk">Bulk enquiry</a>.</p></div>
      </div>
      <div class="stack">
        <div class="card m3-spec"><div class="row between m3-spec-h"><h2>Specifications</h2><span class="pill-est">● INSTANT ESTIMATE</span></div>
          <div id="spec"></div>
          <div class="m3-row"><span class="opt-label">Remark</span><textarea id="notes" rows="2" placeholder="Tolerances, threads/inserts, orientation, deadline…"></textarea></div>
          <div class="m3-price"><div id="ptext" class="m3-ptext">Upload a model to see the price</div>
            <div class="qty-step"><button type="button" id="qm" aria-label="Less">−</button><input id="qty" type="number" min="1" value="1" inputmode="numeric"><button type="button" id="qp" aria-label="More">+</button></div>
            <button type="button" class="btn indigo" id="go" disabled>Calculate Price</button></div>
          <div id="lines"></div></div>
        <div class="m3-lead"><span class="m3-clock">⏱</span><div><b id="leadt">${esc(svc.lead)} lead time.</b><div class="small">${industrial ? 'Industrial 3D printing is produced in our partner facility.' : 'Printed in-house on calibrated FDM printers.'} Orders are dispatched after manufacturing is complete.</div></div></div>
      </div>
    </div>`;

  let viewer = null;
  const renderRules = () => {
    const t = industrial ? tech() : { min_wall: 1.2, thinnest: 0.8, build: P.fdm_build };
    $('#rules').innerHTML = `<div class="small"><b>STL, STP, STEP, 3MF, OBJ</b> · Wall &gt; ${t.min_wall} mm · Thinnest ≥ ${t.thinnest} mm · Max size ${t.build.join(' × ')} mm · Units: millimetres</div>`;
  };
  const renderSpec = () => {
    const m = mat(); const finishes = industrial ? P.finishes[tech().family] : null;
    if (!m.colours.includes(st.colour)) st.colour = m.colours[0];
    if (finishes && !finishes.some(([f]) => f === st.finish)) st.finish = 'standard';
    $('#spec').innerHTML = `${industrial ? `<div class="m3-row"><span class="opt-label">3D Technology <i>*</i></span>${chips('tech', P.techs.map((t) => [t.id, t.name]), st.tech)}</div>` : ''}
      <div class="m3-row"><span class="opt-label">Material <i>*</i></span>${chips('material', mats().map((x) => [x.id, x.name]), st.material)}</div>
      <div class="m3-mat"><div class="m3-mat-h"><span class="m3-sw" style="background:${colourSwatch(st.colour)}"></span><div><b>${esc(m.name)}</b><div class="small muted">${esc(m.colours.join(' / '))}</div></div></div>
        <dl><dt>Key features</dt><dd>${esc(m.features)}</dd><dt>Heat deflection</dt><dd>${esc(m.hdt)}</dd><dt>Tolerance</dt><dd>${esc(m.tolerance)}</dd><dt>Applications</dt><dd>${esc(m.applications)}</dd></dl>
        <div class="m3-note"><b>Notes</b><br>${esc(m.notes)}</div></div>
      <div class="m3-row"><span class="opt-label">Colour <i>*</i></span>${chips('colour', m.colours.map((c) => [c, c]), st.colour, (c) => `<i class="sw" style="background:${colourSwatch(c)}"></i>`)}</div>
      ${industrial ? `<div class="m3-row"><span class="opt-label">Finish</span>${chips('finish', finishes.map(([f, l]) => [f, l]), st.finish)}</div>`
    : `<div class="m3-row"><span class="opt-label">Quality</span>${chips('quality', QUALITY, st.quality)}</div><div class="m3-row"><span class="opt-label">Infill</span>${chips('infill', INFILL.map((n) => [n, `${n}%`]), st.infill)}</div>`}`;
    $$('[data-k]', $('#spec')).forEach((b) => { b.onclick = () => {
      const k = b.dataset.k; st[k] = k === 'infill' ? Number(b.dataset.v) : b.dataset.v;
      if (k === 'tech') { st.material = mats()[0].id; renderRules(); }
      renderSpec(); viewer?.setColour(st.colour); price();
    }; });
  };

  let t;
  const price = () => {
    clearTimeout(t);
    if (!st.model) { $('#ptext').innerHTML = 'Upload a model to see the price'; $('#lines').innerHTML = ''; $('#go').disabled = true; $('#go').textContent = 'Calculate Price'; return; }
    t = setTimeout(async () => {
      try {
        const body = { service: id, material: st.material, colour: st.colour, finish: st.finish, quality: st.quality, infill: st.infill, quantity: st.quantity, volume_cm3: st.model.volume_cm3, area_cm2: st.model.area_cm2, size_mm: st.model.size_mm.join('x') };
        const e = await api('/services/estimate', { method: 'POST', body });
        if (!$('#ptext')) return;
        st.est = e;
        $('#ptext').innerHTML = `<span class="small muted">Estimate incl. GST</span><b>${money(e.total, 2)}</b>`;
        $('#lines').innerHTML = `<details class="m3-lines" open><summary class="small">Price breakdown</summary>${e.lines.map((l) => `<div class="r-line small"><span>${esc(l.label)}</span><span>${money(l.amount, 2)}</span></div>`).join('')}
          <div class="r-line small"><span>GST ${cat.gst_rate}%</span><span>${money(e.gst, 2)}</span></div>${e.info.grams ? `<div class="tiny muted">≈ ${e.info.grams} g per part at ${st.infill}% infill</div>` : ''}
          ${e.info.note ? `<div class="small" style="color:var(--amber);margin-top:6px">⚠ ${esc(e.info.note)}</div>` : ''}<div class="tiny muted" style="margin-top:6px">Final price is confirmed after our engineers check the model.</div></details>`;
        $('#leadt').textContent = `${e.lead} lead time.`;
        $('#go').disabled = false; $('#go').textContent = 'Request final quote';
      } catch (err) { if ($('#ptext')) $('#ptext').innerHTML = `<span style="color:var(--red)">${esc(err.message)}</span>`; }
    }, 200);
  };

  const load = async (f) => {
    if (!f) return;
    const ext = f.name.split('.').pop().toLowerCase();
    if (!EXT.includes(ext)) return toast('Upload an STL, STEP/STP, 3MF or OBJ file', 'err');
    if (f.size > 60 * 1024 * 1024) return toast('The model must be under 60 MB', 'err');
    $('#m3empty').classList.add('hidden'); $('#m3view').classList.add('hidden'); $('#m3busy').classList.remove('hidden');
    try {
      const data = await readFile(f);
      const m = await api('/services/model', { method: 'POST', body: { name: f.name, data } });
      st.model = m; st.file = { name: f.name, data };
      $('#m3busy').classList.add('hidden'); $('#m3view').classList.remove('hidden');
      $('#m3name').textContent = `📄 ${f.name}`;
      $('#m3stats').innerHTML = `<div><span>Size (X × Y × Z)</span><b>${m.size_mm.join(' × ')} mm</b></div><div><span>Volume</span><b>${m.volume_cm3} cm³</b></div><div><span>Surface</span><b>${m.area_cm2} cm²</b></div><div><span>Triangles</span><b>${m.triangles.toLocaleString('en-IN')}</b></div>`;
      $('#m3warn').innerHTML = m.warnings.map((w) => `<div class="small" style="color:var(--amber);margin-top:6px">⚠ ${esc(w)}</div>`).join('') + (m.mesh_reduced ? '<div class="tiny muted">Large model — the preview is simplified; the price uses the full model.</div>' : '');
      viewer?.destroy(); viewer = null;
      $('#m3stage').innerHTML = '<div class="small muted" style="padding:20px"><span class="spinner"></span> Loading 3D view…</div>';
      viewer = await mountModel3d($('#m3stage'), m.mesh, { colour: st.colour }).catch(() => { $('#m3stage').innerHTML = '<div class="small muted" style="padding:20px">3D view needs WebGL — not available in this browser. Your price is still calculated.</div>'; return null; });
      price();
    } catch (err) {
      st.model = null; st.file = null; $('#m3busy').classList.add('hidden');
      $('#m3empty').classList.remove('hidden'); toast(err.message, 'err'); price();
    }
  };
  $('#mfile').onchange = (e) => load(e.target.files[0]);
  $('#mfile2').onchange = (e) => load(e.target.files[0]);
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => load(e.dataTransfer.files[0]));
  $$('[data-view]').forEach((b) => { b.onclick = () => { if (!viewer) return; b.dataset.view === 'spin' ? viewer.spin() : viewer.view(b.dataset.view); }; });

  const setQty = (n) => { st.quantity = Math.max(1, Math.min(10000, Math.floor(Number(n) || 1))); $('#qty').value = st.quantity; price(); };
  $('#qm').onclick = () => setQty(st.quantity - 1); $('#qp').onclick = () => setQty(st.quantity + 1); $('#qty').onchange = (e) => setQty(e.target.value);

  $('#go').onclick = async () => {
    if (!st.model) return;
    const name = $('#c-name').value.trim(); const phone = $('#c-phone').value.trim();
    if (!name || phone.replace(/\D/g, '').length < 10) { toast('Add your name and 10-digit WhatsApp number', 'err'); $('#c-name').scrollIntoView({ behavior: 'smooth', block: 'center' }); (name ? $('#c-phone') : $('#c-name')).focus(); return; }
    const btn = $('#go'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending…';
    try {
      const r = await api('/services/requests', { method: 'POST', body: { service: id, material: st.material, colour: st.colour, finish: st.finish, quality: st.quality, infill: st.infill, quantity: st.quantity, notes: $('#notes').value, name, phone, email: $('#c-email').value, files: [st.file] } });
      viewer?.destroy();
      app.innerHTML = `<div class="empty card"><div class="big">✅</div><h2>Request ${esc(r.req_no)} received</h2><p>Estimate ${money(r.estimate.total, 2)} incl. GST. We’ll check your model and send the final quote on WhatsApp${S.user ? ' — you can also track and approve it in My Account' : ''}.</p>
        <div class="row" style="justify-content:center">${S.user ? '<a class="btn primary" href="#/account">My Account</a>' : ''}<a class="btn" href="#/services">Back to services</a></div></div>`;
      window.scrollTo(0, 0);
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = 'Request final quote'; }
  };
  renderRules(); renderSpec(); price();
}
