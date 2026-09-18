# Akansha — Functionality Audit (Action Fabric Foundation)

Audit-first, evidence-based. Source HEAD `c39b524` (baseline `84ac62e`). **No push, no deploy, no release/Vercel/`AKANSHA_RELEASES` change.** Statuses: REAL_VERIFIED · REAL_BUT_UNVERIFIED · PARTIAL · MOCK · PLACEHOLDER · DESCRIPTIVE_ONLY · BLOCKED.

> **Phase 3 delta (commits `296e5e7`,`8a3dbf5`):** the Action Fabric substrate + truthful
> status engine + durable-state schema/migration are now implemented. `memory.write` is a
> REAL capability wired end-to-end through the fabric (execute → read-back verification →
> event → best-effort persistence), integration-tested. Durable DB persistence remains
> **BLOCKED** until a Postgres + `DATABASE_URL` are provisioned (see `AKANSHA_PHASE3_PLAN.md`).

> **Phase 4 delta (voice):** the clickable "Voice Enable" toggle in `VoiceControl` was
> **removed intentionally** and replaced with a truthful, non-clickable voice status
> indicator. Voice capability remains fully available through the existing single
> `AudioEngine` authority + new **keyboard activation** (Ctrl/Cmd+Space toggle,
> Ctrl/Cmd+Shift+Space push-to-talk, Escape stop — auto-repeat guarded) and the existing
> tray IPC. Added a pure typed `voiceStateMachine` (IDLE/LISTENING/TRANSCRIBING/THINKING/
> SPEAKING/WAITING_FOR_FOLLOWUP/INTERRUPTED/STOPPING/ERROR/PERMISSION_REQUIRED/UNAVAILABLE,
> invalid transitions rejected) and an `OnceGuard` for exactly-once. Status:
> **REAL_VERIFIED** for the state machine/shortcuts/exactly-once (unit-tested); live
> microphone/ASR/TTS round-trip remains **BLOCKED** (needs a real mic + provider creds).
> No second voice pipeline / TTS authority / orchestrator was introduced.

> **Phase 5 delta (desktop control):** the first REAL Windows capability
> `desktop.app.launch` is wired through the Action Fabric, reusing the existing
> `appRegistry` (allowlist resolver) + `WindowsComputerUseProvider` (real Win32 launch +
> window/pid observation) — no second orchestrator/permission/verification engine. It is
> confirmation-gated (`requiresConfirmation`), rejects shell metacharacters (no injection),
> only launches allowlisted apps, and is **VERIFIED only on observed process evidence**
> (NO EVIDENCE = NO SUCCESS). **REAL_VERIFIED on this Windows machine**: dispatching
> "notepad" returned COMPLETED with pid 26312 + `C:\Windows\System32\notepad.exe`, and an
> independent `Get-Process` confirmed the same pid. Windows-only (`desktopControlStatus` →
> UNAVAILABLE off win32). 8 fabric tests (success, unconfirmed, injection-rejected, unknown,
> no-process, non-Windows, idempotency, status).

## 1. Executive summary
Akansha is **not** a static mockup at the backend: **all 31 `/api/*` routes import real `src/core` singletons** (only `/api/health` is a status endpoint by design). The previously-fake sidebar panels (Memory/Agents/Missions/Security/Settings) were replaced this session with real singleton-backed endpoints + tests. The dominant gaps are **persistence** (in-memory; Postgres not connected) and **live external execution** (providers/MCP/models/voice/GPU) which are real code but **BLOCKED on credentials/hardware** — not fake. One genuine MOCK remains (`DevOpsWorkspace`, orphaned).

## 2–4. Repository / build / runtime state
- Web: builds + deployed (`akansha-gamma.vercel.app`), `/api/health` 200, `/api/auth/google` 302→Google (OAuth configured). VERIFIED.
- Electron: packaged `Akansha.exe` boots bundled Next backend → `/api/health` 200, `/app` 200; durable `backend.log` works. VERIFIED.
- Android: Capacitor shell opens `/app` directly; debug APK + unsigned AAB built. VERIFIED (build) / NOT VERIFIED (login, voice).
- Persistence: **PARTIAL** — Drizzle schema exists but `DATABASE_URL` unset → `persistence:disabled`; runtime state (memory, sessions, missions, registry) is **in-memory**, not durable.

