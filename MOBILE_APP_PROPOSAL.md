# Mobile App Proposal — GreatNeck.ai (iOS & Android)

**Date:** 2026-03-14
**App ID:** `ai.greatneck.app`
**Status:** Proposal

---

## Executive Summary

Ship GreatNeck.ai as native iOS and Android apps using Capacitor.js. The web app already runs as a static Next.js export with mobile-first responsive design, so Capacitor wraps the existing frontend into native shells with minimal code changes. This gives us App Store / Play Store distribution, push notifications, camera access for the vision agent, and a native app experience — while maintaining a single codebase.

---

## Current State

The foundation for mobile is already in place:

| Component | Status |
|-----------|--------|
| Capacitor config (`capacitor.config.ts`) | Done — appId: `ai.greatneck.app`, webDir: `out` |
| Capacitor dependencies (`@capacitor/core`, `@capacitor/ios`, `@capacitor/android`) | Installed (v6.1.0) |
| Next.js static export (`output: "export"`) | Configured in `next.config.js` |
| Responsive / mobile-first CSS | Throughout — Tailwind breakpoints, safe-area insets, 44px touch targets |
| Touch-friendly UI | Bottom sheets, swipe gestures, collapsible sidebar |
| OAuth (Google + Apple Sign In) | Backend ready (`api/auth.py`) |
| Image upload (vision agent) | Working via web file input |

**What's missing:** Native iOS/Android project directories, native plugins, app store assets, and mobile CI/CD.

---

## Architecture

```
┌─────────────────────────────────────────┐
│           App Store / Play Store        │
└─────────────┬───────────────┬───────────┘
              │               │
     ┌────────▼───┐    ┌─────▼────────┐
     │  iOS Shell │    │ Android Shell │
     │  (Swift)   │    │  (Kotlin)     │
     │  WKWebView │    │  WebView      │
     └────────┬───┘    └─────┬────────┘
              │               │
     ┌────────▼───────────────▼────────┐
     │     Capacitor Bridge            │
     │  (JS ↔ Native plugin calls)    │
     └────────────┬───────────────────┘
                  │
     ┌────────────▼───────────────────┐
     │   Next.js Static Export (out/) │
     │   Same code as web deployment  │
     └────────────┬───────────────────┘
                  │
     ┌────────────▼───────────────────┐
     │   FastAPI Backend (Cloud Run)  │
     │   Same API, no changes needed  │
     └───────────────────────────────┘
```

The native shells load the static HTML/JS/CSS from the bundled `out/` directory. All API calls go to the same Cloud Run backend. Capacitor's bridge exposes native device APIs (camera, notifications, haptics) to the web layer via JavaScript.

---

## Phase 1: Native Project Setup

**Goal:** Generate iOS and Android projects, run the app in simulators.

### Steps

1. **Generate native projects**
   ```bash
   cd frontend
   npx cap add ios
   npx cap add android
   ```
   This creates `frontend/ios/` and `frontend/android/` directories.

2. **Build and sync**
   ```bash
   npm run build          # Next.js static export → out/
   npx cap sync           # Copy out/ into native projects + install plugins
   ```

3. **Update `capacitor.config.ts`**
   ```typescript
   const config: CapacitorConfig = {
     appId: "ai.greatneck.app",
     appName: "GreatNeck.ai",
     webDir: "out",
     server: {
       androidScheme: "https",
       // Point to Cloud Run backend for API calls
       // (or use runtime config for environment switching)
     },
     plugins: {
       SplashScreen: {
         launchShowDuration: 2000,
         backgroundColor: "#1a1a2e",
       },
       StatusBar: {
         style: "Dark",
         backgroundColor: "#1a1a2e",
       },
     },
   };
   ```

4. **Configure API base URL for native**
   Add platform detection in `frontend/src/lib/api.ts`:
   ```typescript
   import { Capacitor } from "@capacitor/core";

   const API_BASE = Capacitor.isNativePlatform()
     ? "https://api.greatneck.ai"   // Always use production API in native
     : (process.env.NEXT_PUBLIC_API_URL || "");
   ```

5. **Test in simulators**
   ```bash
   npx cap open ios       # Opens Xcode
   npx cap open android   # Opens Android Studio
   ```

### Deliverables
- `frontend/ios/` — Xcode project
- `frontend/android/` — Android Studio project
- Working app in iOS Simulator and Android Emulator

---

## Phase 2: Native Features

