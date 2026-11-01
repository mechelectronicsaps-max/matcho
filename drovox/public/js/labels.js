// Printable labels: product stickers (barcode + QR), box / shipping labels for orders, and custom-job tags.
// Opens a print window sized for label printers (thermal 50×25, 38×25, 100×50, 100×150 mm) or A4 sheets.
import { esc, toast } from './common.js';

export const LABEL_SIZES = {
  '50x25': { w: 50, h: 25, label: '50 × 25 mm — product sticker (thermal)' },
  '38x25': { w: 38, h: 25, label: '38 × 25 mm — small part sticker (thermal)' },
  '100x50': { w: 100, h: 50, label: '100 × 50 mm — box sticker with QR (thermal)' },
  a4: { w: 63.5, h: 38.1, label: 'A4 sheet — 21 labels (63.5 × 38.1 mm)', sheet: true },
};

const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

function openPrint(title, css, body) {
  const w = window.open('', '_blank');
  if (!w) { toast('Allow pop-ups to print labels', 'err'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
    <style>*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff}
    .bar{display:flex;gap:8px;align-items:center;padding:10px;background:#f1f5f9;font:14px system-ui}.bar button{padding:8px 16px;font-size:14px;cursor:pointer}
    @media print{.bar{display:none}} svg{display:block} ${css}</style>
    <script src="/vendor/jsbarcode.js"></script><script src="/vendor/qrcode.js"></script></head><body>
    <div class="bar"><button onclick="print()">🖨️ Print</button><span>Set the printer's paper size to match the label and margins to “None”.</span></div>${body}
    <script>
      document.querySelectorAll('svg[data-bc]').forEach(function (el) {
        try { JsBarcode(el, el.dataset.bc, { format: 'CODE128', displayValue: el.dataset.text !== '0', fontSize: Number(el.dataset.fs || 10), height: Number(el.dataset.h || 28), margin: 0, width: Number(el.dataset.w || 1.3), textMargin: 1 }); } catch (e) { el.outerHTML = '<b>' + el.dataset.bc + '</b>'; }
      });
      document.querySelectorAll('[data-qr]').forEach(function (el) {
        var q = qrcode(0, 'M'); q.addData(el.dataset.qr); q.make(); el.innerHTML = q.createSvgTag({ cellSize: 2, margin: 0, scalable: true });
      });
      setTimeout(function () { print(); }, 400);
    </script></body></html>`);
  w.document.close();
}

/**
 * @param {Array<{product, copies}>} items
 * @param {string} size key of LABEL_SIZES
 * @param {object} store {name, public_url}
 * @param {object} opt {showPrice}
 */
export function printProductLabels(items, size, store, opt = {}) {
  const s = LABEL_SIZES[size] || LABEL_SIZES['50x25'];
  const big = s.w >= 63;
  const labels = [];
  for (const { product: p, copies } of items) {
    for (let i = 0; i < Math.max(1, copies); i++) {
      const url = `${String(store.public_url || location.origin).replace(/\/$/, '')}/#/p/${encodeURIComponent(p.sku)}`;
      labels.push(`<div class="lbl">
        <div class="top"><b class="brand">${esc(store.name || 'DROVOX')}</b>${opt.showPrice !== false ? `<b class="mrp">MRP ${money(p.mrp)}</b>` : ''}</div>
        <div class="name">${esc(p.name)}</div>
        <div class="row"><svg data-bc="${esc(p.barcode || p.sku)}" data-h="${big ? 34 : s.w < 45 ? 20 : 24}" data-w="${s.w < 45 ? 1 : 1.3}" data-fs="${big ? 11 : 9}"></svg>${big ? `<div class="qr" data-qr="${esc(url)}"></div>` : ''}</div>
        ${big ? `<div class="foot">SKU ${esc(p.sku)}${p.hsn ? ` · HSN ${esc(p.hsn)}` : ''} · Incl. of all taxes</div>` : ''}
      </div>`);
    }
  }
  const css = s.sheet
    ? `@page{size:A4;margin:12.9mm 7.2mm}.sheet{display:grid;grid-template-columns:repeat(3,63.5mm);grid-auto-rows:38.1mm;column-gap:2.5mm}
       .lbl{width:63.5mm;height:38.1mm;padding:2mm 3mm;overflow:hidden;page-break-inside:avoid}`
    : `@page{size:${s.w}mm ${s.h}mm;margin:0}.lbl{width:${s.w}mm;height:${s.h}mm;padding:1.2mm 1.8mm;overflow:hidden;page-break-after:always}`;
  openPrint('Product labels', `${css}
    .lbl{display:flex;flex-direction:column;justify-content:space-between}
    .top{display:flex;justify-content:space-between;font-size:${big ? 9 : 6.5}pt}.brand{letter-spacing:.06em}
    .name{font-size:${big ? 9 : s.w < 45 ? 6 : 7}pt;font-weight:700;line-height:1.1;max-height:2.25em;overflow:hidden}
    .row{display:flex;align-items:flex-end;justify-content:space-between;gap:2mm}.row svg{max-width:100%;height:auto}
    .qr{width:${big ? 18 : 12}mm;height:${big ? 18 : 12}mm;flex:none}.qr svg{width:100%;height:100%}.foot{font-size:6pt}`,
  s.sheet ? `<div class="sheet">${labels.join('')}</div>` : labels.join(''));
}

