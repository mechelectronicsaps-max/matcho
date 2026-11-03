// SVG preview of the routed board. Layers are <g> groups with classes so the
// browser can toggle them.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f = (v) => Number(v.toFixed(3));

function padShape(p, cls) {
  const x = p.x - p.w / 2, y = p.y - p.h / 2;
  if (p.shape === 'circle' && p.w === p.h) return `<circle cx="${f(p.x)}" cy="${f(p.y)}" r="${f(p.w / 2)}" class="${cls}"/>`;
  const rx = p.shape === 'oval' || p.shape === 'circle' ? Math.min(p.w, p.h) / 2 : p.shape === 'roundrect' ? Math.min(p.w, p.h) * 0.25 : 0;
  return `<rect x="${f(x)}" y="${f(y)}" width="${f(p.w)}" height="${f(p.h)}" rx="${f(rx)}" class="${cls}"/>`;
}

export function renderPcbSvg(pcb) {
  const { width: W, height: H } = pcb.board;
  const m = 3;
  const track = (t) => `<line x1="${t.x1}" y1="${t.y1}" x2="${t.x2}" y2="${t.y2}" stroke-width="${t.w}"><title>${esc(t.net)}</title></line>`;
  const bottom = pcb.tracks.filter((t) => t.layer === 'B.Cu').map(track).join('');
  const top = pcb.tracks.filter((t) => t.layer === 'F.Cu').map(track).join('');
  const padsB = pcb.pads.filter((p) => p.type === 'thru').map((p) => padShape(p, 'padb')).join('');
  const padsF = pcb.pads.map((p) => `<g><title>${esc(`${p.ref}.${p.num}${p.net ? ' - ' + p.net : ''}`)}</title>${padShape(p, 'pad')}</g>`).join('');
  const holes = pcb.pads.filter((p) => p.drill).map((p) => `<circle cx="${p.x}" cy="${p.y}" r="${p.drill / 2}" class="hole"/>`).join('');
  const vias = pcb.vias.map((v) => `<circle cx="${v.x}" cy="${v.y}" r="${v.d / 2}" class="via"><title>${esc(v.net)}</title></circle><circle cx="${v.x}" cy="${v.y}" r="${v.drill / 2}" class="hole"/>`).join('');
  const silk = pcb.components.map((c) => c.silk.map((s) => s.type === 'line'
    ? `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}"/>`
    : `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="none"/>`).join('')).join('');
  const labels = pcb.components.map((c) => `<text x="${c.labelX}" y="${c.labelY}" text-anchor="middle">${esc(c.ref)}</text>`).join('');
  const rats = pcb.unrouted.map((u) => `<line x1="${u.x1}" y1="${u.y1}" x2="${u.x2}" y2="${u.y2}"><title>Unrouted: ${esc(u.net)} ${esc(u.from)} - ${esc(u.to)}</title></line>`).join('');
  const style = `<style>
    .board{fill:#0b3d1e;stroke:#e8d44d;stroke-width:0.15}
    .layer-bottom line{stroke:#3f7fe0;stroke-linecap:round;opacity:.85}
    .layer-top line{stroke:#d9483b;stroke-linecap:round;opacity:.9}
    .pad{fill:#d4a72c}.padb{fill:#3f7fe0}.via{fill:#c0c0c0}.hole{fill:#111}
    .layer-silk line,.layer-silk circle{stroke:#f2f2f2;stroke-width:0.12;fill:none}
    .layer-labels text{font:0.9px sans-serif;fill:#f2f2f2;font-weight:700}
    .layer-rats line{stroke:#ffe14d;stroke-width:0.12;stroke-dasharray:0.5 0.3}
  </style>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-m} ${-m} ${W + 2 * m} ${H + 2 * m}" width="${(W + 2 * m) * 12}" height="${(H + 2 * m) * 12}">${style}
<rect x="${-m}" y="${-m}" width="${W + 2 * m}" height="${H + 2 * m}" fill="#1a1a1a"/>
<rect x="0" y="0" width="${W}" height="${H}" rx="0.5" class="board"/>
<g class="layer-bottom">${bottom}${padsB}</g>
<g class="layer-top">${top}</g>
<g class="layer-pads">${padsF}</g>
<g class="layer-vias">${vias}${holes}</g>
<g class="layer-silk">${silk}</g>
<g class="layer-labels">${labels}</g>
<g class="layer-rats">${rats}</g>
<text x="0" y="${H + 2}" style="font:1.2px sans-serif;fill:#aaa">${W} x ${H} mm, ${pcb.stats.tracks} tracks, ${pcb.stats.vias} vias, ${pcb.stats.completion}% routed</text>
</svg>`;
}

/** Small SVG preview of a single library footprint. */
export function renderFootprintSvg(fp) {
  const b = fp.bbox;
  const m = 1;
  const w = b.maxX - b.minX + 2 * m, h = b.maxY - b.minY + 2 * m;
  const pads = fp.pads.map((p) => `<g><title>Pad ${esc(p.num)}</title>${padShape(p, 'pad')}${p.drill ? `<circle cx="${p.x}" cy="${p.y}" r="${p.drill / 2}" class="hole"/>` : ''}</g>`).join('');
  const nums = fp.pads.map((p) => `<text x="${p.x}" y="${p.y + Math.min(p.w, p.h) * 0.18}" text-anchor="middle" style="font-size:${f(Math.max(0.25, Math.min(p.w, p.h) * 0.5))}px">${esc(p.num)}</text>`).join('');
  const silk = fp.silk.map((s) => s.type === 'line' ? `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}"/>` : `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(b.minX - m)} ${f(b.minY - m)} ${f(w)} ${f(h)}"><style>.pad{fill:#d4a72c}.hole{fill:#111}line,circle.s{stroke:#eee;stroke-width:0.12}text{fill:#222;font-family:sans-serif;font-weight:700}</style>
<rect x="${f(b.minX - m)}" y="${f(b.minY - m)}" width="${f(w)}" height="${f(h)}" fill="#0b3d1e"/>
<rect x="${b.minX}" y="${b.minY}" width="${f(b.maxX - b.minX)}" height="${f(b.maxY - b.minY)}" fill="none" stroke="#e05bd0" stroke-width="0.05" stroke-dasharray="0.2 0.2"/>
<g fill="none" stroke="#eee" stroke-width="0.12">${silk}</g>${pads}${nums}</svg>`;
}
