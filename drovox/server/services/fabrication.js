// Fabrication services (like robu.in services): 3D printing, PCB manufacturing, laser cutting,
// acrylic cutting and battery packs. Gives an instant estimate from editable rates
// (Master → Settings → Services); staff then send the final quote after checking the files.
import { getSetting, round2 } from '../db.js';

export const SERVICES = {
  industrial3d: {
    title: 'Industrial 3D Printing', short: 'Industrial 3D Print', icon: '🏭', lead: '4–7 days', order: 1,
    blurb: 'Resin (SLA) and nylon (SLS / MJF) parts with fine detail, smooth surfaces and engineering strength — for prototypes, jigs, enclosures and short production runs.',
    files: ['stl', '3mf', 'obj', 'step', 'stp', 'zip'],
    materials: ['Standard resin (SLA) — smooth, fine detail', 'Tough resin (SLA) — impact resistant', 'Clear resin (SLA) — transparent', 'Nylon PA12 (SLS) — strong, functional', 'Nylon PA12 (MJF) — production grade'],
    features: ['Layer height down to 0.05 mm', 'Build volume up to 300 × 300 × 300 mm', 'Sanding, priming and painting on request', 'Engineering review of every file before printing'],
  },
  print3d: {
    title: 'Online FDM 3D Printing', short: '3D Printing', icon: '🖨️', lead: '2–4 days', order: 2,
    blurb: 'Affordable FDM printing in PLA, PETG, ABS and TPU for school projects, robot parts, enclosures and prototypes. Upload your file and get an instant price.',
    files: ['stl', '3mf', 'obj', 'step', 'stp', 'zip'],
    materials: ['PLA — easy, many colours', 'PETG — tough, heat resistant', 'ABS — strong, sandable', 'TPU — flexible / rubber-like'],
    features: ['Layer heights 0.12 / 0.2 / 0.28 mm', 'Infill 5–100%', 'Build volume up to 250 × 250 × 250 mm', 'Same-week delivery across India'],
  },
  metal_laser: {
    title: 'Metal Laser Cutting', short: 'Metal Laser Cutting', icon: '⚙️', lead: '3–6 days', order: 3,
    blurb: 'Fibre-laser cutting of mild steel, stainless steel, aluminium, brass and GI sheet — brackets, panels, chassis plates and enclosures, with optional bending.',
    files: ['dxf', 'dwg', 'step', 'stp', 'pdf', 'zip'],
    materials: ['Mild steel (MS) 0.8–6 mm', 'Stainless steel SS304 0.5–4 mm', 'Aluminium 0.8–4 mm', 'Brass 0.5–2 mm', 'Galvanised iron (GI) 0.5–2 mm'],
    features: ['Tolerance about ±0.1 mm', 'Max sheet 1500 × 3000 mm', 'CNC bending available', 'Upload DXF in mm, 1:1 scale'],
  },
  battery: {
    title: 'Customized Lithium-ion Battery Pack', short: 'Custom Battery Pack', icon: '🔋', lead: '2–5 days', order: 4,
    blurb: 'Spot-welded Li-ion and LiFePO4 packs with BMS for robots, drones, e-bikes, solar and inverters — built to your voltage and capacity. We also test and repair packs.',
    files: ['pdf', 'png', 'jpg', 'jpeg'],
    materials: ['18650 Li-ion (BIS-registered cells)', '21700 Li-ion (BIS-registered cells)', 'LiFePO4 32700'],
    features: ['1S to 24S, any parallel count', 'BMS 10–80 A with balancing', 'XT60 / XT90 / Anderson / JST connectors', 'Capacity and IR test report with every pack'],
  },
  laser: {
    title: 'Non-Metal Laser Cutting', short: 'Laser Cutting', icon: '🔥', lead: '1–3 days', order: 5,
    blurb: 'CO₂ laser cutting and engraving of acrylic, MDF, plywood, cardboard, leather and EVA foam — robot chassis, enclosures, nameplates, models and gifts.',
    files: ['dxf', 'svg', 'pdf', 'ai', 'cdr', 'png', 'jpg', 'jpeg', 'zip'],
    materials: ['Acrylic 2 / 3 / 5 / 8 mm (clear and colours)', 'MDF 3 / 6 mm', 'Plywood 4 mm', 'Cardboard 3 mm', 'Leather', 'EVA foam'],
    features: ['Bed size 600 × 900 mm', 'Engraving of logos, text and photos', 'Kerf about 0.2 mm', 'Ideal for school and college projects'],
  },
  pcb: {
    title: 'PCB Manufacturing', short: 'PCB Manufacturing', icon: '🟩', lead: '7–12 days', order: 6,
    blurb: '1, 2 and 4-layer PCBs with HASL or ENIG finish in any solder-mask colour, with optional stencil and assembly. Upload your Gerber ZIP for an instant estimate.',
    files: ['zip', 'rar', '7z', 'gbr', 'pdf'],
    materials: ['FR-4 1 / 2 / 4 layers', 'Thickness 0.8–2.0 mm', 'HASL or ENIG finish', 'Green, black, blue, red, white, yellow mask'],
    features: ['Free DFM check before production', 'SMT stencil available', 'Assembly (SMT + THT) on request', 'E-test on multi-layer boards'],
  },
  // Older request type kept so earlier requests still display; no longer offered separately.
  acrylic: { title: 'Acrylic Cutting', short: 'Acrylic Cutting', icon: '💎', lead: '1–3 days', legacy: true, files: ['dxf', 'svg', 'pdf', 'ai', 'cdr', 'png', 'jpg', 'jpeg', 'zip'] },
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
  laser: { 'acr3': 'acrylic_3mm_cm2', 'acr2': 'acrylic_2mm_cm2', 'acr5': 'acrylic_5mm_cm2', 'acr8': 'acrylic_8mm_cm2', 'mdf3': 'mdf_3mm_cm2', 'mdf6': 'mdf_6mm_cm2', 'ply4': 'ply_4mm_cm2', 'cardboard': 'cardboard_cm2', 'leather': 'leather_cm2', 'eva': 'eva_foam_cm2' },
};
const SHEET_LABEL = { acr2: 'Acrylic 2 mm', acr3: 'Acrylic 3 mm', acr5: 'Acrylic 5 mm', acr8: 'Acrylic 8 mm', mdf3: 'MDF 3 mm', mdf6: 'MDF 6 mm', ply4: 'Plywood 4 mm', cardboard: 'Cardboard 3 mm', leather: 'Leather', eva: 'EVA foam' };
const RESIN = { sla_standard: ['Standard resin (SLA)', 'sla_standard_per_cm3'], sla_tough: ['Tough resin (SLA)', 'sla_tough_per_cm3'], sla_clear: ['Clear resin (SLA)', 'sla_clear_per_cm3'], sls_nylon: ['Nylon PA12 (SLS)', 'sls_nylon_per_cm3'], mjf_nylon: ['Nylon PA12 (MJF)', 'mjf_nylon_per_cm3'] };
const METAL = { ms: ['Mild steel', 'ms_cm2_mm', [0.8, 1, 1.2, 1.5, 2, 3, 4, 5, 6]], ss: ['Stainless steel SS304', 'ss_cm2_mm', [0.5, 0.8, 1, 1.2, 1.5, 2, 3, 4]], al: ['Aluminium', 'al_cm2_mm', [0.8, 1, 1.5, 2, 3, 4]], brass: ['Brass', 'brass_cm2_mm', [0.5, 0.8, 1, 1.5, 2]], gi: ['Galvanised iron', 'gi_cm2_mm', [0.5, 0.8, 1, 1.2, 1.5, 2]] };

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
    const colour = String(raw.colour || (service === 'acrylic' || String(raw.material || 'acr3').startsWith('acr') ? 'Clear' : 'Natural')).slice(0, 30);
    specs = { material, width_mm: w, height_mm: h, cut_length_m: cutM, engrave_cm2: engrave, colour };
    const area = (w * h) / 100;
    const matLabel = service === 'acrylic' ? `Acrylic ${material} mm ${colour}` : `${SHEET_LABEL[material]}${material.startsWith('acr') ? ` ${colour}` : ''}`;
    add(`${matLabel}: ${round2(area)} cm² × ${qty}`, area * qty * R[mats[material]]);
    add(`Cutting ${cutM} m × ${qty}`, cutM * qty * R.cut_per_m);
    if (engrave) add(`Engraving ${engrave} cm² × ${qty}`, engrave * qty * R.engrave_per_cm2);
    const sub = lines.reduce((s, l) => s + l.amount, 0);
    if (sub < R.cut_min) add('Minimum order top-up', R.cut_min - sub);
    summary = `${qty} × ${matLabel}, ${w}×${h} mm, ${cutM} m cut${engrave ? `, ${engrave} cm² engraving` : ''}`;
  }

  if (service === 'industrial3d') {
    const material = RESIN[raw.material] ? raw.material : 'sla_standard';
    const cm3 = clamp(num(raw.volume_cm3, 0), 0.1, 30000);
    if (!(num(raw.volume_cm3) > 0)) throw new SpecError('Enter the part volume in cm³ (shown by your CAD or slicer software)');
    const finish = ['standard', 'sanded', 'painted'].includes(raw.finish) ? raw.finish : 'standard';
    const ff = { standard: 1, sanded: 1.25, painted: 1.6 }[finish];
    specs = { material, volume_cm3: cm3, finish, colour: String(raw.colour || 'Natural').slice(0, 30) };
    add(`${RESIN[material][0]} ${cm3} cm³ × ${qty}${finish !== 'standard' ? ` (${finish})` : ''}`, cm3 * R[RESIN[material][1]] * ff * qty);
    add('Setup, supports & post-curing', R.industrial_setup);
    const sub = lines.reduce((t, l) => t + l.amount, 0);
    if (sub < R.industrial_min) add('Minimum order top-up', R.industrial_min - sub);
    summary = `${qty} × ${RESIN[material][0]}, ${cm3} cm³, ${finish} finish`;
  }

  if (service === 'metal_laser') {
    const material = METAL[raw.material] ? raw.material : 'ms';
    const [mLabel, rateKey, thicknesses] = METAL[material];
    const t = thicknesses.includes(num(raw.thickness)) ? num(raw.thickness) : thicknesses[Math.min(2, thicknesses.length - 1)];
    const w = clamp(num(raw.width_mm), 10, 3000); const h = clamp(num(raw.height_mm), 10, 1500);
    if (!(num(raw.width_mm) > 0 && num(raw.height_mm) > 0)) throw new SpecError('Enter the overall size of the part in mm');
    const cutM = clamp(num(raw.cut_length_m, 0) || round2(((w + h) * 2) / 1000), 0, 1000);
    const bends = clamp(Math.floor(num(raw.bends, 0)), 0, 50);
    specs = { material, thickness: t, width_mm: w, height_mm: h, cut_length_m: cutM, bends };
    info.thicknesses = thicknesses;
    const area = (w * h) / 100;
    add(`${mLabel} ${t} mm sheet: ${round2(area)} cm² × ${qty}`, area * t * R[rateKey] * qty);
    add(`Fibre-laser cutting ${cutM} m × ${qty}`, cutM * R.metal_cut_per_m_mm * Math.max(1, t) * qty);
    if (bends) add(`Bending ${bends} bend(s) × ${qty}`, bends * R.metal_bend_each * qty);
    add('Setup & nesting', R.metal_setup);
    const sub = lines.reduce((s2, l) => s2 + l.amount, 0);
    if (sub < R.metal_min) add('Minimum order top-up', R.metal_min - sub);
    summary = `${qty} × ${mLabel} ${t} mm, ${w}×${h} mm, ${cutM} m cut${bends ? `, ${bends} bends` : ''}`;
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
  const services = Object.entries(SERVICES).filter(([, s]) => !s.legacy).map(([id, s]) => ({ id, ...s })).sort((a, b) => a.order - b.order);
  return { enabled: !!R.enabled, gst_rate: R.gst_rate, services };
}
