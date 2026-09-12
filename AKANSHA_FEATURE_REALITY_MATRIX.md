# AKANSHA — Feature Reality Matrix (audit-only)

**Method:** Static call-graph inspection + live runtime traces against the running server (`next start`, no DB, OpenAI key present but out of credits) on 2026-09-11. Every claim below is backed by code inspection or a command that was actually run. No behavior was changed for this audit.

**Legend:** A = REAL + VERIFIED · B = REAL CODE, not runtime-verified · C = PARTIALLY IMPLEMENTED · D = MOCK/SIMULATION · E = PLACEHOLDER/TODO · F = DOCUMENTATION ONLY · G = BROKEN · H = MISSING

## Runtime traces (actual responses)

| Input | intent | path | outcome (observed) |
|---|---|---|---|
| “hello” / “how are you?” | conversation | conversation | canned string “Hello, Boss…” (not a model) |
| “what time is it in India?” | information_request | deterministic | “It’s 23:49, Boss.” ✅ |
| “explain Kubernetes” | information_request | orchestrated | FAILED / MODEL_UNAVAILABLE (key out of credits) |
| “research the latest developments in AI” | research | orchestrated | FAILED / MODEL_UNAVAILABLE |
| “remember that my project is important” | **command** | orchestrated | FAILED / UNKNOWN_STATE — **not treated as memory** |
| “format the disk drive” | command | orchestrated | **REFUSED** (risk hard rule) ✅ |
| “stop everything” | command | orchestrated | FAILED / UNKNOWN_STATE — **no cancellation** |
| “open character map and type Hello Akansha” | mission | orchestrated | launch **verified=true**; type **verified=false** (text read-back empty) → FAILED |
| “open Notepad and write Hello Akansha” | mission | orchestrated | launch **verified=true**; type **verified=false** (text read-back empty) → FAILED |
| “open Chrome and search for AI news” | mission | orchestrated | no plan (Chrome not in registry) → UNKNOWN_STATE |

## Feature matrix

