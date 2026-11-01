// Drovox server: storefront (/), stockist panel (/stockist), master panel (/master) and the JSON API (/api).
import express from 'express';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { attachUser } from './auth.js';
import { store, razorpayWebhook } from './routes/store.js';
import { stock } from './routes/stock.js';
import { admin } from './routes/admin.js';
import { seed } from './seed.js';
import { startScheduler } from './services/jobs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, '..', 'public');

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
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', attachUser);
  app.use('/api/stock', stock);
  app.use('/api/admin', admin);
  app.use('/api', store);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  app.use(express.static(PUBLIC, { extensions: ['html'], maxAge: '1h' }));
  app.get('/stockist', (_req, res) => res.sendFile(path.join(PUBLIC, 'stockist.html')));
  app.get('/master', (_req, res) => res.sendFile(path.join(PUBLIC, 'master.html')));
  app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}

/** Seeds on first run, starts background jobs and listens. Used by `npm start` and by app.js (cPanel / Passenger). */
export function start() {
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 22 || (maj === 22 && min < 13)) {
    console.error(`Drovox needs Node.js 22.13 or newer (this is ${process.versions.node}). Pick a newer version in your hosting's Node.js app settings.`);
    process.exit(1);
  }
  seed();
  // On shared hosting the app sleeps when idle, so jobs run from cron instead (server/run-jobs.js).
  if (process.env.DROVOX_CRON_JOBS !== '1') startScheduler();
  const port = process.env.PORT || 3000; // Passenger passes its own PORT value
  return createApp().listen(port, () => {
    console.log(`Drovox running on port ${port}`);
    console.log('  Storefront /   ·   Stockist panel /stockist   ·   Master panel /master');
  });
}

// Compare as file URLs so this also works with Windows paths (C:\...).
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) start();
