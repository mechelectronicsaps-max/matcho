// Footprint library.
//
// Footprints are generated from parametric package families (chip resistors,
// SOIC, TSSOP, QFN, DIP, pin headers, ...) so the library covers thousands of
// standard land patterns without shipping a huge data file. Dimensions follow
// common IPC-7351 nominal values; always check a footprint against the part's
// datasheet before ordering boards.
//
// More footprints can be imported from the official KiCad libraries with
// `npm run import-kicad -- /path/to/kicad-footprints` (see kicadImport.js);
// imported ones are loaded from data/footprints.imported.json.
//
// Coordinates are millimetres, footprint origin at the centre, y pointing down
// (KiCad convention).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const r3 = (n) => Math.round(n * 1000) / 1000;
const pad2 = (n) => String(n).padStart(2, '0');

const smd = (num, x, y, w, h, shape = 'roundrect') => ({ num: String(num), type: 'smd', shape, x: r3(x), y: r3(y), w: r3(w), h: r3(h) });
const tht = (num, x, y, size, drill, shape = 'circle') => ({ num: String(num), type: 'thru', shape, x: r3(x), y: r3(y), w: r3(size), h: r3(size), drill: r3(drill) });
const line = (x1, y1, x2, y2) => ({ type: 'line', x1: r3(x1), y1: r3(y1), x2: r3(x2), y2: r3(y2) });
const rect = (w, h, cx = 0, cy = 0) => [
  line(cx - w / 2, cy - h / 2, cx + w / 2, cy - h / 2),
  line(cx + w / 2, cy - h / 2, cx + w / 2, cy + h / 2),
  line(cx + w / 2, cy + h / 2, cx - w / 2, cy + h / 2),
  line(cx - w / 2, cy + h / 2, cx - w / 2, cy - h / 2),
];
const circle = (cx, cy, rad) => ({ type: 'circle', cx: r3(cx), cy: r3(cy), r: r3(rad) });

function make(name, category, description, pads, silk = [], body = null) {
  const fp = { name, category, description, pads, silk };
  fp.bbox = computeBBox(fp, body);
  return fp;
}

/** Bounding box (courtyard) of pads + silk + optional body, with 0.25 mm margin. */
export function computeBBox(fp, body) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x, y) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
  for (const p of fp.pads) { add(p.x - p.w / 2, p.y - p.h / 2); add(p.x + p.w / 2, p.y + p.h / 2); }
  for (const s of fp.silk) {
    if (s.type === 'line') { add(s.x1, s.y1); add(s.x2, s.y2); }
    if (s.type === 'circle') { add(s.cx - s.r, s.cy - s.r); add(s.cx + s.r, s.cy + s.r); }
  }
  if (body) { add(-body.w / 2, -body.h / 2); add(body.w / 2, body.h / 2); }
  if (!isFinite(minX)) { minX = minY = -0.5; maxX = maxY = 0.5; }
  const m = 0.25;
  return { minX: r3(minX - m), minY: r3(minY - m), maxX: r3(maxX + m), maxY: r3(maxY + m) };
}

// ---------------------------------------------------------------------------
// Families
// ---------------------------------------------------------------------------

// Two-terminal chip sizes: [imperial, metric, padW, padH, padCentreX, bodyL, bodyW]
const CHIP_SIZES = [
  ['0201', '0603Metric', 0.46, 0.4, 0.32, 0.6, 0.3],
  ['0402', '1005Metric', 0.59, 0.64, 0.485, 1.0, 0.5],
  ['0603', '1608Metric', 0.9, 0.95, 0.775, 1.6, 0.8],
  ['0805', '2012Metric', 1.03, 1.4, 0.91, 2.0, 1.25],
  ['1206', '3216Metric', 1.13, 1.75, 1.46, 3.2, 1.6],
  ['1210', '3225Metric', 1.13, 2.65, 1.46, 3.2, 2.5],
  ['1812', '4532Metric', 1.3, 3.4, 2.1, 4.5, 3.2],
  ['2010', '5025Metric', 1.25, 2.65, 2.35, 5.0, 2.5],
  ['2512', '6332Metric', 1.5, 3.4, 2.95, 6.3, 3.2],
];

