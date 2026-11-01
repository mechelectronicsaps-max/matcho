// Drovox server: storefront (/), stockist panel (/stockist), master panel (/master) and the JSON API (/api).
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

if (import.meta.url === `file://${process.argv[1]}`) {
  seed();
  startScheduler();
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => {
    console.log(`Drovox running on http://localhost:${port}`);
    console.log(`  Storefront      http://localhost:${port}/`);
    console.log(`  Stockist panel  http://localhost:${port}/stockist   (stockist@drovox.in / stock123)`);
    console.log(`  Master panel    http://localhost:${port}/master     (admin@drovox.in / admin123)`);
  });
}
