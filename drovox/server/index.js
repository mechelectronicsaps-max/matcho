// Drovox server: storefront (/), stockist panel (/stockist), master panel (/master) and the JSON API (/api).
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { attachUser } from './auth.js';
import { store, razorpayWebhook } from './routes/store.js';
import { stock } from './routes/stock.js';
import { admin } from './routes/admin.js';
import { extras, servicesStaff, partnersAdmin } from './routes/extras.js';
import { content, contentAdmin, SITE_UPLOADS_DIR } from './routes/content.js';
import { startScheduler } from './services/jobs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, '..', 'public');
const BUILD = Date.now().toString(36);

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'SAMEORIGIN' });
    next();
  });
  // Razorpay webhooks are verified against the raw body, so this route comes before the JSON parser.
  app.post('/api/webhooks/razorpay', express.raw({ type: '*/*', limit: '1mb' }), razorpayWebhook);
  // Service requests carry design files (STL, Gerber, DXF…) as base64, so they get a larger limit.
  app.use('/api/services/requests', express.json({ limit: '130mb' }));
  app.use('/api/services/pcb', express.json({ limit: '40mb' }));
  app.use('/api/services/model', express.json({ limit: '90mb' }));
  app.use(['/api/jobs', '/api/admin/content'], express.json({ limit: '8mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', attachUser);
  app.use('/api/stock/services', servicesStaff);
  app.use('/api/stock', stock);
  app.use('/api/admin/partners', partnersAdmin);
  app.use('/api/admin/content', contentAdmin);
  app.use('/api/admin', admin);
  app.use('/api', extras);
  app.use('/api', content);
  app.use('/api', store);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // Label printing and scanning libraries, served locally so they work offline.
  const vendor = { 'jsbarcode.js': 'jsbarcode/dist/JsBarcode.all.min.js', 'qrcode.js': 'qrcode-generator/dist/qrcode.js', 'html5-qrcode.js': 'html5-qrcode/html5-qrcode.min.js', 'three.js': 'three/build/three.module.min.js' };
  for (const [name, file] of Object.entries(vendor)) app.get(`/vendor/${name}`, (_req, res) => res.sendFile(path.join(here, '..', 'node_modules', file), { headers: { 'Cache-Control': 'no-cache' } }));
  // no-cache = the browser must check with the server (cheap ETag check) before reusing a file,
  // so updated pages and scripts are picked up immediately after an upgrade.
  // Pages load their scripts and styles from /v/<build>/…, a new address every time the server starts,
  // so a browser can never keep running an outdated copy after an update.
  const page = (file) => (_req, res) => {
    const html = fs.readFileSync(path.join(PUBLIC, file), 'utf8')
      .replace(/(src|href)="\/(js|css)\//g, `$1="/v/${BUILD}/$2/`);
    res.set('Cache-Control', 'no-store').type('html').send(html);
  };
  for (const [route, file] of [['/', 'index.html'], ['/index.html', 'index.html'], ['/stockist', 'stockist.html'], ['/stockist.html', 'stockist.html'], ['/master', 'master.html'], ['/master.html', 'master.html']]) app.get(route, page(file));
  app.use('/v/:build', express.static(PUBLIC, { maxAge: '30d', immutable: true }));
  app.use('/uploads/site', express.static(SITE_UPLOADS_DIR, { maxAge: '7d' }));
  app.use(express.static(PUBLIC, { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));


  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}

/** Starts background jobs and listens. Used by `npm start` and by app.js (cPanel / Passenger). The database starts empty. */
export function start() {
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 22 || (maj === 22 && min < 13)) {
    console.error(`Drovox needs Node.js 22.13 or newer (this is ${process.versions.node}). Pick a newer version in your hosting's Node.js app settings.`);
    process.exit(1);
  }
  // On shared hosting the app sleeps when idle, so jobs run from cron instead (server/run-jobs.js).
  if (process.env.DROVOX_CRON_JOBS !== '1') startScheduler();
  const port = process.env.PORT || 3000; // Passenger passes its own PORT value
  return createApp().listen(port, () => {
    console.log(`Drovox running on port ${port}`);
    console.log('  Storefront /   ·   Stockist panel /stockist   ·   Master panel /master');
    console.log('  First run? Open /master to create the owner (admin) account.');
  });
}

// Compare as file URLs so this also works with Windows paths (C:\...).
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) start();
