// DXF reader for laser cutting: turns the drawing into outlines (mm), measures the overall size, the total
// cut length and the number of pierces (separate contours), and renders an SVG preview of the part.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DxfParser = require('dxf-parser');
const MAX_BYTES = 20 * 1024 * 1024;
const UNIT_MM = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 8: 0.0254, 9: 0.0254, 10: 914.4 };   // $INSUNITS

export class DxfError extends Error { constructor(m) { super(m); this.status = 400; } }

const TAU = Math.PI * 2;
function arcPts(cx, cy, r, a0, a1, ccw = true) {
  let da = ccw ? a1 - a0 : a0 - a1; while (da <= 0) da += TAU;
  const n = Math.max(8, Math.ceil(da / (Math.PI / 36)));
  const pts = []; for (let i = 0; i <= n; i++) { const a = a0 + (ccw ? 1 : -1) * da * i / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return pts;
}
/** Polyline vertices with bulges → points (bulge = tan(θ/4)). */
function bulgePts(vs, closed) {
  const out = [[vs[0].x, vs[0].y]];
  const n = closed ? vs.length : vs.length - 1;
  for (let i = 0; i < n; i++) {
    const a = vs[i]; const b = vs[(i + 1) % vs.length]; const bu = a.bulge || 0;
    if (!bu) { out.push([b.x, b.y]); continue; }
    const th = 4 * Math.atan(bu); const d = Math.hypot(b.x - a.x, b.y - a.y); if (!d) continue;
    const r = d / (2 * Math.sin(th / 2)); const mx = (a.x + b.x) / 2; const my = (a.y + b.y) / 2;
    const h = r * Math.cos(th / 2); const ux = -(b.y - a.y) / d; const uy = (b.x - a.x) / d;
    const cx = mx + ux * h; const cy = my + uy * h;
    const a0 = Math.atan2(a.y - cy, a.x - cx); const a1 = Math.atan2(b.y - cy, b.x - cx);
    out.push(...arcPts(cx, cy, Math.abs(r), a0, a1, bu > 0).slice(1));
  }
  return out;
}

function entityPaths(e, xf, ignored, blocks, depth = 0) {
  const T = (p) => xf([p[0], p[1]]);
  switch (e.type) {
    case 'LINE': return [{ pts: e.vertices.map((v) => T([v.x, v.y])), closed: false }];
    case 'LWPOLYLINE': case 'POLYLINE': {
      const vs = (e.vertices || []).filter((v) => Number.isFinite(v.x)); if (vs.length < 2) return [];
      const closed = !!(e.shape || e.closed);
      return [{ pts: bulgePts(vs, closed).map(T), closed }];
    }
    case 'CIRCLE': return [{ pts: arcPts(e.center.x, e.center.y, e.radius, 0, TAU).map(T), closed: true }];
    case 'ARC': return [{ pts: arcPts(e.center.x, e.center.y, e.radius, e.startAngle, e.endAngle).map(T), closed: false }];
    case 'ELLIPSE': {
      const mx = e.majorAxisEndPoint.x; const my = e.majorAxisEndPoint.y; const R = Math.hypot(mx, my); const rot = Math.atan2(my, mx);
      const r2 = R * e.axisRatio; let a0 = e.startAngle ?? 0; let a1 = e.endAngle ?? TAU; if (a1 <= a0) a1 += TAU;
      const n = Math.max(16, Math.ceil((a1 - a0) / (Math.PI / 36))); const pts = [];
      for (let i = 0; i <= n; i++) { const t = a0 + (a1 - a0) * i / n; const x = R * Math.cos(t); const y = r2 * Math.sin(t); pts.push(T([e.center.x + x * Math.cos(rot) - y * Math.sin(rot), e.center.y + x * Math.sin(rot) + y * Math.cos(rot)])); }
      return [{ pts, closed: Math.abs(a1 - a0 - TAU) < 1e-6 }];
    }
    case 'SPLINE': {
      const p = (e.fitPoints?.length ? e.fitPoints : e.controlPoints) || []; if (p.length < 2) return [];
      return [{ pts: p.map((v) => T([v.x, v.y])), closed: !!e.closed }];
    }
    case 'INSERT': {
      const b = blocks[e.name]; if (!b || depth > 4) return [];
      const sx = e.xScale ?? 1; const sy = e.yScale ?? 1; const rot = ((e.rotation || 0) * Math.PI) / 180; const bx = b.position?.x || 0; const by = b.position?.y || 0;
      const inner = (q) => { const x = (q[0] - bx) * sx; const y = (q[1] - by) * sy; return xf([e.position.x + x * Math.cos(rot) - y * Math.sin(rot), e.position.y + x * Math.sin(rot) + y * Math.cos(rot)]); };
      return (b.entities || []).flatMap((c) => entityPaths(c, inner, ignored, blocks, depth + 1));
    }
    case 'TEXT': case 'MTEXT': ignored.text = (ignored.text || 0) + 1; return [];
    case 'DIMENSION': case 'HATCH': case 'POINT': case 'SOLID': case 'VIEWPORT': ignored.other = (ignored.other || 0) + 1; return [];
    default: ignored.other = (ignored.other || 0) + 1; return [];
  }
}

/** Join open pieces whose ends touch into contours; each contour is one pierce. */
function chain(paths, tol) {
  const done = paths.filter((p) => p.closed); const open = paths.filter((p) => !p.closed).map((p) => p.pts);
  const near = (a, b) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
  while (open.length) {
    let cur = open.shift();
    for (let grew = true; grew;) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const o = open[i]; const s = cur[0]; const e = cur[cur.length - 1];
        if (near(e, o[0])) cur = cur.concat(o.slice(1)); else if (near(e, o[o.length - 1])) cur = cur.concat([...o].reverse().slice(1));
        else if (near(s, o[o.length - 1])) cur = o.concat(cur.slice(1)); else if (near(s, o[0])) cur = [...o].reverse().concat(cur.slice(1));
        else continue;
        open.splice(i, 1); grew = true; break;
      }
    }
    done.push({ pts: cur, closed: cur.length > 2 && near(cur[0], cur[cur.length - 1]) });
  }
  return done;
}
const plen = (pts, closed) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (closed && pts.length > 2) L += Math.hypot(pts[0][0] - pts.at(-1)[0], pts[0][1] - pts.at(-1)[1]); return L; };
const parea = (pts) => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;

