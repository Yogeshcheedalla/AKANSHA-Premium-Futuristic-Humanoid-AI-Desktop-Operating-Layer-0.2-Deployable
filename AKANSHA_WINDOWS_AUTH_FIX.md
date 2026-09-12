# AKANSHA — Windows Production Launch + Authentication Fix

TASK-SPECIFIC EXCEPTION (recorded per continuity rules):
This fix was performed in **advanced-humanoid-ai-assistant** because investigation
proved THIS project owns the affected landing page and packaged desktop app
(`.akansha-auth.json`, `layout.tsx` title "Akansha — Premium AI Desktop Companion",
`page.tsx` "Multi-Provider Runtime · Ollama · Gemini · OpenAI · Custom", Next.js at
:3000). **Desktop/Akansha-source remains the authoritative project for all unrelated
future work.** Do not treat this as a permanent redefinition of the authoritative repo.

## Problem (user-reported + evidence)
1. Packaged desktop showed "Authentication required — enter the token from
   `.akansha-auth.json`", which a normal user cannot satisfy → app "doesn't open
   correctly" on a fresh machine.
2. Landing page presented three equivalent Windows cards (Desktop / Portable /
   Developer-Source).

## Root cause (verified)
- `src/core/auth/session.ts` stored the bootstrap token at
  `path.join(process.cwd(), '.akansha-auth.json')`. Packaged Electron runs the
  backend with `cwd = resources/app` (Program Files, read-only) → token not
  writable/findable → hard gate.
- Download delivery itself was NOT the bug: `public/downloads/Akansha-Setup.exe`
  was a real, current PE (valid MZ, matched `release/`, v3.0.0 consistent).

## Fix (source-only; exes are gitignored)
- `electron/main.js`: generates a local access secret, persists it **encrypted via
  Electron safeStorage (Windows DPAPI)** under per-user `userData`, and passes it to
  the bundled Next backend via `AKANSHA_ACCESS_TOKEN` env → the server no longer
  needs a cwd-relative token file. Auth stays ENABLED.
- `electron/preload.js`: exposes `getBootstrapPassphrase()` over IPC.
- `src/ui/workspaces/CommandWorkspace.tsx`: on mount, when running in the desktop
  app, auto-exchanges that secret for the **httpOnly session cookie** → no manual
  token gate. Browser/dev (no desktop bridge) keeps the manual path.
- `public/landing.html`: one consumer **Windows App** card (DOWNLOAD FOR WINDOWS →
  `/downloads/Akansha-Setup.exe`); Portable + Windows/macOS/Linux source launchers
  moved under a separate **Developer / Source** section.
- Master secret never enters localStorage/URL/logs/frontend bundle; only the
  short-lived httpOnly session token reaches the browser context.

## Verification (evidence)
- typecheck `tsc --noEmit`: clean. `npm test`: **39/39** (voice/MCP/web/planner/verifier).
- `next build`: ok.
- Server-level auth proof (backend started with only `AKANSHA_ACCESS_TOKEN`, no file):
  health 200; wrong passphrase → 401; correct → 200 + httpOnly cookie;
  `/api/akansha/command` WITHOUT cookie → **401** (auth enforced); WITH cookie → 200.
- **Packaged app** (`release/win-unpacked/Akansha.exe`) launched via CDP:
  `authModal:false`, no token input, full Akansha UI ("READY", command bar,
  "Master Orchestrator Active"); unauthed `/api/akansha/command` → 401; `/api/health` → 200.
  Screenshot: outputs/Akansha-packaged-autoauth.png.
- Landing served artifact refreshed to the current build; validated MZ + size + sha256
  match `release/Akansha-Setup-3.0.0.exe` (recorded at commit time).

## Known limitations / BLOCKED
- **CLEAN-MACHINE TEST: BLOCKED** — no separate clean Windows VM available. Verified
  locally (this machine) only. Do NOT claim cross-device success.
- **Code signing: NOT DONE** — `electron-builder.yml` keeps `signAndEditExecutable:false`
  (no certificate). Unsigned exe → Windows SmartScreen prompt on other machines. Needs a
  code-signing cert to fully resolve.
- `asar:false` is required here (Next `next start` reads loose files) — electron-builder
  warns; acceptable for this architecture.

## Cross-platform distribution (this pass)
Landing (`public/landing.html`) redesigned to ONE product with a platform tab per
OS + auto-detect, and a separate Developer / Source section. No dead links: every
action points to a real file or the real PWA install.
- **Windows** — `DOWNLOAD FOR WINDOWS` → `/downloads/Akansha-Setup.exe`. VERIFIED:
  NSIS install → launch → **no auth modal** → UI → `/api/health` 200 → unauthed
  `/api/akansha/command` 401. Served exe: real PE (MZ), 145,187,772 B, HEAD 200 octet-stream.
- **macOS** — `DOWNLOAD FOR MAC` → `/downloads/Akansha-macOS-Launcher.command` (source
  bootstrap, requires Node+Git). Production signed `.dmg`: **NOT BUILT** here → **BLOCKED**.
- **Linux** — `DOWNLOAD FOR LINUX` → `/downloads/Akansha-Linux-Launcher.sh` (source).
  Native `.AppImage/.deb`: **NOT BUILT** here → **BLOCKED**.
- **Android** — `GET AKANSHA FOR ANDROID` → real **PWA install** (manifest.json + sw.js +
  beforeinstallprompt). Signed APK / Play Store: **NOT IMPLEMENTED**.
- **iOS** — `ADD TO HOME SCREEN` → real **PWA**. App Store/TestFlight: **NOT IMPLEMENTED**.
- Landing render VERIFIED in packaged Chromium (tabs [Windows,macOS,Linux,Android,iOS],
  auto-detect Windows, DOWNLOAD FOR WINDOWS). The installer intentionally excludes
  `public/downloads/*.exe` (small installer), so the page's artifact-guard shows
  "not built in this deployment" inside the desktop app; on the web host that serves
  `public/downloads/` the download works (HEAD 200 / 145 MB verified).

## State
- Branch: master · HEAD: 3cf472e (auth fix) + this distribution commit.
- Git remote: **NONE / BLOCKED** — no repository URL exists in project evidence
  (`package.json.repository` null, no GitHub URL); did NOT guess. Cannot push.
- NEXT: (a) add the correct GitHub remote (needs the real repo URL from you) + push;
  (b) code-sign Windows + notarize macOS; (c) build macOS `.dmg` (Mac) + Linux
  `.AppImage/.deb` (Linux); (d) publish signed Android APK / iOS via stores;
  (e) rebuild installer to embed the redesigned landing.
