# AKANSHA — Windows Desktop Application

## What changed

The public “Windows” download previously served a **PowerShell script** labeled “Full
installer”, and a `.bat` that ran `start "" http://localhost:3000` (opening the system
browser). That is a developer bootstrap, not a desktop app. Akansha now ships as a
**real Electron desktop application** with a genuine Windows installer.

## Desktop architecture

```
Akansha.exe (Electron main process)
  ├─ single-instance lock (second launch focuses the existing window)
  ├─ spawns the bundled Next.js production backend as a child Node process
  │    (process.execPath + ELECTRON_RUN_AS_NODE=1, own free port)
  ├─ polls /api/health  ->  STARTING → HEALTH_CHECK → READY | ERROR
  ├─ creates a secure BrowserWindow (contextIsolation, sandbox, nodeIntegration off)
  ├─ loads the production UI into ITS OWN window (never the system browser)
  ├─ preload bridge exposes only lifecycle info (no node/shell/fs)
  └─ kills the backend on quit; shows the real error if startup fails
```

Files:
- `electron/main.js` — main process (lifecycle, single instance, secure window, backend spawn, crash handling, cleanup).
- `electron/preload.js` — narrow `contextBridge` (`akanshaDesktop.isDesktop`, `onLifecycle`, `getLifecycle`). No privileged APIs.
- `electron-builder.yml` — NSIS installer + portable, `asar:false` (Next needs real files), icon, shortcuts, uninstaller, versioned artifacts.
- `build/icon.png` — real 1024×1024 app icon (electron-builder converts to `.ico`).
- `package.json` — `productName`, `version`, `main`, `electron` + `electron-builder` devDeps, `dist:win` script.

## Development mode vs production desktop mode

| | Development | Production desktop |
|---|---|---|
| Command | `npm run dev` / `npm run electron:dev` | installed `Akansha.exe` |
| Frontend | Next dev server, hot reload | packaged `.next` build loaded by Electron |
| Backend | your terminal `next dev` | child process started by Electron |
| UI host | your browser | Electron window (owns the UI) |
| Requires Node/Git | yes | **no** |

## Backend packaging

The installer bundles the Next.js production build and the Electron/Node runtime, so the
end user needs **no** git, Node, npm, or PowerShell. Paths resolve from
`process.resourcesPath/app` when packaged and `app.getAppPath()` in dev. `asar` is
disabled because `next start` reads real files from disk.

## Security model

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Preload exposes only read-only lifecycle info — no shell, filesystem, or Node access.
- Renderer navigation is pinned to the app’s own `127.0.0.1` origin; external links open in the OS browser.
- Privileged computer-use actions still flow only through the server-side
  **Master Orchestrator → Risk Engine → Permission Engine → Execution Backend → Verification**
  pipeline (see `AKANSHA_EXECUTION_BACKEND.md`), never through a desktop API.
- The app binds its backend to `127.0.0.1` on a private free port.

## Server lifecycle & first-run

`STARTING → HEALTH_CHECK → READY` (and `STOPPING/STOPPED` on quit). The window shows a
real status; if the backend fails to start, the actual error is shown — it never displays
“Online/Ready” when the backend isn’t available. On first run the window opens, the
backend starts automatically, health is checked, then the UI loads. Sign-in uses the local
pairing token (see `AKANSHA_AUTH_SECURITY.md`); voice permissions are requested in-app.

## Installer output

`npm run dist:win` runs `next build` then `electron-builder --win nsis portable`, producing:
- `release/Akansha-Setup-<version>.exe` (NSIS installer: desktop + Start-Menu shortcuts, uninstaller)
- `release/Akansha-Portable-<version>.exe` (portable)

The landing page links the primary **Windows Desktop App** card to
`/downloads/Akansha-Setup.exe` and the **Windows Portable** card to
`/downloads/Akansha-Portable.exe`. A client-side check disables those cards (and removes
the href) if the artifact is not present, so no dead download is ever advertised. The
version badge is read from `/downloads/version.json`. The old PowerShell/batch scripts are
retained but clearly relabeled **Developer / Source Mode (requires Node + Git)**.

## Update model

**NOT IMPLEMENTED.** Auto-update is disabled (`publish: null`). A production update flow
would require signed artifacts + integrity verification + version comparison + staged
install + rollback; none of that is wired yet, so it is not claimed.

## Actual results (verified in this environment)

