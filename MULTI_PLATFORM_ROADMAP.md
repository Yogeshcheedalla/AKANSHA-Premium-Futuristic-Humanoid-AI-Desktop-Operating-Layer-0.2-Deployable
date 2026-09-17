# Akansha — Multi-Platform Roadmap (Phase 1)

Derived from `MULTI_PLATFORM_AUDIT.md`. **Design only — no implementation until you approve Phase 1.** Windows v3.0.0 stays frozen (no rebuild/modify). Milestones `3.1.x → 3.4.x`; never overwrite v3.0.0.

Legend: 🔵 shared/core · 🖥️ desktop-only · 📱 mobile-only · 🔐 security · 🧪 build/test · ⛔ human/device blocker.

---

### 1. Windows — current verified state
Installer `Akansha-Setup-3.0.0.exe` built + SHA-256/size measured; NSIS/tray/single-instance/startup implemented. On-device install/launch = human-verify. **Action: none. Do not touch.** 🖥️⛔

### 2. macOS — exact remaining work
- electron-builder already has a `mac` target (dmg/zip) but has **never been built**. Needs a **macOS runner** + Apple Developer ID, `hardenedRuntime`, notarization (`notarytool`).
- Platform adapters: menu-bar (Tray→Menu), notification API, credential storage (Keychain), computer-use adapter or honest "unsupported".
- Local AI: llama.cpp macOS build + signed model (separate from Windows). 
- **Status today: NOT BUILT.** 🖥️⛔(Apple account/device)

### 3. Linux — exact remaining work
- electron-builder `linux` targets (AppImage/deb) exist in config; never built here. Needs `fpm`/AppTool; buildable on Linux CI.
- Adapters: tray/notification, secret service, desktop control likely **PLATFORM UNSUPPORTED** honestly.
- Local AI: llama.cpp Linux build. **Status: NOT BUILT.** 🖥️

### 4. Android — exact remaining work
- Initialize Capacitor (`cap add android`), choose path (see §7): **shell-over-hosted-web** first.
- Native Google sign-in (Custom Tabs) → token handoff to `/api/auth`; mic/notifications/background audio via Capacitor plugins; **cloud inference** (OpenRouter) as primary; local AI feasibility = later spike.
- Play signing keystore (App Signing). **Status: NOT BUILT** (config stub only).** 📱⛔(Play account/device)

### 5. iOS — exact remaining work
- `cap add ios` + macOS/Xcode runner, `ASWebAuthenticationSession` Google sign-in → token handoff, mic/audio-session, notifications, App-Store privacy manifests. **Cloud inference.** Local AI feasibility separate.
- **Status: NOT BUILT.** ⛔(Apple Developer account + macOS device)

### 6. Shared core architecture
One Node core (`src/core`) behind 31 API routes = the single brain. All clients reuse it. Preserve: MasterOrchestrator, ModelRouter, Memory, PermissionEngine/RiskEngine, search/model policy, session/auth engine, EventBus, voice pipeline logic. **No second anything.** 🔵

### 7. Platform adapter architecture (the key decision)
- **Recommended (smallest, preserves brain):** Windows/macOS/Linux = Electron shell + OS adapters. **Android/iOS = Capacitor WebView pointed at the hosted production origin** (reuses UI + relative `/api/` + browser voice with zero refactor). 
- **Auth consequence:** WebView-on-hosted-origin keeps cookie sessions working; a **bundled/offline** mobile client instead requires a **Bearer-token** auth flow + static/export build. Decide per milestone; default = hosted-origin shell (least risk, no brain duplication).
- Reject: repackaging Electron as mobile; parallel business logic. 🔵

### 8. Authentication architecture
Google stays the only identity provider. Web/desktop: existing server-side code+PKCE + HMAC session cookie. Mobile: native OAuth → **token handoff** to the same session engine (no password systems, no fake guest, no client secrets). Preserve `decideAppAccess` mandatory gate. 🔐🔵

