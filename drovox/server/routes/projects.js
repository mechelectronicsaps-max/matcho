// DIY projects: ready-made school / maker projects with a parts list from the catalogue. Customers browse them
// and add the whole kit to the cart in one click; the stock team creates and edits them in the stockist panel.
import express from 'express';
import { all, get, run } from '../db.js';
import { requireArea, audit } from '../auth.js';
import { saveImage, deleteImage, parseImages, MAX_IMAGES } from '../images.js';

export const CATEGORIES = ['Robotics', 'IoT & Smart Home', 'Arduino Basics', 'School Science', 'Drones & RC', 'Electronics Basics', 'Sensors & Measurement', 'Raspberry Pi & AI', 'Renewable Energy'];
export const LEVELS = ['beginner', 'intermediate', 'advanced'];

const J = (v, d = []) => { try { const x = JSON.parse(v || ''); return x ?? d; } catch { return d; } };
const slugify = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 70) || 'project';
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

/** Parts list with live product data, plus kit totals. */
function withParts(p) {
  const items = J(p.items);
  const ids = items.map((i) => i.product_id);
  const rows = ids.length ? all(`SELECT id, sku, slug, name, price, mrp, stock, image, images, category_id, active FROM products WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids) : [];
  const by = new Map(rows.map((r) => [r.id, r]));
  const parts = items.map((i) => { const r = by.get(i.product_id); if (!r || !r.active) return null; const { images, ...rest } = r; return { ...rest, img: parseImages(images)[0] || null, qty: i.qty, note: i.note || '' }; }).filter(Boolean);
  const kit = parts.reduce((s, x) => s + x.price * x.qty, 0); const mrp = parts.reduce((s, x) => s + Math.max(x.mrp, x.price) * x.qty, 0);
  return { parts, kit_price: Math.round(kit * 100) / 100, kit_mrp: Math.round(mrp * 100) / 100, in_stock: parts.every((x) => x.stock >= x.qty), missing: items.length - parts.length };
}
function shape(p, full = false) {
  const k = withParts(p);
  const base = {
    id: p.id, title: p.title, slug: p.slug, category: p.category, level: p.level, audience: p.audience, build_hours: p.build_hours,
    summary: p.summary, images: parseImages(p.images), img: parseImages(p.images)[0] || null, featured: !!p.featured, active: !!p.active,
    tags: p.tags, views: p.views, kits_added: p.kits_added, parts_count: k.parts.length, kit_price: k.kit_price, kit_mrp: k.kit_mrp, in_stock: k.in_stock,
  };
  return full ? { ...base, description: p.description, steps: J(p.steps), learn: J(p.learn), video_url: p.video_url, code_url: p.code_url, parts: k.parts, missing: k.missing } : base;
}

// ---- public -----------------------------------------------------------------------------------
export const projects = express.Router();
projects.get('/projects', (req, res) => {
  const q = String(req.query.q || '').trim(); const cat = String(req.query.category || ''); const level = String(req.query.level || '');
  const where = ['active = 1']; const args = [];
  if (q) { where.push('(title LIKE ? OR summary LIKE ? OR tags LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (CATEGORIES.includes(cat)) { where.push('category = ?'); args.push(cat); }
  if (LEVELS.includes(level)) { where.push('level = ?'); args.push(level); }
  const sort = { popular: 'kits_added DESC, views DESC', newest: 'id DESC', time: 'build_hours ASC' }[req.query.sort] || 'featured DESC, kits_added DESC, views DESC, id DESC';
  const rows = all(`SELECT * FROM diy_projects WHERE ${where.join(' AND ')} ORDER BY ${sort} LIMIT 200`, ...args).map((p) => shape(p));
  const counts = Object.fromEntries(all('SELECT category, COUNT(*) n FROM diy_projects WHERE active = 1 GROUP BY category').map((r) => [r.category, r.n]));
  res.json({ rows, categories: CATEGORIES, levels: LEVELS, counts });
});
projects.get('/projects/:slug', (req, res) => {
  const p = get('SELECT * FROM diy_projects WHERE slug = ? AND active = 1', req.params.slug);
  if (!p) return res.status(404).json({ error: 'Project not found' });
  run('UPDATE diy_projects SET views = views + 1 WHERE id = ?', p.id);
  const related = all('SELECT * FROM diy_projects WHERE active = 1 AND id != ? AND category = ? ORDER BY kits_added DESC LIMIT 4', p.id, p.category).map((x) => shape(x));
  res.json({ ...shape(p, true), related });
});
projects.post('/projects/:slug/kit', (req, res) => {   // counts "add whole kit to cart" for popularity
  const r = run('UPDATE diy_projects SET kits_added = kits_added + 1 WHERE slug = ? AND active = 1', req.params.slug);
  res.json({ ok: r.changes > 0 });
});

// ---- stock panel ------------------------------------------------------------------------------
export const projectsStaff = express.Router();
projectsStaff.use(requireArea('stock'));

function fields(b, old = {}) {
  const lines = (v, max, len) => (Array.isArray(v) ? v : String(v ?? '').split('\n')).map((x) => String(x).trim().slice(0, len)).filter(Boolean).slice(0, max);
  const items = (Array.isArray(b.items) ? b.items : J(old.items)).map((i) => ({ product_id: Number(i.product_id), qty: Math.max(1, Math.min(999, Math.floor(Number(i.qty) || 1))), note: String(i.note || '').slice(0, 120) }))
    .filter((i) => i.product_id > 0);
  const seen = new Set(); const uniq = items.filter((i) => (seen.has(i.product_id) ? false : seen.add(i.product_id)));
  if (uniq.length) { const found = all(`SELECT id FROM products WHERE id IN (${uniq.map(() => '?').join(',')})`, ...uniq.map((i) => i.product_id)).length; if (found !== uniq.length) throw bad('One of the parts is not in the catalogue'); }
  const f = {
    title: String(b.title ?? old.title ?? '').trim().slice(0, 140),
    category: CATEGORIES.includes(b.category) ? b.category : (old.category || CATEGORIES[0]),
    level: LEVELS.includes(b.level) ? b.level : (old.level || 'beginner'),
    audience: String(b.audience ?? old.audience ?? '').slice(0, 60),
    build_hours: Math.max(0.5, Math.min(200, Number(b.build_hours ?? old.build_hours) || 2)),
    summary: String(b.summary ?? old.summary ?? '').trim().slice(0, 500), description: String(b.description ?? old.description ?? '').slice(0, 8000),
    steps: JSON.stringify(b.steps !== undefined ? lines(b.steps, 40, 600) : J(old.steps)), learn: JSON.stringify(b.learn !== undefined ? lines(b.learn, 12, 120) : J(old.learn)),
    items: JSON.stringify(uniq),
    video_url: /^https?:\/\//.test(String(b.video_url ?? old.video_url ?? '')) ? String(b.video_url ?? old.video_url).slice(0, 300) : null,
    code_url: /^https?:\/\//.test(String(b.code_url ?? old.code_url ?? '')) ? String(b.code_url ?? old.code_url).slice(0, 300) : null,
    tags: String(b.tags ?? old.tags ?? '').slice(0, 300),
    featured: (b.featured ?? old.featured) ? 1 : 0, active: (b.active ?? old.active ?? 1) ? 1 : 0,
  };
  if (!f.title) throw bad('Give the project a title');
  return f;
}
const COLS = ['title', 'category', 'level', 'audience', 'build_hours', 'summary', 'description', 'steps', 'learn', 'items', 'video_url', 'code_url', 'tags', 'featured', 'active'];

projectsStaff.get('/', (_req, res) => res.json({ rows: all('SELECT * FROM diy_projects ORDER BY id DESC').map((p) => ({ ...shape(p), active: !!p.active })), categories: CATEGORIES, levels: LEVELS }));
projectsStaff.get('/:id', (req, res) => {
  const p = get('SELECT * FROM diy_projects WHERE id = ?', req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json({ ...shape(p, true), items: J(p.items), tags: p.tags });
});
projectsStaff.post('/', (req, res, next) => {
  try {
    const f = fields(req.body || {});
    let slug = slugify(f.title); for (let i = 2; get('SELECT 1 FROM diy_projects WHERE slug = ?', slug); i++) slug = `${slugify(f.title)}-${i}`;
    const r = run(`INSERT INTO diy_projects(${COLS.join(', ')}, slug, created_by) VALUES (${COLS.map(() => '?').join(', ')}, ?, ?)`, ...COLS.map((c) => f[c]), slug, req.user.id);
    audit(req, 'project.create', 'project', slug, { parts: JSON.parse(f.items).length });
    res.json({ id: Number(r.lastInsertRowid), slug });
  } catch (e) { next(e); }
});
projectsStaff.put('/:id', (req, res, next) => {
  try {
    const old = get('SELECT * FROM diy_projects WHERE id = ?', req.params.id);
    if (!old) return res.status(404).json({ error: 'Not found' });
    const f = fields(req.body || {}, old);
    run(`UPDATE diy_projects SET ${COLS.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`, ...COLS.map((c) => f[c]), old.id);
    audit(req, 'project.update', 'project', old.slug, {});
    res.json({ id: old.id, slug: old.slug });
  } catch (e) { next(e); }
});
projectsStaff.delete('/:id', (req, res) => {
  const p = get('SELECT * FROM diy_projects WHERE id = ?', req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  parseImages(p.images).forEach(deleteImage);
  run('DELETE FROM diy_projects WHERE id = ?', p.id);
  audit(req, 'project.delete', 'project', p.slug, {});
  res.json({ ok: true });
});
projectsStaff.post('/:id/images', (req, res, next) => {
  try {
    const p = get('SELECT id, images FROM diy_projects WHERE id = ?', req.params.id);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const imgs = parseImages(p.images);
    if (imgs.length >= MAX_IMAGES) return res.status(400).json({ error: `Up to ${MAX_IMAGES} photos per project` });
    imgs.push(saveImage(req.body?.variants));
    run('UPDATE diy_projects SET images = ? WHERE id = ?', JSON.stringify(imgs), p.id);
    res.json({ images: imgs });
  } catch (e) { next(e); }
});
projectsStaff.put('/:id/images', (req, res) => {
  const p = get('SELECT id, images FROM diy_projects WHERE id = ?', req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const cur = parseImages(p.images); const want = Array.isArray(req.body?.images) ? req.body.images.map(String) : [];
  if (want.length !== cur.length || !want.every((k) => cur.includes(k))) return res.status(400).json({ error: 'Send the same photos in the new order' });
  run('UPDATE diy_projects SET images = ? WHERE id = ?', JSON.stringify(want), p.id);
  res.json({ images: want });
});
projectsStaff.delete('/:id/images/:key', (req, res) => {
  const p = get('SELECT id, images FROM diy_projects WHERE id = ?', req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  const imgs = parseImages(p.images); if (!imgs.includes(req.params.key)) return res.status(404).json({ error: 'Photo not found' });
  deleteImage(req.params.key); const left = imgs.filter((k) => k !== req.params.key);
  run('UPDATE diy_projects SET images = ? WHERE id = ?', JSON.stringify(left), p.id);
  res.json({ images: left });
});

// ---- starter projects: popular school / maker builds; parts are matched to whatever is in the catalogue ----
const STARTERS = [
  { title: 'Line Follower Robot', category: 'Robotics', level: 'beginner', audience: 'Class 8 and up', build_hours: 4, summary: 'A 2-wheel robot that follows a black line using IR sensors — the classic first robot for school exhibitions and robotics competitions.',
    learn: ['IR sensing', 'Motor driver basics', 'Arduino programming', 'PID idea'], parts: [['arduino uno', 1], ['l298n', 1], ['ir sensor', 2], ['bo motor', 2], ['wheel', 2], ['chassis', 1], ['18650', 2], ['battery holder', 1], ['jumper', 1]],
    steps: ['Fix the BO motors and wheels to the chassis and add the castor wheel.', 'Mount the Arduino Uno and L298N motor driver on top of the chassis.', 'Fix two IR sensors at the front, facing the floor, about 1 cm above it.', 'Wire the motors to the L298N and the IR sensor outputs to Arduino digital pins.', 'Connect the 2 × 18650 battery holder to the L298N 12 V input and share ground with the Arduino.', 'Upload the line-follower sketch and adjust the IR sensor potentiometers on a black-tape track.'] },
  { title: 'Obstacle Avoiding Robot', category: 'Robotics', level: 'beginner', audience: 'Class 8 and up', build_hours: 4, summary: 'A robot car that "sees" walls with an ultrasonic sensor on a servo and turns away before it crashes.',
    learn: ['Ultrasonic distance sensing', 'Servo control', 'Decision logic'], parts: [['arduino uno', 1], ['l298n', 1], ['hc-sr04', 1], ['sg90', 1], ['bo motor', 2], ['wheel', 2], ['chassis', 1], ['18650', 2], ['battery holder', 1], ['jumper', 1]],
    steps: ['Assemble the chassis with motors and wheels.', 'Mount the SG90 servo at the front and the HC-SR04 sensor on the servo horn.', 'Wire the L298N, servo (pin 9) and HC-SR04 (trig/echo) to the Arduino.', 'Power the motors from the battery pack through the L298N.', 'Upload the sketch: measure distance, look left/right when closer than 20 cm, turn to the clearer side.'] },
  { title: 'Smart Dustbin (Automatic Lid)', category: 'School Science', level: 'beginner', audience: 'Class 6–10', build_hours: 2, summary: 'The lid opens by itself when a hand comes near — a favourite Swachh Bharat science-fair project.',
    learn: ['Ultrasonic sensing', 'Servo motors', 'Hygiene automation'], parts: [['arduino uno', 1], ['hc-sr04', 1], ['sg90', 1], ['jumper', 1], ['9v', 1]],
    steps: ['Fix the HC-SR04 sensor on the front of the dustbin.', 'Attach the SG90 servo to the hinge so its arm lifts the lid.', 'Wire the sensor and servo to the Arduino.', 'Upload the sketch: open the lid when distance < 15 cm, close after 3 seconds.'] },
  { title: 'Automatic Street Light (LDR)', category: 'Electronics Basics', level: 'beginner', audience: 'Class 6–9', build_hours: 1, summary: 'Lights switch on automatically when it gets dark, using an LDR — a simple, low-cost energy-saving model.',
    learn: ['Light sensors', 'Transistor / relay switching', 'Energy saving'], parts: [['ldr', 1], ['led', 1], ['relay', 1], ['breadboard', 1], ['jumper', 1], ['resistor', 1]],
    steps: ['Build the LDR voltage divider on the breadboard.', 'Use the divider output to switch a transistor or relay module.', 'Connect LEDs as street lights on the output.', 'Cover the LDR to test; adjust the resistor for the right darkness level.'] },
  { title: 'Automatic Plant Watering System', category: 'IoT & Smart Home', level: 'beginner', audience: 'Class 7 and up', build_hours: 3, summary: 'Measures soil moisture and switches a small pump on when the plant is dry.',
    learn: ['Soil-moisture sensing', 'Relays and pumps', 'Agriculture automation'], parts: [['arduino uno', 1], ['soil moisture', 1], ['relay', 1], ['pump', 1], ['pipe', 1], ['jumper', 1]],
    steps: ['Push the soil-moisture probe into the pot.', 'Connect the sensor analog output to A0.', 'Wire the mini pump through the relay module to its power supply.', 'Upload the sketch: run the pump while moisture is below your set level.'] },
  { title: 'Bluetooth Controlled Car', category: 'Robotics', level: 'intermediate', audience: 'Class 9 and up', build_hours: 4, summary: 'Drive a robot car from your Android phone over Bluetooth.',
    learn: ['Serial communication', 'Bluetooth HC-05', 'Mobile control'], parts: [['arduino uno', 1], ['hc-05', 1], ['l298n', 1], ['bo motor', 4], ['wheel', 4], ['chassis', 1], ['18650', 2], ['battery holder', 1], ['jumper', 1]],
    steps: ['Build the 4-wheel chassis and wire the motors to the L298N.', 'Connect the HC-05 TX/RX to the Arduino (use a voltage divider on RX).', 'Install a Bluetooth RC controller app on your phone and pair with HC-05 (PIN 1234).', 'Upload the sketch that maps F/B/L/R commands to the motors.'] },
  { title: 'IoT Weather Station (ESP32)', category: 'IoT & Smart Home', level: 'intermediate', audience: 'Class 10 / college', build_hours: 3, summary: 'Reads temperature, humidity and pressure and shows them on an OLED and on your phone over Wi-Fi.',
    learn: ['ESP32 Wi-Fi', 'I2C sensors', 'IoT dashboards'], parts: [['esp32', 1], ['dht22', 1], ['bmp280', 1], ['oled', 1], ['breadboard', 1], ['jumper', 1]],
    steps: ['Place the ESP32 on the breadboard and connect the I2C bus (SDA 21, SCL 22).', 'Connect the BMP280 and OLED to I2C and the DHT22 to GPIO 4.', 'Install the sensor libraries in Arduino IDE.', 'Upload the sketch and open the ESP32 IP address to see live readings.'] },
  { title: 'Fire Alarm with Flame Sensor', category: 'School Science', level: 'beginner', audience: 'Class 6–9', build_hours: 1, summary: 'Detects a flame and sounds a buzzer with a flashing LED.',
    learn: ['Flame / IR detection', 'Alarms', 'Safety systems'], parts: [['arduino uno', 1], ['flame', 1], ['buzzer', 1], ['led', 1], ['jumper', 1]],
    steps: ['Connect the flame sensor digital output to pin 2.', 'Connect the buzzer and LED to pins 8 and 13.', 'Upload the sketch: sound the alarm when a flame is detected.', 'Test carefully with a candle at a safe distance.'] },
  { title: 'WiFi Home Automation (4 appliances)', category: 'IoT & Smart Home', level: 'intermediate', audience: 'Class 11 / college', build_hours: 4, summary: 'Switch four lights or fans from your phone using an ESP32 and a relay module.',
    learn: ['Relays & mains safety', 'ESP32 web server', 'Home automation'], parts: [['esp32', 1], ['4 channel relay', 1], ['hlk', 1], ['jumper', 1]],
    steps: ['Wire the 4-channel relay inputs to ESP32 GPIOs.', 'Power the ESP32 and relays from the HLK 5 V module.', 'Upload the web-server sketch and open it on your phone.', 'Only an adult/electrician should connect mains appliances to the relay contacts.'] },
  { title: 'Quadcopter Drone (F450)', category: 'Drones & RC', level: 'advanced', audience: 'College / hobbyists', build_hours: 10, summary: 'Build and fly an F450 quadcopter with brushless motors, ESCs and a flight controller.',
    learn: ['Brushless motors & ESCs', 'Flight controller setup', 'LiPo safety'], parts: [['f450', 1], ['2212', 4], ['esc', 4], ['propeller', 2], ['flight controller', 1], ['lipo', 1], ['receiver', 1]],
    steps: ['Assemble the F450 frame and solder the ESCs to the power distribution board.', 'Mount the motors and connect them to the ESCs.', 'Fix the flight controller in the centre with the arrow forward; connect ESCs and receiver.', 'Calibrate ESCs, accelerometer and radio in the configurator.', 'Fit propellers only for the first test flight, outdoors, away from people.'] },
];
function matchPart(kw) {
  const words = kw.toLowerCase().split(/\s+/);
  return get(`SELECT id FROM products WHERE active = 1 AND ${words.map(() => '(LOWER(name) LIKE ? OR LOWER(tags) LIKE ? OR LOWER(sku) LIKE ?)').join(' AND ')} ORDER BY stock > 0 DESC, views DESC LIMIT 1`, ...words.flatMap((w) => [`%${w}%`, `%${w}%`, `%${w}%`]));
}
export function addStarterProjects(userId = null) {
  let added = 0; let parts = 0;
  for (const s of STARTERS) {
    const slug = slugify(s.title);
    if (get('SELECT 1 FROM diy_projects WHERE slug = ?', slug)) continue;
    const items = s.parts.map(([kw, qty]) => { const p = matchPart(kw); return p ? { product_id: p.id, qty, note: '' } : null; }).filter(Boolean);
    parts += items.length;
    run(`INSERT INTO diy_projects(title, slug, category, level, audience, build_hours, summary, steps, learn, items, tags, active, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      s.title, slug, s.category, s.level, s.audience, s.build_hours, s.summary, JSON.stringify(s.steps), JSON.stringify(s.learn), JSON.stringify(items),
      s.parts.map(([k]) => k).join(','), 1, userId);
    added++;
  }
  return { added, parts };
}
projectsStaff.post('/starter', (req, res) => { const r = addStarterProjects(req.user.id); audit(req, 'project.starter', 'project', null, r); res.json(r); });
