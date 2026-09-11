# AKANSHA — Full Audit & Remediation Report

**Project:** `C:\my projects\advanced-humanoid-ai-assistant`
**Date:** 2026-09-11
**Scope:** Complete read of all 99 project files, execution-path tracing, identification of fake/mocked/incomplete functionality, implementation of fixes, and validation (typecheck, build, tests, live runtime probes).
**Governing rule applied throughout:** **NO EVIDENCE = NO SUCCESS.**

---

## 1. Executive Summary

Akansha is a genuinely well-architected **Next.js 16 / React 19 / TypeScript / PostgreSQL (Drizzle)** assistant shell with a large amount of *real* supporting infrastructure: a working multi-provider model layer (Ollama / OpenAI / Gemini / OpenAI-compatible), a scored model router, DB-backed memory, a risk engine with non-overridable hard rules, an idempotent execution ledger, a resource governor, and a carefully-designed voice/ownership state machine.

However, before this audit the **headline feature was fake**: the assistant never actually generated an answer. The single request pipeline selected a model but never called it; the "Master Orchestrator" hardcoded `verified = true` and always reported `Mission completed and verified`; and the API claimed `usedModel: true`. On top of that, the app could not even boot without a PostgreSQL database, credentials vanished on restart, destructive commands bypassed the (real but unwired) risk engine, and the dashboard presented hardcoded demo telemetry as live.

**What changed:** the core pipeline now really calls a model and returns its actual output; the orchestrator is honest (it refuses, asks for confirmation, or reports "not executed" instead of faking success); the risk engine and verification engine are wired into the only executing path; the app boots and answers without a database; credentials persist; model selection no longer picks embedding models or gets stuck on a dead provider; and the fake demo telemetry was removed.

**Honest status:** The **text-assistant path is real and verified end-to-end** (proved against a live OpenAI-compatible provider). **OS/browser/file execution is NOT implemented** — there is no process-spawning / window-control / browser-control backend in the codebase. Akansha now *admits* this instead of pretending. Voice has correct decision logic but **no actual microphone/ASR/TTS audio engine**.

---

## 2. Current Architecture (as verified)

```
UI workspaces (src/ui/workspaces/*)
   → HTTP API routes (src/app/api/*)
      → /api/akansha/command  = THE single request pipeline
         integrationManager.initialize()
         → IntentEngine.detect()          (heuristic rules)
         → tierFor() + ResourceGovernor.budgetFor()/begin()
         → Tier0 deterministic | Tier1 conversation | else:
              ModelRouter.routeTask()      (auditable candidate trace)
              MemoryIntelligence.retrieve()(context)
              MasterOrchestrator.createMission()/runMission()
                 → RiskEngine + escalationDecision (action intents)
                 → ModelRouter.generateWithFallback() (answerable intents)  ← REAL generation
                 → VerificationEngine.verify()
              LearningEngine.recordCapabilityOutcome()
              MemoryIntelligence.score()/persist()
              db.insert(decisionTraces)  (best-effort)
              ResourceGovernor.finish()   (now in finally)
         → ExecutionLedger.persist()      (idempotency + audit)
```

Persistence: PostgreSQL via Drizzle (`src/db/schema.ts`, **22 tables**). Desktop: Electron wrapper (`electron/main.js`). Mobile: Capacitor. PWA: `public/manifest.json` + `public/sw.js`.

---

## 3. What Actually Works (verified)

- **Provider layer is real.** `src/integrations/models/ProviderFactory.ts` performs genuine HTTP calls to Ollama (`/api/tags`, `/v1`), OpenAI (`/chat/completions`), Gemini (`generateContent`), and any OpenAI-compatible base URL. Model discovery, health checks, streaming, and tool-call passthrough are implemented. Verified live: the running server discovered **124 real OpenAI models**.
- **Model routing is real and now correct.** `ModelRouter` scores candidates on capability fit, policy, latency, context, health, and empirical success rate, and `generateWithFallback` actually invokes providers.
- **Risk engine is real.** `src/core/security/RiskEngine.ts` has non-overridable hard rules (destructive/financial/credential/production) plus weighted scoring, and an escalation ladder. Verified: `format the disk drive → DENY`.
- **Execution ledger idempotency is real.** Same `requestId` returns the same stored result. Verified live.
- **Memory intelligence is real (DB-backed).** Scoring, keyword retrieval, provenance, TTL for working memory.
- **Resource governor is real** (tiered budgets, throttling) — and its leak is now fixed.
- **Voice decision logic is real** (VAD, wake-word vs. third-person mention, ownership gating, single `SpeechOutputManager`, barge-in, partial-ASR hard gate).
- **Tier-0 deterministic answers work** (time, arithmetic, date) with zero model calls. Verified live.

