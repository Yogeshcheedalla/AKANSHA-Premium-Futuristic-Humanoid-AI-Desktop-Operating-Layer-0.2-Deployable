# Akansha — Android Client: Verified Status

Evidence-based record of the Android (Capacitor) client. Updated after a real on-emulator
verification run. Labels: VERIFIED / NOT VERIFIED / BLOCKED / EXPECTED EXTERNAL CONFIGURATION / NOT APPLICABLE.

## Architecture (canonical, unchanged)
One brain, many bodies. The Android app is a **Capacitor WebView pointed at the hosted
production origin** — it reuses the existing Akansha core through the same `/api/*` contract
and the same `AuthManager` cookie session. No second orchestrator / ModelRouter / memory /
auth engine / frontend. `src/` is Electron-free, which is what lets a plain WebView reuse it.

- `capacitor.config.json`: `appId ai.akansha.mobile`, `webDir mobile-app` (tiny shell),
  `server.url https://akansha-gamma.vercel.app/app` (opens straight into the app, not the
  marketing landing), `cleartext false`, `androidScheme https`.
- Boot mechanism (verified in Capacitor `Bridge.java` 626–644): with `server.url` set, the
  WebView start URL is the remote origin; the bundled `mobile-app/index.html` is a dormant
  fallback that also forwards to `/app`.

## Permissions (purpose-backed only)
- `INTERNET` — reach the hosted origin + `/api`.
- `RECORD_AUDIO` — backs the existing web voice (`getUserMedia`) in the WebView; `microphone`
  hardware `required=false`.
- NOT requested (no implemented feature): POST_NOTIFICATIONS, SYSTEM_ALERT_WINDOW,
  FOREGROUND_SERVICE, Bluetooth, CAMERA. (Play-policy honest.)

## Build toolchain (this machine)
- JDK 21 required by Capacitor 8.5 (`sourceCompatibility VERSION_21`); Gradle 8.14.3 caps at
  Java ≤24 → system JDK 17 too low, 25 too high. Fixed with a portable Temurin 21 pinned in
  gitignored `android/gradle.properties` `org.gradle.java.home`.
- `android/local.properties` `sdk.dir` set for AGP. Android SDK: platform-tools, emulator,
  build-tools 36, platforms 34/36/36.1/37; **cmdline-tools installed this session**; API-36
  `google_apis;x86_64` system image installed. `;` package ids break via Git Bash→cmd — use
  `sdkmanager --package_file` / direct `java` for `avdmanager`.
- `android/` + APK are gitignored → hand-off requires zipping the native project + APK.

## On-emulator verification (real device evidence)
AVD `Akansha_Pixel_API_36` (pixel_6 / android-36 google_apis x86_64), WHPX-accelerated, headless.

| Check | Result | Evidence |
|---|---|---|
| Emulator boot | VERIFIED | `sys.boot_completed=1` ~60s; `adb devices` → `emulator-5554 device`; API 36 |
| APK install | VERIFIED | `adb install -r` → Success; `pm list packages` shows `ai.akansha.mobile` |
| Launch | VERIFIED | `topResumedActivity = ai.akansha.mobile/.MainActivity`; relaunch pid alive |
| Opens Akansha directly (no marketing) | VERIFIED | screenshot = AuthGate "AKANSHA · HUMANOID AI OPERATING LAYER · Google authentication is not configured · Set GOOGLE_CLIENT_ID/SECRET in Vercel · Back to home" |
| Production origin over HTTPS | VERIFIED | WebView rendered `…/app`; emulator pings `akansha-gamma.vercel.app` 0% loss |
| No crash | VERIFIED | no `FATAL EXCEPTION`/`Fatal signal` for the package |
| Microphone permission grant/revoke | VERIFIED | `pm grant …RECORD_AUDIO` → `granted=true`; `pm revoke` ok |
| APK integrity | VERIFIED | 4,118,550 bytes, SHA-256 `b65ee8a6ddbbdd72d7a928bb37495db0c1222e761c0c02b18be122ae04f88742`; no `.exe`/`.msi`/`downloads` inside |
| Regression | VERIFIED | npm test 265/265; tsc clean; next build clean |

## Not verified / blocked (honest)
- **Google login completion:** EXPECTED EXTERNAL CONFIGURATION — production `GOOGLE_CLIENT_ID/SECRET`
  intentionally unset (rotate-first). The gate correctly shows "not configured"; must not be faked.
- **Voice / ASR round-trip:** NOT VERIFIED — emulator had no audio input and the app is gated at
  auth, so the in-app voice flow was unreachable. Needs a device with a mic + an authenticated session.
- **Notifications / overlay / foreground service:** NOT IMPLEMENTED → intentionally not requested.
- **Release AAB (production):** BLOCKED — needs your release keystore; a debug/self-signed build
  is not the Play-Store artifact.

## Windows / web / release boundaries preserved
Windows `Akansha-Setup-3.0.0.exe` (145,187,772 bytes) untouched; GitHub v3.0.0 untouched;
Vercel untouched; `AKANSHA_RELEASES` / Android download button untouched. Android work is local
commits only, **not pushed**.

## Next steps (require human action)
1. Rotate + set production `GOOGLE_CLIENT_ID/SECRET` in Vercel → then the emulator/phone can pass
   the gate; re-verify authenticated `/app` + voice.
2. Provide a release keystore → build/sign the production AAB.
3. Decide whether notifications/overlay are real features before requesting their permissions.
