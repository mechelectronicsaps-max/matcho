# Drovox — electronics & robotics components store

Drovox is a complete e-commerce platform for a business that imports electronic components
from China and sells them online in India. Indian stores such as Robu.in, Hubtronics and Robotics DNA
sell the same kind of products. Everything runs as one Node.js app with three interfaces:

| Interface | URL | Who uses it |
|---|---|---|
| **Storefront** | `/` | Customers: browse, AI project builder, cart, checkout, tracking, rewards |
| **Stockist panel** | `/stockist` | Warehouse: dispatch queue, products and stock, China import batches, reorder planning |
| **Master panel** | `/master` | Owners and staff: analytics, CRM, marketing, GST, WhatsApp, users, audit trail, automation, settings |

## Quick start

```bash
cd drovox
npm install
npm start            # http://localhost:3000
```

Requires Node.js 22.13+ (uses the built-in `node:sqlite`, no database server needed).

**The shop starts empty** — no demo products, customers or orders. On first start:

1. Open **http://localhost:3000/master**. You'll see a setup screen: enter your shop name, GSTIN, address, and your owner login. This creates the admin account.
2. Open **/stockist** (the same login works) → **Categories & SKU codes**. Add your categories, or click "Add starter categories" for the standard electronics list.
3. **Products & stock → + Add product**. The Drovox SKU is generated for you (`DRV-SEN-0001`, `DRV-SEN-0002`, …).
4. **Labels & stickers**: print barcode/QR stickers. **Scan stock in / out**: receive stock with a USB scanner or the phone camera.
5. **Master → Users & roles**: create logins for stockists, marketing and support staff.

| Command | What it does |
|---|---|
| `npm start` | Runs the shop |
| `npm test` | Automated tests (each uses its own temporary database) |
| `npm run create-admin` | Creates an owner/admin login from the terminal, or resets a forgotten password |
| `npm run jobs` | Runs the background automations once (for cron on shared hosting) |
| `npm run demo` | **Optional:** loads a sample catalogue with fake orders, only into an empty catalogue. For trying things out, never on your real shop |
| `npm run reset -- --yes` | **Deletes the whole database.** Stop the server and back up `data/drovox.db` first |

Your data lives in a single file, `drovox/data/drovox.db`. Back it up.

## Stock panel tools

- **Drovox SKU codes.** Every category has a short code (Sensors → `SEN`). New products get `<prefix>-<code>-<serial>`, e.g. `DRV-SEN-0007`. The prefix `DRV` can be changed in Settings → Store. You can still type your own SKU.
- **Barcode & QR scanning** (Scan stock in / out):
  - USB or Bluetooth handheld scanners work out of the box: click the box and scan. Repeat scans add up.
  - The phone/laptop camera reads barcodes and QR codes. The camera needs `http://localhost` or `https://`.
  - A scan finds the product by its Drovox SKU, the manufacturer's EAN/UPC barcode, or the QR on Drovox labels. Scanning an order number opens the order; scanning a custom-job number shows the job.
  - Every scan is logged in the stock history and the audit trail.
- **Printing:**
  - Product stickers: 50×25 mm and 38×25 mm thermal, 100×50 mm with QR, or A4 sheets of 21. Each has a Code128 barcode, the MRP and the SKU.
  - Box / shipping labels (100×150 mm): COD or prepaid, delivery address, an order barcode, a tracking QR, the AWB barcode, and the sender's address with GSTIN.
  - Also: the GST invoice, a packing slip, the pick list, and custom-order tags.
- **Custom orders** (made-to-order kits, assemblies, PCBs):
  - Record the customer, what to make, the price and the advance paid.
  - The job moves Pending → In progress → **Ready** → Delivered.
  - Marking a job **Ready** sends the customer a WhatsApp message with the balance due.

## Storefront layout (robu.in-style)

- **Top bar:** toll-free / support number, Customer Support, free-shipping note and social links. Set these in Master → Settings → Website.
- **Header:** logo with tagline, a search box with a Search button, Compare (up to 4 products), Orders, Account, Wishlist and Cart.
- **Menu:**
  - an **All Categories** dropdown
  - Home, Shop, Services, Bulk Enquiry, New Arrivals, **ATL Kits Enquiry**, Blogs, **BOM Tool**, AI Builder and Careers
  - a **Sell on Drovox** button, which opens the partner form with the brand/seller type selected
  - Blogs and Careers only appear once you publish something
