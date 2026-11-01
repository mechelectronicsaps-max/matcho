// AI Project Builder: the customer describes an idea, Claude picks a parts list from the live
// catalogue and the storefront drops every item into the cart. Without an API key a keyword-based
// planner answers instead, so the feature always works.
import Anthropic from '@anthropic-ai/sdk';
import { all, get, run, getSetting } from '../db.js';

const BUILD_TOOL = {
  name: 'build_cart',
  description: 'Return the bill of materials for the customer\'s project, using only SKUs from the Drovox catalogue.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      project_title: { type: 'string', description: 'Short name for the project' },
      summary: { type: 'string', description: 'Two or three sentences on how the build works' },
      difficulty: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
      est_build_hours: { type: 'integer', description: 'Rough build time in hours' },
      items: {
        type: 'array',
        description: 'Catalogue parts to add to the cart',
        items: {
          type: 'object',
          properties: {
            sku: { type: 'string', description: 'Exact SKU from the catalogue' },
            qty: { type: 'integer', description: 'Quantity for the requested number of builds' },
            reason: { type: 'string', description: 'What this part does in the build' },
          },
          required: ['sku', 'qty', 'reason'],
          additionalProperties: false,
        },
      },
      missing: {
        type: 'array',
        description: 'Parts the build needs that are not in the catalogue',
        items: {
          type: 'object',
          properties: { part: { type: 'string' }, note: { type: 'string' } },
          required: ['part', 'note'],
          additionalProperties: false,
        },
      },
      steps: { type: 'array', items: { type: 'string' }, description: 'Short build steps' },
    },
    required: ['project_title', 'summary', 'difficulty', 'est_build_hours', 'items', 'missing', 'steps'],
    additionalProperties: false,
  },
};

function catalogue() {
  return all(`SELECT p.sku, p.name, c.name cat, p.price, p.stock, p.tags FROM products p LEFT JOIN categories c ON c.id = p.category_id
              WHERE p.active = 1 ORDER BY c.sort, p.name`);
}

function systemPrompt(rows) {
  const lines = rows.map((r) => `${r.sku} | ${r.name} | ${r.cat} | ₹${r.price} | stock ${r.stock} | ${r.tags}`).join('\n');
  return `You are the project engineer for Drovox, an Indian online store for electronics, robotics and maker components.
A customer describes something they want to build. Design a practical parts list from the catalogue below and call the build_cart tool exactly once with it.

Rules:
- Use only SKUs that appear in the catalogue, spelled exactly. Never invent SKUs.
- Prefer in-stock items; never ask for more units than the stock shown.
- Scale quantities to the number of builds the customer mentions (default one).
- Include the small parts people forget: jumper wires, breadboard, power supply/battery, connectors.
- Respect the customer's budget if they give one; choose cheaper alternatives when needed.
- Put anything essential that the catalogue lacks under "missing".
- Keep the summary and steps short and practical. Prices are in INR, GST inclusive.

Catalogue (SKU | name | category | price | stock | tags):
${lines}`;
}

function validate(plan, rows) {
  const bySku = new Map(rows.map((r) => [r.sku.toUpperCase(), r]));
  const items = [];
  for (const it of plan.items || []) {
    const r = bySku.get(String(it.sku).toUpperCase());
    if (!r) { plan.missing = [...(plan.missing || []), { part: it.sku, note: 'Not in our catalogue' }]; continue; }
    const p = get('SELECT id, sku, slug, name, price, stock, image, category_id FROM products WHERE sku = ?', r.sku);
    const qty = Math.max(1, Math.min(Math.floor(Number(it.qty) || 1), p.stock || 1));
    items.push({ product_id: p.id, sku: p.sku, slug: p.slug, name: p.name, price: p.price, image: p.image, category_id: p.category_id, stock: p.stock, qty, reason: it.reason });
  }
  return { ...plan, items, estimated_total: Math.round(items.reduce((s, i) => s + i.price * i.qty, 0)) };
}