/** 100 × 150 mm box / shipping label for an order (courier, COD amount, address, order barcode, tracking QR). */
export function printBoxLabels(orders, store) {
  const site = String(store.public_url || location.origin).replace(/\/$/, '');
  const body = orders.map((o) => {
    const cod = o.payment_method === 'cod' && o.payment_status !== 'paid';
    const pcs = (o.items || []).reduce((s, i) => s + i.qty, 0);
    return `<div class="lbl">
      <div class="hd"><b>${esc(store.name || 'DROVOX')}</b><span class="pay ${cod ? 'cod' : ''}">${cod ? `COD ${money(o.total)}` : 'PREPAID'}</span></div>
      <div class="to"><small>DELIVER TO</small><b>${esc(o.ship_name)}</b><div>${esc(o.ship_address)}</div><div>📞 ${esc(o.ship_phone)}</div></div>
      <div class="mid"><div><small>ORDER</small><svg data-bc="${esc(o.order_no)}" data-h="38" data-w="1.6" data-fs="12"></svg></div><div class="qr" data-qr="${esc(`${site}/#/track/${o.order_no}`)}"></div></div>
      ${o.awb ? `<div class="awb"><small>${esc(o.courier || 'COURIER')} · AWB</small><svg data-bc="${esc(o.awb)}" data-h="34" data-w="1.5" data-fs="12"></svg></div>` : '<div class="awb"><small>AWB: ______________________ &nbsp; Courier: ______________</small></div>'}
      <div class="meta">${pcs} pcs · ${(o.items || []).length} items${o.invoice_no ? ` · Inv ${esc(o.invoice_no)}` : ''}</div>
      <div class="from"><small>FROM</small> ${esc(store.legal_name || store.name || '')}, ${esc(store.address || '')}${store.support_phone ? ` · ${esc(store.support_phone)}` : ''}${store.gstin ? ` · GSTIN ${esc(store.gstin)}` : ''}</div>
    </div>`;
  }).join('');
  openPrint('Box labels', `@page{size:100mm 150mm;margin:0}
    .lbl{width:100mm;height:150mm;padding:4mm;display:flex;flex-direction:column;gap:2.5mm;page-break-after:always;font-size:9.5pt;overflow:hidden}
    small{display:block;font-size:7pt;letter-spacing:.08em;color:#333}
    .hd{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #000;padding-bottom:2mm;font-size:13pt}
    .pay{border:2px solid #000;padding:1mm 3mm;font-size:12pt;font-weight:700}.pay.cod{background:#000;color:#fff}
    .to{border:1.5px solid #000;padding:2.5mm;font-size:11pt;line-height:1.3}.to b{font-size:13pt;display:block}
    .mid{display:flex;justify-content:space-between;align-items:center;gap:3mm}.qr{width:24mm;height:24mm;flex:none}.qr svg{width:100%;height:100%}
    .awb{border-top:1px dashed #000;padding-top:2mm}.meta{font-size:9pt}.from{margin-top:auto;border-top:1px solid #000;padding-top:2mm;font-size:7.5pt}`, body);
}

/** Tag for a custom / made-to-order job, to stick on the finished box. */
export function printJobLabel(job, store) {
  openPrint(`Job ${job.job_no}`, `@page{size:100mm 50mm;margin:0}
    .lbl{width:100mm;height:50mm;padding:3mm;display:flex;flex-direction:column;justify-content:space-between;font-size:9pt}
    .hd{display:flex;justify-content:space-between;font-size:11pt}`,
  `<div class="lbl"><div class="hd"><b>${esc(store.name || 'DROVOX')} · CUSTOM ORDER</b><b>${esc(job.job_no)}</b></div>
    <div><b style="font-size:12pt">${esc(job.title)}</b>${job.qty > 1 ? ` × ${job.qty}` : ''}<br>For: ${esc(job.customer_name)} ${job.phone ? `· ${esc(job.phone)}` : ''}</div>
    <div style="display:flex;justify-content:space-between;align-items:flex-end"><svg data-bc="${esc(job.job_no)}" data-h="26" data-w="1.5" data-fs="10"></svg>
      <span>${job.price ? `Total ${money(job.price)}${job.advance ? ` · Paid ${money(job.advance)} · Due ${money(job.price - job.advance)}` : ''}` : ''}</span></div></div>`);
}