function chipFamily(prefix, label, out) {
  for (const [imp, , pw, ph, px, bl, bw] of CHIP_SIZES) {
    const silk = prefix === 'LED' || prefix === 'D'
      ? [line(-px - pw / 2 - 0.3, -ph / 2, -px - pw / 2 - 0.3, ph / 2), line(-px - pw / 2 - 0.3, -ph / 2 - 0.15, px, -ph / 2 - 0.15), line(-px - pw / 2 - 0.3, ph / 2 + 0.15, px, ph / 2 + 0.15)]
      : [line(-bl / 2 + 0.2, -bw / 2 - 0.15, bl / 2 - 0.2, -bw / 2 - 0.15), line(-bl / 2 + 0.2, bw / 2 + 0.15, bl / 2 - 0.2, bw / 2 + 0.15)];
    out.push(make(`${prefix}_${imp}`, 'Chip', `${label}, ${imp} (${bl}x${bw} mm) SMD chip`, [smd(1, -px, 0, pw, ph), smd(2, px, 0, pw, ph)], silk, { w: bl, h: bw }));
  }
}

function soic(name, n, pitch, rowX, padW, padH, bodyW, bodyH, desc, ep) {
  const half = n / 2;
  const pads = [];
  const y0 = -((half - 1) * pitch) / 2;
  for (let i = 0; i < half; i++) pads.push(smd(i + 1, -rowX, y0 + i * pitch, padW, padH));
  for (let i = 0; i < half; i++) pads.push(smd(half + i + 1, rowX, y0 + (half - 1 - i) * pitch, padW, padH));
  if (ep) pads.push(smd(n + 1, 0, 0, ep.w, ep.h, 'rect'));
  const silk = [...rect(bodyW, bodyH), circle(-bodyW / 2 + 0.6, -bodyH / 2 + 0.6, 0.25)];
  return make(name, 'IC', desc, pads, silk, { w: bodyW, h: bodyH });
}

function quad(name, n, pitch, span, padW, padH, body, desc, ep) {
  // n pins on 4 sides, pin 1 top of left side, counter-clockwise (standard)
  const side = n / 4;
  const pads = [];
  const o = -((side - 1) * pitch) / 2;
  const c = span / 2;
  for (let i = 0; i < side; i++) pads.push(smd(i + 1, -c, o + i * pitch, padW, padH)); // left, top->bottom
  for (let i = 0; i < side; i++) pads.push(smd(side + i + 1, o + i * pitch, c, padH, padW)); // bottom, left->right
  for (let i = 0; i < side; i++) pads.push(smd(2 * side + i + 1, c, -o - i * pitch, padW, padH)); // right, bottom->top
  for (let i = 0; i < side; i++) pads.push(smd(3 * side + i + 1, -o - i * pitch, -c, padH, padW)); // top, right->left
  if (ep) pads.push(smd(n + 1, 0, 0, ep, ep, 'rect'));
  const b = body / 2;
  const k = Math.min(0.6, body * 0.15);
  const silk = [line(-b, -b + k, -b, -b), line(-b, -b, -b + k, -b), line(b - k, -b, b, -b), line(b, -b, b, -b + k),
    line(b, b - k, b, b), line(b, b, b - k, b), line(-b + k, b, -b, b), line(-b, b, -b, b - k), circle(-c - padW / 2 - 0.3, o - 0.6, 0.2)];
  return make(name, 'IC', desc, pads, silk, { w: body, h: body });
}

function dip(n, rowSpacing) {
  const half = n / 2;
  const pads = [];
  const y0 = -((half - 1) * 2.54) / 2;
  for (let i = 0; i < half; i++) pads.push(tht(i + 1, -rowSpacing / 2, y0 + i * 2.54, 1.6, 0.8, i === 0 ? 'rect' : 'oval'));
  for (let i = 0; i < half; i++) pads.push(tht(half + i + 1, rowSpacing / 2, y0 + (half - 1 - i) * 2.54, 1.6, 0.8, 'oval'));
  const bw = rowSpacing - 1.3, bh = half * 2.54 + 0.2;
  const silk = [...rect(bw, bh), circle(0, -bh / 2, 0.6)];
  const mil = Math.round(rowSpacing / 0.0254);
  return make(`DIP-${n}_W${rowSpacing.toFixed(2)}mm`, 'IC', `${n}-pin DIP, ${mil} mil row spacing, through hole`, pads, silk);
}

