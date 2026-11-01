// App push notifications (Android / iOS app) through Firebase Cloud Messaging HTTP v1.
// Every WhatsApp update (order confirmed, shipped, delivered, service quote…) is also pushed to the
// customer's phones that have the Drovox app. Configure in Master → Settings → App & push.
import crypto from 'node:crypto';
import { all, run, getSetting } from '../db.js';

let cached = { token: null, until: 0, key: '' };
const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

export function pushConfigured() {
  const c = getSetting('app');
  return !!(c.push_enabled && c.fcm_project_id && c.fcm_client_email && c.fcm_private_key);
}

async function accessToken(c) {
  const key = `${c.fcm_client_email}:${c.fcm_private_key.length}`;
  if (cached.token && cached.until > Date.now() + 60_000 && cached.key === key) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({ iss: c.fcm_client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const pem = String(c.fcm_private_key).replace(/\\n/g, '\n');
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), pem).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`FCM auth failed: ${j.error_description || j.error || r.status}`);
  cached = { token: j.access_token, until: Date.now() + (j.expires_in || 3600) * 1000, key };
  return cached.token;
}

/** Send one notification to a list of device tokens; removes tokens FCM says are dead. */
export async function sendPush(tokens, { title, body, link }) {
  if (!tokens.length || !pushConfigured()) return { sent: 0, simulated: !pushConfigured() };
  const c = getSetting('app');
  const at = await accessToken(c);
  let sent = 0;
  for (const t of tokens) {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(c.fcm_project_id)}/messages:send`, {
      method: 'POST', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { token: t, notification: { title, body: body.slice(0, 900) }, data: { link: link || '#/' }, android: { priority: 'high', notification: { channel_id: 'orders', color: '#F25C05' } } } }),
    });
    if (r.ok) sent++;
    else if ([400, 404].includes(r.status)) {
      const j = await r.json().catch(() => ({}));
      if (/UNREGISTERED|INVALID_ARGUMENT/.test(JSON.stringify(j))) run('DELETE FROM push_tokens WHERE token = ?', t);
    }
  }
  return { sent };
}

/** Push to every app install of the customer with this phone number (last 10 digits). */
export function pushToPhone(phone, body, link) {
  const d = String(phone || '').replace(/\D/g, '').slice(-10);
  if (d.length !== 10 || !pushConfigured()) return;
  const tokens = all(`SELECT t.token FROM push_tokens t JOIN users u ON u.id = t.user_id WHERE substr(replace(replace(u.phone, ' ', ''), '+', ''), -10) = ?`, d).map((r) => r.token);
  if (!tokens.length) return;
  const order = String(body).match(/\b(DRV[\w/-]*\d{3,}|SR\d{7})\b/);
  const to = link || (order ? (order[1].startsWith('SR') ? '#/account' : `#/order/${order[1]}`) : '#/orders');
  sendPush(tokens, { title: getSetting('store').name || 'Drovox', body: String(body), link: to }).catch((e) => console.error('[push]', e.message));
}