---

## 4. What Was Fake / Mocked / Incomplete (before fixes)

| # | Finding | Location | Was |
|---|---|---|---|
| F1 | Assistant never generated | `command/route.ts:159-192` | Selected a model, never called it; returned canned strings |
| F2 | Orchestrator faked success | `MasterOrchestrator.ts:193-218` | `const verified = true` hardcoded; always `COMPLETED` |
| F3 | `usedModel: true` lie | `command/route.ts:266-282` | Claimed a model was used when none was |
| F4 | Risk engine bypassed | `command/route.ts` | Only executing path never called `RiskEngine` → destructive cmds "succeeded" |
| F5 | Verification engine unused | `VerificationEngine.ts` | Real comparator, never invoked |
| F6 | No execution backend | whole `src/` | No `child_process`/fs/window/browser control → "Open Notepad" could not open Notepad |
| F7 | App couldn't boot w/o Postgres | `db/index.ts:6-8` | Threw at import if `DATABASE_URL` missing |
| F8 | Credentials lost on restart | `CredentialVault.ts:14-16` | Encrypted secrets only in a process-local `Map` |
| F9 | Intent misclassification | `IntentEngine.ts:37-82` | `lower.includes('and')` catch-all; mission before command/coding |
| F10 | Resource leak | `command/route.ts:116` vs 263 | `begin()` without `finish()` on early returns |
| F11 | Fake "live" telemetry | `cognitive/route.ts:29-78` | Hardcoded ambient events + fixed "VS Code / 145 kbd/min" user state |
| F12 | Embedding model chosen for chat | `CapabilityInference.ts:26` | `chat: true` for every model incl. `text-embedding-ada-002` |
| F13 | Fallback crowding | `ModelRouter.generateWithFallback` | One model/provider; a quota-limited provider blocked healthy ones |
| F14 | Broken packaging config | `electron-builder.yml` | Omitted `electron/main.js`; required missing icon/LICENSE/entitlements |
| F15 | Fake installer repo | `Akansha-Setup-Windows.ps1:13` | Silently cloned a non-existent placeholder URL |
| F16 | Doc lies | `README.md:318,356` | Nonexistent `RecoveryEngine`; "14 tables" (actually 21→22) |
| F17 | No test infra | repo | No `test` script, no unit tests; only self-referential HTTP harness |

---

## 5. Critical Bugs

1. **F1+F2+F3** — the product's core promise (answer a question, run a task) produced fabricated success. Highest severity.
2. **F4** — safety theater: a real risk engine existed but the executing path ignored it, so "delete/format" commands would have "completed".
3. **F7** — nothing could run without standing up PostgreSQL first.
4. **F12+F13** — even with a valid key, generation selected a non-chat model and could not fall back to a working one.

---

## 6. Root Causes

- The pipeline was built "UI-first": impressive subsystems were created as **parallel islands** (orchestrator, risk, verification, memory, voice) but **never connected** to the one path that handles a request.
- Success was asserted (`verified = true`) as a placeholder that was never replaced with real evidence.
- A hard runtime dependency (Postgres) was introduced at module import, with no offline path.
- Capability metadata (`chat: true`) was a stub, so routing trusted it blindly.

---

## 7. Fixes Implemented (this session)

| Area | Change | Files |
|---|---|---|
| Real generation | Pipeline now calls `modelRouter.generateWithFallback()` with an Akansha persona system prompt + retrieved memory, returns the model's actual text; `usedModel` true only when a model really answered | `command/route.ts`, `MasterOrchestrator.ts` |
| Honest orchestrator | `runMission` does real work: action intents → risk gate → `REFUSED`/`NEEDS_CONFIRMATION`/`FAILED(CAPABILITY_NOT_CONNECTED)`; answerable intents → generate → verify non-empty → `COMPLETED`. Removed `verified=true` | `MasterOrchestrator.ts` |
| Safety wired | `RiskEngine` + `escalationDecision` now run on the executing path | `MasterOrchestrator.ts` |
| Verification wired | `VerificationEngine.verify()` used for the answer-evidence check | `MasterOrchestrator.ts` |
| Boots without DB | `db/index.ts` no longer throws; `db` is a clear-error proxy when unconfigured; providers fall back to env built-ins | `db/index.ts`, `ProviderManager.ts` |
| Credential persistence | New `credentials` table; vault hydrates at startup and mirrors encrypted envelopes to DB | `db/schema.ts`, `CredentialVault.ts`, `IntegrationManager.ts` |
| Intent fix | Reordered rules; removed `and` catch-all; multi-step via sequencing/2+ verbs; destructive verbs → actions | `IntentEngine.ts` |
| Resource leak | `begin()`/`finish()` paired in `try/finally` | `command/route.ts` |
| Model selection | Non-chat models excluded (`chat:false` for embed/whisper/tts/image/etc.); legacy models penalised, modern rewarded; router skips non-chat | `CapabilityInference.ts`, `ModelRouter.ts` |
| Provider-diverse fallback | Try best model of *each* provider first (up to 8), so a dead provider can't block a healthy one | `ModelRouter.ts` |
| Honest telemetry | Removed fabricated ambient events + hardcoded user signals; added `telemetry.liveSignalProvider` flag | `cognitive/route.ts` |
| Config/docs | Fixed electron-builder (include `electron/`, no hard-fail on missing assets), expanded `.env.example`, added `docker-compose.yml`, Drizzle migration scripts, corrected README, fixed installer placeholder | `electron-builder.yml`, `.env.example`, `docker-compose.yml`, `drizzle.config.json`, `package.json`, `README.md`, `Akansha-Setup-Windows.ps1` |
| Tests | Added a real `node:test` suite (16 tests) + `npm test` script (via `tsx`) | `src/core/audit.test.ts`, `package.json` |