async function claudePlan(idea, rows, cfg) {
  const apiKey = cfg.anthropic_api_key || process.env.ANTHROPIC_API_KEY;
  const client = new Anthropic(apiKey ? { apiKey } : {});
  const response = await client.beta.messages.create({
    model: cfg.model || 'claude-opus-5-5',
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    // The catalogue prompt is identical across customers, so it is cached.
    system: [{ type: 'text', text: systemPrompt(rows), cache_control: { type: 'ephemeral' } }],
    tools: [BUILD_TOOL],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: `Project idea: ${idea}\n\nCall build_cart with the parts list.` }],
  });
  if (response.stop_reason === 'refusal') throw new Error('The assistant could not help with this request');
  const block = response.content.find((b) => b.type === 'tool_use' && b.name === 'build_cart');
  if (!block) {
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    throw new Error(text ? `No parts list returned: ${text.slice(0, 200)}` : 'No parts list returned');
  }
  return block.input;
}

// ---- keyword planner (no API key) -----------------------------------------------------------
const RECIPES = [
  { k: ['line follower', 'line-follower', 'line following'], title: 'Line follower robot', skus: ['DRV-ARD-UNO', 'DRV-MD-L298N', 'DRV-SEN-IR5', 'DRV-MOT-BO300', 'DRV-MEC-WHL65', 'DRV-MEC-CHS2WD', 'DRV-PWR-18650', 'DRV-PWR-HLD2S', 'DRV-WIR-JMP40'] },
  { k: ['obstacle', 'avoid'], title: 'Obstacle avoiding robot', skus: ['DRV-ARD-UNO', 'DRV-MD-L298N', 'DRV-SEN-HCSR04', 'DRV-SRV-SG90', 'DRV-MOT-BO300', 'DRV-MEC-WHL65', 'DRV-MEC-CHS2WD', 'DRV-PWR-18650', 'DRV-PWR-HLD2S', 'DRV-WIR-JMP40'] },
  { k: ['drone', 'quadcopter', 'quad'], title: 'Quadcopter drone', skus: ['DRV-DRN-F450', 'DRV-DRN-BLDC2212', 'DRV-DRN-ESC30', 'DRV-DRN-PROP1045', 'DRV-DRN-FC', 'DRV-DRN-LIPO3S', 'DRV-DRN-RX'] },
  { k: ['weather', 'temperature', 'humidity', 'iot', 'home automation', 'smart home'], title: 'IoT weather / home monitor', skus: ['DRV-ESP-32', 'DRV-SEN-DHT22', 'DRV-SEN-BMP280', 'DRV-DSP-OLED096', 'DRV-PRT-BB830', 'DRV-WIR-JMP40', 'DRV-PWR-5V2A'] },
  { k: ['relay', 'switch', 'appliance', 'automation'], title: 'WiFi appliance controller', skus: ['DRV-ESP-32', 'DRV-REL-4CH', 'DRV-PWR-HLK5M05', 'DRV-WIR-JMP40'] },
  { k: ['robotic arm', 'robot arm', 'arm'], title: 'Robotic arm', skus: ['DRV-ARD-UNO', 'DRV-SRV-MG996R', 'DRV-SRV-SG90', 'DRV-MD-PCA9685', 'DRV-PWR-5V2A', 'DRV-WIR-JMP40'] },
  { k: ['3d printer', '3d print'], title: '3D printer upgrade kit', skus: ['DRV-STP-NEMA17', 'DRV-STP-A4988', 'DRV-3DP-PLA', 'DRV-PWR-12V5A'] },
  { k: ['camera', 'surveillance', 'cctv', 'face'], title: 'WiFi camera', skus: ['DRV-ESP-CAM', 'DRV-PRT-FTDI', 'DRV-PWR-5V2A', 'DRV-WIR-JMP40'] },
  { k: ['raspberry', 'pi', 'linux', 'ai camera'], title: 'Raspberry Pi project', skus: ['DRV-RPI-5-4G', 'DRV-PWR-5V2A', 'DRV-WIR-JMP40', 'DRV-PRT-BB830'] },
  { k: ['led', 'neopixel', 'light', 'rgb'], title: 'Addressable LED light show', skus: ['DRV-ESP-32', 'DRV-LED-WS2812', 'DRV-PWR-5V2A', 'DRV-WIR-JMP40'] },
  { k: ['gps', 'tracker', 'vehicle'], title: 'GPS tracker', skus: ['DRV-ESP-32', 'DRV-SEN-GPS6M', 'DRV-PWR-18650', 'DRV-WIR-JMP40'] },
  { k: ['plant', 'soil', 'garden', 'irrigation'], title: 'Smart plant watering', skus: ['DRV-ESP-32', 'DRV-SEN-SOIL', 'DRV-REL-4CH', 'DRV-MOT-PUMP', 'DRV-PWR-5V2A', 'DRV-WIR-JMP40'] },
];