function header(rows, n, pitch, name, desc, drill = 1.0, size = 1.7) {
  const pads = [];
  const y0 = -((n - 1) * pitch) / 2;
  const x0 = -((rows - 1) * pitch) / 2;
  let num = 1;
  for (let i = 0; i < n; i++) for (let r = 0; r < rows; r++) pads.push(tht(num++, x0 + r * pitch, y0 + i * pitch, size, drill, num === 2 ? 'rect' : 'oval'));
  const silk = rect(rows * pitch + 0.2, n * pitch + 0.2);
  return make(name, 'Connector', desc, pads, silk);
}

function twoPinTHT(name, category, desc, pitch, size, drill, silk) {
  return make(name, category, desc, [tht(1, -pitch / 2, 0, size, drill, 'rect'), tht(2, pitch / 2, 0, size, drill)], silk);
}

function buildLibrary() {
  const L = [];

  // --- Chip passives ---
  chipFamily('R', 'Resistor', L);
  chipFamily('C', 'Capacitor', L);
  chipFamily('L', 'Inductor', L);
  chipFamily('LED', 'LED', L);
  chipFamily('D', 'Diode', L);
  chipFamily('Fuse', 'Fuse', L);

  // --- Diode packages ---
  L.push(make('D_SOD-123', 'Diode', 'SOD-123 diode', [smd(1, -1.65, 0, 0.9, 1.2), smd(2, 1.65, 0, 0.9, 1.2)], [line(-2.3, -0.9, 1.5, -0.9), line(-2.3, 0.9, 1.5, 0.9), line(-2.3, -0.9, -2.3, 0.9)], { w: 3.7, h: 1.6 }));
  L.push(make('D_SOD-323', 'Diode', 'SOD-323 diode', [smd(1, -1.1, 0, 0.6, 0.45), smd(2, 1.1, 0, 0.6, 0.45)], [line(-1.6, -0.75, 1.0, -0.75), line(-1.6, 0.75, 1.0, 0.75), line(-1.6, -0.75, -1.6, 0.75)], { w: 2.5, h: 1.3 }));
  L.push(make('D_SMA', 'Diode', 'DO-214AC (SMA) diode', [smd(1, -2.0, 0, 2.5, 1.7), smd(2, 2.0, 0, 2.5, 1.7)], [line(-3.4, -1.6, 2.3, -1.6), line(-3.4, 1.6, 2.3, 1.6), line(-3.4, -1.6, -3.4, 1.6)], { w: 5.2, h: 2.8 }));
  L.push(make('D_SMB', 'Diode', 'DO-214AA (SMB) diode', [smd(1, -2.15, 0, 2.5, 2.3), smd(2, 2.15, 0, 2.5, 2.3)], [line(-3.6, -2.0, 2.5, -2.0), line(-3.6, 2.0, 2.5, 2.0), line(-3.6, -2.0, -3.6, 2.0)], { w: 5.4, h: 3.6 }));
  L.push(twoPinTHT('D_DO-41_P10.16mm_Horizontal', 'Diode', 'DO-41 axial diode (1N400x), 10.16 mm pitch', 10.16, 2.2, 1.1, [...rect(5.2, 2.7), line(-1.8, -1.35, -1.8, 1.35)]));
  L.push(twoPinTHT('D_DO-35_P7.62mm_Horizontal', 'Diode', 'DO-35 axial diode (1N4148), 7.62 mm pitch', 7.62, 1.6, 0.8, [...rect(4.0, 2.0), line(-1.3, -1.0, -1.3, 1.0)]));

  // --- THT passives ---
  for (const p of [7.62, 10.16, 15.24]) L.push(twoPinTHT(`R_Axial_P${p.toFixed(2)}mm_Horizontal`, 'Resistor', `Axial resistor (1/4 W), ${p} mm pitch`, p, 1.6, 0.8, rect(6.3, 2.5)));
  for (const p of [2.5, 5.0]) L.push(twoPinTHT(`C_Disc_P${p.toFixed(2)}mm`, 'Capacitor', `Ceramic disc/MLCC THT capacitor, ${p} mm pitch`, p, 1.6, 0.8, rect(p + 2.5, 2.6)));
  for (const [d, p] of [[4, 1.5], [5, 2.0], [6.3, 2.5], [8, 3.5], [10, 5.0], [12.5, 5.0]]) {
    L.push(make(`CP_Radial_D${d.toFixed(1)}mm_P${p.toFixed(2)}mm`, 'Capacitor', `Electrolytic capacitor, radial, D${d} mm, ${p} mm pitch`,
      [tht(1, -p / 2, 0, Math.min(1.8, p * 0.8 + 0.2), 0.8, 'rect'), tht(2, p / 2, 0, Math.min(1.8, p * 0.8 + 0.2), 0.8)],
      [circle(0, 0, d / 2), line(-d / 2 - 0.6, -0.5, -d / 2 - 0.6, 0.5), line(-d / 2 - 1.1, 0, -d / 2 - 0.1, 0)]));
  }
  for (const s of [3, 4, 5, 6, 8, 10]) L.push(make(`CP_Elec_${s}x${s}`, 'Capacitor', `SMD aluminium electrolytic capacitor ${s}x${s} mm`, [smd(1, -s / 2 + 0.4, 0, s * 0.45, s * 0.3), smd(2, s / 2 - 0.4, 0, s * 0.45, s * 0.3)], rect(s + 0.3, s + 0.3), { w: s, h: s }));
  for (const s of [3, 4, 5, 6, 8, 10, 12]) L.push(make(`L_Power_${s}x${s}mm`, 'Inductor', `Shielded SMD power inductor ${s}x${s} mm`, [smd(1, -s * 0.36, 0, s * 0.28, s * 0.8), smd(2, s * 0.36, 0, s * 0.28, s * 0.8)], rect(s, s), { w: s, h: s }));
  L.push(make('LED_D3.0mm', 'LED', '3 mm round LED, THT', [tht(1, -1.27, 0, 1.8, 0.9, 'rect'), tht(2, 1.27, 0, 1.8, 0.9)], [circle(0, 0, 1.9)]));
  L.push(make('LED_D5.0mm', 'LED', '5 mm round LED, THT', [tht(1, -1.27, 0, 1.8, 0.9, 'rect'), tht(2, 1.27, 0, 1.8, 0.9)], [circle(0, 0, 2.9)]));
  L.push(make('Fuse_Holder_5x20mm', 'Fuse', '5x20 mm fuse holder, THT', [tht(1, -11.25, 0, 3.0, 1.5), tht(2, 11.25, 0, 3.0, 1.5)], rect(26, 9)));

  // --- Crystals ---
  L.push(twoPinTHT('Crystal_HC49-US', 'Crystal', 'HC-49/US crystal, THT, 4.88 mm pitch', 4.88, 1.5, 0.8, rect(10.5, 4.4)));
  L.push(make('Crystal_SMD_5032-2Pin', 'Crystal', '5.0x3.2 mm 2-pad SMD crystal', [smd(1, -1.85, 0, 2.0, 2.4), smd(2, 1.85, 0, 2.0, 2.4)], rect(5.4, 3.6), { w: 5, h: 3.2 }));
  L.push(make('Crystal_SMD_3225-4Pin', 'Crystal', '3.2x2.5 mm 4-pad SMD crystal (1/3 = crystal, 2/4 = GND)', [smd(1, -1.1, 0.85, 1.4, 1.2), smd(2, 1.1, 0.85, 1.4, 1.2), smd(3, 1.1, -0.85, 1.4, 1.2), smd(4, -1.1, -0.85, 1.4, 1.2)], rect(3.6, 2.9), { w: 3.2, h: 2.5 }));

  // --- Transistor / regulator packages ---
  L.push(make('SOT-23', 'Transistor', 'SOT-23 3-pin', [smd(1, -0.95, 1.1, 0.6, 1.0), smd(2, 0.95, 1.1, 0.6, 1.0), smd(3, 0, -1.1, 0.6, 1.0)], rect(3.0, 1.4), { w: 2.9, h: 1.3 }));
  L.push(make('SOT-23-5', 'IC', 'SOT-23-5 (SC-74A)', [smd(1, -0.95, 1.1, 0.6, 1.0), smd(2, 0, 1.1, 0.6, 1.0), smd(3, 0.95, 1.1, 0.6, 1.0), smd(4, 0.95, -1.1, 0.6, 1.0), smd(5, -0.95, -1.1, 0.6, 1.0)], [...rect(3.0, 1.4), circle(-1.8, 1.4, 0.2)], { w: 2.9, h: 1.6 }));
  L.push(make('SOT-23-6', 'IC', 'SOT-23-6', [smd(1, -0.95, 1.1, 0.6, 1.0), smd(2, 0, 1.1, 0.6, 1.0), smd(3, 0.95, 1.1, 0.6, 1.0), smd(4, 0.95, -1.1, 0.6, 1.0), smd(5, 0, -1.1, 0.6, 1.0), smd(6, -0.95, -1.1, 0.6, 1.0)], [...rect(3.0, 1.4), circle(-1.8, 1.4, 0.2)], { w: 2.9, h: 1.6 }));
  L.push(make('SOT-223-3_TabPin2', 'IC', 'SOT-223 3 pins + tab (tab = pin 2/4)', [smd(1, -2.3, 3.15, 1.0, 1.8), smd(2, 0, 3.15, 1.0, 1.8), smd(3, 2.3, 3.15, 1.0, 1.8), smd(4, 0, -3.15, 3.4, 1.8, 'rect')], rect(6.7, 3.7), { w: 6.5, h: 3.5 }));
  L.push(make('TO-252-2', 'IC', 'TO-252 (DPAK)', [smd(1, -2.28, 4.2, 1.1, 2.2), smd(3, 2.28, 4.2, 1.1, 2.2), smd(2, 0, -2.0, 5.8, 6.0, 'rect')], rect(6.8, 6.4, 0, -1.2)));
  L.push(make('TO-92_Inline', 'Transistor', 'TO-92 inline, 1.27 mm pitch', [tht(1, -1.27, 0, 1.05, 0.75, 'rect'), tht(2, 0, 0, 1.05, 0.75), tht(3, 1.27, 0, 1.05, 0.75)], [line(-2.3, 1.2, 2.3, 1.2), { type: 'circle', cx: 0, cy: -0.6, r: 2.5 }]));
  L.push(make('TO-220-3_Vertical', 'IC', 'TO-220-3 vertical, 2.54 mm pitch', [tht(1, -2.54, 0, 1.9, 1.1, 'rect'), tht(2, 0, 0, 1.9, 1.1, 'oval'), tht(3, 2.54, 0, 1.9, 1.1, 'oval')], [...rect(10.4, 4.6, 0, -0.9), line(-5.2, -2.0, 5.2, -2.0)]));

  // --- SOIC / SSOP / TSSOP / MSOP ---
  for (const n of [8, 14, 16]) L.push(soic(`SOIC-${n}_3.9x${(n / 2 * 1.27 + 0.1).toFixed(1)}mm_P1.27mm`, n, 1.27, 2.7, 1.55, 0.6, 3.9, n / 2 * 1.27 + 0.1, `SOIC-${n} narrow (3.9 mm body), 1.27 mm pitch`));
  L.push(soic('SOIC-8-1EP_3.9x4.9mm_P1.27mm_EP2.41x3.3mm', 8, 1.27, 2.7, 1.55, 0.6, 3.9, 4.9, 'SOIC-8 with exposed pad (pin 9)', { w: 2.41, h: 3.3 }));
  for (const n of [16, 18, 20, 24, 28]) L.push(soic(`SOIC-${n}W_7.5x${(n / 2 * 1.27 + 0.1).toFixed(1)}mm_P1.27mm`, n, 1.27, 4.65, 2.0, 0.6, 7.5, n / 2 * 1.27 + 0.1, `SOIC-${n} wide (7.5 mm body), 1.27 mm pitch`));
  for (const n of [8, 10]) L.push(soic(`MSOP-${n}_3x3mm_P${n === 8 ? '0.65' : '0.5'}mm`, n, n === 8 ? 0.65 : 0.5, 2.2, 1.45, n === 8 ? 0.42 : 0.3, 3.0, 3.0, `MSOP-${n} 3x3 mm`));
  for (const n of [8, 14, 16, 20, 24, 28]) L.push(soic(`TSSOP-${n}_4.4x${(n / 2 * 0.65 + 0.4).toFixed(1)}mm_P0.65mm`, n, 0.65, 2.95, 1.5, 0.45, 4.4, n / 2 * 0.65 + 0.4, `TSSOP-${n} 4.4 mm body, 0.65 mm pitch`));
  for (const n of [16, 20, 24, 28]) L.push(soic(`SSOP-${n}_5.3x${(n / 2 * 0.65 + 0.9).toFixed(1)}mm_P0.65mm`, n, 0.65, 3.6, 1.75, 0.45, 5.3, n / 2 * 0.65 + 0.9, `SSOP-${n} 5.3 mm body, 0.65 mm pitch`));

  // --- QFN / QFP ---
  for (const [n, body, pitch, ep] of [[16, 3, 0.5, 1.7], [20, 4, 0.5, 2.6], [24, 4, 0.5, 2.6], [28, 5, 0.5, 3.1], [32, 5, 0.5, 3.1], [40, 6, 0.5, 4.1], [48, 7, 0.5, 5.1], [56, 7, 0.4, 5.1], [64, 9, 0.5, 7.1]]) {
    L.push(quad(`QFN-${n}-1EP_${body}x${body}mm_P${pitch}mm_EP${ep}x${ep}mm`, n, pitch, body + 0.1, 0.8, pitch * 0.55, body, `QFN-${n} ${body}x${body} mm, ${pitch} mm pitch, exposed pad`, ep));
  }
  for (const [n, body, pitch, kind] of [[32, 7, 0.8, 'TQFP'], [44, 10, 0.8, 'TQFP'], [48, 7, 0.5, 'LQFP'], [64, 10, 0.5, 'LQFP'], [100, 14, 0.5, 'LQFP'], [144, 20, 0.5, 'LQFP']]) {
    L.push(quad(`${kind}-${n}_${body}x${body}mm_P${pitch}mm`, n, pitch, body + 1.7, 1.5, pitch * 0.55, body, `${kind}-${n} ${body}x${body} mm, ${pitch} mm pitch`));
  }

  // --- DIP ---
  for (const n of [4, 6, 8, 14, 16, 18, 20, 22, 24, 28]) L.push(dip(n, 7.62));
  for (const n of [24, 28, 32, 40, 48]) L.push(dip(n, 15.24));

  // --- Connectors ---
  for (let n = 1; n <= 40; n++) L.push(header(1, n, 2.54, `PinHeader_1x${pad2(n)}_P2.54mm_Vertical`, `1x${n} pin header, 2.54 mm pitch`));
  for (let n = 2; n <= 40; n++) L.push(header(2, n, 2.54, `PinHeader_2x${pad2(n)}_P2.54mm_Vertical`, `2x${n} pin header, 2.54 mm pitch`));
  for (let n = 2; n <= 20; n++) L.push(header(1, n, 2.0, `PinHeader_1x${pad2(n)}_P2.00mm_Vertical`, `1x${n} pin header, 2.00 mm pitch`, 0.8, 1.35));
  for (let n = 2; n <= 12; n++) L.push(header(1, n, 2.5, `JST_XH_B${n}B-XH-A_1x${pad2(n)}_P2.50mm_Vertical`, `JST XH ${n}-pin, 2.50 mm pitch`, 0.95, 1.7));
  for (let n = 2; n <= 12; n++) L.push(header(1, n, 2.0, `JST_PH_B${n}B-PH-K_1x${pad2(n)}_P2.00mm_Vertical`, `JST PH ${n}-pin, 2.00 mm pitch`, 0.75, 1.2));
  for (let n = 2; n <= 12; n++) L.push(header(1, n, 5.08, `TerminalBlock_1x${pad2(n)}_P5.08mm`, `Screw terminal block ${n}-pin, 5.08 mm pitch`, 1.3, 2.6));
  for (let n = 2; n <= 12; n++) L.push(header(1, n, 3.5, `TerminalBlock_1x${pad2(n)}_P3.50mm`, `Screw terminal block ${n}-pin, 3.50 mm pitch`, 1.2, 2.2));

  // USB-C 16-pin receptacle (HRO TYPE-C-31-M-12 style). Stacked pads share a location.
  {
    const y = -4.05, w = 0.3, h = 1.15;
    const cols = [[-3.2, ['A1', 'B12'], 0.6], [-2.4, ['A4', 'B9'], 0.6], [-1.75, ['B8']], [-1.25, ['A5']], [-0.75, ['B7']], [-0.25, ['A6']], [0.25, ['A7']], [0.75, ['B6']], [1.25, ['A8']], [1.75, ['B5']], [2.4, ['B4', 'A9'], 0.6], [3.2, ['B1', 'A12'], 0.6]];
    const pads = [];
    for (const [x, nums, pw] of cols) for (const n of nums) pads.push(smd(n, x, y, pw ?? w, h, 'rect'));
    for (const [x, yy] of [[-4.32, -3.38], [4.32, -3.38], [-4.32, 0.8], [4.32, 0.8]]) pads.push({ ...tht('S1', x, yy, 1.0, 0.6, 'oval'), h: 1.8 });
    L.push(make('USB_C_Receptacle_16P', 'Connector', 'USB Type-C receptacle, 16 pins (USB 2.0), mid-mount', pads, rect(8.94, 7.3, 0, -0.6)));
  }
  L.push(make('USB_Micro-B', 'Connector', 'Micro USB B receptacle, SMD (1=VBUS 2=D- 3=D+ 4=ID 5=GND)',
    [...[1, 2, 3, 4, 5].map((n, i) => smd(n, -1.3 + i * 0.65, -2.7, 0.4, 1.35, 'rect')), { ...tht('6', -3.5, -2.45, 1.1, 0.6, 'oval') }, { ...tht('6', 3.5, -2.45, 1.1, 0.6, 'oval') }, smd('6', -1.1, 0, 1.9, 1.9, 'rect'), smd('6', 1.1, 0, 1.9, 1.9, 'rect')],
    rect(8.0, 5.0, 0, -0.5)));
  L.push(make('BarrelJack_5.5x2.1mm', 'Connector', 'DC barrel jack 5.5/2.1 mm, THT (1=centre, 2=sleeve, 3=switch)', [{ ...tht(1, 0, -6.0, 3.5, 1.0, 'rect'), h: 3.5 }, { ...tht(2, 0, 0, 3.5, 1.0) }, { ...tht(3, 4.7, -3.0, 3.0, 1.0) }], rect(9.0, 14.0, 0, -3.0)));

  // --- Switches, misc ---
  L.push(make('SW_PUSH_6mm', 'Switch', '6x6 mm tactile switch, THT (pads 1/1 and 2/2 internally bridged)', [tht(1, -3.25, -2.25, 2.0, 1.1), tht(2, 3.25, -2.25, 2.0, 1.1), tht(1, -3.25, 2.25, 2.0, 1.1), tht(2, 3.25, 2.25, 2.0, 1.1)], [...rect(6, 6), circle(0, 0, 1.75)]));
  L.push(make('SW_SPST_SMD_5.2x5.2mm', 'Switch', '5.2x5.2 mm SMD tactile switch', [smd(1, -3.1, -1.85, 1.6, 1.4), smd(2, 3.1, -1.85, 1.6, 1.4), smd(1, -3.1, 1.85, 1.6, 1.4), smd(2, 3.1, 1.85, 1.6, 1.4)], [...rect(5.2, 5.2), circle(0, 0, 1.4)]));
  L.push(make('Potentiometer_Bourns_3386P', 'Resistor', 'Bourns 3386P trimmer potentiometer, THT', [tht(1, -2.54, 0, 1.6, 0.9, 'rect'), tht(2, 0, -2.54, 1.6, 0.9), tht(3, 2.54, 0, 1.6, 0.9)], rect(9.5, 9.5, 0, -1.0)));
  L.push(make('Potentiometer_RV09_Vertical', 'Resistor', 'Alpha RV09 9 mm potentiometer, vertical', [tht(1, -2.5, 0, 1.8, 1.0, 'rect'), tht(2, 0, 0, 1.8, 1.0), tht(3, 2.5, 0, 1.8, 1.0), tht('MP', -4.4, -7.0, 3.0, 2.0), tht('MP', 4.4, -7.0, 3.0, 2.0)], rect(10, 11, 0, -6.0)));
  L.push(twoPinTHT('Buzzer_12x9.5mm_P7.6mm', 'Audio', '12 mm magnetic/piezo buzzer, THT', 7.6, 2.0, 1.0, [circle(0, 0, 6.0)]));
  L.push(make('Relay_SRD-05VDC', 'Relay', 'Songle SRD 5-pin relay, THT (1=COM 2/5=coil 3=NC 4=NO)', [tht(1, -6.05, 0, 2.5, 1.3, 'rect'), tht(2, -4.05, -6.0, 2.5, 1.3), tht(5, -4.05, 6.0, 2.5, 1.3), tht(3, 6.15, -6.0, 2.5, 1.3), tht(4, 6.15, 6.0, 2.5, 1.3)], rect(19.2, 15.6, 0.0, 0)));
  for (const d of [2.2, 3.2, 4.3]) L.push(make(`MountingHole_${d}mm_M${Math.round(d - 0.2)}`, 'Mechanical', `Mounting hole for M${Math.round(d - 0.2)} screw, plated`, [tht('1', 0, 0, d * 1.8, d)], [circle(0, 0, d * 1.1)]));
  L.push(make('TestPoint_Pad_D1.5mm', 'Mechanical', 'Test point, SMD round pad 1.5 mm', [smd(1, 0, 0, 1.5, 1.5, 'circle')], []));

  // --- Modules ---
  {
    // ESP32-WROOM-32: 18 x 25.5 mm, 38 castellated pads + GND pad 39
    const pads = [];
    const yTop = -9.5 + 1.0; // pads start ~ 9.5mm below antenna edge in body frame centered
    for (let i = 0; i < 14; i++) pads.push(smd(i + 1, -8.75, yTop + i * 1.27, 1.5, 0.9));
    for (let i = 0; i < 10; i++) pads.push(smd(15 + i, -5.715 + i * 1.27, 12.75, 0.9, 1.5));
    for (let i = 0; i < 14; i++) pads.push(smd(25 + i, 8.75, yTop + (13 - i) * 1.27, 1.5, 0.9));
    pads.push(smd(39, -1.0, 2.2, 5.0, 5.0, 'rect'));
    const esp = make('ESP32-WROOM-32', 'Module', 'Espressif ESP32-WROOM-32 module, 18x25.5 mm (antenna keep-out at top)', pads, [...rect(18, 25.5, 0, 0), line(-9, -6.75, 9, -6.75)], { w: 18, h: 25.5 });
    esp.keepouts = [{ x1: -9, y1: -12.75, x2: 9, y2: -6.75 }];
    L.push(esp);
  }
  L.push(header(2, 4, 2.54, 'Module_ESP-01_2x04_P2.54mm', 'ESP-01 (ESP8266) module socket, 2x4 header'));

  return L;
}

