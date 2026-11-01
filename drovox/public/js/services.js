// Storefront: fabrication services (3D printing, PCB, laser & acrylic cutting, battery packs) and the partner program.
import { $, $$, api, esc, money, toast, formData, badge } from './common.js';

const STATUS_LABEL = { new: 'Received', quoted: 'Quote sent', approved: 'Approved', in_production: 'In production', ready: 'Ready', delivered: 'Delivered', cancelled: 'Cancelled' };
const STATUS_COLOR = { new: 'pending_payment', quoted: 'confirmed', approved: 'packed', in_production: 'shipped', ready: 'delivered', delivered: 'delivered', cancelled: 'cancelled' };
export const serviceBadge = (s) => badge(STATUS_COLOR[s] || '', STATUS_LABEL[s] || s);

// Option fields per service. `show` hides a field unless it applies to the chosen options.
const F = {
  industrial3d: [
    { name: 'material', label: 'Material / process', type: 'select', options: [['sla_standard', 'Standard resin (SLA)'], ['sla_tough', 'Tough resin (SLA)'], ['sla_clear', 'Clear resin (SLA)'], ['sls_nylon', 'Nylon PA12 (SLS)'], ['mjf_nylon', 'Nylon PA12 (MJF)']] },
    { name: 'volume_cm3', label: 'Part volume (cm³) — from your CAD / slicer', type: 'number', value: 20, min: 0.1 },
    { name: 'finish', label: 'Finish', type: 'select', options: [['standard', 'Standard (supports removed)'], ['sanded', 'Sanded smooth'], ['painted', 'Primed & painted']] },
    { name: 'colour', label: 'Colour (painted parts)', type: 'text', value: 'Natural' },
    { name: 'quantity', label: 'Quantity', type: 'number', value: 1, min: 1 },
  ],
  metal_laser: [
    { name: 'material', label: 'Metal', type: 'select', options: [['ms', 'Mild steel (MS)'], ['ss', 'Stainless steel SS304'], ['al', 'Aluminium'], ['brass', 'Brass'], ['gi', 'Galvanised iron (GI)']] },
    { name: 'thickness', label: 'Thickness (mm)', type: 'select', options: [['1.2', '1.2']], dyn: (v) => ({ ms: [0.8, 1, 1.2, 1.5, 2, 3, 4, 5, 6], ss: [0.5, 0.8, 1, 1.2, 1.5, 2, 3, 4], al: [0.8, 1, 1.5, 2, 3, 4], brass: [0.5, 0.8, 1, 1.5, 2], gi: [0.5, 0.8, 1, 1.2, 1.5, 2] }[v.material] || [1]).map((t) => [String(t), t.toFixed(1)]) },
    { name: 'width_mm', label: 'Part width (mm)', type: 'number', value: 200, min: 10 },
    { name: 'height_mm', label: 'Part height (mm)', type: 'number', value: 100, min: 10 },
    { name: 'cut_length_m', label: 'Total cut length (m) — blank = outline only', type: 'number', min: 0, step: 'any' },
    { name: 'bends', label: 'Number of bends per part', type: 'number', value: 0, min: 0 },
    { name: 'quantity', label: 'Quantity', type: 'number', value: 1, min: 1 },
  ],
  print3d: [
    { name: 'material', label: 'Material', type: 'select', options: [['pla', 'PLA — general purpose'], ['petg', 'PETG — tough, heat resistant'], ['abs', 'ABS — strong, sandable'], ['tpu', 'TPU — flexible']] },
    { name: 'grams', label: 'Weight per part (g) — shown by your slicer', type: 'number', value: 50, min: 1 },
    { name: 'quality', label: 'Quality', type: 'select', options: [['standard', 'Standard 0.2 mm'], ['draft', 'Draft 0.28 mm'], ['fine', 'Fine 0.12 mm']] },
    { name: 'infill', label: 'Infill %', type: 'number', value: 20, min: 5 },
    { name: 'colour', label: 'Colour', type: 'text', value: 'Black' },
    { name: 'quantity', label: 'Quantity', type: 'number', value: 1, min: 1 },
  ],
  pcb: [
    { name: 'layers', label: 'Layers', type: 'select', options: [['2', '2 layers'], ['1', '1 layer'], ['4', '4 layers']] },
    { name: 'width_mm', label: 'Board width (mm)', type: 'number', value: 50, min: 5 },
    { name: 'height_mm', label: 'Board height (mm)', type: 'number', value: 50, min: 5 },
    { name: 'quantity', label: 'Quantity (boards)', type: 'number', value: 5, min: 1 },
    { name: 'thickness', label: 'Thickness (mm)', type: 'select', options: [['1.6', '1.6'], ['0.8', '0.8'], ['1.0', '1.0'], ['1.2', '1.2'], ['2.0', '2.0']] },
    { name: 'colour', label: 'Solder mask', type: 'select', options: [['green', 'Green'], ['black', 'Black'], ['blue', 'Blue'], ['red', 'Red'], ['white', 'White'], ['yellow', 'Yellow']] },
    { name: 'finish', label: 'Surface finish', type: 'select', options: [['hasl', 'HASL (standard)'], ['enig', 'ENIG (gold)']] },
    { name: 'stencil', label: 'Add SMT stencil', type: 'check' },
    { name: 'assembly', label: 'I need assembly (we quote components separately)', type: 'check' },
  ],
  laser: [
    { name: 'material', label: 'Material', type: 'select', options: [['acr3', 'Acrylic 3 mm'], ['acr2', 'Acrylic 2 mm'], ['acr5', 'Acrylic 5 mm'], ['acr8', 'Acrylic 8 mm'], ['mdf3', 'MDF 3 mm'], ['mdf6', 'MDF 6 mm'], ['ply4', 'Plywood 4 mm'], ['cardboard', 'Cardboard 3 mm'], ['leather', 'Leather'], ['eva', 'EVA foam']] },
    { name: 'colour', label: 'Acrylic colour', type: 'select', options: [['Clear', 'Clear'], ['Black', 'Black'], ['White', 'Opal white'], ['Red', 'Red'], ['Blue', 'Blue'], ['Yellow', 'Yellow'], ['Fluorescent', 'Fluorescent'], ['Frosted', 'Frosted']], show: (v) => String(v.material).startsWith('acr') },
    { name: 'width_mm', label: 'Part width (mm)', type: 'number', value: 200, min: 10 },
    { name: 'height_mm', label: 'Part height (mm)', type: 'number', value: 150, min: 10 },
    { name: 'cut_length_m', label: 'Total cut length (m) — blank = outline only', type: 'number', min: 0, step: 'any' },
    { name: 'engrave_cm2', label: 'Engraving area (cm²)', type: 'number', value: 0, min: 0 },
    { name: 'quantity', label: 'Quantity', type: 'number', value: 1, min: 1 },
  ],
  acrylic: [
    { name: 'material', label: 'Thickness', type: 'select', options: [['3', '3 mm'], ['2', '2 mm'], ['5', '5 mm'], ['8', '8 mm']] },
    { name: 'colour', label: 'Colour', type: 'select', options: [['Clear', 'Clear'], ['Black', 'Black'], ['White', 'Opal white'], ['Red', 'Red'], ['Blue', 'Blue'], ['Yellow', 'Yellow'], ['Fluorescent', 'Fluorescent'], ['Frosted', 'Frosted']] },
    { name: 'width_mm', label: 'Part width (mm)', type: 'number', value: 200, min: 10 },
    { name: 'height_mm', label: 'Part height (mm)', type: 'number', value: 150, min: 10 },
    { name: 'cut_length_m', label: 'Total cut length (m) — blank = outline only', type: 'number', min: 0, step: 'any' },
    { name: 'engrave_cm2', label: 'Engraving area (cm²)', type: 'number', value: 0, min: 0 },
    { name: 'quantity', label: 'Quantity', type: 'number', value: 1, min: 1 },
  ],
  battery: [
    { name: 'mode', label: 'What do you need?', type: 'select', options: [['build', 'Build a new battery pack'], ['test', 'Test / repair my existing pack']] },
    { name: 'cell', label: 'Cell type', type: 'select', options: [['18650', '18650 Li-ion 2600 mAh'], ['21700', '21700 Li-ion 4000 mAh'], ['lfp', 'LiFePO4 32700 6000 mAh']], show: (v) => v.mode !== 'test' },
    { name: 'series', label: 'Cells in series (S) — sets voltage', type: 'number', value: 3, min: 1, show: (v) => v.mode !== 'test' },
    { name: 'parallel', label: 'Cells in parallel (P) — sets capacity', type: 'number', value: 2, min: 1, show: (v) => v.mode !== 'test' },
    { name: 'bms_a', label: 'BMS current', type: 'select', options: [['20', '20 A'], ['10', '10 A'], ['30', '30 A'], ['40', '40 A'], ['60', '60 A'], ['80', '80 A']], show: (v) => v.mode !== 'test' },
    { name: 'connector', label: 'Output connector', type: 'select', options: [['xt60', 'XT60'], ['xt90', 'XT90'], ['anderson', 'Anderson'], ['jst', 'JST'], ['wires', 'Bare wires']], show: (v) => v.mode !== 'test' },
    { name: 'voltage', label: 'Pack voltage (e.g. 36 V)', type: 'text', show: (v) => v.mode === 'test' },
    { name: 'capacity', label: 'Capacity (e.g. 10 Ah)', type: 'text', show: (v) => v.mode === 'test' },
    { name: 'issue', label: 'What is the problem?', type: 'text', show: (v) => v.mode === 'test' },
    { name: 'quantity', label: 'Number of packs', type: 'number', value: 1, min: 1 },
  ],
};