### 2.1 Push Notifications

**Plugin:** `@capacitor/push-notifications`

- Register device tokens on app launch
- Send tokens to backend for storage
- Backend sends via APNs (iOS) and FCM (Android)

**Use cases:**
- Reminder notifications (permit deadlines, meeting dates)
- New guide published notifications
- Reply notifications on comments

**Backend changes:**
- New `device_tokens` table: `user_id`, `token`, `platform` (ios/android), `created_at`
- New endpoint: `POST /api/notifications/register-device`
- Integration with APNs/FCM for sending (via `firebase-admin` SDK or direct APNs)

### 2.2 Camera Access

**Plugin:** `@capacitor/camera`

- Replace web file input with native camera for the vision agent
- Better photo quality and UX (choose camera vs gallery)
- Direct access to device camera roll

**Frontend change:** Update image upload in `chat/page.tsx` to use Capacitor Camera plugin when on native platform.

### 2.3 Deep Linking

**Plugin:** `@capacitor/app`

- Universal links: `https://greatneck.ai/guides/123` opens the app if installed
- Custom scheme: `greatneck://chat` for internal navigation
- Required for OAuth redirect flows on native

**Configuration:**
- iOS: Associated Domains entitlement + `apple-app-site-association` file on web server
- Android: Intent filters in `AndroidManifest.xml` + `assetlinks.json` on web server

### 2.4 Share Sheet

**Plugin:** `@capacitor/share`

- Share guides via native share sheet (Messages, WhatsApp, email, etc.)
- Share chat responses with source links

### 2.5 Haptic Feedback

**Plugin:** `@capacitor/haptics`

- Light haptic on button taps
- Success haptic on guide completion
- Notification haptic on new messages

### 2.6 Biometric Authentication (Optional)

**Plugin:** Community plugin `capacitor-native-biometric`

- Face ID / Touch ID on iOS
- Fingerprint / Face unlock on Android
- Use for re-authentication instead of full OAuth flow

### 2.7 Splash Screen & Status Bar

**Plugins:** `@capacitor/splash-screen`, `@capacitor/status-bar`

- Branded splash screen matching the app's dark theme
- Status bar styling to match the navigation bar color

---

## Phase 3: App Store Submission

### Apple App Store (iOS)

| Requirement | Details |
|-------------|---------|
| Apple Developer Account | $99/year enrollment |
| Bundle ID | `ai.greatneck.app` |
| Code signing | Distribution certificate + provisioning profile |
| App icons | 1024x1024 icon + all required sizes (Xcode asset catalog) |
| Screenshots | 6.7" (iPhone 15 Pro Max), 6.5" (iPhone 11 Pro Max), 5.5" (iPhone 8 Plus), 12.9" iPad Pro |
| Privacy manifest | `PrivacyInfo.xcprivacy` — declare data collection (analytics, user ID) |
| App Review | Provide demo account credentials, explain AI-generated content |
| Age rating | 4+ (no objectionable content) |
| Privacy policy URL | `https://greatneck.ai/privacy/` (already exists) |
| Terms of use URL | `https://greatneck.ai/terms/` (already exists) |

**Review risks:**
- Apple may flag the WebView-based architecture. Mitigation: The app provides unique local value (municipal codes, permits) and uses native features (camera, notifications).
- AI-generated content must be disclosed per App Store guidelines 5.6.4.

### Google Play Store (Android)

| Requirement | Details |
|-------------|---------|
| Google Developer Account | $25 one-time fee |
| Package name | `ai.greatneck.app` |
| Signing | Upload key + Google Play App Signing |
| App icons | 512x512 icon + feature graphic (1024x500) |
| Screenshots | Phone (min 2), 7" tablet, 10" tablet |
| Content rating | IARC questionnaire |
| Data safety | Declare data collection in Play Console |
| Privacy policy URL | `https://greatneck.ai/privacy/` |
| Target API level | Must target latest Android API (currently 35) |

---

## Phase 4: Mobile CI/CD

### Build Pipeline (Fastlane)

```
┌──────────────┐     ┌───────────┐     ┌──────────────┐     ┌────────────┐
│ git push to  │────▶│ GitHub    │────▶│ Build native │────▶│ Upload to  │
│ main         │     │ Actions   │     │ iOS/Android  │     │ TestFlight │
└──────────────┘     └───────────┘     └──────────────┘     │ / Play     │
                                                             │ Console    │
                                                             └────────────┘
```

