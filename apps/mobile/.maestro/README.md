# Maestro flows: the worker's work flow

End-to-end flows for the FieldMaster worker app (Step 9), run on an Android
emulator or an iOS simulator against the real API with the seeded data.

> These flows were written without running them: this machine has no
> Maestro, no Android emulator and no full Xcode. The screens and the testIDs
> they use are covered by the Jest tests in `apps/mobile/src/**/__tests__`.

## What each flow checks

| Flow | Worker | Checks |
|---|---|---|
| `01-clock-in-inside-geofence` | خالد ناصر | Dev quick login. Home before the shift («لم تبدأ الدوام بعد.», «الوردية القادمة»). The shift details with the live «داخل نطاق الموقع». Clock-in inside the geofence. The receipt («تم بدء الدوام», «تمت المزامنة», the reference id). Home «أنت في الدوام الآن». |
| `02-clock-out-summary-required` | خالد ناصر | Sending the clock-out with no summary shows «ملخص العمل اليومي مطلوب: يُرجى كتابته أو تسجيله بالصوت.» and sends nothing. A typed summary ends the shift; the receipt («تم إنهاء الدوام», «حضورك الآن بانتظار الموافقة من المدير.»); Home not on shift. Needs flow 01 first. |
| `03-offline-clock-in-then-sync` | كريم حمدان | **Android only** (airplane mode). The offline banner; the clock-in saved on the phone; the receipt «تم حفظ بدء الدوام», «بانتظار المزامنة», «يُحدَّد عند المزامنة»; Home «بدء الدوام بانتظار المزامنة». With the connection back, the queue syncs by itself and Home shows «أنت في الدوام الآن» (the server accepted the signed event). On iOS the flow does nothing. |
| `04-night-turan-emergency` | محمود جبارين | Home shows «المناوبة الحالية: مناوبة ليلية» and the emergency button (only when the API says he is eligible). «+60 دقيقة قبل البدء» and the start confirmation; the live timer; «+15 دقيقة للعودة»; ending with no summary shows «ملخص أعمال الطوارئ مطلوب قبل الإنهاء.»; with a summary, the breakdown (actual and compensated start and end, «إجمالي المدة المحتسبة»). Back on Home, no emergency button: the Turan is completed. |
| `05-android-mock-location-refused` | باسل عازر | **Android only**, runs last. Maestro's `setLocation` is a mock location provider on Android, so the app reports the fix as DETECTED and the server's mock-location rule refuses the clock-in: «تم رفض الطلب لأن الجهاز يستخدم موقعًا وهميًا. أوقف تطبيقات تغيير الموقع وحاول مرة أخرى.» |

`config.yaml` runs them in this order and stops at the first failure.
`subflows/` holds the shared steps (open the app clean, quick login, put the
phone at the site); they are not flows of their own.

The typed summaries are in Latin letters: Maestro cannot type Unicode on
Android. They are the worker's data; every label in the app stays Arabic.

## Prerequisites

1. **Maestro CLI** (`curl -Ls "https://get.maestro.mobile.dev" | bash`),
   and an **Android emulator with API 31 or later** or an **iOS simulator**.
2. **The backend**, in test mode (dev quick login on):
   ```sh
   docker compose up -d            # Postgres + PostGIS, Redis, MinIO
   pnpm db:migrate
   pnpm db:seed                    # see "Seeded data" below
   PORT=3010 pnpm --filter @fieldmaster/api dev
   ```
   `apps/api/.env` must have `APP_ENV=development` (or `staging`) and
   `DEV_LOGIN_ENABLED=true` (the defaults of `.env.example`).
3. **The app**, built with the API address the emulator can reach:
   - Android emulator: `EXPO_PUBLIC_API_URL=http://10.0.2.2:3010/api/v1`
   - iOS simulator: `EXPO_PUBLIC_API_URL=http://localhost:3010/api/v1`

   Either a **development build** (`expo-dev-client` is installed; the app id
   is `com.fieldmaster.mobile`):
   ```sh
   cd apps/mobile
   EXPO_PUBLIC_API_URL=http://10.0.2.2:3010/api/v1 npx expo run:android   # or run:ios
   ```
   then run the flows with the Metro address, so the app opens that bundle
   instead of the dev launcher: `-e DEV_SERVER_URL=http://10.0.2.2:8081`
   (iOS: `http://localhost:8081`). A **release or preview build** with the
   bundle inside (`npx expo run:android --variant release`) needs no
   `DEV_SERVER_URL` and is the steadier choice for flow 03 (airplane mode
   also cuts the dev build from Metro).

   **Expo Go** works for trying the app by hand (RTL comes from
   `expo.extra.forcesRTL`), but the flows target `com.fieldmaster.mobile`.
   To run them in Expo Go, change `appId` to `host.exp.exponent` in the
   flows and open the project first (`openLink: exp://10.0.2.2:8081`).
   Expo Go also lacks push notifications on Android.
