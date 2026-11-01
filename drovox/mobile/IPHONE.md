# Drovox on iPhone (from a Windows PC)

Apple only lets apps onto an iPhone if they are signed, and the normal build tool (Xcode) runs only on a Mac. You have three ways that work from Windows:

| | Option | Cost | Install | Updates | Good for |
|---|---|---|---|---|---|
| **1** | **Home-screen app (Safari)** | Free | 30 seconds | Automatic | Using and showing the app today |
| **2** | **Real app via Sideloadly** | Free Apple ID | 10 minutes | Re-install every 7 days | Testing the native app yourself |
| **3** | **TestFlight → App Store** | Apple Developer Program, US$99/year | From TestFlight / App Store | Automatic | Customers and your team |

---

## Option 1 — Home-screen app (works right now)

The store is an installable web app. Opened from the home screen it runs full screen, without Safari's address bar, with the purple header and bottom tabs.

1. On the iPhone, open **Safari** and go to your store, for example `https://drovox.in`.
   - **For testing:** connect the iPhone to the same Wi-Fi as your laptop and open `http://192.168.x.x:3000`. Find the address with `ipconfig` → *IPv4 Address*. Keep `npm start` running.
2. Tap **Share** (□↑) → **Add to Home Screen** → **Add**.
3. Open **Drovox** from the home screen.

Website updates show up straight away. (On Android Chrome the same thing appears as **Install app**.)

---

## Option 2 — The real iPhone app with Sideloadly (free, 7-day)

GitHub builds the iPhone app on a Mac in the cloud for you. You then sign it with your own Apple ID on Windows.

### A. Get the .ipa
1. Go to GitHub → **Actions** → **Drovox iOS app** → **Run workflow**. Leave *TestFlight* unticked.
   - Put your site in **Site the app opens**: your live `https://…` site, or for testing `http://192.168.x.x:3000`. If you leave it blank, the `DROVOX_URL` secret or `app.config.json` is used.
2. When it's green, open the run → **Artifacts** → download **drovox-ios-N** → unzip to get `Drovox-unsigned.ipa`.

### B. Install it with Sideloadly
1. Install **iTunes for Windows from apple.com** (not the Microsoft Store version) so Windows can talk to the iPhone.
2. Install **Sideloadly** from <https://sideloadly.io>.
3. Connect the iPhone by USB, unlock it and tap **Trust this computer**.
4. In Sideloadly, drag in `Drovox-unsigned.ipa`, enter your Apple ID, and click **Start**. Use a spare Apple ID if you prefer.
5. On the iPhone:
   - Go to **Settings → Privacy & Security → Developer Mode → On**. The phone restarts.
   - Then go to **Settings → General → VPN & Device Management →** your Apple ID **→ Trust**.
6. Open **Drovox**.

Limits of a free Apple ID: the app stops opening after **7 days** (re-install it with Sideloadly), at most 3 sideloaded apps, and **no push notifications**.

---

## Option 3 — TestFlight and the App Store (for customers)

1. Join the **Apple Developer Program** at <https://developer.apple.com/programs/>, using your business (D-U-N-S number) or individual account.
2. In **App Store Connect → Apps → +**, create the app. Platform iOS, name *Drovox*, bundle ID `in.drovox.app`. Register it under *Certificates, Identifiers & Profiles → Identifiers* if it isn't listed.
3. Create an API key: go to **App Store Connect → Users and Access → Integrations → App Store Connect API → +**. Give it the *App Manager* role, then download `AuthKey_XXXX.p8` (you can download it only once).
4. Add these GitHub secrets (*Settings → Secrets and variables → Actions*):

   | Secret | Value |
   |---|---|
   | `APPLE_TEAM_ID` | Team ID (developer.apple.com → Membership details) |
   | `ASC_KEY_ID` | Key ID shown next to the key |
   | `ASC_ISSUER_ID` | Issuer ID at the top of the keys page |
   | `ASC_KEY_P8` | the whole content of `AuthKey_XXXX.p8` |
   | `DROVOX_URL` | your live `https://` store |

5. Go to **Actions → Drovox iOS app → Run workflow**, tick **TestFlight** and run it. GitHub signs the app and uploads it.
6. After 10–30 minutes it appears in **App Store Connect → TestFlight**:
   - Add yourself as a tester and install the **TestFlight** app on the iPhone. You can then install Drovox, and it doesn't expire after 7 days.
   - To go live, fill in the App Store listing and submit for review. Use your privacy policy (`/#/policy/privacy`), screenshots, and `store-assets/play-icon-512.png` as a reference.

Push notifications on iPhone need an APNs key from your developer account, linked to Firebase. That's the next step once the developer account exists.

---

### Notes
- The iPhone app and the Android app share the same code (`drovox/mobile`). Website changes appear in both without a new build.
- **Update the iPhone project** after changing `app.config.json` or plugins: run `npm run sync:ios`, commit, then let GitHub build it.
- **App Store review** wants more than a website in a frame. This app already has native push, share, offline screen, splash and app navigation, which helps.