### iOS Build (requires macOS runner)

```yaml
# .github/workflows/mobile.yml (excerpt)
ios-build:
  runs-on: macos-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 20 }
    - run: cd frontend && npm ci && npm run build
    - run: cd frontend && npx cap sync ios
    - uses: ruby/setup-ruby@v1
      with: { ruby-version: 3.2 }
    - run: cd frontend/ios/App && bundle exec fastlane beta
```

### Android Build

```yaml
android-build:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with: { node-version: 20 }
    - uses: actions/setup-java@v4
      with: { java-version: 17, distribution: temurin }
    - run: cd frontend && npm ci && npm run build
    - run: cd frontend && npx cap sync android
    - run: cd frontend/android && ./gradlew assembleRelease
```

### OTA Updates (Capgo or Appflow)

For non-native changes (HTML/JS/CSS), use over-the-air updates to skip the app store review cycle:
- **Capgo** (open-source, self-hostable) — recommended for cost
- Updates the web bundle inside the native shell without a store submission
- Native plugin changes still require a store update

---

## Backend Changes Required

### New Database Table

```sql
CREATE TABLE device_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    platform VARCHAR(10) NOT NULL,  -- 'ios' or 'android'
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(user_id, token)
);
```

### New API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/notifications/register-device` | POST | Store device push token |
| `/api/notifications/unregister-device` | POST | Remove token on logout |

### Push Notification Sending

- Use `firebase-admin` SDK for FCM (Android + iOS via APNs proxy)
- Alternatively, use APNs directly for iOS + FCM for Android
- Trigger notifications from existing flows: reminder processor, comment replies, guide publishes

---

## Capacitor Plugins Summary

| Plugin | Version | Purpose |
|--------|---------|---------|
| `@capacitor/push-notifications` | ^6.x | Push notifications |
| `@capacitor/camera` | ^6.x | Native camera for vision agent |
| `@capacitor/app` | ^6.x | Deep linking, app state |
| `@capacitor/share` | ^6.x | Native share sheet |
| `@capacitor/haptics` | ^6.x | Haptic feedback |
| `@capacitor/splash-screen` | ^6.x | Launch screen |
| `@capacitor/status-bar` | ^6.x | Status bar styling |
| `@capacitor/keyboard` | ^6.x | Keyboard events (chat input UX) |

**Install all:**
```bash
npm install @capacitor/push-notifications @capacitor/camera @capacitor/app \
  @capacitor/share @capacitor/haptics @capacitor/splash-screen \
  @capacitor/status-bar @capacitor/keyboard
```

---

## Risks & Considerations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Apple rejects WebView app | Blocks iOS launch | Emphasize native features (camera, notifications, deep links) and unique local value |
| AI content moderation | App review delay | Add disclosure per Apple guideline 5.6.4, implement content filtering |
| Large bundle size | Slow first launch | Optimize Next.js build, lazy-load heavy components |
| OAuth redirect on native | Auth flow breaks | Configure deep link redirect URIs in Google/Apple OAuth settings |
| macOS CI runner cost | Higher CI costs | Use self-hosted Mac Mini or build iOS locally initially |
| App store review time | 1-3 days per submission | Use OTA updates (Capgo) for web-layer changes to minimize store submissions |

---

## Recommended Rollout

| Phase | Scope | Timeline |
|-------|-------|----------|
| **Phase 1** | Generate native projects, run in simulators, fix any layout issues | Week 1 |
| **Phase 2** | Add push notifications + camera plugin, backend device token support | Week 2-3 |
| **Phase 3** | App icons, screenshots, store listings, submit to TestFlight + Play Console internal testing | Week 3-4 |
| **Phase 4** | Beta testing with 10-20 Great Neck residents, iterate on feedback | Week 4-6 |
| **Phase 5** | Public launch on App Store + Play Store | Week 6-8 |
| **Phase 6** | Mobile CI/CD pipeline, OTA updates, remaining native features | Week 8+ |

---

## Cost Estimate

| Item | Cost |
|------|------|
| Apple Developer Account | $99/year |
| Google Play Developer Account | $25 one-time |
| macOS CI runner (GitHub Actions) | ~$0.08/min (or self-hosted Mac Mini) |
| Capgo OTA updates (free tier) | $0 for <1,000 devices |
| Firebase Cloud Messaging | Free |
| **Total initial cost** | **~$125** |
