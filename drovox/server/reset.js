// Deletes the database (ALL products, orders, customers and settings). Requires --yes.
//   npm run reset -- --yes
// Does not import db.js so nothing holds the file open. Stop the server before running it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.env.DROVOX_DB || path.join(process.env.DROVOX_DATA_DIR || path.join(here, '..', 'data'), 'drovox.db');
if (!process.argv.includes('--yes')) {
  console.log(`This permanently deletes ${file} — every product, order, customer and setting.`);
  console.log('Stop the server, back up the file if needed, then run:  npm run reset -- --yes');
  process.exit(1);
}
for (const f of [file, file + '-wal', file + '-shm']) fs.rmSync(f, { force: true });
console.log('Removed', file, '- the next start begins with an empty shop.');
