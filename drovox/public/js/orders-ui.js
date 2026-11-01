// Order detail / fulfilment modal shared by the stockist and master panels.
import { $, $$, api, esc, money, toast, modal, badge, dt, art, formData, printInvoice } from './common.js';

const NEXT_LABEL = { confirmed: '✓ Confirm', packed: '📦 Mark packed', shipped: '🚚 Ship', out_for_delivery: '🛵 Out for delivery', delivered: '✅ Delivered', cancelled: '✕ Cancel', returned: '↩ Return' };

export async function openOrder(base, id, onChange) {
  const o = await api(`${base}/orders/${id}`);
  const m = modal(`<div class="row between"><div><h2 style="margin:0">${esc(o.order_no)}</h2><div class="small muted">${dt(o.created_at)} · ${esc(o.payment_method.toUpperCase())} · ${esc(o.payment_status)}${o.invoice_no ? ` · ${esc(o.invoice_no)}` : ''}</div></div>${badge(o.status, o.status_label)}</div>
    <div class="grid g2" style="margin-top:14px">
      <div class="card flat"><b>Ship to</b><div>${esc(o.ship_name)} · <a class="link" href="tel:${esc(o.ship_phone)}">${esc(o.ship_phone)}</a></div><div class="small muted">${esc(o.ship_address)}</div>${o.gstin ? `<div class="small">GSTIN ${esc(o.gstin)}</div>` : ''}${o.notes ? `<div class="small" style="margin-top:6px">📝 ${esc(o.notes)}</div>` : ''}
        ${o.awb ? `<div class="small" style="margin-top:6px">🚚 ${esc(o.courier)} · <span class="code">${esc(o.awb)}</span></div>` : ''}</div>
      <div class="card flat"><div class="row between"><span>Items total</span><b>${money(o.subtotal, 2)}</b></div>${o.discount ? `<div class="row between small"><span>Coupon ${esc(o.coupon_code)}</span><span>−${money(o.discount, 2)}</span></div>` : ''}
        ${o.points_redeemed ? `<div class="row between small"><span>Points</span><span>−${o.points_redeemed}</span></div>` : ''}<div class="row between small"><span>Shipping + COD</span><span>${money(o.shipping + o.cod_fee, 2)}</span></div>
        <div class="row between"><b>Total</b><b>${money(o.total, 2)}</b></div><div class="small muted">Taxable ${money(o.taxable, 2)} · ${o.igst ? `IGST ${money(o.igst, 2)}` : `CGST ${money(o.cgst, 2)} + SGST ${money(o.sgst, 2)}`}</div></div>
    </div>
    <div class="table-wrap" style="margin-top:12px"><table class="t"><thead><tr><th></th><th>Item</th><th>SKU</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>
      ${o.items.map((i) => `<tr><td>${art(i, 'xs')}</td><td>${esc(i.name)}</td><td class="code">${esc(i.sku)}</td><td class="r"><b>${i.qty}</b></td><td class="r">${money(i.unit_price)}</td><td class="r">${money(i.total, 2)}</td></tr>`).join('')}</tbody></table></div>
    <div id="ship-form" class="hidden card flat" style="margin-top:12px"><form class="form two"><label class="f">Courier<select name="courier">${['Delhivery', 'Blue Dart', 'DTDC', 'Ekart', 'XpressBees', 'India Post', 'Shiprocket'].map((c) => `<option>${c}</option>`).join('')}</select></label>
      <label class="f">AWB / tracking no. (auto if blank)<input name="awb"></label><button class="btn primary full">Confirm shipment & notify customer</button></form></div>
    <div class="row" style="margin-top:14px">${o.next.map((s) => `<button class="btn ${s === 'cancelled' || s === 'returned' ? 'danger' : 'primary'}" data-to="${s}">${NEXT_LABEL[s]}</button>`).join('')}
      ${o.invoice_no ? '<button class="btn" id="inv">🧾 Invoice</button>' : ''}<button class="btn" id="slip">🏷️ Packing slip</button></div>
    <h3 style="margin-top:18px">Timeline</h3><ul class="timeline">${o.events.map((e) => `<li><b>${esc(e.note || e.status)}</b><div class="small muted">${dt(e.created_at)}</div></li>`).join('')}</ul>`, { wide: true });

  const move = async (to, extra = {}) => {
    if ((to === 'cancelled' || to === 'returned') && !confirm(`Mark ${o.order_no} as ${to}? Stock will be returned to inventory.`)) return;
    try { await api(`${base}/orders/${id}/status`, { method: 'POST', body: { to, ...extra } }); toast(`${o.order_no} → ${to.replace(/_/g, ' ')} · customer notified on WhatsApp`); m.close(); onChange?.(); } catch (e) { toast(e.message, 'err'); }
  };
  $$('[data-to]', m.el).forEach((b) => { b.onclick = () => (b.dataset.to === 'shipped' ? $('#ship-form', m.el).classList.remove('hidden') : move(b.dataset.to)); });
  $('#ship-form form', m.el).onsubmit = (e) => { e.preventDefault(); move('shipped', formData(e.target)); };
  $('#inv', m.el)?.addEventListener('click', async () => {
    // staff reuse the customer invoice endpoint (staff are allowed to read any order)
    printInvoice(await api(`/orders/${o.order_no}/invoice`));
  });
  $('#slip', m.el).onclick = () => packingSlip(o);
}

function packingSlip(o) {
  const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to print', 'err');
  w.document.write(`<!doctype html><meta charset="utf-8"><title>Packing slip ${esc(o.order_no)}</title><style>body{font:14px system-ui;margin:24px;background:#fff;color:#111}table{width:100%;border-collapse:collapse}td,th{border:1px solid #999;padding:6px;text-align:left}h1{margin:0}</style>
    <h1>DROVOX — Packing slip</h1><p><b>${esc(o.order_no)}</b> · ${esc(dt(o.created_at))} · ${o.payment_method === 'cod' && o.payment_status !== 'paid' ? `<b>COLLECT ₹${o.total.toFixed(2)} (COD)</b>` : 'PREPAID'}</p>
    <p><b>Ship to:</b> ${esc(o.ship_name)}, ${esc(o.ship_address)} · ${esc(o.ship_phone)}</p>
    <table><tr><th>✔</th><th>SKU</th><th>Item</th><th>Qty</th></tr>${o.items.map((i) => `<tr><td></td><td>${esc(i.sku)}</td><td>${esc(i.name)}</td><td><b>${i.qty}</b></td></tr>`).join('')}</table>
    <p>Packed by: ____________ &nbsp; Checked by: ____________</p><button onclick="print()">Print</button>`);
  w.document.close();
}
