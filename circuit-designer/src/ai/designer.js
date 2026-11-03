// Prompt -> circuit design. Claude picks parts from the component library,
// assigns footprints and writes the netlist as structured JSON; the engine
// validates it and sends any errors back for one or two repair rounds.

import Anthropic from '@anthropic-ai/sdk';
import { catalogText } from '../library/components.js';
import { validateDesign } from '../engine/design.js';
import { pickTemplate, TEMPLATES } from './templates.js';

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const MAX_REPAIRS = 2;

const DESIGN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'components', 'nets', 'no_connect', 'notes'],
  properties: {
    title: { type: 'string', description: 'Short name of the circuit' },
    summary: { type: 'string', description: 'One paragraph describing how the circuit works' },
    components: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ref', 'part', 'value', 'footprint', 'purpose'],
        properties: {
          ref: { type: 'string', description: 'Reference designator, e.g. R1, C3, U1' },
          part: { type: 'string', description: 'Part id from the catalog' },
          value: { type: 'string', description: 'Value or part number, e.g. 10k, 100nF, NE555' },
          footprint: { type: 'string', description: 'One of the footprints listed for the part' },
          purpose: { type: 'string', description: 'Why this part is there' },
        },
      },
    },
    nets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'pins'],
        properties: {
          name: { type: 'string', description: 'Net name, e.g. GND, +3V3, VBUS, SDA' },
          pins: { type: 'array', items: { type: 'string' }, description: 'Nodes as REF.PIN_NUMBER, e.g. U1.8' },
        },
      },
    },
    no_connect: { type: 'array', items: { type: 'string' }, description: 'Pins intentionally left unconnected, REF.PIN_NUMBER' },
    notes: { type: 'array', items: { type: 'string' }, description: 'Design notes, assumptions and things the user must check' },
  },
};

const SYSTEM = `You are an expert electronics engineer who designs complete, buildable circuits for a PCB design tool.
The user describes what they want; you return a complete design as JSON: components and the netlist.
The tool then draws the schematic, places and routes a 2-layer PCB and exports KiCad files and Gerbers.

Rules:
- Use ONLY parts from the catalog below. "part" must be a catalog id exactly. Generic passives (R, C, C_POL, L, LED, D ...) take their value in "value".
- "footprint" must be one of the footprints listed for that part. Prefer SMD 0603/0805 passives unless the user asks for through-hole, a breadboard-friendly or beginner build.
- Nets list nodes as REF.PIN using pin NUMBERS from the catalog (e.g. "U1.8", "J1.A4"). A pin may appear in only one net.
- Name power nets clearly: GND, VBUS, VIN, +5V, +3V3, +12V. Name signal nets by function (SDA, LED_A, EN ...).
- Make the design complete and correct: input power connector or battery, protection where sensible, regulators with their required input/output capacitors, 100nF decoupling on every IC supply pin, pull-ups/pull-downs, current-limiting resistors for LEDs, flyback diodes for inductive loads, crystals with load capacitors, programming/debug headers for MCUs, and connectors for every external signal the user mentions.
- Respect each part's notes in the catalog (pin functions, required support parts).
- Every pin must be on a net or listed in no_connect (unused MCU pins go in no_connect, or to a header if useful).
- Compute component values (resistor dividers, LED resistors, timing, gain, regulator feedback) and explain them briefly in "notes".
- If the request needs a part the catalog does not have, build the closest working circuit from available parts and explain the substitution in "notes".
- Use sequential reference designators per prefix given in the catalog (R1, R2, C1, U1, J1 ...).

Catalog (id | category | description | default value | pins | footprints):
${catalogText()}

Example of a correct design (555 LED flasher):
${JSON.stringify(TEMPLATES[0].design)}`;

let client = null;

