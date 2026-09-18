# Akansha — Functionality Audit (Action Fabric Foundation)

Audit-first, evidence-based. Source HEAD `c39b524` (baseline `84ac62e`). **No push, no deploy, no release/Vercel/`AKANSHA_RELEASES` change.** Statuses: REAL_VERIFIED · REAL_BUT_UNVERIFIED · PARTIAL · MOCK · PLACEHOLDER · DESCRIPTIVE_ONLY · BLOCKED.

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
