// Fabrication services (like robu.in services): 3D printing, PCB manufacturing, laser cutting,
// acrylic cutting and battery packs. Gives an instant estimate from editable rates
// (Master → Settings → Services); staff then send the final quote after checking the files.
import { getSetting, round2 } from '../db.js';
import { TECH, FINISHES, I3D_MATERIALS, FDM_MATERIALS, FDM_BUILD, fits } from './print-materials.js';

export const SERVICES = {
  industrial3d: {
    title: 'Industrial 3D Printing', short: 'Industrial 3D Print', icon: '🏭', lead: '4–7 days', order: 1,
    blurb: 'Resin (SLA, multi-jet), nylon (SLS / MJF) and metal (SLM, binder jet) parts with fine detail and engineering strength — upload your model for an instant price.',
    files: ['stl', 'step', 'stp', '3mf', 'obj'], model: true,
    materials: ['Resin (SLA): standard, black, tough, clear, high-temp', 'Nylon PA12 / PA11 (MJF), PA12 and glass-filled (SLS)', 'Metal (SLM): stainless 316L, aluminium, titanium', 'Multi-jet resin (WJP) incl. full colour', 'Binder-jet stainless steel (BJ)'],
    features: ['Layer height down to 0.05 mm', 'Build volume up to 300 × 300 × 300 mm', 'Sanding, priming and painting on request', 'Engineering review of every file before printing'],
  },
  print3d: {
    title: 'Online FDM 3D Printing', short: '3D Printing', icon: '🖨️', lead: '2–4 days', order: 2,
    blurb: 'Affordable FDM printing in PLA, PETG, ABS and TPU for school projects, robot parts, enclosures and prototypes. Upload your model and get an instant price.',
    files: ['stl', 'step', 'stp', '3mf', 'obj'], model: true,
    materials: ['PLA — easy, many colours', 'PETG — tough, heat resistant', 'ABS — strong, sandable', 'TPU — flexible / rubber-like'],
    features: ['Layer heights 0.12 / 0.2 / 0.28 mm', 'Infill 5–100%', 'Build volume up to 250 × 250 × 250 mm', 'Same-week delivery across India'],
  },
  metal_laser: {
    title: 'Metal Laser Cutting', short: 'Metal Laser Cutting', icon: '⚙️', lead: '3–6 days', order: 3,
    blurb: 'Fibre-laser cutting of mild steel, stainless steel, aluminium, brass and GI sheet — brackets, panels, chassis plates and enclosures, with optional bending.',
    files: ['dxf'], dxf: true,
    materials: ['Mild steel (MS) 0.8–6 mm', 'Stainless steel SS304 0.5–4 mm', 'Aluminium 0.8–4 mm', 'Brass 0.5–2 mm', 'Galvanised iron (GI) 0.5–2 mm'],
    features: ['Tolerance about ±0.1 mm', 'Max sheet 1500 × 3000 mm', 'CNC bending available', 'Upload DXF in mm, 1:1 scale'],
  },
  battery: {
    title: 'Customized Lithium-ion Battery Pack', short: 'Custom Battery Pack', icon: '🔋', lead: '2–5 days', order: 4,
    blurb: 'Spot-welded Li-ion and LiFePO4 packs with BMS for robots, drones, e-bikes, solar and inverters — built to your voltage and capacity. We also test and repair packs.',
    files: ['pdf', 'png', 'jpg', 'jpeg'], battery: true,
    materials: ['18650 Li-ion (BIS-registered cells)', '21700 Li-ion (BIS-registered cells)', 'LiFePO4 32700'],
    features: ['1S to 24S, any parallel count', 'BMS 10–80 A with balancing', 'XT60 / XT90 / Anderson / JST connectors', 'Capacity and IR test report with every pack'],
  },
  laser: {
    title: 'Non-Metal Laser Cutting', short: 'Laser Cutting', icon: '🔥', lead: '1–3 days', order: 5,
    blurb: 'CO₂ laser cutting and engraving of acrylic, MDF, plywood, cardboard, leather and EVA foam — robot chassis, enclosures, nameplates, models and gifts.',
    files: ['dxf'], dxf: true,
    materials: ['Acrylic 2 / 3 / 5 / 8 mm (clear and colours)', 'MDF 3 / 6 mm', 'Plywood 4 mm', 'Cardboard 3 mm', 'Leather', 'EVA foam'],
    features: ['Bed size 600 × 900 mm', 'Engraving of logos, text and photos', 'Kerf about 0.2 mm', 'Ideal for school and college projects'],
  },
  pcb: {
    title: 'PCB Manufacturing', short: 'PCB Manufacturing', icon: '🟩', lead: '7–12 days', order: 6,
    blurb: 'Upload your Gerber ZIP — we render the board, detect its size and layer count, and price it instantly. 1–6 layer FR-4 and aluminium PCBs with every finish, plus stencil and assembly.',
    files: ['zip'],
    materials: ['FR-4 (TG130–140) 1 / 2 / 4 / 6 layers', 'Aluminium metal-core (1 layer) for LEDs', 'Thickness 0.4–2.0 mm, 1 oz or 2 oz copper', 'HASL, lead-free HASL or ENIG', '9 solder-mask colours incl. matte'],
    features: ['Built-in Gerber viewer: size & layers detected automatically', 'Free DFM check before production', 'Panelisation, gold fingers, castellated holes, impedance control', 'SMT stencil and assembly on request', '100% flying-probe / E-test'],
  },
  // Older request type kept so earlier requests still display; no longer offered separately.
  acrylic: { title: 'Acrylic Cutting', short: 'Acrylic Cutting', icon: '💎', lead: '1–3 days', legacy: true, files: ['dxf', 'svg', 'pdf', 'ai', 'cdr', 'png', 'jpg', 'jpeg', 'zip'] },
};
export const SERVICE_STATUS = ['new', 'quoted', 'approved', 'in_production', 'ready', 'delivered', 'cancelled'];

