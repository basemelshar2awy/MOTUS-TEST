# MOTUS mobile apps

`admin/` — the MOTUS admin app (company admins, fleet managers, dispatch, accountants, maintenance,
viewers). One Flutter codebase, three builds:

| Build | Store | Push notifications | Command |
|---|---|---|---|
| Android | Google Play | Firebase Cloud Messaging | `flutter build apk --flavor google --dart-define=PUSH=fcm` (or `appbundle`) |
| Huawei | AppGallery (phones without Google services) | Huawei Push Kit | `flutter build apk --flavor huawei --dart-define=PUSH=hms` |
| iPhone | App Store | Firebase (APNs) | `flutter build ipa --dart-define=PUSH=fcm` |

Add `--dart-define=MOTUS_URL=https://your-server` to change the default server (the sign-in screen
can also change it). The driver app comes next, on the same server routes.

## What the app does

- **Sign in** with the Sabeel account (email or mobile). The app keeps its session token itself
  (`Authorization: Bearer`, 30 days, ends after 14 days unused); signing out ends it on the server.
  Several companies: pick one, switch any time, accept or decline invitations.
- **Native screens:** home (the dashboard's figures, computed on the server by the dashboard's own
  calculation code, so the numbers are the same), alerts, dispatch board (assign vehicles), bookings
  / shipments / lines (the activity decides the words and the fields, like the dashboard and the
  server), new booking or shipment (delivery code shown once), trips (start, finish with the
  delivery code, cancel, trip order / waybill), lines (create next week's runs, seats and occupancy),
  vehicles and vehicle page, live map (OpenStreetMap, no key), work orders (close), invoices and
  payments.
- **Every other dashboard screen** (reports, inventory, tracking history, settings, AI tools, …)
  opens inside the app from **More**: the app asks the server for a one-time link (60 s, used once)
  and the in-app browser shows that screen signed in, with the web menus hidden. The menu follows the
  person's role and the company's activities, exactly like the web menu (`lib/core/nav.dart` is
  generated from `web/js/05-ui.js`).
- **Push notifications** (once configured, below): shipment delivered, trip cancelled, new booking
  from an outside system, payment received from an outside system, tracking alerts — to the
  company's members whose role should hear them, in each phone's language.

## Building on GitHub

`.github/workflows/mobile.yml` runs on every push that touches `mobile/`:
analyze → tests → Android (Google) APK → Huawei APK → iPhone build without signing.
The APKs are on the **mobile-latest** release page of the repository (and as run artifacts).
The first run generates the `android/` and `ios/` folders with `flutter create` and
`tool/configure_platforms.py` (app name, permissions, the google/huawei flavors) and commits them.

## Signing and store accounts (owner's side)

These cannot live in the repository; add them as GitHub secrets or on the build machine:

- **Google Play:** an upload keystore (`android/key.properties` + `.jks`), the Play Console app
  `com.sabeel.motus.motus_admin`, and for push a Firebase project: `android/app/google-services.json`,
  `ios/Runner/GoogleService-Info.plist`, and on the MOTUS server `MOTUS_FCM_SERVICE_ACCOUNT` (path to
  the service-account JSON).
- **Huawei AppGallery:** an AppGallery Connect project, `android/app/agconnect-services.json`, the
  same keystore's SHA-256 registered there, and on the server `MOTUS_HMS_APP_ID` +
  `MOTUS_HMS_CLIENT_SECRET`.
- **Apple:** an Apple Developer account, the bundle id, a distribution certificate and provisioning
  profile (then `flutter build ipa`), and an APNs key uploaded to Firebase.

Until the push credentials are set, the app works fully; notifications are simply not sent (the
server marks them skipped) and the app refreshes its data every 30 seconds while open.
