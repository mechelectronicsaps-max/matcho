// Legal pages required by Razorpay (and Indian e-commerce rules): Privacy, Terms, Shipping & Delivery,
// Cancellation & Refund, Contact Us and About Us. Business details come from Master → Settings → Store / Website,
// so the pages always match the name, address and contacts on the bank / Razorpay account.
import { esc } from './common.js';

const fmtDate = (d) => { const t = new Date(d); return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }); };

export const POLICY_PAGES = [
  ['privacy', 'Privacy Policy'], ['terms', 'Terms & Conditions'], ['shipping', 'Shipping & Delivery Policy'],
  ['refunds', 'Cancellation & Refund Policy'], ['contact', 'Contact Us'], ['about', 'About Us'],
];

export function policyPage(slug, S) {
  const st = S.cfg.store || {}; const site = S.site.site || {}; const ship = S.cfg.shipping || {};
  const brand = esc(st.name || 'Drovox'); const legal = esc(st.legal_name || st.name || 'Drovox');
  const who = st.legal_name && st.legal_name !== st.name ? `${legal} (trading as ${brand})` : legal;
  const email = st.support_email ? `<a class="link" href="mailto:${esc(st.support_email)}">${esc(st.support_email)}</a>` : '';
  const phone = st.support_phone ? `<a class="link" href="tel:${esc(String(st.support_phone).replace(/[^\d+]/g, ''))}">${esc(st.support_phone)}</a>` : '';
  const reach = [email, phone].filter(Boolean).join(' / ') || 'the contact details on our <a class="link" href="#/policy/contact">Contact Us</a> page';
  const addr = st.address ? esc(st.address) : '';
  const city = esc(st.jurisdiction_city || 'the city of our registered office');
  const returnDays = Number(site.return_days ?? 7); const refundDays = esc(site.refund_days || '5–7 business days');
  const dispatch = esc(site.dispatch_days || '1–2 business days'); const delivery = esc(site.delivery_days || '2–7 business days');
  const grievance = `${st.grievance_officer ? `<b>${esc(st.grievance_officer)}</b>, Grievance Officer<br>` : ''}${legal}${addr ? `<br>${addr}` : ''}<br>Email: ${st.grievance_email ? `<a class="link" href="mailto:${esc(st.grievance_email)}">${esc(st.grievance_email)}</a>` : email || '—'}${phone ? `<br>Phone: ${phone}` : ''}<br>Hours: ${esc(site.support_hours || 'Mon–Sat, 10 AM – 7 PM')}`;
  const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

  const P = {
    privacy: `<p>This Privacy Policy explains how <b>${who}</b> (“${brand}”, “we”, “us”) collects, uses, shares and protects your personal data when you use our website, place an order or request a service. We process personal data in line with the Information Technology Act, 2000 and the Digital Personal Data Protection Act, 2023.</p>
      <h3>1. Information we collect</h3><ul>
        <li><b>Account &amp; order details:</b> name, mobile / WhatsApp number, email, billing and delivery address, GSTIN (if you give one) and order history.</li>
        <li><b>Service files:</b> design files you upload (Gerber, STL, STEP, DXF, photos) and the specifications you choose.</li>
        <li><b>Optional details:</b> date of birth or anniversary (only if you add them, for greetings and offers).</li>
        <li><b>Payment information:</b> payments are processed by our payment partner <b>Razorpay</b>. Card, UPI and net-banking credentials are entered on Razorpay's secure, PCI-DSS compliant pages — we never see or store your full card number, CVV, UPI PIN or banking passwords. We only receive the payment status, amount and a transaction reference.</li>
        <li><b>Technical data:</b> device and browser type, pages viewed, items in your cart and IP address, used to run and secure the site.</li></ul>
      <h3>2. How we use your information</h3><ul>
        <li>To process orders and service requests, collect payment, ship products and provide support.</li>
        <li>To send order, payment, shipping and delivery updates by WhatsApp, SMS or email.</li>
        <li>To issue GST invoices and meet tax, accounting and legal obligations.</li>
        <li>To prevent fraud and misuse, and to improve our products and website.</li>
        <li>To send offers, rewards and greetings — you can opt out at any time.</li></ul>
      <h3>3. Cookies and local storage</h3><p>We use essential browser storage to keep you signed in and to remember your cart, wishlist and preferences. We do not use third-party advertising cookies.</p>
      <h3>4. Sharing of information</h3><p>We do <b>not</b> sell or rent your personal data. We share only what is needed with: payment processors (Razorpay) to complete payments and refunds; courier and logistics partners to deliver your order; messaging providers to send order updates; and government or law-enforcement authorities when required by law.</p>
      <h3>5. Data retention</h3><p>We keep order and invoice records for as long as tax laws require (generally 8 years). Other personal data is kept while your account is active or as needed to provide our services, and is deleted or anonymised afterwards.</p>
      <h3>6. Security</h3><p>Our website uses HTTPS encryption. Passwords are stored in hashed form, and access to customer data is limited to authorised staff and logged.</p>
      <h3>7. Your rights</h3><p>You may access, correct or update your information from <a class="link" href="#/account">My Account</a>, or ask us to delete your account and data, withdraw consent for marketing, or nominate another person to act for you, by writing to ${reach}. We respond within 30 days.</p>
      <h3>8. Children</h3><p>Our website is meant for users aged 18 and above. Younger users may use it only with the involvement of a parent or guardian.</p>
      <h3>9. Grievance Officer</h3><p>${grievance}</p>
      <h3>10. Changes</h3><p>We may update this policy from time to time. The latest version is always on this page with its date.</p>`,

    terms: `<p>These Terms &amp; Conditions govern your use of this website and all purchases from <b>${who}</b>${addr ? `, ${addr}` : ''}${st.gstin ? ` (GSTIN ${esc(st.gstin)})` : ''}. By using the website or placing an order you agree to these terms.</p>
      <h3>1. Eligibility &amp; account</h3><p>You must be 18 or older (or use the site with a parent or guardian) and give accurate details. You are responsible for keeping your login secure and for activity on your account.</p>
      <h3>2. Products, prices &amp; GST</h3><ul><li>All prices are in Indian Rupees (₹) and <b>include GST</b> unless stated otherwise. A GST invoice is provided with every order.</li>
        <li>We try to show accurate descriptions, images and specifications; small variations in colour, packaging or manufacturer may occur. Datasheet values are typical values.</li>
        <li>Prices and availability can change without notice. If a product was listed at a wrong price, we may cancel the order and refund you in full.</li></ul>
      <h3>3. Orders</h3><p>An order is confirmed when payment succeeds (or, for cash on delivery, when we accept it). We may refuse or cancel an order for stock unavailability, pricing errors, suspected fraud or an undeliverable address; any amount paid is refunded in full.</p>
      <h3>4. Payments</h3><p>Online payments (UPI, cards, net banking, wallets) are processed securely by <b>Razorpay</b>. Cash on delivery is available on eligible orders up to ${money(ship.cod_max_order)}${ship.cod_fee ? ` with a COD fee of ${money(ship.cod_fee)}` : ''}. We are not responsible for charges levied by your bank.</p>
      <h3>5. Shipping, cancellation &amp; refunds</h3><p>Delivery is covered by our <a class="link" href="#/policy/shipping">Shipping &amp; Delivery Policy</a>, and cancellations, returns and refunds by our <a class="link" href="#/policy/refunds">Cancellation &amp; Refund Policy</a>, which form part of these terms.</p>
      <h3>6. Fabrication services</h3><p>Online prices for PCB manufacturing, 3D printing, laser cutting and battery packs are estimates. We review your files and send a final quote; production starts only after you approve it. You confirm that you own or may use the designs you upload and that they do not infringe anyone's rights.</p>
      <h3>7. Safe use</h3><p>Our products are components and kits for education, prototyping and development. Use them as per the datasheet and safety practice — especially lithium batteries, chargers, high-voltage and mains-powered circuits. We are not liable for damage caused by incorrect wiring, misuse or modification.</p>
      <h3>8. Rewards, coupons &amp; referrals</h3><p>Reward points, coupons and referral bonuses have no cash value, cannot be transferred, may expire, and may be withdrawn if misused.</p>
      <h3>9. Intellectual property</h3><p>The ${brand} name, logo and website content belong to ${legal}. Product names and brands belong to their owners.</p>
      <h3>10. Limitation of liability</h3><p>To the extent permitted by law, our total liability for any claim relating to an order is limited to the amount paid for that order. We are not liable for indirect or consequential losses.</p>
      <h3>11. Governing law</h3><p>These terms are governed by the laws of India. Disputes are subject to the exclusive jurisdiction of the courts at ${city}.</p>
      <h3>12. Grievances &amp; contact</h3><p>${grievance}</p>`,

    shipping: `<p>This policy explains how <b>${who}</b> ships orders placed on this website.</p>
      <h3>1. Where we deliver</h3><p>We deliver to most PIN codes across India through trusted courier partners. We do not ship outside India at present.</p>
      <h3>2. Dispatch time</h3><p>In-stock orders are packed and dispatched within <b>${dispatch}</b> of order confirmation (Sundays and public holidays excluded). Fabrication services (PCBs, 3D prints, laser cutting, battery packs) are dispatched after production, within the lead time shown on the service page and in your quote.</p>
      <h3>3. Delivery time</h3><p>After dispatch, delivery usually takes <b>${delivery}</b> depending on your location — metro cities are faster, remote areas and the North-East can take longer. These timelines are estimates; delays due to courier, weather or other events beyond our control may occur.</p>
      <h3>4. Shipping charges</h3><p>Shipping is <b>free on orders above ${money(ship.free_above)}</b>. Below that, a flat fee of ${money(ship.flat_fee)} applies. ${ship.cod_fee ? `Cash on delivery orders have an extra COD fee of ${money(ship.cod_fee)}. ` : ''}All charges are shown at checkout before you pay.</p>
      <h3>5. Tracking</h3><p>Once your order ships you receive the courier name and tracking number on WhatsApp / SMS / email. You can also follow it on our <a class="link" href="#/track">Track order</a> page or in <a class="link" href="#/orders">My orders</a>.</p>
      <h3>6. Damaged or tampered parcels</h3><p>Please do not accept a parcel that is visibly damaged or tampered with. If you notice damage after opening, contact us within <b>48 hours</b> of delivery with photos and an unboxing video.</p>
      <h3>7. Failed delivery</h3><p>If the courier cannot deliver after its attempts (wrong address, unreachable phone or refusal), the parcel is returned to us. Prepaid orders are then refunded after deducting the shipping charges; we can also re-ship on payment of fresh shipping charges.</p>
      <h3>8. Batteries</h3><p>Lithium cells and battery packs above 100 Wh are shipped by surface transport only and may take longer.</p>
      <h3>9. Contact</h3><p>For any delivery question write to ${reach}.</p>`,

    refunds: `<p>This policy explains how you can cancel an order, return a product and get a refund from <b>${who}</b>.</p>
      <h3>1. Cancelling an order</h3><ul>
        <li><b>Before packing:</b> you can cancel any order for a <b>full refund</b> from <a class="link" href="#/orders">My orders</a>. Once it is packed but not yet shipped, contact us and we will cancel it if the courier has not collected it.</li>
        <li><b>After dispatch:</b> the order cannot be cancelled; you may refuse delivery or request a return as below (shipping charges are not refunded).</li>
        <li><b>Fabrication services:</b> can be cancelled free of charge until you approve the quote. Once production has started, custom-made items cannot be cancelled.</li>
        <li>We may cancel an order if an item is out of stock, wrongly priced or the order looks fraudulent; you receive a full refund.</li></ul>
      <h3>2. Returns &amp; replacements</h3><p>You can request a return or replacement within <b>${returnDays} days of delivery</b> if the product is:</p>
        <ul><li>damaged or defective on arrival (dead on arrival),</li><li>different from what you ordered, or</li><li>missing parts.</li></ul>
        <p>Please share your order number, photos and, where possible, an unboxing video. Items must be unused, unsoldered and in the original packaging with all accessories.</p>
      <h3>3. Items that cannot be returned</h3><ul><li>Products that have been soldered, programmed, modified, wired incorrectly, burnt or physically damaged after delivery.</li>
        <li>Consumables (solder, filament, wires cut to length), opened ICs and sensitive electronic components unless defective on arrival.</li>
        <li>Custom PCBs, 3D prints, laser-cut parts and battery packs made to your design — unless they do not match the approved specification.</li></ul>
      <h3>4. How refunds work</h3><ul>
        <li>Once we receive and inspect the returned item (or approve a cancellation), we confirm the refund by WhatsApp / email.</li>
        <li><b>Approved refunds are credited within ${refundDays} to the original payment method</b> (UPI, card, net banking or wallet) through Razorpay. Your bank may take a few additional days to show it.</li>
        <li>Cash-on-delivery orders are refunded to your bank account or UPI ID within ${refundDays} of approval.</li>
        <li>Shipping and COD fees are refunded when the mistake is ours (wrong, damaged or defective item).</li></ul>
      <h3>5. How to request</h3><p>Contact us at ${reach} with your order number within ${returnDays} days of delivery. We arrange a reverse pickup where available, or share the return address.</p>`,

    contact: `<p>We are happy to help with orders, payments, deliveries, returns and technical questions.</p>
      <div class="grid g2" style="margin-top:12px">
        <div class="card flat"><h3 style="margin-top:0">Business details</h3><p><b>${legal}</b>${st.legal_name && st.legal_name !== st.name ? `<br>Trading as ${brand}` : ''}${st.business_type ? `<br>${esc(st.business_type)}` : ''}${addr ? `<br>${addr}` : ''}${st.gstin ? `<br>GSTIN: ${esc(st.gstin)}` : ''}</p></div>
        <div class="card flat"><h3 style="margin-top:0">Customer support</h3><p>${email ? `Email: ${email}<br>` : ''}${phone ? `Phone / WhatsApp: ${phone}<br>` : ''}Hours: ${esc(site.support_hours || 'Mon–Sat, 10 AM – 7 PM')}</p><a class="btn sm" href="#/support">Support page</a></div>
      </div>
      <h3>Grievance Officer</h3><p>${grievance}</p><p class="small muted">We acknowledge complaints within 48 hours and resolve them within 30 days.</p>`,

    about: `<p><b>${brand}</b> is an Indian online store for electronic components, development boards, sensors, robotics and drone parts, tools and DIY kits for students, makers, engineers, schools and industry. We import directly from manufacturers, test in India and ship across the country with a GST invoice.</p>
      <p>We also offer fabrication services — PCB manufacturing, industrial and FDM 3D printing, metal and non-metal laser cutting and custom lithium battery packs — with instant online estimates.</p>
      <p>${brand} is operated by <b>${legal}</b>${addr ? `, ${addr}` : ''}.</p>
      <p><a class="link" href="#/policy/contact">Contact us</a> · <a class="link" href="#/bulk">Bulk &amp; institutional orders</a> · <a class="link" href="#/partner">Become a partner</a></p>`,
  };
  const key = P[slug] ? slug : slug === 'returns' ? 'refunds' : 'terms';
  const title = POLICY_PAGES.find(([k]) => k === key)[1];
  const updated = fmtDate(site.policy_updated);
  return { title, html: `<div class="policy-wrap"><nav class="policy-nav card">${POLICY_PAGES.map(([k, t]) => `<a href="#/policy/${k}" class="${k === key ? 'on' : ''}">${t}</a>`).join('')}</nav>
    <article class="card prose policy"><h1>${title}</h1>${updated ? `<p class="small muted">Last updated: ${updated}</p>` : ''}${P[key]}</article></div>` };
}

