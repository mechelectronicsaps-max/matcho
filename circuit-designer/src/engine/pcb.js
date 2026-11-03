// PCB layout engine:
//  1. placement  - greedy, connectivity driven, overlap free (0/90 deg rotations)
//  2. routing    - 2-layer A* maze router on a 0.25 mm grid with clearance halos,
//                  turn penalties, layer direction preference and vias
//  3. result     - pads, tracks, vias, silkscreen and the unrouted list
//
// Units: millimetres, origin top-left of the board, y down (KiCad convention).

import { isGroundNet, isPowerNet } from './design.js';

export const RULES = {
  grid: 0.25,
  clearance: 0.15,
  traceWidth: 0.25,
  powerTraceWidth: 0.5,
  viaDiameter: 0.6,
  viaDrill: 0.3,
  edgeClearance: 0.5,
  boardMargin: 2.0,
  placementGap: 1.0,
};

const r3 = (n) => Math.round(n * 1000) / 1000;

export function rotatePoint(x, y, rot) {
  const t = (rot * Math.PI) / 180;
  const c = Math.round(Math.cos(t) * 1e9) / 1e9, s = Math.round(Math.sin(t) * 1e9) / 1e9;
  return [x * c + y * s, -x * s + y * c];
}

function rotatedBBox(bb, rot) {
  const pts = [[bb.minX, bb.minY], [bb.maxX, bb.minY], [bb.maxX, bb.maxY], [bb.minX, bb.maxY]].map(([x, y]) => rotatePoint(x, y, rot));
  return { minX: Math.min(...pts.map((p) => p[0])), maxX: Math.max(...pts.map((p) => p[0])), minY: Math.min(...pts.map((p) => p[1])), maxY: Math.max(...pts.map((p) => p[1])) };
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

function place(design) {
  const gap = RULES.placementGap;
  const netOf = design.pinNet;
  const weight = (net) => (isGroundNet(net) || isPowerNet(net) ? 0.25 : 1);
  const comps = design.components.filter((c) => c.part !== 'MOUNTING_HOLE');
  const holes = design.components.filter((c) => c.part === 'MOUNTING_HOLE');
  const order = [...comps].sort((a, b) => b.fp.pads.length - a.fp.pads.length);
  const placed = [];

  const padNets = (c) => c.fp.pads.map((p) => ({ p, net: netOf[`${c.ref}.${p.num}`] })).filter((x) => x.net);
  const overlaps = (bb) => placed.some((o) => !(bb.maxX + gap <= o.x + o.bb.minX || bb.minX >= o.x + o.bb.maxX + gap || bb.maxY + gap <= o.y + o.bb.minY || bb.minY >= o.y + o.bb.maxY + gap));

  for (const c of order) {
    if (!placed.length) { placed.push({ c, x: 0, y: 0, rot: 0, bb: rotatedBBox(c.fp.bbox, 0) }); continue; }
    // targets: for each of my nets, centroid of already placed pads on that net
    const netPts = new Map();
    for (const o of placed) for (const { p, net } of padNets(o.c)) {
      const [px, py] = rotatePoint(p.x, p.y, o.rot);
      const e = netPts.get(net) ?? { x: 0, y: 0, n: 0 };
      e.x += o.x + px; e.y += o.y + py; e.n++;
      netPts.set(net, e);
    }
    const mine = padNets(c);
    let ext = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const o of placed) { ext.minX = Math.min(ext.minX, o.x + o.bb.minX); ext.minY = Math.min(ext.minY, o.y + o.bb.minY); ext.maxX = Math.max(ext.maxX, o.x + o.bb.maxX); ext.maxY = Math.max(ext.maxY, o.y + o.bb.maxY); }
    const span = Math.max(c.fp.bbox.maxX - c.fp.bbox.minX, c.fp.bbox.maxY - c.fp.bbox.minY) + 2 * gap + 1;
    let best = null;
    const step = 0.5;
    for (const rot of [0, 90, 180, 270]) {
      const bb = rotatedBBox(c.fp.bbox, rot);
      for (let x = ext.minX - span; x <= ext.maxX + span; x += step) {
        for (let y = ext.minY - span; y <= ext.maxY + span; y += step) {
          const wb = { minX: x + bb.minX, maxX: x + bb.maxX, minY: y + bb.minY, maxY: y + bb.maxY };
          if (overlaps(wb)) continue;
          let score = 0;
          for (const { p, net } of mine) {
            const t = netPts.get(net);
            if (!t) continue;
            const [px, py] = rotatePoint(p.x, p.y, rot);
            score += weight(net) * Math.hypot(x + px - t.x / t.n, y + py - t.y / t.n);
          }
          // keep the board compact and roughly square
          const nb = { minX: Math.min(ext.minX, wb.minX), maxX: Math.max(ext.maxX, wb.maxX), minY: Math.min(ext.minY, wb.minY), maxY: Math.max(ext.maxY, wb.maxY) };
          const w = nb.maxX - nb.minX, h = nb.maxY - nb.minY;
          score += 0.35 * (w + h) + 0.15 * Math.abs(w - h) + (rot % 180 ? 0.05 : 0) + (rot >= 180 ? 0.05 : 0);
          if (!best || score < best.score) best = { score, x, y, rot, bb };
        }
      }
    }
    placed.push({ c, x: best.x, y: best.y, rot: best.rot, bb: best.bb });
  }

  // board outline
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const o of placed) { minX = Math.min(minX, o.x + o.bb.minX); minY = Math.min(minY, o.y + o.bb.minY); maxX = Math.max(maxX, o.x + o.bb.maxX); maxY = Math.max(maxY, o.y + o.bb.maxY); }
  if (!placed.length) { minX = minY = 0; maxX = maxY = 10; }
  let m = RULES.boardMargin;
  if (holes.length) {
    const hs = Math.max(...holes.map((h) => h.fp.bbox.maxX - h.fp.bbox.minX));
    m += hs + gap;
  }
  const W = Math.ceil(maxX - minX + 2 * m), H = Math.ceil(maxY - minY + 2 * m);
  const ox = -minX + (W - (maxX - minX)) / 2, oy = -minY + (H - (maxY - minY)) / 2;
  for (const o of placed) { o.x = r3(o.x + ox); o.y = r3(o.y + oy); }
  const corners = [[1, 1], [W - 1, H - 1], [W - 1, 1], [1, H - 1]];
  holes.forEach((h, i) => {
    const s = (h.fp.bbox.maxX - h.fp.bbox.minX) / 2 + 0.6;
    const [cx, cy] = corners[i % 4];
    placed.push({ c: h, x: r3(cx < W / 2 ? s + 0.4 : W - s - 0.4), y: r3(cy < H / 2 ? s + 0.4 : H - s - 0.4), rot: 0, bb: h.fp.bbox });
  });
  return { placed, width: W, height: H };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

