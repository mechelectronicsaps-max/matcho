// Turns a raw design (from the AI or a template) into a validated design:
// every part exists in the library, every footprint is allowed for the part,
// every net node resolves to a real pin, and each pin sits on at most one net.

import { getComponent } from '../library/components.js';
import { getFootprint } from '../library/footprints.js';

const POWER_RE = /^(\+?\d+(\.\d+)?V\d*|\+?\d+V\d+|VCC|VDD|VBUS|VIN|VBAT|V\+|3V3|5V|12V|\+.*)$/i;
export const isGroundNet = (n) => /^(GND|AGND|DGND|PGND|VSS|0V|GROUND)$/i.test(n);
export const isPowerNet = (n) => !isGroundNet(n) && POWER_RE.test(n);

function resolvePin(comp, token) {
  const t = String(token).trim();
  const byNum = comp.pins.filter((p) => p.num.toUpperCase() === t.toUpperCase());
  if (byNum.length) return byNum[0];
  const byName = comp.pins.filter((p) => p.name.toUpperCase() === t.toUpperCase());
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) return { ambiguous: byName.map((p) => p.num) };
  // allow partial alternate-function names, e.g. "XTAL1" for "PB6/XTAL1"
  const parts = comp.pins.filter((p) => p.name.toUpperCase().split('/').includes(t.toUpperCase()));
  if (parts.length === 1) return parts[0];
  return null;
}

export function validateDesign(raw) {
  const errors = [];
  const warnings = [];
  const components = [];
  const refs = new Map();

  for (const c of raw.components ?? []) {
    const ref = String(c.ref ?? '').trim().toUpperCase();
    if (!ref) { errors.push('A component has no reference designator.'); continue; }
    if (refs.has(ref)) { errors.push(`Duplicate reference designator ${ref}.`); continue; }
    const comp = getComponent(c.part);
    if (!comp) { errors.push(`${ref}: unknown part "${c.part}" (use an id from the catalog).`); continue; }
    let fpName = c.footprint;
    if (!comp.footprints.some((f) => f.toLowerCase() === String(fpName ?? '').toLowerCase())) {
      if (fpName) warnings.push(`${ref}: footprint "${fpName}" is not allowed for ${comp.id}; using ${comp.footprints[0]}.`);
      fpName = comp.footprints[0];
    }
    const fp = getFootprint(fpName);
    if (!fp) { errors.push(`${ref}: footprint ${fpName} missing from the library.`); continue; }
    // every component pin must have at least one pad
    const padNums = new Set(fp.pads.map((p) => p.num));
    for (const pin of comp.pins) if (!padNums.has(pin.num)) warnings.push(`${ref}: pin ${pin.num} has no pad on ${fp.name}.`);
    const item = { ref, part: comp.id, value: c.value || comp.valueDefault, footprint: fp.name, purpose: c.purpose ?? '', comp, fp };
    refs.set(ref, item);
    components.push(item);
  }

  const pinNet = new Map(); // "REF.NUM" -> net name
  const nets = [];
  for (const n of raw.nets ?? []) {
    const name = String(n.name ?? '').trim().replace(/\s+/g, '_') || `NET${nets.length + 1}`;
    let net = nets.find((x) => x.name.toUpperCase() === name.toUpperCase());
    if (!net) { net = { name, nodes: [] }; nets.push(net); }
    for (const token of n.pins ?? []) {
      const m = String(token).trim().match(/^([A-Za-z]+[0-9]+[A-Za-z]?)[.:\-](.+)$/);
      if (!m) { errors.push(`Net ${name}: cannot parse node "${token}" (expected REF.PIN, e.g. R1.2).`); continue; }
      const c = refs.get(m[1].toUpperCase());
      if (!c) { errors.push(`Net ${name}: node ${token} refers to unknown component ${m[1]}.`); continue; }
      const pin = resolvePin(c.comp, m[2]);
      if (!pin) { errors.push(`Net ${name}: ${c.ref} (${c.part}) has no pin "${m[2]}". Pins: ${c.comp.pins.map((x) => `${x.num}:${x.name}`).join(' ')}`); continue; }
      if (pin.ambiguous) { errors.push(`Net ${name}: pin name "${m[2]}" on ${c.ref} is ambiguous, use a pin number (${pin.ambiguous.join(', ')}).`); continue; }
      const key = `${c.ref}.${pin.num}`;
      if (pinNet.has(key)) {
        if (pinNet.get(key) !== net.name) errors.push(`${key} is connected to two nets: ${pinNet.get(key)} and ${net.name}. Merge them or fix the connection.`);
        continue;
      }
      pinNet.set(key, net.name);
      net.nodes.push({ ref: c.ref, pin: pin.num });
    }
  }

  const noConnect = new Set();
  for (const t of raw.no_connect ?? []) {
    const m = String(t).trim().match(/^([A-Za-z]+[0-9]+[A-Za-z]?)[.:\-](.+)$/);
    const c = m && refs.get(m[1].toUpperCase());
    const pin = c && resolvePin(c.comp, m[2]);
    if (pin && !pin.ambiguous) noConnect.add(`${c.ref}.${pin.num}`);
  }

  for (const net of nets) if (net.nodes.length === 1) warnings.push(`Net ${net.name} has only one connection (${net.nodes[0].ref}.${net.nodes[0].pin}).`);
  for (const c of components) {
    for (const pin of c.comp.pins) {
      const key = `${c.ref}.${pin.num}`;
      if (!pinNet.has(key) && !noConnect.has(key) && pin.type !== 'nc' && c.comp.symbol !== 'connector') {
        warnings.push(`${key} (${pin.name}) is not connected.`);
      }
    }
  }

  return {
    title: raw.title || 'Untitled circuit',
    summary: raw.summary || '',
    notes: raw.notes ?? [],
    components,
    nets: nets.filter((n) => n.nodes.length > 0),
    noConnect: [...noConnect],
    pinNet: Object.fromEntries(pinNet),
    errors,
    warnings,
  };
}

/** Plain JSON view of a validated design (strip library objects). */
export function serializeDesign(d) {
  return {
    title: d.title, summary: d.summary, notes: d.notes,
    components: d.components.map(({ ref, part, value, footprint, purpose }) => ({ ref, part, value, footprint, purpose })),
    nets: d.nets.map((n) => ({ name: n.name, pins: n.nodes.map((x) => `${x.ref}.${x.pin}`) })),
    no_connect: d.noConnect,
  };
}
