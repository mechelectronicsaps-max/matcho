// Birthday & anniversary greetings on WhatsApp, from the personal details stored on each customer.
import { all, get, run, getSetting } from '../db.js';
import { sendWhatsApp } from './whatsapp.js';

/** Today's date in India (IST), as { y, md: 'MM-DD', hour }. */
export function istToday(now = new Date()) {
  const ist = new Date(now.getTime() + 5.5 * 3600e3);
  return { y: ist.getUTCFullYear(), md: ist.toISOString().slice(5, 10), hour: ist.getUTCHours() };
}
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/** MM-DD a date falls on this year (29 Feb is celebrated on 28 Feb in non-leap years). */
export function occursOn(date, year) {
  const md = String(date || '').slice(5, 10);
  return md === '02-29' && !isLeap(year) ? '02-28' : md;
}

export function greetingText(kind, user) {
  const g = getSetting('greetings'); const store = getSetting('store');
  let msg = (kind === 'birthday' ? g.birthday : g.anniversary) || '';
  if (g.coupon) msg += (g.coupon_line || '').replaceAll('{coupon}', g.coupon);
  return msg.replaceAll('{name}', String(user.name || '').split(' ')[0]).replaceAll('{store}', store.name).replaceAll('{coupon}', g.coupon || '');
}

export async function sendGreeting(user, kind, year) {
  const r = await sendWhatsApp(user.phone, greetingText(kind, user));
  if (r.ok) run('INSERT OR IGNORE INTO greetings_log(user_id, kind, year) VALUES (?,?,?)', user.id, kind, year);
  return r;
}

/** People with a birthday or anniversary in the next `days` days (0 = today). */
export function upcoming(days = 30) {
  const t = istToday();
  const base = new Date(Date.UTC(t.y, Number(t.md.slice(0, 2)) - 1, Number(t.md.slice(3))));
  const window = new Map();
  for (let i = 0; i <= days; i++) {
    const d = new Date(base.getTime() + i * 864e5);
    window.set(d.toISOString().slice(5, 10), { in_days: i, year: d.getUTCFullYear() });
  }
  const out = [];
  for (const u of all(`SELECT id, name, phone, dob, anniversary, whatsapp_opt_in FROM users WHERE role = 'customer' AND active = 1 AND (dob IS NOT NULL OR anniversary IS NOT NULL)`)) {
    for (const kind of ['birthday', 'anniversary']) {
      const date = kind === 'birthday' ? u.dob : u.anniversary;
      if (!date) continue;
      for (const [md, w] of window) {
        if (occursOn(date, w.year) !== md) continue;
        const sent = !!get('SELECT 1 FROM greetings_log WHERE user_id = ? AND kind = ? AND year = ?', u.id, kind, w.year);
        out.push({ user_id: u.id, name: u.name, phone: u.phone, kind, date, in_days: w.in_days, year: w.year, sent, opted_in: !!u.whatsapp_opt_in,
          turning: kind === 'birthday' && Number(date.slice(0, 4)) > 1900 ? w.year - Number(date.slice(0, 4)) : null });
      }
    }
  }
  return out.sort((a, b) => a.in_days - b.in_days || a.name.localeCompare(b.name));
}

/** Daily job: sends today's greetings once the configured hour has passed. */
export async function runGreetings() {
  const g = getSetting('greetings');
  if (!g.enabled) return 'greetings disabled';
  const t = istToday();
  if (t.hour < Number(g.send_hour || 0)) return `waiting until ${g.send_hour}:00 IST`;
  let sent = 0; let failed = 0;
  for (const p of upcoming(0)) {
    if (p.sent || !p.phone || !p.opted_in) continue;
    const r = await sendGreeting({ id: p.user_id, name: p.name, phone: p.phone }, p.kind, p.year);
    r.ok ? sent++ : failed++;
  }
  return `${sent} greetings sent${failed ? `, ${failed} failed` : ''}`;
}