class Grid {
  constructor(w, h) {
    this.g = RULES.grid;
    this.W = Math.floor(w / this.g) + 1;
    this.H = Math.floor(h / this.g) + 1;
    this.N = this.W * this.H;
    this.owner = new Int32Array(2 * this.N).fill(-1); // -1 free, -2 blocked, >=0 net id
    this.core = new Uint8Array(2 * this.N);
    // keep traces away from the board edge
    const e = Math.ceil((RULES.edgeClearance + RULES.traceWidth / 2) / this.g);
    for (let L = 0; L < 2; L++) for (let y = 0; y < this.H; y++) for (let x = 0; x < this.W; x++) {
      if (x < e || y < e || x >= this.W - e || y >= this.H - e) this.owner[L * this.N + y * this.W + x] = -2;
    }
  }
  idx(L, x, y) { return L * this.N + y * this.W + x; }
  cellRange(a, b) { return [Math.max(0, Math.ceil(a / this.g - 1e-9)), Math.min(Math.floor(b / this.g + 1e-9), Infinity)]; }
  claim(i, net, isCore) {
    if (isCore) { this.owner[i] = net; this.core[i] = 1; return; }
    if (this.core[i]) return;
    const o = this.owner[i];
    if (o === -1) this.owner[i] = net;
    else if (o !== net) this.owner[i] = -2;
  }
  markRect(L, x1, y1, x2, y2, net, isCore) {
    const [i0, i1] = this.cellRange(x1, x2), [j0, j1] = this.cellRange(y1, y2);
    let n = 0;
    for (let j = j0; j <= Math.min(j1, this.H - 1); j++) for (let i = i0; i <= Math.min(i1, this.W - 1); i++) { this.claim(this.idx(L, i, j), net, isCore); n++; }
    return n;
  }
  markDisk(L, cx, cy, rad, net) {
    const rc = Math.ceil(rad / this.g);
    const x0 = cx, y0 = cy;
    for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) {
      if ((dx * dx + dy * dy) * this.g * this.g >= rad * rad - 1e-9) continue;
      const x = x0 + dx, y = y0 + dy;
      if (x < 0 || y < 0 || x >= this.W || y >= this.H) continue;
      this.claim(this.idx(L, x, y), net, false);
    }
  }
  free(L, x, y, net) {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return false;
    const o = this.owner[this.idx(L, x, y)];
    return o === -1 || o === net;
  }
  freeDisk(L, x, y, rc, net) {
    for (let dy = -rc; dy <= rc; dy++) for (let dx = -rc; dx <= rc; dx++) if (dx * dx + dy * dy <= rc * rc && !this.free(L, x + dx, y + dy, net)) return false;
    return true;
  }
}

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      let i = 0;
      const n = k.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

