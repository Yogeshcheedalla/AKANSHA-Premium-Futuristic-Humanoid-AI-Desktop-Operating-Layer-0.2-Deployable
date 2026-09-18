# Akansha — Phase 3 Plan (Action Fabric + Durable State)

Baseline `26bc76d` → Phase 3 commits `296e5e7` (fabric wiring) + `8a3dbf5` (persistence).
Evidence-based; **nothing pushed/deployed**. Statuses: VERIFIED / IMPLEMENTED-NOT-VERIFIED / BLOCKED.

## 1. Completed Action Fabric path (VERIFIED)
`UI/Voice/API → command → MasterOrchestrator → ActionRegistry → ActionDispatcher →
RiskEngine(authorize) → execute → Observation → VerificationEngine(evidence) →
Recovery → EventBus + best-effort persistence → Truthful Status → UI`.
- Enforcement in code: **COMPLETED only when a verification strategy observed real
  evidence**; HTTP 200 / provider output / LLM "done" ≠ success.
- Idempotency via the existing `ExecutionLedger` (requestId). Single event system
  (`EventBus`, new `action.*` types). No second orchestrator/router/memory/voice.
- First real capability wired: **`memory.write`** → existing `processMemory` +
  read-back; integration test proves it runs THROUGH the fabric (fails if bypassed).
- Evidence: `npm test` 283/283 (7 fabric + 4 memory-integration + 3 store tests).

## 2. Database architecture + migrations
- Schema (`src/db/schema.ts`): added `device_sessions` (token **hash** only),
  `action_executions`, `jobs`, `action_events`. Existing `request_ledger`, `audit_logs`,
  `memory_*`, `missions`, `agent_tasks` remain.
- Migration `src/db/migrations/0000_action_fabric_durable_state.sql` generated
  (drizzle-kit, offline). Repository: `src/core/persistence/actionStore.ts` (best-effort,
  degrades offline).
- **Live durability: BLOCKED** — needs a provisioned Postgres/Supabase + `DATABASE_URL`
  (human action) and `npm run db:migrate`. Not claimed working.

## 3. Remaining provider / runtime gaps
- Providers (OpenAI/Gemini/Ollama/OpenAI-compatible/OpenRouter): adapters exist
  (REAL_BUT_UNVERIFIED); **BLOCKED** on credentials (configure server-side, never in
  chat/Git). Register each as a fabric capability with a `verify` that requires an
  actual completion/response observation, not a 200.
- Runtime lifecycle (llama.cpp/Ollama): real provisioning exists; **BLOCKED** for real
  inference (needs GPU + model download). Model install must register through the fabric
  with a smoke-inference verifier.
- AirLLM: to be added as a **runtime adapter beneath ModelRouter** (never an orchestrator).

## 4. MCP / connectors
- `/api/mcp`, `/api/mcp/call`, connectors + OpenRouter OAuth exist. Status must derive
  from real health checks (`deriveCapabilityStatus`), not hardcoded "8/8 online".
  Wire each connect/test as a fabric capability with observed-evidence verification.

## 5. Agents / missions
- `agentSupervisor`/`masterOrchestrator` are real registries. Missions persist only
  in-memory today → move to `jobs`/`missions` tables once DB is live. Background
  execution + pause/resume/cancel become fabric actions with typed verification.

## 6. Verification / recovery
- `VerificationEngine` + typed `FailureCode` taxonomy + one recovery attempt exist.
  Next: per-action verification strategies (file-exists, window-observed, inference-
  produced-token, commit-sha-observed) and non-retryable classification for
  permission-denied / checksum-mismatch.

## 7. Background jobs
- `jobs` table + `ActionRequest.requestId` idempotency are the substrate. Long tasks
  (model download, research, coding) become jobs whose progress is REAL (from the
  worker), surfaced via `action.progress` events; survive UI navigation/refresh.

## 8. Memory / learning
- Memory pipeline real (sensitivity/dedupe/importance + read-back). Learning =
  measurable compounding (success/latency/tool reliability → capability scores →
  routing), NOT "exponential intelligence". Never store secrets/raw audio.

## 9. Desktop / mobile / platform
- Windows installer (v3.0.0) + packaged backend + diagnostics: VERIFIED. Android shell
  direct-`/app`: VERIFIED (build); login/voice: BLOCKED (creds/device). macOS/Linux/iOS:
  NOT BUILT (need macOS runner + Apple certs / Linux CI). No platform advertised until a
  real artifact exists.

## 10. Dependency ordering (next)
1. Provision Postgres + `DATABASE_URL` → apply migration → verify durable sessions/jobs/
   action history + RLS (unblocks persistence-dependent features).
2. Configure provider credentials (server-side) → wire provider connect/test/inference as
   fabric capabilities with evidence verification.
3. Model Center install→inference→benchmark→register as fabric jobs (needs GPU).
4. MCP/connectors truthful health + capability actions.
5. Missions/agents background jobs on the fabric.
6. Platform builds via CI (macOS/Linux/Android signing) — separate approvals.

## 11. Explicit blockers / required human inputs
- Postgres/Supabase provisioning + `DATABASE_URL` (Vercel env) — human.
- Provider credentials (OpenAI/Gemini/OpenRouter) — human, server-side only.
- Android release keystore; Apple Developer ID/notarization; a macOS runner — human.
- A device/emulator with a microphone for voice round-trip.
- Approval to push/deploy/publish (all currently withheld).

## 12. Phase 3 success condition
A real UI/voice command flows through the fabric to a REAL capability, produces observed
evidence, is verified, persisted (when DB present), emits events, and the UI shows a
truthful status — with **no simulated capability** used to demonstrate the architecture.
Currently demonstrated end-to-end for `memory.write` (in-memory store). Remaining
capabilities follow the same pattern once credentials/hardware/DB are provided.
