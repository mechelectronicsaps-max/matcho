const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const EXAMPLES = [
  ['555 LED flasher', 'A 555 timer LED flasher running from 9 V, about 1 Hz, through-hole parts so a beginner can solder it.'],
  ['USB-C 3.3 V supply', 'USB-C powered 3.3 V regulator board with a power LED and a 3-pin output header.'],
  ['ESP32 board', 'An ESP32 board powered from USB-C with a CH340 USB-serial chip, auto-reset, BOOT and RESET buttons, an LED on IO2 and a GPIO header.'],
  ['Relay driver', 'A 5 V relay module driven from a 3.3 V logic input, with flyback diode, status LED and screw terminals for the load.'],
];

// ---------- tabs ----------
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === `tab-${b.dataset.tab}`));
  if (b.dataset.tab === 'footprints' && !$('#fpGrid').children.length) loadFootprints();
  if (b.dataset.tab === 'parts' && !$('#parts').children.length) loadParts();
}));

// ---------- pan / zoom viewer ----------
function mountViewer(el, svg) {
  el.innerHTML = `<div class="inner">${svg}</div>`;
  const inner = el.firstElementChild;
  const s = inner.querySelector('svg');
  const vb = s.viewBox.baseVal;
  let scale = 1, x = 0, y = 0;
  const fit = () => {
    const r = el.getBoundingClientRect();
    const w = Number(s.getAttribute('width')) || vb.width, h = Number(s.getAttribute('height')) || vb.height;
    scale = Math.min(r.width / w, r.height / h) * 0.95;
    x = (r.width - w * scale) / 2; y = (r.height - h * scale) / 2;
    apply();
  };
  const apply = () => { inner.style.transform = `translate(${x}px,${y}px) scale(${scale})`; };
  el.onwheel = (e) => {
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const k = Math.exp(-e.deltaY * 0.0015);
    x = mx - (mx - x) * k; y = my - (my - y) * k; scale *= k;
    apply();
  };
  let drag = null;
  el.onpointerdown = (e) => { drag = { sx: e.clientX - x, sy: e.clientY - y }; el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing'; };
  el.onpointermove = (e) => { if (drag) { x = e.clientX - drag.sx; y = e.clientY - drag.sy; apply(); } };
  el.onpointerup = () => { drag = null; el.style.cursor = ''; };
  el.ondblclick = fit;
  requestAnimationFrame(fit);
  new ResizeObserver(() => { if (!drag) fit(); }).observe(el);
}

document.querySelectorAll('.layers input').forEach((cb) => cb.addEventListener('change', () => {
  document.querySelectorAll(`#pcbView .layer-${cb.dataset.layer}`).forEach((g) => { g.style.display = cb.checked ? '' : 'none'; });
}));

// ---------- status + examples ----------
fetch('/api/status').then((r) => r.json()).then((s) => {
  $('#status').innerHTML = `${s.ai ? `AI: <b>${esc(s.model)}</b>` : '<b>Offline demo mode</b> (set ANTHROPIC_API_KEY for custom designs)'} · <b>${s.footprints}</b> footprints · <b>${s.components}</b> parts`;
});
for (const [label, text] of EXAMPLES) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => { $('#prompt').value = text; };
  $('#examples').append(b);
}

// ---------- generate ----------
const log = (msg, cls = '') => { const d = document.createElement('div'); d.className = cls; d.textContent = msg; $('#progress').append(d); };

$('#go').onclick = async () => {
  const prompt = $('#prompt').value.trim();
  if (!prompt) return $('#prompt').focus();
  $('#go').disabled = true;
  $('#progress').innerHTML = '';
  log('Sending request…');
  try {
    const res = await fetch('/api/design', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const m = JSON.parse(line);
        if (m.type === 'progress') log(m.message);
        else if (m.type === 'error') log(m.error, 'err');
        else if (m.type === 'result') { log('Done.'); show(m); }
      }
    }
  } catch (e) {
    log(e.message, 'err');
  } finally {
    $('#go').disabled = false;
  }
};

