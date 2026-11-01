// WhatsApp integration: msg.myrc.in gateway (default) or Meta WhatsApp Cloud API.
// When WhatsApp is not configured, messages are recorded in the outbox as "simulated" so the whole
// flow can be tested end to end; enter the gateway API key in Master → Settings → WhatsApp to go live.
import { run, getSetting } from '../db.js';

export function normalisePhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 10) d = '91' + d;            // Indian mobile without country code
  if (d.length === 11 && d.startsWith('0')) d = '91' + d.slice(1);
  return d.length >= 11 && d.length <= 15 ? d : null;
}

/** True when the selected WhatsApp provider has its credentials filled in. */
export function whatsappConfigured(cfg = getSetting('whatsapp')) {
  if (!cfg.enabled) return false;
  return cfg.provider === 'meta' ? !!(cfg.phone_number_id && cfg.access_token) : !!(cfg.myrc_base_url && cfg.myrc_api_key);
}

/**
 * Calls the msg.myrc.in gateway (the same API as the PHP backend: Bearer key, JSON body).
 * Returns { ok, status, json, text }.
 */
export async function myrcCall(method, pathname, body) {
  const cfg = getSetting('whatsapp');
  const base = String(cfg.myrc_base_url || '').replace(/\/+$/, '');
  if (!base || !cfg.myrc_api_key) return { ok: false, status: 0, error: 'WhatsApp gateway URL and API key are not set' };
  try {
    const r = await fetch(base + pathname, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.myrc_api_key}` },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    // The gateway may answer HTTP 200 with {status:false} / {success:false} on failure.
    const flag = json && (json.success ?? json.status);
    const ok = r.ok && flag !== false && flag !== 'false' && flag !== 'error';
    return { ok, status: r.status, json, text: text.slice(0, 2000), error: ok ? null : (json?.message || json?.error || `HTTP ${r.status}`) };
  } catch (e) {
    return { ok: false, status: 0, error: e.message };
  }
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
  if (!whatsappConfigured(cfg)) { record('simulated'); return { ok: true, simulated: true }; }

  if (cfg.provider !== 'meta') {
    const r = await myrcCall('POST', '/send-message', { number: phone, message: body });
    const id = r.json?.id || r.json?.message_id || r.json?.data?.id || null;
    record(r.ok ? 'sent' : 'failed', id ? String(id) : null, r.error);
    return r.ok ? { ok: true, id } : { ok: false, error: r.error };
  }

  // Meta WhatsApp Cloud API. Business-initiated messages outside the 24h window need approved templates.
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
