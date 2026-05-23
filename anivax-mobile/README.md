# Anivax Mobile (Patient App)

Bare React Native (no Expo) workspace for the patient-facing surface of Anivax.

> **Status:** all JavaScript/TypeScript source for the MVP screens is committed.
> The native `android/` and `ios/` projects are **not** included (they're large
> generated trees). Generate them with the React Native CLI on first checkout
> using the steps below — the source under `App.tsx`, `index.js`, `src/` and
> `package.json` plug straight in.

## Screens shipped

- `LoginPhoneScreen` — phone number entry, requests OTP via `/auth/patient/otp/request`
- `OtpScreen` — 6-digit verification, exchanges for JWT pair
- `HomeScreen` — three cards: Queue ticket, Next dose, Quick actions
- `QueueTicketScreen` — large token display, polls `/queue-tickets/me` every 15s
- `DoseScheduleScreen` — full PEP regimen with status chips
- `ExposureIntakeScreen` — submits to `/patients/me/exposure-intake`, lands as `REQUESTS` tab in the staff app
- `ProfileScreen` — `GET/PATCH /patients/me`
- `DocumentsScreen` — multipart upload (camera/gallery) to `/files`

## Architecture

```
App.tsx
└── AuthProvider (src/auth/AuthContext.tsx)
    └── NavigationContainer
        └── Stack.Navigator (auth-gated)
            ├── LoginPhone / Otp                (when no session)
            └── Home / QueueTicket / Dose / ... (when logged in)

src/api/client.ts   axios + 401 refresh interceptor
src/auth/storage.ts MMKV (access + cache) + Keychain (refresh)
src/config/env.ts   API_BASE_URL — auto-rewrites to 10.0.2.2 on Android emulator
```

## Bootstrap from a fresh checkout

```bash
cd anivax-mobile
npm install

# Generate the native projects (Android + iOS) into android/ and ios/.
# The React Native CLI is happy to do this in an existing directory:
npx @react-native-community/cli init AnivaxMobile --directory . --skip-install --skip-git-init

# Bring back our package.json (the CLI overwrites it):
git checkout package.json App.tsx index.js src tsconfig.json babel.config.js metro.config.js app.json
npm install

# iOS only:
npx pod-install
```

After the native projects exist:

```bash
# Make sure the Anivax API server is reachable at http://localhost:4000.
# On Android emulator the app rewrites that to http://10.0.2.2:4000 automatically.

# In a separate terminal:
cd ../anivax && npm run api:start

# Then in this dir:
npx react-native start          # Metro bundler
npx react-native run-android    # or run-ios
```

## Push notifications (Phase 5)

`@react-native-firebase/messaging` is in `package.json` but the native
configuration files (`google-services.json`, `GoogleService-Info.plist`) are
deliberately not committed. After Firebase project setup:

1. Drop `google-services.json` into `android/app/`.
2. Drop `GoogleService-Info.plist` into `ios/AnivaxMobile/`.
3. Add the `apply plugin: 'com.google.gms.google-services'` line to
   `android/app/build.gradle` (the CLI's RN template covers this when you
   follow the `react-native-firebase` Android setup guide).
4. The app will then call `POST /api/v1/notifications/devices` on first launch
   to register the FCM token (server-side handler lives in
   `anivax/server/notificationsRoutes.js`).

## Permissions

Requested just-in-time, never on app start:

- `POST_NOTIFICATIONS` (Android 13+) — at first launch of `HomeScreen`
- `CAMERA` — when the user taps "Camera" in `DocumentsScreen`
- `READ_MEDIA_IMAGES` (Android 13+) — when the user taps "Gallery"

Use `react-native-permissions` (already in `package.json`) when wiring these.

## Type-checking

```bash
npm run tsc
```
