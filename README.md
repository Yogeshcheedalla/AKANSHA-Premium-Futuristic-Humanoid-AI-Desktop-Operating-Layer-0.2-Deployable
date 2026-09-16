<div align="center">

# ◉ AKANSHA

### Premium Futuristic Humanoid AI Desktop Operating Layer

**One intelligence. Many providers. Zero competing brains.**

![Akansha hero](./public/assets/hero.png)

An AI operating layer designed to **understand, reason, execute, observe, verify,
remember, and improve** — across a native desktop app *and* a web experience.

<p>
  <a href="#-quick-start"><img alt="Quick Start" src="https://img.shields.io/badge/Quick_Start-00f0ff?style=for-the-badge&logo=next.js&logoColor=white"></a>
  <a href="#-architecture"><img alt="Architecture" src="https://img.shields.io/badge/Architecture-8b5cf6?style=for-the-badge"></a>
  <a href="#-capabilities--honest-status"><img alt="Capabilities" src="https://img.shields.io/badge/Capabilities-22d3ee?style=for-the-badge"></a>
  <a href="#-why-akansha-is-unique"><img alt="Why Akansha" src="https://img.shields.io/badge/Why_Akansha-f472b6?style=for-the-badge"></a>
</p>

</div>

---

## ✨ What Akansha is

Akansha is not a chatbot wrapper and not a pile of agent frameworks. It is a single
**cognitive loop** with one authoritative brain — the **MasterOrchestrator** — that turns a
request into real, *evidence-verified* outcomes:

```
Input → Identity/Context → Memory → MasterOrchestrator
      → Plan → Model (cloud or local) → Agent/Tool → Permission
      → Execute → Observe → Verify → Recover → Learn → Memory → Response
```

Everything else — OpenRouter, Ollama, Gemini, OpenAI, llama.cpp — is a **provider**, never a
second mind. If it can't be proven, it isn't claimed: *NO EVIDENCE = NO SUCCESS.*

---

## 🖼️ Architecture

![Akansha architecture](./public/assets/architecture.png)

Akansha runs in **two environments** that share one core, with a hard boundary between them:

| Layer | **Web (Vercel)** | **Desktop (Electron)** |
|---|---|---|
| Experience | Landing, app shell, account, connected services | Full local AI + OS control |
| Intelligence | **Online AI** — OpenRouter / OpenAI / Gemini / Ollama-compatible | **Offline AI** — local `llama.cpp` + signed GGUF *(and online)* |
| Secrets | Server-only env; never in the browser | OS vault (AES-256-GCM) + Windows DPAPI |
| Local model | ❌ never runs local `llama.cpp` | ✅ real Qwen2.5 GGUF inference, verified |

> The website never implies Vercel is running your local model. It isn't. Offline AI lives in
> the installed desktop app; the web surface is the online/account layer.

---

## 🧠 Core features

<table>
<tr>
<td width="50%">

### 🎯 Master Orchestration
Single authoritative engine: intent classification, risk scoring, deterministic planning
vs. model planning, honest terminal states (`COMPLETED / FAILED / REFUSED /
NEEDS_CONFIRMATION`), idempotent execution, and a decision trace per run.

### 🔐 Security-first
Role-gated API guards (`public → authenticated → sensitive → admin`), AES-256-GCM
credential vault, Windows DPAPI via Electron `safeStorage`, permission gates on every
mutating action, no plaintext keys, no secrets in logs/telemetry/prompts.

</td>
<td width="50%">

### 🤖 Model routing
One `ModelRouter` scores every provider on capability, latency, health and privacy, with
**provider-diverse fallback** so one flaky provider can't block a turn. Local and cloud sit
behind the same interface.

### 🗣️ Voice
Real browser mic capture, VAD + endpointing, a strong **conversation-ownership** gate
(talking *to* vs. *about* Akansha, third-person suppression), a single TTS authority, barge-in,
and a **partial-ASR-is-never-executable** guarantee.

</td>
</tr>
<tr>
<td>

### 🧠 Memory & learning
Persistent, self-improving memory with decision traces and capability inference — so the
same mistake is less likely to repeat.

