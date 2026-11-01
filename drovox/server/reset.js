// Deletes the database files (used by `npm run reseed`). Does not import db.js so nothing holds the file open.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = process.env.DROVOX_DB || path.join(process.env.DROVOX_DATA_DIR || path.join(here, '..', 'data'), 'drovox.db');
for (const f of [file, file + '-wal', file + '-shm']) fs.rmSync(f, { force: true });
console.log('Removed', file);