4. **The phone's location at the site** «تقاطع تل أبيب المركزي»
   (32.0853, 34.7818):
   - iOS simulator: nothing to do, the flows call `setLocation` (iOS cannot
     flag a location as mocked; the app sends UNAVAILABLE, as on a real
     iPhone).
   - Android emulator: **set the emulator's own GPS before the run**, and
     do not use Maestro's `setLocation` for flows 01-04:
     ```sh
     adb emu geo fix 34.7818 32.0853     # longitude first
     ```
     (or Extended controls → Location in the emulator). Maestro's
     `setLocation` on Android goes through a mock location provider: the app
     reports DETECTED and the server refuses the clock-in, which is what flow
     05 checks. That mock provider stays active until the emulator restarts,
     so restart it before running 01-04 again.

## Seeded data (`pnpm db:seed`)

The seed creates a working day relative to the moment it runs, so **seed on
the day you run the flows** (and again to run them a second time: they change
the data).

- **Today's standard shift** at «تقاطع تل أبيب المركزي» (32.0853, 34.7818;
  geofence 150 m, minimum accuracy 50 m). It starts one hour before the seed
  ran and ends eight hours after. Assigned: خالد ناصر (+972500010001),
  باسل عازر (+972500010004), كريم حمدان (+972500010005).
- **Temporary supervisor**: باسل عازر on that shift (Home shows the
  supervisor card for him).
- **Night Turan** for محمود جبارين (+972500010002), from two hours before
  the seed to 22 hours after: his emergency button shows. A call-out completes
  the Turan, so flow 04 runs once per seed.

### A Night Turan that covers now, from the admin web

If the seeded one is used up (or the seed is older than a day):

1. Sign in to the admin web as an Owner or a Field Manager (test mode: the
   quick login, e.g. يوسف الخطيب).
2. Open «المناوبات والطوارئ» (`/turan`).
3. In «مناوبة جديدة»: type «مناوبة ليلية», worker «محمود جبارين», a start
   before now and an end after now, then «إنشاء المناوبة» (confirm with «نعم،
   أنشئ المناوبة» if it overlaps another one).
4. Home in the app shows the emergency button after a refresh (pull down).

## Commands

```sh
# Every flow, in order (Android emulator or iOS simulator):
maestro test apps/mobile/.maestro/

# With a development build:
maestro test -e DEV_SERVER_URL=http://10.0.2.2:8081 apps/mobile/.maestro/

# One flow:
maestro test apps/mobile/.maestro/04-night-turan-emergency.yaml

# Only what runs on both platforms:
maestro test --exclude-tags android-only apps/mobile/.maestro/
```

## testIDs the flows use

| Screen | testIDs |
|---|---|
| Home | `home-screen`, `home-status-off-shift`, `home-status-on-shift`, `home-status-pending`, `home-status-emergency`, `home-next-shift`, `home-next-shift-details`, `home-next-shift-clock-in`, `home-clock-out`, `home-emergency-start` |
| Shift details | `shift-title` |
| Clock-in | `clock-in-submit` |
| Clock-out | `clock-out-submit`, `clock-out-summary`, `clock-out-summary-error` |
| Receipt | `clock-receipt`, `receipt-reference-id`, `receipt-done` |
| Emergency | `emergency-start`, `emergency-confirm`, `emergency-confirm-start`, `emergency-timer`, `emergency-end`, `emergency-summary`, `emergency-summary-error`, `emergency-ended`, `emergency-actual-start`, `emergency-compensated-start`, `emergency-actual-end`, `emergency-compensated-end`, `emergency-compensated-total`, `emergency-done` |

The login screen, the offline banner and the error messages are matched by
their Arabic text.
