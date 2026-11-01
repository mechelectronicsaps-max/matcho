// SQLite storage for Drovox, using Node's built-in node:sqlite (no native build step).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DROVOX_DATA_DIR || path.join(here, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
export const DB_FILE = process.env.DROVOX_DB || path.join(DATA_DIR, 'drovox.db');

export const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer',          -- customer | stockist | support | marketing | admin
  company TEXT,
  gstin TEXT,
  state_code TEXT,
  referral_code TEXT UNIQUE,
  referred_by INTEGER REFERENCES users(id),
  points INTEGER NOT NULL DEFAULT 0,
  whatsapp_opt_in INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1,
  last_seen TEXT,
  last_checkin TEXT,
  checkin_streak INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, phone TEXT NOT NULL,
  line1 TEXT NOT NULL, line2 TEXT, city TEXT NOT NULL,
  state_code TEXT NOT NULL, pincode TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, icon TEXT, sort INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, country TEXT NOT NULL DEFAULT 'China', city TEXT,
  contact TEXT, email TEXT, wechat TEXT, lead_time_days INTEGER NOT NULL DEFAULT 21, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category_id INTEGER REFERENCES categories(id),
  brand TEXT,
  description TEXT,
  specs TEXT NOT NULL DEFAULT '{}',               -- JSON object
  tags TEXT NOT NULL DEFAULT '',                  -- comma separated
  image TEXT,
  mrp REAL NOT NULL,                              -- GST inclusive
  price REAL NOT NULL,                            -- GST inclusive selling price
  cost_price REAL NOT NULL DEFAULT 0,             -- landed cost per unit (ex GST)
  hsn TEXT NOT NULL DEFAULT '8542',
  gst_rate REAL NOT NULL DEFAULT 18,
  stock INTEGER NOT NULL DEFAULT 0,
  reorder_level INTEGER NOT NULL DEFAULT 10,
  weight_g INTEGER NOT NULL DEFAULT 50,
  tiers TEXT NOT NULL DEFAULT '[]',               -- JSON [{min_qty, price}]
  supplier_id INTEGER REFERENCES suppliers(id),
  active INTEGER NOT NULL DEFAULT 1,
  views INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category_id);

CREATE TABLE IF NOT EXISTS stock_batches (                -- import shipment / GRN
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT NOT NULL,
  supplier_id INTEGER REFERENCES suppliers(id),
  currency TEXT NOT NULL DEFAULT 'CNY',
  fx_rate REAL NOT NULL DEFAULT 11.8,              -- INR per unit of currency
  freight_inr REAL NOT NULL DEFAULT 0,
  duty_pct REAL NOT NULL DEFAULT 0,               -- basic customs duty + SWS on assessable value
  other_inr REAL NOT NULL DEFAULT 0,              -- clearing, CHA, local transport
  status TEXT NOT NULL DEFAULT 'ordered',         -- ordered | in_transit | customs | received
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  received_at TEXT
);
CREATE TABLE IF NOT EXISTS stock_batch_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id INTEGER NOT NULL REFERENCES stock_batches(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty INTEGER NOT NULL,
  unit_cost_foreign REAL NOT NULL,
  landed_unit_cost REAL
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  change INTEGER NOT NULL,
  balance INTEGER NOT NULL,
  reason TEXT NOT NULL,                           -- order | cancel | grn | adjust | return
  ref TEXT,
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  user_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending_payment',
  payment_method TEXT NOT NULL,                   -- razorpay | cod | test
  payment_status TEXT NOT NULL DEFAULT 'pending', -- pending | paid | cod_due | refunded | failed
  payment_ref TEXT,
  gateway_order_id TEXT,
  subtotal REAL NOT NULL, discount REAL NOT NULL DEFAULT 0, coupon_code TEXT,
  points_redeemed INTEGER NOT NULL DEFAULT 0,
  shipping REAL NOT NULL DEFAULT 0, cod_fee REAL NOT NULL DEFAULT 0,
  taxable REAL NOT NULL, cgst REAL NOT NULL DEFAULT 0, sgst REAL NOT NULL DEFAULT 0, igst REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  points_earned INTEGER NOT NULL DEFAULT 0,
  ship_name TEXT, ship_phone TEXT, ship_address TEXT, ship_pincode TEXT,
  place_of_supply TEXT, gstin TEXT,
  invoice_no TEXT, courier TEXT, awb TEXT,
  notes TEXT, source TEXT NOT NULL DEFAULT 'web',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  sku TEXT NOT NULL, name TEXT NOT NULL, hsn TEXT NOT NULL,
  qty INTEGER NOT NULL, unit_price REAL NOT NULL, gst_rate REAL NOT NULL,
  taxable REAL NOT NULL, tax REAL NOT NULL, total REAL NOT NULL, unit_cost REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_product ON order_items(product_id);

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL, note TEXT, user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  type TEXT NOT NULL,                             -- percent | flat | free_ship
  value REAL NOT NULL DEFAULT 0,
  min_order REAL NOT NULL DEFAULT 0, max_discount REAL,
  max_uses INTEGER, used INTEGER NOT NULL DEFAULT 0, per_user INTEGER NOT NULL DEFAULT 1,
  first_order_only INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT, active INTEGER NOT NULL DEFAULT 1, description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS points_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  change INTEGER NOT NULL, reason TEXT NOT NULL, ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id INTEGER NOT NULL REFERENCES users(id),
  referee_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',         -- pending | rewarded
  reward_points INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  rewarded_at TEXT
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, email TEXT, phone TEXT, company TEXT,
  source TEXT NOT NULL DEFAULT 'manual',          -- website | bulk_quote | ai_builder | whatsapp | referral | manual
  stage TEXT NOT NULL DEFAULT 'new',              -- new | contacted | qualified | proposal | won | lost
  interest TEXT, value_estimate REAL NOT NULL DEFAULT 0,
  owner_id INTEGER REFERENCES users(id), user_id INTEGER REFERENCES users(id),
  score INTEGER NOT NULL DEFAULT 0,
  next_followup TEXT, notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS lead_activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  type TEXT NOT NULL, content TEXT NOT NULL, user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'whatsapp',
  segment TEXT NOT NULL DEFAULT 'all',
  message TEXT NOT NULL, coupon_code TEXT,
  status TEXT NOT NULL DEFAULT 'draft', sent_count INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), sent_at TEXT
);