## 5. Feature status inventory (per section)

| # | Feature | UI | Handler/API | Backend | Real operation | Verification | Status |
|---|---|---|---|---|---|---|---|
| 1 | Command (text) | CommandWorkspace | POST `/api/akansha/command` (11 core imports) | MasterOrchestrator | routes intent→model/tools | ExecutionLedger dedup | REAL_BUT_UNVERIFIED (live model needs creds) |
| 2 | Cognitive Layer | CognitiveWorkspace | GET/POST `/api/cognitive` (9) | VoicePipeline/UserModel/Ambient/Memory/Risk | real engines; no OS signal provider | honest empty when no signals | PARTIAL (real engines, ambient signals not wired) |
| 3 | Master Orchestrator | — | via command/execute | `MasterOrchestrator` (single) | mission/step state machine | tests | REAL_VERIFIED (unit) / single authority confirmed |
| 4 | Missions | MissionsWorkspace | GET `/api/missions` (2) | `masterOrchestrator.getActiveMissions()` | real active missions | route test | REAL_VERIFIED (read); background persistence PARTIAL |
| 5 | Architecture Graph | GraphWorkspace | GET `/api/graph` (11) | real registries (models/capabilities/agents/mcp/memory/traces/events) | runtime-derived | route test | REAL_BUT_UNVERIFIED (derived from live state, not static) |
| 6 | Repository Fabric | RepositoriesWorkspace | GET `/api/repositories` (6) | repositories service | real repo ops | — | REAL_BUT_UNVERIFIED (GitHub write ops not executed) |
| 7 | Agents | AgentsWorkspace | GET `/api/agents` (2) | `agentSupervisor.getAgents()` | real registry (idle/busy) | route test | REAL_VERIFIED (read). NOTE: seeded descriptors, not autonomous brains |
| 8 | Capability Fabric | IntegrationsWorkspace | GET `/api/system/status` (2) | integrationManager + capability registry | registration real | — | PARTIAL (capability *execution* via tool router separate) |
| 9 | AI Providers | ProvidersWorkspace | `/api/providers`, `/test`, `/[id]` | ProviderManager adapters (OpenAI/Ollama/Gemini/OpenAI-compat/OpenRouter) | real adapters | provider test route | REAL_BUT_UNVERIFIED / **BLOCKED** (no live credentials configured) |
| 10 | Model Center | ModelCenterWorkspace | `/api/ai/setup`,`/mode`,`/install`,`/online/*` | catalog + RuntimeProvisioner + ModelIntegrity + LocalModelRegistry + ModelRouter | real provisioning | signed-manifest + integrity verified in prior sessions | PARTIAL → **BLOCKED** for real inference (needs GPU + model download) |
| 11 | GPU/VRAM fabric | (Model Center) | — | HardwareProbe | CPU/RAM/disk real; VRAM needs CUDA | — | PARTIAL (detection real) / **BLOCKED** (VRAM probe needs GPU/CUDA) |
| 12 | Connectors | ConnectorsWorkspace | `/api/connectors` (2) | connectors + OAuth (OpenRouter) | real lifecycle | — | REAL_BUT_UNVERIFIED / BLOCKED (no live OAuth completed) |
| 13 | MCP | (in graph/system) | `/api/mcp`, `/api/mcp/call` | MCP client | real connect/list/call | — | REAL_BUT_UNVERIFIED (servers not all reachable here) |
| 14 | Memory | MemoryWorkspace | GET `/api/memory` (2) | MemoryFabric/MemorySystem + memoryWrite | real store/retrieve/dedupe/sensitivity | route test + read-back | REAL_VERIFIED (in-memory) / persistence PARTIAL (no DB) |
| 15 | Security | SecurityWorkspace | GET `/api/security` (4) | principal + config + permissionCatalog | real posture | route test | REAL_VERIFIED |
| 16 | Scorecard | ScorecardWorkspace | `/api/tests` (14), `/api/redteam` (9) | real test/redteam execution | measured | — | REAL_BUT_UNVERIFIED (executes real suites; not run live here) |
| 17 | Settings | SettingsWorkspace | desktop IPC | startup via preload bridge (real); prefs persisted | real | — | PARTIAL (only Start-with-Windows is wired; privacy lock disabled honestly) |
| 18 | Voice | VoiceControl/AudioEngine | VoicePipeline | mic→ASR→orchestrator→TTS (single authority) | real logic | unit-verified; hardware-blocked | REAL_BUT_UNVERIFIED / **BLOCKED** (needs mic + STT/TTS provider) |
| 19 | Desktop control | — | execute + WindowsComputerUseProvider | real Windows actions | observe+verify | — | REAL_BUT_UNVERIFIED (needs desktop session; permission-gated) |
| 20 | DevOps (orphan) | DevOpsWorkspace | none (not in dock) | **hardcoded** `status:'online', latency:'67ms', health:96` | none | — | **MOCK / PLACEHOLDER — dead code, recommend remove** |

