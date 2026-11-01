// Payment gateway provision: Razorpay (cards, UPI, netbanking, wallets) + Cash on Delivery + test mode.
// Razorpay is called over its REST API; keys are set in Master → Settings → Payments.
import crypto from 'node:crypto';
import { getSetting } from '../db.js';

export function razorpayConfigured() {
  const p = getSetting('payments');
  return !!(p.razorpay_key_id && p.razorpay_key_secret);
}

export function publicPaymentConfig() {
  const p = getSetting('payments');
  return {
    razorpay: razorpayConfigured() ? { key_id: p.razorpay_key_id } : null,
    cod: !!p.cod_enabled,
    test_mode: !razorpayConfigured() && !!p.test_mode,
  };
}

/** Creates a Razorpay order; amount in rupees. */
export async function createRazorpayOrder(amountInr, receipt, notes = {}) {
  const p = getSetting('payments');
  const auth = Buffer.from(`${p.razorpay_key_id}:${p.razorpay_key_secret}`).toString('base64');
  const r = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount: Math.round(amountInr * 100), currency: 'INR', receipt, notes }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error?.description || `Razorpay error HTTP ${r.status}`);
  return data; // { id, amount, currency, ... }
}

/** Verifies the signature returned by Razorpay Checkout after a successful payment. */
export function verifyRazorpaySignature(gatewayOrderId, paymentId, signature) {
  const p = getSetting('payments');
  if (!p.razorpay_key_secret || !signature) return false;
  const want = crypto.createHmac('sha256', p.razorpay_key_secret).update(`${gatewayOrderId}|${paymentId}`).digest('hex');
  return want.length === signature.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(signature));
}

/** Verifies a Razorpay webhook (X-Razorpay-Signature over the raw body). */
export function verifyRazorpayWebhook(rawBody, signature) {
  const p = getSetting('payments');
  if (!p.razorpay_webhook_secret || !signature) return false;
  const want = crypto.createHmac('sha256', p.razorpay_webhook_secret).update(rawBody).digest('hex');
  return want.length === signature.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(signature));
}