### 9. Voice architecture
One pipeline: audio→ASR→transcript→intent→MasterOrchestrator→ModelRouter→execute→observe→verify→response→TTS. Browser `AudioEngine` runs in WebView. Add **platform adapters only** (mic permission, audio session/interruption, Bluetooth, background) — no per-platform logic, no fake states. 🔵📱

### 10. Local AI strategy
Desktop-only (llama.cpp + signed GGUF, integrity + benchmark→usable), per-OS builds. Mobile: **NOT with the desktop path.** Run an on-device feasibility spike (MLC/Core ML/ExecuTorch, memory/thermal/battery); until then mobile = cloud. **Never fake offline AI.** 🖥️📱

### 11. Cloud AI strategy
OpenRouter via existing ModelRouter for online; honest NOT CONFIGURED when unset. Mobile primary inference. 🔵

### 12. Security strategy
Per-platform secret storage (DPAPI/Keychain/libsecret/Keystore/Keychain-iOS); OAuth redirect vs custom-scheme/universal links; token vs cookie handling; never client secrets; no secrets in Git/APK/IPA/DMG/logs/public env. Extend `AKANSHA_AUTH_SECURITY.md`. 🔐

### 13. Build strategy
Reproducible matrix: Win/macOS/Linux via electron-builder; Android via gradle (`assembleRelease`/`bundleRelease` → `.aab`), iOS via Xcode archive. Deterministic artifact names + SHA-256 per artifact. 🧪

### 14. CI/CD strategy
GitHub Actions matrix: `windows-latest`, `macos-latest` (arm64+intel), `ubuntu-latest`, Android on ubuntu. Signing creds from **GH Secrets only**; no destructive/expensive workflows activated without approval. 🧪⛔(accounts)

### 15. Testing strategy
Shared: auth/session/AI/ModelRouter/Memory/permissions/security/errors. Desktop: install/launch/tray/close-to-tray/startup/voice/local-AI/update. Android/iOS: install, Google auth, mic permission, voice, AI request, background/foreground recovery, notifications. Live device/hardware = human-verified. 🧪⛔

### 16. Distribution strategy
GitHub Releases: Win/mac/Linux binaries (+ optional Android APK for testing). Android production: **Google Play** (`.aab`). iOS production: **TestFlight → App Store** (not a GitHub download). 🧪

### 17. Signing / notarization strategy
Windows: currently unsigned (document; consider Authenticode later). macOS: Developer ID + notarization. Android: upload keystore (Play App Signing). iOS: cert + provisioning. Credentials never committed. ⛔(Apple/Google accounts)

### 18. Estimated technical dependencies
Electron (+builder); Capacitor + @capacitor/{core,cli,android,ios} + plugins (Push, Keyboard, App/Splash, Browser/GoogleSignIn, possibly TextToSpeech/Microphone); Android SDK/JDK/Gradle; Xcode; Apple Developer + Google Play accounts; a macOS machine/runner for mac+iOS. OpenRouter key for cloud. 🔵⛔

### 19. Blockers requiring human accounts/devices
Apple Developer (notarize + iOS/TestFlight/App Store); Google Play (release signing + store); real Windows/macOS/Linux/Android/iOS devices for install/launch/voice/mic verification; OpenRouter + SMTP credentials (user-set in env). These cannot be marked VERIFIED by tooling alone. ⛔

### 20. Recommended implementation order
1. **Windows** — leave as-is (verify device install when you choose).
2. **Shared hardening** — mobile-safe auth token handoff design + capability reporting contracts (honest AVAILABLE/UNAVAILABLE/NOT CONFIGURED/PLATFORM UNSUPPORTED/REQUIRES PERMISSION).
3. **Linux** (CI-buildable, no Apple account) → then **macOS** (once a runner + Apple ID exist).
4. **Android** via Capacitor shell-over-hosted-web (buildable/signable without Apple).
5. **iOS** last (needs macOS + Apple account).
6. Coordinated multi-platform release (`v4.x`) only after each required platform is VERIFIED.
🔵🧪

---

**STOP.** No migration, builds, publishing, Vercel/`AKANSHA_RELEASES`, download-button, or signing changes will occur until you explicitly approve Phase 1. Windows v3.0.0 untouched.
