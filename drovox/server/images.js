// Product photos: the browser resizes each photo to three WebP/JPEG sizes before upload (no native image
// library needed on shared hosting). Files are named by a random key and served with a 1-year immutable cache.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DB_FILE } from './db.js';

export const PRODUCT_IMG_DIR = path.join(path.dirname(DB_FILE), 'uploads', 'products');
fs.mkdirSync(PRODUCT_IMG_DIR, { recursive: true });
export const SIZES = { s: 360, m: 900, l: 1600 };
export const MAX_IMAGES = 5;
const MAX_BYTES = { s: 300 * 1024, m: 1.5 * 1024 * 1024, l: 4 * 1024 * 1024 };
const KEY_RE = /^[a-f0-9]{16}\.(webp|jpg)$/;

export class ImageError extends Error { constructor(m) { super(m); this.status = 400; } }
export const validKey = (k) => KEY_RE.test(String(k || ''));
export const parseImages = (v) => { try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a.filter(validKey) : []; } catch { return []; } };

function sniff(buf) {
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  return null;
}

/** @param {{s:string,m:string,l:string}} variants data URLs or base64 → returns the new key */
export function saveImage(variants) {
  const bufs = {};
  let ext = null;
  for (const size of Object.keys(SIZES)) {
    const b = Buffer.from(String(variants?.[size] || '').replace(/^data:[^,]*,/, ''), 'base64');
    if (!b.length) throw new ImageError('Image data is missing');
    if (b.length > MAX_BYTES[size]) throw new ImageError('Image is too large — use a photo under 10 MB');
    const t = sniff(b); if (!t) throw new ImageError('Images must be JPEG or WebP (they are converted automatically in the browser)');
    if (ext && t !== ext) throw new ImageError('All sizes must use the same format');
    ext = t; bufs[size] = b;
  }
  const key = `${crypto.randomBytes(8).toString('hex')}.${ext}`;
  const base = key.replace(/\.\w+$/, '');
  for (const [size, b] of Object.entries(bufs)) fs.writeFileSync(path.join(PRODUCT_IMG_DIR, `${base}-${size}.${ext}`), b);
  return key;
}

export function deleteImage(key) {
  if (!validKey(key)) return;
  const [base, ext] = key.split('.');
  for (const size of Object.keys(SIZES)) fs.rmSync(path.join(PRODUCT_IMG_DIR, `${base}-${size}.${ext}`), { force: true });
}
