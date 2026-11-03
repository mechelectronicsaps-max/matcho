// Schematic generator: draws each component with a proper symbol and
// connects pins through net labels (the same convention KiCad/Altium use for
// "label-connected" schematics). Output is a standalone SVG string.

import { isGroundNet, isPowerNet } from './design.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const textW = (s, size = 11) => String(s).length * size * 0.6;

const pinByName = (comp, name) => comp.pins.find((p) => p.name.toUpperCase() === name);

function twoPinOrder(c) {
  const comp = c.comp;
  if (['diode', 'zener', 'schottky', 'led'].includes(comp.symbol)) return [pinByName(comp, 'A'), pinByName(comp, 'K')];
  return [comp.pins[0], comp.pins[1]];
}

// Each drawer returns { w, h, body, pins: [{ num, name, x, y, dx, dy }] } around (0,0).
const drawers = {
  resistor: () => ({ body: '<rect x="-20" y="-7" width="40" height="14" class="sym"/>' }),
  fuse: () => ({ body: '<rect x="-20" y="-7" width="40" height="14" class="sym"/><line x1="-20" y1="0" x2="20" y2="0" class="sym"/>' }),
  capacitor: () => ({ body: '<line x1="-20" y1="0" x2="-4" y2="0" class="sym"/><line x1="4" y1="0" x2="20" y2="0" class="sym"/><line x1="-4" y1="-12" x2="-4" y2="12" class="sym thick"/><line x1="4" y1="-12" x2="4" y2="12" class="sym thick"/>' }),
  capacitor_pol: () => ({ body: '<line x1="-20" y1="0" x2="-4" y2="0" class="sym"/><line x1="4" y1="0" x2="20" y2="0" class="sym"/><line x1="-4" y1="-12" x2="-4" y2="12" class="sym thick"/><path d="M8,-12 Q2,0 8,12" class="sym thick"/><text x="-14" y="-8" class="pinname">+</text>' }),
  inductor: () => ({ body: '<path d="M-20,0 a5,5 0 0 1 10,0 a5,5 0 0 1 10,0 a5,5 0 0 1 10,0 a5,5 0 0 1 10,0" class="sym"/>' }),
  diode: () => ({ body: '<line x1="-20" y1="0" x2="20" y2="0" class="sym"/><path d="M-8,-9 L8,0 L-8,9 Z" class="sym fill"/><line x1="8" y1="-9" x2="8" y2="9" class="sym thick"/>' }),
  schottky: () => ({ body: '<line x1="-20" y1="0" x2="20" y2="0" class="sym"/><path d="M-8,-9 L8,0 L-8,9 Z" class="sym fill"/><path d="M4,-11 L4,-9 L8,-9 L8,9 L12,9 L12,11" class="sym thick"/>' }),
  zener: () => ({ body: '<line x1="-20" y1="0" x2="20" y2="0" class="sym"/><path d="M-8,-9 L8,0 L-8,9 Z" class="sym fill"/><path d="M4,-11 L8,-9 L8,9 L12,11" class="sym thick"/>' }),
  led: () => ({ body: '<line x1="-20" y1="0" x2="20" y2="0" class="sym"/><path d="M-8,-9 L8,0 L-8,9 Z" class="sym fill"/><line x1="8" y1="-9" x2="8" y2="9" class="sym thick"/><path d="M0,-12 l7,-8 m-4,0 l4,0 l0,4 M6,-10 l7,-8 m-4,0 l4,0 l0,4" class="sym"/>' }),
  crystal: () => ({ body: '<line x1="-20" y1="0" x2="-9" y2="0" class="sym"/><line x1="9" y1="0" x2="20" y2="0" class="sym"/><line x1="-9" y1="-10" x2="-9" y2="10" class="sym thick"/><line x1="9" y1="-10" x2="9" y2="10" class="sym thick"/><rect x="-5" y="-12" width="10" height="24" class="sym"/>' }),
  switch: () => ({ body: '<line x1="-20" y1="0" x2="-10" y2="0" class="sym"/><line x1="10" y1="0" x2="20" y2="0" class="sym"/><circle cx="-10" cy="0" r="2" class="sym"/><circle cx="10" cy="0" r="2" class="sym"/><line x1="-12" y1="-8" x2="12" y2="-8" class="sym"/><line x1="0" y1="-8" x2="0" y2="-16" class="sym"/>' }),
  buzzer: () => ({ body: '<line x1="-20" y1="0" x2="-8" y2="0" class="sym"/><line x1="8" y1="0" x2="20" y2="0" class="sym"/><path d="M-12,-4 A12,12 0 0 1 12,-4 Z" class="sym" transform="translate(0,6)"/><text x="-16" y="-6" class="pinname">+</text>' }),
};

