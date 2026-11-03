import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { listComponents } from './library/components.js';
import { searchFootprints, getFootprint, footprintCategories, loadFootprints } from './library/footprints.js';
import { renderFootprintSvg } from './export/pcbSvg.js';
import { exportKicadMod } from './export/kicad.js';
import { designFromPrompt, aiAvailable, keyProblem } from './ai/designer.js';
import { validateDesign } from './engine/design.js';
import { runPipeline, bundleAll } from './engine/pipeline.js';
import { TEMPLATES } from './ai/templates.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(here, '..', 'public')));

// results kept in memory for downloads (most recent 50)
const results = new Map();
function remember(result) {
  const id = crypto.randomUUID();
  results.set(id, result);
  while (results.size > 50) results.delete(results.keys().next().value);
  return id;
}
const publicResult = (id, r) => ({ id, base: r.base, design: r.design, errors: r.errors, warnings: r.warnings, schematicSvg: r.schematicSvg, pcbSvg: r.pcbSvg, pcbStats: r.pcbStats, bom: r.bom, files: Object.keys(r.files) });

app.get('/api/status', (req, res) => {
  res.json({ ai: aiAvailable(), model: process.env.CLAUDE_MODEL || 'claude-opus-5-5', footprints: loadFootprints().length, components: listComponents().length, examples: TEMPLATES.map((t) => t.design.title) });
});

app.get('/api/components', (req, res) => {
  res.json(listComponents().map(({ id, name, category, description, refPrefix, pins, footprints, valueDefault }) => ({ id, name, category, description, refPrefix, pins, footprints, valueDefault })));
});

app.get('/api/footprints', (req, res) => {
  const { q = '', category = '', limit = '300' } = req.query;
  const list = searchFootprints(String(q), String(category), Math.min(2000, Number(limit) || 300));
  res.json({ categories: footprintCategories(), total: loadFootprints().length, items: list.map((f) => ({ name: f.name, category: f.category, description: f.description, pads: f.pads.length, size: [+(f.bbox.maxX - f.bbox.minX).toFixed(2), +(f.bbox.maxY - f.bbox.minY).toFixed(2)] })) });
});

app.get('/api/footprints/:name/svg', (req, res) => {
  const fp = getFootprint(req.params.name);
  if (!fp) return res.status(404).send('not found');
  res.type('image/svg+xml').send(renderFootprintSvg(fp));
});

app.get('/api/footprints/:name/kicad_mod', (req, res) => {
  const fp = getFootprint(req.params.name);
  if (!fp) return res.status(404).send('not found');
  res.attachment(`${fp.name}.kicad_mod`).type('text/plain').send(exportKicadMod(fp));
});

// Prompt -> design. Streams NDJSON: {type:"progress"} lines then {type:"result"} or {type:"error"}.
app.post('/api/design', async (req, res) => {
  const prompt = String(req.body?.prompt ?? '').trim();
  if (!prompt) return res.status(400).json({ error: 'prompt is required' });
  res.setHeader('Content-Type', 'application/x-ndjson');
  const send = (o) => res.write(JSON.stringify(o) + '\n');
  try {
    const { design, source } = await designFromPrompt(prompt, (p) => send({ type: 'progress', ...p }));
    if (design.errors.length && !design.components.length) throw new Error(`The design is invalid: ${design.errors.join('; ')}`);
    send({ type: 'progress', stage: 'layout', message: 'Drawing schematic, placing and routing the PCB...' });
    const result = runPipeline(design);
    const id = remember(result);
    send({ type: 'result', source, ...publicResult(id, result) });
  } catch (e) {
    console.error(e);
    send({ type: 'error', error: e.message || String(e) });
  }
  res.end();
});

// Re-run the engine on an edited design JSON (no AI involved).
app.post('/api/render', (req, res) => {
  try {
    const design = validateDesign(req.body?.design ?? {});
    if (!design.components.length) return res.status(400).json({ error: 'No valid components', errors: design.errors });
    const result = runPipeline(design);
    res.json(publicResult(remember(result), result));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/results/:id/files/:file', (req, res) => {
  const r = results.get(req.params.id);
  if (!r) return res.status(404).send('Result expired, generate again.');
  if (req.params.file === 'all.zip') return res.attachment(`${r.base}-all.zip`).type('application/zip').send(bundleAll(r));
  const content = r.files[req.params.file];
  if (content === undefined) return res.status(404).send('not found');
  res.attachment(req.params.file).send(content);
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Circuit Designer running on http://localhost:${port}`);
  const problem = keyProblem();
  if (aiAvailable() && !problem) console.log(`AI design enabled (${process.env.CLAUDE_MODEL || 'claude-opus-5-5'})`);
  else console.log(`${problem} ${aiAvailable() ? 'Requests to Claude will probably fail.' : 'Running in offline mode with built-in example designs.'}`);
  for (const v of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN']) if (process.env[v]) console.log(`Note: ${v} is set in this shell; it can redirect or override API requests.`);
});
