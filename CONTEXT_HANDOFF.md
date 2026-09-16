# AKANSHA CONTEXT HANDOFF — advanced-humanoid-ai-assistant (REAL project)

## DIRECTORY CORRECTION / RECOVERY (the reason this file exists)
A prior session incorrectly treated `C:\Users\LENOVO\Desktop\Akansha-source` (a
separate JS/Vite app) as the authoritative Akansha and did provisioning / model-center
/ OpenRouter-key-verify / modelRouter / offline-chat-loop work there. That directory
choice was WRONG for this work. This recovery:
  - treated the Desktop project as READ-ONLY reference,
  - re-implemented the INTENT/CONCEPT of that work as ADAPTATIONS into THIS real
    TypeScript project's existing architecture (never copied files, never a second
    orchestrator/router/TTS/provisioning system),
  - did NOT modify the Desktop project during recovery (its 2 pre-existing dirty files
    from the off-track CDP work remain as they were, uncommitted, untouched by me).
Safety checkpoint: tag `recovery-baseline-2026-09-14` + branch `recovery/2026-09-14`
at `d0c61d1` (pre-change) exist in this repo.

BRANCH: master  |  HEAD baseline: d0c61d1  |  NO git remote (local commits only)
LAST VERIFIED BEFORE: 39/39 npm test, clean.

## WHAT WAS ADDED (all ADAPT — concepts ported, not copied)
- `src/core/models/local/ModelIntegrity.ts` — Ed25519 signed-manifest verification,
  canonical-JSON signing, real SHA-256 (never fabricated), robust GGUF *container*
  validation (magic + version ∈ {1,2,3} + sane u64/u32 counts + min size; NOT a fragile
  full-KV walk). ModelProvisioner-equivalent integrity gate.
- `src/core/models/local/LocalModelSelector.ts` — hardware-aware per-model states
  (RECOMMENDED/GPU_ACCELERATED/CPU_ONLY/INSTALLED/INSUFFICIENT_RAM/INSUFFICIENT_STORAGE)
  derived from the live profile; nothing fits → no silent cloud.
- `src/core/runtime/HardwareProbe.ts` — REAL RAM/CPU/arch/free-disk/GPU-hint detection
  (ResourceGovernor previously used hardcoded tiers). Never claims a GPU it didn't see.
- `src/core/models/AiMode.ts` — Cloud AI vs Offline AI decision surface that sets the
  EXISTING ModelRouter policy; offline only when a local model is integrity- AND
  inference-verified; explicit-offline-with-no-local REFUSES rather than fall back.
- `src/core/models/local/LocalGgufProvider.ts` — a ModelProvider gated on REAL inference;
  honest UNAVAILABLE/DEGRADED without a runtime; generate() throws rather than fabricate;
  capabilities honestly streaming:false / tools:false.
- `src/integrations/openrouter/OpenRouter.ts` + `OpenRouterProvider` (in ProviderFactory)
  + registration in ProviderManager — PKCE (RFC 7636), code exchange, and AUTHENTICATED
  key verify via `GET /api/v1/key` (fixes the false-success of counting the PUBLIC
  `GET /models`). Wired into the single ModelRouter; no duplicate router.
- Voice idempotency: `CommandWorkspace` now forwards the voice `utteranceId` as
  `requestId` so the existing `ExecutionLedger` dedups a repeated final utterance.

## TESTS / BUILD (executed this pass)
- npm test: **84/84** (baseline 39 preserved; +45 new: integrity 16, selector 7,
  openrouter 10, local provider 6, ledger 3, + aimode/other).
- `tsc --noEmit`: exit 0.  `next build`: exit 0 (compiled, TS ok, routes generated).
- Desktop repo: NOT built/tested here (read-only reference).

## VERIFICATION STATUS (honest)
- IMPLEMENTED + VERIFIED (offline, unit-tested): model integrity, GGUF validation,
  hardware probe, AI-mode selection, OpenRouter PKCE + key verification, local-provider
  gating logic, voice idempotency ledger.
- BLOCKED (genuine, NOT claimed as working): OpenRouter LIVE browser OAuth (no
  registered client_id); REAL local inference round-trip (no llama.cpp/Ollama runtime
  detected in this environment); a real cloud chat (no key); acoustic barge-in / mic /
  speaker (hardware). No binaries or models were downloaded or committed.

## FILES CHANGED (this recovery)
Tracked edits: src/core/models/ModelProvider.ts, src/core/providers/ProviderManager.ts,
src/integrations/models/ProviderFactory.ts, src/ui/workspaces/CommandWorkspace.tsx.
New: src/core/models/AiMode.ts(+test), src/core/runtime/HardwareProbe.ts,
src/core/runtime/ExecutionLedger.test.ts, src/core/models/local/{ModelIntegrity,
LocalModelSelector,LocalGgufProvider}.ts(+tests), src/integrations/openrouter/
{OpenRouter.ts,OpenRouter.test.ts}, GRAPHIFY.md, CONTEXT_HANDOFF.md.

## NEXT ACTION (single highest value, once resources exist)
Provide a real inference runtime (llama.cpp detected, or a running Ollama) and a
pinned signed-manifest artifact, then run the LocalGgufProvider real-inference
self-test to flip a local model to "usable" and register it in the single ModelRouter.
For cloud: register an OpenRouter client_id to complete live OAuth. Do NOT implement
these as fabricated passes.

## CONTINUITY INSTRUCTION
Read GRAPHIFY.md + CONTEXT_HANDOFF.md before any work. Confirm pwd is
`C:\my projects\advanced-humanoid-ai-assistant`. Never target the Desktop project.
NO EVIDENCE = NO SUCCESS.