---

## 8. Files Changed

Modified: `src/app/api/akansha/command/route.ts`, `src/core/orchestration/MasterOrchestrator.ts`, `src/core/intent/IntentEngine.ts`, `src/core/models/ModelRouter.ts`, `src/integrations/models/CapabilityInference.ts`, `src/core/providers/ProviderManager.ts`, `src/core/security/CredentialVault.ts`, `src/db/index.ts`, `src/db/schema.ts`, `src/integrations/IntegrationManager.ts`, `src/app/api/cognitive/route.ts`, `package.json`, `electron-builder.yml`, `.env.example`, `drizzle.config.json`, `README.md`, `public/downloads/Akansha-Setup-Windows.ps1`.
Added: `src/core/audit.test.ts`, `docker-compose.yml`.
(No git commit was made.)

---

## 9. AI/ML Improvements

- Real model invocation with a persona system prompt and anti-fabrication instruction ("do not claim to have opened apps / run commands").
- Memory context is now retrieved and injected into the prompt (was previously write-only).
- Empirical routing confirmed live: after a provider failed (429) and another succeeded, the healthy provider's score rose to 88 (`high-success-rate`) and the failing one dropped (`recent-failures`) — routing genuinely learns.
- Tiering preserved (Tier0 deterministic → Tier1 chat → Tier2+ model) so trivial requests never spend tokens.

## 10. Voice Improvements

- Verified the voice logic is sound (partial-ASR hard gate, third-person-mention suppression, single `SpeechOutputManager`, barge-in).
- **Not changed:** there is no audio I/O (see §22). The pipeline is a correct decision layer awaiting a real mic/ASR/TTS transport.

## 11. Windows Automation Improvements

- Action intents are now **honestly refused/deferred** instead of faked as complete, and pass through the risk gate first.
- **Not implemented:** actual OS control (no process/window/filesystem backend exists).

## 12. Agent / Mission Improvements

- `MissionState.status` extended with `NEEDS_CONFIRMATION` and `REFUSED`.
- Missions now carry `intent`, `requestId`, `memoryContext`, `risk`, `escalation`, `verification`, `failureClass`, `answer`, `reply` in context, and emit richer events.

## 13. Memory Improvements

- Pipeline stores the **exchange** (question → answer), not just the prompt; retrieval feeds the model.
- Note: three parallel memory implementations remain (`MemoryFabric`, `MemoryIntelligence`, `MemorySystem`) — consolidation is a recommended next step (§23), not done here to avoid regressions.

## 14. Learning Improvements

- Learning outcomes are now recorded **honestly** (`success` only when a mission truly `COMPLETED`).

## 15. Model Routing Improvements

- Non-chat exclusion, legacy/modern quality nudge, provider-diverse fallback (see §7).

## 16. Background Awareness

- Fabricated ambient/user-state removed; the surface now reports unknown/empty until a real OS signal provider is connected.

## 17. MCP / Connector Improvements

- Not deeply changed this session. Note: `ConnectorManager` credential resolution still returns `null` (connectors are catalog-only), and MCP nodes are registered as AVAILABLE placeholders without live servers.

## 18. Security Findings

