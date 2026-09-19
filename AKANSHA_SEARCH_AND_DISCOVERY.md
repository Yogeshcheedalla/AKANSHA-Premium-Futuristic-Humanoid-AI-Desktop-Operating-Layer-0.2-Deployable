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
- 🟡 **Size/RAM/VRAM pre‑fit in discovery** — deferred to the existing install pipeline (search API doesn't return file size); a follow‑up can fetch the GGUF file listing to pre‑rank by fit. Not faked.
- ⬜ Model Center **Search tab** UI wiring to `/api/models/search` (next slice; reuses existing Model Center, no rebuild).

### B. Web Search (real‑time information)
- ⛔ **SearXNG adapter** — needs a self‑hosted SearXNG instance (Docker) or a public one; the app must not promise unlimited free scraping. Adapter contract designed; live instance not deployed here.
- ⛔ **Playwright browser fallback** — needs the Playwright browser binaries installed; not present.
- ⛔ **Fetch → extract → dedupe → rank → cite pipeline** — designed; blocked on the above.
- ✅ **Principle locked**: current/time‑sensitive queries route to search; never answer from stale model memory; every claim keeps a source. (Intent classification already exists in `IntentEngine`.)

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

## Immediate next slices (in order)
1. Model Center **Search tab** → wire `/api/models/search` into the existing Model Center (recommended / search / installed), showing the honest installable/unsupported cards.
2. **SearXNG** self‑hosted (Docker) + `WebSearchProvider` adapter + fetch/extract/cite, with truthful rate‑limit/CAPTCHA/offline states.
3. Discovery **size‑fit** (fetch GGUF file listing → pre‑rank by device RAM/VRAM/disk).
4. **AirLLM** adapter behind a real compatibility test (desktop only).

## What I will NOT fake
Unlimited/perfect free search; universal model compatibility; mobile AirLLM; API access without credentials; install buttons for unsupported formats; READY without real inference.
