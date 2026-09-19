# AKANSHA — Universal Web Search + Model Discovery + Model Installation Fabric
## Goals & Targets checklist (EXTEND, DON'T DESTROY)

Rule: MasterOrchestrator stays the single authority. Search / discovery / runtimes /
providers are **capabilities/adapters**, never a second brain. `NO EVIDENCE = NO SUCCESS`.
Status legend: ✅ done+verified · 🟡 partial · ⛔ designed, blocked on external infra/creds · ⬜ not started.

### A. Model Discovery (Hugging Face Hub, keyless)
- ✅ `src/core/models/discovery/modelDiscovery.ts` — `searchModels` / `classifyForDevice` / `discoverAndRank`.
- ✅ Keyless public HF Hub API (verified live: 8 real GGUF candidates returned).
- ✅ Honest classification: INSTALL only when GGUF + local runtime present; else "found, not currently installable" with reason. Never a fake install button.
- ✅ Offline/non‑OK → `[]` (never fabricates results).
- ✅ `GET /api/models/search?q=` (auth‑gated like the rest of the app).
- ✅ Unit tests (5) + `scripts/verify-model-discovery.ts` (real).
- ✅ Size/RAM/VRAM pre‑fit in discovery — **hardware-fit LADDER shipped (2026‑09‑19)**: `fetchArtifactInfo` reads REAL structured HF metadata (gguf.architecture / total params / context_length, sibling file sizes); 16-rung ladder (format → architecture → parameters → quantization → fileSize → RAM → VRAM → storage → CPU → GPU → OS → runtime → dependencies → context → resource pressure → verdict) is an EXTENSION of the same CompatibilityEngine; FIT/POSSIBLE/UNSUPPORTED per rung with measured/declared/estimated/unknown basis. Estimated evidence can never yield FIT; unknowns stay UNKNOWN; quantization is NEVER name-guessed; verdicts never grant install/READY (ModelManager remains the only authority). Verified live on real hardware (`scripts/verify-hardware-fit.ts`).
- ✅ Model Center **Search tab** UI wiring to `/api/models/search` (reuses existing Model Center, no rebuild).

### B. Web Search (real‑time information)
- ✅ **SearXNG capability — LIVE (2026‑09‑19, commits 53ed929 / 5f7bdd8).** `SearXNGSearchProvider` registered first in the existing `WebCapability` mesh; readiness comes ONLY from a real HTTP health probe of `SEARXNG_URL` returning real results. **Docker is not required anywhere in the product path** — the endpoint may run anywhere reachable (the local `docker-compose.yml` entry is optional dev infrastructure). Verified live end‑to‑end (`scripts/verify-web-search.ts` → `WEB SEARCH READY` against a real instance).
- ✅ **Fetch → normalize → canonical dedupe → rank → HTTP retrieval → extraction → citation pipeline** — real, with `CitationRecord` retrieval/content status tracking; failed retrievals are never presented as verified.
- 🟡 **Playwright browser fallback** — code path complete and honestly gated (used only after HTTP failure, only if the package is installed); the optional `playwright` binary is not installed, so the tier currently self-reports UNAVAILABLE. Not faked.
- ✅ **Principle locked**: current/time‑sensitive queries route to search via the existing `SearchDecision` policy; never answer from stale model memory when live data is required; every claim keeps a source.

### C. Runtimes (llama.cpp / Transformers / AirLLM)
- ✅ llama.cpp discovery incl. **packaged** `resourcesPath`/`AKANSHA_PACKAGED_RUNTIME` (bundled into the installer; verified in `win-unpacked`).
- ✅ Real inference + benchmark + persist READY (verified: integrity→inference→`registerUsable`→read‑back).
- ⛔ **AirLLM adapter** — optional heavy‑model runtime; needs Python/PyTorch + a real compatibility test; NOT default, NOT promised for mobile.
- ⛔ **Transformers adapter** — same; not started.
- ✅ Runtime selection stays in `RuntimeManager`/`CompatibilityEngine` (no second manager).

### D. Providers / API models
- ✅ Existing `ProviderManager` + `ModelRouter` + `ProviderFactory` are the provider registry (OpenAI‑compatible, Gemini, etc.). No new registry created.
- ✅ NOT CONFIGURED → honest "connect"; never pretends API works. No Ollama anywhere.

### E. Installation pipeline (unchanged, authoritative)
- ✅ Discover → resolve → compatibility → storage → runtime → download → integrity → validate → load → **real inference** → benchmark → register → READY. Downloaded ≠ installed ≠ READY; only verified inference → READY.

### F. Security (unchanged)
- ✅ Never execute downloaded model files as code; runtime deps separately verified; permission gate on consequential actions; no credential exposure; respect robots/rate limits; no CAPTCHA/auth bypass.

### G. Onboarding / daily loop (already built)
- ✅ Truthful onboarding spine (device→capability→voice→mode→models→install→enter).
- ✅ Action Fabric + Windows `desktop.app.launch/close/focus` verified; Postgres persistence live.

### H. Routing / cost policy (added)
- ✅ OpenRouter is already a first‑class provider **type** in `ProviderFactory` (base URL `openrouter.ai/api/v1`, OpenAI‑compatible) — a cloud fabric adapter under the existing ModelRouter, not a second orchestrator.
- ✅ `src/core/routing/costPolicy.ts` — free‑first ordering **local → free(cloud) → paid(cloud)** + `planCostRoute` with `requiresPaidConsent` (true only when the sole routes are paid → the UI must ask before spending).
- ✅ Wired into `ModelRouter.rank` as a stable score tiebreaker (cheaper wins ties) — existing scores unchanged, so routing only changes on ties. 5 unit tests; full suite green.
- ⛔ **OmniRouters** — not a provider I can verify exists; represented honestly as "other OpenAI‑compatible provider" via the existing factory, NOT a fabricated named adapter.
- ⬜ Surface `requiresPaidConsent` as an explicit "this needs a paid model — continue / use free‑local" prompt in the Model Center (next UI slice).

## Immediate next slices (in order)
1. Model Center **Search tab** → wire `/api/models/search` into the existing Model Center (recommended / search / installed), showing the honest installable/unsupported cards. ✅ DONE (b46600e).
2. **SearXNG** endpoint + `WebSearchProvider` adapter + fetch/extract/cite, with truthful rate‑limit/CAPTCHA/offline states. ✅ DONE (53ed929) — endpoint-driven, **no Docker dependency**.
3. Discovery **size‑fit** (fetch GGUF file listing → pre‑rank by device RAM/VRAM/disk).
4. **AirLLM** adapter behind a real compatibility test (desktop only).

## What I will NOT fake
Unlimited/perfect free search; universal model compatibility; mobile AirLLM; API access without credentials; install buttons for unsupported formats; READY without real inference.