CREATE TABLE IF NOT EXISTS notifications (                -- WhatsApp outbox
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  to_phone TEXT NOT NULL, template TEXT, body TEXT NOT NULL,
  status TEXT NOT NULL,                           -- sent | simulated | failed
  provider_id TEXT, error TEXT, order_id INTEGER, campaign_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, user_name TEXT, role TEXT,
  action TEXT NOT NULL, entity TEXT, entity_id TEXT, details TEXT, ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

CREATE TABLE IF NOT EXISTS events (                       -- behavioural analytics
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT, user_id INTEGER,
  type TEXT NOT NULL,                             -- view | search | add_to_cart | checkout | purchase
  product_id INTEGER, query TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, created_at);
CREATE INDEX IF NOT EXISTS idx_events_product ON events(product_id);

CREATE TABLE IF NOT EXISTS carts (                        -- server copy of carts, for abandoned-cart recovery
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  items TEXT NOT NULL DEFAULT '[]', value REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  reminded_at TEXT
);

CREATE TABLE IF NOT EXISTS stock_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  user_id INTEGER REFERENCES users(id), phone TEXT,
  notified_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, idea TEXT NOT NULL, result TEXT NOT NULL, engine TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;
db.exec(SCHEMA);

// ---- small helpers -------------------------------------------------------
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Settings are stored as JSON values with defaults below.
export const DEFAULT_SETTINGS = {
  store: {
    name: 'Drovox', tagline: 'Components for makers, engineers & builders',
    legal_name: 'Drovox Technologies Pvt Ltd', gstin: '27AAAAA0000A1Z5', state_code: '27',
    address: 'Pune, Maharashtra, India', support_phone: '+91 90000 00000', support_email: 'support@drovox.in',
    currency: 'INR', public_url: 'http://localhost:3000',
  },
  shipping: { flat_fee: 59, free_above: 499, cod_fee: 40, cod_max_order: 5000 },
  loyalty: {
    earn_per_100: 2,              // points earned per ₹100 paid
    point_value: 1,               // ₹ per point on redemption
    max_redeem_pct: 20,           // max % of the order payable with points
    signup_bonus: 50,
    referrer_bonus: 150,          // credited when the referred friend's first order is delivered
    referee_bonus: 100,           // credited to the friend at signup
    daily_checkin: 2, streak_bonus_7: 25,
    tiers: [ { name: 'Maker', min_spend: 0, multiplier: 1 }, { name: 'Builder', min_spend: 10000, multiplier: 1.25 }, { name: 'Engineer', min_spend: 50000, multiplier: 1.5 } ],
  },
  engagement: {
    welcome_coupon: 'WELCOME10', exit_intent: true, social_proof: true,
    abandoned_cart_hours: 4, abandoned_cart_coupon: 'COMEBACK5', unpaid_cancel_minutes: 30,
  },
  payments: { razorpay_key_id: '', razorpay_key_secret: '', razorpay_webhook_secret: '', cod_enabled: true, test_mode: true },
  whatsapp: { enabled: false, phone_number_id: '', access_token: '', api_version: 'v21.0', use_templates: false,
    templates: { order_confirmed: 'order_confirmed', order_shipped: 'order_shipped', order_delivered: 'order_delivered' } },
  courier: { provider: 'manual', shiprocket_email: '', shiprocket_password: '', tracking_url: 'https://www.shiprocket.in/shipment-tracking/?awb={awb}' },
  ai: { enabled: true, anthropic_api_key: '', model: 'claude-opus-5-5' },
  inventory: { safety_days: 7, target_cover_days: 45, low_stock_default: 10 },
};

export function getSetting(key) {
  const row = get('SELECT value FROM settings WHERE key = ?', key);
  const def = DEFAULT_SETTINGS[key];
  if (!row) return structuredClone(def);
  const val = JSON.parse(row.value);
  return def && typeof def === 'object' && !Array.isArray(def) ? { ...structuredClone(def), ...val } : val;
}
export function setSetting(key, value) {
  run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