function drawTwoPin(c) {
  const d = drawers[c.comp.symbol]();
  const [a, b] = twoPinOrder(c);
  return { w: 60, h: 30, body: d.body, pins: [{ ...a, x: -30, y: 0, dx: -1, dy: 0 }, { ...b, x: 30, y: 0, dx: 1, dy: 0 }],
    leads: '<line x1="-30" y1="0" x2="-20" y2="0" class="sym"/><line x1="20" y1="0" x2="30" y2="0" class="sym"/>' };
}

function drawTransistor(c) {
  const s = c.comp.symbol;
  const P = (n) => pinByName(c.comp, n);
  let body = '<circle cx="2" cy="0" r="16" class="sym"/>';
  let pins;
  if (s === 'npn' || s === 'pnp') {
    body += '<line x1="-30" y1="0" x2="-6" y2="0" class="sym"/><line x1="-6" y1="-10" x2="-6" y2="10" class="sym thick"/><line x1="-6" y1="-5" x2="10" y2="-14" class="sym"/><line x1="-6" y1="5" x2="10" y2="14" class="sym"/><line x1="10" y1="-14" x2="10" y2="-30" class="sym"/><line x1="10" y1="14" x2="10" y2="30" class="sym"/>';
    body += s === 'npn' ? '<path d="M10,14 l-7,-1 l3,-5 z" class="sym fill"/>' : '<path d="M-5,-6 l7,-1 l-3,-5 z" class="sym fill"/>';
    pins = s === 'npn'
      ? [{ ...P('B'), x: -30, y: 0, dx: -1, dy: 0 }, { ...P('C'), x: 10, y: -30, dx: 0, dy: -1 }, { ...P('E'), x: 10, y: 30, dx: 0, dy: 1 }]
      : [{ ...P('B'), x: -30, y: 0, dx: -1, dy: 0 }, { ...P('E'), x: 10, y: -30, dx: 0, dy: -1 }, { ...P('C'), x: 10, y: 30, dx: 0, dy: 1 }];
  } else {
    body += '<line x1="-30" y1="8" x2="-9" y2="8" class="sym"/><line x1="-9" y1="-10" x2="-9" y2="8" class="sym thick"/><line x1="-4" y1="-12" x2="-4" y2="12" class="sym thick"/><line x1="-4" y1="-9" x2="10" y2="-9" class="sym"/><line x1="-4" y1="9" x2="10" y2="9" class="sym"/><line x1="10" y1="-9" x2="10" y2="-30" class="sym"/><line x1="10" y1="9" x2="10" y2="30" class="sym"/>';
    body += s === 'nmos' ? '<path d="M-4,9 l6,-3 l0,6 z" class="sym fill"/>' : '<path d="M10,-9 l-6,-3 l0,6 z" class="sym fill"/>';
    pins = s === 'nmos'
      ? [{ ...P('G'), x: -30, y: 8, dx: -1, dy: 0 }, { ...P('D'), x: 10, y: -30, dx: 0, dy: -1 }, { ...P('S'), x: 10, y: 30, dx: 0, dy: 1 }]
      : [{ ...P('G'), x: -30, y: 8, dx: -1, dy: 0 }, { ...P('S'), x: 10, y: -30, dx: 0, dy: -1 }, { ...P('D'), x: 10, y: 30, dx: 0, dy: 1 }];
  }
  return { w: 60, h: 60, body, pins, leads: '' };
}

function drawPot(c) {
  const [p1, w, p3] = c.comp.pins;
  return { w: 60, h: 50, body: '<rect x="-20" y="-7" width="40" height="14" class="sym"/><line x1="-30" y1="0" x2="-20" y2="0" class="sym"/><line x1="20" y1="0" x2="30" y2="0" class="sym"/><line x1="0" y1="-30" x2="0" y2="-9" class="sym"/><path d="M0,-8 l-4,-7 l8,0 z" class="sym fill"/>',
    pins: [{ ...p1, x: -30, y: 0, dx: -1, dy: 0 }, { ...w, x: 0, y: -30, dx: 0, dy: -1 }, { ...p3, x: 30, y: 0, dx: 1, dy: 0 }], leads: '' };
}