## 6. Button / action inventory (evidence)
Frontend scan for empty handlers / fake states found **no `onClick={() => {}}`** and no fake progress bars; matches were input `placeholder=` attributes, "nothing is faked" comments, and AbortController `setTimeout`s. The only hardcoded status array is `DevOpsWorkspace` (orphan). Panels consume `/api/*` with real error/empty/needsAuth states (Slice 2).

## 7. API inventory (31 routes)
All import real `src/core` singletons (counts above). None return fabricated success; `/api/health` is the intentional status endpoint. Protected routes are `authorize()`-gated (401/403 verified).

## 8. IPC inventory (Electron)
`akansha:lifecycle`, `bootstrap-passphrase`, `get/set-startup`, `show/hide-window`, `quit`, `voice-state`, `voice-command`, and new `retry-backend`, `open-backend-logs`, `copy-backend-diagnostic`. Narrow preload bridge; no Node/FS exposure to renderer. VERIFIED (diagnostics IPC this session).

## 9. Persistence / database
Postgres/Drizzle schema exists; `DATABASE_URL` unset → **persistence:disabled**. Runtime state is in-memory. Durable multi-device sessions, mission/job persistence, model registry durability = **PARTIAL/missing** (needs DB provisioning — human action).

## 10. Descriptive-only / mock / placeholder
- **MOCK:** `DevOpsWorkspace` (hardcoded, orphaned).
- **DESCRIPTIVE_ONLY:** marketing landing copy (acceptable as landing, now truthful about platform availability).
- No fake "connected/online/ready/installed" states remain in the dock panels (Slice 2 + this session).

## 11. Blocked pipelines (real code, external dependency)
Provider inference (no creds) · MCP live calls (servers) · model install/inference (GPU + multi-GB download) · VRAM probe (CUDA) · voice ASR/TTS (mic + provider) · macOS/Linux/iOS builds (toolchain) · durable sessions (DB). These are **BLOCKED**, not fake.

## 12. Verified pipelines (evidence this session)
Google OAuth initiation · auth gate + session/RBAC · Memory/Agents/Missions/Security/Settings read paths · landing truthfulness · Electron backend startup + durable diagnostics + port-conflict detection · Android direct-`/app` boot · Windows packaged build.

## 13. Action Fabric architecture (conclusion)
The single authoritative flow already exists: **UI → command → MasterOrchestrator → ModelRouter → provider/runtime/tool → execution → observation → verification → memory/event → live UI**. A formalized `ActionRegistry/Dispatcher + VerificationEngine` (spec §63) is the recommended next foundation layer, reusing existing services (no second orchestrator/router/memory/voice).

## 14. GPU/VRAM model (honest)
HardwareProbe reports facts; must show VRAM **total vs available vs safe budget**, never fabricate. Tiers 0.5→…→detected capacity, dynamic. Real VRAM probe is BLOCKED without CUDA/GPU here.

## 15. Gap matrix (dependency-ordered)
- **CRITICAL:** persistence/DB (durable sessions, jobs, registry); provider credentials (any real inference); Action Fabric contract formalization.
- **HIGH:** model install→inference verification; MCP live health; voice provider wiring; remove `DevOpsWorkspace` mock.
- **MEDIUM:** Architecture-graph full runtime derivation; Scorecard live metrics; Settings persistence.
- **LOW:** cosmetic/premium UI polish.

