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

## FIRST-RUN AI SETUP + MODEL CENTER (2026-09-16, this pass)
Connected the backend into the real onboarding UI (no 2nd orchestrator/router).
- `src/core/aiSetup/types.ts` (types-only, client-safe) + `setupViewModel.ts`
  (pure builder + real gatherer). `src/core/catalog/catalogProvider.ts` loads +
  verifies the SIGNED catalog (never fabricates models).
- API: `GET /api/ai/setup` (public, non-secret honest VM), `POST /api/ai/mode`
  (auth — sets existing ModelRouter policy; no silent cloud), `POST /api/ai/install`
  (sensitive — drives ModelManager gates; usable=false always here; READY only
  after real inference). Fixed /api/providers VALID_TYPES to accept 'openrouter'.
- UI: `src/ui/onboarding/FirstRunOnboarding.tsx` (Welcome→device→choose AI, once
  via localStorage) + `src/ui/workspaces/ModelCenterWorkspace.tsx` (permanent, dock
  'modelcenter'); both consume /api/ai/setup. Honest badges: LOCAL RUNTIME NOT
  DETECTED / MODEL CATALOG NOT CONFIGURED / OPENROUTER CONNECTION NOT CONFIGURED /
  OFFLINE AI READY; performance Measured vs Estimated; no hard-coded model cards.
- LIVE VERIFIED: `next start` + `curl /api/ai/setup` returned real device (16.9GB/
  12 cores), runtimeAvailable:false, catalog not-configured, modelCount 0 — i.e. the
  wizard reports truth, not a fake READY. Tests 105/105 (was 97), tsc clean,
  next build ok, eslint clean.
- STILL BLOCKED (unchanged, not faked): live local inference (no runtime), real
  inference test (needs llama.cpp/Ollama + a signed artifact), OpenRouter LIVE OAuth
  (no client_id). First-run VISUAL rendering in the Electron window not screenshot-
  verified here (dev-server HTML/API verified) = environment-limited for pixels.

## DEVELOPMENT FIXTURE CATALOG (2026-09-16, this pass — HEAD f7d71c3 → this)
Lets the Model Center + install/verify state machine be exercised WITHOUT
downloading a real model. Development-only; NEVER production; never fakes usable.
- `src/core/catalog/fixtureCatalog.ts` — self-signed (ephemeral key) fixture with 3
  cards (compatible / insufficient / unsupported). Entries carry a REAL SHA-256 of
  real tiny GGUF bytes + valid signature, so integrity/GGUF/signature genuinely pass
  → UI can reach INSTALLING/VERIFYING. But `usable` is still gated on real inference
  (LocalGgufProvider/ModelManager.recordInference) → fixture stays NOT READY.
- `catalogProvider.loadSignedCatalog(env, now, allowFixture?)` — fixture loads ONLY
  when `NODE_ENV==='development' && AKANSHA_ALLOW_FIXTURE_CATALOG==='1'` (explicit
  env flag, NOT a filename). A fixture-marked catalog presented in production is
  rejected: 'fixture-in-production'. New CatalogStatus 'fixture'.
- `src/core/catalog/installState.ts` — pure resolver AVAILABLE/CHECKING/INCOMPATIBLE/
  INSTALLING/VERIFYING/FAILED/READY/BLOCKED; READY only when result.usable===true.
- ModelCenter UI: a magenta DEVELOPMENT FIXTURE banner + per-card state pill; catalog
  status 'fixture' renders the same cards (not hard-coded).
- States: Development fixture IMPLEMENTED · Production model catalog NOT CONFIGURED ·
  Live local inference BLOCKED (no runtime + no signed production artifact).
- LIVE VERIFIED BOTH WAYS: dev+flag GET /api/ai/setup → catalog 'fixture', 3 models,
  offline "FIXTURE (DEV ONLY): LOCAL RUNTIME NOT DETECTED" (never READY); production
  GET → catalog 'not-configured', fixture:false, 0 models.
- Tests 119/119 (was 105; +14 fixture), tsc 0, next build 0, eslint clean.

## REAL PROVISIONING + OFFLINE AI READY (LIVE) — 2026-09-16, HEAD 229c518 → this
Upgraded the fixture-only story to genuine, live-verified local inference, all wired
into the EXISTING ModelRouter (no 2nd router). Live on this Windows machine:
- `src/core/runtime/RuntimeProvisioner.ts` — real download→SHA-256→size→extract→
  binary-exists gate. LIVE: downloaded llama.cpp b10964 (18,427,629 B, computed
  SHA-256 `917f39c0…`), extracted via PowerShell, `llama-cli --version` ran. Tests use
  injected fetch/extract (offline) + `binary-not-found` guard.
- `src/core/models/local/LocalModelRegistry.ts` — persists genuinely-usable models;
  `provisionAndVerify()` = integrity(SHA+GGUF) → REAL llama-cli inference → benchmark
  → `usable=true` ONLY on non-empty generated text; a download/signature alone never
  flips usable. setupViewModel reads `getUsableLocalModelIds()` so OFFLINE readiness is
  real state.
