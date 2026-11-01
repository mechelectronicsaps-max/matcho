# Drovox Android app (iOS next)

The app is a **Capacitor** shell around the live Drovox store, with native features on top:

- **Always up to date:** the store, cart, checkout (Razorpay), accounts, services and DIY projects load from your live site, so every website update reaches the app with no Play Store release.
- **Push notifications:** every WhatsApp update (order confirmed, shipped, out for delivery, delivered, service quote, ready…) also arrives as an app notification, and tapping it opens that order.
- **Android back button:** it closes a dialog first, then goes back a page, and leaves the app from the home page.
- **App links:** a Drovox link tapped in WhatsApp or Chrome opens in the app.
- **Native share sheet** on product and project pages.
- **Look and offline:** splash screen, status bar in brand colours, and an offline screen with *Try again*.
- **No app badges in the app:** the "Get the app" badges are hidden inside the app.

**App look:** inside the app the store switches to an app layout:
- purple header with a search box whose suggestions change every few seconds, plus Wishlist and Notifications buttons
- floating bottom tabs: **Home · Categories · Cart · Account**
- a **Categories** grid of orange tiles; add photos in **Stockist → Categories → 📷 Photo**
- an **Account** page with quick actions (Orders, Wishlist, Drovox Points, Track Order) and menus for shopping, services, help and policies
- **Notifications**, **My Waitlist** and **Saved Addresses** pages
- an app-style empty cart, plus the Blogs rail and YouTube banner on the home page

These pages come from the website (`public/js/appshell.js`), so changing them needs **no new app build**. To preview the app layout in any browser, open `http://localhost:3000/?app=1` (and `?app=0` to switch back).

Package name: `in.drovox.app` · Settings: `app.config.json`

---

## 1. Set your live site

Edit `app.config.json` → `siteUrl` (for example `https://drovox.in`). It must be **https**. For release builds you can also set the GitHub secret `DROVOX_URL`.

## 2. Firebase (for push notifications)

1. Go to <https://console.firebase.google.com> → **Add project** → name it *Drovox*.
2. **Add app → Android**, package name `in.drovox.app`, then download **google-services.json**.
3. Go to **Project settings → Service accounts → Generate new private key**. This downloads a JSON file.
4. In **Master → Settings → App & push**, fill in:
   - *Firebase project ID* = `project_id`
   - *client email* = `client_email`
   - *private key* = `private_key` (the whole `-----BEGIN PRIVATE KEY-----` block)
   - tick **Send app push notifications**.

Without Firebase the app still works; push is simply turned off.

## 3. Upload key (one time, keep it safe)

```bash
keytool -genkeypair -v -keystore drovox-upload.jks -alias drovox -keyalg RSA -keysize 2048 -validity 10000
```

Back up the `.jks` file and its passwords. If you lose them you cannot update the app.

## 4. GitHub secrets

Go to the repository → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `DROVOX_URL` | `https://your-domain` |
| `GOOGLE_SERVICES_JSON` | the whole content of `google-services.json` |
| `ANDROID_KEYSTORE_BASE64` | output of `base64 -w0 drovox-upload.jks` (on Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("drovox-upload.jks"))`) |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | `drovox` |
| `ANDROID_KEY_PASSWORD` | key password |

## 5. Build

- **Test APK:** every push that changes `drovox/mobile` builds one. Go to **Actions → Drovox Android app → the latest run → Artifacts**, download it, copy the `.apk` to an Android phone and install it (allow "install unknown apps").
- **Play Store build:** go to **Actions → Drovox Android app → Run workflow** (keep *Signed release* ticked). The artifact contains `app-release.aab` (for Play) and a signed `app-release.apk`.

The version code is the workflow run number, so each build is accepted by Play. Change `versionName` in `app.config.json` for each release (for builds from Android Studio, also raise `versionCode`).

### Build on your laptop with Android Studio

Step-by-step for Windows: **[ANDROID-STUDIO.md](ANDROID-STUDIO.md)**. In short: `npm install`, then `npm run sync -- http://10.0.2.2:3000` (emulator) or `npm run sync` (live site), then `npm run open`, then press ▶.

## 6. Google Play

1. Create a developer account at <https://play.google.com/console> (one-time fee) and click **Create app**.
2. Upload `app-release.aab` to **Internal testing** first, then **Production**.
3. **Store listing:** use `store-assets/play-icon-512.png` and `store-assets/feature-graphic-1024x500.png`, plus 4–8 phone screenshots.
4. **Privacy policy URL:** `https://your-domain/#/policy/privacy`.
5. **Data safety form:** you collect name, phone, email, address and order history (for orders and account management), and push tokens (for notifications). Data is encrypted in transit; users can ask for deletion.
6. **App links:**
   - Go to **Play Console → Setup → App signing** and copy the **SHA-256** of the *App signing key*. Also copy your upload key's SHA-256 if you install builds directly.
   - Paste them in **Master → Settings → App & push → Android signing SHA-256**.
   - Drovox serves them at `/.well-known/assetlinks.json`.
7. Put the Play link in **Master → Settings → Website → Android app link**, so the store footer badge points to it.

## iPhone (iOS)

No Mac needed. Step-by-step from Windows: home-screen app (free, today), Sideloadly test install, or TestFlight / App Store — see **[IPHONE.md](IPHONE.md)**. GitHub builds the iPhone app on a cloud Mac (`.github/workflows/drovox-ios.yml`).
