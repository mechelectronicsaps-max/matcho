import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSexpr, kicadModToFootprint } from '../src/library/kicadImport.js';
import { exportKicadMod } from '../src/export/kicad.js';
import { getFootprint } from '../src/library/footprints.js';
import { TEMPLATES } from '../src/ai/templates.js';
import { validateDesign } from '../src/engine/design.js';
import { runPipeline } from '../src/engine/pipeline.js';

test('.kicad_mod export round-trips through the importer', () => {
  for (const name of ['SOIC-8_3.9x5.2mm_P1.27mm', 'DIP-8_W7.62mm', 'USB_C_Receptacle_16P', 'QFN-32-1EP_5x5mm_P0.5mm_EP3.1x3.1mm']) {
    const fp = getFootprint(name);
    const back = kicadModToFootprint(exportKicadMod(fp));
    assert.equal(back.name, fp.name);
    assert.equal(back.pads.length, fp.pads.length);
    back.pads.forEach((p, i) => { assert.equal(p.num, fp.pads[i].num); assert.equal(p.x, fp.pads[i].x); assert.equal(p.w, fp.pads[i].w); });
  }
});

test('generated .kicad_pcb and .net are well-formed S-expressions', () => {
  const r = runPipeline(validateDesign(TEMPLATES[0].design));
  const pcb = parseSexpr(r.files[`${r.base}.kicad_pcb`]);
  assert.equal(pcb[0], 'kicad_pcb');
  assert.equal(pcb.filter((x) => Array.isArray(x) && x[0] === 'footprint').length, 9);
  const net = parseSexpr(r.files[`${r.base}.net`]);
  assert.equal(net[0], 'export');
});