## 16. Roadmap (categories)
FOUNDATION (Action Fabric + truthful status engine) → PROVIDERS (credentials + real connect/test) → RUNTIMES/MODEL CENTER (install→inference→benchmark→register) → GPU/VRAM (probe+feasibility) → CONNECTORS/MCP → AGENTS/MISSIONS (background jobs + persistence) → MEMORY/VERIFICATION/RECOVERY → CI/CD → MOBILE (Android auth/voice) → PLATFORM BUILDS (macOS/Linux/iOS).

## 17. Acceptance
Every major section audited; API/IPC inventories complete; one MOCK identified; real-vs-blocked-vs-fake separated; persistence gap documented; **no second orchestrator/router/memory/voice introduced**; nothing pushed/deployed. Tests/build/typecheck/lint run (see below).

---

## 18. Phase 6 delta — desktop close, command→fabric wiring, durable Postgres (2026-09-19)

### 18.1 Second desktop capability: `desktop.app.close` — **REAL_VERIFIED**
`src/core/desktop/desktopCapabilities.ts` registers `desktop.app.close` alongside `desktop.app.launch` on the ONE `ActionRegistry`. Execution reuses `resolveApp` (allowlist) + a new real `close` op in `WindowsComputerUseProvider` (PowerShell `Stop-Process` by resolved `processName`, then **polls `Get-Process` until the process is actually gone**). Success requires OBSERVED termination:
- nothing running → `APP_NOT_FOUND` (cannot claim we closed nothing);
- terminate attempted but process survived → `VERIFICATION_FAILED`;
- only a genuinely-absent process → `COMPLETED` (`method: processTerminated`).
No shell interpolation; same `isSafeAppName` guard rejects `notepad; powershell` / `&&` / `|`. Permission: `close` added to `PermissionEngine` map as `WINDOWS_CONTROL`, NOT auto-ok → requires confirmation.
Evidence: `desktopAppClose.test.ts` (8 tests). Real Windows e2e: `"close notepad"` → COMPLETED, `killedPid 21712`, and `Get-Process notepad` count 0 confirmed independently.

### 18.2 Command/orchestrator → Action Fabric — **REAL_VERIFIED (single path, no 2nd orchestrator)**
`MasterOrchestrator` still owns the flow. For a `command` intent it now calls `mapToDesktopAction` (`src/core/desktop/desktopCommands.ts`) — a deterministic, allowlist-resolving mapper ("open/launch/start X", "close/quit/terminate X" → `desktop.app.launch`/`close` with a canonical `application`). Anything ambiguous / multi-step / shell-like / unknown-app returns `null` and falls through to the existing planner/engine path (unknown text NEVER becomes shell execution). A matched command is executed **only** via `actionDispatcher.dispatch` (RiskEngine gate → real action → observation → verification → event → best-effort persist); the outcome is mapped truthfully back onto the mission (`fabricOutcomeToMission`, COMPLETED only on verified evidence). The desktop capabilities self-register on the singleton registry via an import side-effect in `desktopCapabilities.ts`.
Evidence: `masterOrchestratorDesktop.test.ts` (routes `"open notepad"`/`"close paint"` through the fabric, proves a fabric verification failure NEVER becomes mission success); `desktopCommands.test.ts` (5 tests incl. shell-injection/multi-step rejection). Full e2e through the fabric verified on real Windows above.

### 18.3 Durable PostgreSQL/Supabase provisioning phase — tooling **REAL_VERIFIED locally**; **production BLOCKED**
- `src/db/migrations/0001_security_and_vector.sql` (idempotent): pgvector extension + `embedding vector(1536)` + HNSW cosine indexes on memory tables; per-user **ROW LEVEL SECURITY** (`ENABLE`+`FORCE`, `USING`/`WITH CHECK` on `current_setting('akansha.user_id', true)`) for `memory_entries`, `action_executions`, `missions`, `device_sessions`. Credentials/secrets are never stored (only hashes/refs — unchanged).
- `scripts/db-provision.ts` (`npm run db:provision`) + `docker-compose.yml` now on `pgvector/pgvector:pg16`, published on **5433** (host 5432 was a different native Postgres). Offline behaviour preserved: with no `DATABASE_URL`, `src/db/index.ts` stays a throwing proxy and the harness reports **BLOCKED**, never fake success.
- Ran for real against the local Postgres — `scripts/db-provision.ts`: **9/9 PASS** — connection, drizzle migrations (5 core tables), security/RLS applied, pgvector 0.8.6 + embedding column present, least-privilege `akansha_app` role, write + read-back, **RLS read isolation** (user A cannot read user B row), **RLS write isolation** (user A cannot forge a user B row), and **backup/restore** (pg_dump → fresh db → restore, `action_executions` present). This proves the durable path works end-to-end.