- **Home page:** four service tiles (PCB, 3D Printing, Laser Cutting, Custom Battery Pack) beside a **banner slider**.
  - Manage banners in Master → **Website content → Home banners**: a text banner, or an uploaded image with a link.
  - Then come categories, trending items, the six **service cards with Order now**, deals, new arrivals, and the **reviews** section.
  - The reviews section appears only once you add real reviews in Website content → Reviews. You can link your Google Business review page.
- **New pages:**
  - Compare: price, bulk tiers, stock and every spec side by side.
  - Wishlist.
  - **BOM Tool:** paste or upload a parts list with quantities. It matches each line to the catalogue, using bulk prices, and adds everything to the cart.
  - **ATL Kits Enquiry:** goes to the CRM as an "atl" lead, with WhatsApp messages to the school and to you.
  - Blog, Careers (with résumé upload, viewed in Website content → Job applications) and Customer Support.

## Services (like robu.in services)

Storefront → **Services** (`/#/services`) offers six services:
- **Industrial 3D printing and online FDM 3D printing:** see *3D printing online ordering* below.
- **Metal laser cutting** and **non-metal laser cutting:** see *Laser cutting online ordering* below.
- **Customized lithium-ion battery packs.**
- **Non-metal laser cutting:** acrylic 2–8 mm in colours, MDF, plywood, cardboard, leather and EVA foam.
- **PCB manufacturing (robu.in / JLCPCB style):** see *PCB online ordering* below.

Each service page lists its materials and capabilities. A battery pack can be built new (18650 / 21700 / LiFePO4, series × parallel, BMS, connector; the page shows voltage, Ah, Wh and weight) or an existing pack can be tested and repaired.
- **For customers:**
  - The page shows an instant estimate from editable rates (Master → Settings → Services).
  - Customers can upload design files (STL, Gerber ZIP, DXF/SVG/PDF and so on; up to 5 files of 20 MB each).
  - They get a WhatsApp confirmation, and can approve the final quote in **My Account → My service requests**.
- **For staff, in Stockist panel → Service jobs:**
  - Check the specification and download the files.
  - Set the final price and lead time, then **send the quote on WhatsApp**.
  - Move the job to Approved → In production → Ready → Delivered. The customer gets a WhatsApp message at each step.
- **Battery packs** are priced with BIS-registered cells bought in India.
- **Big packs:** packs over 100 Wh are flagged as surface shipping only.

### 3D printing online ordering with built-in 3D viewer (robu.in style)
- **Upload the model first** (STL, STEP/STP, 3MF or OBJ, up to 60 MB; drag-and-drop works). The server reads it — STEP is triangulated with OpenCascade — and the page shows a **rotatable 3D view** in the chosen colour, with size (X × Y × Z), volume, surface area, triangle count and a watertight check.
- **Industrial:** choose the 3D technology — SLA (resin), MJF (nylon), SLM (metal), SLS (nylon), WJP (multi-jet resin), BJ (binder-jet metal) — then the material. Each material shows key features, heat deflection, tolerance, applications and notes, plus its colours and finishes. Price = volume × material rate × finish + setup (metal has its own setup charge and 10–15 day lead time).
- **FDM:** PLA, PETG, ABS or TPU with colour, quality and infill. Grams are worked out from the model's volume and surface (1.2 mm walls + infill + ~8% supports).
- The price shows "Upload a model to see the price" until a model is uploaded. Parts bigger than the machine's build volume are flagged. The quantity has − / + buttons.
- The server measures the model again when the order is placed, so the price can't be changed in the browser. Staff see the model's numbers and a **3D view** in **Stockist panel → Service jobs**.
- Material properties are typical values — edit them in `server/services/print-materials.js`; rates (₹/cm³, ₹/g) are in **Master → Settings → Services**.

### Laser cutting online ordering (robu.in style)
- Upload one **DXF** (mm or inch — pick the File unit). The server measures the overall size, total cut length, number of pierces (separate shapes) and part area, and draws a preview in the material colour. Open lines and ignored text are flagged.
- Step 1 **Material**: metal swatches per thickness (MS, SS304, aluminium, brass, GI) or acrylic (with colours), MDF, plywood, cardboard, leather, EVA foam. Step 2 **Finalize**: bends and finish (deburring, powder coating) for metal, engraving area for non-metal, quantity, remark.
- Price = sheet area + cutting length + pierces (+ bends / finish / engraving). It shows nothing until a DXF is uploaded; the server measures the DXF again when the order is placed. Staff see the drawing preview in the job.