### VERIFIED
- **Build:** `npm run dist:win` → `EB_EXIT=0`.
- **Installer:** `release/Akansha-Setup-3.0.0.exe` — **141,779,337 bytes (135.2 MB)**, mtime 23:18:32, header `MZ` (genuine Windows PE).
- **Portable:** `release/Akansha-Portable-3.0.0.exe` — **141,487,863 bytes (134.9 MB)**, valid PE.
- **Packaged backend:** launching `win-unpacked/Akansha.exe` spawns a child `next start` (via `ELECTRON_RUN_AS_NODE`) that listens on a free port; `/api/health` → **200** `{"ok":true,"server":"up","database":"unavailable","persistence":"disabled"}`; `/` → **200** (50 KB real Akansha UI); `/api/akansha/command` without a session → **401** (auth enforced).
- **Desktop window:** a real top-level window titled **“Akansha - Premium AI Desktop Companion”** opens (Electron BrowserWindow, not a browser tab).
- **Single instance:** launching Akansha a second time left the renderer count at **1** (no second window/backend).
- **Real installation:** `Akansha-Setup-3.0.0.exe /S` installed to `%LOCALAPPDATA%\Programs\Akansha\` with `Akansha.exe` (180 MB), bundled `resources/app/node_modules/next`, a **Desktop shortcut** (`Akansha.lnk`), a **Start-Menu entry** (`Akansha - Premium AI Desktop Companion.lnk`), and `Uninstall Akansha.exe`.
- **Installed app runs:** launching the installed `Akansha.exe` → backend on a free port → `/api/health` **200**, `/` **200**, window “Akansha - Premium AI Desktop Companion”.
- **Web download chain:** served `GET /downloads/Akansha-Setup.exe` → **200**, `application/octet-stream`, 141,779,337 bytes, first bytes `MZ` (real installer, not a script). Landing page primary Windows card points to `Akansha-Setup.exe`; the `.ps1`/`.bat` are relabeled “Developer / Source Mode”.
- **Checks:** `npm test` → **32/32 pass**; `tsc --noEmit` → **0**; `next build` → **0**; `git diff --check` on real changes → **0 whitespace errors**; `git status` → only source/config/doc (no build artifacts, no `.exe`, no `.next`).

### Root-cause fixes made during packaging
1. **Installer recursion/bloat:** built `.exe`s had been copied into `public/downloads/` and were being bundled into the app (→ 2.8 GB payload, which the 32-bit NSIS can’t memory-map). Removed them from the bundle and added `!public/downloads/*.exe` + a `prepare-standalone` skip.
2. **Turbopack `pg` external:** Next 16 (Turbopack) externalized `pg` as a hashed module that failed to resolve after relocation, 500-ing every DB route. Fixed by making `src/db/index.ts` require `pg`/`drizzle` **lazily** (only when `DATABASE_URL` is set), so the no-DB packaged runtime never loads it.
3. **Electron readiness gate:** `/api/health` now returns **200** for server liveness (DB status reported in the body), and `main.js` accepts any 2xx before loading the frontend.
4. **`ERR_ELECTRON_BUILDER_CANNOT_EXECUTE`:** caused by a stray packaged-app/`node` process locking `win-unpacked`; resolved by stopping the specific process (no broad kills).
5. **ESLint scope:** added `.next-orphans/`, `release/`, `dist/`, `node_modules/` to `globalIgnores` so lint reflects real source.

### UNVERIFIED — ENVIRONMENT LIMITATION
- **Code-signing / SmartScreen:** the installer is **unsigned** (no certificate). On a real user machine, Windows SmartScreen will show a warning on first run. Not verifiable without a purchased cert.
- **macOS/Linux packaging:** configs exist but were not built/executed here (Windows-only environment).
- **Voice hardware** and **paid-model answers** remain UNVERIFIED for the reasons in `AKANSHA_VOICE_ENGINE.md` / the audit (no audio device; the configured OpenAI key has no credits).

### FAILED
- None outstanding. (The `set-state-in-effect` ESLint errors in pre-existing UI workspace files are pre-existing, unrelated to this work, and left untouched to avoid mixing unrelated refactors.)

## Known limitations

- Installer is **unsigned**; SmartScreen warns on first run.
- The Electron app loads the UI from its own `127.0.0.1` server inside an Electron window (standard Electron+Next architecture); it does **not** open the system browser.
- The app bundle intentionally excludes the installer `.exe` from `public/` (so the desktop app doesn’t embed its own installer); the web deployment must place the built installer in its `/downloads/` (or CDN) — verified locally via `next start` serving the real file.