/** @param {Buffer} buf @param {'mm'|'inch'} unit unit chosen by the customer */
export function analyzeDxf(buf, unit = 'mm') {
  if (!buf?.length) throw new DxfError('The DXF file is empty');
  if (buf.length > MAX_BYTES) throw new DxfError('The DXF file is larger than 20 MB');
  const text = buf.toString('latin1');
  if (/^AutoCAD Binary DXF/.test(text)) throw new DxfError('Binary DXF is not supported — save the drawing as ASCII DXF');
  let dxf; try { dxf = new DxfParser().parseSync(text); } catch { dxf = null; }
  if (!dxf?.entities) throw new DxfError('This file could not be read as a DXF drawing — export it again as DXF (R12 or 2000+)');
  const scale = unit === 'inch' ? 25.4 : 1;
  const ignored = {};
  const paths = dxf.entities.flatMap((e) => entityPaths(e, (p) => [p[0] * scale, p[1] * scale], ignored, dxf.blocks || {}));
  if (!paths.length) throw new DxfError('No cut lines were found. Make sure the outlines are lines, polylines, arcs or circles (convert text to outlines).');
  const contours = chain(paths, 0.05);
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const c of contours) for (const [x, y] of c.pts) { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; }
  const W = maxX - minX; const H = maxY - minY;
  if (!(W > 0 && H > 0)) throw new DxfError('The drawing has no size — check the file');
  const cut = contours.reduce((s, c) => s + plen(c.pts, c.closed), 0);
  const closed = contours.filter((c) => c.closed);
  const outer = closed.reduce((m, c) => Math.max(m, parea(c.pts)), 0);
  const holes = closed.reduce((s, c) => s + parea(c.pts), 0) - outer;
  const r2 = (v) => Math.round(v * 100) / 100;
  const warnings = [];
  const insunits = dxf.header?.$INSUNITS;
  if (UNIT_MM[insunits] && UNIT_MM[insunits] !== scale && (insunits === 1 || unit === 'inch')) warnings.push(`The file says its units are ${insunits === 1 ? 'inches' : 'millimetres'} — check the File Unit setting.`);
  if (Math.max(W, H) < 3) warnings.push('The part is smaller than 3 mm — is the file unit right?');
  const openN = contours.length - closed.length;
  if (openN) warnings.push(`${openN} open line${openN > 1 ? 's' : ''} found (not closed shapes). They will be cut as lines — close them if they are part outlines.`);
  if (ignored.text) warnings.push(`${ignored.text} text item${ignored.text > 1 ? 's were' : ' was'} ignored — convert text to outlines (explode) if it should be cut or engraved.`);
  // preview: closed contours filled even-odd (shows holes), open lines stroked
  const k = 1000 / Math.max(W, H); const f = (v) => Math.round(v * 100) / 100;
  const d = (c) => `M${c.pts.map(([x, y]) => `${f((x - minX) * k)} ${f((maxY - y) * k)}`).join('L')}${c.closed ? 'Z' : ''}`;
  const vw = f(W * k); const vh = f(H * k); const sw = f(Math.max(vw, vh) / 400);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-sw * 4} ${-sw * 4} ${vw + sw * 8} ${vh + sw * 8}"><path d="${closed.map(d).join('')}" fill="currentColor" fill-rule="evenodd" stroke="#1e1b4b" stroke-width="${sw}" fill-opacity="0.9"/>${openN ? `<path d="${contours.filter((c) => !c.closed).map(d).join('')}" fill="none" stroke="#dc2626" stroke-width="${sw * 1.5}"/>` : ''}</svg>`;
  return {
    width_mm: r2(W), height_mm: r2(H), cut_length_m: r2(cut / 1000), pierces: contours.length, contours: closed.length, open_paths: openN,
    part_area_cm2: r2(Math.max(0, outer - holes) / 100), unit, svg, warnings,
  };
}
