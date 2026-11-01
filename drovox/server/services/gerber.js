// Gerber viewer & auto-detection for PCB orders: unzips a Gerber/drill ZIP, identifies the layers,
// renders top and bottom board images (SVG) and measures the board outline so the price can be
// calculated automatically. Runs on the server; the browser shows the SVGs as <img> (no script).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');
const pcbStackup = require('pcb-stackup');
const whatsThatGerber = require('whats-that-gerber');

const MAX_ZIP = 25 * 1024 * 1024;           // compressed
const MAX_TOTAL = 80 * 1024 * 1024;         // uncompressed (zip-bomb guard)
const MAX_FILES = 80;
const SKIP = /\.(pdf|png|jpe?g|txt|md|html?|csv|xlsx?|rpt|xln|zip|rar|7z|step|stp|pos|kicad_pcb|brd|sch|pcbdoc|schdoc)$/i;

export class GerberError extends Error { constructor(m) { super(m); this.status = 400; } }

/** @param {Buffer} buf ZIP file */
export async function analyzeGerberZip(buf) {
  if (!buf?.length) throw new GerberError('The Gerber file is empty');
  if (buf.length > MAX_ZIP) throw new GerberError('The Gerber ZIP is larger than 25 MB');
  let zip;
  try { zip = new AdmZip(buf); } catch { throw new GerberError('Upload the Gerber files as a .zip archive'); }
  const entries = zip.getEntries().filter((e) => !e.isDirectory && !e.entryName.split('/').pop().startsWith('.') && !e.entryName.includes('__MACOSX'));
  if (entries.length > MAX_FILES) throw new GerberError(`The ZIP has more than ${MAX_FILES} files — include only the Gerber and drill files`);
  const total = entries.reduce((s, e) => s + (e.header?.size || 0), 0);
  if (total > MAX_TOTAL) throw new GerberError('The ZIP is too large when extracted');
  const candidates = entries.filter((e) => !SKIP.test(e.entryName)).map((e) => ({ filename: e.entryName.split('/').pop(), path: e.entryName, entry: e }));
  const types = whatsThatGerber(candidates.map((c) => c.filename));
  const layers = candidates
    .filter((c) => types[c.filename]?.type)
    .map((c) => ({ filename: c.filename, type: types[c.filename].type, side: types[c.filename].side, gerber: c.entry.getData().toString('utf8') }));
  if (!layers.length) throw new GerberError('No Gerber layers were recognised in the ZIP. Export Gerber (RS-274X) and Excellon drill files from your PCB software and zip them together.');

  let stack;
  try {
    stack = await Promise.race([
      pcbStackup(layers.map((l) => ({ filename: l.filename, gerber: l.gerber, type: l.type, side: l.side }))),
      new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 20000)),
    ]);
  } catch (e) {
    throw new GerberError(e.message === 'timeout' ? 'The Gerber files took too long to render — please check them' : 'The Gerber files could not be read — please re-export them from your PCB software');
  }
  const toMm = (v, units) => (units === 'in' ? v * 25.4 : v);
  const w = toMm(stack.top.width, stack.top.units); const h = toMm(stack.top.height, stack.top.units);
  // CAD tools often export the outline as loose, unordered segments; the SVG clip then fills each piece
  // separately (the board shows as a triangle or not at all). Join the pieces into closed loops.
  const fixed = fixOutline(stack.top.svg, w);
  const topSvg = fixed.apply(stack.top.svg); const bottomSvg = fixed.apply(stack.bottom.svg);
  const copper = layers.filter((l) => l.type === 'copper');
  const inner = copper.filter((l) => l.side === 'inner').length;
  const outer = copper.filter((l) => l.side === 'top' || l.side === 'bottom').length;
  const copperCount = Math.max(1, inner + outer);
  const layerCount = copperCount <= 1 ? 1 : copperCount <= 2 ? 2 : copperCount <= 4 ? 4 : 6;
  const hasOutline = layers.some((l) => l.type === 'outline');
  const drills = layers.filter((l) => l.type === 'drill');
  const drillHits = drills.reduce((s, l) => s + (l.gerber.match(/^X-?[\d.]+Y-?[\d.]+/gm) || []).length, 0);
  const warnings = [];
  if (fixed.note) warnings.push(fixed.note);
  if (!hasOutline) warnings.push('No board outline (Edge Cuts / GKO / GM1) found — size was estimated from the copper and must be confirmed.');
  if (!drills.length) warnings.push('No drill file found — through-holes and vias will be missing.');
  if (copperCount === 3 || copperCount === 5 || copperCount > 6) warnings.push(`${copperCount} copper layers detected — boards are made in 1, 2, 4 or 6 layers, so ${layerCount} layers is assumed.`);
  return {
    width_mm: Math.round(w * 100) / 100, height_mm: Math.round(h * 100) / 100,
    layers: layerCount, copper_layers: copperCount, has_outline: hasOutline, drill_hits: drillHits,
    files: layers.map((l) => ({ name: l.filename, type: l.type, side: l.side })),
    ignored: candidates.filter((c) => !types[c.filename]?.type).map((c) => c.filename).concat(entries.filter((e) => SKIP.test(e.entryName)).map((e) => e.entryName.split('/').pop())),
    top_svg: topSvg, bottom_svg: bottomSvg, outline_mm: fixed.polygon, warnings,
  };
}

// ---- outline repair -------------------------------------------------------------------------
const num = (v) => Math.round(v * 1000) / 1000;

