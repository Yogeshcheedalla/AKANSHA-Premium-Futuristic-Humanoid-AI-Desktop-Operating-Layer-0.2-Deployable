# Akansha — Backend Startup Diagnostics Report

Local validation build. **Nothing published/pushed/deployed.** Windows v3.0.0 GitHub release, `AKANSHA_RELEASES`, download button, and Vercel are untouched.

## A. Exact root cause
The previously reported "Akansha backend could not start" is **not reproducible from current source**. Rebuilding `win-unpacked` from HEAD `84ac62e` and launching the real packaged `Akansha.exe` starts the bundled Next backend and reaches `/api/health` 200 in ~2s. The one **confirmed** defect was diagnosability: `main.js` forwarded backend stdout/stderr only to the Electron process console, which is discarded on a normal double-click launch — so "check the logs" pointed to logs that did not exist.

## B. Evidence before fix
- Packaged backend boots: `✓ Ready`, `[ORCHESTRATOR] initialized`, `auth enabled=true`; `/api/health` → 200; `/app` → 200; `/api/memory` → 401 (protected).
- No persistent log existed on a GUI launch.

## C. Files changed
- `electron/backendLogger.js` (new) — dependency-free structured logger: writes `<userData>/backend.log`, **redacts** secrets (keys `token/secret/password/cookie/authorization/apikey/private_key/credential/session` + value patterns `Bearer…`, `GOCSPX-…`, `sk-…`, PEM private keys), rotates at 2 MB → `backend.log.1`, exposes `diagnosticReport()` (redacted).
- `electron/main.js` — `setLifecycle` is the single lifecycle choke point and now logs every transition + records `lastError` (stage/reason/timestamp/port/pid) and shows the error screen; `startBackend` logs `spawn_plan`(exe/entry/cwd/port/packaged)/`spawned`(pid)/child `stdout`/`stderr`/`exit`(code/signal)/`spawn_error`; `waitForHealthy` logs `health_ok`(attempt/status/latency) and distinguishes **"process alive but health failed"** vs unreachable; `killBackend` logs `shutdown`; startup page no longer masquerades as an error.
- `electron/preload.js` — added `retryBackend()`, `openBackendLogs()`, `copyBackendDiagnostic()`.
- Error screen now shows real **RETRY / OPEN LOGS / COPY DIAGNOSTIC / QUIT** buttons wired to `ipcMain` handlers (`akansha:retry-backend`, `akansha:open-backend-logs` → `shell.openPath`, `akansha:copy-backend-diagnostic` → `clipboard.writeText`).
- `src/core/desktop/backendLogger.test.ts` (new) — 4 tests: structured write, **redaction**, **rotation**, redacted `diagnosticReport`.

## D–E. Fix / packaging
Proven startup mechanism preserved (no rewrite of the launch path). Fresh `electron-builder --win nsis portable` from current source.

## F–G. New installer (LOCAL validation only — not published)
- Path: `release/Akansha-Setup-3.0.0.exe`
- Size: **160,409,342 bytes**
- SHA-256: `f8a35bebbd8281ac1fe2c1bf12061c9cb80004748ac0125eac0a59c622737c1d`
- (Larger than the published v3.0.0's 145,187,772 B because it includes this session's source changes; the published release is unchanged.)
- `release/win-unpacked/Akansha.exe` = 188,784,128 bytes.

## H–R. Packaged-app test results (real, on this machine)
| Check | Result |
|---|---|
| Launch packaged `Akansha.exe` | VERIFIED — backend port chosen, reached in ~2s |
| `/api/health` | VERIFIED — 200 |
| `/app` | VERIFIED — 200 (loads the Akansha app, not the landing) |
| `backend.log` written | VERIFIED — `%APPDATA%\Akansha\backend.log` with `app_start, spawn_plan, spawned, health_ok, frontend_loaded, stdout, lifecycle` |
| Log redaction | VERIFIED — no `GOCSPX`/`sk-`/Bearer/PEM/secret-key values in the log |
| Relaunch survival | VERIFIED — second launch reached health 200 |
| Port-conflict diagnostic | VERIFIED — with 47800 held + `AKANSHA_PORT=47800`, log shows `spawn_plan → spawned → stderr(EADDRINUSE) → exit code=1 → lifecycle ERROR`, **no false health_ok** |
| Graceful shutdown logging | PARTIAL — `killBackend` logs `shutdown`, but a `Stop-Process -Force` (SIGKILL) bypasses it; the graceful path (tray Quit / before-quit) logs shutdown |
| Unit tests | VERIFIED — 269/269 (incl. 4 new logger tests) |
| TypeScript | clean |
| Next build | ok |
| Lint (touched) | clean |

## S–W. Boundaries
- Git: changes committed **locally**; **push NOT done**.
- Vercel: untouched. GitHub release: untouched. `AKANSHA_RELEASES`: untouched. Windows installer (published v3.0.0): untouched.

## Remaining
- The user's original failing install was a stale/older build or an environment condition (port held by a leftover process, security software). The new build + `backend.log` means any recurrence is now diagnosable from the actual log rather than guessed.
