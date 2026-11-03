#!/usr/bin/env node
// Import KiCad footprint libraries into data/footprints.imported.json.
// Usage: npm run import-kicad -- /path/to/kicad-footprints [more dirs...]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kicadModToFootprint } from '../src/library/kicadImport.js';
import { computeBBox } from '../src/library/footprints.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dirs = process.argv.slice(2);
if (!dirs.length) {
  console.error('Usage: npm run import-kicad -- /path/to/kicad-footprints');
  console.error('Get the library: git clone --depth 1 https://gitlab.com/kicad/libraries/kicad-footprints.git');
  process.exit(1);
}

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.kicad_mod')) yield p;
  }
}

const out = [];
let failed = 0;
for (const d of dirs) {
  for (const file of walk(d)) {
    const lib = path.basename(path.dirname(file)).replace(/\.pretty$/, '');
    try {
      const fp = kicadModToFootprint(fs.readFileSync(file, 'utf8'), lib);
      if (!fp.pads.length) continue;
      fp.bbox = computeBBox(fp);
      out.push(fp);
    } catch (e) {
      failed++;
      if (failed < 10) console.warn(`skip ${file}: ${e.message}`);
    }
  }
}
const dest = path.join(here, '..', 'data', 'footprints.imported.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`Imported ${out.length} footprints (${failed} failed) -> ${path.relative(process.cwd(), dest)}`);
