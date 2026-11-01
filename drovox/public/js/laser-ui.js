// Metal & non-metal laser cutting order page (robu.in style): upload a DXF → preview, size, cut length and
// pierces are measured → pick material & thickness (step 1) → bends/finish/colour, quantity (step 2) → price.
import { $, $$, api, esc, money, toast } from './common.js';

const readFile = (file) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => fail(new Error(`Could not read ${file.name}`)); r.readAsDataURL(file); });
const ACR = { Clear: '#bfe3ff', Black: '#1f2937', White: '#f8fafc', Red: '#dc2626', Blue: '#2563eb', Yellow: '#facc15', Fluorescent: '#a3e635', Frosted: '#e2e8f0' };

export function trustRow(S) {
  return `<div class="trust-row"><a href="#/bulk"><span>📦</span>Have a bulk order?<b>Click here</b></a><a href="#/support"><span>🎧</span>Need support?<b>Click here</b></a>
    <div><span>🧾</span>GST invoice on every order</div><div><span>🚚</span>Free delivery above ${money(S.cfg.shipping.free_above)}</div><div><span>💵</span>Cash on delivery*</div></div>
    <a class="link" href="#/bulk" style="display:inline-block;margin-top:14px;font-weight:600">Didn’t find what you are looking for?</a>`;
}

