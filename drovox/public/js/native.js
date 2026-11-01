// Runs only inside the Drovox Android / iOS app (Capacitor): back button, push notifications, deep links,
// native share and status bar. On the normal website every function here is a no-op.
import { api, getToken, toast } from './common.js';

export const isApp = () => !!window.Capacitor?.isNativePlatform?.();
const plugin = (n) => window.Capacitor?.Plugins?.[n];
// only builds that include Firebase config mark their user agent with DrovoxPush (see mobile/scripts/configure.mjs)
const pushReady = () => (navigator.userAgent.includes('DrovoxPush') ? plugin('PushNotifications') : null);
const KEY = 'drv_push'; const SENT = 'drv_push_sent';
const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } }, del: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } } };

export function initNative() {
  if (!isApp()) return;
  document.documentElement.classList.add('in-app');
  plugin('StatusBar')?.setBackgroundColor?.({ color: '#13203A' }).catch(() => {});
  plugin('StatusBar')?.setStyle?.({ style: 'DARK' }).catch(() => {});
  plugin('SplashScreen')?.hide?.().catch(() => {});
  const App = plugin('App');
  // Android back button: close a dialog first, then go back, and leave the app from the home page
  App?.addListener('backButton', () => {
    const open = document.querySelector('.lightbox, .modal-wrap');
    if (open) { open.remove(); return; }
    if (!location.hash || location.hash === '#/' || location.hash === '#') App.exitApp(); else history.back();
  });
  // drovox links opened from WhatsApp / browser land on the right page
  App?.addListener('appUrlOpen', ({ url }) => { try { const u = new URL(url); location.hash = u.hash || '#/'; } catch { /* ignore */ } });
  const Push = pushReady();
  if (Push) {
    Push.addListener('registration', (t) => { ls.set(KEY, t.value); syncPushToken(); });
    Push.addListener('registrationError', (e) => console.warn('[push] registration failed', e?.error));
    Push.addListener('pushNotificationReceived', (n) => toast(`🔔 ${n.body || n.title || 'New update'}${n.data?.link ? ` <a class="link" href="${n.data.link}" style="color:#ffb347">Open →</a>` : ''}`));
    Push.addListener('pushNotificationActionPerformed', (a) => { const l = a.notification?.data?.link; if (l) location.hash = l; });
    Push.checkPermissions().then((p) => { if (p.receive === 'granted') register(); }).catch(() => {});
  }
}

async function register() {
  const Push = pushReady(); if (!Push) return;
  await Push.createChannel?.({ id: 'orders', name: 'Order updates', description: 'Order, delivery and service updates', importance: 4, visibility: 1 }).catch(() => {});
  await Push.register().catch(() => {});
}

/** After sign-in: ask for notification permission once, then link this phone to the account. */
export async function syncPushToken() {
  if (!isApp() || !getToken()) return;
  const Push = pushReady(); if (!Push) return;
  const token = ls.get(KEY);
  if (!token) {
    const p = await Push.checkPermissions().catch(() => ({}));
    if (p.receive === 'prompt' || p.receive === 'prompt-with-rationale') { const r = await Push.requestPermissions().catch(() => ({})); if (r.receive === 'granted') register(); }
    return;
  }
  const mark = `${token.slice(-16)}:${getToken().slice(-12)}`;
  if (ls.get(SENT) === mark) return;
  try { await api('/me/push-token', { method: 'POST', body: { token, platform: window.Capacitor.getPlatform() } }); ls.set(SENT, mark); } catch { /* retried next time */ }
}
export async function unlinkPush() {
  const token = ls.get(KEY); if (!isApp() || !token || !getToken()) return;
  await api('/me/push-token', { method: 'DELETE', body: { token } }).catch(() => {}); ls.del(SENT);
}

/** Native share sheet in the app, Web Share in browsers, copy-link fallback. */
export async function share({ title, text, url }) {
  const S = plugin('Share');
  try {
    if (S) return await S.share({ title, text, url, dialogTitle: 'Share' });
    if (navigator.share) return await navigator.share({ title, text, url });
    await navigator.clipboard.writeText(url); toast('Link copied');
  } catch { /* cancelled */ }
}