### Custom battery pack builder
- Choose the cell (18650 2600 / 3000 HD, 21700 4000 / 5000, LiFePO4 32700) with its datasheet card, then the target voltage (series count) and target Ah (parallel count is worked out), then BMS, connector, wire length, casing (heat-shrink / ABS / aluminium), NTC sensor and charger.
- A live pack drawing shows the S×P layout; voltage range, Ah, Wh, max continuous current (limited by cells or BMS), approximate size and weight update with the price. A warning appears when the cells can't supply the BMS current, and packs over 100 Wh are flagged for surface shipping. There is also a *Test / repair my pack* mode.

### PCB online ordering with built-in Gerber viewer
- **Upload Gerber ZIP first.** The server unzips it, detects each layer, measures the board outline and renders **Top / Bottom** views right on the page. Width, height and layer count are filled in automatically, with warnings (no outline, no drill file, odd layer count).
- **All options priced automatically:** base material FR-4 or aluminium (1-layer), 1/2/4/6 layers, quantity, different designs, delivery format (single / panel by customer / panel by Drovox), thickness 0.4–2.0 mm, mask colour (incl. matte), HASL / lead-free HASL / ENIG, 1 or 2 oz copper, via covering (tented / untented / plugged), minimum hole, gold fingers, castellated holes, impedance control (4+ layers), remove order number, stencil, assembly, standard or express build. The estimate shows the price with GST, build days and board weight.
- An order cannot be placed without the Gerber ZIP (max 25 MB).
- The price summary shows ₹0 until a Gerber is uploaded; then it is calculated automatically.
- **Viewer:** Top / Bottom views in the chosen mask colour and finish (ENIG shows gold), plus a **3D view** (drag to rotate, scroll to zoom) with the real board outline and thickness. Loose or out-of-order outline segments are joined automatically; if the outline is not closed, the full rectangle is shown with a warning.
- Options are shown as buttons (like robu.in / JLCPCB) instead of drop-downs.
- Default rates are placeholders. Set your real rates in **Master → Settings → Services**.
- **Stockist panel → Service jobs** has a separate tab for each service (3D printing, metal laser, battery, laser cutting, PCB…), with open-job counts, plus status tabs. The PCB job shows the Gerber Top/Bottom view and flags any mismatch between the detected and ordered size or layers.

## Become a Partner

Storefront → **Become a Partner** (`/#/partner`) is for:
- resellers and dealers
- schools, colleges and Atal Tinkering Labs
- makerspaces and academies
- integrators
- affiliates and creators

How it works:
1. **Apply:** the customer applies from their account. Each application also creates a CRM lead.
2. **Approve:** in Master → **Partners**, approve or reject it and set the discount. Defaults are in Settings → Partners: reseller 10%, institution 8%, makerspace 8%, integrator 7%, affiliate 5%. The partner is told on WhatsApp.
3. **Discount:** an approved partner's discount comes off automatically at checkout, before any coupon. It shows in the cart and on the order, and the GST invoice is calculated on the reduced price.
4. **Manage:** discounts can be changed or revoked at any time. Every decision is recorded in the audit trail.

## Product photos, AI listings and speed
- **Photos:** Stockist panel → Products → Edit → *Photos*: add up to 5 (3–5 recommended), reorder with ◀ ▶, delete with ✕; the first is the main photo. The browser resizes each photo to 360 / 900 / 1600 px WebP before upload, so uploads are small and no image library is needed on the server. Photos are served from `/img/p/` with a one-year cache.
- **Storefront:** cards load the small size lazily; the product page has a gallery with thumbnails, hover zoom, swipe on phones and a full-screen viewer.
- **✨ Fill with AI:** in the product form, type the name (and brand), click *Fill with AI* — Claude writes the short description, highlights, description, specifications, what's in the box, search tags and HSN. Review, then save. Needs the Claude API key in Master → Settings → AI.
- **Speed:** gzip compression for pages and API, a 30-second cache for the public config/categories/site/services data (cleared on any staff change), long caching for versioned JS/CSS and library files, and extra database indexes.

## Footer, app badges and policies (Razorpay-ready)
The footer has Shop, Services, Help, Policies and Contact columns, social links, App Store / Google Play badges ("Coming soon" until you add the links in **Master → Settings → Website**) and accepted-payment badges (UPI, Visa, Mastercard, RuPay, net banking, COD, Razorpay). Staff and stockist logins are not linked from the store — open `/stockist` and `/master` directly.

