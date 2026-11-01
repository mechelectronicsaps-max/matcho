// 3D-printing technologies and materials shown on the service pages (with key properties for customers).
// Prices per cm³ (industrial) or per gram (FDM) come from Master → Settings → Services (rate keys below).
// Property values are typical datasheet figures — edit them here to match your print partner.

export const TECH = {
  sla: { name: 'SLA (Resin)', family: 'resin', build: [300, 300, 300], min_wall: 1.2, thinnest: 0.8 },
  mjf: { name: 'MJF (Nylon)', family: 'nylon', build: [380, 284, 380], min_wall: 1, thinnest: 0.8 },
  slm: { name: 'SLM (Metal)', family: 'metal', build: [250, 250, 300], min_wall: 0.8, thinnest: 0.5 },
  sls: { name: 'SLS (Nylon)', family: 'nylon', build: [300, 300, 300], min_wall: 1, thinnest: 0.8 },
  wjp: { name: 'WJP (Resin)', family: 'resin', build: [490, 390, 200], min_wall: 1, thinnest: 0.6 },
  bj: { name: 'BJ (Metal)', family: 'metal', build: [400, 250, 250], min_wall: 1.5, thinnest: 1 },
};

export const FINISHES = {
  resin: [['standard', 'Standard (supports removed, cured)', 1], ['sanded', 'Sanded smooth', 1.25], ['painted', 'Primed & painted', 1.6]],
  nylon: [['standard', 'Bead-blasted (natural)', 1], ['dyed', 'Dyed black', 1.15], ['smoothed', 'Vapour smoothed', 1.35]],
  metal: [['standard', 'As printed (supports removed)', 1], ['sandblast', 'Sandblasted', 1.1], ['polished', 'Polished', 1.5]],
};

const tolResin = '±0.2 mm (≤100 mm) or ±0.3%';
const tolNylon = '±0.3 mm (≤100 mm) or ±0.3%';
const tolMetal = '±0.2 mm (≤100 mm) or ±0.2%';

/** Industrial 3D printing materials. rate = settings key (₹ per cm³ of part volume). */
export const I3D_MATERIALS = [
  { id: 'sla_standard', tech: 'sla', name: 'Standard White Resin', colours: ['White'], rate: 'sla_standard_per_cm3', hdt: '56 °C', tolerance: tolResin,
    features: 'Cost-effective, good toughness, stable mechanical properties', applications: 'Functional prototypes, snap-fit parts, housings, engineering prototypes, structural components', notes: 'Indoor use recommended; long UV exposure may cause yellowing or property loss.' },
  { id: 'sla_black', tech: 'sla', name: 'Black Resin', colours: ['Black'], rate: 'sla_black_per_cm3', hdt: '52 °C', tolerance: tolResin,
    features: 'Matte black surface, sharp detail, low visible layer lines', applications: 'Consumer product prototypes, display models, enclosures, knobs and covers', notes: 'Not for hot or load-bearing parts.' },
  { id: 'sla_tough', tech: 'sla', name: 'Tough ABS-like Resin', colours: ['Grey'], rate: 'sla_tough_per_cm3', hdt: '60 °C', tolerance: tolResin,
    features: 'High impact strength and elongation, ABS-like behaviour', applications: 'Clips, jigs and fixtures, functional assemblies, drop-test prototypes', notes: 'Slightly softer surface than standard resin.' },
  { id: 'sla_clear', tech: 'sla', name: 'Clear Resin', colours: ['Transparent'], rate: 'sla_clear_per_cm3', hdt: '50 °C', tolerance: tolResin,
    features: 'Translucent; can be polished and lacquered to near-glass clarity', applications: 'Light pipes, lenses and covers, fluid-flow models, show parts', notes: 'Polishing for full clarity is quoted separately; slight yellow tint may develop over time.' },
  { id: 'sla_hightemp', tech: 'sla', name: 'High-Temperature Resin', colours: ['Amber'], rate: 'sla_hightemp_per_cm3', hdt: '120 °C', tolerance: tolResin,
    features: 'Heat resistant and very rigid', applications: 'Hot-air and hot-fluid parts, small moulds, heat-test fixtures', notes: 'Brittle — avoid thin snap-fits and living hinges.' },
  { id: 'mjf_nylon', tech: 'mjf', name: 'Nylon PA12 (MJF)', colours: ['Grey', 'Black'], rate: 'mjf_nylon_per_cm3', hdt: '175 °C (0.45 MPa)', tolerance: tolNylon,
    features: 'Production-grade, near-isotropic strength, fine detail, no support marks', applications: 'End-use parts, housings, brackets, ducts, small production batches', notes: 'Natural colour is grey; black parts are dyed.' },
  { id: 'mjf_pa11', tech: 'mjf', name: 'Nylon PA11 (MJF)', colours: ['Grey', 'Black'], rate: 'mjf_pa11_per_cm3', hdt: '185 °C (0.45 MPa)', tolerance: tolNylon,
    features: 'Ductile and impact resistant, bio-based', applications: 'Snap-fits, living hinges, orthotics, parts that must bend without breaking', notes: 'Slightly longer lead time than PA12.' },
  { id: 'sls_nylon', tech: 'sls', name: 'Nylon PA12 (SLS)', colours: ['White', 'Black'], rate: 'sls_nylon_per_cm3', hdt: '171 °C (0.45 MPa)', tolerance: tolNylon,
    features: 'Strong and light, no supports needed — complex and interlocking shapes possible', applications: 'Functional prototypes, drone and robot parts, ducts, enclosures', notes: 'Slightly grainy surface; vapour smoothing available.' },
  { id: 'sls_pa12gf', tech: 'sls', name: 'Glass-filled Nylon PA12-GF', colours: ['Off-white'], rate: 'sls_pa12gf_per_cm3', hdt: '178 °C (0.45 MPa)', tolerance: tolNylon,
    features: 'Stiff, dimensionally stable, good heat resistance', applications: 'Brackets and housings under load, automotive prototypes, tooling', notes: 'Less flexible than plain PA12.' },
  { id: 'slm_ss316l', tech: 'slm', name: 'Stainless Steel 316L', colours: ['Metallic'], rate: 'slm_ss316l_per_cm3', hdt: 'Melts ~1,400 °C', tolerance: tolMetal,
    features: 'Fully dense, corrosion resistant, weldable', applications: 'Food and medical tools, marine parts, manifolds, small mechanical parts', notes: 'Supports are removed by hand/EDM; min wall 0.8 mm.' },
  { id: 'slm_alsi10mg', tech: 'slm', name: 'Aluminium AlSi10Mg', colours: ['Metallic'], rate: 'slm_alsi10mg_per_cm3', hdt: 'Melts ~570 °C', tolerance: tolMetal,
    features: 'Light, strong, good thermal conductivity', applications: 'Heat sinks, drone frames, brackets, housings', notes: 'Heat treatment available on request.' },
  { id: 'slm_ti64', tech: 'slm', name: 'Titanium Ti6Al4V', colours: ['Metallic'], rate: 'slm_ti64_per_cm3', hdt: 'Melts ~1,600 °C', tolerance: tolMetal,
    features: 'Highest strength-to-weight, biocompatible', applications: 'Aerospace and racing parts, implants (prototype), high-load brackets', notes: 'Longer lead time; final price after design review.' },
  { id: 'wjp_rigid', tech: 'wjp', name: 'Multi-jet Rigid Resin', colours: ['White', 'Translucent'], rate: 'wjp_rigid_per_cm3', hdt: '45 °C', tolerance: '±0.1 mm (≤100 mm) or ±0.2%',
    features: 'Ultra-smooth surface, 16–32 µm layers, very fine features', applications: 'Visual prototypes, small precise parts, jewellery masters, miniatures', notes: 'Not for functional loads or heat.' },
  { id: 'wjp_colour', tech: 'wjp', name: 'Full-colour Resin', colours: ['Full colour (from file)'], rate: 'wjp_colour_per_cm3', hdt: '45 °C', tolerance: '±0.1 mm (≤100 mm) or ±0.2%',
    features: 'Prints colours and textures from your 3MF / OBJ file', applications: 'Product mock-ups, architectural and medical models, figurines', notes: 'Upload a coloured 3MF or OBJ; STL has no colour.' },
  { id: 'bj_ss316l', tech: 'bj', name: 'Stainless Steel 316L (Binder Jet)', colours: ['Metallic'], rate: 'bj_ss316l_per_cm3', hdt: 'Melts ~1,400 °C', tolerance: '±0.5 mm (≤100 mm) or ±1%',
    features: 'Lower-cost metal parts without supports, sintered', applications: 'Batches of small metal parts, decorative and consumer metal parts', notes: 'Parts shrink during sintering — keep walls 1.5 mm or more.' },
];