### 18.4 Gates (this session)
`npm test` **312/312** · `tsc --noEmit` clean · `next build` OK · `eslint` **0 errors** (2 pre-existing non-fatal warnings; added `android/`,`ios/` to ESLint ignores so lint no longer scans generated native assets; fixed pre-existing `set-state-in-effect`/`no-unescaped-entities` in 5 UI files) · `git diff --check` clean.

### 18.5 Production status — **BLOCKED (not faked)**
Desktop + fabric changes and the durable-DB migration/harness are **local commits only**. Production cannot contain them until pushed, and pushing is gated on explicit human approval. Production persistence additionally needs a **provisioned managed Postgres + a non-superuser app role + `DATABASE_URL` set server-side** (RLS is only meaningful when the app connects as the least-privilege role, never as a superuser) — none of which exists in Vercel yet. Therefore **production health / production API verification = BLOCKED**, and no deployment was performed.

---

## 19. Phase 6b delta — `desktop.window.focus`, universal-fabric design, landing (2026-09-19)

### 19.1 Third capability: `desktop.window.focus` — **REAL_BUT_UNVERIFIED (live)** / unit-verified through the fabric
Same ONE `ActionRegistry`. A real `focus` op in `WindowsComputerUseProvider` restores + `SetForegroundWindow`s the allowlisted window (synthetic ALT to defeat the foreground lock) and **observes** the foreground window handle equals the target handle; COMPLETED only on that observed evidence, else `APP_NOT_FOUND` (no window) / `VERIFICATION_FAILED` (present but not foregrounded). Command path extended: `mapToDesktopAction` recognises "focus/activate/raise/switch to <app>" and "bring <app> to front" → `desktop.window.focus`; `IntentEngine` command verbs extended so these classify as `command` (single authority preserved — no new parser).
Live result on this machine: the fabric returned **FAILED**, NOT a false success — this non-interactive automation session is blocked by the Windows foreground-lock, so the foreground effect could not be demonstrated here. Marked **REAL_BUT_UNVERIFIED** per the spec (hardware/session-dependent), **not** simulated. `desktop.app.launch` and `desktop.app.close` remain **REAL_VERIFIED** (real pid + OS `Get-Process` confirmation this session).
Evidence: `desktopWindowFocus.test.ts` (6 unit tests: verified success, not-foreground→FAILED, no-window→APP_NOT_FOUND, unconfirmed→AUTH_REQUIRED, non-Windows→UNAVAILABLE, idempotency); `desktopCommands.test.ts` (+focus mappings & injection); `masterOrchestratorDesktop.test.ts` (+focus routed through fabric).

### 19.2 Universal Tool + Runtime + Device Fabric — **DESCRIPTIVE_ONLY (authoritative design)**
Added `AKANSHA_UNIVERSAL_FABRIC.md`: the honest architecture/roadmap for the broader vision — Akansha stays the single decision authority; OpenWorker/Browser Use/Chrome DevTools MCP/OpenHands/Mem0/scrcpy/Appium are **adapters behind the Action Fabric, never competing orchestrators**; explicit capability **permission scopes** (read-only ✅ / mutating ⚠ approval / credential-extraction & account-security 🔴 human-only); a device registry; a declarative, verified skill/dependency installer contract. Every stage lists its real BLOCKER (credentials, GPU, a signed keystore, a macOS/Apple toolchain, an interactive device). **No component was fabricated as installed/working.**

### 19.3 Landing — **truthful**
Landing now states Windows desktop control (app launch + close) as **verified** and window focus / browser / device control as **in progress**, with macOS/Linux/iOS still honest "build in progress" (PWA for mobile). No availability was added that isn't real.

### 19.4 Gates (this session)
`npm test` **321/321** (+9 focus-related) · `tsc --noEmit` clean · `next build` OK · `eslint` **0 errors** · `git diff --check` clean. LOCAL COMMIT ONLY — nothing pushed/deployed.