/** Accepted-payment badges (simple vector marks, no external images). */
export function paymentBadges() {
  const b = (label, svg) => `<span class="pay-badge" title="${label}" aria-label="${label}">${svg}</span>`;
  return [
    b('UPI', '<svg viewBox="0 0 64 24"><path d="M6 4l5 8-5 8" fill="none" stroke="#097939" stroke-width="3.2" stroke-linejoin="round"/><path d="M11 4l5 8-5 8" fill="none" stroke="#ed752e" stroke-width="3.2" stroke-linejoin="round"/><text x="21" y="17.5" font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="800" font-style="italic" fill="#5f6368">UPI</text></svg>'),
    b('Visa', '<svg viewBox="0 0 64 24"><text x="32" y="18" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="17" font-weight="900" font-style="italic" fill="#1a1f71" letter-spacing=".5">VISA</text></svg>'),
    b('Mastercard', '<svg viewBox="0 0 64 24"><circle cx="26" cy="12" r="9" fill="#eb001b"/><circle cx="38" cy="12" r="9" fill="#f79e1b"/><path d="M32 5.3a9 9 0 0 1 0 13.4 9 9 0 0 1 0-13.4z" fill="#ff5f00"/></svg>'),
    b('RuPay', '<svg viewBox="0 0 64 24"><text x="4" y="17" font-family="Arial,Helvetica,sans-serif" font-size="14" font-weight="900" font-style="italic" fill="#1b3f8b">RuPay</text><path d="M50 5l8 7-8 7z" fill="#f47920"/><path d="M47 5l8 7-8 7z" fill="#00964b" opacity=".9"/></svg>'),
    b('Net banking', '<svg viewBox="0 0 64 24"><path d="M6 9l8-5 8 5z M7 10h14v1.6H7z M8 12.5h2v5H8z M13 12.5h2v5h-2z M18 12.5h2v5h-2z M6 18.5h16V20H6z" fill="#334155"/><text x="25" y="11" font-family="Arial,Helvetica,sans-serif" font-size="7.5" font-weight="700" fill="#334155">NET</text><text x="25" y="19.5" font-family="Arial,Helvetica,sans-serif" font-size="7.5" font-weight="700" fill="#334155">BANKING</text></svg>'),
    b('Cash on delivery', '<svg viewBox="0 0 64 24"><rect x="4" y="6" width="20" height="12" rx="2" fill="#16a34a"/><circle cx="14" cy="12" r="3.2" fill="#dcfce7"/><text x="28" y="16.5" font-family="Arial,Helvetica,sans-serif" font-size="11" font-weight="800" fill="#166534">COD</text></svg>'),
    b('Secured by Razorpay', '<svg viewBox="0 0 64 24"><path d="M10 4l3-1 3 1v5c0 4-3 6-3 6s-3-2-3-6z" fill="#3395ff" transform="translate(-2 4)"/><text x="18" y="10" font-family="Arial,Helvetica,sans-serif" font-size="6" fill="#64748b">Secured by</text><text x="18" y="19" font-family="Arial,Helvetica,sans-serif" font-size="9.5" font-weight="800" fill="#0b2c5f">Razorpay</text></svg>'),
  ].join('');
}