Policy pages (all linked in the footer, with a side menu): **Privacy Policy** `#/policy/privacy`, **Terms & Conditions** `#/policy/terms`, **Shipping & Delivery** `#/policy/shipping`, **Cancellation & Refunds** `#/policy/refunds`, **Contact Us** `#/policy/contact`, **About Us** `#/policy/about`. Checkout shows a line that placing the order accepts these policies.

**Before applying to Razorpay**, fill these in **Master → Settings**, because the pages use them:
- *Store & GST*: legal business name (exactly as on your bank / Razorpay account), business type, registered address, GSTIN, support phone and email, jurisdiction city, grievance officer name and email.
- *Website*: return window, dispatch time, delivery time, refund time, support hours, "policies last updated" date.
Have the wording reviewed by your CA / lawyer before going live.

## Customer data & greetings

- Customers can save their birthday, anniversary and city in their account. Staff can add walk-in, phone or WhatsApp customers in **Master → Customers → + Add customer** (no email needed), including birthday, anniversary, notes and WhatsApp consent.
- **Master → Greetings** lists upcoming birthdays and anniversaries. An hourly job sends the WhatsApp wish once per year per occasion, after the hour you choose. You can also press "Send now".
  - Edit the messages, and add an optional gift coupon, in Settings → Greetings.
- Festival wishes (Diwali, Holi, New Year, Eid, Christmas and others) are ready-made templates in **Marketing → WhatsApp campaigns**.

## Benchmarked features (Robu / Hubtronics / Robotics DNA style)

- A catalogue grouped by category (dev boards, sensors, motors, drone parts, power, displays, IoT, mechanical, tools, 3D printing, LEDs) with specs, HSN codes and GST-inclusive prices.
- **Bulk tier pricing** per product (e.g. 1+ ₹399, 5+ ₹379, 10+ ₹359), applied automatically in the cart.
- A GST invoice for every order. Business buyers can enter their GSTIN.
- Free-shipping threshold, COD with a handling fee, and same-day dispatch messaging.
- Bulk and college quote requests, which flow straight into the CRM.

## What's built

