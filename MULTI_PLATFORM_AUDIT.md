# Akansha — Multi-Platform Audit (Phase 0)

_Evidence-based. Generated from a live inspection of `C:\my projects\advanced-humanoid-ai-assistant` (branch `main`, HEAD `f84d24a`). No code was changed. Labels: **VERIFIED** (built + tested), **BUILT — NOT VERIFIED** (produced but not run/tested here), **NOT BUILT**._

Guiding model: **one brain, five bodies** — a single authoritative Akansha core that every platform talks to. No second orchestrator / router / memory / voice engine.

---

## 1. Current architecture (what exists today)

Akansha is **already effectively two clients over one core**, which is the key reusable fact:

| Layer | Location | Evidence |
|---|---|---|
| **Core (the brain)** — server-side TypeScript, platform-neutral business logic | `src/core/**` | MasterOrchestrator, ModelRouter, Memory (Fabric/System), PermissionEngine, RiskEngine, EventBus, providers, auth, releases, db |
| **HTTP contract** (how any client reaches the core) | `src/app/api/**` | **31** `route.ts` endpoints; guarded by `authorize(req, level)` |
| **Web UI** (React client that consumes the contract) | `src/ui/**`, `src/app/**` | **19** `fetch('/api/...')` call sites — all **relative**, so they resolve against whatever origin the page is loaded from |
| **Desktop shell** (Electron only) | `electron/{main,preload,desktop-logic}.js` | **54** IPC / `child_process` / `safeStorage` / `Tray` / `requestSingleInstanceLock` refs — **none** of this is imported by `src/` |
| **Server runtime** | Next.js node server (`next.config.ts` has **no `output` mode** → SSR, not static) | Runs on Vercel **or** as an Electron-spawned local `127.0.0.1` backend |

**Critical findings that shape everything else:**
1. **`src/` imports zero Electron APIs** (verified: `grep "from 'electron'" src` → none). The app is not coupled to the desktop shell.
2. The whole product is a **Next.js node SSR server** — it is **not** currently a static/`output:'export'` bundle. This is the single biggest constraint for a mobile client.
3. The web UI uses **relative** `/api/...` everywhere → **a client that loads the hosted origin (`https://akansha-gamma.vercel.app`) reuses the entire contract with no code change.**
4. A **Capacitor config already exists** (`capacitor.config.json`, `appId ai.akansha.mobile`) but no `android/`/`ios/` projects and no `@capacitor/*` deps installed → **mobile shell was planned, never built.**
5. Server-only modules that **cannot run in a browser/webview or Vercel serverless**: `WindowsComputerUseProvider` (desktop control), `LocalGgufProvider` + `RuntimeProvisioner`/`LocalModelRegistry` (llama.cpp), DPAPI `CredentialVault`, local auth bootstrap (`session.ts` fs). These already **degrade honestly** on the hosted web; they are desktop capabilities, not web/mobile ones.

---

## 2. Shared core (reusable by all five bodies)

Runs in Node on the server; any client reaches it over the 31 API routes. Authoritative and to be preserved exactly:

- `MasterOrchestrator` (planning → execute → observe → verify → learn) — single instance.
- `ModelRouter` (+ `resolveTurn/runTurn/routerHealth`, hybrid policy) — single router.
- Memory: `MemoryFabric`, `MemorySystem`, `memoryWrite` (sensitivity/dedupe/importance), `MemoryIntelligence`.
- `PermissionEngine`, `RiskEngine`, `escalationDecision` — capability + risk gating.
- Session/auth engine (`AuthManager`, HMAC tokens, Google OAuth code+PKCE, `decideAppAccess`), session/role model.
- `EventBus` (audit/telemetry). Providers/ModelManager. `searchDecision` + model-selection policy. Release manifest (`releaseManifest`).
- Voice **pipeline logic** `src/core/voice/VoicePipeline.ts` (transcript → intent → orchestrator → model → response → TTS decision).

These are **HTTP-reachable** and therefore reused by web, desktop, Android, iOS unchanged.

## 3. Desktop-only layer (stays desktop)

- `electron/` shell: window, system tray, close-to-tray, single-instance lock, login-startup, `safeStorage`/DPAPI vault, spawning the local backend, narrow IPC preload bridge.
- Local AI: llama.cpp runtime provisioning + signed GGUF model integrity + benchmark→usable flow (desktop hardware).
- OS control: computer-use / desktop actions (Windows today), filesystem/process execution, notifications.
- These are **per-OS**; macOS/Linux equivalents need platform adapters (below). Windows stays as-is.

## 4. Web layer (already cross-platform)

`src/app` + `src/ui` run in any modern browser. Voice in the browser is `src/ui/voice/AudioEngine.ts` (Web Audio / `getUserMedia`) + `VoiceControl.tsx` — **this same code runs inside a mobile WebView**, which is why mobile is tractable without a rewrite.

---

## 5. Platform capability matrix (honest, today)

