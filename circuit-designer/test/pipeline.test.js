import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES } from '../src/ai/templates.js';
import { validateDesign } from '../src/engine/design.js';
import { runPipeline } from '../src/engine/pipeline.js';
import { listComponents } from '../src/library/components.js';
import { getFootprint, loadFootprints } from '../src/library/footprints.js';

test('every component footprint exists and has a pad for every pin', () => {
  for (const c of listComponents()) {
    for (const name of c.footprints) {
      const fp = getFootprint(name);
      assert.ok(fp, `${c.id}: footprint ${name} missing`);
      const nums = new Set(fp.pads.map((p) => p.num));
      for (const pin of c.pins) assert.ok(nums.has(pin.num), `${c.id} pin ${pin.num} has no pad on ${name}`);
    }
  }
});

test('footprint names are unique', () => {
  const names = loadFootprints().map((f) => f.name);
  assert.equal(new Set(names).size, names.length);
});

for (const t of TEMPLATES) {
  test(`template "${t.design.title}" validates, routes and exports`, () => {
    const d = validateDesign(t.design);
    assert.deepEqual(d.errors, []);
    const r = runPipeline(d);
    assert.match(r.schematicSvg, /^<svg/);
    assert.match(r.files[`${r.base}.kicad_pcb`], /^\(kicad_pcb/);
    assert.ok(r.files[`${r.base}-gerbers.zip`].length > 500);
    console.log(`  ${t.design.title}: ${JSON.stringify(r.pcbStats)} warnings=${r.warnings.length}`);
    for (const w of r.warnings) console.log('   -', w);
  });
}

test('validator reports bad pins and parts', () => {
  const d = validateDesign({ components: [{ ref: 'U1', part: 'NE555', value: '', footprint: 'DIP-8_W7.62mm' }, { ref: 'X1', part: 'NOPE' }], nets: [{ name: 'A', pins: ['U1.9', 'U1.VCC', 'Q5.1'] }] });
  assert.ok(d.errors.some((e) => e.includes('unknown part')));
  assert.ok(d.errors.some((e) => e.includes('has no pin "9"')));
  assert.ok(d.errors.some((e) => e.includes('unknown component Q5')));
  assert.deepEqual(d.nets[0].nodes, [{ ref: 'U1', pin: '8' }]);
});
