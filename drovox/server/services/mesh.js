// 3D model reader for the 3D-printing services: STL (binary/ASCII), OBJ, 3MF and STEP/STP.
// Returns the part's volume, surface area and bounding box (used for the automatic price) plus a
// triangle list for the browser's 3D viewer. STEP is triangulated with OpenCascade (occt-import-js, WASM).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const MAX_BYTES = 60 * 1024 * 1024;
const MAX_TRIS = 4_000_000;
const VIEW_TRIS = 300_000;          // triangles sent to the viewer (larger models are thinned for display only)
export const MODEL_EXT = ['stl', 'step', 'stp', '3mf', 'obj'];

export class ModelError extends Error { constructor(m) { super(m); this.status = 400; } }

/** STL: binary when the size matches the triangle count, otherwise ASCII. */
function readStl(buf) {
  if (buf.length >= 84) {
    const n = buf.readUInt32LE(80);
    if (84 + n * 50 === buf.length) {
      if (n > MAX_TRIS) throw new ModelError('The model has too many triangles — please reduce the export resolution');
      const out = new Float32Array(n * 9);
      for (let i = 0; i < n; i++) { const o = 84 + i * 50 + 12; for (let k = 0; k < 9; k++) out[i * 9 + k] = buf.readFloatLE(o + k * 4); }
      return out;
    }
  }
  const text = buf.toString('latin1');
  const v = []; const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g; let m;
  while ((m = re.exec(text))) { v.push(+m[1], +m[2], +m[3]); if (v.length > MAX_TRIS * 9) throw new ModelError('The model has too many triangles'); }
  if (!v.length) throw new ModelError('The STL file has no triangles');
  return new Float32Array(v.length - (v.length % 9)).map((_, i) => v[i]);
}

function readObj(buf) {
  const verts = []; const out = [];
  for (const line of buf.toString('utf8').split(/\r?\n/)) {
    if (line.startsWith('v ')) { const p = line.trim().split(/\s+/); verts.push([+p[1], +p[2], +p[3]]); continue; }
    if (!line.startsWith('f ')) continue;
    const idx = line.trim().split(/\s+/).slice(1).map((t) => { const i = parseInt(t, 10); return i < 0 ? verts.length + i : i - 1; });
    for (let k = 1; k + 1 < idx.length; k++) for (const j of [idx[0], idx[k], idx[k + 1]]) { const p = verts[j]; if (!p) throw new ModelError('The OBJ file refers to a missing vertex'); out.push(p[0], p[1], p[2]); }
    if (out.length > MAX_TRIS * 9) throw new ModelError('The model has too many triangles');
  }
  if (!out.length) throw new ModelError('The OBJ file has no faces');
  return Float32Array.from(out);
}

/** 3MF: zip with 3D/*.model XML. Applies build-item and component transforms and the unit. */
function read3mf(buf) {
  const AdmZip = require('adm-zip');
  let zip; try { zip = new AdmZip(buf); } catch { throw new ModelError('The 3MF file could not be opened'); }
  const entries = zip.getEntries().filter((e) => /\.model$/i.test(e.entryName));
  if (!entries.length) throw new ModelError('The 3MF file has no 3D model inside');
  if (entries.reduce((s, e) => s + (e.header?.size || 0), 0) > 400 * 1024 * 1024) throw new ModelError('The 3MF file is too large when extracted');
  const xml = entries.map((e) => e.getData().toString('utf8')).join('\n');
  const unit = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 }[xml.match(/<model[^>]*\sunit="([^"]+)"/)?.[1] || 'millimeter'] || 1;
  const attr = (s, k) => s.match(new RegExp(`\\s${k}="([^"]*)"`))?.[1];
  const objects = {};
  for (const m of xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
    const id = attr(m[1], 'id'); const body = m[2];
    const vs = [...body.matchAll(/<vertex\b([^>]*)\/?>/g)].map((v) => [+attr(v[1], 'x'), +attr(v[1], 'y'), +attr(v[1], 'z')]);
    const ts = [...body.matchAll(/<triangle\b([^>]*)\/?>/g)].map((t) => [+attr(t[1], 'v1'), +attr(t[1], 'v2'), +attr(t[1], 'v3')]);
    const comps = [...body.matchAll(/<component\b([^>]*)\/?>/g)].map((c) => ({ id: attr(c[1], 'objectid'), tf: attr(c[1], 'transform') }));
    objects[id] = { vs, ts, comps };
  }
  const mat = (s) => { const a = (s || '1 0 0 0 1 0 0 0 1 0 0 0').trim().split(/\s+/).map(Number); return a.length === 12 ? a : [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]; };
  const mul = (a, b) => { // 3MF row-vector 4x3 matrices: p' = p·A, then ·B
    const r = []; for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { r[i * 3 + j] = (i < 3 ? 0 : b[9 + j]) + a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]; } return r;
  };
  const tp = (p, m) => [p[0] * m[0] + p[1] * m[3] + p[2] * m[6] + m[9], p[0] * m[1] + p[1] * m[4] + p[2] * m[7] + m[10], p[0] * m[2] + p[1] * m[5] + p[2] * m[8] + m[11]];
  const out = [];
  const emit = (id, m, depth = 0) => {
    const o = objects[id]; if (!o || depth > 8) return;
    for (const t of o.ts) { for (const k of t) { const p = tp(o.vs[k] || [0, 0, 0], m); out.push(p[0] * unit, p[1] * unit, p[2] * unit); } if (out.length > MAX_TRIS * 9) throw new ModelError('The model has too many triangles'); }
    for (const c of o.comps) emit(c.id, mul(mat(c.tf), m), depth + 1);
  };
  const items = [...xml.matchAll(/<item\b([^>]*)\/?>/g)].map((i) => ({ id: attr(i[1], 'objectid'), tf: attr(i[1], 'transform') }));
  (items.length ? items : Object.keys(objects).map((id) => ({ id }))).forEach((i) => emit(i.id, mat(i.tf)));
  if (!out.length) throw new ModelError('The 3MF file has no triangles');
  return Float32Array.from(out);
}

