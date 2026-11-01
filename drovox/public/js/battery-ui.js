// Custom lithium battery pack builder (robu.in style): pick the cell, set voltage & capacity (series/parallel
// worked out for you), BMS, connector, casing and extras — the pack drawing, specs and price update live.
import { $, $$, api, esc, money, toast } from './common.js';
import { trustRow } from './laser-ui.js';

const readFile = (file) => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => fail(new Error(`Could not read ${file.name}`)); r.readAsDataURL(file); });
const VOLTS = {
  li: [[1, '3.7 V'], [2, '7.4 V'], [3, '11.1 V'], [4, '14.8 V'], [6, '22.2 V'], [7, '24 V'], [10, '36 V'], [13, '48 V'], [14, '52 V'], [16, '60 V'], [20, '72 V']],
  lfp: [[1, '3.2 V'], [2, '6.4 V'], [4, '12.8 V'], [8, '25.6 V'], [12, '38.4 V'], [16, '51.2 V'], [20, '64 V'], [24, '76.8 V']],
};
const APPS = ['Robot / AGV', 'Drone / RC', 'E-bike / scooter', 'Solar / inverter / UPS', 'Power bank / portable', 'Other'];

function packSvg(s, p, cell) {
  const lfp = cell.chem === 'LiFePO4';
  const r = 10; const gap = 3; const step = r * 2 + gap; const W = s * step + 40; const H = p * step + 40;
  let g = '';
  for (let i = 0; i < s; i++) {
    const flip = i % 2;   // alternate cell direction like a real series pack
    g += `<rect x="${20 + i * step - 1}" y="14" width="${r * 2 + 2}" height="${p * step + 8}" rx="4" fill="#c9ced6" opacity=".55"/>`;
    for (let j = 0; j < p; j++) {
      const cx = 20 + i * step + r; const cy = 20 + j * step + r;
      g += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${lfp ? '#4b6584' : '#2f6fde'}" stroke="#0f172a" stroke-width="1"/><circle cx="${cx}" cy="${cy}" r="${r * 0.45}" fill="${flip ? '#e5e7eb' : '#9ca3af'}"/><text x="${cx}" y="${cy + 3}" font-size="8" text-anchor="middle" fill="#111" font-family="sans-serif">${flip ? '−' : '+'}</text>`;
    }
  }
  g += `<text x="6" y="${H / 2 + 4}" font-size="12" font-weight="700" fill="#16a34a" font-family="sans-serif">−</text><text x="${W - 14}" y="${H / 2 + 4}" font-size="12" font-weight="700" fill="#dc2626" font-family="sans-serif">+</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${s} in series by ${p} in parallel">${g}</svg>`;
}

