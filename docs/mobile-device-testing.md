# Testing the mobile app on a real phone

> Written with Step 9. The development machine had no Expo account, no
> Android SDK and no Xcode, so no build here was run on a phone. The app was
> checked on its web target against the real API (see
> `IMPLEMENTATION_STATUS.md`, Step 9). The commands follow the installed
> packages' documentation; check them once on a real phone.

There are three ways to put the worker app on a phone:

| | iPhone with Expo Go | Android APK, `preview` profile | Android APK, `development` profile |
|---|---|---|---|
| Needs | the free Expo Go app | a free Expo account, ~15 min cloud build | a free Expo account, ~15 min cloud build |
| JavaScript comes from | your computer (Metro), live | inside the APK | your computer (Metro), live |
| API address | `apps/mobile/.env` | `eas.json` → `build.preview.env` (fixed in the APK) | `apps/mobile/.env` |
| Plain `http://` to your computer | yes | yes, when the build's API address is `http://` (see section 3) | yes (debug build) |
| Push notifications | iOS: yes, once the project has an EAS projectId | needs Firebase (FCM) credentials | needs Firebase (FCM) credentials |

Never type a password, an Expo token or any other secret into a chat or into
a file in the repository. `eas-cli` asks for them itself, in your terminal or
in the browser.

## 1. Start the API so the phone can reach it

The phone cannot use `localhost` (that is the phone itself). It needs the
computer's address on the Wi-Fi network.

1. Start Postgres, Redis and MinIO: `docker compose up -d` (repo root).
2. Start the API on port **3010** (on this machine port 3000 is taken by
   another project): `PORT=3010 pnpm --filter @fieldmaster/api dev`. The API
   listens on every network interface, so the LAN address works.
3. Find the computer's LAN address:
   - macOS: `ipconfig getifaddr en0` (Wi-Fi), e.g. `192.168.1.20`;
   - Windows: `ipconfig`, the "IPv4 Address" of the Wi-Fi adapter.
4. Check it **from the phone's browser**: open
   `http://192.168.1.20:3010/api/v1/health`. It must show a small JSON
   answer. If it does not:
   - phone and computer must be on the same Wi-Fi (guest and office networks
     often isolate devices from each other; a phone hotspot is a good
     fallback);
   - macOS firewall: System Settings → Network → Firewall → Options: allow
     incoming connections for `node` (or turn the firewall off while
     testing);
   - a VPN on either device can hide the LAN.
5. Test mode: with `DEV_LOGIN_ENABLED=true` (the default in development) the
   sign-in screen shows the yellow "test mode" banner and a quick-login
   list; every number also accepts the code `123456`.

## 2. iPhone with Expo Go (quickest, no build)

1. Install **Expo Go** from the App Store. It must support SDK 57 (the
   project uses `expo ~57.0.27`); an older Expo Go refuses the project.
2. On the computer, create `apps/mobile/.env` (copy `.env.example`):

   ```
   EXPO_PUBLIC_API_URL="http://192.168.1.20:3010/api/v1"
   ```

3. Start Metro from the repo root: `pnpm --filter @fieldmaster/mobile start`.
   After changing `.env`, restart it with a clean cache, or the old address
   stays in the bundle: `pnpm --filter @fieldmaster/mobile start --clear`.
4. A QR code appears in the terminal. With the phone on the same Wi-Fi, open
   the iPhone's **Camera** app, point it at the QR code and tap the banner:
   the project opens in Expo Go.
   - If it cannot connect (the network isolates devices), start with
     `--tunnel` instead. Expo then asks to install `@expo/ngrok` globally:
     that is a separate decision, not part of this repository.
5. The app opens in Arabic, right to left (Expo Go reads
   `expo.extra.forcesRTL` from `app.json`).

What works in Expo Go: sign-in and every screen, GPS (expo-location), the
camera and photos (expo-image-picker), voice recording (expo-audio), the
Keychain (expo-secure-store), the encrypted offline queue, the map
(react-native-webview, which Expo Go includes) and the notification
permission prompt.

What does **not** work, or works differently, in Expo Go (checked against the
installed packages):

- **Remote push on Android.** expo-notifications 57 throws in Expo Go on
  Android ("removed from Expo Go with the release of SDK 53"). The app never
  loads the module there and registers the phone with `pushToken: null`;
  everything else works. On an iPhone, Expo Go can still receive pushes
  once the project has an EAS projectId (section 3, step 2).