let occt = null;
async function readStep(buf) {
  occt ||= require('occt-import-js')();
  const lib = await occt;
  const r = lib.ReadStepFile(new Uint8Array(buf), { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.001, angularDeflection: 0.5 });
  if (!r?.success || !r.meshes?.length) throw new ModelError('The STEP file could not be read — export it again as STEP AP214/AP242, or upload an STL');
  const out = [];
  for (const m of r.meshes) {
    const p = m.attributes.position.array; const idx = m.index.array;
    for (let i = 0; i < idx.length; i++) { const j = idx[i] * 3; out.push(p[j], p[j + 1], p[j + 2]); }
    if (out.length > MAX_TRIS * 9) throw new ModelError('The model has too many triangles');
  }
  return Float32Array.from(out);
}

/** Volume (signed tetrahedra), surface area, bounding box and a closed-mesh check. */
export function measure(tri) {
  let vol = 0; let area = 0; const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
  const n = tri.length / 9;
  for (let i = 0; i < n; i++) {
    const o = i * 9;
    const ax = tri[o]; const ay = tri[o + 1]; const az = tri[o + 2]; const bx = tri[o + 3]; const by = tri[o + 4]; const bz = tri[o + 5]; const cx = tri[o + 6]; const cy = tri[o + 7]; const cz = tri[o + 8];
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    const ux = bx - ax; const uy = by - ay; const uz = bz - az; const vx = cx - ax; const vy = cy - ay; const vz = cz - az;
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    for (let k = 0; k < 9; k++) { const a = k % 3; const v = tri[o + k]; if (v < min[a]) min[a] = v; if (v > max[a]) max[a] = v; }
  }
  let closed = null;
  if (n <= 600_000) {   // every edge shared by exactly two triangles → watertight
    const key = (o) => `${Math.round(tri[o] * 1e4)},${Math.round(tri[o + 1] * 1e4)},${Math.round(tri[o + 2] * 1e4)}`;
    const edges = new Map();
    for (let i = 0; i < n; i++) {
      const k = [key(i * 9), key(i * 9 + 3), key(i * 9 + 6)];
      for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) { const e = k[a] < k[b] ? `${k[a]}|${k[b]}` : `${k[b]}|${k[a]}`; edges.set(e, (edges.get(e) || 0) + 1); }
    }
    closed = [...edges.values()].every((c) => c === 2);
  }
  const r2 = (x) => Math.round(x * 100) / 100;
  return { volume_cm3: r2(Math.abs(vol) / 1000), area_cm2: r2(area / 100), size_mm: [0, 1, 2].map((a) => r2(max[a] - min[a])), triangles: n, closed };
}

/** @param {Buffer} buf @param {string} name */
export async function analyzeModel(buf, name) {
  const ext = String(name || '').split('.').pop().toLowerCase();
  if (!MODEL_EXT.includes(ext)) throw new ModelError(`Upload an STL, STEP/STP, 3MF or OBJ file (got .${ext || '?'})`);
  if (!buf?.length) throw new ModelError('The model file is empty');
  if (buf.length > MAX_BYTES) throw new ModelError('The model file is larger than 60 MB');
  let tri;
  try {
    tri = ext === 'stl' ? readStl(buf) : ext === 'obj' ? readObj(buf) : ext === '3mf' ? read3mf(buf) : await readStep(buf);
  } catch (e) { if (e instanceof ModelError) throw e; throw new ModelError(`The ${ext.toUpperCase()} file could not be read — please export it again`); }
  if (!tri.length || tri.some((v) => !Number.isFinite(v))) throw new ModelError('The model has invalid coordinates');
  const m = measure(tri);
  if (!(m.volume_cm3 > 0)) throw new ModelError('The model has no volume — make sure it is a solid body, not a surface');
  const warnings = [];
  if (m.closed === false) warnings.push('The mesh is not watertight (it has holes or open edges). The volume may be off — our engineers will repair it before printing.');
  if (Math.max(...m.size_mm) < 2) warnings.push('The part is smaller than 2 mm. If it was designed in inches or metres, export it again in millimetres.');
  // display mesh: thin very large models for the browser only
  let view = tri;
  if (m.triangles > VIEW_TRIS) { const step = Math.ceil(m.triangles / VIEW_TRIS); const v = []; for (let i = 0; i < m.triangles; i += step) for (let k = 0; k < 9; k++) v.push(tri[i * 9 + k]); view = Float32Array.from(v); }
  return { ...m, format: ext, warnings, mesh: Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('base64'), mesh_reduced: view !== tri };
}
