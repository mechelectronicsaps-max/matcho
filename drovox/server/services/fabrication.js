// Fabrication services (like robu.in services): 3D printing, PCB manufacturing, laser cutting,
// acrylic cutting and battery packs. Gives an instant estimate from editable rates
// (Master → Settings → Services); staff then send the final quote after checking the files.
import { getSetting, round2 } from '../db.js';

export const SERVICES = {
  print3d: {
    title: '3D Printing', icon: '🖨️', lead: '2–4 days',
    blurb: 'FDM printing in PLA, PETG, ABS and TPU, plus resin (SLA) for fine detail. Upload STL/3MF/OBJ/STEP files.',
    files: ['stl', '3mf', 'obj', 'step', 'stp', 'zip'],
  },
  pcb: {
    title: 'PCB Manufacturing', icon: '🟩', lead: '7–12 days',
    blurb: '1, 2 and 4-layer PCBs with HASL or ENIG finish, any solder mask colour, optional stencil and assembly. Upload Gerber ZIP.',
    files: ['zip', 'rar', '7z', 'gbr', 'pdf'],
  },
  laser: {
    title: 'Laser Cutting & Engraving', icon: '🔥', lead: '1–3 days',
    blurb: 'Precise cutting and engraving of MDF, plywood and cardboard for enclosures, models and school projects. Upload DXF/SVG/PDF/AI.',
    files: ['dxf', 'svg', 'pdf', 'ai', 'cdr', 'png', 'jpg', 'jpeg', 'zip'],
  },
  acrylic: {
    title: 'Acrylic Cutting', icon: '💎', lead: '1–3 days',
    blurb: 'Clear and coloured acrylic in 2–8 mm for robot chassis, enclosures, nameplates and display stands. Upload DXF/SVG/PDF.',
    files: ['dxf', 'svg', 'pdf', 'ai', 'cdr', 'png', 'jpg', 'jpeg', 'zip'],
  },
  battery: {
    title: 'Battery Packs', icon: '🔋', lead: '2–5 days',
    blurb: 'Custom Li-ion / LiFePO4 packs spot-welded with BMS for robots, drones, e-bikes and solar — or test and repair your existing pack.',
    files: ['pdf', 'png', 'jpg', 'jpeg'],
  },
};
export const SERVICE_STATUS = ['new', 'quoted', 'approved', 'in_production', 'ready', 'delivered', 'cancelled'];

