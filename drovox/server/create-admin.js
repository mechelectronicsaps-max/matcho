// Creates an owner/admin account from the terminal, or resets the password of an existing account.
//   npm run create-admin                       (asks the questions)
//   npm run create-admin -- --email you@x.in --password secret123 --name "Your Name"
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { get, run } from './db.js';
import { hashPassword, makeReferralCode } from './auth.js';

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const rl = readline.createInterface({ input: stdin, output: stdout });
const ask = async (q, def) => (await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim() || def || '';

const email = (arg('email') || await ask('Login email')).trim();
if (!email.includes('@')) { console.error('A valid email is required.'); process.exit(1); }
const existing = get('SELECT * FROM users WHERE email = ?', email);
const name = existing ? existing.name : (arg('name') || await ask('Your name', 'Owner'));
const password = arg('password') || await ask(existing ? 'New password (8+ characters)' : 'Password (8+ characters)');
rl.close();
if (password.length < 8) { console.error('The password must be at least 8 characters.'); process.exit(1); }

if (existing) {
  run(`UPDATE users SET password_hash = ?, role = 'admin', active = 1 WHERE id = ?`, hashPassword(password), existing.id);
  console.log(`\n✅ Password reset. ${email} is an active admin.`);
} else {
  run(`INSERT INTO users(name, email, password_hash, role, referral_code, source) VALUES (?,?,?, 'admin', ?, 'setup')`, name, email, hashPassword(password), makeReferralCode(name));
  console.log(`\n✅ Admin account created for ${email}.`);
}
run(`INSERT INTO audit_logs(user_name, role, action, entity, details) VALUES ('terminal', 'system', ?, 'user', ?)`, existing ? 'user.password_reset' : 'user.create_admin', JSON.stringify({ email }));
console.log('Sign in at http://localhost:3000/master (and /stockist). Fill in shop details in Master → Settings → Store & GST.');