let LIB = null;
let INDEX = null;

export function loadFootprints() {
  if (LIB) return LIB;
  LIB = buildLibrary();
  const imported = path.join(here, '..', '..', 'data', 'footprints.imported.json');
  if (fs.existsSync(imported)) {
    try {
      const extra = JSON.parse(fs.readFileSync(imported, 'utf8'));
      const names = new Set(LIB.map((f) => f.name));
      for (const f of extra) if (!names.has(f.name)) { f.bbox ??= computeBBox(f); LIB.push(f); }
    } catch (e) {
      console.warn('Could not load imported footprints:', e.message);
    }
  }
  INDEX = new Map(LIB.map((f) => [f.name.toLowerCase(), f]));
  return LIB;
}

export function getFootprint(name) {
  loadFootprints();
  return INDEX.get(String(name).toLowerCase()) ?? null;
}

export function searchFootprints(q = '', category = '', limit = 200) {
  const lib = loadFootprints();
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (const f of lib) {
    if (category && f.category !== category) continue;
    const hay = `${f.name} ${f.description} ${f.category}`.toLowerCase();
    if (terms.every((t) => hay.includes(t))) out.push(f);
    if (out.length >= limit) break;
  }
  return out;
}

export function footprintCategories() {
  return [...new Set(loadFootprints().map((f) => f.category))].sort();
}
