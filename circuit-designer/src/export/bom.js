// Bill of materials grouped by part + value + footprint.

export function buildBom(design) {
  const groups = new Map();
  for (const c of design.components) {
    const key = `${c.part}|${c.value}|${c.footprint}`;
    if (!groups.has(key)) groups.set(key, { refs: [], part: c.part, value: c.value, footprint: c.footprint, description: c.comp.name });
    groups.get(key).refs.push(c.ref);
  }
  const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true });
  return [...groups.values()]
    .map((g) => ({ ...g, refs: g.refs.sort(natural), qty: g.refs.length }))
    .sort((a, b) => natural(a.refs[0], b.refs[0]));
}

export function bomCsv(bom) {
  const cell = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const rows = [['Qty', 'References', 'Value', 'Part', 'Footprint', 'Description']];
  for (const b of bom) rows.push([b.qty, b.refs.join(' '), b.value, b.part, b.footprint, b.description]);
  return rows.map((r) => r.map(cell).join(',')).join('\n') + '\n';
}