/** Split an SVG path into edges: {from, to, arc?: [rx, ry, rot, large, sweep]} */
export function pathEdges(d) {
  const tok = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const edges = []; let i = 0; let cmd = 'M'; let cur = null; let start = null;
  const n = () => Number(tok[i++]);
  while (i < tok.length) {
    if (/[a-zA-Z]/.test(tok[i])) { cmd = tok[i++]; if (cmd === 'Z' || cmd === 'z') { if (cur && start && (cur[0] !== start[0] || cur[1] !== start[1])) edges.push({ from: cur, to: start }); cur = start; continue; } }
    if (cmd === 'M') { cur = [n(), n()]; start = cur; cmd = 'L'; continue; }
    if (cmd === 'L') { const p = [n(), n()]; if (cur) edges.push({ from: cur, to: p }); cur = p; continue; }
    if (cmd === 'A') { const a = [n(), n(), n(), n(), n()]; const p = [n(), n()]; if (cur) edges.push({ from: cur, to: p, arc: a }); cur = p; continue; }
    i++;   // unsupported command: skip
  }
  return edges.filter((e) => e.from[0] !== e.to[0] || e.from[1] !== e.to[1] || e.arc);
}

/** Chain edges into loops when endpoints are within tol. */
export function chainLoops(edges, tol) {
  const left = edges.slice(); const loops = [];
  const near = (a, b) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
  const rev = (e) => ({ from: e.to, to: e.from, arc: e.arc && [e.arc[0], e.arc[1], e.arc[2], e.arc[3], e.arc[4] ? 0 : 1] });
  while (left.length) {
    const loop = [left.shift()];
    for (;;) {
      const end = loop[loop.length - 1].to;
      if (loop.length > 1 && near(end, loop[0].from)) { loops.push({ edges: loop, closed: true }); break; }
      const k = left.findIndex((e) => near(e.from, end) || near(e.to, end));
      if (k < 0) { loops.push({ edges: loop, closed: loop.length > 1 && near(end, loop[0].from) }); break; }
      const e = left.splice(k, 1)[0];
      loop.push(near(e.from, end) ? e : rev(e));
    }
  }
  return loops;
}

/** Sample an edge into points (arcs: SVG endpoint parameterisation, circular). */
function sample(e) {
  if (!e.arc) return [e.to];
  const [rx0, , , large, sweep] = e.arc; const [x1, y1] = e.from; const [x2, y2] = e.to;
  const dx = (x1 - x2) / 2; const dy = (y1 - y2) / 2; const d2 = dx * dx + dy * dy;
  if (!d2) {   // full circle
    return [e.to];
  }
  const r = Math.max(rx0, Math.sqrt(d2));
  let f = Math.sqrt(Math.max(0, (r * r - d2) / d2)); if (large === sweep) f = -f;
  const cx = (x1 + x2) / 2 + f * dy; const cy = (y1 + y2) / 2 - f * dx;
  let a1 = Math.atan2(y1 - cy, x1 - cx); let a2 = Math.atan2(y2 - cy, x2 - cx); let da = a2 - a1;
  if (sweep && da < 0) da += 2 * Math.PI; if (!sweep && da > 0) da -= 2 * Math.PI;
  const steps = Math.max(2, Math.ceil(Math.abs(da) / (Math.PI / 16)));
  const pts = []; for (let k = 1; k <= steps; k++) { const a = a1 + da * k / steps; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return pts;
}
const polyArea = (pts) => Math.abs(pts.reduce((s, p, k) => { const q = pts[(k + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

/** Returns {apply(svg), polygon (mm, y up, origin at board corner), note} */
export function fixOutline(svg, widthMm) {
  const vb = (svg.match(/viewBox="([^"]+)"/)?.[1] || '0 0 1 1').split(/\s+/).map(Number);
  const [vx, vy, vw, vh] = vb; const scale = widthMm / (vw || 1);
  const clip = svg.match(/<clipPath id="([^"]+_outline)">([\s\S]*?)<\/clipPath>/);
  const rect = [[0, 0], [num(vw * scale), 0], [num(vw * scale), num(vh * scale)], [0, num(vh * scale)]];
  if (!clip) return { apply: (x) => x, polygon: rect, note: '' };
  const suffix = clip[1].replace(/^.*?_(top|bottom)_outline$/, '_outline');
  const ds = [...clip[2].matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
  const others = clip[2].replace(/<path[^>]*\/>/g, '');   // keep circles/rects as they are
  const edges = ds.flatMap(pathEdges);
  const loops = chainLoops(edges, Math.max(vw, vh) * 0.002);
  const closed = loops.filter((l) => l.closed).map((l) => ({ ...l, pts: [l.edges[0].from, ...l.edges.flatMap(sample)] }));
  closed.forEach((l) => { l.area = polyArea(l.pts); });
  const biggest = closed.reduce((a, b) => (b.area > (a?.area || 0) ? b : a), null);
  const ok = biggest && biggest.area > vw * vh * 0.2;
  let inner; let note = '';
  if (ok) {
    inner = `<path d="${closed.map((l) => `M ${num(l.edges[0].from[0])} ${num(l.edges[0].from[1])} ${l.edges.map((e) => (e.arc ? `A ${e.arc.map(num).join(' ')} ` : 'L ') + `${num(e.to[0])} ${num(e.to[1])}`).join(' ')} Z`).join(' ')}"/>${others}`;
  } else if (!others.trim()) {
    inner = `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}"/>`;
    note = 'The board outline is not a closed shape — the preview shows the full rectangle. Please check the Edge Cuts / outline layer.';
  } else inner = clip[2];
  const polygon = ok ? biggest.pts.map(([x, y]) => [num((x - vx) * scale), num((y - vy) * scale)]) : rect;
  return {
    polygon, note,
    apply: (x) => x.replace(new RegExp(`(<clipPath id="[^"]+${suffix}">)[\\s\\S]*?(</clipPath>)`), (_, a, b) => a + inner + b),
  };
}
