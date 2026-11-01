// OPTIONAL demo data: a sample catalogue, demo staff/customers and ~45 days of orders, for trying the system.
// The live system starts empty; this only runs when you ask for it (`npm run demo`, on an empty catalogue)
// and is used by the automated tests. Never run it on your real shop database.
import { pathToFileURL } from 'node:url';
import { all, get, run, DB_FILE, getSetting, setSetting } from './db.js';
import { addStarterCategories } from './catalog.js';
import { hashPassword, makeReferralCode } from './auth.js';
import { createOrder, transition, markPaid } from './services/orders.js';
import { scoreLead } from './services/engine.js';

const CATS = [
  ['Development Boards', 'development-boards', '🧠'], ['Sensors & Modules', 'sensors', '📡'], ['Motors & Drivers', 'motors', '⚙️'],
  ['Drone Parts', 'drone', '🚁'], ['Power & Batteries', 'power', '🔋'], ['Displays', 'displays', '🖥️'],
  ['Wireless & IoT', 'wireless', '📶'], ['Mechanical & Wheels', 'mechanical', '🛞'], ['Prototyping & Tools', 'tools', '🔧'],
  ['3D Printing', '3d-printing', '🖨️'], ['LEDs & Lighting', 'leds', '💡'],
];

// sku, name, category slug, brand, price, mrp, landed cost, gst, hsn, stock, tags, tiers [[qty, price]], specs
const P = [
  ['DRV-ARD-UNO', 'Arduino UNO R3 Compatible (CH340, with USB cable)', 'development-boards', 'Drovox', 399, 699, 190, 18, '8473', 140, 'arduino,microcontroller,beginner,robot', [[5, 379], [10, 359]], { MCU: 'ATmega328P', Clock: '16 MHz', 'Digital I/O': '14', Analog: '6', USB: 'CH340G' }],
  ['DRV-ARD-NANO', 'Arduino Nano V3 Compatible (Type-C, soldered)', 'development-boards', 'Drovox', 289, 499, 130, 18, '8473', 180, 'arduino,microcontroller,compact', [[5, 269], [20, 249]], { MCU: 'ATmega328P', USB: 'Type-C CH340' }],
  ['DRV-ARD-MEGA', 'Arduino Mega 2560 R3 Compatible', 'development-boards', 'Drovox', 849, 1299, 430, 18, '8473', 45, 'arduino,microcontroller,3d printer', [[5, 799]], { MCU: 'ATmega2560', 'Digital I/O': '54' }],
  ['DRV-ESP-32', 'ESP32 DevKit V1 WiFi + Bluetooth (30 pin)', 'wireless', 'Espressif', 349, 599, 165, 18, '8517', 220, 'esp32,wifi,bluetooth,iot,microcontroller', [[5, 329], [10, 309], [50, 289]], { Chip: 'ESP32-WROOM-32', Flash: '4 MB', WiFi: '802.11 b/g/n', BT: '4.2 + BLE' }],
  ['DRV-ESP-8266', 'NodeMCU ESP8266 V3 (CH340)', 'wireless', 'Espressif', 239, 399, 105, 18, '8517', 160, 'esp8266,wifi,iot', [[5, 219], [20, 199]], { Chip: 'ESP-12E', Flash: '4 MB' }],
  ['DRV-ESP-CAM', 'ESP32-CAM with OV2640 Camera Module', 'wireless', 'AI-Thinker', 499, 899, 240, 18, '8525', 70, 'esp32,camera,iot,surveillance', [[5, 469]], { Camera: 'OV2640 2MP', PSRAM: '4 MB' }],
  ['DRV-RPI-5-4G', 'Raspberry Pi 5 Model B 4GB', 'development-boards', 'Raspberry Pi', 5299, 5999, 4550, 18, '8471', 18, 'raspberry pi,linux,sbc,ai', [], { CPU: 'Cortex-A76 2.4 GHz', RAM: '4 GB' }],
  ['DRV-RPI-PICO', 'Raspberry Pi Pico W', 'development-boards', 'Raspberry Pi', 599, 699, 470, 18, '8473', 60, 'raspberry pi,microcontroller,wifi,rp2040', [[10, 569]], { MCU: 'RP2040', WiFi: 'CYW43439' }],
  ['DRV-SEN-HCSR04', 'HC-SR04 Ultrasonic Distance Sensor', 'sensors', 'Drovox', 69, 149, 26, 18, '9031', 400, 'sensor,distance,obstacle,robot', [[10, 59], [50, 52]], { Range: '2–400 cm', Voltage: '5 V' }],
  ['DRV-SEN-IR5', '5-Channel IR Line Tracking Sensor Array', 'sensors', 'Drovox', 189, 349, 80, 18, '9031', 90, 'sensor,line follower,ir,robot', [[5, 169]], { Channels: '5', Voltage: '3.3–5 V' }],
  ['DRV-SEN-IR', 'IR Obstacle Avoidance Sensor Module', 'sensors', 'Drovox', 39, 99, 13, 18, '9031', 500, 'sensor,ir,obstacle,line follower,robot', [[10, 34], [50, 29]], { Range: '2–30 cm' }],
  ['DRV-SEN-DHT22', 'DHT22 Temperature & Humidity Sensor (AM2302)', 'sensors', 'Aosong', 269, 449, 130, 18, '9025', 120, 'sensor,temperature,humidity,weather,iot', [[10, 249]], { Range: '-40–80 °C, 0–100 %RH', Accuracy: '±0.5 °C' }],
  ['DRV-SEN-BMP280', 'BMP280 Barometric Pressure Sensor (I2C/SPI)', 'sensors', 'Bosch', 119, 249, 48, 18, '9026', 140, 'sensor,pressure,altitude,weather,drone', [[10, 105]], { Interface: 'I2C / SPI' }],
  ['DRV-SEN-MPU6050', 'MPU6050 6-Axis Gyro + Accelerometer', 'sensors', 'InvenSense', 149, 299, 58, 18, '9031', 160, 'sensor,imu,gyro,drone,balancing robot', [[10, 129]], { Axes: '6', Interface: 'I2C' }],
  ['DRV-SEN-SOIL', 'Capacitive Soil Moisture Sensor v2.0', 'sensors', 'Drovox', 89, 179, 34, 18, '9031', 150, 'sensor,soil,plant,garden,iot', [[10, 79]], { Type: 'Capacitive, corrosion resistant' }],
  ['DRV-SEN-GPS6M', 'NEO-6M GPS Module with Antenna', 'sensors', 'u-blox', 449, 799, 210, 18, '8526', 55, 'gps,tracker,drone,navigation', [[5, 419]], { Chip: 'NEO-6M', Interface: 'UART' }],
  ['DRV-SEN-PIR', 'HC-SR501 PIR Motion Sensor', 'sensors', 'Drovox', 69, 149, 24, 18, '9031', 260, 'sensor,motion,security,home automation', [[10, 59]], { Range: 'up to 7 m' }],
  ['DRV-MD-L298N', 'L298N Dual H-Bridge Motor Driver', 'motors', 'Drovox', 159, 299, 62, 18, '8504', 210, 'motor driver,robot,line follower', [[5, 145], [20, 129]], { Channels: '2', Current: '2 A per channel' }],
  ['DRV-MD-PCA9685', 'PCA9685 16-Channel PWM Servo Driver', 'motors', 'NXP', 299, 549, 135, 18, '8542', 65, 'servo driver,robotic arm,pwm', [[5, 279]], { Channels: '16', Interface: 'I2C' }],
  ['DRV-MOT-BO300', 'BO Motor 300 RPM Dual Shaft (Straight)', 'motors', 'Drovox', 59, 99, 22, 18, '8501', 600, 'motor,robot,line follower,chassis', [[10, 52], [50, 45]], { Speed: '300 RPM @ 6V' }],
  ['DRV-MOT-N20', 'N20 Micro Metal Gear Motor 300 RPM 6V', 'motors', 'Drovox', 179, 299, 72, 18, '8501', 140, 'motor,micro,robot', [[10, 159]], { Speed: '300 RPM' }],
  ['DRV-MOT-PUMP', 'Mini Submersible Water Pump 3–6V', 'motors', 'Drovox', 79, 149, 28, 18, '8413', 170, 'pump,plant,irrigation', [[10, 69]], { Flow: '80–120 L/h' }],
  ['DRV-SRV-SG90', 'TowerPro SG90 9g Micro Servo', 'motors', 'TowerPro', 99, 199, 38, 18, '8501', 450, 'servo,robotic arm,rc,robot', [[10, 89], [50, 79]], { Torque: '1.8 kg·cm', Weight: '9 g' }],
  ['DRV-SRV-MG996R', 'MG996R Metal Gear High Torque Servo', 'motors', 'TowerPro', 349, 599, 165, 18, '8501', 95, 'servo,robotic arm,metal gear', [[4, 329], [10, 309]], { Torque: '11 kg·cm' }],
  ['DRV-STP-NEMA17', 'NEMA17 Stepper Motor 4.2 kg·cm', 'motors', 'Drovox', 649, 999, 340, 18, '8501', 60, 'stepper,3d printer,cnc', [[5, 609]], { Step: '1.8°', Current: '1.5 A' }],
  ['DRV-STP-A4988', 'A4988 Stepper Driver with Heatsink', 'motors', 'Allegro', 89, 179, 32, 18, '8542', 220, 'stepper driver,3d printer,cnc', [[5, 79], [20, 69]], { Microstep: '1/16' }],
  ['DRV-DRN-F450', 'F450 Quadcopter Frame with Integrated PDB', 'drone', 'Drovox', 749, 1299, 360, 18, '8807', 35, 'drone,quadcopter,frame', [], { Wheelbase: '450 mm' }],
  ['DRV-DRN-BLDC2212', 'A2212 1000KV Brushless Motor', 'drone', 'Drovox', 399, 699, 185, 18, '8501', 120, 'drone,bldc,quadcopter,motor', [[4, 369], [8, 349]], { KV: '1000', 'Max thrust': '~800 g' }],
  ['DRV-DRN-ESC30', '30A Brushless ESC (SimonK)', 'drone', 'Drovox', 449, 799, 210, 18, '8504', 110, 'drone,esc,quadcopter', [[4, 419], [8, 399]], { Current: '30 A', Firmware: 'SimonK' }],
  ['DRV-DRN-PROP1045', '1045 Propeller Pair (CW + CCW)', 'drone', 'Drovox', 79, 149, 26, 18, '8803', 300, 'drone,propeller,quadcopter', [[4, 69], [10, 62]], { Size: '10 × 4.5 in' }],
  ['DRV-DRN-FC', 'Flight Controller (APM 2.8 Compatible)', 'drone', 'Drovox', 2499, 3999, 1350, 18, '8526', 20, 'drone,flight controller,quadcopter', [], { Firmware: 'ArduPilot' }],
  ['DRV-DRN-LIPO3S', 'LiPo Battery 11.1V 2200mAh 30C (3S)', 'drone', 'Orange', 1599, 2299, 880, 18, '8507', 30, 'drone,battery,lipo,rc', [], { Capacity: '2200 mAh', Discharge: '30C' }],
  ['DRV-DRN-RX', 'FlySky FS-i6 6CH Transmitter + Receiver', 'drone', 'FlySky', 3999, 5499, 2700, 18, '8526', 12, 'drone,rc,transmitter,receiver', [], { Channels: '6', Band: '2.4 GHz' }],
  ['DRV-PWR-18650', '18650 Li-ion Cell 2600mAh 3.7V', 'power', 'Drovox', 189, 299, 88, 18, '8507', 260, 'battery,li-ion,robot,power', [[4, 175], [20, 159]], { Capacity: '2600 mAh' }],
  ['DRV-PWR-HLD2S', '2× 18650 Battery Holder with Switch', 'power', 'Drovox', 49, 99, 15, 18, '8538', 300, 'battery holder,robot,power', [[10, 42]], { Cells: '2 in series' }],
  ['DRV-PWR-5V2A', '5V 2A Adapter with DC Jack + USB Cable', 'power', 'Drovox', 179, 299, 76, 18, '8504', 190, 'power supply,adapter,iot', [[10, 159]], { Output: '5 V 2 A' }],
  ['DRV-PWR-12V5A', '12V 5A SMPS Power Supply', 'power', 'Drovox', 549, 899, 265, 18, '8504', 55, 'power supply,3d printer,led,cnc', [[5, 509]], { Output: '12 V 5 A' }],
  ['DRV-PWR-HLK5M05', 'HLK-5M05 AC to 5V DC Module', 'power', 'Hi-Link', 189, 349, 84, 18, '8504', 120, 'power supply,home automation,ac-dc', [[10, 169]], { Input: '100–240 V AC', Output: '5 V 1 A' }],
  ['DRV-PWR-TP4056', 'TP4056 Type-C Li-ion Charger with Protection', 'power', 'Drovox', 29, 69, 9, 18, '8504', 600, 'charger,li-ion,battery', [[10, 25], [50, 21]], { Current: '1 A' }],
  ['DRV-DSP-OLED096', '0.96" I2C OLED Display 128×64 (White)', 'displays', 'Drovox', 229, 399, 98, 18, '8531', 160, 'display,oled,i2c,iot', [[5, 209], [20, 189]], { Resolution: '128 × 64', Driver: 'SSD1306' }],
  ['DRV-DSP-LCD1602', '16×2 LCD with I2C Backpack', 'displays', 'Drovox', 179, 299, 72, 18, '8531', 130, 'display,lcd,i2c', [[5, 159]], { Size: '16 × 2' }],
  ['DRV-REL-4CH', '4-Channel 5V Relay Module (Optocoupled)', 'wireless', 'Drovox', 179, 349, 74, 18, '8536', 140, 'relay,home automation,appliance,iot', [[5, 159]], { Channels: '4', Rating: '10 A 250 V AC' }],
  ['DRV-MEC-CHS2WD', '2WD Smart Robot Car Chassis Kit', 'mechanical', 'Drovox', 349, 599, 160, 18, '8708', 75, 'chassis,robot,line follower,car', [[5, 319]], { Includes: 'Acrylic base, 2 motors mounts, caster' }],
  ['DRV-MEC-WHL65', '65 mm Rubber Wheel for BO Motor', 'mechanical', 'Drovox', 39, 79, 13, 18, '8708', 500, 'wheel,robot,line follower,chassis', [[10, 34], [50, 29]], { Diameter: '65 mm' }],
  ['DRV-PRT-BB830', '830-Point Solderless Breadboard', 'tools', 'Drovox', 99, 199, 36, 18, '8538', 300, 'breadboard,prototyping,beginner', [[5, 89], [20, 79]], { Points: '830' }],
  ['DRV-WIR-JMP40', 'Jumper Wires 40 pcs (M-M / M-F / F-F set)', 'tools', 'Drovox', 99, 179, 32, 18, '8544', 700, 'jumper wires,prototyping,beginner', [[5, 89], [20, 79]], { Length: '20 cm', Count: '3 × 40' }],
  ['DRV-PRT-FTDI', 'FT232RL USB to TTL Serial Adapter', 'tools', 'FTDI', 249, 449, 110, 18, '8471', 80, 'usb serial,programmer,esp32 cam', [[5, 229]], { Chip: 'FT232RL' }],
  ['DRV-TLS-SOLDER', '60W Temperature Controlled Soldering Iron Kit', 'tools', 'Drovox', 699, 1199, 340, 18, '8515', 45, 'soldering,tools', [], { Power: '60 W', Range: '200–450 °C' }],
  ['DRV-TLS-DMM', 'Digital Multimeter DT-830D', 'tools', 'Drovox', 249, 449, 105, 18, '9030', 85, 'multimeter,tools,testing', [[5, 229]], { Display: '3½ digit' }],
  ['DRV-3DP-PLA', 'PLA+ Filament 1.75mm 1kg (Black)', '3d-printing', 'Drovox', 899, 1399, 520, 18, '3916', 40, '3d printer,filament,pla', [[3, 849], [10, 799]], { Diameter: '1.75 mm', Weight: '1 kg' }],
  ['DRV-LED-WS2812', 'WS2812B RGB LED Strip 1m 60 LEDs', 'leds', 'WorldSemi', 349, 599, 165, 12, '9405', 90, 'led,rgb,neopixel,light', [[5, 319]], { LEDs: '60 / m', Voltage: '5 V' }],
  ['DRV-LED-5MM', '5mm LED Assorted Pack (100 pcs, 5 colours)', 'leds', 'Drovox', 79, 149, 25, 12, '8541', 260, 'led,beginner,prototyping', [[5, 69]], { Count: '100' }],
];

