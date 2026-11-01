// Catalogue helpers: Drovox SKU codes and the optional starter category list.
import { all, get, run, getSetting } from './db.js';

/** Optional starter categories (added only when the owner clicks "Add starter categories"). */
export const STARTER_CATEGORIES = [
  ['Development Boards', 'development-boards', '🧠', 'DEV'], ['Sensors & Modules', 'sensors', '📡', 'SEN'],
  ['Motors & Drivers', 'motors', '⚙️', 'MOT'], ['Drone Parts', 'drone', '🚁', 'DRN'], ['Power & Batteries', 'power', '🔋', 'PWR'],
  ['Displays', 'displays', '🖥️', 'DSP'], ['Wireless & IoT', 'wireless', '📶', 'IOT'], ['Mechanical & Wheels', 'mechanical', '🛞', 'MEC'],
  ['Prototyping & Tools', 'tools', '🔧', 'TLS'], ['3D Printing', '3d-printing', '🖨️', '3DP'], ['LEDs & Lighting', 'leds', '💡', 'LED'],
];

export const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);

/** Category code from its name when none is given: "Sensors & Modules" → "SEN". */
export function codeFor(name) {
  const letters = String(name).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (letters.slice(0, 3) || 'GEN').padEnd(3, 'X');
}

export function addCategory({ name, icon, code, sort }) {
  const slugBase = slugify(name) || 'category';
  let slug = slugBase; let n = 2;
  while (get('SELECT 1 FROM categories WHERE slug = ?', slug)) slug = `${slugBase}-${n++}`;
  const c = String(code || codeFor(name)).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) || 'GEN';
  const order = sort ?? (get('SELECT COALESCE(MAX(sort), -1) + 1 s FROM categories').s);
  const r = run('INSERT INTO categories(name, slug, icon, code, sort) VALUES (?,?,?,?,?)', String(name).trim(), slug, icon || '📦', c, order);
  return get('SELECT * FROM categories WHERE id = ?', r.lastInsertRowid);
}

export function addStarterCategories() {
  let added = 0;
  STARTER_CATEGORIES.forEach(([name, slug, icon, code], i) => {
    if (get('SELECT 1 FROM categories WHERE slug = ? OR name = ?', slug, name)) return;
    run('INSERT INTO categories(name, slug, icon, code, sort) VALUES (?,?,?,?,?)', name, slug, icon, code, i);
    added++;
  });
  return added;
}

/**
 * Next free Drovox SKU for a category: <prefix>-<category code>-<4-digit serial>, e.g. DRV-SEN-0007.
 * The serial continues from the highest existing number with the same prefix and code.
 */
export function nextSku(categoryId) {
  const prefix = (getSetting('store').sku_prefix || 'DRV').toUpperCase();
  const cat = categoryId ? get('SELECT code, name FROM categories WHERE id = ?', categoryId) : null;
  const code = (cat?.code || (cat ? codeFor(cat.name) : 'GEN')).toUpperCase();
  const stem = `${prefix}-${code}-`;
  let max = 0;
  for (const r of all('SELECT sku FROM products WHERE sku LIKE ?', `${stem}%`)) {
    const n = Number(r.sku.slice(stem.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${stem}${String(max + 1).padStart(4, '0')}`;
}