- Signed PRODUCTION catalog `src/core/catalog/catalog.production.json` + bundled
  `keys/catalog.pub.pem`; entry = real qwen2.5-1.5b (url, size 1,117,320,736,
  SHA-256 `6a1a2eb6…`, Ed25519-signed, environment:production, fixture:false, estimated
  benchmark). `loadCatalogForApp` falls back to the bundled signed catalog (still
  verifies signature; fixture never auto-loads in production). **The Ed25519 PRIVATE
  key lives in `.akansha-keys/` which is gitignored — only the public key + signed json
  are committed.** Model .gguf + runtime binaries are never committed.
- OpenRouter OAuth wired: env `AKANSHA_OPENROUTER_CLIENT_ID`/redirect → PKCE
  `/api/ai/online/connect` (authorize URL, state) + `/api/ai/online/callback`
  (CSRF state check → code exchange → authenticated GET /key verify → store opaque
  credential). Never invents a client_id; LIVE browser OAuth is BLOCKED until the user
  supplies a registered client_id.
- **LIVE e2e proof**: provisionAndVerify against the real runtime + signed model →
  generated text (~30 t/s) → usable → `getSetupViewModel()` reported
  **OFFLINE AI READY** (runtime llama.cpp, usable qwen2.5-1.5b-instruct-q4_k_m).
- Tests 134/134 (was 119; +provision pipeline +oauth config +bundled catalog), tsc 0,
  next build 0, eslint 0. Desktop `C:\Users\LENOVO\Desktop\Akansha-source` READ-ONLY:
  its qwen .gguf was used only as a read-only artifact for the live inference test;
  nothing in that repo was modified.

## PRODUCTION ARCHITECTURE LAYER (2026-09-16, HEAD 448ecf8 → this)
Offline, tested extensions of the SAME architecture (no 2nd orchestrator/router/TTS):
- `src/core/catalog/ModelCatalog.ts` — rich SIGNED catalog contract (family/version/
  quant/benchmark/measured-vs-estimated/platforms/runtime/sha/signature). UI must
  consume this; never hard-code models.
- `src/core/catalog/CompatibilityEngine.ts` — MODEL×HARDWARE×RUNTIME score →
  EXCELLENT/GOOD/USABLE/SLOW/UNSUPPORTED; performance labelled Measured/Estimated/
  Unknown, never fabricated; unsupported when runtime missing.
- `src/core/runtime/RuntimeManager.ts` + `src/core/catalog/ModelManager.ts` —
  runtime ≠ model; secure install pipeline; `usable` ONLY after real inference.
- `src/core/update/ReleaseManifest.ts` — signed app/runtime/catalog release
  verification (HTTPS+Ed25519+SHA256+platform+arch+version).
- `src/core/identity/ConnectedServices.ts` + `src/integrations/openrouter/oauth.ts` —
  Akansha identity SEPARATE from OpenRouter; PKCE start/parse/complete; key stored
  only as opaque credentialRef; state-mismatch (CSRF) rejected.
- `AiMode` now supports Offline / Online / **Both** / auto (no silent fallback).
Tests now **97/97** (was 84); tsc clean; next build exit 0.

DESIGN-ONLY (NOT implemented — see AKANSHA_PRODUCTION_DISTRIBUTION.md): first-run
wizard UI, per-platform installers + code signing/notarization, Android/iOS,
cross-device sync/hosted identity, update delivery pipeline, GitHub Actions CI/CD.
BLOCKED unchanged: live local inference (no runtime), live OpenRouter OAuth (no
registered client_id), real cloud chat (no key), mic/speaker hardware.

## ACCOUNTLESS ACCESS + DIRECT OPENROUTER FLOW (2026-09-16, this pass)
Removed the mandatory Akansha-account gate; basic AI use needs no signup. Security
is preserved (one auth engine, no weakening).
- `core/auth/tokens.ts` Role += `guest`. `core/auth/guard.ts`: `guest` satisfies
  'authenticated' (chat) but is **rejected (403)** for 'sensitive'/'admin' (execute/
  install/settings) — guests are strictly weaker than 'user'. `session.issueGuest()`
  mints an accountless session (toggle: `AKANSHA_GUESTS_DISABLED=true`).
- `POST /api/auth/session {guest:true}` sets the HttpOnly session cookie → chat works
  accountless. `CommandWorkspace` offers "Continue without an account" (primary) with
  the access-token path as optional "full local control".
- OpenRouter unchanged/secure: Model Center "Continue with OpenRouter" POSTs
  /api/ai/online/connect and opens OpenRouter's OWN authorize/signup page (new tab);
  Akansha never handles the OpenRouter password and never creates an account. PKCE +
  CSRF state + code exchange + authenticated GET /key + opaque vault retained.
- Failure labels surfaced in UI: OPENROUTER CONNECTION NOT CONFIGURED / UNAVAILABLE /
  reconnect path. Offline & Both stay usable accountless; no silent cloud fallback.
- Verified: 141/141 tests (was 134; +7 guestAuth.test), tsc 0, next build 0.
- LIVE OAuth: still BLOCKED — needs a registered client_id (never invented).
- Vercel: push to main auto-redeploys (git-connected); verify on
  https://akansha-gamma.vercel.app after push.

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