const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Ishaan', 'Arjun', 'Sai', 'Rohan', 'Kabir', 'Ananya', 'Diya', 'Priya', 'Sneha', 'Riya', 'Meera', 'Kavya', 'Neha', 'Rahul', 'Karan', 'Pooja', 'Amit', 'Siddharth', 'Harsh', 'Nikhil', 'Tanvi', 'Yash', 'Varun', 'Shreya', 'Manav'];
const LAST = ['Sharma', 'Patel', 'Iyer', 'Reddy', 'Nair', 'Gupta', 'Kulkarni', 'Deshmukh', 'Singh', 'Joshi', 'Mehta', 'Rao', 'Das', 'Bose', 'Verma'];
const CITIES = [['Pune', '27', '411001'], ['Mumbai', '27', '400001'], ['Bengaluru', '29', '560001'], ['Delhi', '07', '110001'], ['Hyderabad', '36', '500001'], ['Chennai', '33', '600001'], ['Ahmedabad', '24', '380001'], ['Kolkata', '19', '700001'], ['Jaipur', '08', '302001'], ['Kochi', '32', '682001']];

let seedState = 42;
const rnd = () => ((seedState = (seedState * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];

export function seed() {
  if (get('SELECT COUNT(*) n FROM products').n > 0) return false;
  console.log('Seeding Drovox demo data…');

  addStarterCategories();
  setSetting('engagement', { ...getSetting('engagement'), welcome_coupon: 'WELCOME10', abandoned_cart_coupon: 'COMEBACK5' });
  setSetting('store', { ...getSetting('store'), legal_name: 'Drovox Demo Store', gstin: '27AAAAA0000A1Z5', address: 'Pune, Maharashtra, India', support_phone: '+91 90000 00000', support_email: 'support@drovox.in' });
  const sup = [
    ['Shenzhen Huaqiang Electronics Co.', 'Shenzhen', 'Lily Chen', 'sales@hqe-sz.example', 'lily_hqe', 18],
    ['Dongguan RC Power Ltd', 'Dongguan', 'Kevin Wu', 'kevin@dgrc.example', 'kevinwu_rc', 25],
    ['Ningbo Motion Parts', 'Ningbo', 'Grace Li', 'grace@nbmotion.example', 'grace_nb', 21],
  ];
  sup.forEach((s) => run('INSERT INTO suppliers(name, city, contact, email, wechat, lead_time_days) VALUES (?,?,?,?,?,?)', ...s));
  const catId = Object.fromEntries(all('SELECT id, slug FROM categories').map((c) => [c.slug, c.id]));
  const supFor = (slug) => (['drone', 'power'].includes(slug) ? 2 : ['motors', 'mechanical', '3d-printing'].includes(slug) ? 3 : 1);
  const icon = Object.fromEntries(CATS.map(([, s, i]) => [s, i]));
  for (const [sku, name, cat, brand, price, mrp, cost, gst, hsn, stock, tags, tiers, specs] of P) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60) + '-' + sku.split('-').pop().toLowerCase();
    run(`INSERT INTO products(sku, name, slug, category_id, brand, description, specs, tags, image, mrp, price, cost_price, hsn, gst_rate, stock, reorder_level, weight_g, tiers, supplier_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      sku, name, slug, catId[cat], brand,
      `${name}. Tested before dispatch from our Pune warehouse, ships within 24 hours with a GST invoice. Ideal for students, makers and R&D labs — bulk pricing available.`,
      JSON.stringify(specs), tags, icon[cat], mrp, price, cost, hsn, gst, stock + 60, Math.max(5, Math.round(stock / 10)), 40,
      JSON.stringify(tiers.map(([min_qty, p]) => ({ min_qty, price: p }))), supFor(cat));
  }

  const pw = (s) => hashPassword(s);
  const staff = [['Drovox Admin', 'admin@drovox.in', '9000000001', 'admin123', 'admin'], ['Warehouse Stockist', 'stockist@drovox.in', '9000000002', 'stock123', 'stockist'],
    ['Marketing Team', 'marketing@drovox.in', '9000000003', 'market123', 'marketing'], ['Support Desk', 'support@drovox.in', '9000000004', 'support123', 'support']];
  for (const [n, e, ph, p, r] of staff) run('INSERT INTO users(name, email, phone, password_hash, role, referral_code) VALUES (?,?,?,?,?,?)', n, e, ph, pw(p), r, makeReferralCode(n));

  const demoHash = pw('demo123');
  run(`INSERT INTO users(name, email, phone, password_hash, role, referral_code, state_code, points) VALUES (?,?,?,?,?,?,?,?)`, 'Demo Maker', 'demo@drovox.in', '9876543210', demoHash, 'customer', 'DEMO100', '27', 250);
  const custIds = [get('SELECT id FROM users WHERE email = ?', 'demo@drovox.in').id];
  for (let i = 0; i < 36; i++) {
    const n = `${pick(FIRST)} ${pick(LAST)}`; const c = pick(CITIES);
    const r = run(`INSERT INTO users(name, email, phone, password_hash, role, referral_code, state_code, points, created_at) VALUES (?,?,?,?,?,?,?,?, datetime('now', ?))`,
      n, `${n.toLowerCase().replace(' ', '.')}${i}@example.com`, `9${String(800000000 + Math.floor(rnd() * 99999999)).slice(0, 9)}`, demoHash, 'customer', makeReferralCode(n), c[1], 50, `-${50 + i} days`);
    custIds.push(Number(r.lastInsertRowid));
  }
  // a few referral links
  for (let i = 1; i < 6; i++) run('INSERT INTO referrals(referrer_id, referee_id) VALUES (?,?)', custIds[0], custIds[i]);

  const coupons = [
    ['WELCOME10', 'percent', 10, 299, 150, null, 1, 1, 'First order: 10% off up to ₹150'],
    ['COMEBACK5', 'percent', 5, 0, 200, null, 1, 0, 'Come back — 5% off your cart'],
    ['BULK500', 'flat', 500, 7500, null, null, 3, 0, '₹500 off orders above ₹7,500'],
    ['FREESHIP', 'free_ship', 0, 199, null, 500, 2, 0, 'Free shipping above ₹199'],
    ['DRONE15', 'percent', 15, 4000, 1200, 100, 1, 0, '15% off drone builds above ₹4,000'],
  ];
  for (const c of coupons) run('INSERT INTO coupons(code, type, value, min_order, max_discount, max_uses, per_user, first_order_only, description) VALUES (?,?,?,?,?,?,?,?,?)', ...c);

  // ---- demo orders over the last 45 days -------------------------------------------------
  const products = all('SELECT id, sku, price, category_id FROM products');
  const bundles = [
    ['DRV-ARD-UNO', 'DRV-MD-L298N', 'DRV-SEN-IR5', 'DRV-MOT-BO300', 'DRV-MEC-WHL65', 'DRV-MEC-CHS2WD'],
    ['DRV-ESP-32', 'DRV-SEN-DHT22', 'DRV-DSP-OLED096', 'DRV-WIR-JMP40'],
    ['DRV-DRN-BLDC2212', 'DRV-DRN-ESC30', 'DRV-DRN-PROP1045', 'DRV-DRN-F450'],
    ['DRV-ARD-NANO', 'DRV-SEN-HCSR04', 'DRV-SRV-SG90', 'DRV-PRT-BB830'],
    ['DRV-STP-NEMA17', 'DRV-STP-A4988', 'DRV-3DP-PLA'],
    ['DRV-ESP-32', 'DRV-REL-4CH', 'DRV-PWR-HLK5M05'],
  ];
  const sku = (s) => products.find((p) => p.sku === s).id;
  const admin = get(`SELECT * FROM users WHERE role = 'admin'`);
  for (let i = 0; i < 160; i++) {
    const uid = pick(custIds); const user = get('SELECT * FROM users WHERE id = ?', uid);
    const city = pick(CITIES);
    const base = rnd() < 0.7 ? pick(bundles).filter(() => rnd() < 0.8) : [];
    const items = base.map((s) => ({ product_id: sku(s), qty: s.includes('BO300') || s.includes('WHL') ? 2 : 1 + Math.floor(rnd() * 2) }));
    for (let k = 0; k < 1 + Math.floor(rnd() * 3); k++) items.push({ product_id: pick(products).id, qty: 1 + Math.floor(rnd() * 3) });
    const pm = rnd() < 0.3 ? 'cod' : 'test';
    let o;
    try {
      o = createOrder(user, { items, payment_method: pm, address: { name: user.name, phone: user.phone, line1: `${10 + i}, MG Road`, city: city[0], state_code: city[1], pincode: city[2] } });
    } catch { continue; }
    const age = Math.floor(Math.pow(rnd(), 1.4) * 45 * 24 * 60); // minutes ago, skewed to recent
    const r = rnd();
    if (pm === 'test') markPaid(o.id, 'pay_demo' + i);
    const steps = age > 6 * 1440 ? (r < 0.06 ? ['cancelled'] : r < 0.09 ? ['packed', 'shipped', 'delivered', 'returned'] : ['packed', 'shipped', 'out_for_delivery', 'delivered'])
      : age > 2 * 1440 ? (r < 0.5 ? ['packed', 'shipped'] : ['packed', 'shipped', 'out_for_delivery', 'delivered'])
      : age > 360 ? (r < 0.5 ? ['packed'] : []) : [];
    for (const s of steps) { try { transition(o.id, s, admin, {}); } catch { break; } }
    const ts = `-${age} minutes`;
    run(`UPDATE orders SET created_at = datetime('now', ?), updated_at = datetime('now', ?) WHERE id = ?`, ts, ts, o.id);
    run(`UPDATE order_events SET created_at = datetime('now', ?, '+' || (id % 50) || ' minutes') WHERE order_id = ?`, ts, o.id);
    run(`UPDATE events SET created_at = datetime('now', ?) WHERE type = 'purchase' AND user_id = ? AND created_at >= datetime('now','-1 minute')`, ts, uid);
  }
  // order events must never be in the future
  run(`UPDATE order_events SET created_at = datetime('now') WHERE created_at > datetime('now')`);
  run(`DELETE FROM notifications`);

  // browsing events for trending / recommendations
  for (let i = 0; i < 2500; i++) {
    const p = rnd() < 0.5 ? sku(pick(pick(bundles))) : pick(products).id;
    const type = rnd() < 0.82 ? 'view' : rnd() < 0.8 ? 'add_to_cart' : 'checkout';
    run(`INSERT INTO events(session_id, user_id, type, product_id, created_at) VALUES (?,?,?,?, datetime('now', ?))`,
      `s${Math.floor(rnd() * 400)}`, rnd() < 0.4 ? pick(custIds) : null, type, p, `-${Math.floor(Math.pow(rnd(), 1.6) * 30 * 1440)} minutes`);
  }
  for (const p of products) run('UPDATE products SET views = (SELECT COUNT(*) FROM events WHERE product_id = ? AND type = \'view\') WHERE id = ?', p.id, p.id);
  // make a couple of products visibly low so the alerts have something to show
  run(`UPDATE products SET stock = 3 WHERE sku IN ('DRV-DRN-FC','DRV-RPI-5-4G')`);
  run(`UPDATE products SET stock = 0 WHERE sku = 'DRV-DRN-RX'`);

  // abandoned carts
  for (const uid of custIds.slice(6, 10)) {
    const items = [{ product_id: pick(products).id, qty: 1 }, { product_id: pick(products).id, qty: 2 }];
    run(`INSERT OR REPLACE INTO carts(user_id, items, value, updated_at) VALUES (?,?,?, datetime('now','-6 hours'))`, uid, JSON.stringify(items), 800);
  }

  // CRM leads
  const leads = [
    ['Prof. R. Kulkarni', 'hod.entc@coep.example', '9822000001', 'COEP Robotics Lab', 'bulk_quote', 'qualified', '60 Arduino kits for lab', 85000],
    ['Meera Iyer', 'meera@agritech.example', '9840000002', 'GreenSense Agritech', 'ai_builder', 'proposal', 'Soil sensors + ESP32 for 200 farms', 240000],
    ['Arjun Reddy', 'arjun@droneworks.example', '9900000003', 'DroneWorks Hyd', 'website', 'contacted', 'Monthly BLDC motors and ESCs', 120000],
    ['Sneha Joshi', 'sneha.j@school.example', '9811000004', 'Little Inventors School', 'whatsapp', 'new', 'STEM kits for 4 classrooms', 60000],
    ['Karan Mehta', 'karan@iotlabs.example', '9898000005', 'IoT Labs', 'referral', 'won', 'ESP32 + relays recurring', 45000],
    ['Nikhil Rao', 'nikhil@startup.example', '9845000006', 'Hardware startup', 'website', 'lost', 'PCB assembly — not offered', 30000],
  ];
  for (const l of leads) {
    const r = run(`INSERT INTO leads(name, email, phone, company, source, stage, interest, value_estimate, owner_id, next_followup, created_at) VALUES (?,?,?,?,?,?,?,?,?, date('now','+2 days'), datetime('now','-' || ? || ' days'))`, ...l, admin.id, Math.floor(rnd() * 20));
    run('INSERT INTO lead_activities(lead_id, type, content, user_id) VALUES (?,?,?,?)', r.lastInsertRowid, 'note', 'Lead created from ' + l[4].replace('_', ' '), admin.id);
    const lead = get('SELECT * FROM leads WHERE id = ?', r.lastInsertRowid);
    run('UPDATE leads SET score = ? WHERE id = ?', scoreLead(lead), lead.id);
  }

  // an inbound import batch
  const b = run(`INSERT INTO stock_batches(ref, supplier_id, currency, fx_rate, freight_inr, duty_pct, other_inr, status, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    'PO-2026-0142', 1, 'CNY', 11.9, 18500, 21.6, 6500, 'in_transit', 'Air cargo via Shenzhen → Mumbai', admin.id);
  for (const [s, q, c] of [['DRV-ESP-32', 300, 11.5], ['DRV-ARD-UNO', 200, 13.2], ['DRV-DRN-FC', 40, 92]]) run('INSERT INTO stock_batch_items(batch_id, product_id, qty, unit_cost_foreign) VALUES (?,?,?,?)', b.lastInsertRowid, sku(s), q, c);

  run(`INSERT INTO campaigns(name, channel, segment, message, coupon_code, status, sent_count, created_by, sent_at) VALUES (?,?,?,?,?,?,?,?, datetime('now','-5 days'))`,
    'Diwali Maker Sale', 'whatsapp', 'all', 'Diwali Maker Sale is live at Drovox! Use DRONE15 for 15% off drone builds 🚁', 'DRONE15', 'sent', 31, admin.id);
  run(`INSERT INTO audit_logs(user_id, user_name, role, action, entity, details) VALUES (?,?,?,?,?,?)`, admin.id, admin.name, 'admin', 'system.seed', 'database', JSON.stringify({ products: P.length }));
  console.log(`Seeded ${P.length} products, ${custIds.length} customers, ${get('SELECT COUNT(*) n FROM orders').n} orders.`);
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (seed() === false) console.log(`The catalogue already has products (${DB_FILE}); demo data was not added.`);
}
