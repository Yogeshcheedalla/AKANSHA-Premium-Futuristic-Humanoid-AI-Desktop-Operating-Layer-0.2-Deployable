# AKANSHA — Execution Backend (Feature 1)

## Architecture

Akansha now performs **real** operating-system execution through a clean provider boundary, driven by the existing Master Orchestrator (never bypassed).

```
USER REQUEST → FINAL INPUT GATE → INTENT → CONTEXT → MASTER ORCHESTRATOR
  → RISK ENGINE → PERMISSION ENGINE → EXECUTION PLAN → COMPUTER USE (PowerShell + UI Automation)
  → OBSERVATION → VERIFICATION → (RECOVERY) → RESULT → EVIDENCE → MEMORY → RESPONSE → UI/TTS
```

The invariant enforced everywhere: **NO EVIDENCE = NO SUCCESS.** A mission reaches `COMPLETED` only when every step’s post-condition was actually observed and verified.

## Files added

- `src/core/execution/types.ts` — contracts: `ComputerUseProvider`, `ExecutionPlan/Step`, `ExecutionEvidence`, `FailureClass`, mission statuses (`PLANNED/RUNNING/WAITING/EXECUTING/OBSERVING/VERIFYING/RECOVERING/COMPLETED/FAILED/CANCELLED/NEEDS_CONFIRMATION`).
- `src/core/execution/WindowsComputerUseProvider.ts` — **real** implementation. Spawns `powershell.exe` running a UI-Automation worker (temp script, JSON-in via base64 arg / JSON-out). Operations: launch, focus, observe, type, key, click (Invoke pattern), scroll, listWindows, screenshot. No shell interpolation → no command injection.
- `src/core/execution/appRegistry.ts` — friendly name → real exe path + window-title hint + launch strategy (`win32` vs `store`, e.g. Windows 11 Notepad alias).
- `src/core/execution/ExecutionPlanner.ts` — deterministic goal→steps parser (`open X`, `open X and type Y`, `close X`, `type Y`). Returns null when it cannot build a safe plan (never guesses an action).
- `src/core/execution/PermissionEngine.ts` — capability-level authorization (permissions per action kind; mutating actions require confirmation).
- `src/core/execution/ExecutionVerifier.ts` — deterministic verification (window-title / app-running / visible-text via UIA ValuePattern). Cheapest reliable method first.
- `src/core/execution/ExecutionRecovery.ts` — failure classification + bounded recovery (retry/wait/re-observe/fail). Never infinite-loops.
- `src/core/execution/ExecutionEngine.ts` — runs the plan, produces `ExecutionEvidence[]`, idempotent per `toolCallId`, returns `COMPLETED` only if all steps verified.
- `src/app/api/execute/route.ts` — `POST /api/execute` (SENSITIVE, auth-gated) direct execution endpoint.

## Files changed

- `src/core/orchestration/MasterOrchestrator.ts` — action-intent branch now: probes provider availability → plans → permission/confirmation gate → executes with observe+verify → sets status from real evidence; stores evidence + honest `failureClass` on the mission. Extended `MissionState.status`.
- `src/app/api/akansha/command/route.ts` — surfaces `evidence` in the response.

## APIs added

| Route | Method | Level | Purpose |
|---|---|---|---|
| `/api/execute` | POST | sensitive | Auth-gated direct execution with evidence |

## Execution flow (Open Notepad)

1. Intent = command → action path. 2. RiskEngine assesses (low). 3. PermissionEngine → `WINDOWS_CONTROL`. 4. Planner → `launch notepad` with `expect.windowTitleContains='notepad'`. 5. Provider launches the real process, polls UIA for the window. 6. Verifier confirms the window title. 7. Evidence recorded. 8. `COMPLETED` only after verification; otherwise `FAILED` with a real `failureClass` (e.g. `WINDOW_NOT_FOUND`).

## Multi-step (Open Notepad and write Hello)

Planner emits `launch` + `type` steps; the engine runs launch→verify window, then type→re-observe→verify the text is present, and only then completes. It does not stop after opening.

## Permissions & safety

- Read-only actions (observe/list/focus/scroll) may auto-run; mutating actions require the confirmation policy.
- High-risk goals are refused by the RiskEngine hard rules **before** any execution (e.g. `format the disk drive` → `REFUSED`).
- Only registry-whitelisted apps launch on the low-risk path; the worker receives data as JSON (base64), never interpolated into a command line.

## Verification strategy

Deterministic first: process/window presence, window-title match, and UIA `ValuePattern` text read-back. Vision/LLM is not required and not used for the shipped verifications.

## Recovery strategy

`classifyFailure` → `WINDOW_NOT_FOUND/TIMEOUT/APP_NOT_FOUND/PERMISSION_DENIED/PROVIDER_ERROR/…`; `decide` → wait+re-observe, retry, or fail, capped at 3 attempts.

## Tests (added)

`src/core/audit2.test.ts`: planner produces correct steps; unknown goals yield no plan; verifier passes only on observed evidence; permission maps launch→WINDOWS_CONTROL. `src/core/audit.test.ts`: orchestrator never fakes success; destructive action is REFUSED.

## Actual runtime results (verified this session)

- Standalone provider probe: launched `charmap.exe` → observed real window title **“Character Map”** (found=true, real PID).
- Full engine (foreground): `open character map` → **COMPLETED**, evidence `launch=ok title="Character Map" passed=true`.
- HTTP `POST /api/execute {goal:"open character map"}` → **COMPLETED** with evidence (`launch=ok title=Character Map`).
- HTTP `POST /api/execute {goal:"format the disk drive"}` → **403 REFUSED** (risk hard rule).
- Idempotency: same `requestId` is not re-executed.

## Remaining limitations

- **Windows-only** provider (PowerShell + UI Automation). macOS/Linux and a `builtin_computer_use` MCP transport are not implemented; the `ComputerUseProvider` interface is the seam to add them.
- **Windows 11 Store Notepad** is an app-execution alias: the launched PID may not own the visible window, so verification falls back to title matching; some Store apps need longer waits.
- Browser automation (DOM-level) is not wired into this backend yet (only desktop UIA).
- Per-action PowerShell spawn has startup latency; a persistent worker would optimize multi-step missions.

## UNVERIFIED — environment limitation

- Execution **through the detached background test server** initially reported `WINDOW_NOT_FOUND` due to a verification-merge bug (now fixed and re-verified). When Akansha runs in the user’s interactive desktop session (Electron app or `npm start` in a normal terminal) execution + observation + verification are confirmed working; a service running in a non-interactive window station would not see GUI windows.