function field(f) {
  const id = `f-${f.name}`;
  if (f.type === 'select') return `<label class="f" data-field="${f.name}">${esc(f.label)}<select name="${f.name}" id="${id}">${f.options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></label>`;
  if (f.type === 'check') return `<label class="check full" data-field="${f.name}"><input type="checkbox" name="${f.name}" id="${id}"> ${esc(f.label)}</label>`;
  return `<label class="f" data-field="${f.name}">${esc(f.label)}<input name="${f.name}" id="${id}" type="${f.type === 'number' ? 'number' : 'text'}" ${f.min != null ? `min="${f.min}"` : ''} step="${f.step || (f.type === 'number' ? 'any' : '')}" value="${f.value ?? ''}"></label>`;
}

const readFile = (file) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => fail(new Error(`Could not read ${file.name}`)); r.readAsDataURL(file); });

export async function pageServices(app, S, parts, setTitle) {
  const cat = await api('/services');
  const id = parts[1];
  if (!id || !cat.services.find((s) => s.id === id)) {
    setTitle('Services');
    app.innerHTML = `<div class="hero" style="grid-template-columns:1fr"><div><span class="badge brand">Drovox Services</span><h1 style="margin-top:10px">We make the parts you can’t buy</h1>
      <p>Upload your design, see an instant estimate, and get a final quote on WhatsApp. 3D printing, PCBs, laser and acrylic cutting, and custom battery packs — made in India with a GST invoice.</p></div></div>
      ${cat.enabled ? '' : '<div class="banner brand section"><div>Services are paused right now — you can still send a request and we’ll reply when we reopen.</div></div>'}
      <div class="svc-cards section">${cat.services.map((s) => `<a class="svc-card" href="#/services/${s.id}"><div class="txt"><h3>Drovox ${esc(s.title)}</h3><p class="small muted" style="margin:0">${esc(s.blurb)}</p><div class="row"><span class="btn indigo sm">Order now</span><span class="badge">⏱ ${esc(s.lead)}</span></div></div><div class="pic">${s.icon}</div></a>`).join('')}</div>
      <div class="grid g3 section">
        <a class="card" href="#/partner" style="display:flex;flex-direction:column;gap:8px;background:var(--ink);color:var(--bg)"><div style="font-size:2.4rem">🤝</div><h3 style="margin:0">Become a Partner</h3><p class="small" style="margin:0;opacity:.85">Resellers, schools, makerspaces and integrators get a fixed partner discount on every order.</p><span class="small" style="margin-top:auto;color:#ffb347">Apply now →</span></a></div>
      <div class="card section"><h3>How it works</h3><ol class="small" style="margin:0;padding-left:18px;line-height:1.9"><li>Choose options and upload your files — you see an estimate instantly.</li><li>Our engineers check the design and send the final quote on WhatsApp.</li><li>Approve the quote from <a class="link" href="#/account">My Account</a> (or reply YES on WhatsApp).</li><li>We produce it, message you when it’s ready, and ship or keep it for pickup.</li></ol></div>`;
    return;
  }
  const svc = cat.services.find((s) => s.id === id);
  setTitle(svc.title);
  const fields = F[id];
  app.innerHTML = `<div class="small muted" style="margin-bottom:12px"><a href="#/services">Services</a> / ${esc(svc.title)}</div>
    <div class="cart-layout"><form id="sf" class="stack">
      <div class="card"><h1 style="margin:0 0 6px">${svc.icon} ${esc(svc.title)}</h1><p class="muted">${esc(svc.blurb)}</p>
        <div class="grid g2" style="margin:10px 0 16px"><div><div class="f">Materials</div><ul class="small" style="margin:6px 0 0;padding-left:18px">${(svc.materials || []).map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>
          <div><div class="f">Capabilities</div><ul class="small" style="margin:6px 0 0;padding-left:18px">${(svc.features || []).map((m) => `<li>${esc(m)}</li>`).join('')}<li>Usually ready in ${esc(svc.lead)}</li></ul></div></div>
        <h3>Configure & get an instant price</h3><div class="form two">${fields.map(field).join('')}</div></div>
      <div class="card"><h3>Design files</h3><p class="small muted">Accepted: ${svc.files.map((x) => `.${x}`).join(' ')} · up to 5 files, 20 MB each. ${id === 'battery' ? 'Optional: a photo or datasheet.' : 'Zip several files together if needed.'}</p>
        <input type="file" id="files" multiple accept="${svc.files.map((x) => `.${x}`).join(',')}"><div id="flist" class="small" style="margin-top:6px"></div></div>
      <div class="card"><h3>Your details</h3><div class="form two"><label class="f">Name<input name="name" required value="${esc(S.user?.name || '')}"></label><label class="f">WhatsApp number<input name="phone" required inputmode="tel" value="${esc(S.user?.phone || '')}"></label>
        <label class="f">Email (optional)<input name="email" type="email" value="${esc(S.user?.email || '')}"></label><div></div>
        <label class="f full">Notes for our engineers<textarea name="notes" rows="3" placeholder="Tolerances, colours, deadline, anything else"></textarea></label></div>
        ${S.user ? '' : '<p class="small muted">Tip: <a class="link" href="#/login?next=%23%2Fservices%2F' + id + '">sign in</a> to track this request and approve the quote from your account.</p>'}</div>
    </form>
    <div class="sticky"><div class="card" id="est"><div class="skeleton" style="min-height:220px"></div></div></div></div>`;
  const form = $('#sf');
  const values = () => { const v = formData(form); for (const f of fields) if (f.type === 'check') v[f.name] = !!v[f.name]; return v; };
  const toggle = () => {
    const v = values();
    for (const f of fields) {
      $(`[data-field="${f.name}"]`, form).classList.toggle('hidden', !!f.show && !f.show(v));
      if (f.dyn) {   // options that depend on another choice (e.g. thickness per metal)
        const sel = form.elements[f.name]; const opts = f.dyn(v); const keep = opts.some(([o]) => o === sel.value) ? sel.value : opts[Math.min(2, opts.length - 1)][0];
        if (opts.map(([o]) => o).join() !== [...sel.options].map((o) => o.value).join()) sel.innerHTML = opts.map(([o, l]) => `<option value="${esc(o)}">${esc(l)}</option>`).join('');
        sel.value = keep;
      }
    }
  };
  let t; let last = null;
  const refresh = () => {
    toggle(); clearTimeout(t);
    t = setTimeout(async () => {
      try {
        if (!document.body.contains(form)) return;   // user moved to another page
        last = await api('/services/estimate', { method: 'POST', body: { service: id, ...values() } });
        if (!$('#est')) return;
        const info = last.info || {};
        $('#est').innerHTML = `<h3>Instant estimate</h3><div class="summary">${last.lines.map((l) => `<div class="r-line"><span>${esc(l.label)}</span><span class="nowrap">${money(l.amount, 2)}</span></div>`).join('')}
          <div class="r-line"><span>GST ${cat.gst_rate}%</span><span>${money(last.gst, 2)}</span></div><div class="r-line total"><span>Estimate</span><span>${money(last.total, 2)}</span></div></div>
          ${info.nominal_v ? `<div class="banner teal" style="margin-top:10px"><div class="small"><b>${info.nominal_v} V · ${info.capacity_ah} Ah · ${info.energy_wh} Wh</b><br>${info.cells} cells · approx. ${info.weight_kg} kg</div></div>` : ''}
          ${info.area_cm2 ? `<div class="small muted" style="margin-top:8px">Board area ${info.area_cm2} cm²</div>` : ''}
          ${info.note ? `<div class="small" style="margin-top:8px;color:var(--amber)">${esc(info.note)}</div>` : ''}
          <div class="small muted" style="margin-top:8px">⏱ Usually ready in ${esc(last.lead)}. Final price is confirmed after we check your files.</div>
          <button class="btn primary lg block" id="send" style="margin-top:14px">Request final quote</button>`;
        $('#send').onclick = submit;
      } catch (e) { if (!$('#est')) return; $('#est').innerHTML = `<h3>Instant estimate</h3><p class="small" style="color:var(--red)">${esc(e.message)}</p>`; }
    }, 250);
  };
  const submit = async () => {
    if (!form.reportValidity()) return;
    const files = [...$('#files').files];
    if (files.length > 5) return toast('Upload at most 5 files', 'err');
    const big = files.find((f) => f.size > 20 * 1024 * 1024); if (big) return toast(`${big.name} is larger than 20 MB`, 'err');
    const btn = $('#send'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Uploading…';
    try {
      const enc = await Promise.all(files.map(async (f) => ({ name: f.name, data: await readFile(f) })));
      const r = await api('/services/requests', { method: 'POST', body: { service: id, ...values(), files: enc } });
      app.innerHTML = `<div class="empty card"><div class="big">✅</div><h2>Request ${esc(r.req_no)} received</h2><p>Estimate ${money(r.estimate.total, 2)} incl. GST. We’ll check your design and send the final quote on WhatsApp${S.user ? ' — you can also track and approve it in My Account' : ''}.</p>
        <div class="row" style="justify-content:center">${S.user ? '<a class="btn primary" href="#/account">My Account</a>' : ''}<a class="btn" href="#/services">Back to services</a></div></div>`;
      window.scrollTo(0, 0);
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = 'Request final quote'; }
  };
  form.addEventListener('input', refresh); form.addEventListener('change', refresh);
  $('#files').onchange = (e) => { $('#flist').innerHTML = [...e.target.files].map((f) => `📎 ${esc(f.name)} <span class="muted">(${(f.size / 1048576).toFixed(1)} MB)</span>`).join('<br>'); };
  refresh();
}

export async function pagePartner(app, S, setTitle, params = new URLSearchParams()) {
  const wantType = params.get('type');
  setTitle(wantType === 'seller' ? 'Sell on Drovox' : 'Become a Partner');
  const p = await api('/partner/program');
  const app_ = p.application;
  const status = p.partner
    ? `<div class="banner teal"><div>🎉 <b>You are a Drovox partner.</b> Your ${p.partner.discount}% partner discount is applied automatically at checkout.</div><a class="btn sm" href="#/search">Start ordering</a></div>`
    : app_?.status === 'pending' ? '<div class="banner brand"><div>⏳ Your application is under review. We’ll reply on WhatsApp within 2 working days.</div></div>'
      : app_?.status === 'rejected' ? `<div class="banner brand"><div>Your last application was not approved${app_.review_note ? `: ${esc(app_.review_note)}` : ''}. You can apply again below.</div></div>` : '';
  app.innerHTML = `<div class="hero" style="grid-template-columns:1.2fr 1fr"><div><span class="badge brand">Drovox Partner Program</span><h1 style="margin-top:10px">Grow with Drovox</h1>
      <p>Resellers, schools and colleges, makerspaces, robotics academies, system integrators and creators get partner pricing, priority stock and a dedicated WhatsApp line.</p></div>
      <div class="ai-box"><div style="font-weight:700;margin-bottom:8px">Partner discount on every order</div>${p.types.map((t) => `<div class="row between" style="padding:4px 0;border-bottom:1px solid rgba(255,255,255,.12)"><span class="small">${esc(t.label)}</span><b>${t.discount}%</b></div>`).join('')}</div></div>
    ${status ? `<div class="section">${status}</div>` : ''}
    <div class="grid g4 section">
      <div class="card"><h3>💸 Partner pricing</h3><p class="small muted">A fixed discount on top of bulk prices, applied automatically when you sign in.</p></div>
      <div class="card"><h3>🧾 GST invoices</h3><p class="small muted">B2B invoices with your GSTIN so you can claim input credit.</p></div>
      <div class="card"><h3>🚚 Priority stock</h3><p class="small muted">First access to new imports and reserved stock for repeat orders.</p></div>
      <div class="card"><h3>🛠️ Services</h3><p class="small muted">3D printing, PCBs, cutting and battery packs at partner rates.</p></div></div>
    ${p.partner || app_?.status === 'pending' || !p.enabled ? '' : S.user ? `<form class="card form two section" id="pf"><h3 class="full" style="margin:0">Apply now</h3>
      <label class="f">Partner type<select name="type">${p.types.map((t) => `<option value="${t.id}">${esc(t.label)}</option>`).join('')}</select></label>
      <label class="f">Organisation / shop name<input name="company" required></label>
      <label class="f">Contact name<input name="name" required value="${esc(S.user.name)}"></label><label class="f">WhatsApp number<input name="phone" required value="${esc(S.user.phone || '')}"></label>
      <label class="f">City<input name="city"></label><label class="f">GSTIN (optional)<input name="gstin" maxlength="15" style="text-transform:uppercase"></label>
      <label class="f">Expected monthly purchase<select name="monthly_volume"><option>Under ₹25,000</option><option>₹25,000 – ₹1 lakh</option><option>₹1 – 5 lakh</option><option>Above ₹5 lakh</option></select></label>
      <label class="f">Website / YouTube / Instagram (optional)<input name="website"></label>
      <label class="f full">Tell us about your business<textarea name="message" rows="3" placeholder="What you sell or teach, your customers, what you need from us"></textarea></label>
      <button class="btn primary lg full">Submit application</button></form>`
    : `<div class="card section" style="text-align:center"><p>Sign in or create a free account to apply — your partner discount is linked to your account.</p><a class="btn primary" href="#/register?next=%23%2Fpartner">Create account</a> <a class="btn" href="#/login?next=%23%2Fpartner">Sign in</a></div>`}`;
  if (wantType && $('#pf [name=type]')) { $('#pf [name=type]').value = wantType; $('#pf').scrollIntoView({ behavior: 'smooth' }); }
  $('#pf')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const r = await api('/partner/apply', { method: 'POST', body: formData(e.target) }); toast(r.message); pagePartner(app, S, setTitle, params); } catch (err) { toast(err.message, 'err'); }
  });
}

/** Account page section: my service requests with "Approve quote". */
export async function accountServices(el) {
  const rows = await api('/me/services');
  if (!el || !document.body.contains(el)) return;
  el.innerHTML = rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Request</th><th>Service</th><th class="r">Estimate</th><th class="r">Quote</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td><b>${esc(r.req_no)}</b></td><td class="small">${esc(r.title)}</td><td class="r">${money(r.estimate)}</td><td class="r">${r.quoted_price ? money(r.quoted_price) : '—'}</td><td>${serviceBadge(r.status)}</td>
      <td>${r.status === 'quoted' ? `<button class="btn sm primary" data-accept="${esc(r.req_no)}">Approve quote</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="small muted">No service requests yet. <a class="link" href="#/services">Get a 3D print, PCB, cutting or battery pack quote →</a></p>';
  $$('[data-accept]', el).forEach((b) => { b.onclick = async () => { try { await api(`/me/services/${b.dataset.accept}/accept`, { method: 'POST' }); toast('Quote approved — we’ll start production and keep you posted on WhatsApp'); accountServices(el); } catch (e) { toast(e.message, 'err'); } }; });
}