---

## 20. Model Center / runtime-decision — real accelerator probe (2026-09-19)

### 20.1 What already existed (and was already honest) — reused, not rebuilt
The "decide what this device can actually run → recommend → install → verify → route"
pipeline is largely present and was NOT duplicated:
- `HardwareProbe` → real `HardwareProfile` (CPU/RAM/free RAM/free disk/tier);
- `CompatibilityEngine.evaluate(model, hardware, runtime)` → 0-100 score +
  `EXCELLENT/GOOD/USABLE/SLOW/UNSUPPORTED` + `runnable` + reasons; performance labels
  are only `Measured` when a real benchmark ran, else `Estimated/Unknown` (never fabricated);
- `selectLocalModel(entries, hw, installed)` ranks the signed catalog and picks the best
  fit, returning `recommendedId:null` / `offlineReady:false` when nothing fits (no silent cloud);
- `installState.resolveCardState` reaches **READY only on `usable:true` from a real inference
  pass** — there is no path to READY from "downloaded" alone;
- `LocalModelRegistry` stays empty until a genuine `llama-cli` inference succeeds;
- `/api/ai/{setup,install,mode}` already feed this to the Model Center.

### 20.2 The genuine gap fixed this session — `HardwareProbe` accelerator probe: **REAL_VERIFIED**
`detectHardware` previously learned about a GPU only from an `AKANSHA_GPU` env hint and
reported **no VRAM at all** → recommendations were accelerator-blind. Added a best-effort,
never-faking probe: `probeAccelerator(run)` tries `nvidia-smi` (name + total + **free**
VRAM), then Windows `Win32_VideoController` (largest adapter; integrated adapters are marked
and their shared RAM is **not** claimed as VRAM); any failure degrades to `{detected:false}`.
It is injectable (a `CommandRunner`) so `detectHardware()`/`detectHardware({})` stay pure/fast
for existing tests; production call sites (`getSetupViewModel`, `/api/ai/install`,
`/api/ai/mode`) now use `detectHardwareLive()` and therefore consider the real device.
Evidence: `hardwareProbe.accelerator.test.ts` (7 tests — NVIDIA, integrated-Intel→no VRAM,
discrete AMD, no-GPU, garbage output→WMI fall-through, runner-applied, no-shell-out-when-absent).
Live run on THIS laptop detected `Intel(R) UHD Graphics`, `integrated:true`, no fabricated VRAM
(16.9 GB RAM / 3.1 GB free / 59 GB disk) and the honest recommendation is **`qwen2.5-1.5b-instruct-q4_k_m`**
(CPU fit) — a Qwen3-30B-class model is correctly NOT recommended here.

### 20.3 Download + real inference remain evidence-gated — **BLOCKED (not faked)**
The multi-GB HuggingFace download and the real inference/benchmark step are NOT executed here
(no such download attempted this session); a card can only become `READY` after a genuine
inference pass writes to `LocalModelRegistry` (per 20.1). The recommendation decision layer is
real and verified; the heavy install→inference runtime path is unchanged and remains gated on
GPU/disk/network/inference actually running. No fake "READY"/"installed"/benchmark numbers.

### 20.4 Deploy-thread reconciliation
Web deploy from the prior turn is live-verified (Vercel serving the new code). The Windows
installer + portable were **rebuilt from HEAD** this session (`dist:win`, exit 0):
`Akansha-Setup-3.0.0.exe` 160,414,560 B sha256 `d57c55c2…83304`;
`Akansha-Portable-3.0.0.exe` 160,123,115 B sha256 `67c52a90…f18e`. The GitHub **Release
publish** (asset upload + repointing `AKANSHA_RELEASES`) is intentionally **held** — the ~160 MB
upload has previously failed through this environment's proxy, and a half-uploaded release would
degrade the live download; production still serves the prior verified v3.0.0 asset. Publishing the
fresh build is a separate, connection-dependent human-gated step, not faked as done.

### 20.5 Gates (this session)
`npm test` **328/328** (+7 accelerator) · `tsc --noEmit` clean · `next build` OK · `eslint` **0 errors** · `git diff --check` clean. LOCAL COMMIT ONLY — nothing further pushed/deployed.