/** FDM materials: rate key (₹/g) and density (g/cm³) used to turn a model's volume into grams. */
export const FDM_MATERIALS = [
  { id: 'pla', name: 'PLA', colours: ['Black', 'White', 'Grey', 'Red', 'Blue', 'Yellow', 'Green', 'Orange'], rate: 'pla_per_g', density: 1.24, hdt: '55 °C', tolerance: '±0.3 mm (≤100 mm) or ±0.5%',
    features: 'Easy to print, crisp detail, many colours, low cost', applications: 'School and DIY projects, display models, robot bodies, enclosures', notes: 'Softens in hot cars or direct sun — use PETG or ABS for heat.' },
  { id: 'petg', name: 'PETG', colours: ['Black', 'White', 'Transparent', 'Blue'], rate: 'petg_per_g', density: 1.27, hdt: '70 °C', tolerance: '±0.3 mm (≤100 mm) or ±0.5%',
    features: 'Tough, slightly flexible, moisture and chemical resistant', applications: 'Outdoor parts, brackets, mechanical parts, food-contact-style containers (not certified)', notes: 'Slightly glossy surface; fine stringing may need cleaning.' },
  { id: 'abs', name: 'ABS', colours: ['Black', 'White', 'Grey'], rate: 'abs_per_g', density: 1.04, hdt: '95 °C', tolerance: '±0.4 mm (≤100 mm) or ±0.6%',
    features: 'Strong, heat resistant, can be sanded and acetone-smoothed', applications: 'Automotive and electronics enclosures, functional parts, jigs', notes: 'Large flat parts may warp slightly.' },
  { id: 'tpu', name: 'TPU (flexible)', colours: ['Black', 'White', 'Red'], rate: 'tpu_per_g', density: 1.21, hdt: '60 °C', tolerance: '±0.5 mm',
    features: 'Rubber-like, flexible, wear and impact resistant (Shore 95A)', applications: 'Drone bumpers, gaskets, grips, wheels and tyres, phone cases', notes: 'Fine details and overhangs are limited.' },
];
export const FDM_BUILD = [250, 250, 250];


/** Does a part (bounding box) fit a build volume in any orientation? */
export function fits(size, build) {
  const a = [...size].sort((x, y) => x - y); const b = [...build].sort((x, y) => x - y);
  return a.every((v, i) => v <= b[i]);
}
