// Gerber viewer & auto-detection for PCB orders: unzips a Gerber/drill ZIP, identifies the layers,
// renders top and bottom board images (SVG) and measures the board outline so the price can be
// calculated automatically. Runs on the server; the browser shows the SVGs as <img> (no script).
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');
const pcbStackup = require('pcb-stackup');
const whatsThatGerber = require('whats-that-gerber');

const MAX_ZIP = 25 * 1024 * 1024;           // compressed
const MAX_TOTAL = 80 * 1024 * 1024;         // uncompressed (zip-bomb guard)
const MAX_FILES = 80;
const SKIP = /\.(pdf|png|jpe?g|txt|md|html?|csv|xlsx?|rpt|xln|zip|rar|7z|step|stp|pos|kicad_pcb|brd|sch|pcbdoc|schdoc)$/i;

export class GerberError extends Error { constructor(m) { super(m); this.status = 400; } }

/** @param {Buffer} buf ZIP file */
export async function analyzeGerberZip(buf) {
  if (!buf?.length) throw new GerberError('The Gerber file is empty');
  if (buf.length > MAX_ZIP) throw new GerberError('The Gerber ZIP is larger than 25 MB');
  let zip;
  try { zip = new AdmZip(buf); } catch { throw new GerberError('Upload the Gerber files as a .zip archive'); }
  const entries = zip.getEntries().filter((e) => !e.isDirectory && !e.entryName.split('/').pop().startsWith('.') && !e.entryName.includes('__MACOSX'));
  if (entries.length > MAX_FILES) throw new GerberError(`The ZIP has more than ${MAX_FILES} files — include only the Gerber and drill files`);
  const total = entries.reduce((s, e) => s + (e.header?.size || 0), 0);
  if (total > MAX_TOTAL) throw new GerberError('The ZIP is too large when extracted');
  const candidates = entries.filter((e) => !SKIP.test(e.entryName)).map((e) => ({ filename: e.entryName.split('/').pop(), path: e.entryName, entry: e }));
  const types = whatsThatGerber(candidates.map((c) => c.filename));
  const layers = candidates
    .filter((c) => types[c.filename]?.type)
    .map((c) => ({ filename: c.filename, type: types[c.filename].type, side: types[c.filename].side, gerber: c.entry.getData().toString('utf8') }));
  if (!layers.length) throw new GerberError('No Gerber layers were recognised in the ZIP. Export Gerber (RS-274X) and Excellon drill files from your PCB software and zip them together.');

  let stack;
  try {
    stack = await Promise.race([
      pcbStackup(layers.map((l) => ({ filename: l.filename, gerber: l.gerber, type: l.type, side: l.side }))),
      new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 20000)),
    ]);
  } catch (e) {
    throw new GerberError(e.message === 'timeout' ? 'The Gerber files took too long to render — please check them' : 'The Gerber files could not be read — please re-export them from your PCB software');
  }
  const toMm = (v, units) => (units === 'in' ? v * 25.4 : v);
  const w = toMm(stack.top.width, stack.top.units); const h = toMm(stack.top.height, stack.top.units);
  const copper = layers.filter((l) => l.type === 'copper');
  const inner = copper.filter((l) => l.side === 'inner').length;
  const outer = copper.filter((l) => l.side === 'top' || l.side === 'bottom').length;
  const copperCount = Math.max(1, inner + outer);
  const layerCount = copperCount <= 1 ? 1 : copperCount <= 2 ? 2 : copperCount <= 4 ? 4 : 6;
  const hasOutline = layers.some((l) => l.type === 'outline');
  const drills = layers.filter((l) => l.type === 'drill');
  const drillHits = drills.reduce((s, l) => s + (l.gerber.match(/^X-?[\d.]+Y-?[\d.]+/gm) || []).length, 0);
  const warnings = [];
  if (!hasOutline) warnings.push('No board outline (Edge Cuts / GKO / GM1) found — size was estimated from the copper and must be confirmed.');
  if (!drills.length) warnings.push('No drill file found — through-holes and vias will be missing.');
  if (copperCount === 3 || copperCount === 5 || copperCount > 6) warnings.push(`${copperCount} copper layers detected — boards are made in 1, 2, 4 or 6 layers, so ${layerCount} layers is assumed.`);
  return {
    width_mm: Math.round(w * 100) / 100, height_mm: Math.round(h * 100) / 100,
    layers: layerCount, copper_layers: copperCount, has_outline: hasOutline, drill_hits: drillHits,
    files: layers.map((l) => ({ name: l.filename, type: l.type, side: l.side })),
    ignored: candidates.filter((c) => !types[c.filename]?.type).map((c) => c.filename).concat(entries.filter((e) => SKIP.test(e.entryName)).map((e) => e.entryName.split('/').pop())),
    top_svg: stack.top.svg, bottom_svg: stack.bottom.svg, warnings,
  };
}