function routeAll(layout, design, netOrder) {
  const G = new Grid(layout.width, layout.height);
  const g = G.g;
  const netIds = new Map(design.nets.map((n, i) => [n.name, i]));
  let dummy = design.nets.length;
  const pads = [];
  for (const o of layout.placed) {
    for (const p of o.c.fp.pads) {
      const [px, py] = rotatePoint(p.x, p.y, o.rot);
      const swap = o.rot % 180 !== 0;
      const net = design.pinNet[`${o.c.ref}.${p.num}`];
      pads.push({
        ref: o.c.ref, num: p.num, net: net ?? null, id: net ? netIds.get(net) : dummy++,
        x: r3(o.x + px), y: r3(o.y + py), w: swap ? p.h : p.w, h: swap ? p.w : p.h, shape: p.shape, type: p.type, drill: p.drill,
        rot: o.rot, layers: p.type === 'thru' ? [0, 1] : [0], cells: [],
      });
    }
  }
  const halo = RULES.clearance + RULES.traceWidth / 2;
  const e = 1e-3;
  for (const p of pads) for (const L of p.layers) G.markRect(L, p.x - p.w / 2 - halo + e, p.y - p.h / 2 - halo + e, p.x + p.w / 2 + halo - e, p.y + p.h / 2 + halo - e, p.id, false);
  // keep-out areas (e.g. module antennas): no copper on either layer
  for (const o of layout.placed) for (const k of o.c.fp.keepouts ?? []) {
    const pts = [[k.x1, k.y1], [k.x2, k.y2]].map(([x, y]) => rotatePoint(x, y, o.rot));
    const xs = pts.map((q) => o.x + q[0]), ys = pts.map((q) => o.y + q[1]);
    for (const L of [0, 1]) G.markRect(L, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), -2, true);
  }
  for (const p of pads) for (const L of p.layers) {
    const n = G.markRect(L, p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2, p.id, true);
    const [i0, i1] = G.cellRange(p.x - p.w / 2, p.x + p.w / 2), [j0, j1] = G.cellRange(p.y - p.h / 2, p.y + p.h / 2);
    if (n === 0) { const i = Math.round(p.x / g), j = Math.round(p.y / g); G.claim(G.idx(L, i, j), p.id, true); p.cells.push(G.idx(L, i, j)); }
    else for (let j = j0; j <= Math.min(j1, G.H - 1); j++) for (let i = i0; i <= Math.min(i1, G.W - 1); i++) p.cells.push(G.idx(L, i, j));
  }

  const tracks = [], vias = [], unrouted = [];
  const S = 2 * G.N * 9;
  const cost = new Float32Array(S);
  const stamp = new Uint32Array(S);
  const prev = new Int32Array(S);
  let gen = 0;
  const viaR = Math.ceil((RULES.viaDiameter / 2 + RULES.clearance) / g);

  for (const netName of netOrder) {
    const net = design.nets.find((n) => n.name === netName);
    const id = netIds.get(netName);
    const npads = pads.filter((p) => p.id === id);
    if (npads.length < 2) continue;
    const power = isPowerNet(netName) || isGroundNet(netName);
    const wideW = power ? RULES.powerTraceWidth : RULES.traceWidth;
    const wideFat = Math.ceil((wideW - RULES.traceWidth) / 2 / g - 1e-9);

    // connect pads in nearest-neighbour order (Prim-like)
    const connected = [npads[0]];
    const tree = new Set(npads[0].cells);
    const todo = npads.slice(1);
    while (todo.length) {
      let bi = 0, bd = Infinity;
      todo.forEach((p, i) => { for (const q of connected) { const d = Math.hypot(p.x - q.x, p.y - q.y); if (d < bd) { bd = d; bi = i; } } });
      const src = todo.splice(bi, 1)[0];
      if (src.cells.some((c) => tree.has(c))) { connected.push(src); continue; }
      const target = connected.reduce((a, q) => (Math.hypot(src.x - q.x, src.y - q.y) < Math.hypot(src.x - a.x, src.y - a.y) ? q : a));
      const tx = target.x / g, ty = target.y / g;

      const search = (fat) => {
      gen++;
      const heap = new Heap();
      const h = (i, j) => { const dx = Math.abs(i - tx), dy = Math.abs(j - ty); return (Math.max(dx, dy) + 0.414 * Math.min(dx, dy)) * 0.9; };
      for (const c of src.cells) {
        const s = c * 9 + 8;
        stamp[s] = gen; cost[s] = 0; prev[s] = -1;
        const L = Math.floor(c / G.N), r = c % G.N;
        heap.push(h(r % G.W, Math.floor(r / G.W)), s);
      }
      let found = -1, expansions = 0;
      while (heap.size && expansions < 300000) {
        const s = heap.pop();
        expansions++;
        const c = Math.floor(s / 9), dir = s % 9;
        const L = Math.floor(c / G.N), r = c % G.N, x = r % G.W, y = Math.floor(r / G.W);
        const cs = cost[s];
        if (tree.has(c)) { found = s; break; }
        // planar moves
        for (let d = 0; d < 8; d++) {
          const [dx, dy] = DIRS[d];
          const nx = x + dx, ny = y + dy;
          if (!G.free(L, nx, ny, id)) continue;
          if (dx && dy && (!G.free(L, x + dx, y, id) || !G.free(L, x, y + dy, id))) continue;
          if (fat && !G.freeDisk(L, nx, ny, fat, id)) continue;
          let step = dx && dy ? 1.414 : 1;
          if (dir !== 8 && dir !== d) { const diff = Math.min((d - dir + 8) % 8, (dir - d + 8) % 8); step += diff === 1 ? 0.6 : diff === 2 ? 1.5 : 6; }
          if ((L === 0 && dy && !dx) || (L === 1 && dx && !dy)) step += 0.25; // top prefers horizontal, bottom vertical
          const ns = G.idx(L, nx, ny) * 9 + d;
          const nc = cs + step;
          if (stamp[ns] === gen && cost[ns] <= nc) continue;
          stamp[ns] = gen; cost[ns] = nc; prev[ns] = s;
          heap.push(nc + h(nx, ny), ns);
        }
        // via
        const OL = 1 - L;
        if (G.free(OL, x, y, id) && G.freeDisk(L, x, y, viaR, id) && G.freeDisk(OL, x, y, viaR, id)) {
          const ns = G.idx(OL, x, y) * 9 + 8;
          const nc = cs + 12;
          if (!(stamp[ns] === gen && cost[ns] <= nc)) { stamp[ns] = gen; cost[ns] = nc; prev[ns] = s; heap.push(nc + h(x, y), ns); }
        }
      }
      return found;
      };
      // try the full power width first, neck down to a normal trace if it cannot escape
      let fat = wideFat, tw = wideW;
      let found = search(fat);
      if (found < 0 && fat) { fat = 0; tw = RULES.traceWidth; found = search(0); }
      const trHalo = tw / 2 + RULES.clearance + RULES.traceWidth / 2;
      if (found < 0) { unrouted.push({ net: net.name, from: `${src.ref}.${src.num}`, to: `${target.ref}.${target.num}`, x1: src.x, y1: src.y, x2: target.x, y2: target.y }); continue; }

      // back-trace
      const path = [];
      for (let s = found; s >= 0; s = prev[s]) path.push(Math.floor(s / 9));
      path.reverse();
      const pts = path.map((c) => { const L = Math.floor(c / G.N), r = c % G.N; return { L, x: r % G.W, y: Math.floor(r / G.W), c }; });
      for (const p of pts) {
        tree.add(p.c);
        G.markDisk(p.L, p.x, p.y, trHalo, id);
        if (fat) for (let dy = -fat; dy <= fat; dy++) for (let dx = -fat; dx <= fat; dx++) { const i = G.idx(p.L, p.x + dx, p.y + dy); if (p.x + dx >= 0 && p.y + dy >= 0 && p.x + dx < G.W && p.y + dy < G.H) tree.add(i); }
      }
      // emit segments (merge collinear runs), vias on layer changes
      let runStart = pts[0];
      const layerName = (L) => (L === 0 ? 'F.Cu' : 'B.Cu');
      const emit = (a, b) => { if (a.x !== b.x || a.y !== b.y) tracks.push({ x1: r3(a.x * g), y1: r3(a.y * g), x2: r3(b.x * g), y2: r3(b.y * g), w: tw, layer: layerName(a.L), net: net.name }); };
      // stub from source pad centre
      tracks.push({ x1: src.x, y1: src.y, x2: r3(pts[0].x * g), y2: r3(pts[0].y * g), w: Math.min(tw, src.w, src.h), layer: layerName(pts[0].L), net: net.name });
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        if (a.L !== b.L) {
          emit(runStart, a);
          vias.push({ x: r3(a.x * g), y: r3(a.y * g), d: RULES.viaDiameter, drill: RULES.viaDrill, net: net.name });
          for (const L of [0, 1]) G.markDisk(L, a.x, a.y, RULES.viaDiameter / 2 + RULES.clearance + RULES.traceWidth / 2, id);
          tree.add(G.idx(0, a.x, a.y)); tree.add(G.idx(1, a.x, a.y));
          runStart = b;
          continue;
        }
        const next = pts[i + 1];
        const sameDir = next && next.L === b.L && next.x - b.x === b.x - a.x && next.y - b.y === b.y - a.y;
        if (!sameDir) { emit(runStart, b); runStart = b; }
      }
      // stub into the target pad centre if we ended inside it
      const end = pts[pts.length - 1];
      const endPad = pads.find((p) => p.id === id && p.cells.includes(end.c));
      if (endPad) tracks.push({ x1: r3(end.x * g), y1: r3(end.y * g), x2: endPad.x, y2: endPad.y, w: Math.min(tw, endPad.w, endPad.h), layer: layerName(end.L), net: net.name });
      connected.push(src);
    }
  }
  return { pads, tracks: tracks.filter((t) => t.x1 !== t.x2 || t.y1 !== t.y2), vias, unrouted };
}

