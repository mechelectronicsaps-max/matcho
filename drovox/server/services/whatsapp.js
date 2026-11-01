// WhatsApp Business Cloud API (Meta Graph API) integration.
// When WhatsApp is not configured, messages are recorded in the outbox as "simulated" so the whole
// flow can be tested end to end; configure phone_number_id + access_token in Master → Settings to go live.
import { run, getSetting } from '../db.js';

export function normalisePhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 10) d = '91' + d;            // Indian mobile without country code
  if (d.length === 11 && d.startsWith('0')) d = '91' + d.slice(1);
  return d.length >= 11 && d.length <= 15 ? d : null;
}

/**
 * Sends a WhatsApp message.
 * @param {string} to            phone number
 * @param {string} body          plain text (used for free-form text, and as the outbox record)
 * @param {object} [opt]         { template, params: [..], order_id, campaign_id }
 */
export async function sendWhatsApp(to, body, opt = {}) {
  const cfg = getSetting('whatsapp');
  const phone = normalisePhone(to);
  const record = (status, providerId, error) => run(
    'INSERT INTO notifications(to_phone, template, body, status, provider_id, error, order_id, campaign_id) VALUES (?,?,?,?,?,?,?,?)',
    phone || String(to || ''), opt.template || null, body, status, providerId || null, error || null, opt.order_id || null, opt.campaign_id || null);

  if (!phone) { record('failed', null, 'invalid phone number'); return { ok: false, error: 'invalid phone number' }; }
  if (!cfg.enabled || !cfg.phone_number_id || !cfg.access_token) { record('simulated'); return { ok: true, simulated: true }; }

  // Business-initiated messages outside the 24h customer window must use approved templates.
  const payload = cfg.use_templates && opt.template
    ? { messaging_product: 'whatsapp', to: phone, type: 'template',
        template: { name: opt.template, language: { code: 'en' },
          components: opt.params?.length ? [{ type: 'body', parameters: opt.params.map((t) => ({ type: 'text', text: String(t) })) }] : [] } }
    : { messaging_product: 'whatsapp', to: phone, type: 'text', text: { preview_url: true, body } };

  try {
    const r = await fetch(`https://graph.facebook.com/${cfg.api_version}/${cfg.phone_number_id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const err = data?.error?.message || `HTTP ${r.status}`; record('failed', null, err); return { ok: false, error: err }; }
    const id = data?.messages?.[0]?.id; record('sent', id); return { ok: true, id };
  } catch (e) {
    record('failed', null, e.message); return { ok: false, error: e.message };
  }
}

/** Fire-and-forget wrapper used from order automation, so a WhatsApp outage never blocks an order. */
export function notify(to, body, opt) {
  sendWhatsApp(to, body, opt).catch((e) => console.error('[whatsapp]', e.message));
}