export async function pageBatteryService(app, S, svc, cat) {
  const B = cat.battery;
  const st = { mode: 'build', cell: '18650', series: 3, parallel: 2, target_ah: '', bms_a: 20, connector: 'xt60', casing: 'shrink', wire_cm: 10, ntc: false, charger: false, application: '', quantity: 1, step: 1, files: [] };
  const cell = () => B.cells.find((c) => c.id === st.cell);
  const store = S.cfg.store || {};

  app.innerHTML = `<div class="small muted" style="margin-bottom:12px"><a href="#/">Home</a> → <a href="#/services">Services</a> → <b style="color:#3b2a8c">${esc(svc.title)}</b></div>
    <div class="lz-layout">
      <div class="stack">
        <div class="lz-preview bat" id="pack"></div>
        <div class="m3-stats" id="bstats"></div><div id="bwarn"></div>
        <div class="card small"><b>Every pack includes</b><ul style="margin:6px 0 0;padding-left:18px;line-height:1.8"><li>BIS-registered, matched cells (capacity &amp; IR sorted)</li><li>Spot-welded pure nickel strip, fish-paper insulation</li><li>Balancing BMS with over-charge, over-discharge &amp; short protection</li><li>Capacity and voltage test report</li></ul></div>
      </div>
      <div class="stack">
        <div><a class="small link" href="#/services" style="color:inherit;text-decoration:underline">Drovox Services</a><h1 style="margin:6px 0 4px">${esc(svc.title)}</h1>
          <div class="small muted">${esc(svc.blurb)}</div>
          <div style="margin-top:10px">Availability: <b style="color:var(--green)">In stock</b> · Lead time ${esc(svc.lead)}</div>
          ${store.support_email ? `<div class="small" style="margin-top:4px">For bulk orders or B2B enquiries, email us: <a class="link" href="mailto:${esc(store.support_email)}">${esc(store.support_email)}</a></div>` : ''}</div>
        <div class="opt-chips"><button type="button" class="chip opt on" data-mode="build">🔋 Build a new pack</button><button type="button" class="chip opt" data-mode="test">🧪 Test / repair my pack</button></div>
        <div id="flow"></div>
        ${trustRow(S)}
      </div>
    </div>`;

  const steps = [['1', 'Cell type'], ['2', 'Voltage & capacity'], ['3', 'Protection & output'], ['4', 'Finalize']];
  function renderFlow() {
    if (st.mode === 'test') {
      $('#flow').innerHTML = `<div class="lz-steps"><div class="lz-step open"><div class="lz-step-h"><span class="lz-num">1</span>Tell us about your pack</div><div class="lz-step-b">
        <div class="form two" style="padding:12px 18px"><label class="f">Pack voltage<input id="t-v" placeholder="e.g. 36 V"></label><label class="f">Capacity<input id="t-c" placeholder="e.g. 10 Ah"></label>
        <label class="f full">What is the problem?<input id="t-i" placeholder="Not charging / low backup / one cell group dead…"></label>
        <label class="f full">Photos (optional)<input type="file" id="t-f" accept=".jpg,.jpeg,.png,.pdf" multiple></label></div>${finalBlock()}</div></div></div>`;
      $('#t-f').onchange = (e) => { st.files = [...e.target.files].slice(0, 5); };
      wireFinal(); return;
    }
    $('#flow').innerHTML = `<div class="lz-steps">${steps.map(([n, t]) => `<div class="lz-step${String(st.step) === n ? ' open' : ''}"><button type="button" class="lz-step-h" data-step="${n}"><span class="lz-num">${n}</span>${t}<span class="lz-done" id="sum${n}"></span></button><div class="lz-step-b" id="b${n}"></div></div>`).join('')}</div>`;
    $$('[data-step]').forEach((b) => { b.onclick = () => { st.step = Number(b.dataset.step); renderFlow(); }; });
    const body = $(`#b${st.step}`); const c = cell();
    const next = (n) => `<div style="text-align:center;margin-top:12px"><button type="button" class="btn indigo" data-next="${n}">Next</button></div>`;
    if (st.step === 1) {
      body.innerHTML = `<div class="opt-chips" style="padding:12px 18px">${B.cells.map((x) => `<button type="button" class="chip opt${x.id === st.cell ? ' on' : ''}" data-cell="${x.id}">${esc(x.short)}</button>`).join('')}</div>
        <div class="m3-mat"><div class="m3-mat-h"><span class="m3-sw" style="background:${c.chem === 'LiFePO4' ? '#4b6584' : '#2f6fde'}"></span><div><b>${esc(c.label)}</b><div class="small muted">${esc(c.chem)}</div></div></div>
          <dl><dt>Nominal / full</dt><dd>${c.v} V / ${c.vmax} V per cell</dd><dt>Capacity</dt><dd>${c.mah} mAh</dd><dt>Max discharge</dt><dd>${c.max_a} A continuous per cell</dd><dt>Cycle life</dt><dd>${esc(c.cycles)} cycles</dd><dt>Size &amp; weight</dt><dd>Ø${c.dia} × ${c.len} mm · ${c.g} g</dd><dt>Best for</dt><dd>${esc(c.use)}</dd></dl></div>${next(2)}`;
      $$('[data-cell]', body).forEach((b) => { b.onclick = () => { const was = cell(); st.cell = b.dataset.cell; if ((was.chem === 'LiFePO4') !== (cell().chem === 'LiFePO4')) st.series = cell().chem === 'LiFePO4' ? 4 : 3; if (st.target_ah) st.parallel = Math.max(1, Math.ceil(Number(st.target_ah) * 1000 / cell().mah)); renderFlow(); update(); }; });
    } else if (st.step === 2) {
      const volts = c.chem === 'LiFePO4' ? VOLTS.lfp : VOLTS.li;
      body.innerHTML = `<div class="m3-row"><span class="opt-label">Target voltage</span><div class="opt-chips">${volts.map(([sN, l]) => `<button type="button" class="chip opt${sN === st.series ? ' on' : ''}" data-s="${sN}">${l}</button>`).join('')}</div></div>
        <div class="m3-row"><span class="opt-label">Cells in series</span><div class="row"><div class="qty-step"><button type="button" data-ds="-1">−</button><input id="sS" type="number" min="1" max="24" value="${st.series}"><button type="button" data-ds="1">+</button></div><span class="small muted">${st.series}S = ${(st.series * c.v).toFixed(1)} V nominal, ${(st.series * c.vmax).toFixed(1)} V full</span></div></div>
        <div class="m3-row"><span class="opt-label">Target capacity</span><div class="row"><input id="tah" type="number" min="0" step="0.5" placeholder="e.g. 10" value="${esc(st.target_ah)}" style="width:110px"> <span class="small muted">Ah — we work out the parallel count</span></div></div>
        <div class="m3-row"><span class="opt-label">Cells in parallel</span><div class="row"><div class="qty-step"><button type="button" data-dp="-1">−</button><input id="sP" type="number" min="1" max="20" value="${st.parallel}"><button type="button" data-dp="1">+</button></div><span class="small muted">${st.parallel}P = ${(st.parallel * c.mah / 1000).toFixed(1)} Ah</span></div></div>${next(3)}`;
      $$('[data-s]', body).forEach((b) => { b.onclick = () => { st.series = Number(b.dataset.s); renderFlow(); update(); }; });
      const setS = (v) => { st.series = Math.max(1, Math.min(24, Math.floor(Number(v) || 1))); renderFlow(); update(); };
      const setP = (v) => { st.parallel = Math.max(1, Math.min(20, Math.floor(Number(v) || 1))); st.target_ah = ''; renderFlow(); update(); };
      $$('[data-ds]', body).forEach((b) => { b.onclick = () => setS(st.series + Number(b.dataset.ds)); }); $('#sS').onchange = (e) => setS(e.target.value);
      $$('[data-dp]', body).forEach((b) => { b.onclick = () => setP(st.parallel + Number(b.dataset.dp)); }); $('#sP').onchange = (e) => setP(e.target.value);
      $('#tah').onchange = (e) => { st.target_ah = e.target.value; if (Number(st.target_ah) > 0) st.parallel = Math.max(1, Math.min(20, Math.ceil(Number(st.target_ah) * 1000 / c.mah))); renderFlow(); update(); };
    } else if (st.step === 3) {
      const ch = (key, list, fmt = (x) => x) => `<div class="opt-chips">${list.map((x) => { const [v, l] = Array.isArray(x) ? x : [x, fmt(x)]; return `<button type="button" class="chip opt${String(st[key]) === String(v) ? ' on' : ''}" data-k="${key}" data-v="${esc(v)}">${esc(l)}</button>`; }).join('')}</div>`;
      body.innerHTML = `<div class="m3-row"><span class="opt-label">BMS current</span>${ch('bms_a', B.bms, (a) => `${a} A`)}</div>
        <div class="m3-row"><span class="opt-label">Connector</span>${ch('connector', B.connectors)}</div>
        <div class="m3-row"><span class="opt-label">Wire length</span>${ch('wire_cm', B.wires, (w) => `${w} cm`)}</div>
        <div class="m3-row"><span class="opt-label">Casing</span>${ch('casing', B.casing)}</div>
        <div class="m3-row"><span class="opt-label">Extras</span><div class="stack" style="gap:6px"><label class="check"><input type="checkbox" id="ntc" ${st.ntc ? 'checked' : ''}> NTC temperature sensor</label><label class="check"><input type="checkbox" id="chg" ${st.charger ? 'checked' : ''}> Matching charger (${(st.series * c.vmax).toFixed(1)} V)</label></div></div>
        <div class="m3-row"><span class="opt-label">Used for</span>${ch('application', APPS.map((a) => [a, a]))}</div>${next(4)}`;
      $$('[data-k]', body).forEach((b) => { b.onclick = () => { st[b.dataset.k] = ['bms_a', 'wire_cm'].includes(b.dataset.k) ? Number(b.dataset.v) : b.dataset.v; renderFlow(); update(); }; });
      $('#ntc').onchange = (e) => { st.ntc = e.target.checked; update(); }; $('#chg').onchange = (e) => { st.charger = e.target.checked; update(); };
    } else {
      body.innerHTML = finalBlock(); wireFinal();
    }
    $$('[data-next]').forEach((b) => { b.onclick = () => { st.step = Number(b.dataset.next); renderFlow(); }; });
    $('#sum1').textContent = c.short; $('#sum2').textContent = `${st.series}S${st.parallel}P`; $('#sum3').textContent = `${st.bms_a} A · ${st.connector.toUpperCase()}`;
  }
  function finalBlock() {
    return `<div class="m3-row"><span class="opt-label">Remark</span><textarea id="notes" rows="2" placeholder="Size limits, device it powers, deadline…"></textarea></div>
      <div class="form two" style="padding:12px 18px"><label class="f">Name<input id="c-name" value="${esc(S.user?.name || '')}"></label><label class="f">WhatsApp number<input id="c-phone" inputmode="tel" value="${esc(S.user?.phone || '')}"></label><label class="f">Email (optional)<input id="c-email" type="email" value="${esc(S.user?.email || '')}"></label></div>
      <div class="m3-price"><div id="ptext" class="m3-ptext">Calculating…</div><div class="qty-step"><button type="button" id="qm">−</button><input id="qty" type="number" min="1" value="${st.quantity}"><button type="button" id="qp">+</button></div><button type="button" class="btn indigo" id="go">Request final quote</button></div><div id="lines"></div>`;
  }
  function wireFinal() {
    const setQ = (n) => { st.quantity = Math.max(1, Math.min(500, Math.floor(Number(n) || 1))); $('#qty').value = st.quantity; update(); };
    $('#qm').onclick = () => setQ(st.quantity - 1); $('#qp').onclick = () => setQ(st.quantity + 1); $('#qty').onchange = (e) => setQ(e.target.value);
    $('#go').onclick = submit; update();
  }
  const body = () => (st.mode === 'test'
    ? { service: 'battery', mode: 'test', voltage: $('#t-v')?.value, capacity: $('#t-c')?.value, issue: $('#t-i')?.value, quantity: st.quantity }
    : { service: 'battery', mode: 'build', cell: st.cell, series: st.series, parallel: st.parallel, bms_a: st.bms_a, connector: st.connector, casing: st.casing, wire_cm: st.wire_cm, ntc: st.ntc, charger: st.charger, application: st.application, quantity: st.quantity });

  let t;
  function update() {
    if (st.mode === 'build') {
      const c = cell();
      $('#pack').innerHTML = `${packSvg(st.series, st.parallel, c)}<span class="lz-dim">${st.series}S${st.parallel}P · ${st.series * st.parallel} cells</span>`;
    } else $('#pack').innerHTML = '<div class="lz-empty"><div style="font-size:2.6rem">🧪</div><div class="small muted">We test capacity, internal resistance, cell balance and the BMS, then quote any repair.</div></div>';
    clearTimeout(t);
    t = setTimeout(async () => {
      try {
        const e = await api('/services/estimate', { method: 'POST', body: body() });
        const i = e.info;
        $('#bstats').innerHTML = st.mode === 'build' ? `<div><span>Voltage</span><b>${i.nominal_v} V</b><span>${i.min_v}–${i.max_v} V</span></div><div><span>Capacity</span><b>${i.capacity_ah} Ah</b><span>${i.energy_wh} Wh</span></div><div><span>Max current</span><b>${i.max_current_a} A</b><span>continuous</span></div><div><span>Approx. size · weight</span><b>${i.size_mm.join('×')} mm</b><span>${i.weight_kg} kg</span></div>` : '';
        $('#bwarn').innerHTML = [i.warn, i.note].filter(Boolean).map((w) => `<div class="small" style="color:var(--amber);margin-top:4px">⚠ ${esc(w)}</div>`).join('');
        if ($('#ptext')) {
          $('#ptext').innerHTML = `<span class="small muted">Estimate incl. GST</span><b>${money(e.total, 2)}</b>`;
          $('#lines').innerHTML = `<details class="m3-lines" open><summary class="small">Price breakdown</summary>${e.lines.map((l) => `<div class="r-line small"><span>${esc(l.label)}</span><span>${money(l.amount, 2)}</span></div>`).join('')}<div class="r-line small"><span>GST ${cat.gst_rate}%</span><span>${money(e.gst, 2)}</span></div><div class="tiny muted" style="margin-top:6px">⏱ Usually ready in ${esc(e.lead)}. Final price is confirmed by our battery engineer.</div></details>`;
        }
      } catch (err) { if ($('#ptext')) $('#ptext').innerHTML = `<span style="color:var(--red)">${esc(err.message)}</span>`; }
    }, 150);
  }
  async function submit() {
    const name = $('#c-name').value.trim(); const phone = $('#c-phone').value.trim();
    if (!name || phone.replace(/\D/g, '').length < 10) { toast('Add your name and 10-digit WhatsApp number', 'err'); (name ? $('#c-phone') : $('#c-name')).focus(); return; }
    const btn = $('#go'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending…';
    try {
      const files = await Promise.all(st.files.map(async (f) => ({ name: f.name, data: await readFile(f) })));
      const r = await api('/services/requests', { method: 'POST', body: { ...body(), notes: $('#notes')?.value || '', name, phone, email: $('#c-email').value, files } });
      app.innerHTML = `<div class="empty card"><div class="big">✅</div><h2>Request ${esc(r.req_no)} received</h2><p>Estimate ${money(r.estimate.total, 2)} incl. GST. Our battery engineer will confirm the design and send the final quote on WhatsApp${S.user ? ' — you can also track and approve it in My Account' : ''}.</p>
        <div class="row" style="justify-content:center">${S.user ? '<a class="btn primary" href="#/account">My Account</a>' : ''}<a class="btn" href="#/services">Back to services</a></div></div>`;
      window.scrollTo(0, 0);
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; btn.textContent = 'Request final quote'; }
  }
  $$('[data-mode]').forEach((b) => { b.onclick = () => { st.mode = b.dataset.mode; $$('[data-mode]').forEach((x) => x.classList.toggle('on', x === b)); renderFlow(); update(); }; });
  renderFlow(); update();
}