function drawBox(c, connector = false) {
  const pins = c.comp.pins;
  let left = pins.filter((p) => connector || p.side !== 'right');
  let right = connector ? [] : pins.filter((p) => p.side === 'right');
  if (!connector && !pins.some((p) => p.side)) { const h = Math.ceil(pins.length / 2); left = pins.slice(0, h); right = pins.slice(h); }
  const rows = Math.max(left.length, right.length, 1);
  const nameW = (arr) => Math.max(0, ...arr.map((p) => textW(p.name, 10)));
  const w = connector ? 30 : Math.max(80, Math.ceil((nameW(left) + nameW(right) + 30) / 10) * 10);
  const h = rows * 20 + 20;
  const top = -h / 2;
  let body = `<rect x="${-w / 2}" y="${top}" width="${w}" height="${h}" class="sym box"/>`;
  const out = [];
  left.forEach((p, i) => {
    const y = top + 20 + i * 20;
    body += `<line x1="${-w / 2 - 20}" y1="${y}" x2="${-w / 2}" y2="${y}" class="sym"/>`;
    if (!connector) body += `<text x="${-w / 2 + 4}" y="${y + 3.5}" class="pinname">${esc(p.name)}</text>`;
    body += `<text x="${-w / 2 - 4}" y="${y - 3}" class="pinnum" text-anchor="end">${esc(p.num)}</text>`;
    out.push({ ...p, x: -w / 2 - 20, y, dx: -1, dy: 0 });
  });
  right.forEach((p, i) => {
    const y = top + 20 + i * 20;
    body += `<line x1="${w / 2}" y1="${y}" x2="${w / 2 + 20}" y2="${y}" class="sym"/>`;
    body += `<text x="${w / 2 - 4}" y="${y + 3.5}" class="pinname" text-anchor="end">${esc(p.name)}</text>`;
    body += `<text x="${w / 2 + 4}" y="${y - 3}" class="pinnum">${esc(p.num)}</text>`;
    out.push({ ...p, x: w / 2 + 20, y, dx: 1, dy: 0 });
  });
  return { w: w + 40, h, body, pins: out, leads: '' };
}

function symbolFor(c) {
  const s = c.comp.symbol;
  if (drawers[s]) return drawTwoPin(c);
  if (['npn', 'pnp', 'nmos', 'pmos'].includes(s)) return drawTransistor(c);
  if (s === 'pot') return drawPot(c);
  return drawBox(c, s === 'connector');
}

function labelSvg(net, x, y, dx, dy) {
  // stub wire then the label glyph
  const sx = x + dx * 12, sy = y + dy * 12;
  let s = `<line x1="${x}" y1="${y}" x2="${sx}" y2="${sy}" class="wire"/><circle cx="${x}" cy="${y}" r="1.6" class="dot"/>`;
  if (isGroundNet(net)) {
    // ground symbol, always drawn pointing down from the stub end
    s += `<line x1="${sx}" y1="${sy}" x2="${sx}" y2="${sy + 8}" class="wire"/><path d="M${sx - 8},${sy + 8} h16 M${sx - 5},${sy + 11} h10 M${sx - 2},${sy + 14} h4" class="gnd"/>`;
    return s;
  }
  const power = isPowerNet(net);
  const tw = textW(net, 10) + 10;
  const cls = power ? 'lbl power' : 'lbl';
  if (dy !== 0) {
    const ty = dy < 0 ? sy - 14 : sy;
    s += `<rect x="${sx - tw / 2}" y="${ty}" width="${tw}" height="14" rx="${power ? 0 : 7}" class="${cls}"/><text x="${sx}" y="${ty + 10.5}" text-anchor="middle" class="lbltext">${esc(net)}</text>`;
  } else {
    const lx = dx < 0 ? sx - tw : sx;
    const shape = power
      ? `<path d="M${dx < 0 ? sx : lx},${sy} l${dx < 0 ? -6 : 6},-7 h${(tw - 6) * (dx < 0 ? -1 : 1)} v14 h${-(tw - 6) * (dx < 0 ? -1 : 1)} z" class="${cls}"/>`
      : `<rect x="${lx}" y="${sy - 7}" width="${tw}" height="14" rx="7" class="${cls}"/>`;
    s += `${shape}<text x="${lx + tw / 2 + (power ? (dx < 0 ? -3 : 3) : 0)}" y="${sy + 3.5}" text-anchor="middle" class="lbltext">${esc(net)}</text>`;
  }
  return s;
}