/** API key from the environment, with stray quotes/whitespace removed. */
function apiKey() {
  return String(process.env.ANTHROPIC_API_KEY ?? '').trim().replace(/^['"]|['"]$/g, '').trim();
}

export function aiAvailable() {
  const k = apiKey();
  return Boolean(k) && !/your[-_]?key/i.test(k);
}

export function keyProblem() {
  const k = apiKey();
  if (!k) return 'ANTHROPIC_API_KEY is not set.';
  if (/your[-_]?key/i.test(k)) return 'ANTHROPIC_API_KEY still contains the example placeholder; paste your real key.';
  if (!k.startsWith('sk-ant-')) return 'ANTHROPIC_API_KEY does not look like an Anthropic API key (they start with "sk-ant-").';
  return null;
}

function getClient() {
  // Pass the key explicitly so a stray ANTHROPIC_AUTH_TOKEN or login profile is never used instead.
  client ??= new Anthropic({ apiKey: apiKey() });
  return client;
}

async function callClaude(messages) {
  const stream = getClient().beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: { effort: 'high', format: { type: 'json_schema', schema: DESIGN_SCHEMA } },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages,
  });
  let msg;
  try {
    msg = await stream.finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      const k = apiKey();
      throw new Error(`Anthropic rejected the API key (401). Key in use: ${k.slice(0, 10)}...${k.slice(-4)} (${k.length} chars)${process.env.ANTHROPIC_BASE_URL ? `, ANTHROPIC_BASE_URL=${process.env.ANTHROPIC_BASE_URL}` : ''}. Create a new key at https://console.anthropic.com/settings/keys, make sure the account has credits, set it with no quotes or spaces and restart the server.`);
    }
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error('This API key is not allowed to use the model (403). Check your plan, or set CLAUDE_MODEL to a model your account can use.');
    if (e instanceof Anthropic.NotFoundError) throw new Error(`Model "${MODEL}" was not found for this key (404). Set CLAUDE_MODEL to a model your account can use.`);
    if (e instanceof Anthropic.RateLimitError) throw new Error('Rate limited by the Anthropic API (429). Wait a moment and try again.');
    throw e;
  }
  if (msg.stop_reason === 'refusal') throw new Error('The model declined this request.');
  if (msg.stop_reason === 'max_tokens') throw new Error('The design was too large for one response; try a smaller circuit or split it into blocks.');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('The model returned invalid JSON.'); }
  return { msg, json };
}

/**
 * @param {string} prompt user description
 * @param {(e: {stage: string, message: string}) => void} onProgress
 */
export async function designFromPrompt(prompt, onProgress = () => {}) {
  if (!aiAvailable()) {
    const t = pickTemplate(prompt);
    if (!t) {
      throw new Error('No ANTHROPIC_API_KEY is set, so only the built-in demo designs are available. Try a prompt mentioning: 555 flasher, 3.3V USB-C regulator, ESP32 board, or relay driver. Set ANTHROPIC_API_KEY to design any circuit.');
    }
    onProgress({ stage: 'template', message: `Offline mode: using built-in design "${t.design.title}". Set ANTHROPIC_API_KEY for custom designs.` });
    return { raw: t.design, design: validateDesign(t.design), source: 'template' };
  }

  const messages = [{ role: 'user', content: `Design this circuit:\n\n${prompt}` }];
  onProgress({ stage: 'ai', message: `Asking ${MODEL} to design the circuit...` });
  let { msg, json } = await callClaude(messages);
  let design = validateDesign(json);

  for (let i = 0; i < MAX_REPAIRS && design.errors.length; i++) {
    onProgress({ stage: 'repair', message: `Fixing ${design.errors.length} netlist error(s) (round ${i + 1})...` });
    messages.push({ role: 'assistant', content: msg.content });
    messages.push({ role: 'user', content: `The design has these errors. Return the complete corrected design.\n- ${design.errors.join('\n- ')}` });
    ({ msg, json } = await callClaude(messages));
    design = validateDesign(json);
  }
  return { raw: json, design, source: 'ai' };
}
