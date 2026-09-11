<div align="center">

# ◉ AKANSHA

### Premium Futuristic AI Operating Layer

**One intelligence. Many providers. Zero competing brains.**

[![Live App](https://img.shields.io/badge/Launch-Akansha-00f0ff?style=for-the-badge)](/)
[![Landing Page](https://img.shields.io/badge/Download-landing.html-8b5cf6?style=for-the-badge)](/landing.html)

*A multimodal, self-improving desktop AI companion that understands, plans, executes,
**verifies with evidence**, learns, and remembers.*

</div>

---

## ⚡ Quick Start

```bash
git clone <your-repo> akansha && cd akansha
npm install
npm run build
npm run start
```

Open **http://localhost:3000** — then **http://localhost:3000/landing.html** to install Akansha
as an app on Windows, macOS, Linux, Android or iOS.

---

## 📦 Install On Any Device

Single-click downloads are served from [`/landing.html`](/landing.html).

| Platform | File | How to run |
|---|---|---|
| **Windows** | `Akansha-Setup-Windows.ps1` | Right-click → *Run with PowerShell* |
| **Windows** | `Akansha-Windows-Launcher.bat` | Double-click |
| **macOS** | `Akansha-macOS-Launcher.command` | Double-click |
| **Linux** | `Akansha-Linux-Launcher.sh` | `chmod +x` then `./Akansha-Linux-Launcher.sh` |
| **Android / iOS** | PWA | Tap **Install Akansha** on the landing page |

The launchers install dependencies, build the production bundle, create a desktop
shortcut (Windows), and start the Akansha runtime.

### Building Genuine Native Binaries

True signed `.exe` / `.dmg` / `.apk` artefacts need native toolchains. Configs are included
so it's one command each:

```bash
# Windows .exe (NSIS installer) + portable
npx electron-builder --win nsis portable

# macOS .dmg (notarised)
npx electron-builder --mac dmg

# Android .apk
npx cap add android && npx cap sync && cd android && ./gradlew assembleDebug
```

`electron-builder.yml` and `capacitor.config.json` are already in the repo.

---

## 🧠 What Akansha Does

| You say | Akansha does | Cost |
|---|---|---|
| `"Hello Akansha"` | Conversation path — no agent, no tool | **0** model calls |
| `"What time is it in India?"` | Local clock capability | **~14 ms, 0 tokens** |
| `"What is 25 × 8?"` | Deterministic calculator | **~14 ms, 0 tokens** |
| `"Explain Kubernetes simply"` | Routed to the best-fit model | 1 model call |
| `"Open Notepad and write Hello"` | Windows action → observe → verify | Model + real verification |
| `"Build this feature in parallel"` | Orca worktrees, parallel agents, evaluation | Tier-4 budget |
| `"Research this and write a report"` | Research agent → web → synthesis → file | Tier-3 budget |

**Intelligence proportional to the task.** Akansha never launches six agents to answer a greeting.

---

## 🏗 Architecture

```
                    ╔══════════════════════════════════════╗
                    ║      AKANSHA MASTER ORCHESTRATOR     ║
                    ║        SINGLE TOP-LEVEL BRAIN        ║
                    ╚═══════════════════╤══════════════════╝
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              ▼                         ▼                         ▼
      ┌──────────────┐         ┌──────────────┐         ┌──────────────┐
      │  CONTEXT     │         │  INTENT      │         │  MEMORY      │
      │  ENGINE      ────▶     │  ENGINE      ────▶     │  INTELLIGENCE│
      └──────────────┘         └──────────────┘         └──────────────┘
                                                                 │
        ┌────────────────────────────────────────────────────────┘
        ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│  CAPABILITY     │   │  SKILL          │   │  MCP            │
│  GRAPH (68)     │◀─▶│  REGISTRY (66)  │◀─▶│  MESH (8 nodes) │
└────────┬────────┘   └────────┬────────┘   └────────┬────────┘
         │                     │                     │
         └─────────────────────┼─────────────────────┘
                               ▼
         ╔═════════════════════════════════════════════╗
         ║        INTELLIGENT ROUTER (3-way)           ║
         ╠═════════════════════════════════════════════╣
         ║  MODEL ROUTER  │  AGENT ROUTER │  TOOL ROUTER║
         ╚═══════╤═════════════╤═══════════════╤═══════╝
                 │               │               │
    ┌────────────┴───┐   ┌───────┴──────┐  ┌────┴───────────┐
    │ ▼ MODEL LAYER  │   │ ▼ AGENTS     │  │ ▼ TOOLS/MCP   │
    │                │   │              │  │                │
    │  Ollama        │   │  Orca        │  │  Page Agent    │
    │  llama.cpp     │   │  OpenHands   │  │  Browser Use   │
    │  Gemini        │   │  UI-TARS     │  │  Windows MCP   │
    │  OpenAI        │   │  Vision Agt  │  │  Files MCP     │
    │  Custom URL    │   │  Research    │  │  GitHub MCP    │
    │  Local Server  │   │  Terminal    │  │  Device MCP    │
    └────────┬───────┘   └───────┬──────┘  └────┬───────────┘
             │                   │              │
             └───────────────────┼──────────────┘
                                 ▼
                   ┌──────────────────────────┐
                   │     EXECUTION FABRIC     │
                   └────────────┬─────────────┘
                                ▼
                   ┌──────────────────────────┐
                   │       OBSERVATION        │
                   └────────────┬─────────────┘
                                ▼
                   ┌──────────────────────────┐
                   │      VERIFICATION        │
                   │   NO EVIDENCE = NO SUCCESS│
                   └────────────┬─────────────┘
                     PASS ──────┴────── FAIL
                      │                  │
                      │           ┌──────▼──────┐
                      │           │  DIAGNOSE   │
                      │           └──────┬──────┘
                      │           ┌──────▼──────┐
                      │           │  RECOVER    │
                      │           └──────┬──────┘
                      │           ┌──────▼──────┐
                      │           │  REPLAN     │
                      │           └──────┬──────┘
                      │           ┌──────▼──────┐
                      │           │  REVERIFY   │
                      │           └──────┬──────┘
                      └───────────────────┘
                                ▼
                   ┌──────────────────────────┐
                   │       EVALUATOR          │
                   └────────────┬─────────────┘
                                ▼
                   ┌──────────────────────────┐
                   │      LEARNING ENGINE     │
                   └────────────┬─────────────┘
                                ▼
                   ┌──────────────────────────┐
                   │    MEMORY UPDATE         │
                   └────────────┬─────────────┘
                                ▼
                   ┌──────────────────────────┐
                   │  CAPABILITY SCORE UPDATE │
                   └────────────┬─────────────┘
                                ▼
                ┌───────────────────────────────┐
                │  RESPONSE → AVATAR → VOICE    │
                │  (one speech stream, one ID)  │
                └───────────────────────────────┘
```

### The Closed Loop

```
        ╭──────────► UNDERSTAND ◄──────────╮
        │                                  │
   REMEMBER                              PLAN
        ▲                                  │
        │                                  ▼
       LEARN  ◄──── VERIFY ◄──── ACT ◄────┘
                         │
                         ▼
                  (on failure)
                DIAGNOSE → RECOVER → REPLAN → REVERIFY
```

---

## 🎚 Five Intelligence Tiers

| Tier | Trigger | Agents | Token budget | Latency |
|---|---|---|---|---|
| **0** | Time, date, arithmetic | 0 | **0** | ~14 ms |
| **1** | Greetings, small talk | 0 | 0 | < 20 ms |
| **2** | Questions, explanations | 0 | 8,000 | seconds |
| **3** | Commands, research | 2 | 40,000 | minutes |
| **4** | Coding, parallel missions | 6 | 200,000 | long-running |

Enforced by `ResourceGovernor` — a trivial request can never spawn twenty agents.

---

## 🗂 Repository Fabric — 31 Repositories, 12 Layers

| Layer | Repos | Status |
|---|---|---|
| **Model Intelligence** (7) | Ollama ✅ · llama.cpp · Gemini · OpenAI · Odysseus · Heretic · OmniRoute | 1 integrated |
| **Memory** (4) | Mem0 · Letta · TencentDB · LifeOS | 2 adapter-ready |
| **Orchestration** (4) | LangGraph · Brigade · DeepSeek Harness · Paperclip | 1 adapter-ready |
| **Browser** (2) | **Page Agent ✅** · Browser Use | 1 integrated |
| **Computer Use** (3) | UI-TARS · UI-TARS Desktop · Open Interpreter | 3 adapter-ready |
| **Coding** (2) | **Orca ✅** · OpenHands | 1 integrated |
| **Avatar & Voice** (2) | **Open-LLM-VTuber ✅** · Qwen Audio Agent | 1 integrated |
| **MCP Fabric** (1) | awesome-mcp-servers (gated catalogue) | catalog only |
| **Workspace** (1) | Puter | adapter-ready |
| **Desktop Shell** (1) | Berd | reference |
| **Evaluation** (1) | OSWorld | CI benchmark only |
| **Reference** (3) | awesome-llm-apps · OpenAgent · Incredible AI Agents | reference |

> ❌ **Rejected:** `jundot/omlx` — Apple Silicon / macOS only; unsuitable as a Windows
> production runtime. Ollama and llama.cpp cover local inference on Windows.

**No repository is the brain.** LangGraph, Letta, Brigade and Paperclip are
`ARCHITECTURAL`/`REFERENCE` only — their patterns already live in Akansha's orchestrator,
supervisor and checkpoint system. Adding them at runtime would create competing orchestrators.

---

## 🪜 Browser Escalation Ladder

Akansha never retries a failing strategy forever — it classifies the cause and climbs.

```
L1  DOM / Page Agent        forms, buttons, text fields, accessible flows
L2  Accessibility Tree      shadow DOM, ARIA, cross-frame content
L3  Browser Automation      Browser Use — multi-page, extension-only surfaces
L4  Playwright / Puppeteer  full automation engine
L5  Vision / Screenshot     UI-TARS — canvas, visual-only controls
L6  Computer Use            UI-TARS Desktop — OS dialogs, native apps
L7  Windows UI Automation   Win32 / UIA element control
L8  User Confirmation       CAPTCHA, auth challenges, irreversible actions
```

Each successful strategy is recorded, so future routing is **experience-driven**.

---

## 🔐 Security Model

**Credential Vault** — AES-256-GCM envelope. Secrets are referenced by opaque `credentialRef`.
Never in the frontend bundle, never in logs, never in events, never in traces, never in
mission history, never in an LLM prompt.

```
User enters API key
       │
       ▼
  CredentialVault.put()  ────►  returns "cred_a3f8c2e91b4d"
       │
       ▼
  DB stores credentialRef ONLY (never the key)
       │
       ▼
  ProviderManager resolves on demand, server-side only
       │
       ▼
  UI / logs / traces see: "credential set" (boolean)
```

**Risk-classified actions** — every skill carries a risk level derived from its permissions.
`EXECUTE_COMMANDS` or `INPUT_CONTROL` → `high` → confirmation required.

**Sandbox gates** — 10 repositories are flagged sandbox-required or high-privilege.
`open-interpreter`, `ui-tars-desktop`, `heretic`, `brigade`, `openhands`, `orca` can never
run unsandboxed.

**Idempotency** — `requestId` keyed execution ledger. Duplicates from HTTP, WebSocket or
repeated ASR finals replay the stored result instead of executing twice.

**ASR boundary** — partial transcripts update the UI only. Only finalised utterances
enter the execution pipeline.

---

## 🧩 Project Structure

```
akansha/
├── public/
│   ├── landing.html              ← animated download page
│   ├── manifest.json             ← PWA manifest
│   ├── sw.js                     ← service worker (offline shell)
│   ├── icon.svg / icon-maskable.svg
│   └── downloads/
│       ├── Akansha-Setup-Windows.ps1
│       ├── Akansha-Windows-Launcher.bat
│       ├── Akansha-macOS-Launcher.command
│       └── Akansha-Linux-Launcher.sh
│
├── src/
│   ├── core/                     ← THE BRAIN
│   │   ├── orchestration/        MasterOrchestrator
│   │   ├── intent/               IntentEngine
│   │   ├── capabilities/         CapabilityGraph
│   │   ├── skills/               SkillRegistry
│   │   ├── models/               ModelRouter · ModelRegistry · ModelProvider
│   │   ├── providers/            ProviderManager (DB-backed)
│   │   ├── agents/               AgentManager · AgentSupervisor
│   │   ├── memory/               MemoryIntelligence (scored)
│   │   ├── learning/             LearningEngine (cross-mission)
│   │   ├── verification/         VerificationEngine
│   │   ├── evaluator/            Evaluator
│   │   ├── mcp/                  MCPManager · MCPMesh
│   │   ├── connectors/           ConnectorManager
│   │   ├── repositories/         RepositoryRegistry (31 repos)
│   │   ├── files/                FileIntelligence
│   │   ├── resources/            ResourceGovernor
│   │   ├── security/             CredentialVault
│   │   ├── events/               EventBus
│   │   └── runtime/              ExecutionLedger
│   │
│   ├── integrations/             ← ADAPTERS ONLY (never brains)
│   │   ├── models/               ProviderFactory · CapabilityInference
│   │   ├── open-llm-vtuber/      AvatarEngine · OpenLLMVTuberAdapter
│   │   ├── page-agent/           PageAgentAdapter · BrowserEscalation
│   │   ├── orca/                 OrcaAdapter (worktrees)
│   │   ├── registry/             IntegrationMatrix
│   │   └── IntegrationManager
│   │
│   ├── ui/                       ← CINEMATIC SPATIAL UI
│   │   ├── design/               tokens.ts
│   │   ├── core/                 GlassSurface · NeuralBackground
│   │   ├── assistant/            AkanshaPresence · OrganicWaveform
│   │   ├── navigation/           FloatingDock
│   │   └── workspaces/           Command · Missions · Graph · Agents
│   │                             Integrations · Providers · Connectors
│   │                             Repositories · Memory · Settings
│   │
│   ├── app/
│   │   ├── page.tsx
│   │   └── api/
│   │       ├── akansha/command   ← THE single request pipeline
│   │       ├── providers/[id]    · providers/test
│   │       ├── connectors
│   │       ├── repositories
│   │       ├── graph
│   │       └── health
│   │
│   └── db/
│       ├── schema.ts             22 tables
│       └── index.ts
│
├── electron-builder.yml          ← Windows .exe / macOS .dmg
├── capacitor.config.json         ← Android .apk / iOS
├── README.md
└── .gitignore
```

---

## 🌐 API

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/akansha/command` | `POST` | The single request pipeline |
| `/api/providers` | `GET` `POST` | List / add AI providers |
| `/api/providers/[id]` | `PATCH` `DELETE` | Update / remove a provider |
| `/api/providers/test` | `POST` | Real health check + model discovery |
| `/api/connectors` | `GET` `POST` `PATCH` `DELETE` | Connector lifecycle |
| `/api/repositories` | `GET` | Registry, pipeline, escalation, security gates |
| `/api/graph` | `GET` | Live capability topology + decision traces |
| `/api/system/status` | `GET` | Integration health summary |
| `/api/health` | `GET` | Liveness probe |

---

## ⚙️ Environment

```env
# OPTIONAL — the app boots and answers WITHOUT a database (persistence then
# degrades gracefully: providers come from env, memory/ledger/traces are skipped).
# To enable durable storage: `docker compose up -d db` then `npm run db:push`.
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/akansha

# Optional — any of these auto-seed as providers on first boot
EXPLABS_API_KEY=
EXPLABS_BASE_URL=https://api.experientiallabs.ai/v1
OPENAI_API_KEY=
GEMINI_API_KEY=
OLLAMA_BASE_URL=http://127.0.0.1:11434

# Vault encryption secret (falls back to DATABASE_URL in dev)
AKANSHA_SECRET=
```

**No provider configured?** Akansha still boots, still runs Tier-0 deterministic
capabilities, and reports `AI_PROVIDER_OFFLINE` honestly instead of pretending.

**No execution backend connected?** Action intents (open/close/run, browser and
file tasks) are reported honestly as *not executed* (`CAPABILITY_NOT_CONNECTED`)
until a Computer Use / Browser / MCP backend is wired in — Akansha never claims a
Windows/browser action completed without real evidence.

---

## 🧪 Verified Behaviour

| Test | Result |
|---|---|
| Provider model discovery | ✅ 3 models from OpenAI-compatible endpoint |
| Unreachable provider | ✅ `UNAVAILABLE / "unreachable"` — no fake success |
| Model routing | ✅ `qwen3-reasoner` preferred over `qwen3-fast` for reasoning |
| Idempotency | ✅ Same `requestId` twice → one execution, one `missionId` |
| Memory scoring | ✅ Generic query scored 45 → `decay` → **not** persisted |
| Tier-0 time | ✅ ~14 ms, zero model calls |
| Tier-0 arithmetic | ✅ `25 * 8 → 200`, zero model calls |
| Tier-1 greeting | ✅ Conversation path, zero agents, zero tools |
| Connector secret | ✅ `credentialConfigured: true` returned, key never exposed |
| Registry sync | ✅ 61 capabilities + 61 skills pushed to live graph |

---

## 🚧 Current Limitations

1. **13 `ADAPTER_READY` repos** need their runtime binaries/services. Adapter boundaries,
   permissions, fallbacks and risk levels are already enforced — activation is
   configuration, not refactoring.
2. **`llama.cpp` needs zero code changes** — point the Local Server provider at
   `llama-server`'s port.
3. **Native `.exe` / `.apk` / `.dmg`** require Electron/Android SDK/Xcode toolchains.
   Configs included; launchers work today.
4. **Memory retrieval is keyword-overlap**, not vector embeddings.
5. **`streamWithFallback`** does not yet emit SSE to the browser.
6. **Gemini streaming** falls back to non-streaming (different SSE shape).
7. **OSWorld** is macOS/Linux only — CI benchmark, never a Windows runtime component.

---

## 📜 Core Principles

```
Think only as much as necessary.
Use the smallest capable model.
Use the cheapest reliable capability.
Escalate when necessary.
Verify every action.
Remember only what matters.
Learn from successful procedures.
Never claim success without evidence.
```

---

<div align="center">

**AKANSHA** · Premium Futuristic AI Operating Layer

*One orchestrator. Many providers. Zero competing brains.*

</div>