### 🖥️ Desktop computer use
Windows execution + UI-automation tooling behind the permission gate (open/type/observe/verify),
not a free-for-all.

</td>
<td>

### 🔌 Integrations & MCP
A capability fabric with a real **MCP client** (unknown-source servers and privileged,
un-sandboxed servers are **blocked** by default), web search/read, and connector scaffolding.

</td>
</tr>
</table>

---

## 🧩 Capabilities & honest status

Statuses are truthful: `VERIFIED` (executed + tested), `IMPLEMENTED` (code + tests),
`CONFIGURED` (needs credentials to go live), `DESKTOP ONLY`, `COMING SOON`.

| Capability | Where | Status |
|---|---|---|
| MasterOrchestrator cognitive loop | Web + Desktop | **VERIFIED** |
| ModelRouter (cloud providers + fallback) | Web + Desktop | **VERIFIED** |
| OpenRouter integration (PKCE, CSRF, `/key` verify, opaque vault) | Web + Desktop | **IMPLEMENTED · VERIFIED** · live OAuth **BLOCKED** (needs a registered `client_id`; connect returns honest `501`). See [`AKANSHA_OPENROUTER.md`](./AKANSHA_OPENROUTER.md) |
| Model integrity (Ed25519 signed catalog → SHA-256 → GGUF validation) | Desktop | **VERIFIED** |
| Hardware probe (RAM/CPU/arch/GPU-hint/disk/tier) | Desktop | **VERIFIED** |
| Runtime provisioning (download → SHA → size → extract → binary-exists) | Desktop | **VERIFIED (LIVE)** |
| Real local inference via full pipeline (MasterOrchestrator → ModelRouter → LocalGgufProvider → `llama.cpp` + signed Qwen2.5-1.5B GGUF) | Desktop | **LIVE-VERIFIED** · 3-run benchmark ~29–35 tok/s gen / ~117–133 tok/s prompt (llama-reported), wall ~3.9–4.4 s incl. cold model load; `scripts/live-inference-bench.ts` |
| `usable=true` gated on real inference (never on download alone) | Desktop | **VERIFIED** |
| Offline AI mode (no silent cloud fallback — `LOCAL_ONLY` chain excludes OpenRouter) | Desktop | **VERIFIED** |
| Accountless AI (guest session, no Akansha signup; guest blocked from sensitive/admin) | Web + Desktop | **VERIFIED** |
| Voice pipeline + ownership + barge-in state + dedup | Web + Desktop | **VERIFIED (logic)** · live mic/speaker hardware-dependent |
| MCP security (unknown / unsandboxed servers blocked) | Web + Desktop | **VERIFIED** |
| First-run AI setup + permanent Model Center | Web + Desktop | **IMPLEMENTED** (live endpoint) |
| Desktop installers (Win/macOS/Linux/Android/iOS) | Desktop | see [Download](#-download) — mostly **COMING SOON** |

**Test suite:** `134/134` passing · `tsc --noEmit` clean · `next build` clean · ESLint clean.

---

## 🔍 Why Akansha is unique

- **One brain, many models.** A single orchestrator owns the loop; providers are swappable
  adapters. No competing agents, no second router, no second TTS authority.
- **Evidence over enthusiasm.** Nothing is claimed "live" unless it actually ran — inference,
  checksums, signatures, and OAuth all verified against real, executed results.
- **Local AI you can trust.** Models are only installable from an **Ed25519-signed, pinned
  manifest**; SHA-256 + GGUF structure are checked, and a model becomes `usable` **only after a
  real inference test** — never from a successful download alone.
- **Privacy by architecture.** Secrets live in an OS vault (AES-GCM + DPAPI), referenced only by
  opaque handles; the renderer never holds keys; offline requests never leak to the cloud.
- **Web *and* desktop, cleanly separated.** The same verified core powers the browser experience
  and the native app — without shipping multi-GB models or Windows binaries to the web.
- **Honest product surface.** Dead links and fake buttons are treated as bugs; unconfigured
  capabilities say "requires configuration", not "ready".

---

## 🚀 Quick Start

```bash
git clone <your-repo> akansha && cd akansha
cp .env.example .env.local      # add real values (secrets stay server-only)
npm install
npm run dev                     # http://localhost:3000
```

```bash
npm run build && npm run start  # production web
npm run electron:dev            # build web, then launch the Electron desktop shell
npm test                        # 134 tests (node:test + tsx)
npm run lint && npx tsc --noEmit
```

> The app boots with **no database** (persistence degrades gracefully); it is still fully usable.
> Local `llama.cpp` / GGUF features run **only** in the desktop app and are gated as above.

---

## ⬇️ Download

Akansha ships a native desktop application and a web experience.

| Platform | Status |
|---|---|
| **Web app** | Available now (this deployment) |
| Windows · macOS · Linux | Native installers **COMING SOON** |
| Android · iOS | **COMING SOON** |

We do not publish placeholder or fake installers as production downloads. Official artifacts
will be linked from GitHub Releases here once they exist.

---

## 🔧 Environment variables

Copy `.env.example` → `.env.local`. Secrets are **server-only**; never expose them to the browser.

| Variable | Purpose | Required | Scope |
|---|---|---|---|
| `DATABASE_URL` | Postgres (Drizzle) persistence — optional, degrades gracefully | optional | server |
| `AKANSHA_SECRET` | Credential-vault / session signing secret | recommended | server |
| `AKANSHA_OPENROUTER_CLIENT_ID` | OpenRouter OAuth PKCE client id | for live OAuth | server |
| `AKANSHA_OPENROUTER_REDIRECT_URI` | OAuth callback (must match deployed origin) | for live OAuth | server |
| `OPENROUTER_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` / `EXPLABS_API_KEY` | Provider keys for Online AI | optional | server |
| `LLAMA_CPP_PATHS` | Where to look for a local `llama.cpp` binary | desktop | server |
| `AKANSHA_MODEL_CATALOG` / `AKANSHA_CATALOG_PUBKEY(_FILE)` | Signed model catalog + public key | desktop | server |
| `NODE_ENV` + `AKANSHA_ALLOW_FIXTURE_CATALOG` | Enable the **dev-only** fixture catalog | dev only | server |

Full annotated list: [`.env.example`](./.env.example).

---

## ▲ Deploying to Vercel

Akansha is a standard Next.js (App Router) app. Only the **web layer** deploys to Vercel; local
`llama.cpp`, GGUF models, Electron and OS binaries stay desktop-only and are gitignored.

```bash
npm i -g vercel
vercel        # link + preview
vercel --prod # production
```

In the Vercel dashboard: framework **Next.js**, root **`/`**, install/build from
`package.json` (`npm install` / `npm run build`). Set the server-only env vars above. To enable
live OpenRouter OAuth, register an OpenRouter application, set `AKANSHA_OPENROUTER_CLIENT_ID`
and `AKANSHA_OPENROUTER_REDIRECT_URI` = `https://<your-domain>/api/ai/online/callback`.
Without a real `client_id`, Online AI honestly reports "not configured".

---

## 🧱 Project structure

```
src/
  app/            Next.js App Router: landing/app shell + /api/* routes
    api/          akansha/command · auth · providers · mcp · ai/{setup,mode,install,online}
  core/
    orchestration/ MasterOrchestrator (the single brain)
    models/        ModelRouter · ModelProvider · AiMode · local/ (ModelIntegrity,
                   LocalModelSelector, LocalGgufProvider, LocalModelRegistry)
    catalog/       signed ModelCatalog · CompatibilityEngine · ModelManager · fixtures
    runtime/       HardwareProbe · RuntimeManager · RuntimeProvisioner
    auth/ security/ identity/   sessions · CredentialVault · ConnectedServices · OAuth
    voice/ execution/ capabilities/ memory/ ...
  ui/             React client: workspaces · onboarding · voice AudioEngine · assistant
electron/         native main/preload (desktop only)
public/           landing.html · manifest · icons · assets
```

---

## ⚖️ License

Apache-2.0. Model weights have their own licenses (e.g. Qwen2.5 · Apache-2.0) and are
**never** committed — they are pinned, signed, verified and downloaded on the desktop at the
user's direction.

---

<div align="center">

**Akansha — one intelligence, many providers, zero competing brains.**

Built on the principle: *NO EVIDENCE = NO SUCCESS.*

</div>