const num = (v, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
class SpecError extends Error { constructor(m) { super(m); this.status = 400; } }

const CELL = {
  '18650': { label: '18650 Li-ion 3.6 V 2600 mAh', v: 3.6, mah: 2600, rate: 'cell_18650', g: 46 },
  '21700': { label: '21700 Li-ion 3.6 V 4000 mAh', v: 3.6, mah: 4000, rate: 'cell_21700', g: 68 },
  lfp: { label: 'LiFePO4 32700 3.2 V 6000 mAh', v: 3.2, mah: 6000, rate: 'cell_lfp_32700', g: 145 },
};
const SHEET = {
  acrylic: { '2': 'acrylic_2mm_cm2', '3': 'acrylic_3mm_cm2', '5': 'acrylic_5mm_cm2', '8': 'acrylic_8mm_cm2' },
  laser: { 'mdf3': 'mdf_3mm_cm2', 'mdf6': 'mdf_6mm_cm2', 'ply4': 'ply_4mm_cm2', 'cardboard': 'cardboard_cm2' },
};
const SHEET_LABEL = { mdf3: 'MDF 3 mm', mdf6: 'MDF 6 mm', ply4: 'Plywood 4 mm', cardboard: 'Cardboard 3 mm' };

/**
 * Validates options and returns an estimate.
 * @returns {{ specs, quantity, lines:[{label, amount}], subtotal, gst, total, lead, summary, info }}
 */
export function estimate(service, raw = {}) {
  const R = getSetting('services');
  const svc = SERVICES[service];
  if (!svc) throw new SpecError('Unknown service');
  const qty = clamp(Math.floor(num(raw.quantity, 1)), 1, 10000);
  const lines = []; const info = {}; let specs = {}; let summary = '';
  const add = (label, amount) => lines.push({ label, amount: round2(amount) });

  if (service === 'print3d') {
    const material = ['pla', 'petg', 'abs', 'tpu', 'resin'].includes(raw.material) ? raw.material : 'pla';
    const grams = clamp(num(raw.grams, 0), 1, 20000);
    if (!(num(raw.grams) > 0)) throw new SpecError('Enter the estimated weight in grams (your slicer shows it), or a best guess');
    const quality = { draft: 0.9, standard: 1, fine: 1.3 }[raw.quality] ? raw.quality : 'standard';
    const qf = { draft: 0.9, standard: 1, fine: 1.3 }[quality];
    const infill = clamp(Math.round(num(raw.infill, 20)), 5, 100);
    const colour = String(raw.colour || 'Black').slice(0, 30);
    specs = { material, grams, quality, infill, colour };
    const perPart = grams * R[`${material}_per_g`] * qf;
    add(`${material.toUpperCase()} ${grams} g × ${qty} (${quality})`, perPart * qty);
    add('Setup & bed preparation', R.print_setup);
    summary = `${qty} × ${grams} g ${material.toUpperCase()}, ${quality}, ${infill}% infill, ${colour}`;
    const sub = lines.reduce((s, l) => s + l.amount, 0);
    if (sub < R.print_min) add('Minimum order top-up', R.print_min - sub);
  }

  if (service === 'pcb') {
    const layers = [1, 2, 4].includes(num(raw.layers)) ? num(raw.layers) : 2;
    const w = clamp(num(raw.width_mm), 5, 500); const h = clamp(num(raw.height_mm), 5, 500);
    if (!(num(raw.width_mm) > 0 && num(raw.height_mm) > 0)) throw new SpecError('Enter the board width and height in mm');
    const colour = ['green', 'black', 'blue', 'red', 'white', 'yellow'].includes(raw.colour) ? raw.colour : 'green';
    const finish = raw.finish === 'enig' ? 'enig' : 'hasl';
    const thickness = ['0.8', '1.0', '1.2', '1.6', '2.0'].includes(String(raw.thickness)) ? String(raw.thickness) : '1.6';
    const stencil = !!raw.stencil; const assembly = !!raw.assembly;
    specs = { layers, width_mm: w, height_mm: h, colour, finish, thickness, stencil, assembly };
    const area = (w * h) / 100; // cm²
    info.area_cm2 = round2(area);
    add('Engineering & tooling (per design)', R.pcb_setup);
    add(`${layers}-layer board ${w}×${h} mm (${round2(area)} cm²) × ${qty}`, area * qty * R[`pcb_${layers}l_cm2`]);
    if (colour !== 'green') add(`${colour} solder mask`, R.pcb_color_extra);
    if (finish === 'enig') add('ENIG gold finish', R.pcb_enig_extra);
    if (stencil) add('SMT stencil', R.pcb_stencil);
    if (assembly) add(`Assembly labour × ${qty} (components quoted separately)`, R.pcb_assembly_per_board * qty);
    summary = `${qty} × ${layers}L ${w}×${h} mm, ${thickness} mm, ${colour}, ${finish.toUpperCase()}${stencil ? ', stencil' : ''}${assembly ? ', assembly' : ''}`;
  }

  if (service === 'laser' || service === 'acrylic') {
    const mats = SHEET[service];
    const material = mats[String(raw.material)] ? String(raw.material) : Object.keys(mats)[0];
    const w = clamp(num(raw.width_mm), 10, 1200); const h = clamp(num(raw.height_mm), 10, 900);
    if (!(num(raw.width_mm) > 0 && num(raw.height_mm) > 0)) throw new SpecError('Enter the overall size of the part in mm');
    const cutM = clamp(num(raw.cut_length_m, 0) || round2(((w + h) * 2) / 1000), 0, 500);
    const engrave = clamp(num(raw.engrave_cm2, 0), 0, 100000);
    const colour = String(raw.colour || (service === 'acrylic' ? 'Clear' : 'Natural')).slice(0, 30);
    specs = { material, width_mm: w, height_mm: h, cut_length_m: cutM, engrave_cm2: engrave, colour };
    const area = (w * h) / 100;
    const matLabel = service === 'acrylic' ? `Acrylic ${material} mm ${colour}` : SHEET_LABEL[material];
    add(`${matLabel}: ${round2(area)} cm² × ${qty}`, area * qty * R[mats[material]]);
    add(`Cutting ${cutM} m × ${qty}`, cutM * qty * R.cut_per_m);
    if (engrave) add(`Engraving ${engrave} cm² × ${qty}`, engrave * qty * R.engrave_per_cm2);
    const sub = lines.reduce((s, l) => s + l.amount, 0);
    if (sub < R.cut_min) add('Minimum order top-up', R.cut_min - sub);
    summary = `${qty} × ${matLabel}, ${w}×${h} mm, ${cutM} m cut${engrave ? `, ${engrave} cm² engraving` : ''}`;
  }

  if (service === 'battery') {
    const mode = raw.mode === 'test' ? 'test' : 'build';
    if (mode === 'test') {
      const packs = qty;
      specs = { mode, voltage: String(raw.voltage || '').slice(0, 20), capacity: String(raw.capacity || '').slice(0, 20), issue: String(raw.issue || '').slice(0, 200) };
      add(`Pack test: capacity, IR, cell balance, BMS check × ${packs}`, R.battery_test_fee * packs);
      info.note = 'Cell replacement or BMS repair is quoted after the test.';
      summary = `Test & repair ${packs} pack(s)${specs.voltage ? `, ${specs.voltage}` : ''}${specs.issue ? ` — ${specs.issue}` : ''}`;
    } else {
      const cell = CELL[raw.cell] ? raw.cell : '18650';
      const s = clamp(Math.floor(num(raw.series, 3)), 1, 24); const p = clamp(Math.floor(num(raw.parallel, 1)), 1, 20);
      const bmsA = [10, 20, 30, 40, 60, 80].includes(num(raw.bms_a)) ? num(raw.bms_a) : 20;
      const connector = ['xt60', 'xt90', 'anderson', 'jst', 'wires'].includes(raw.connector) ? raw.connector : 'xt60';
      const c = CELL[cell]; const cells = s * p;
      specs = { mode, cell, series: s, parallel: p, bms_a: bmsA, connector };
      info.nominal_v = round2(s * c.v); info.capacity_ah = round2((p * c.mah) / 1000);
      info.energy_wh = round2(info.nominal_v * info.capacity_ah); info.cells = cells; info.weight_kg = round2((cells * c.g) / 1000 * 1.1);
      add(`${cells} × ${c.label} (BIS-registered) × ${qty} pack(s)`, cells * R[c.rate] * qty);
      add(`${s}S ${bmsA} A BMS × ${qty}`, (R.bms_base + R.bms_per_s * s + R.bms_per_10a * (bmsA / 10)) * qty);
      add(`Spot welding, nickel strip, insulation × ${qty}`, (R.assembly_per_cell * cells + R.pack_base) * qty);
      summary = `${qty} × ${s}S${p}P ${cell} pack — ${info.nominal_v} V, ${info.capacity_ah} Ah (${info.energy_wh} Wh), ${bmsA} A BMS, ${connector.toUpperCase()}`;
      if (info.energy_wh > 100) info.note = 'Packs above 100 Wh ship by surface/road only (not air).';
    }
  }

  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const gst = round2(subtotal * R.gst_rate / 100);
  return { service, title: svc.title, quantity: qty, specs, lines, subtotal, gst, total: round2(subtotal + gst), lead: svc.lead, summary, info };
}

export function publicCatalog() {
  const R = getSetting('services');
  return { enabled: !!R.enabled, gst_rate: R.gst_rate, services: Object.entries(SERVICES).map(([id, s]) => ({ id, ...s })) };
}
