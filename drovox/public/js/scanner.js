// Camera barcode / QR scanning (html5-qrcode, served locally). USB and Bluetooth handheld scanners need
// no code: they type the code into the focused input and press Enter.
import { $, modal, toast } from './common.js';

function loadLib() {
  if (window.Html5Qrcode) return Promise.resolve();
  return new Promise((ok, fail) => {
    const s = document.createElement('script'); s.src = '/vendor/html5-qrcode.js'; s.onload = ok; s.onerror = () => fail(new Error('Scanner library failed to load'));
    document.head.append(s);
  });
}

/**
 * Opens the camera scanner. Calls onCode(text) for each new code read (same code is ignored for 2.5 s).
 * Keeps scanning until the modal is closed when `continuous` is true.
 */
export async function scanWithCamera(onCode, { continuous = true, title = 'Scan barcode / QR' } = {}) {
  if (!window.isSecureContext) {
    toast('The camera only works on https:// or http://localhost. On other devices use a USB/Bluetooth scanner or open the site over https.', 'err', 6000);
    return;
  }
  try { await loadLib(); } catch (e) { toast(e.message, 'err'); return; }
  let scanner = null; let last = ''; let lastAt = 0;
  const m = modal(`<h2>${title}</h2><div id="cam" style="width:100%;min-height:260px;border-radius:12px;overflow:hidden;background:#000"></div>
    <p class="small muted" style="margin-top:8px">Point the camera at a barcode or QR code. ${continuous ? 'Keep scanning — close this window when done.' : ''}</p><div id="cam-last" class="small"></div>`,
  { onClose: () => { scanner?.stop().catch(() => {}).finally(() => scanner?.clear?.()); } });
  try {
    scanner = new window.Html5Qrcode('cam', { verbose: false });
    await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: (w, h) => ({ width: Math.min(w, 320) * 0.9, height: Math.min(h, 240) * 0.7 }) }, (text) => {
      const now = Date.now();
      if (text === last && now - lastAt < 2500) return;
      last = text; lastAt = now;
      if (navigator.vibrate) navigator.vibrate(80);
      const box = $('#cam-last', m.el); if (box) box.textContent = `Last scan: ${text}`;
      onCode(text);
      if (!continuous) m.close();
    }, () => {});
  } catch (e) {
    toast(`Camera unavailable: ${e?.message || e}`, 'err', 5000); m.close();
  }
}