| Feature | Location | Implementation | Runtime evidence | Status | Fake/Mock? | Missing parts | Risk | Priority | Next action |
|---|---|---|---|---|---|---|---|---|---|
| Electron desktop app | `electron/main.js`,`preload.js` | Real BrowserWindow, single-instance, spawns bundled `next start` | Installed + launched; window “Akansha - Premium AI Desktop Companion”; health 200 | **A** | No | — | Low | done | Keep |
| Windows installer / portable | `electron-builder.yml`,`release/` | NSIS + portable, genuine PE | 135 MB PE, `/S` install, shortcuts, uninstaller | **A** | No | code-signing | Low | done | Sign cert |
| Health / lifecycle gate | `health/route.ts`,`main.js` | 200 liveness + startup gate | /api/health 200; gate loads UI | **A** | No | — | Low | done | Keep |
| Intent engine | `intent/IntentEngine.ts` | Rule-based classifier | Traces above correct except “remember/stop” | **B** | No | no memory/cancel intents | Med | P1 | Add intents |
| Master Orchestrator | `orchestration/MasterOrchestrator.ts` | Single authority; risk→plan→execute→verify | Fake-success removed; honest statuses | **A** | No | — | Low | P2 | Keep |
| Model generation | `models/ModelRouter.ts` `generateWithFallback` | Real provider HTTP calls | Verified earlier via healthy provider (`usedModel:true`, real text). Now MODEL_UNAVAILABLE (credits) | **A** (code) / **B** (this env) | No | needs funded provider to demo | Low | P1 | Fund key / add provider |
| Model routing (chat vs embed, fallback) | `ModelRouter.ts`,`CapabilityInference.ts` | Non-chat excluded, provider-diverse | Unit-tested + observed | **A** | No | — | Low | done | Keep |
| Risk engine | `security/RiskEngine.ts` | Hard rules + scoring | “format disk” → REFUSED | **A** | No | — | Low | done | Keep |
| Idempotency | `runtime/ExecutionLedger.ts` | requestId dedupe | Duplicate returns replayed result | **A** | No | unbounded cache | Low | P3 | LRU cap |
| Windows launch + observe + verify | `execution/WindowsComputerUseProvider.ts`,`ExecutionEngine/Verifier` | PowerShell + UIA | “open charmap/notepad” → launch **verified=true** with real window title | **A** | No | — | Med | done | Keep |
| Windows **type + verify** | same | SendKeys + UIA ValuePattern read-back | Type executes but **text read-back empty → verified=false → FAILED** for charmap AND Notepad | **C/G** | No (honest fail) | reliable text read-back | High | **P0** | Fix verification read-back |
| Windows click / key / scroll | provider | UIA Invoke / SendKeys | Not runtime-verified | **B** | No | e2e tests | Med | P2 | Verify |
| Browser automation (Chrome, search) | — | none wired; Chrome not in registry; `pageAgent` is mock | “open Chrome…” → no plan | **H/D** | Yes (pageAgent mock) | real browser backend | High | P1 | Build browser tool |
| Page Agent (DOM) | `integrations/page-agent/PageAgentAdapter.ts` | `execute()` fabricates observation + `verified=true` (line 134) | Not reachable from pipeline | **D** | **Yes — MOCK** | real DOM engine | High | P1 | Replace or remove |
| MCP | `core/mcp/MCPMesh.ts`,`MCPManager.ts` | Registry/health/routing metadata only; `routeCapability`/`proposeSynthesis` never called; no MCP client | Not reachable | **F/C** | Registry stub | real MCP client, tool discovery/invocation | High | P1 | Implement client |
| Connectors | `core/connectors/ConnectorManager.ts` | Catalogue + DB CRUD; `resolveCredential()` returns **null**; no OAuth/API client | Not reachable | **C** | Stub | OAuth + API calls + credential resolution | High | P2 | Implement |
| Authentication | `core/auth/*`, route guards | Signed HMAC sessions, roles, httpOnly cookie, per-route `authorize` | command no-auth → 401; authz 403 tested | **A** | No | CSRF, rate-limit, token revocation store | Med | P2 | Harden |
| Authorization (capability) | `guard.ts`,`PermissionEngine.ts` | Role ranks + action permissions | user token rejected on admin route | **A** | No | per-capability grants UI | Med | P2 | Extend |
| Credential vault | `security/CredentialVault.ts` | AES-GCM + DB persistence + hydrate | Round-trip unit-tested | **A** | No | OS keystore (DPAPI) | Low | P3 | Optional |
| Memory (working/episodic/semantic/procedural/preference) | `memory/*` (3 impls) | DB-backed store/retrieve/score | **Persist only when DB configured**; with no DB nothing persists; no user-facing “remember/recall” in pipeline | **C** | No | recall-into-answer, restart persistence demo, dedupe impls | High | P1 | Wire remember/recall |
| Long-term memory persistence | `MemoryIntelligence`/`MemoryFabric` | Tables exist; needs DATABASE_URL | Not exercised (no DB) | **B** | No | DB-backed e2e | Med | P1 | Test with DB |
| Learning (experience→lesson→routing) | `learning/ExperienceReplay.ts`,`LearningEngine.ts` | Records outcomes, classifies failures, empirical model bandit, skill versioning gates | Bandit + preference learning unit/red-team tested; **does not retrain models** (by design) | **B/C** | No | cross-session persistence demo; real promotion | Med | P2 | Verify w/ DB |
| Self-improvement loop (full) | proposed | Stages partly exist (record→classify→recommend) | Not proven end-to-end (test→replay→promote→rollback) | **F/C** | No | replay/promote/rollback wiring | High | P2 | Build loop |
| Background / ambient awareness | `ambient/AmbientContextEngine.ts` | Engine + interruption policy; fake seeding REMOVED | No real event sources connected; timeline empty | **C/F** | No (was fake, now empty) | Windows/calendar/notification collectors | High | P2 | Add sources |
| Proactive assistance | `AmbientContextEngine`,`UserModel` | Policy logic exists | No live signals → never fires | **F** | No | event ingestion | Med | P2 | Wire signals |
| Voice — mic/ASR/TTS | `ui/voice/AudioEngine.ts` | getUserMedia, AudioContext VAD, SpeechRecognition, speechSynthesis, single authority, dedupe | Logic unit-tested; **hardware UNVERIFIED** (no audio device) | **B** | No | acoustic barge-in, local/cloud ASR provider | Med | P1 | Test on device |
| Acoustic barge-in | AudioEngine | Only keystroke barge-in | Not implemented acoustically | **C** | No | VAD-during-playback cancel | Med | P2 | Implement |
| Vision / screen analysis | capability graph entries | Registered as capabilities | No vision model wired to pipeline | **F** | No | vision provider + tool | Med | P3 | Implement |
| Natural conversation (follow-ups, corrections, cancellation) | `command/route.ts` | Single-turn; no session context window, no cancel | “stop everything”/“never mind” not handled | **C** | No | multi-turn state, cancel intent | High | P1 | Add |
| Canned greeting | `command/route.ts` | Fixed “Hello, Boss…” string | Observed | **D-lite** | Hardcoded string | model-backed greeting | Low | P3 | Optional |
| Persistent DB | `db/*` | Drizzle, 22 tables, lazy pg | Works with DATABASE_URL; packaged default runs without | **B** | No | migrations shipped, e2e | Med | P2 | Migrate + test |
| Terminal / shell execution | — | none (by design; only UIA) | — | **H** | No | — (intentionally excluded) | — | — | Keep excluded |
| Coding agents (Orca) | `integrations/orca/OrcaAdapter.ts` | Adapter + skills registered | Not reachable from pipeline | **F** | No | real git/worktree exec | Med | P3 | Wire or remove |