function sizeCheck(raw, build, specs, info) {
  const size = String(raw.size_mm || '').split(/[x×,\s]+/).map(Number).filter((v) => v > 0);
  if (size.length !== 3) return;
  specs.size_mm = size.map((v) => Math.round(v * 100) / 100).join(' × ');
  if (!fits(size, build)) info.note = `The part (${specs.size_mm} mm) is larger than the ${build.join(' × ')} mm build volume — we will split it or quote separately.`;
}
const num = (v, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
class SpecError extends Error { constructor(m) { super(m); this.status = 400; } }

export const CELL = {
  '18650': { label: '18650 Li-ion 3.6 V 2600 mAh', short: '18650 · 2600 mAh', chem: 'Li-ion NMC', v: 3.6, vmax: 4.2, vmin: 3.0, mah: 2600, max_a: 5, cycles: '500+', dia: 18.5, len: 65, rate: 'cell_18650', g: 46, use: 'Everyday packs: robots, power banks, torches' },
  '18650hd': { label: '18650 Li-ion 3.6 V 3000 mAh high-drain', short: '18650 · 3000 mAh HD', chem: 'Li-ion NMC', v: 3.6, vmax: 4.2, vmin: 2.5, mah: 3000, max_a: 20, cycles: '300+', dia: 18.5, len: 65, rate: 'cell_18650_hd', g: 48, use: 'High current: drones, power tools, RC cars' },
  '21700': { label: '21700 Li-ion 3.6 V 4000 mAh', short: '21700 · 4000 mAh', chem: 'Li-ion NMC', v: 3.6, vmax: 4.2, vmin: 2.5, mah: 4000, max_a: 30, cycles: '500+', dia: 21.5, len: 70, rate: 'cell_21700', g: 68, use: 'E-bikes, scooters, AGVs — fewer cells, more power' },
  '21700hc': { label: '21700 Li-ion 3.6 V 5000 mAh', short: '21700 · 5000 mAh', chem: 'Li-ion NMC', v: 3.6, vmax: 4.2, vmin: 2.5, mah: 5000, max_a: 10, cycles: '500+', dia: 21.5, len: 70, rate: 'cell_21700_hc', g: 70, use: 'Long range, moderate current: e-bikes, solar lights' },
  lfp: { label: 'LiFePO4 32700 3.2 V 6000 mAh', short: 'LiFePO4 32700 · 6000 mAh', chem: 'LiFePO4', v: 3.2, vmax: 3.65, vmin: 2.5, mah: 6000, max_a: 18, cycles: '2000+', dia: 32.5, len: 70, rate: 'cell_lfp_32700', g: 145, use: 'Safest & longest life: solar, inverters, UPS, carts' },
};
export const PACK_OPTIONS = {
  bms: [10, 20, 30, 40, 60, 80], connectors: [['xt60', 'XT60'], ['xt90', 'XT90'], ['anderson', 'Anderson SB50'], ['jst', 'JST'], ['dc', 'DC barrel 5.5 mm'], ['wires', 'Bare wires']],
  casing: [['shrink', 'PVC heat-shrink'], ['abs', 'ABS plastic box'], ['metal', 'Aluminium box']], wires: [10, 20, 30, 50, 100],
};
const SHEET = {
  acrylic: { '2': 'acrylic_2mm_cm2', '3': 'acrylic_3mm_cm2', '5': 'acrylic_5mm_cm2', '8': 'acrylic_8mm_cm2' },
  laser: { 'acr3': 'acrylic_3mm_cm2', 'acr2': 'acrylic_2mm_cm2', 'acr5': 'acrylic_5mm_cm2', 'acr8': 'acrylic_8mm_cm2', 'mdf3': 'mdf_3mm_cm2', 'mdf6': 'mdf_6mm_cm2', 'ply4': 'ply_4mm_cm2', 'cardboard': 'cardboard_cm2', 'leather': 'leather_cm2', 'eva': 'eva_foam_cm2' },
};
const METAL_FINISH = { none: ['As cut'], deburr: ['Deburring', 0.05], powder: ['Powder coating', 0.6] };
const SHEET_LABEL = { acr2: 'Acrylic 2 mm', acr3: 'Acrylic 3 mm', acr5: 'Acrylic 5 mm', acr8: 'Acrylic 8 mm', mdf3: 'MDF 3 mm', mdf6: 'MDF 6 mm', ply4: 'Plywood 4 mm', cardboard: 'Cardboard 3 mm', leather: 'Leather', eva: 'EVA foam' };
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
  const lines = []; const info = {}; let specs = {}; let summary = ''; let lead = svc.lead;
  const add = (label, amount) => lines.push({ label, amount: round2(amount) });

  if (service === 'print3d') {
    const material = ['pla', 'petg', 'abs', 'tpu', 'resin'].includes(raw.material) ? raw.material : 'pla';
    const quality = { draft: 0.9, standard: 1, fine: 1.3 }[raw.quality] ? raw.quality : 'standard';
    const qf = { draft: 0.9, standard: 1, fine: 1.3 }[quality];
    const infill = clamp(Math.round(num(raw.infill, 20)), 5, 100);
    const mat = FDM_MATERIALS.find((m) => m.id === material);
    let grams;
    if (num(raw.volume_cm3) > 0) {
      // from the uploaded model: solid walls (1.2 mm shells) + infill inside, plus ~8% for supports/purge
      const vol = clamp(num(raw.volume_cm3), 0.01, 20000); const area = Math.max(0, num(raw.area_cm2));
      const shell = Math.min(1, (area * 0.12) / vol);
      grams = Math.max(1, Math.round(vol * (mat?.density || 1.24) * (shell + (1 - shell) * infill / 100) * 1.08 * 10) / 10);
      info.volume_cm3 = vol; info.grams = grams;
    } else {
      grams = clamp(num(raw.grams, 0), 1, 20000);
      if (!(num(raw.grams) > 0)) throw new SpecError('Upload your 3D model (or enter the weight in grams shown by your slicer)');
    }
    const colour = (mat && mat.colours.includes(raw.colour) ? raw.colour : String(raw.colour || mat?.colours[0] || 'Black')).slice(0, 30);
    specs = { material, grams, quality, infill, colour };
    sizeCheck(raw, FDM_BUILD, specs, info);
    const perPart = grams * R[`${material}_per_g`] * qf;
    add(`${material.toUpperCase()} ${grams} g × ${qty} (${quality})`, perPart * qty);
    add('Setup & bed preparation', R.print_setup);
    summary = `${qty} × ${grams} g ${material.toUpperCase()}, ${quality}, ${infill}% infill, ${colour}`;
    const sub = lines.reduce((s, l) => s + l.amount, 0);
    if (sub < R.print_min) add('Minimum order top-up', R.print_min - sub);
  }

  if (service === 'pcb') {
    // Full option set used by Indian/Chinese PCB fabs (material, layers, panel, thickness, mask, finish, copper…)
    const pick = (v, list, def) => (list.includes(String(v)) ? String(v) : def);
    const layers = [1, 2, 4, 6].includes(num(raw.layers)) ? num(raw.layers) : 2;
    const w = clamp(num(raw.width_mm), 5, 500); const h = clamp(num(raw.height_mm), 5, 500);
    if (!(num(raw.width_mm) > 0 && num(raw.height_mm) > 0)) throw new SpecError('Upload your Gerber ZIP or enter the board width and height in mm');
    const material = pick(raw.material, ['fr4', 'aluminium'], 'fr4');
    const designs = clamp(Math.floor(num(raw.designs, 1)), 1, 10);
    const delivery = pick(raw.delivery, ['single', 'panel_customer', 'panel_drovox'], 'single');
    const thickness = pick(raw.thickness, ['0.4', '0.6', '0.8', '1.0', '1.2', '1.6', '2.0'], '1.6');
    const colour = pick(raw.colour, ['green', 'red', 'yellow', 'blue', 'white', 'black', 'purple', 'matte_black', 'matte_green'], 'green');
    const finish = pick(raw.finish, ['hasl', 'hasl_lf', 'enig'], 'hasl');
    const copper = pick(raw.copper, ['1', '2'], '1');
    const via = pick(raw.via, ['tented', 'untented', 'plugged'], 'tented');
    const minHole = pick(raw.min_hole, ['0.3', '0.25', '0.2'], '0.3');
    const gold = !!raw.gold_fingers; const castellated = !!raw.castellated; const impedance = !!raw.impedance && layers >= 4;
    const removeMark = !!raw.remove_mark; const stencil = !!raw.stencil; const assembly = !!raw.assembly;
    const express = raw.build === 'express';
    if (material === 'aluminium' && layers > 1) throw new SpecError('Aluminium (metal-core) boards are made as 1-layer only');
    specs = { material, layers, width_mm: w, height_mm: h, designs, delivery, thickness, colour, silkscreen: colour === 'white' ? 'black' : 'white', finish, copper, via, min_hole: minHole,
      gold_fingers: gold, castellated, impedance, remove_mark: removeMark, stencil, assembly, build: express ? 'express' : 'standard' };
    const area = (w * h) / 100; // cm² per board
    const rate = R[`pcb_${layers}l_cm2`] ?? R.pcb_2l_cm2;
    let boards = area * qty * rate;
    info.area_cm2 = round2(area); info.total_area_m2 = round2((area * qty) / 10000);
    add(layers <= 2 ? 'Engineering, CAM & tooling' : `Multilayer engineering & tooling (${layers}L)`, layers <= 2 ? R.pcb_setup : R.pcb_setup_multilayer);
    if (material === 'aluminium') boards *= 1 + R.pcb_aluminium_pct / 100;
    if (copper === '2') boards *= 1 + R.pcb_2oz_pct / 100;
    if (['0.4', '0.6', '2.0'].includes(thickness)) boards *= 1 + R.pcb_thickness_pct / 100;
    add(`${layers}-layer ${material === 'aluminium' ? 'aluminium' : 'FR-4'} ${w}×${h} mm (${round2(area)} cm²) × ${qty}${copper === '2' ? ', 2 oz' : ''}${['0.4', '0.6', '2.0'].includes(thickness) ? `, ${thickness} mm` : ''}`, boards);
    if (designs > 1) add(`${designs} different designs in the panel`, (designs - 1) * R.pcb_design_extra);
    if (delivery === 'panel_drovox') add('Panelisation by Drovox (V-cut / mouse bites)', R.pcb_panel_fee);
    if (colour.startsWith('matte')) add(`${colour.replace('_', ' ')} solder mask`, R.pcb_matte_extra);
    else if (colour !== 'green') add(`${colour} solder mask`, R.pcb_color_extra);
    if (finish === 'hasl_lf') add('Lead-free HASL (RoHS)', R.pcb_leadfree_extra);
    if (finish === 'enig') add('ENIG gold finish', R.pcb_enig_extra);
    if (minHole === '0.2') add('Fine drilling (0.2 mm holes)', R.pcb_small_hole);
    if (via === 'plugged') add('Plugged vias (epoxy filled)', R.pcb_plugged_via);
    if (gold) add('Gold fingers (hard gold, bevelled)', R.pcb_gold_fingers);
    if (castellated) add('Castellated (half) holes', R.pcb_castellated);
    if (impedance) add('Impedance control & coupon', R.pcb_impedance);
    if (stencil) add('SMT stencil (framework-free)', R.pcb_stencil);
    if (assembly) add(`Assembly labour × ${qty} (components quoted separately)`, R.pcb_assembly_per_board * qty);
    if (express) add(`Express build (+${R.pcb_express_pct}%)`, lines.reduce((t, l) => t + l.amount, 0) * R.pcb_express_pct / 100);
    const base = { 1: [4, 6], 2: [5, 7], 4: [7, 10], 6: [10, 14] }[layers];
    const days = express ? [Math.max(2, base[0] - 2), base[1] - 3] : base;
    info.build_days = `${days[0]}–${days[1]} working days${express ? ' (express)' : ''}`;
    info.weight_kg = round2((area * qty * Number(thickness) * 0.185) / 100 + 0.05);
    lead = info.build_days;
    summary = `${qty} × ${layers}L ${material === 'aluminium' ? 'Al' : 'FR-4'} ${w}×${h} mm, ${thickness} mm, ${colour.replace('_', ' ')}, ${finish === 'enig' ? 'ENIG' : finish === 'hasl_lf' ? 'HASL-LF' : 'HASL'}, ${copper} oz${designs > 1 ? `, ${designs} designs` : ''}${gold ? ', gold fingers' : ''}${castellated ? ', castellated' : ''}${stencil ? ', stencil' : ''}${assembly ? ', assembly' : ''}${express ? ', EXPRESS' : ''}`;
  }

  if (service === 'laser' || service === 'acrylic') {
    const mats = SHEET[service];
    const material = mats[String(raw.material)] ? String(raw.material) : Object.keys(mats)[0];
    const w = clamp(num(raw.width_mm), 10, 1200); const h = clamp(num(raw.height_mm), 10, 1200);
    if (!(num(raw.width_mm) > 0 && num(raw.height_mm) > 0)) throw new SpecError('Enter the overall size of the part in mm');
    const cutM = clamp(num(raw.cut_length_m, 0) || round2(((w + h) * 2) / 1000), 0, 500);
    const engrave = clamp(num(raw.engrave_cm2, 0), 0, 100000);
    const colour = String(raw.colour || (service === 'acrylic' || String(raw.material || 'acr3').startsWith('acr') ? 'Clear' : 'Natural')).slice(0, 30);
    const pierces = clamp(Math.floor(num(raw.pierces, 0)), 0, 100000);
    specs = { material, width_mm: w, height_mm: h, cut_length_m: cutM, engrave_cm2: engrave, colour, ...(pierces ? { pierces } : {}) };
    if (service === 'laser' && !(Math.max(num(raw.width_mm), num(raw.height_mm)) <= 900 && Math.min(num(raw.width_mm), num(raw.height_mm)) <= 600)) info.note = 'The part is larger than our 600 × 900 mm bed — we will split it or quote separately.';
    const area = (w * h) / 100;
    const matLabel = service === 'acrylic' ? `Acrylic ${material} mm ${colour}` : `${SHEET_LABEL[material]}${material.startsWith('acr') ? ` ${colour}` : ''}`;
    add(`${matLabel}: ${round2(area)} cm² × ${qty}`, area * qty * R[mats[material]]);
    add(`Cutting ${cutM} m × ${qty}`, cutM * qty * R.cut_per_m);
    if (pierces) add(`Pierces ${pierces} × ${qty}`, pierces * num(R.laser_pierce, 0.5) * qty);
    if (engrave) add(`Engraving ${engrave} cm² × ${qty}`, engrave * qty * R.engrave_per_cm2);
    const sub = lines.reduce((s, l) => s + l.amount, 0);
    if (sub < R.cut_min) add('Minimum order top-up', R.cut_min - sub);
    summary = `${qty} × ${matLabel}, ${w}×${h} mm, ${cutM} m cut${engrave ? `, ${engrave} cm² engraving` : ''}`;
  }

  if (service === 'industrial3d') {
    const mat = I3D_MATERIALS.find((m) => m.id === raw.material) || I3D_MATERIALS[0];
    const tech = TECH[mat.tech];
    const cm3 = clamp(num(raw.volume_cm3, 0), 0.01, 30000);
    if (!(num(raw.volume_cm3) > 0)) throw new SpecError('Upload your 3D model (STL, STEP, 3MF or OBJ) to calculate the price');
    const fin = FINISHES[tech.family].find(([f]) => f === raw.finish) || FINISHES[tech.family][0];
    const colour = mat.colours.includes(raw.colour) ? raw.colour : mat.colours[0];
    specs = { technology: tech.name, material: mat.id, material_name: mat.name, volume_cm3: cm3, finish: fin[0], colour };
    add(`${mat.name} ${cm3} cm³ × ${qty}${fin[0] !== 'standard' ? ` (${fin[1]})` : ''}`, cm3 * num(R[mat.rate], 0) * fin[2] * qty);
    add(tech.family === 'metal' ? 'Setup, supports, stress relief & removal' : 'Setup, supports & post-processing', tech.family === 'metal' ? num(R.industrial_metal_setup, 1500) : R.industrial_setup);
    const sub = lines.reduce((t, l) => t + l.amount, 0);
    if (sub < R.industrial_min) add('Minimum order top-up', R.industrial_min - sub);
    sizeCheck(raw, tech.build, specs, info);
    if (tech.family === 'metal') lead = '10–15 working days';
    summary = `${qty} × ${mat.name} (${tech.name}), ${cm3} cm³, ${fin[1]}, ${colour}`;
  }

  if (service === 'metal_laser') {
    const material = METAL[raw.material] ? raw.material : 'ms';
    const [mLabel, rateKey, thicknesses] = METAL[material];
    const t = thicknesses.includes(num(raw.thickness)) ? num(raw.thickness) : thicknesses[Math.min(2, thicknesses.length - 1)];
    const w = clamp(num(raw.width_mm), 10, 3000); const h = clamp(num(raw.height_mm), 10, 3000);
    if (!(num(raw.width_mm) > 0 && num(raw.height_mm) > 0)) throw new SpecError('Enter the overall size of the part in mm');
    const cutM = clamp(num(raw.cut_length_m, 0) || round2(((w + h) * 2) / 1000), 0, 1000);
    const bends = clamp(Math.floor(num(raw.bends, 0)), 0, 50);
    const pierces = clamp(Math.floor(num(raw.pierces, 0)), 0, 100000);
    const finish = METAL_FINISH[raw.finish] ? raw.finish : 'none';
    specs = { material, thickness: t, width_mm: w, height_mm: h, cut_length_m: cutM, bends, ...(pierces ? { pierces } : {}), finish };
    const fitsSheet = (Math.max(num(raw.width_mm), num(raw.height_mm)) <= 3000 && Math.min(num(raw.width_mm), num(raw.height_mm)) <= 1500);
    if (!fitsSheet) info.note = 'The part is larger than our 1500 × 3000 mm sheet — we will quote it separately.';
    info.thicknesses = thicknesses;
    const area = (w * h) / 100;
    add(`${mLabel} ${t} mm sheet: ${round2(area)} cm² × ${qty}`, area * t * R[rateKey] * qty);
    add(`Fibre-laser cutting ${cutM} m × ${qty}`, cutM * R.metal_cut_per_m_mm * Math.max(1, t) * qty);
    if (pierces) add(`Pierces ${pierces} × ${qty}`, pierces * num(R.metal_pierce, 2) * Math.max(1, t / 2) * qty);
    if (bends) add(`Bending ${bends} bend(s) × ${qty}`, bends * R.metal_bend_each * qty);
    if (finish !== 'none') add(`${METAL_FINISH[finish][0]} × ${qty}`, (w * h / 100) * METAL_FINISH[finish][1] * qty);
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
      const bmsA = PACK_OPTIONS.bms.includes(num(raw.bms_a)) ? num(raw.bms_a) : 20;
      const connector = PACK_OPTIONS.connectors.some(([k]) => k === raw.connector) ? raw.connector : 'xt60';
      const casing = PACK_OPTIONS.casing.some(([k]) => k === raw.casing) ? raw.casing : 'shrink';
      const wire = PACK_OPTIONS.wires.includes(num(raw.wire_cm)) ? num(raw.wire_cm) : 10;
      const charger = !!raw.charger; const ntc = !!raw.ntc;
      const c = CELL[cell]; const cells = s * p;
      specs = { mode, cell, series: s, parallel: p, bms_a: bmsA, connector, casing, wire_cm: wire, charger, ntc, application: String(raw.application || '').slice(0, 40) };
      info.nominal_v = round2(s * c.v); info.max_v = round2(s * c.vmax); info.min_v = round2(s * c.vmin); info.capacity_ah = round2((p * c.mah) / 1000);
      info.energy_wh = round2(info.nominal_v * info.capacity_ah); info.cells = cells; info.weight_kg = round2((cells * c.g) / 1000 * (casing === 'shrink' ? 1.1 : casing === 'abs' ? 1.25 : 1.4));
      info.max_current_a = Math.min(bmsA, p * c.max_a); info.cell_limited = p * c.max_a < bmsA;
      info.size_mm = [Math.round(s * c.dia + 4), Math.round(p * c.dia + 4), Math.round(c.len + 6)];
      add(`${cells} × ${c.label} (BIS-registered) × ${qty} pack(s)`, cells * num(R[c.rate], 150) * qty);
      add(`${s}S ${bmsA} A BMS with balancing × ${qty}`, (R.bms_base + R.bms_per_s * s + R.bms_per_10a * (bmsA / 10)) * qty);
      add(`Spot welding, nickel strip, fish paper, insulation × ${qty}`, (R.assembly_per_cell * cells + R.pack_base) * qty);
      if (casing !== 'shrink') add(`${casing === 'abs' ? 'ABS plastic box' : 'Aluminium box'} × ${qty}`, (casing === 'abs' ? num(R.casing_abs_base, 250) + num(R.casing_abs_per_cell, 8) * cells : num(R.casing_metal_base, 600) + num(R.casing_metal_per_cell, 15) * cells) * qty);
      if (wire > 10) add(`Output wire ${wire} cm × ${qty}`, ((wire - 10) / 10) * num(R.wire_per_10cm, 12) * Math.max(1, bmsA / 20) * qty);
      if (ntc) add(`NTC temperature sensor × ${qty}`, num(R.ntc_sensor, 60) * qty);
      if (charger) add(`${info.max_v} V matching charger × ${qty}`, (num(R.charger_base, 450) + num(R.charger_per_s, 30) * s) * qty);
      summary = `${qty} × ${s}S${p}P ${c.short} pack — ${info.nominal_v} V, ${info.capacity_ah} Ah (${info.energy_wh} Wh), ${bmsA} A BMS, ${connector.toUpperCase()}, ${casing}`;
      if (info.cell_limited) info.warn = `The cells can deliver about ${p * c.max_a} A in this layout — less than the ${bmsA} A BMS. Use high-drain cells or more in parallel for more current.`;
      if (info.energy_wh > 100) info.note = 'Packs above 100 Wh ship by surface/road only (not air).';
    }
  }

  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const gst = round2(subtotal * R.gst_rate / 100);
  return { service, title: svc.title, quantity: qty, specs, lines, subtotal, gst, total: round2(subtotal + gst), lead, summary, info };
}

