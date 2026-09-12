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

## State
- Branch: master · HEAD before this commit: affd222 ("feat: real web + MCP integration").
- NEXT: (a) obtain a code-signing cert and enable signing; (b) test install+launch on a
  clean Windows machine; (c) confirm the packaged NSIS installer (not just win-unpacked)
  installs and auto-unlocks.
