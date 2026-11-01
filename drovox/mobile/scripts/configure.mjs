// Writes capacitor.config.json and the Android app-link host from app.config.json.
// Override for a build:  DROVOX_URL=https://shop.example.in npm run sync
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'app.config.json'), 'utf8'));
const site = (process.env.DROVOX_URL || cfg.siteUrl).replace(/\/+$/, '');
let u; try { u = new URL(site); } catch { throw new Error(`Invalid site URL: ${site}`); }
if (u.protocol !== 'https:' && !['localhost', '10.0.2.2'].includes(u.hostname) && !u.hostname.startsWith('192.168.')) throw new Error('The live site must use https://');

// Push needs Firebase (android/app/google-services.json). Without it, PushNotifications.register() would crash,
// so the web code only enables push when the user agent carries "DrovoxPush".
const hasFirebase = fs.existsSync(path.join(root, 'android', 'app', 'google-services.json'));
const cap = {
  appId: cfg.appId,
  appName: cfg.appName,
  webDir: 'www',
  server: {
    url: site,                       // the app shows the live store, so every website update is in the app at once
    cleartext: u.protocol === 'http:', // only for testing against a laptop on the same Wi-Fi
    errorPath: 'offline.html',        // shown when there is no internet
    allowNavigation: [u.hostname],
  },
  appendUserAgent: `DrovoxApp/${cfg.versionName}${hasFirebase ? ' DrovoxPush' : ''}`,
  android: { backgroundColor: cfg.themeColor },
  plugins: {
    SplashScreen: { launchShowDuration: 1500, launchAutoHide: true, backgroundColor: cfg.themeColor, showSpinner: false, androidScaleType: 'CENTER_CROP' },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
    StatusBar: { backgroundColor: cfg.themeColor, style: 'DARK', overlaysWebView: false },
  },
};
fs.writeFileSync(path.join(root, 'capacitor.config.json'), `${JSON.stringify(cap, null, 2)}\n`);
// app-link host + version for Gradle (read by android/app/build.gradle)
fs.writeFileSync(path.join(root, 'app.gradle.properties'), `drovoxHost=${u.hostname}\ndrovoxVersionName=${cfg.versionName}\n`);
console.log(`Drovox app → ${site} (host ${u.hostname}, ${cfg.appId} v${cfg.versionName}, push ${hasFirebase ? 'on' : 'off — add android/app/google-services.json'})`);