function keywordPlan(idea, rows) {
  const text = idea.toLowerCase();
  const qtyMatch = text.match(/\b(\d{1,3})\s*(?:x\s*)?(?:[a-z-]+\s+){0,3}(units|pcs|pieces|robots?|drones?|kits?|sets?|builds?|nos|devices?|cars?|arms?|stations?|nodes?)\b/);
  const builds = qtyMatch ? Math.min(50, Number(qtyMatch[1])) : 1;
  const recipe = RECIPES.find((r) => r.k.some((k) => text.includes(k)));
  const skus = new Set(rows.map((r) => r.sku));
  let picks = recipe ? recipe.skus.filter((s) => skus.has(s)) : [];
  if (!picks.length) {
    const words = text.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    picks = rows.map((r) => ({ sku: r.sku, s: words.filter((w) => `${r.name} ${r.tags}`.toLowerCase().includes(w)).length }))
      .filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 6).map((x) => x.sku);
    if (picks.length) picks.push('DRV-WIR-JMP40');
  }
  return {
    project_title: recipe?.title || 'Your custom build',
    summary: recipe ? `A starter bill of materials for a ${recipe.title.toLowerCase()}. Review quantities before checkout.` : 'Parts matched to the words in your idea. Add an AI key in Master → Settings for a fully designed build.',
    difficulty: 'intermediate', est_build_hours: recipe ? 4 : 2,
    items: [...new Set(picks)].map((sku) => ({ sku, qty: (sku.includes('BO300') || sku.includes('WHL65') ? 2 : sku.includes('BLDC') || sku.includes('ESC') ? 4 : sku.includes('PROP') ? 2 : sku.includes('18650') ? 2 : 1) * builds, reason: 'Matched to your project' })),
    missing: [], steps: recipe ? ['Assemble the chassis/frame', 'Wire the controller, driver and sensors', 'Upload the starter sketch', 'Test and tune'] : [],
  };
}

export async function buildProject(idea, user) {
  const cfg = getSetting('ai');
  const rows = catalogue();
  let plan; let engine = 'claude';
  const haveKey = !!(cfg.anthropic_api_key || process.env.ANTHROPIC_API_KEY);
  if (cfg.enabled && haveKey) {
    try { plan = await claudePlan(idea, rows, cfg); } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) console.error('[ai] invalid Anthropic API key');
      else if (e instanceof Anthropic.RateLimitError) console.error('[ai] rate limited');
      else if (e instanceof Anthropic.APIError) console.error(`[ai] API error ${e.status}: ${e.message}`);
      else console.error('[ai]', e.message);
      plan = null;
    }
  }
  if (!plan) { plan = keywordPlan(idea, rows); engine = 'keyword'; }
  const result = validate(plan, rows);
  result.engine = engine;
  run('INSERT INTO ai_sessions(user_id, idea, result, engine) VALUES (?,?,?,?)', user?.id ?? null, idea, JSON.stringify(result), engine);
  return result;
}