### Customer storefront
- Search that corrects typos ("arduno" finds "arduino"), live suggestions, filters and sorting.
- Product pages with a bulk-tier selector, real social proof (people viewing now, units sold in 24h, buyers this month), "frequently bought together" bundles, similar items, and back-in-stock alerts on WhatsApp.
- **✨ AI Project Builder (Claude).** A customer describes an idea, for example "2 line follower robots, budget ₹3000". Claude picks compatible in-stock SKUs from the live catalogue, sets the quantities, lists any missing parts and gives build steps. One click puts everything in the cart. Builds over ₹5,000 automatically become CRM leads.
- A cart with free-shipping progress, "add N more for the bulk price" nudges, coupons, loyalty-point redemption and a full GST breakdown (CGST+SGST within the seller's state, IGST otherwise).
- Checkout with saved addresses and a GSTIN option. Payments go through **Razorpay** (UPI, cards, netbanking) or **COD**. Until Razorpay keys are added, a test mode simulates payment.
- Order pages show a progress tracker, the timeline and courier AWB. Customers can print the GST invoice, cancel, or reorder with "buy again". Anyone can track an order with the order number plus the last 4 digits of the phone number.
- Account page with points, tier progress, daily check-in streak, referral code with WhatsApp share, and points history.

### Algorithms that keep people on the site and buying more
| Algorithm | How it works |
|---|---|
| Trending | Weighted signals (view 1, cart 4, checkout 5, purchase 8) that lose half their weight every 72h, plus a 7-day vs previous-7-day growth figure |
| Frequently bought together | Co-purchase pairs ranked by lift, with a fallback to the same category and shared tags |
| Recommended for you | Blends the visitor's category interest, co-purchase neighbours of what they viewed or carted, and trending items. Skips anything they already bought |
| Nudges | Free-shipping gap, next bulk tier, low-stock urgency, exit-intent welcome offer |
| Loyalty | Points per ₹100, tier multipliers (Maker → Builder → Engineer), redemption capped at a % of the order, daily check-in with a 7-day streak bonus |
| Referrals | The friend gets bonus points at signup. The referrer is paid when the friend's first order is **delivered**, which blocks fake signups |
| Win-back | Abandoned-cart WhatsApp reminder with a comeback coupon; RFM segments (champion, loyal, recent, at-risk, lost, browser) for campaigns |

### Stockist panel
- Overview of orders to pack and ship, in transit and placed today, plus stock alerts and stock value.
- Fulfilment queue by status with bulk actions (pack all, ship all with a courier). A pick list totals quantities across orders, and each order has a printable packing slip. Shipping takes a courier and AWB and notifies the customer.
- Product create and edit with bulk tiers, specs, HSN and GST rate, and a live margin calculator. Stock adjustments record a reason and a full movement history.
- **China import batches.** Enter CNY/USD unit cost, FX rate, freight, customs duty % and clearing charges. The **landed cost per unit** is allocated by value, and margins are shown against the selling price. Receiving a batch adds the stock, updates the weighted-average cost and sends back-in-stock alerts.
- **Reorder planning.** Daily demand = 60% × the 7-day rate + 40% × the 30-day rate. Days of cover is compared with supplier lead time plus safety days. The suggested quantity is net of stock already incoming, and one click turns the suggestions into an import batch.

### Master panel
- **Dashboard:** revenue, orders, AOV, gross margin, conversion, repeat rate (each with change vs the previous period), daily revenue, funnel, trending items, top products, low-stock list for trending items, category, state and hour-of-day breakdowns, top searches.
- **Orders:** filter, export to CSV, and take any action on any order.
- **Customers (CRM 360):** RFM segment, lifetime value, orders, favourite products, current cart, WhatsApp history, send a WhatsApp message, adjust points.
- **CRM pipeline:** kanban board from New to Won/Lost with lead scores (0–100), owners, follow-up dates and an activity log (notes, calls, WhatsApp). Leads arrive automatically from bulk quotes and the AI builder.
- **Marketing:** coupons (percent, flat or free shipping, minimum order, first order only, usage limits, revenue attributed), WhatsApp campaigns to RFM segments with `{name}`/`{points}` placeholders, abandoned carts, referral and points-liability stats, and the AI-builder idea log.
- **GST reports:** rate-wise totals, B2C by state (GSTR-1 Table 7), B2B invoices (Table 4), HSN summary (Table 12), shipping under SAC 996812, and an estimate of import IGST input credit. Each table exports to CSV.
- **WhatsApp:** outbox with delivery status and test sends.
- **Users & roles:** add staff. Roles: admin (everything), marketing, support, stockist and customer. The sidebar and the API both enforce what each role can open.
- **Audit trail:** every staff action is logged and searchable, with secrets redacted (logins, order moves, product, price and stock changes, settings, campaigns, points).
- **Automation:** order-workflow overview, background jobs with run-now, and **settings** for the store and GST registration, payments, WhatsApp, Claude AI, shipping, courier, loyalty, engagement and inventory.

### Automated order flow
`checkout → stock reserved → paid (Razorpay signature / webhook) or COD auto-confirmed → GST invoice DRV/2026-27/00001 → WhatsApp confirmation → stockist packs → ships with AWB (WhatsApp with tracking) → out for delivery → delivered (COD collected, points credited, referral bonus released)`.
Unpaid online orders are auto-cancelled after 30 minutes and their stock is released. A cancellation or return restores stock, refunds redeemed points and reverses earned points.

## Going live — integrations to configure (Master → Settings)

| Integration | What to enter |
|---|---|
| **Razorpay** | Key ID and secret from dashboard.razorpay.com. Add a `payment.captured` webhook pointing to `https://YOUR-DOMAIN/api/webhooks/razorpay` with a webhook secret |
| **WhatsApp (msg.myrc.in)** | Settings → WhatsApp: tick Enable, provider "msg.myrc.in gateway", paste your gateway API key, save. Then on the WhatsApp page press **Device status** (or **Connect / show QR** to link the phone). The server calls the gateway directly (`POST /send-message`, `/device/status`, `/device/connect`, `/messages/pending`, `/messages/logs`), so the separate PHP file is not needed. Meta's WhatsApp Cloud API is also supported as an alternative |
| **Claude AI** | Anthropic API key (or set `ANTHROPIC_API_KEY` on the server). The default model is `claude-opus-5-5` |
| **Store / GST** | Legal name, GSTIN, state code, support number and public URL |

Without these keys the site still works end to end: payments run in test mode, WhatsApp messages are recorded in the outbox as "simulated", and the AI builder falls back to a keyword-based planner.

Environment variables: `PORT` (default 3000), `DROVOX_SECRET` (session signing key; generated and stored if not set), `DROVOX_DATA_DIR` (database folder), `ANTHROPIC_API_KEY`.

## Deploying on Linux shared hosting (cPanel / hPanel)

1. **Check Node.js support.** In cPanel, look for **Setup Node.js App**. On Hostinger it's hPanel → Advanced → Node.js. You need **Node.js 22.13 or newer** in its version list. If there's no Node.js option at all, or only older versions, see "No Node.js?" below.
2. **Upload the code.** Zip the `drovox` folder **without** `node_modules` and `data`, then upload it to your home directory (e.g. `/home/USER/drovox`, *not* inside `public_html`) with File Manager and extract it. Or use `git clone` if your host offers Git/SSH.
3. **Create the app** in Setup Node.js App:
   - Node.js version: 22.x (22.13+)
   - Application mode: Production
   - Application root: `drovox`
   - Application URL: your domain (or a subdomain such as `shop.yourdomain.com`)
   - Application startup file: `app.js`
   - Environment variables: `DROVOX_CRON_JOBS=1`, `DROVOX_SECRET=<a long random string>`, and optionally `ANTHROPIC_API_KEY`
4. Click **Run NPM Install**, then **Restart**. Open your domain. The first start creates the database and demo data in `drovox/data/`.
5. **Add a cron job** (cPanel → Cron Jobs, every 10 minutes) so the automations run even when the site is idle. cPanel's Node.js page shows the path to `node` in its "enter the virtual environment" command (`/home/USER/nodevenv/drovox/22/bin`):
   ```
   */10 * * * * cd /home/USER/drovox && /home/USER/nodevenv/drovox/22/bin/node --no-warnings server/run-jobs.js >> data/jobs.log 2>&1
   ```
6. Turn on **SSL** (AutoSSL / Let's Encrypt) for the domain, then in Master → Settings → Store set the public URL to `https://yourdomain`.
7. **Secure it.** Log in at `/master`, create your own admin account in Users & roles, and disable the demo accounts (or reset their passwords).
8. **Backups:** download `drovox/data/drovox.db` regularly, or include it in your host's backup.

After code updates, upload the changed files and press **Restart** in Setup Node.js App.

**No Node.js?** PHP-only shared hosting can't run this app. Options, cheapest first:
- Ask your host to enable Node.js, or upgrade to a plan that has it.
- Get a small **VPS** (1 GB RAM, about ₹400–800/month, e.g. Hostinger KVM 1, DigitalOcean or AWS Lightsail in Mumbai). Run `npm install && npm start` behind Nginx with PM2. Keep your domain on the current host and point an A record at the VPS.
- Or use a Node.js platform such as Render or Railway with a persistent disk for `data/`.

## Project layout

```
drovox/
  server/
    index.js            Express app and routing
    db.js               SQLite schema, settings with defaults
    auth.js             scrypt passwords, signed tokens, roles and permissions, audit log
    pricing.js          bulk tiers, coupons, points, GST (CGST/SGST/IGST) quotation
    catalog.js          categories, Drovox SKU generator
    seed.js             OPTIONAL demo data (npm run demo) and test fixtures
    routes/store.js     storefront and customer API, Razorpay webhook
    routes/stock.js     stockist API, landed-cost import batches
    routes/admin.js     master panel API
    services/orders.js  order lifecycle automation and GST invoice numbering
    services/engine.js  trending, recommendations, forecasting, RFM segments, lead scoring
    services/ai.js      Claude project builder (+ keyword fallback)
    services/whatsapp.js msg.myrc.in gateway + Meta Cloud API
    services/greetings.js birthday & anniversary greetings
    services/payments.js, loyalty.js, jobs.js
  public/               storefront (index.html), stockist.html, master.html, css/, js/ (labels.js printing, scanner.js camera)
  test/                 end-to-end API tests (demo-data flow + fresh-install flow)
```

## Production notes
- Run the app behind HTTPS (Nginx or Caddy) and set `DROVOX_SECRET`.
- Back up `data/drovox.db`, the single SQLite file. For very high traffic the same schema ports cleanly to Postgres.
- Product images are category icons for now. Add an image upload or CDN field when you have product photos.
- Have your CA review the GST figures before filing. Import IGST credit is an estimate until you enter Bill of Entry values.