function netOrders(design, layout) {
  const span = (n) => {
    const pts = n.nodes.map((nd) => layout.placed.find((o) => o.c.ref === nd.ref)).filter(Boolean);
    const xs = pts.map((o) => o.x), ys = pts.map((o) => o.y);
    return Math.max(...xs) - Math.min(...xs) + Math.max(...ys) - Math.min(...ys);
  };
  const nets = design.nets.filter((n) => n.nodes.length > 1);
  const sig = nets.filter((n) => !isGroundNet(n.name) && !isPowerNet(n.name)).sort((a, b) => span(a) - span(b)).map((n) => n.name);
  const pwr = nets.filter((n) => isPowerNet(n.name)).map((n) => n.name);
  const gnd = nets.filter((n) => isGroundNet(n.name)).map((n) => n.name);
  return [[...pwr, ...sig, ...gnd], [...sig, ...pwr, ...gnd], [...gnd, ...pwr, ...sig]];
}

export function generatePcb(design) {
  const t0 = Date.now();
  const layout = place(design);
  let best = null;
  const tried = [];
  for (let order of netOrders(design, layout)) {
    let res = routeAll(layout, design, order);
    // one rip-up pass: route the failed nets first
    if (res.unrouted.length) {
      const failed = [...new Set(res.unrouted.map((u) => u.net))];
      const retry = routeAll(layout, design, [...failed, ...order.filter((n) => !failed.includes(n))]);
      if (retry.unrouted.length < res.unrouted.length) res = retry;
    }
    tried.push(res.unrouted.length);
    if (!best || res.unrouted.length < best.unrouted.length || (res.unrouted.length === best.unrouted.length && res.vias.length < best.vias.length)) best = res;
    if (!best.unrouted.length) break;
  }

  const components = layout.placed.map((o) => {
    const silk = (o.c.fp.silk ?? []).map((s) => {
      if (s.type === 'line') { const [a, b] = rotatePoint(s.x1, s.y1, o.rot), [c, d] = rotatePoint(s.x2, s.y2, o.rot); return { type: 'line', x1: r3(o.x + a), y1: r3(o.y + b), x2: r3(o.x + c), y2: r3(o.y + d) }; }
      const [a, b] = rotatePoint(s.cx, s.cy, o.rot); return { type: 'circle', cx: r3(o.x + a), cy: r3(o.y + b), r: s.r };
    });
    const bb = rotatedBBox(o.c.fp.bbox, o.rot);
    return { ref: o.c.ref, value: o.c.value, footprint: o.c.fp.name, part: o.c.part, x: o.x, y: o.y, rot: o.rot, silk, labelX: r3(o.x), labelY: r3(o.y + bb.minY - 0.4) };
  });

  const totalConnections = design.nets.reduce((a, n) => a + Math.max(0, n.nodes.length - 1), 0);
  return {
    board: { width: layout.width, height: layout.height },
    rules: RULES,
    components,
    pads: best.pads.map(({ cells, id, ...p }) => p),
    tracks: best.tracks,
    vias: best.vias,
    unrouted: best.unrouted,
    stats: {
      width: layout.width, height: layout.height,
      tracks: best.tracks.length, vias: best.vias.length,
      trackLength: r3(best.tracks.reduce((a, t) => a + Math.hypot(t.x2 - t.x1, t.y2 - t.y1), 0)),
      unrouted: best.unrouted.length, connections: totalConnections,
      completion: totalConnections ? Math.round((1 - best.unrouted.length / totalConnections) * 1000) / 10 : 100,
      attempts: tried, ms: Date.now() - t0,
    },
  };
}
