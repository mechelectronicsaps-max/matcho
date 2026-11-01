// Password hashing, signed session tokens, role checks and the audit trail.
import crypto from 'node:crypto';
import { get, run, getSetting, setSetting } from './db.js';

export const ROLES = ['customer', 'stockist', 'support', 'marketing', 'admin'];

// Which master-panel areas each staff role can open. Admin sees everything.
export const PERMISSIONS = {
  admin: ['*'],
  marketing: ['dashboard', 'analytics', 'marketing', 'crm', 'customers'],
  support: ['dashboard', 'orders', 'crm', 'customers', 'whatsapp'],
  stockist: ['stock'],
  customer: [],
};
export function can(user, area) {
  const p = PERMISSIONS[user?.role] || [];
  return p.includes('*') || p.includes(area);
}

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
export function verifyPassword(pw, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

function secret() {
  if (process.env.DROVOX_SECRET) return process.env.DROVOX_SECRET;
  let s = getSetting('auth_secret');
  if (!s || typeof s !== 'string') { s = crypto.randomBytes(32).toString('hex'); setSetting('auth_secret', s); }
  return s;
}
const b64 = (s) => Buffer.from(s).toString('base64url');

export function signToken(user, days = 30) {
  const payload = b64(JSON.stringify({ uid: user.id, role: user.role, exp: Date.now() + days * 864e5 }));
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
export function readToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const want = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}

export const publicUser = (u) => u && ({
  id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, company: u.company, gstin: u.gstin,
  state_code: u.state_code, referral_code: u.referral_code, points: u.points, whatsapp_opt_in: !!u.whatsapp_opt_in,
  checkin_streak: u.checkin_streak, last_checkin: u.last_checkin, created_at: u.created_at,
  dob: u.dob, anniversary: u.anniversary, city: u.city, source: u.source,
});

/** Express middleware: attaches req.user when a valid bearer token is present. */
export function attachUser(req, _res, next) {
  const h = req.headers.authorization || '';
  const data = readToken(h.startsWith('Bearer ') ? h.slice(7) : null);
  if (data) {
    const u = get('SELECT * FROM users WHERE id = ? AND active = 1', data.uid);
    if (u) {
      req.user = u;
      run(`UPDATE users SET last_seen = datetime('now') WHERE id = ?`, u.id);
    }
  }
  next();
}

export const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Please sign in' }));
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Please sign in' });
  if (req.user.role === 'admin' || roles.includes(req.user.role)) return next();
  return res.status(403).json({ error: 'You do not have access to this area' });
};
export const requireArea = (area) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Please sign in' });
  return can(req.user, area) ? next() : res.status(403).json({ error: 'You do not have access to this area' });
};

/** Writes an audit entry. Call for every state-changing staff action and key customer actions. */
export function audit(req, action, entity, entityId, details) {
  const u = req?.user;
  run('INSERT INTO audit_logs(user_id, user_name, role, action, entity, entity_id, details, ip) VALUES (?,?,?,?,?,?,?,?)',
    u?.id ?? null, u?.name ?? 'system', u?.role ?? 'system', action, entity ?? null, entityId != null ? String(entityId) : null,
    details ? JSON.stringify(details) : null, req?.ip ?? null);
}

export function makeReferralCode(name) {
  const base = String(name || 'DRV').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4).padEnd(3, 'X');
  for (;;) {
    const code = base + crypto.randomInt(100, 9999);
    if (!get('SELECT 1 FROM users WHERE referral_code = ?', code)) return code;
  }
}