export function publicCatalog() {
  const R = getSetting('services');
  const services = Object.entries(SERVICES).filter(([, s]) => !s.legacy).map(([id, s]) => ({ id, ...s })).sort((a, b) => a.order - b.order);
  const sheets = {
    metal: Object.entries(METAL).map(([id, [name, , thicknesses]]) => ({ id, name, thicknesses, colour: { ms: '#6b7280', ss: '#c7ccd3', al: '#aab3bf', brass: '#c9a646', gi: '#9ca3af' }[id] })),
    metal_finish: Object.entries(METAL_FINISH).map(([id, [name]]) => ({ id, name })),
    laser: [
      { group: 'Acrylic', colour: '#93c5fd', items: [['acr2', '2 mm'], ['acr3', '3 mm'], ['acr5', '5 mm'], ['acr8', '8 mm']] },
      { group: 'MDF', colour: '#b08a5a', items: [['mdf3', '3 mm'], ['mdf6', '6 mm']] },
      { group: 'Plywood', colour: '#d6b37a', items: [['ply4', '4 mm']] },
      { group: 'Cardboard', colour: '#c8a97e', items: [['cardboard', '3 mm']] },
      { group: 'Leather', colour: '#8b5a3c', items: [['leather', '1–2 mm']] },
      { group: 'EVA foam', colour: '#4b5563', items: [['eva', '2–10 mm']] },
    ],
    acrylic_colours: ['Clear', 'Black', 'White', 'Red', 'Blue', 'Yellow', 'Fluorescent', 'Frosted'],
  };
  const print = {
    techs: Object.entries(TECH).map(([id, t]) => ({ id, ...t })), finishes: FINISHES,
    industrial: I3D_MATERIALS, fdm: FDM_MATERIALS.map(({ rate, ...m }) => m), fdm_build: FDM_BUILD,
  };
  const battery = { cells: Object.entries(CELL).map(([id, c]) => { const { rate, ...pub } = c; return { id, ...pub }; }), ...PACK_OPTIONS };
  return { enabled: !!R.enabled, gst_rate: R.gst_rate, services, print, sheets, battery };
}
