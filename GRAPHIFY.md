# AKANSHA GRAPHIFY — advanced-humanoid-ai-assistant (REAL project)

Persistent continuity map. Read this + CONTEXT_HANDOFF.md **before** any work after a
context compaction. This describes Akansha as a relationship graph, not a TODO list.

## A. PROJECT IDENTITY + DIRECTORY AUTHORITY
- Authoritative project for all Akansha work: **`C:\my projects\advanced-humanoid-ai-assistant`**
  (TypeScript + Next.js 16 + React 19 + Electron 33 + Node/Drizzle-Postgres).
- **`C:\Users\LENOVO\Desktop\Akansha-source`** (a separate JS + Vite app) is a
  READ-ONLY REFERENCE ONLY. A prior session mistakenly treated it as authoritative;
  that was corrected on 2026-09-14 (see CONTEXT_HANDOFF → Recovery). Do NOT target,
  copy from wholesale, or modify the Desktop project. No remote is shared between
  the two repos; never mix them.
- This repo currently has **NO git remote**; commits stay local unless a remote is
  explicitly configured and pushed. Do not invent a remote.

## B. PROJECT GRAPH (single authority per responsibility)
```
Input (typed / voice)
  → ContextManager + Identity
  → Memory
  → MasterOrchestrator (src/core/orchestration)  ← THE conductor (singleton)
  → Intent / RiskEngine / PermissionEngine
  → ModelRouter (src/core/models)                ← THE only model access
      ├── Cloud providers: OpenRouter / OpenAI / Gemini / OpenAI-compat (ProviderFactory)
      └── Local provider: LocalGgufProvider (verified GGUF, llama.cpp) — gated on real inference
  → Agent/Tool execution (src/core/execution)    ← behind permission gate
  → Observation → Verification → Recovery → Learning
  → Response → Voice (single SpeechOutputManager) / UI
Voice: AudioEngine (mic, browser STT) → VoicePipeline (VAD, ownership, wake word,
       partial-ASR hard gate) → final transcript → orchestrator → response → TTS (barge-in)
Local model integrity: signed Ed25519 manifest → HTTPS → SHA-256 → GGUF validation
       → runtime launch (detectLlamaRuntime) → real inference self-test → "usable"
```
One orchestrator, one TTS authority, one model router, one provisioning path. Never add
a second of any of these. External models/providers are adapters, never the brain.

## C. CAPABILITY STATUS (evidence-based)
| Subsystem | Source | Status | Evidence |
|---|---|---|---|
| First-run AI setup (device→mode→configure→verify) | src/ui/onboarding/FirstRunOnboarding.tsx, src/app/api/ai/{setup,mode,install}, src/core/aiSetup/*, src/core/catalog/{ModelCatalog,catalogProvider} | IMPLEMENTED + LIVE-ENDPOINT-VERIFIED (honest states; no fabricated READY/runtime) | setupViewModel.test, live GET /api/ai/setup |
| Model Center (permanent) | src/ui/workspaces/ModelCenterWorkspace.tsx (dock 'modelcenter') + page.tsx | IMPLEMENTED (build ok) — consumes signed catalog | next build, live setup JSON |
| Development fixture catalog + install-state resolver | src/core/catalog/{fixtureCatalog,catalogProvider,installState}.ts | IMPLEMENTED + LIVE-VERIFIED BOTH WAYS: dev+flag → fixture (never READY, honest UNSUPPORTED w/o runtime); production → not-configured (fixture excluded by env flag, not filename) | fixtureCatalog.test 14; live curl dev+prod |
| Master Orchestrator + pipeline | src/core/orchestration, api/akansha/command | EXISTS (single) | audit.test, build |
| Risk + Permission gate | core/security/RiskEngine, core/execution/PermissionEngine | EXISTS | audit.test |
| ModelRouter (cloud+local policy, fallback) | core/models/ModelRouter | EXISTS | audit.test |
| Providers (Ollama/OpenAI/Gemini/compat) | integrations/models/ProviderFactory | EXISTS | ProviderManager |
| **OpenRouter + PKCE + verified key check** | integrations/openrouter/OpenRouter + OpenRouterProvider | IMPLEMENTED (this recovery) | OpenRouter.test 10/10; verifyKey hits /key not /models |
| **Signed manifest + GGUF + SHA integrity** | core/models/local/ModelIntegrity | IMPLEMENTED (offline) | ModelIntegrity.test 16/16 |
| **Hardware probe + Offline/Cloud AI mode** | core/runtime/HardwareProbe, core/models/local/LocalModelSelector, core/models/AiMode | IMPLEMENTED | LocalModelSelector.test 7/7, AiMode.test |
| **Verified local inference provider** | core/models/local/LocalGgufProvider | IMPLEMENTED (structure) | LocalGgufProvider.test 6/6; LIVE inference BLOCKED (no llama.cpp/Ollama runtime detected in this env) |
| Voice pipeline (mic/VAD/ownership/dedup/barge-in/partial gate) | src/ui/voice/AudioEngine, core/voice/VoicePipeline | EXISTS | voice tests in npm test |
| Voice idempotency (utteranceId → requestId) | CommandWorkspace + ExecutionLedger | FIXED (this recovery) | ExecutionLedger.test 3/3 |
| Auth/security (HMAC session, AES-GCM vault, DPAPI desktop, authorize()) | core/auth, core/security/CredentialVault, electron/main.js | EXISTS | audit.test; no plaintext on disk |
| Packaging (Electron spawns Next, NSIS/portable) | electron/main.js, electron-builder.yml | EXISTS | prior builds |

## D. VERIFICATION VOCABULARY (use exactly)
IMPLEMENTED · TESTED · VERIFIED (offline) · LIVE-VERIFIED (real runtime/network/hardware)
· BLOCKED (genuine resource missing) · NOT IMPLEMENTED.
No feature is "verified" without evidence. A unit test proves LOGIC, never live
mic/speaker/inference/OAuth. `NO EVIDENCE = NO SUCCESS`.

## E. KNOWN BLOCKERS (genuine, not faked)
- OpenRouter LIVE browser OAuth: needs a registered client_id (never invented). PKCE +
  code-exchange + /key verify are implemented and unit-tested offline.
- Local GGUF live inference: needs a detected llama.cpp/Ollama runtime + a real
  integrity-verified model artifact; in this environment none is detected, so the
  provider honestly reports UNAVAILABLE/DEGRADED. Never auto-download a large model
  or execute an unverified binary.
- Acoustic barge-in + true device mic/speaker round-trip: hardware-dependent → BLOCKED.

## F. COMPACT/CONTINUITY PROTOCOL (do first every new context)
1 resolve REAL path (advanced-humanoid-ai-assistant) → 2 read GRAPHIFY.md →
3 read CONTEXT_HANDOFF.md → 4 branch/HEAD → 5 git status → 6 diff vs last verified →
7 current task → 8 done/unfinished/blocked → 9 continue. NEVER "rebuild"; recover the
last verified checkpoint. NEVER treat the Desktop project as the target.
