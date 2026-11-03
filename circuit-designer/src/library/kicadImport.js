// Parser for KiCad footprint files (.kicad_mod, S-expression format).
// Lets you import the official KiCad library (~14,000 footprints):
//   git clone --depth 1 https://gitlab.com/kicad/libraries/kicad-footprints.git
//   npm run import-kicad -- ./kicad-footprints

export function parseSexpr(text) {
  let i = 0;
  const n = text.length;
  function skip() {
    while (i < n) {
      const c = text[i];
      if (c === ' ' || c === '\n' || c === '\r' || c === '\t') i++;
      else break;
    }
  }
  function atom() {
    if (text[i] === '"') {
      let s = '';
      i++;
      while (i < n && text[i] !== '"') { if (text[i] === '\\') { s += text[i + 1]; i += 2; } else s += text[i++]; }
      i++;
      return s;
    }
    const start = i;
    while (i < n && !/[\s()]/.test(text[i])) i++;
    return text.slice(start, i);
  }
  function list() {
    i++; // (
    const out = [];
    for (;;) {
      skip();
      if (i >= n) throw new Error('unexpected end of file');
      if (text[i] === ')') { i++; return out; }
      out.push(text[i] === '(' ? list() : atom());
    }
  }
  skip();
  if (text[i] !== '(') throw new Error('not an S-expression');
  return list();
}

const child = (node, name) => node.find((x) => Array.isArray(x) && x[0] === name);
const children = (node, name) => node.filter((x) => Array.isArray(x) && x[0] === name);
const num = (v) => Number.parseFloat(v);

export function kicadModToFootprint(text, category = 'Imported') {
  const root = parseSexpr(text);
  if (root[0] !== 'footprint' && root[0] !== 'module') throw new Error('not a footprint');
  const name = root[1];
  const descr = child(root, 'descr')?.[1] ?? '';
  const tags = child(root, 'tags')?.[1] ?? '';
  const pads = [];
  for (const p of children(root, 'pad')) {
    const [, number, kind, shape] = p;
    if (kind === 'np_thru_hole') continue; // mechanical holes have no copper
    const at = child(p, 'at') ?? ['at', 0, 0];
    const size = child(p, 'size') ?? ['size', 1, 1];
    const rot = num(at[3] ?? 0);
    let w = num(size[1]), h = num(size[2]);
    if (Math.round(rot / 90) % 2 !== 0) [w, h] = [h, w];
    const drillNode = child(p, 'drill');
    let drill;
    if (drillNode) {
      const vals = drillNode.slice(1).filter((x) => !Array.isArray(x) && x !== 'oval');
      drill = num(vals[0]);
    }
    const layers = child(p, 'layers')?.slice(1) ?? [];
    if (kind === 'smd' && !layers.some((l) => l.endsWith('.Cu'))) continue; // paste/mask-only apertures
    pads.push({
      num: String(number), type: kind === 'thru_hole' ? 'thru' : 'smd',
      shape: ['circle', 'oval', 'rect', 'roundrect'].includes(shape) ? shape : 'rect',
      x: num(at[1]), y: num(at[2]), w, h, ...(drill ? { drill } : {}),
    });
  }
  const silk = [];
  for (const l of [...children(root, 'fp_line'), ...children(root, 'fp_rect'), ...children(root, 'fp_circle')]) {
    const layer = child(l, 'layer')?.[1];
    if (layer !== 'F.SilkS') continue;
    if (l[0] === 'fp_line') {
      const s = child(l, 'start'), e = child(l, 'end');
      silk.push({ type: 'line', x1: num(s[1]), y1: num(s[2]), x2: num(e[1]), y2: num(e[2]) });
    } else if (l[0] === 'fp_rect') {
      const s = child(l, 'start'), e = child(l, 'end');
      const [x1, y1, x2, y2] = [num(s[1]), num(s[2]), num(e[1]), num(e[2])];
      silk.push({ type: 'line', x1, y1, x2, y2: y1 }, { type: 'line', x1: x2, y1, x2, y2 }, { type: 'line', x1: x2, y1: y2, x2: x1, y2 }, { type: 'line', x1, y1: y2, x2: x1, y2: y1 });
    } else {
      const c = child(l, 'center'), e = child(l, 'end');
      silk.push({ type: 'circle', cx: num(c[1]), cy: num(c[2]), r: Math.hypot(num(e[1]) - num(c[1]), num(e[2]) - num(c[2])) });
    }
  }
  return { name, category, description: [descr, tags].filter(Boolean).join(' | '), pads, silk, source: 'kicad' };
}