| Capability | Windows | macOS | Linux | Android | iOS | Web |
|---|---|---|---|---|---|---|
| Build artifact | VERIFIED* | NOT BUILT | NOT BUILT | NOT BUILT | NOT BUILT | VERIFIED (deployed) |
| Core via HTTP | YES | YES | YES | YES | YES | YES |
| Google auth (cookie web) | YES | YES | YES | **needs native OAuth handoff** | **needs native OAuth handoff** | NOT CONFIGURED (creds unset) |
| Voice (mic/ASR/TTS) | VERIFIED** | NOT VERIFIED | NOT VERIFIED | WebView/WebAudio plausible — NOT BUILT | same — NOT BUILT | built |
| Local AI (llama.cpp) | YES (desktop) | feasible, NOT BUILT | feasible, NOT BUILT | **NOT FEASIBLE via current path** | **NOT FEASIBLE** | N/A (honest 501) |
| Cloud AI (OpenRouter) | YES | YES | YES | YES (primary mobile path) | YES (primary) | NOT CONFIGURED |
| Desktop process/OS control | YES | needs adapter | needs adapter | N/A | N/A | N/A |
| Tray/notifications/startup | YES | menu-bar adapter | tray adapter | notifications plugin | notifications plugin | N/A |

\* Windows installer is built + hash/size measured; **on-device install/launch is human-verification, not automated here**. \*\* Voice engine verified at unit/logic level; live microphone roundtrip is human/device-verified.

**Verdicts:** Windows = shipped (device install = human-verify). macOS/Linux = NOT BUILT. Android/iOS = NOT BUILT (only a config stub). Web = BUILT + DEPLOYED, but **auth NOT CONFIGURED**, so no real login VERIFIED.

---

## 6. Current blockers to a multi-platform product

1. **Next SSR-only server** — no static export. A mobile client must either (a) load the **hosted web origin** in a WebView (reuses everything, needs a mobile-safe auth/session story), or (b) refactor to a static client + configurable API base, or (c) native rewrite. **(a) is the smallest architecture that preserves the brain.**
2. **Auth is cookie/HttpOnly web OAuth** — works when a WebView's origin IS the hosted site, but a **fully-offline/bundled** mobile app needs a **token (Bearer) handoff** (custom URL scheme / `ASWebAuthenticationSession` on iOS, Custom Tabs on Android) against `/api/auth`.
3. **Local AI is desktop-only** — llama.cpp + GGUF cannot be copied to Android/iOS. Mobile local inference is a **separate feasibility study**; until then mobile uses authenticated cloud inference. **Never fake offline AI.**
4. **Signing/notarization**: macOS needs an Apple Developer ID + notarization (and a macOS host/runner — cannot build/notarize a DMG on Windows); iOS needs an Apple Developer account + provisioning + a macOS/Xcode runner; Android needs a Play signing keystore. None configured.
5. **Build host**: macOS & iOS **cannot** be produced on this Windows machine — they need macOS runners. Android & Linux & Windows can be produced on Windows/Linux CI.

## 7. Recommended target architecture (decision, not implementation)

- **Keep one server-side brain.** All bodies call the **same** 31 API routes + core. No duplication.
- **Windows**: unchanged (preserve v3.0.0).
- **macOS / Linux**: same Electron shell with **platform adapters** (menu-bar vs tray, notification API, credential vault API, computer-use adapters), built per-OS via electron-builder on the right runner + signed/notarized.
- **Android / iOS**: **Capacitor shell around the hosted web app** (`server.url` → production origin) is the fastest truthful path (reuses UI + `/api/` + browser voice), **plus** a native Google-OAuth token handoff and native permission adapters (mic, notifications, background/audio-session) for production quality. Defer any native-rewrite/static-export unless offline-first is required.
- **Local AI**: desktop-only; mobile = cloud inference (OpenRouter) via ModelRouter; a separate native-on-device path (MLC/Core ML/ExecuTorch) is its own later spike, explicitly **NOT BUILT**.

## 8. Requirements by dimension
- **Build**: electron-builder (Win/mac/Linux) — already configured; Capacitor (`cap add/sync/build`) for mobile — config exists, projects not created.
- **Signing**: Windows currently unsigned (`signAndEditExecutable:false`); macOS Developer ID + notarization; Android upload keystore (Play App Signing); iOS cert + provisioning. All secrets in CI/Vercel secret stores, never in Git/APK/IPA/DMG/logs.
- **Testing**: shared contract tests (auth/session/orchestration/router/memory/permission/security) + per-platform capability matrix + install/launch smoke on real devices.
- **Distribution**: GitHub Releases for Win/mac/Linux binaries (and optionally Android APK); **iOS via TestFlight/App Store** (not a GitHub download); Android via Play (APK for testing).

## 9. Alignment with existing docs
Cross-reference (do not duplicate): `AKANSHA_FEATURE_REALITY_MATRIX.md`, `AKANSHA_VOICE_ENGINE.md`, `AKANSHA_WINDOWS_DESKTOP.md`, `AKANSHA_WEB_MCP.md`, `AKANSHA_AUTH_SECURITY.md`, `AKANSHA_PRODUCTION_DISTRIBUTION.md`, `AKANSHA_OPENROUTER.md`.

---

_Human approval gates remain in force for every future step: no publishing binaries, no Vercel/`AKANSHA_RELEASES`/download-button changes, no signing-credential configuration, no CI activation, no deletion of existing release assets — without explicit approval. Windows v3.0.0 is not to be modified or rebuilt._