- **Push needs a projectId everywhere.** Without `extra.eas.projectId` in
  `app.json` the app registers `pushToken: null` and never asks for the
  notification permission.
- **The app's own native configuration is not used.** Expo Go has its own
  name, icon, splash screen and permission texts: the Arabic texts in
  `app.json` (location, camera, microphone) appear only in a real build.
  The app version sent to the API comes from `app.json`, not from Expo Go.
- **expo-dev-client** (installed for development builds) does nothing in
  Expo Go.
- **Device attestation** is not implemented in any build: the app reports
  `DEV_MOCK` while developing and `UNAVAILABLE` otherwise, never "verified".
- Simulators and emulators never get a push token (`Device.isDevice` is
  false).

## 3. Android: an installable APK from EAS Build

EAS builds the APK in Expo's cloud; no Android SDK is needed locally. A free
Expo account is enough (builds may wait in a queue).

1. Sign in to Expo from the terminal (it asks for the account in the
   terminal or opens the browser):

   ```
   cd apps/mobile
   npx eas-cli login
   ```

2. Link the app to an EAS project (once):

   ```
   npx eas-cli init
   ```

   It creates the project on expo.dev and prints its projectId. The app's
   settings are in `apps/mobile/app.json`, with a small `app.config.js` on
   top (see step 3).
   - If `eas init` says it cannot write to the dynamic config, add the
     printed id to `app.json` yourself, inside `"expo"`:
     `"extra": { …existing…, "eas": { "projectId": "<the id>" } }`.
   - Commit that change: push notifications need the projectId.
3. Choose the API the APK talks to. The address is fixed into the APK when
   it is built: edit `build.preview.env.EXPO_PUBLIC_API_URL` in
   `apps/mobile/eas.json` before building. The `.env` file is not uploaded
   to EAS, because it is git-ignored.
   - **Your computer on the same Wi-Fi:**
     `http://192.168.1.20:3010/api/v1` (your LAN address, section 1).
     - Android release builds normally refuse plain `http://`.
       `apps/mobile/app.config.js` turns cleartext traffic on **only for a
       build whose API address starts with `http://`**
       (`expo-build-properties`, `android.usesCleartextTraffic`).
     - A build with an `https://` address keeps Android's default (no
       cleartext).
     - The computer's address must stay the same: a new Wi-Fi or address
       means a new build.
   - **The deployed API** (the default in `eas.json`):
     `https://fieldmaster-api.onrender.com/api/v1`.
4. Build:

   ```
   npx eas-cli build -p android --profile preview
   ```

   - "Generate a new Android Keystore?" → **Yes** (EAS keeps it; the same
     key signs every later build).
   - At the end the terminal prints a link to the build page and a QR code.
5. Install the APK on the phone:
   - scan the QR code (or open the link) on the Android phone, tap
     **Install** / **Download**;
   - Android asks to allow installs from this source (the browser): allow
     it once, then open the downloaded file and tap **Install**;
   - with a USB cable and `adb` you can instead download the `.apk` to the
     computer and run `adb install fieldmaster.apk`.
6. Push notifications on Android need Firebase Cloud Messaging credentials
   in the Expo project (a Firebase project, its `google-services.json` in
   `app.json` → `android.googleServicesFile`, and the FCM V1 service-account
   key uploaded with `npx eas-cli credentials`). Without them the app
   registers `pushToken: null` and works without push. The API sends pushes
   only with `PUSH_PROVIDER=expo` in `apps/api/.env` (the default `log` only
   writes a log line).

## 4. Android: development build (live reload, plain HTTP to the computer)

1. Build and install it like section 3, with the `development` profile:

   ```
   npx eas-cli build -p android --profile development
   ```

2. Keep `EXPO_PUBLIC_API_URL="http://192.168.1.20:3010/api/v1"` in
   `apps/mobile/.env` (a debug build allows cleartext HTTP).
3. Start Metro for the development client:
   `pnpm --filter @fieldmaster/mobile start --dev-client` (add `--clear`
   after changing `.env`).
4. Open the installed app: it lists the Metro server found on the Wi-Fi, or
   scan the QR code from the terminal.

## 5. iPhone builds

An installable iPhone build (`npx eas-cli build -p ios --profile preview`
or `development`) needs a paid Apple Developer account, and each test
iPhone must be registered first (`npx eas-cli device:create`). Until then,
use Expo Go (section 2).

## 6. What to try on the phone

Seed accounts (`pnpm db:seed`; see `docs/seed-accounts.md`), all with the
test code `123456`:

- **A pending application:** ليث منصور `+972599123456` → after the code, the
  «طلب الانضمام قيد المراجعة» screen and nothing else.
- **Temporary supervisor:** باسل عازر `+972500010004` is an active temporary
  supervisor on today's shift at «تقاطع تل أبيب المركزي» → Home → the
  supervisor card: workers and their status, open a temporary check-in
  point at the phone's location, «الإبلاغ عن مشكلة».
- **Night Turan / emergency:** محمود جبارين `+972500010002`.
- **History, salary, notifications:** any worker; رامي طه `+972500010011` is
  in the finalized payroll month (statement PDF).
- **Offline:** clock in with flight mode on → the record waits on the phone
  (encrypted) → turn flight mode off → it is sent and appears in the
  history.
- **Revoked device key:** on the admin web's users page, revoke the phone's
  device key → at the next app start or sync the app clears the waiting
  records and asks to sign in again; after signing in it registers a new
  key.
- **Suspended account:** suspend the worker on the admin web. Suspending
  ends the worker's sessions, so the next call returns the app to the
  sign-in screen, and signing in again shows «الحساب موقوف». (A call or a
  session refresh answered with `ACCOUNT_SUSPENDED` or
  `NO_ACTIVE_MEMBERSHIP` shows that screen at once.)

### Manager mode (one app for everyone, decided by permissions)

Sign in on the same phone as each member in turn (Settings → sign out
between them):

- **Owner** سلمى منصور `+972500000001`: the «الإدارة» tab with every
  counter (بانتظار الموافقة، في الدوام الآن، متأخرون، تنبيهات الموقع، طلبات
  الانضمام), the four quick actions and the month's money card; no «دوامي»
  tab and no «راتبي» (she does not clock in).
- **Field Manager** يوسف الخطيب `+972500000011` (clocks in himself):
  «الإدارة» without any ₪, and «دوامي» with his own shifts and «راتبي».
  رنا عودة `+972500000012`: the same without «دوامي».
- **Custom role «محاسب»** سمر الحداد `+972500020001`: the money card only,
  no counters or actions she may not use.
- **Restricted «مدير مشروع»** طارق منصور `+972500020002`: «عرض مقيَّد
  بمشاريعك», counters and lists of his project only, no applications.
- **Worker** مهند صالح `+972500010008`: the worker home as before, with
  «راتبي» (an empty month says «لا يوجد راتب لهذا الشهر بعد»).

Then, as a manager: approve the pending entry from «الموافقات» and see
«تمت المعالجة بواسطة …» on the other manager's notification; open a
notification of each kind (attendance, offline records, an application, a
temporary supervisor's report, an entry open for nine hours) and solve it
there; add a work location with «استخدم موقعي الحالي», drag the pin and
change the radius; create a shift with a worker who is already busy (the
warning) and one who is free.

## 7. Automated flows (Maestro)

`apps/mobile/.maestro/` holds the critical flows: quick sign-in, clock-in
inside the geofence, the mandatory summary, clock-out, offline clock-in then
sync, and the Night Turan emergency. `apps/mobile/.maestro/README.md` has
the prerequisites and commands. They were written but not run (no emulator
here).

On an Android emulator, Maestro's `setLocation` goes through a mock-location
provider: the app reports it (DETECTED) and the server refuses the clock-in,
as it should. The flows therefore set the position with
`adb emu geo fix 34.7818 32.0853`, and one flow checks the refusal.

## 8. Troubleshooting

- **"تعذّر الاتصال بالخادم" on every screen:** the phone cannot reach
  `EXPO_PUBLIC_API_URL`. Open `<that URL>/health` in the phone's browser
  (section 1, step 4). If the computer's address changed, rebuild the APK
  (section 3, step 3).
- **The old API address is still used:** restart Metro with `--clear`
  (`EXPO_PUBLIC_*` values are written into the bundle), or rebuild the APK.
- **Expo Go says the project is incompatible:** update Expo Go to the SDK 57
  version.
- **A floating blue gear over the screen (e.g. over «رجوع»):** Expo's
  developer-menu button. It appears only in Expo Go and development builds,
  never in a release build, and is not part of the app. Hide it from the
  developer menu (shake the phone, or tap the gear) → turn off «Tools
  button».
- **No push notifications:** check the projectId (section 3, step 2), the
  phone's notification permission, FCM on Android, and
  `PUSH_PROVIDER=expo` on the API.