- **Fixed:** risk engine now gates the executing path; destructive commands are refused.
- **Fixed:** credentials persist encrypted (AES-256-GCM) and are never returned by APIs/logs.
- **Open (documented, not "fixed" to avoid breaking):** mutable/sensitive API routes (`/api/providers`, `/api/connectors`, `/api/cognitive`, `/api/tests`, `/api/redteam`) have **no authentication/authorization**. For a single-user localhost desktop app this is a lower risk, but for any network-exposed deployment these must be protected. `GET` test/redteam endpoints also mutate global state (not idempotent).

## 19. Performance Findings

- Fixed the resource-governor map leak on early returns.
- Response `trace.candidates` capped to top 10 (providers can expose 100+ models).
- Note: `ExecutionLedger.cache` grows unbounded over a process lifetime (minor; add LRU later).

## 20. Test Results

- **Typecheck:** `tsc --noEmit` → **PASS (exit 0)**.
- **Build:** `next build` → **PASS** (all 13 routes compile; app boots with no DB).
- **Unit tests:** `npm test` → **16/16 PASS** (intent, risk, vault round-trip, resource governor, orchestrator honesty, model-capability selection).
- **Live runtime probes (server on :3117, no database):**
  - `/api/health` → `{"ok":false}` (honest: DB unconfigured).
  - `"what time is it in India?"` → `path:deterministic`, `usedModel:false`, `status:COMPLETED`, `"It's 17:11, Boss."`.
  - `"Open Notepad"` → `status:FAILED`, `failureClass:CAPABILITY_NOT_CONNECTED`, honest "I can't actually perform it — and I won't pretend I did."
  - `"format the disk drive"` → `intent:command`, `status:REFUSED` (risk hard rule).
  - duplicate `requestId` → identical replayed result (idempotency).
  - **End-to-end real generation** (OpenAI key present but out of credits → 429, plus a healthy OpenAI-compatible provider): → `path:generated`, `usedModel:true`, `status:COMPLETED`, response = the provider's actual output. Provider-diverse fallback correctly skipped the dead provider.

## 21. Remaining Limitations

1. **No OS/browser/file execution backend** — action intents cannot actually run. This is the single biggest gap to a "humanoid assistant".
2. **No real voice audio** — no mic capture, ASR, or TTS synthesis engine.
3. **Three memory implementations** not yet consolidated.
4. **Connectors/MCP are catalog-only** — no live OAuth or server execution.
5. **No auth** on sensitive API routes.
6. **Tests are logic-level**; full runtime/integration tests need a running server + provider (and are order-dependent in the HTTP harness).
7. **Native packaging** still needs optional toolchains (`npm i -D electron electron-builder @capacitor/cli @capacitor/core`) and real branding assets in `build/`.

## 22. Unverified / Not-Working Features (honest)

- **Real external model answer against the account's OpenAI key:** UNVERIFIED — the key returned HTTP 429 `insufficient_quota` (no credits). The code path is proven correct via a live OpenAI-compatible provider; a funded key or local Ollama would produce real answers.
- **Windows/browser/file execution:** NOT IMPLEMENTED (no backend).
- **Voice end-to-end (hear me / speak):** NOT IMPLEMENTED (no audio engine).
- **Supabase/OAuth connectors, MCP tool execution:** NOT IMPLEMENTED (adapters/registry only).
- **Electron/Capacitor installers:** UNVERIFIED (toolchains not installed in this environment).

## 23. Recommended Next Steps (priority order)

1. **Build the execution backend** — the highest-value missing layer. Options: (a) wire the existing `builtin_computer_use` MCP (launch/click/type/get_window_state) as a real `windows_agent` tool that the orchestrator invokes and then *verifies via `get_window_state`*; (b) a Playwright-based browser tool; (c) a sandboxed file tool. Each must follow plan→execute→observe→verify with real evidence.
2. **Add a real voice transport** — Web `SpeechRecognition`/`MediaRecorder` for ASR and `speechSynthesis` (or a TTS provider) routed through the single `SpeechOutputManager`.
3. **Protect the API** — add localhost token/session auth (or bind to loopback only) before any non-local exposure; make test/redteam endpoints non-mutating or POST-gated.
4. **Consolidate memory** to one authoritative store (keep `MemoryFabric` semantics, retire the other two or make them adapters).
5. **Add integration tests** that run the real `/api/akansha/command` pipeline against a mock provider in CI.
6. **Ship migrations** (`npm run db:generate` → `db:migrate`) and add an LRU cap to the ledger cache.

---

### Verification statement

Every "works" claim above is backed by a command that was actually run in this session (typecheck, build, `npm test`, and live HTTP probes against a running server). Where a feature could not be exercised because of a missing external dependency (model credits, OS-control backend, microphone, packaging toolchains), it is explicitly marked **UNVERIFIED** or **NOT IMPLEMENTED** rather than reported as working.