function orderByConnectivity(design) {
  const big = (c) => c.comp.pins.length;
  const adj = new Map(design.components.map((c) => [c.ref, new Set()]));
  for (const n of design.nets) {
    if (isGroundNet(n.name) || isPowerNet(n.name)) continue;
    for (const a of n.nodes) for (const b of n.nodes) if (a.ref !== b.ref) adj.get(a.ref).add(b.ref);
  }
  const byRef = new Map(design.components.map((c) => [c.ref, c]));
  const remaining = [...design.components].sort((a, b) => big(b) - big(a) || a.ref.localeCompare(b.ref, undefined, { numeric: true }));
  const seen = new Set();
  const out = [];
  for (const start of remaining) {
    if (seen.has(start.ref)) continue;
    const q = [start.ref];
    seen.add(start.ref);
    while (q.length) {
      const r = q.shift();
      out.push(byRef.get(r));
      const next = [...adj.get(r)].filter((x) => !seen.has(x)).sort((a, b) => big(byRef.get(b)) - big(byRef.get(a)));
      for (const x of next) { seen.add(x); q.push(x); }
    }
  }
  return out;
}

export function renderSchematic(design) {
  const maxRowW = 1200;
  const items = orderByConnectivity(design).map((c) => {
    const sym = symbolFor(c);
    const labelRoom = (side) => {
      const ps = sym.pins.filter((p) => (side === 'l' ? p.dx < 0 : side === 'r' ? p.dx > 0 : side === 't' ? p.dy < 0 : p.dy > 0));
      return Math.max(0, ...ps.map((p) => {
        const net = design.pinNet[`${c.ref}.${p.num}`];
        return net ? (side === 'l' || side === 'r' ? textW(net, 10) + 30 : 30) : 8;
      }));
    };
    const L = labelRoom('l'), R = labelRoom('r'), T = Math.max(labelRoom('t'), 26), B = Math.max(labelRoom('b'), 16);
    return { c, sym, L, R, T, B, cw: L + sym.w + R + 30, ch: T + sym.h + B + 30 };
  });

  // shelf packing
  let x = 20, y = 20, rowH = 0, width = 0;
  for (const it of items) {
    if (x + it.cw > maxRowW && x > 20) { x = 20; y += rowH; rowH = 0; }
    it.ox = x + it.L + it.sym.w / 2;
    it.oy = y + it.T + it.sym.h / 2;
    x += it.cw;
    rowH = Math.max(rowH, it.ch);
    width = Math.max(width, x);
  }
  const height = y + rowH + 60;
  width = Math.max(width, 400) + 20;

  let g = '';
  for (const it of items) {
    const { c, sym } = it;
    g += `<g transform="translate(${it.ox},${it.oy})" data-ref="${esc(c.ref)}">`;
    g += sym.leads + sym.body;
    g += `<text x="0" y="${-sym.h / 2 - 16}" text-anchor="middle" class="ref">${esc(c.ref)}</text>`;
    g += `<text x="0" y="${-sym.h / 2 - 4}" text-anchor="middle" class="val">${esc(c.value)}</text>`;
    for (const p of sym.pins) {
      const net = design.pinNet[`${c.ref}.${p.num}`];
      if (net) g += labelSvg(net, p.x, p.y, p.dx, p.dy);
      else if (design.noConnect.includes(`${c.ref}.${p.num}`) || p.type === 'nc') g += `<path d="M${p.x - 4},${p.y - 4} l8,8 m0,-8 l-8,8" class="nc"/>`;
    }
    g += '</g>';
  }

  const title = `<text x="20" y="${height - 22}" class="title">${esc(design.title)}</text><text x="20" y="${height - 8}" class="val">${design.components.length} components, ${design.nets.length} nets. Pins with the same label are connected.</text>`;
  const style = `<style>
    .sym{fill:none;stroke:#8b1a1a;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
    .sym.thick{stroke-width:2.6}.sym.fill{fill:#8b1a1a}.sym.box{fill:#fffbe6}
    .wire{stroke:#1b7a1b;stroke-width:1.4}.dot{fill:#1b7a1b}.gnd{stroke:#1b7a1b;stroke-width:1.6;fill:none}
    .nc{stroke:#1a3d8b;stroke-width:1.5}
    .lbl{fill:#eef4ff;stroke:#1a3d8b;stroke-width:1}.lbl.power{fill:#fff0f0;stroke:#b31b1b}
    .lbltext{font:600 10px ui-monospace,Menlo,Consolas,monospace;fill:#1a1a1a}
    .pinname{font:10px ui-monospace,Menlo,Consolas,monospace;fill:#3a3a3a}
    .pinnum{font:9px ui-monospace,Menlo,Consolas,monospace;fill:#8b1a1a}
    .ref{font:700 12px system-ui,sans-serif;fill:#0d3b66}.val{font:11px system-ui,sans-serif;fill:#444}
    .title{font:700 15px system-ui,sans-serif;fill:#222}
  </style>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${style}<rect width="100%" height="100%" fill="#ffffff"/><rect x="5" y="5" width="${width - 10}" height="${height - 10}" fill="none" stroke="#999" stroke-width="1"/>${g}${title}</svg>`;
}
