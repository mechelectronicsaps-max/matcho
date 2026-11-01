// npm run sync [-- <site url>]       → Android
// npm run sync:ios [-- <site url>]   → iPhone
// Writes the config for that address and copies it into the native project.
import { execSync } from 'node:child_process';
const args = process.argv.slice(2);
const ios = args.includes('--ios');
const url = args.find((a) => !a.startsWith('--'));
execSync(`node scripts/configure.mjs${url ? ` ${JSON.stringify(url)}` : ''}`, { stdio: 'inherit' });
execSync(`npx cap sync ${ios ? 'ios' : 'android'}`, { stdio: 'inherit' });
