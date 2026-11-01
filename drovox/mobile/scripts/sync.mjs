// npm run sync [-- <site url>]  → writes the config for that address and copies it into the Android project.
import { execSync } from 'node:child_process';
const url = process.argv[2] ? ` ${JSON.stringify(process.argv[2])}` : '';
execSync(`node scripts/configure.mjs${url}`, { stdio: 'inherit' });
execSync('npx cap sync android', { stdio: 'inherit' });