export async function pageLaserService(app, S, svc, cat, id) {
  const metal = id === 'metal_laser'; const SH = cat.sheets;
  const st = { material: metal ? 'ms' : 'acr3', thickness: metal ? 1 : null, colour: 'Clear', finish: 'none', bends: 0, engrave: 0, quantity: 1, unit: 'mm', step: 1, file: null, dxf: null };
  const metalOf = (mid) => SH.metal.find((m) => m.id === mid);
  const laserOf = (mid) => { for (const g of SH.laser) { const it = g.items.find(([i]) => i === mid); if (it) return { ...g, label: it[1] }; } return SH.laser[0]; };
  const matLabel = () => (metal ? `${metalOf(st.material).name} ${st.thickness} mm` : `${laserOf(st.material).group} ${laserOf(st.material).label}${st.material.startsWith('acr') ? ` · ${st.colour}` : ''}`);
  const matColour = () => (metal ? metalOf(st.material).colour : st.material.startsWith('acr') ? ACR[st.colour] : laserOf(st.material).colour);
  const store = S.cfg.store || {};

  app.innerHTML = `<div class="small muted" style="margin-bottom:12px"><a href="#/">Home</a> → <a href="#/services">Services</a> → <b style="color:#3b2a8c">${esc(svc.title)}</b></div>
    <div class="lz-layout">
      <div class="stack">
        <div class="lz-preview" id="pv"><div class="lz-empty" id="pvempty"><div style="font-size:2.4rem">📐</div><div class="small muted">Your design preview appears here</div></div><div id="pvsvg" class="hidden"></div><span class="lz-dim hidden" id="pvdim"></span></div>
        <label class="lz-upload" id="drop">⬆ Upload Design<input type="file" id="dxf" accept=".dxf" hidden></label>
        <div><b class="small">Upload a single 2D design file into the box</b><div class="tiny muted">We currently support the .dxf file format (R12 / 2000+, 1:1 scale). Max 20 MB.</div></div>
        <div class="row" style="gap:18px"><span class="small"><b>File unit</b></span><label class="radio"><input type="radio" name="unit" value="mm" checked> MM</label><label class="radio"><input type="radio" name="unit" value="inch"> Inch</label></div>
        <div class="m3-stats hidden" id="stats"></div><div id="warn"></div>
      </div>
      <div class="stack">
        <div><a class="small link" href="#/services" style="color:inherit;text-decoration:underline">Drovox Services</a><h1 style="margin:6px 0 4px">${esc(svc.title)}</h1>
          <div class="small muted">${esc(svc.blurb)}</div>
          <div style="margin-top:10px">Availability: <b style="color:var(--green)">In stock</b></div>
          ${store.support_email ? `<div class="small" style="margin-top:4px">For bulk orders or B2B enquiries, email us: <a class="link" href="mailto:${esc(store.support_email)}">${esc(store.support_email)}</a></div>` : ''}
          <div class="small" style="margin-top:4px"><b>Category</b> : Drovox Services · Lead time ${esc(svc.lead)}</div></div>
        <div class="lz-steps">
          <div class="lz-step" id="s1"><button type="button" class="lz-step-h" data-step="1"><span class="lz-num">1</span>Material</button><div class="lz-step-b" id="b1"></div></div>
          <div class="lz-step" id="s2"><button type="button" class="lz-step-h" data-step="2"><span class="lz-num">2</span>Finalize</button><div class="lz-step-b" id="b2"></div></div>
        </div>
        ${trustRow(S)}
      </div>
    </div>`;

  const paintPreview = () => { const el = $('#pvsvg'); if (el) el.style.color = matColour(); };
  const renderStep1 = () => {
    $('#b1').innerHTML = `<div class="lz-current"><b>Material:</b><span class="lz-sw big" style="background:${matColour()}"></span>${esc(matLabel())}</div>
      ${metal ? SH.metal.map((m) => `<div class="lz-mrow"><span>${esc(m.name)}</span><div class="lz-sws">${m.thicknesses.map((t) => `<button type="button" class="lz-sw${st.material === m.id && st.thickness === t ? ' on' : ''}" style="background:${m.colour}" data-m="${m.id}" data-t="${t}" title="${esc(m.name)} ${t} mm">${t}</button>`).join('')}</div></div>`).join('')
    : SH.laser.map((g) => `<div class="lz-mrow"><span>${esc(g.group)}</span><div class="lz-sws">${g.items.map(([mid, l]) => `<button type="button" class="lz-sw wide${st.material === mid ? ' on' : ''}" style="background:${g.colour}" data-m="${mid}" title="${esc(g.group)} ${esc(l)}">${esc(l)}</button>`).join('')}</div></div>`).join('')
      + (st.material.startsWith('acr') ? `<div class="lz-mrow"><span>Acrylic colour</span><div class="lz-sws">${SH.acrylic_colours.map((c) => `<button type="button" class="lz-sw wide${st.colour === c ? ' on' : ''}" style="background:${ACR[c]};color:${['Black', 'Red', 'Blue'].includes(c) ? '#fff' : '#111'}" data-c="${c}">${c}</button>`).join('')}</div></div>` : '')}
      <div style="text-align:center;margin-top:12px"><button type="button" class="btn indigo" id="next1" style="align-self:center">Next</button></div>`;
    $$('[data-m]', $('#b1')).forEach((b) => { b.onclick = () => { st.material = b.dataset.m; if (metal) st.thickness = Number(b.dataset.t); renderStep1(); paintPreview(); price(); }; });
    $$('[data-c]', $('#b1')).forEach((b) => { b.onclick = () => { st.colour = b.dataset.c; renderStep1(); paintPreview(); price(); }; });
    $('#next1').onclick = () => openStep(2);
  };
  const renderStep2 = () => {
    $('#b2').innerHTML = `<div class="lz-sum small">${esc(matLabel())}${st.dxf ? ` · ${st.dxf.width_mm} × ${st.dxf.height_mm} mm` : ''} <button type="button" class="link small" id="chg" style="background:none;border:0;cursor:pointer">Change</button></div>
      ${metal ? `<div class="m3-row"><span class="opt-label">Bends per part</span><div class="qty-step"><button type="button" data-b="-1">−</button><input id="bends" type="number" min="0" value="${st.bends}"><button type="button" data-b="1">+</button></div></div>
        <div class="m3-row"><span class="opt-label">Finish</span><div class="opt-chips">${SH.metal_finish.map((f) => `<button type="button" class="chip opt${st.finish === f.id ? ' on' : ''}" data-f="${f.id}">${esc(f.name)}</button>`).join('')}</div></div>`
    : `<div class="m3-row"><span class="opt-label">Engraving area</span><div class="row"><input id="eng" type="number" min="0" value="${st.engrave}" style="width:120px"> <span class="small muted">cm² (logos / text to engrave, 0 = none)</span></div></div>`}
      <div class="m3-row"><span class="opt-label">Remark</span><textarea id="notes" rows="2" placeholder="Tolerances, which side up, deadline…"></textarea></div>
      <div class="form two" style="padding:12px 18px"><label class="f">Name<input id="c-name" value="${esc(S.user?.name || '')}"></label><label class="f">WhatsApp number<input id="c-phone" inputmode="tel" value="${esc(S.user?.phone || '')}"></label><label class="f">Email (optional)<input id="c-email" type="email" value="${esc(S.user?.email || '')}"></label></div>
      <div class="m3-price"><div id="ptext" class="m3-ptext">Upload your DXF to see the price</div>
        <div class="qty-step"><button type="button" id="qm">−</button><input id="qty" type="number" min="1" value="${st.quantity}"><button type="button" id="qp">+</button></div>
        <button type="button" class="btn indigo" id="go" disabled>Request final quote</button></div><div id="lines"></div>`;
    $('#chg').onclick = () => openStep(1);
    $$('[data-b]', $('#b2')).forEach((b) => { b.onclick = () => { st.bends = Math.max(0, st.bends + Number(b.dataset.b)); $('#bends').value = st.bends; price(); }; });
    $('#bends')?.addEventListener('change', (e) => { st.bends = Math.max(0, Math.floor(Number(e.target.value) || 0)); price(); });
    $$('[data-f]', $('#b2')).forEach((b) => { b.onclick = () => { st.finish = b.dataset.f; $$('[data-f]', $('#b2')).forEach((x) => x.classList.toggle('on', x === b)); price(); }; });
    $('#eng')?.addEventListener('input', (e) => { st.engrave = Math.max(0, Number(e.target.value) || 0); price(); });
    const setQ = (n) => { st.quantity = Math.max(1, Math.min(10000, Math.floor(Number(n) || 1))); $('#qty').value = st.quantity; price(); };
    $('#qm').onclick = () => setQ(st.quantity - 1); $('#qp').onclick = () => setQ(st.quantity + 1); $('#qty').onchange = (e) => setQ(e.target.value);
    $('#go').onclick = submit;
    price();
  };
  const openStep = (n) => { st.step = n; $('#s1').classList.toggle('open', n === 1); $('#s2').classList.toggle('open', n === 2); if (n === 2) renderStep2(); };
  $$('[data-step]').forEach((b) => { b.onclick = () => openStep(Number(b.dataset.step)); });

  let t;
  function price() {
    clearTimeout(t);
    const pt = $('#ptext'); if (!pt) return;
    if (!st.dxf) { pt.innerHTML = 'Upload your DXF to see the price'; $('#lines').innerHTML = ''; $('#go').disabled = true; return; }
    t = setTimeout(async () => {
      try {
        const e = await api('/services/estimate', { method: 'POST', body: { service: id, material: st.material, thickness: st.thickness, colour: st.colour, finish: st.finish, bends: st.bends, engrave_cm2: st.engrave, quantity: st.quantity, width_mm: st.dxf.width_mm, height_mm: st.dxf.height_mm, cut_length_m: st.dxf.cut_length_m, pierces: st.dxf.pierces } });
        if (!$('#ptext')) return;
        $('#ptext').innerHTML = `<span class="small muted">Estimate incl. GST</span><b>${money(e.total, 2)}</b>`;
        $('#lines').innerHTML = `<details class="m3-lines" open><summary class="small">Price breakdown</summary>${e.lines.map((l) => `<div class="r-line small"><span>${esc(l.label)}</span><span>${money(l.amount, 2)}</span></div>`).join('')}<div class="r-line small"><span>GST ${cat.gst_rate}%</span><span>${money(e.gst, 2)}</span></div>
          ${e.info.note ? `<div class="small" style="color:var(--amber);margin-top:6px">⚠ ${esc(e.info.note)}</div>` : ''}<div class="tiny muted" style="margin-top:6px">⏱ Usually ready in ${esc(e.lead)}. Final price is confirmed after we check your drawing.</div></details>`;
        $('#go').disabled = false;
      } catch (err) { if ($('#ptext')) $('#ptext').innerHTML = `<span style="color:var(--red)">${esc(err.message)}</span>`; }
    }, 200);
  }

  const analyse = async () => {
    if (!st.file) return;
    $('#pvempty').classList.remove('hidden'); $('#pvempty').innerHTML = '<span class="spinner"></span><div class="small muted">Reading your drawing…</div>'; $('#pvsvg').classList.add('hidden');
    try {
      const d = await api('/services/dxf', { method: 'POST', body: { data: st.file.data, unit: st.unit } });
      st.dxf = d;
      $('#pvempty').classList.add('hidden'); $('#pvsvg').classList.remove('hidden'); $('#pvsvg').innerHTML = d.svg; paintPreview();
      $('#pvdim').classList.remove('hidden'); $('#pvdim').textContent = `${d.width_mm} × ${d.height_mm} mm`;
      $('#stats').classList.remove('hidden');
      $('#stats').innerHTML = `<div><span>Size</span><b>${d.width_mm} × ${d.height_mm} mm</b></div><div><span>Cut length</span><b>${d.cut_length_m} m</b></div><div><span>Pierces</span><b>${d.pierces}</b></div><div><span>Part area</span><b>${d.part_area_cm2} cm²</b></div>`;
      $('#warn').innerHTML = `<div class="tiny muted">📄 ${esc(st.file.name)}</div>` + d.warnings.map((w) => `<div class="small" style="color:var(--amber);margin-top:4px">⚠ ${esc(w)}</div>`).join('');
      if (st.step === 2) renderStep2(); else price();
    } catch (err) {
      st.dxf = null; $('#pvempty').innerHTML = `<div style="font-size:2rem">⚠️</div><div class="small" style="color:var(--red)">${esc(err.message)}</div>`; $('#stats').classList.add('hidden'); $('#pvdim').classList.add('hidden'); price();
    }
  };
  const load = async (f) => {
    if (!f) return;
    if (!/\.dxf$/i.test(f.name)) return toast('Please upload a .dxf file', 'err');
    if (f.size > 20 * 1024 * 1024) return toast('The DXF must be under 20 MB', 'err');
    st.file = { name: f.name, data: await readFile(f) }; analyse();
  };
  $('#dxf').onchange = (e) => load(e.target.files[0]);
  const pv = $('#pv');
  ['dragenter', 'dragover'].forEach((ev) => pv.addEventListener(ev, (e) => { e.preventDefault(); pv.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => pv.addEventListener(ev, (e) => { e.preventDefault(); pv.classList.remove('over'); }));
  pv.addEventListener('drop', (e) => load(e.dataTransfer.files[0]));
  $$('input[name=unit]').forEach((r) => { r.onchange = () => { st.unit = r.value; analyse(); }; });

  async function submit() {
    if (!st.dxf) return;
    const name = $('#c-name').value.trim(); const phone = $('#c-phone').value.trim();
    if (!name || phone.replace(/\D/g, '').length < 10) { toast('Add your name and 10-digit WhatsApp number', 'err'); (name ? $('#c-phone') : $('#c-name')).focus(); return; }
    const btn = $('#go'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending…';
    try {
      const r = await api('/services/requests', { method: 'POST', body: { service: id, material: st.material, thickness: st.thickness, colour: st.colour, finish: st.finish, bends: st.bends, engrave_cm2: st.engrave, quantity: st.quantity, unit: st.unit, notes: $('#notes').value, name, phone, email: $('#c-email').value, files: [st.file] } });
      app.innerHTML = `<div class="empty card"><div class="big">✅</div><h2>Request ${esc(r.req_no)} received</h2><p>Estimate ${money(r.estimate.total, 2)} incl. GST. We’ll check your drawing and send the final quote on WhatsApp${S.user ? ' — you can also track and approve it in My Account' : ''}.</p>
        <div class="row" style="justify-content:center">${S.user ? '<a class="btn primary" href="#/account">My Account</a>' : ''}<a class="btn" href="#/services">Back to services</a></div></div>`;
      window.scrollTo(0, 0);
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = 'Request final quote'; }
  }
  renderStep1(); openStep(1);
}
