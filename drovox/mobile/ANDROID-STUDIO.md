# Build the Drovox app with Android Studio (Windows)

Commands are for **PowerShell** or **Command Prompt**, run inside your `matcho` folder.

## 1. Install (one time)

1. **Android Studio:** download it from <https://developer.android.com/studio> and install with the **Standard** setup. This installs the Android SDK, an emulator and Java, and takes 15–30 minutes. Say **Yes** to the licence prompts.
2. **Node.js 22.13 or newer:** you already have it, because the store runs with it.

## 2. Get the latest code

```bash
git pull
```
```bash
cd drovox
```
```bash
npm install
```
```bash
cd mobile
```
```bash
npm install
```

## 3. Start your store on the laptop (for testing)

Open a **second** terminal in `matcho\drovox` and run:

```bash
npm start
```

Leave it running. The store is at http://localhost:3000.

## 4. Point the app at your store

In the first terminal, inside `drovox\mobile`, run **one** of these.

**A. Emulator** (a phone simulated in Android Studio). `10.0.2.2` is how the emulator reaches your laptop:

```bash
npm run sync -- http://10.0.2.2:3000
```

**B. Your real Android phone on the same Wi-Fi.** First find your laptop's address: run `ipconfig` and look for **IPv4 Address**, for example `192.168.1.5`. Then:

```bash
npm run sync -- http://192.168.1.5:3000
```

If Windows Firewall asks about Node.js, click **Allow** (Private networks).

**C. Your live website** (after hosting). This uses `siteUrl` from `app.config.json`, which must be `https://`:

```bash
npm run sync
```

The line `Drovox app → …` shows which address the app will open.

## 5. Open the project in Android Studio

```bash
npm run open
```

If that can't find Android Studio, open Android Studio yourself: **File → Open →** select the folder `matcho\drovox\mobile\android` → **OK**.

- The first time, Android Studio downloads Gradle and libraries. Wait for **"Gradle sync finished"** at the bottom (5–10 minutes).
- If it offers to **upgrade the Android Gradle Plugin**, choose **Don't remind me / Cancel**. The project is already set up for its Capacitor version.
- Open **only** the `android` folder, not `mobile` or `matcho`.

## 6. Run it

### On the emulator

1. Go to **Tools → Device Manager → + (Create Virtual Device)**.
2. Choose **Pixel 8 → Next**, then pick the newest system image and click the ⬇ to download it.
3. Click **Next → Finish**.
4. Select the Pixel 8 in the device list at the top and press the green **▶ Run 'app'**.

### On your phone (USB)

1. On the phone, go to **Settings → About phone** and tap **Build number** 7 times to turn on Developer options.
2. Go to **Settings → System → Developer options** and turn on **USB debugging**.
3. Connect the phone with a USB cable and tap **Allow** on the phone.
4. Select your phone in the device list in Android Studio and press **▶**.

The Drovox app appears on the phone with its icon and splash screen. It stays installed and can be opened without the laptop, but in test mode it needs your laptop store running.

## 7. When do I rebuild?

| You changed… | Do this |
|---|---|
| Website pages, products, prices, design (anything in `drovox/public` or `server`) | Nothing. Restart `npm start` if you changed server code, then pull down / reopen the app. |
| The address the app opens (step 4) | `npm run sync -- <address>`, then **▶** |
| `app.config.json`, app plugins, `google-services.json` | `npm run sync`, then **▶** |
| App icon, splash screen, Android settings (`android/` folder) | **▶** |

## 8. Debugging

- **Website inside the app:** with the app open on the emulator or phone, open **Chrome** on the laptop, go to `chrome://inspect`, find *Drovox* and click **inspect**. You get the normal DevTools (Console, Network).
- **App crashes:** in Android Studio, open **Logcat** (bottom bar) and filter by `in.drovox.app`.

## 9. Push notifications

1. Create the Firebase project and download `google-services.json` (see `README.md`, step 2).
2. Copy it to `matcho\drovox\mobile\android\app\google-services.json`.
3. Run `npm run sync`, then **▶**.
4. Sign in to the app. It asks permission to send notifications. Then place an order and change its status in the stockist panel: the phone gets a notification. Push only works when **Master → Settings → App & push** is filled in.

## 10. Make the Play Store file (signed .aab)

1. Set `siteUrl` in `app.config.json` to your live `https://` address. Raise `versionCode` by 1 for every upload (1, 2, 3…) and set `versionName` (for example `1.0.1`).
2. Run:

   ```bash
   npm run sync
   ```

3. In Android Studio, go to **Build → Generate Signed App Bundle / APK → Android App Bundle → Next**.
4. Under **Key store path**, click **Create new…**:
   - save it outside the project, for example `D:\keys\drovox-upload.jks`
   - set a password, alias `drovox`, validity 25 years, and your name and city
   - **Back up this file and the passwords.** Without them you can never update the app.
5. Click **Next →** choose **release → Create**.
6. The file is saved as `drovox\mobile\android\app\release\app-release.aab`. Upload it in **Google Play Console** (see `README.md`, step 6).

For a signed **APK** to share directly (WhatsApp, website download), repeat with **APK** instead of Android App Bundle.

## Common problems

| Problem | Fix |
|---|---|
| White screen or "Webpage not available" | The store isn't running (`npm start`), or the address in step 4 is wrong. On a phone, laptop and phone must be on the same Wi-Fi and the firewall must allow Node.js. |
| "You're offline" screen | Same as above. Check by opening the address in the phone's Chrome. |
| `SDK location not found` | **File → Project Structure → SDK Location**: set it to `C:\Users\<you>\AppData\Local\Android\Sdk`. |
| Gradle error about Java / JDK version | **File → Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK**: choose **jbr-21** (Android Studio's bundled JDK). |
| `npm run sync` says the site must use https | Release builds need your https site. http works only for `10.0.2.2`, `localhost` or `192.168.x.x` testing. |
| Changes in `app.config.json` don't show | Run `npm run sync` again, then **▶**. |
| Play Console: "version code already used" | Increase `versionCode` in `app.config.json`, run `npm run sync`, and build again. |
