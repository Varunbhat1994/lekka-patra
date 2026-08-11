# Lekka Patra — Android APK via Bubblewrap (TWA)

This folder contains everything you need to wrap the existing **Lekka Patra** PWA
(`https://field-crew-log-1.preview.emergentagent.com`) into a real Android APK
using **Bubblewrap** — Google's official Trusted Web Activity tool.

Total time: **~30 minutes** the first time (mostly waiting for downloads).

---

## What you get
- A signed `.apk` you can sideload on your phone for testing
- A signed `.aab` you can upload to Google Play later
- Fullscreen, no browser URL bar (because we wire up Digital Asset Links)
- Your Lekka Patra icon + green splash screen
- Razorpay, Google Sign-In, OTP, WhatsApp share, PDF/Excel export — all keep working (it's still your PWA underneath)

---

## Prerequisites (install once on your computer)

1. **Node.js 18 or higher** — https://nodejs.org
2. **Java JDK 17** — https://adoptium.net (Bubblewrap needs this for `keytool` and signing)
   - After install, verify: `java -version` should say `17.x`
3. **Android SDK / Android Studio** — https://developer.android.com/studio
   - During install, keep the default "Android SDK", "SDK Command-Line Tools", and "Android SDK Build-Tools" checked
4. **Bubblewrap CLI**:
   ```bash
   npm install -g @bubblewrap/cli
   ```

> On first run, Bubblewrap will offer to auto-download the JDK + Android SDK for you if it can't find them. Say **yes** — it's the easiest path.

---

## Step 1 — Get the files from Emergent

Download two files from this repo:

- `mobile/twa-manifest.json`  → save into an **empty folder** on your computer, e.g. `~/lekka-patra-android/`
- (Optional) `frontend/public/.well-known/assetlinks.json` — already served live at
  `https://field-crew-log-1.preview.emergentagent.com/.well-known/assetlinks.json`. You'll edit its fingerprint in Step 4.

Open a terminal inside that folder:
```bash
cd ~/lekka-patra-android
```

---

## Step 2 — Initialize the Android project

```bash
bubblewrap init --manifest=./twa-manifest.json
```

- When it asks about the signing key, choose **"Create a new one"** (default).
- It will create `android.keystore` in the same folder. **Back this file up** — you'll need the exact same keystore for every future update, otherwise Play Store won't accept the new version.
- Passwords: pick two strong ones and **write them down** (Bubblewrap will ask for them on every build).

This step scaffolds a full Android Gradle project in the folder.

---

## Step 3 — Build the APK

```bash
bubblewrap build
```

Bubblewrap will:
1. Compile the Android app
2. Ask for your keystore password + key password
3. Produce:
   - `app-release-signed.apk`  ← **install this on your phone**
   - `app-release-bundle.aab`  ← for Play Store upload later

Also printed at the end:
```
SHA-256 Certificate Fingerprint:
XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX
```
👉 **Copy this fingerprint.** You need it in the next step.

---

## Step 4 — Wire up Digital Asset Links (removes URL bar)

Without this step your APK works, but shows a Chrome address bar at the top.
To make it fullscreen (TWA verified), you must publish your APK's SHA-256
fingerprint on your web domain.

1. Edit `/app/frontend/public/.well-known/assetlinks.json` in the Emergent codebase
2. Replace `REPLACE_WITH_YOUR_SHA256_FINGERPRINT_AFTER_KEYSTORE_CREATION` with the fingerprint from Step 3 (keep the colons, uppercase)
3. Ask me to redeploy / it hot-reloads automatically. Verify by visiting:
   `https://field-crew-log-1.preview.emergentagent.com/.well-known/assetlinks.json`
   → should return valid JSON with your fingerprint
4. **Rebuild the APK** once more so the manifest verification runs against the live file:
   ```bash
   bubblewrap build
   ```

You can also test verification with:
```bash
bubblewrap validate --manifest=./twa-manifest.json
```

---

## Step 5 — Install on your Android phone

**Option A — USB cable (fastest):**
```bash
adb install app-release-signed.apk
```
Enable "USB Debugging" on your phone under Developer Options first.

**Option B — Wireless:**
1. Copy `app-release-signed.apk` to your phone (email, Google Drive, USB drive)
2. Tap the file
3. Allow "Install from unknown sources" when prompted
4. Open the "Lekka Patra" icon on your home screen 🎉

---

## Step 6 — Update the app later

Whenever you change the PWA and want to ship a new APK:
1. Increment version in `twa-manifest.json`:
   ```json
   "appVersionName": "1.0.1",
   "appVersionCode": 2
   ```
2. Run:
   ```bash
   bubblewrap update
   bubblewrap build
   ```
3. Reinstall the new APK on your phone (or upload the `.aab` to Play Store).

**Do NOT lose `android.keystore` or its passwords** — without them you cannot ever ship an update under the same app ID.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `bubblewrap: command not found` | `npm install -g @bubblewrap/cli` again, or use `npx @bubblewrap/cli ...` |
| Chrome shows URL bar in the APK | Digital Asset Links failed. Redo Step 4. Verify assetlinks.json is publicly reachable. Wait a few minutes for Chrome to re-check. |
| `keytool: command not found` | JDK 17 not on PATH. Reinstall or set `JAVA_HOME`. |
| Build fails with SDK error | Let Bubblewrap auto-download. Or in Android Studio: SDK Manager → install "Android SDK Build-Tools 34.0.0" and "Android 14 (API 34)". |
| Razorpay checkout blocked | TWA blocks some in-app browser tabs. Razorpay Standard Checkout works fine via Chrome Custom Tab. Test on a real device — the emulator sometimes misbehaves. |

---

## What's in this folder

- `twa-manifest.json` — Bubblewrap configuration for Lekka Patra (already filled in)
- `README.md` — this guide

## What's already live on your web app

- `https://field-crew-log-1.preview.emergentagent.com/manifest.json` — PWA manifest
- `https://field-crew-log-1.preview.emergentagent.com/icons/icon-512.png` — launcher icon
- `https://field-crew-log-1.preview.emergentagent.com/icons/maskable-512.png` — maskable icon
- `https://field-crew-log-1.preview.emergentagent.com/.well-known/assetlinks.json` — Digital Asset Links (edit fingerprint in Step 4)

Ping me once the APK is on your phone — I'll help you verify TWA is passing and clean up anything that renders differently on the small screen.
