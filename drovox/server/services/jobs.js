// Background automations. Each job is idempotent and safe to run at any time;
// the scheduler runs them every few minutes and the master panel can trigger them by hand.
import { all, run, getSetting } from '../db.js';
import { transition } from './orders.js';
import { notify } from './whatsapp.js';
import { inventoryForecast } from './engine.js';
import { audit } from '../auth.js';
import { runGreetings } from './greetings.js';

const SYSTEM = { id: null, name: 'automation', role: 'system' };
export const jobState = {};

export const JOBS = {
  /** Releases stock held by online orders that were never paid. */
  cancel_unpaid: {
    label: 'Cancel unpaid online orders', every_min: 5,
    run() {
      const mins = getSetting('engagement').unpaid_cancel_minutes;
      const rows = all(`SELECT id, order_no FROM orders WHERE status = 'pending_payment' AND payment_method != 'cod' AND created_at < datetime('now', ?)`, `-${mins} minutes`);
      for (const o of rows) transition(o.id, 'cancelled', SYSTEM, { note: `Auto-cancelled: unpaid after ${mins} minutes` });
      return `${rows.length} cancelled`;
    },
  },
  /** WhatsApp reminder (with a small coupon) for carts left for N hours. One reminder per cart change. */
  abandoned_carts: {
    label: 'Abandoned cart recovery', every_min: 30,
    run() {
      const e = getSetting('engagement'); const store = getSetting('store');
      const rows = all(`SELECT c.*, u.name, u.phone, u.whatsapp_opt_in FROM carts c JOIN users u ON u.id = c.user_id
                        WHERE c.value > 0 AND c.reminded_at IS NULL AND c.updated_at < datetime('now', ?) AND c.updated_at > datetime('now','-7 days')`, `-${e.abandoned_cart_hours} hours`);
      let sent = 0;
      for (const c of rows) {
        if (c.phone && c.whatsapp_opt_in) {
          const n = JSON.parse(c.items).length;
          notify(c.phone, `Hi ${c.name.split(' ')[0]}, you left ${n} item${n > 1 ? 's' : ''} worth ₹${Math.round(c.value)} in your ${store.name} cart 🛒 Complete your order with code ${e.abandoned_cart_coupon} for an extra 5% off: ${store.public_url}/#/cart`);
          sent++;
        }
        run(`UPDATE carts SET reminded_at = datetime('now') WHERE user_id = ?`, c.user_id);
      }
      return `${sent} reminders sent`;
    },
  },
  /** Daily low-stock digest to the store's WhatsApp number. */
  low_stock_digest: {
    label: 'Low-stock & reorder digest', every_min: 24 * 60,
    run() {
      const low = inventoryForecast().filter((x) => x.status !== 'ok');
      if (!low.length) return 'all stock healthy';
      const store = getSetting('store');
      const lines = low.slice(0, 12).map((x) => `• ${x.sku}: ${x.stock} left${x.days_of_cover != null ? `, ~${x.days_of_cover}d cover` : ''}${x.suggested_reorder_qty ? ` → reorder ${x.suggested_reorder_qty}` : ''}`);
      notify(store.support_phone, `📉 ${store.name} stock alert — ${low.length} SKU(s) need attention:\n${lines.join('\n')}`);
      audit(null, 'automation.low_stock_digest', 'inventory', null, { count: low.length });
      return `${low.length} SKUs flagged`;
    },
  },
  /** Reminds lead owners about follow-ups that are due. */
  lead_followups: {
    label: 'CRM follow-up reminders', every_min: 12 * 60,
    run() {
      const due = all(`SELECT l.*, u.phone owner_phone FROM leads l LEFT JOIN users u ON u.id = l.owner_id WHERE l.stage NOT IN ('won','lost') AND l.next_followup IS NOT NULL AND date(l.next_followup) <= date('now')`);
      for (const l of due) if (l.owner_phone) notify(l.owner_phone, `CRM reminder: follow up with ${l.name}${l.company ? ` (${l.company})` : ''} — ${l.interest || 'open lead'}, est. ₹${Math.round(l.value_estimate)}.`);
      return `${due.length} follow-ups due`;
    },
  },
};

JOBS.greetings = { label: 'Birthday & anniversary WhatsApp greetings', every_min: 60, run: runGreetings };

export async function runJob(name) {
  const j = JOBS[name];
  if (!j) throw new Error('unknown job');
  try {
    const result = await j.run();
    jobState[name] = { last_run: new Date().toISOString(), result, ok: true };
  } catch (e) {
    jobState[name] = { last_run: new Date().toISOString(), result: e.message, ok: false };
    console.error(`[job ${name}]`, e);
  }
  return jobState[name];
}

export function startScheduler() {
  const tick = () => {
    const now = Date.now();
    for (const [name, j] of Object.entries(JOBS)) {
      const last = jobState[name]?.last_run ? Date.parse(jobState[name].last_run) : 0;
      if (j.running || now - last < j.every_min * 60e3) continue;
      j.running = true;
      runJob(name).catch((e) => console.error(`[job ${name}]`, e)).finally(() => { j.running = false; });
    }
  };
  setTimeout(tick, 10e3);
  return setInterval(tick, 60e3);
}

export function jobsStatus() {
  return Object.entries(JOBS).map(([name, j]) => ({ name, label: j.label, every_min: j.every_min, ...(jobState[name] || {}) }));
}
