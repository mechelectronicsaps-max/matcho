# Circuit Designer

A Node.js web app: describe a circuit in plain language and it generates a
**schematic**, a **routed 2-layer PCB layout**, a **BOM**, a **KiCad project
(`.kicad_pcb` + netlist)** and **Gerber/drill files** ready for a PCB fab.

```
prompt ──► Claude (picks parts + writes netlist as JSON)
        ──► validator (parts, pins, footprints) ──► repair loop if errors
        ──► schematic SVG
        ──► auto-placement ──► 2-layer maze router
        ──► KiCad .kicad_pcb / .net, Gerbers + Excellon, BOM CSV, previews
```

## Quick start

```bash
cd circuit-designer
npm install
```

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # optional, see below
npm start                            # http://localhost:3000
```

Without `ANTHROPIC_API_KEY` the app runs in **offline demo mode**: prompts are
matched to four built-in reference designs (555 flasher, USB-C 3.3 V supply,
ESP32 dev board, relay driver) so you can try the whole pipeline. With a key,
any circuit the parts library can build is designed by Claude
(`CLAUDE_MODEL` overrides the default `claude-opus-5-5`).

Run the tests with `npm test`.

## What you get per design

| Output | Use it for |
| --- | --- |
| Schematic (SVG) | Review; pins with the same net label are connected |
| PCB preview (SVG) | Layer toggles, pan/zoom, unrouted ratsnest in yellow |
| `*.kicad_pcb` | Open in KiCad 7/8/9 to review, run DRC, finish routing, add a ground pour |
| `*.net` | KiCad netlist, import into an existing board |
| `*-gerbers.zip` | Copper, mask, paste, silkscreen, outline + Excellon drill (upload to JLCPCB/PCBWay/OSH Park) |
| `*-bom.csv` | Ordering parts |
| `*.design.json` | The netlist the engine used; edit it in the UI and re-render without the AI |

## Footprint library

`src/library/footprints.js` generates ~300 footprints from parametric package
families: chip passives 0201–2512, SOD/SMA/SMB, SOT-23/-5/-6, SOT-223, DPAK,
TO-92, TO-220, SOIC/SOIC-W/MSOP/TSSOP/SSOP, QFN 16–64, TQFP/LQFP 32–144,
DIP 4–48, pin headers 1xN/2xN, JST XH/PH, terminal blocks, USB-C, Micro-USB,
barrel jack, switches, crystals, relays, ESP32-WROOM-32 and more.

To have the **full official KiCad library (~14,000 footprints)** in the
browser:

```bash
git clone --depth 1 https://gitlab.com/kicad/libraries/kicad-footprints.git
```

```bash
npm run import-kicad -- ./kicad-footprints
```

This writes `data/footprints.imported.json` (gitignored; the KiCad libraries
are CC-BY-SA 4.0 with an exception for designs that use them).

## Parts library

`src/library/components.js` defines ~70 parts with schematic symbol, pinout
and allowed footprints: passives, diodes/LEDs, BJTs/MOSFETs, LDOs and a boost
converter, Li-ion charger, 555, op-amps, shift register, Darlington driver,
optocoupler, ATmega328P, ESP32-WROOM-32, CH340C, USB-C, connectors and more.
The AI may only use these parts, which keeps every pin-to-pad mapping correct.
Add a part by adding one entry (pins must match the footprint's pad numbers;
`npm test` checks this).

## How the PCB engine works

- **Placement** (`src/engine/pcb.js`): largest parts first, every other part
  tried at all positions on a 0.5 mm grid in 4 rotations, scored by distance
  to already-placed pads on the same nets plus board size.
- **Routing**: A* on a 0.25 mm grid, 2 layers, 8 directions, turn penalties,
  top-horizontal / bottom-vertical preference, vias, clearance halos around
  pads and tracks, 0.5 mm power traces that neck down to 0.25 mm at fine-pitch
  pads, keep-out areas (module antennas). Several net orderings plus a
  rip-up pass; the best result is kept. Anything unrouted is listed and drawn
  as ratsnest.
- Default rules: 0.25 mm track, 0.15 mm clearance, 0.6/0.3 mm vias - within
  the standard capabilities of low-cost fabs.

## Limitations (review before ordering boards)

- Treat every output as a draft: open the `.kicad_pcb` in KiCad, run DRC and
  check footprints against the datasheets.
- No copper pours (route GND as tracks; add a pour in KiCad).
- Silkscreen reference text is not in the Gerbers (it is in the KiCad file).
- Dense boards may finish with a few unrouted connections (e.g. the
  interleaved USB-C D+/D- pins), which you complete by hand in KiCad.
- No SPICE simulation or electrical rule checking beyond pin/net validation.

## Layout

```
src/server.js              Express API + static UI
src/ai/designer.js         Claude call (structured JSON output) + repair loop
src/ai/templates.js        Built-in reference designs (offline mode, AI example)
src/library/               Footprints, parts, KiCad .kicad_mod importer
src/engine/design.js       Netlist validation
src/engine/schematic.js    Schematic SVG
src/engine/pcb.js          Placement + router
src/export/                KiCad, Gerber/Excellon, BOM, ZIP, SVG previews
public/                    Browser UI
```

## API

- `POST /api/design` `{ "prompt": "..." }` - streams NDJSON progress, then the result
- `POST /api/render` `{ "design": {...} }` - re-run the engine on an edited design
- `GET /api/results/:id/files/:file` - downloads (`all.zip` for everything)
- `GET /api/footprints?q=&category=` - search; `/api/footprints/:name/svg`, `/kicad_mod`
- `GET /api/components`, `GET /api/status`
