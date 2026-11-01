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
npm start            # http://localhost:3000 (seeds demo data on first run)
```

Requires Node.js 22.13+ (uses the built-in `node:sqlite`, no database server needed).

| Demo login | Email | Password |
|---|---|---|
| Customer | demo@drovox.in | demo123 |
| Stockist | stockist@drovox.in | stock123 |
| Admin (full access) | admin@drovox.in | admin123 |
| Marketing | marketing@drovox.in | market123 |
| Support | support@drovox.in | support123 |

`npm run reseed` wipes the database and loads fresh demo data. `npm test` runs the API test suite.
Change the demo passwords, or create new accounts in Master → Users and disable the demo ones, before going live.

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
| **WhatsApp Cloud API** | Phone number ID and permanent access token from Meta. Approve the templates `order_confirmed`, `order_shipped` and `order_delivered`, then turn on "Use approved templates" |
| **Claude AI** | Anthropic API key (or set `ANTHROPIC_API_KEY` on the server). The default model is `claude-opus-5-5` |
| **Store / GST** | Legal name, GSTIN, state code, support number and public URL |

Without these keys the site still works end to end: payments run in test mode, WhatsApp messages are recorded in the outbox as "simulated", and the AI builder falls back to a keyword-based planner.

Environment variables: `PORT` (default 3000), `DROVOX_SECRET` (session signing key; generated and stored if not set), `DROVOX_DATA_DIR` (database folder), `ANTHROPIC_API_KEY`.

## Project layout

```
drovox/
  server/
    index.js            Express app and routing
    db.js               SQLite schema, settings with defaults
    auth.js             scrypt passwords, signed tokens, roles and permissions, audit log
    pricing.js          bulk tiers, coupons, points, GST (CGST/SGST/IGST) quotation
    seed.js             demo catalogue, staff, customers, 45 days of orders and events
    routes/store.js     storefront and customer API, Razorpay webhook
    routes/stock.js     stockist API, landed-cost import batches
    routes/admin.js     master panel API
    services/orders.js  order lifecycle automation and GST invoice numbering
    services/engine.js  trending, recommendations, forecasting, RFM segments, lead scoring
    services/ai.js      Claude project builder (+ keyword fallback)
    services/whatsapp.js, payments.js, loyalty.js, jobs.js
  public/               storefront (index.html), stockist.html, master.html, css/, js/
  test/api.test.js      end-to-end API tests
```

## Production notes
- Run the app behind HTTPS (Nginx or Caddy) and set `DROVOX_SECRET`.
- Back up `data/drovox.db`, the single SQLite file. For very high traffic the same schema ports cleanly to Postgres.
- Product images are category icons for now. Add an image upload or CDN field when you have product photos.
- Have your CA review the GST figures before filing. Import IGST credit is an estimate until you enter Bill of Entry values.
