// Validated design -> schematic, PCB, previews and every export file.

import { renderSchematic } from './schematic.js';
import { generatePcb } from './pcb.js';
import { serializeDesign } from './design.js';
import { renderPcbSvg } from '../export/pcbSvg.js';
import { exportKicadPcb, exportKicadNetlist } from '../export/kicad.js';
import { exportGerbers } from '../export/gerber.js';
import { buildBom, bomCsv } from '../export/bom.js';
import { makeZip } from '../export/zip.js';

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'board';

export function runPipeline(design) {
  const schematicSvg = renderSchematic(design);
  const pcb = generatePcb(design);
  const pcbSvg = renderPcbSvg(pcb);
  const bom = buildBom(design);
  const base = slug(design.title);
  const gerbers = exportGerbers(pcb, base);
  const files = {
    [`${base}.kicad_pcb`]: exportKicadPcb(design, pcb),
    [`${base}.net`]: exportKicadNetlist(design),
    [`${base}-bom.csv`]: bomCsv(bom),
    [`${base}-schematic.svg`]: schematicSvg,
    [`${base}-pcb.svg`]: pcbSvg,
    [`${base}.design.json`]: JSON.stringify(serializeDesign(design), null, 2),
  };
  files[`${base}-gerbers.zip`] = makeZip(gerbers);
  const warnings = [...design.warnings];
  for (const u of pcb.unrouted) warnings.push(`Unrouted: ${u.net} (${u.from} -> ${u.to}). Finish it manually in KiCad.`);
  return {
    base,
    design: serializeDesign(design),
    errors: design.errors,
    warnings,
    schematicSvg,
    pcbSvg,
    pcbStats: pcb.stats,
    bom,
    files,
  };
}

export function bundleAll(result) {
  return makeZip(result.files);
}