$('#rerender').onclick = async () => {
  let design;
  try { design = JSON.parse($('#designJson').value); } catch (e) { return alert(`Invalid JSON: ${e.message}`); }
  $('#rerender').disabled = true;
  try {
    const res = await fetch('/api/render', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ design }) });
    const data = await res.json();
    if (!res.ok) throw new Error([data.error, ...(data.errors || [])].join('\n'));
    show(data);
  } catch (e) { alert(e.message); } finally { $('#rerender').disabled = false; }
};

function show(r) {
  $('#summary').classList.remove('hidden');
  $('#title').textContent = r.design.title;
  $('#desc').textContent = r.design.summary;
  const s = r.pcbStats;
  $('#stats').innerHTML = [
    ['Components', r.design.components.length], ['Nets', r.design.nets.length],
    ['Board', `${s.width} × ${s.height} mm`], ['Routed', `${s.completion}%`],
    ['Tracks / vias', `${s.tracks} / ${s.vias}`], ['Track length', `${Math.round(s.trackLength)} mm`],
  ].map(([k, v]) => `<div>${k}<b>${v}</b></div>`).join('');
  const base = `/api/results/${r.id}/files/`;
  const label = (f) => f.replace(`${r.base}`, '').replace(/^[-.]/, '') || f;
  $('#downloads').innerHTML = `<a class="main" href="${base}all.zip">Download everything (.zip)</a>` + r.files.map((f) => `<a href="${base}${encodeURIComponent(f)}">${esc(label(f))}</a>`).join('');
  $('#notes').innerHTML = (r.design.notes || []).map((n) => `<li>${esc(n)}</li>`).join('') || '<li>None</li>';
  const warns = [...(r.errors || []).map((e) => `Error: ${e}`), ...r.warnings];
  $('#warnings').innerHTML = warns.map((w) => `<li>${esc(w)}</li>`).join('') || '<li>None</li>';
  $('#warnCount').textContent = `(${warns.length})`;
  mountViewer($('#schView'), r.schematicSvg);
  mountViewer($('#pcbView'), r.pcbSvg);
  document.querySelectorAll('.layers input').forEach((cb) => cb.dispatchEvent(new Event('change')));
  $('#bom').innerHTML = '<tr><th>Qty</th><th>References</th><th>Value</th><th>Part</th><th>Footprint</th></tr>' +
    r.bom.map((b) => `<tr><td>${b.qty}</td><td>${esc(b.refs.join(', '))}</td><td>${esc(b.value)}</td><td>${esc(b.description)}</td><td><code>${esc(b.footprint)}</code></td></tr>`).join('');
  $('#designJson').value = JSON.stringify(r.design, null, 2);
}

// ---------- footprint library ----------
let fpTimer;
async function loadFootprints() {
  const q = $('#fpSearch').value, cat = $('#fpCat').value;
  const data = await (await fetch(`/api/footprints?q=${encodeURIComponent(q)}&category=${encodeURIComponent(cat)}&limit=240`)).json();
  if ($('#fpCat').options.length === 1) for (const c of data.categories) $('#fpCat').append(new Option(c, c));
  $('#fpCount').textContent = `${data.items.length}${data.items.length === 240 ? '+' : ''} of ${data.total}`;
  $('#fpGrid').innerHTML = data.items.map((f) => `<div class="fp"><img loading="lazy" src="/api/footprints/${encodeURIComponent(f.name)}/svg" alt="">
    <div class="n">${esc(f.name)}</div><div class="d">${esc(f.description)}</div><div class="d">${f.pads} pads · ${f.size[0]} × ${f.size[1]} mm</div>
    <a href="/api/footprints/${encodeURIComponent(f.name)}/kicad_mod">.kicad_mod</a></div>`).join('');
}
$('#fpSearch').oninput = () => { clearTimeout(fpTimer); fpTimer = setTimeout(loadFootprints, 200); };
$('#fpCat').onchange = loadFootprints;

async function loadParts() {
  const parts = await (await fetch('/api/components')).json();
  $('#parts').innerHTML = '<tr><th>Id</th><th>Description</th><th>Pins</th><th>Footprints</th></tr>' + parts.map((p) =>
    `<tr><td><b>${esc(p.id)}</b><br><span class="d">${esc(p.category)}</span></td><td>${esc(p.description)}</td><td><code>${esc(p.pins.map((x) => `${x.num}:${x.name}`).join(' '))}</code></td><td><code>${esc(p.footprints.join(', '))}</code></td></tr>`).join('');
}