## Totals (approximate, by feature area)
- **REAL + VERIFIED (A):** Electron app, installer/portable, health/lifecycle, orchestrator honesty, model routing, risk engine, idempotency, Windows launch+observe+verify, authentication, authorization, credential vault.
- **REAL CODE, not runtime-verified (B):** model generation (blocked by credits), memory persistence (needs DB), learning, voice (needs hardware), Windows click/key/scroll.
- **PARTIALLY IMPLEMENTED (C):** Windows type+verify (fails read-back), memory (no recall), connectors, ambient, barge-in, self-improvement, conversation/cancellation.
- **MOCK/SIMULATION (D):** PageAgentAdapter.execute (hardcoded verified=true), MCP registry stubs.
- **MISSING (H):** browser automation, vision pipeline, terminal (intentionally).
- **DOCUMENTATION ONLY (F):** MCP tool execution, proactive awareness, Orca coding, vision.

## Fake-success paths found (must not be trusted)
1. `PageAgentAdapter.execute()` line 134 `const verified = true` — mock DOM verification (unreachable, but misleading).
2. Canned “Hello, Boss…” greeting is a fixed string (acceptable but not model-generated).
3. MCP nodes register with `health: 'AVAILABLE'` but there is no server behind them.

## Duplicate systems
- **Memory:** three implementations (`MemoryFabric`, `MemoryIntelligence`, `MemorySystem`) — only `MemoryIntelligence` is used by the pipeline.
- **Voice:** server `VoicePipeline` (decision) + client `AudioEngine` (transport) — intended split, not a duplicate brain.
- Event bus, orchestrator, model router: single instance each (good).

---

## Checkpoint 2 updates (after this session's fixes — verified live)

| Feature | Before | After | Evidence |
|---|---|---|---|
| Windows **type + verify** | C/G (read-back empty → FAILED) | **A — VERIFIED** | `Read-EditText` now reads `Document`/`Edit` via `TextPattern.DocumentRange.GetText()`. “open Notepad and write Hello Akansha” → COMPLETED, `text="hello akansha"` read back, `verified=true`. |
| False completion on unhandled multi-step | G reported COMPLETED after only launching Chrome | **FIXED** | Planner now returns null for “open Chrome and search…” → orchestrator honestly reports FAILED/UNKNOWN_STATE. Regression test added. |
| Browser **launch** | H (Chrome not in registry) | **A for launch** | Edge/Chrome added to registry; “open Chrome”/“open Edge” launch + verify. |
| Browser **search/navigate/interact** | missing | **still MISSING (honest)** | Not implemented; multi-clause goals fail honestly rather than fake-complete. |
| Conversation (“hello”) | canned string | **model-backed with honest fallback** | Routes through `generateWithFallback`; returns canned greeting only when no provider (credits). |
| Unit tests | 32 | **33** (added multi-clause regression) | all pass |

Still MOCK/design-only (unchanged): PageAgentAdapter.execute (mock), MCP (registry only), connectors (resolveCredential null), ambient (no live sources), vision, voice hardware.

---

## Checkpoint 3 updates — Web + MCP (after this session, verified live)

| Feature | Before | After | Evidence |
|---|---|---|---|
| Web search | MISSING | **A — VERIFIED** | Key-free DDG Instant Answer + Wikipedia providers; `webCapability.search()` returns real results; merged/deduped. |
| Web reader/extract | MISSING | **A — VERIFIED** | `HttpWebReaderProvider` fetches + extracts title/text/headings/links; example.com + Wikipedia retrieved. |
| Research mission | model-only (failed w/o credits) | **A — VERIFIED** | `POST /api/akansha/command "search the web for the latest AI developments"` → COMPLETED, 3 real sources actually retrieved + cited. |
| MCP client | registry stub only | **A — VERIFIED** | Official SDK v1.30 client; connect→discover→call→verify round-trip against a local test MCP server; `add(20,22)`→"42". |
| MCP security gate | none | **A — VERIFIED** | Unknown source → BLOCKED; privileged non-sandboxed → BLOCKED; connect refuses non-approved. HTTP: unknown server → 403. |
| MCP routes | none | **A — VERIFIED** | GET/POST /api/mcp, POST /api/mcp/call — auth-gated (admin connect, sensitive call); user session → 403 on admin route (authz enforced). |
| Browser automation | mock (PageAgentAdapter) | **PARTIAL** | New `BrowserCapabilityAdapter` reuses computer-use to launch+navigate (real, coarse). DOM element click/type/verify NOT implemented; PageAgentAdapter mock still present & unreachable. |

Still MOCK/design-only: PageAgentAdapter.execute (mock), ambient live sources, vision, self-improvement loop.
Unit tests now: 39 (added MCP security-gate + MCP round-trip + web research).
