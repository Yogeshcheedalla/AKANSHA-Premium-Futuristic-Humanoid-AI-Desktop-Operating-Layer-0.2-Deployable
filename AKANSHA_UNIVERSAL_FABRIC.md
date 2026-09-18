# AKANSHA — UNIVERSAL TOOL + RUNTIME + DEVICE FABRIC

**Status of this document: DESCRIPTIVE_ONLY (architecture + roadmap).**
It defines *how* Akansha will grow. Nothing here is claimed as built or working
unless the "Today (verified)" column proves it with committed code/tests. This file
deliberately does **not** import or fake OpenWorker, Browser Use, Chrome DevTools
MCP, OpenHands, Mem0, scrcpy or Appium — those are future adapters, each with an
explicit human-credential / toolchain / device blocker listed.

---

## 1. The one rule that keeps Akansha coherent

Akansha is the **single decision authority**. Specialised open-source projects are
the *hands*, mounted behind the **existing Action Fabric** as adapters. We never add
a second orchestrator, router, memory engine, permission engine or verification
engine. This is the same invariant every previous phase has honoured.

```
                         ┌──────────────────────────┐
   USER / VOICE / UI ───▶│   MasterOrchestrator      │  (decision + planning; ONE)
                         └────────────┬─────────────┘
                                      ▼
                         ┌──────────────────────────┐
                         │        ACTION FABRIC      │  ActionRegistry →
                         │  authorize → execute →     │  ActionDispatcher →
                         │  observe → VERIFY →        │  RiskEngine + PermissionEngine
                         │  recover → event → persist │  + ExecutionLedger + EventBus
                         └────────────┬─────────────┘
        ┌───────────────┬─────────────┼──────────────┬────────────────┐
        ▼               ▼             ▼              ▼                ▼
   MODELS            SKILLS       DESKTOP        BROWSER         DEVICES
 ModelRouter      SkillRegistry  WindowsComputerUseProvider   (adapters)   (device registry)
 llama.cpp/Ollama SkillResolver  = launch/close/focus/…       BrowserUse /  Android ADB /
 OpenRouter/AirLLM DepPlanner    (REAL_VERIFIED: launch,close) Chrome DevTools scrcpy / iOS
                                  MCP servers                  MCP
        │
        ▼
  MEMORY (existing MemorySystem; Mem0 = optional backend adapter only — never a 2nd authority)
```

NO EVIDENCE = NO SUCCESS is enforced inside the fabric: a provider reply, an HTTP
200, or "the call returned" is never success. Only observed, verified evidence yields
`COMPLETED`. (Already proven: `desktop.app.launch`/`close` returned real pids and were
independently confirmed via `Get-Process`.)

---

## 2. Today (verified) vs proposed

| Capability / layer | Namespace | Status | Evidence / blocker |
|---|---|---|---|
| App launch | `desktop.app.launch` | **REAL_VERIFIED** | fabric e2e: pid + `Get-Process` confirmed |
| App close | `desktop.app.close` | **REAL_VERIFIED** | fabric e2e: termination observed |
| Window focus | `desktop.window.focus` | **REAL_BUT_UNVERIFIED** | unit-verified + fabric-routed; live foreground blocked by the foreground-lock in a non-interactive session (needs a visible/desktop session) |
| Command→fabric routing | `mapToDesktopAction` + `IntentEngine` | **REAL_VERIFIED** | integration tests + e2e |
| Durable Postgres (RLS, pgvector, backup/restore) | `db/migrations/0001…`, `scripts/db-provision.ts` | **REAL_VERIFIED (local)** / **production BLOCKED** | 9/9 stages pass on real local DB; prod needs a provisioned managed DB + non-superuser `DATABASE_URL` |
| Browser control | `browser.*` | **PLACEHOLDER (design)** | needs Chromium + Browser Use/CDP install (network/toolchain) |
| MCP connectors | `mcp.*` | **PARTIAL (code, no live servers)** | needs configured MCP servers + secrets |
| Skills registry + installer | `skill.*` | **PLACEHOLDER (design)** | declarative manifest + verified install; not built |
| Device registry | `device.*` | **PLACEHOLDER (design)** | multi-device pairing/heartbeat |
| Android control | `device.android.*` | **PLACEHOLDER (design)** | needs ADB/scrcpy + a real, paired device |
| macOS / Linux / iOS builds | — | **BLOCKED** | can't build/sign on this Windows box (macOS runner + Apple Developer ID/notarization) |
| OpenWorker adapter | `agent.openworker` | **DESCRIPTIVE_ONLY** | study-then-adapter; **never** import its orchestrator |

Statuses use only: REAL_VERIFIED / REAL_BUT_UNVERIFIED / PARTIAL / MOCK / PLACEHOLDER /
DESCRIPTIVE_ONLY / BLOCKED. Nothing is upgraded without evidence.

---

## 3. Permission scopes (capability model, not blanket control)

The fabric's risk gate maps every action to explicit, named scopes. Unrestricted
"control of the laptop/phone" is explicitly NOT a thing:

| Scope | Example actions | Gate |
|---|---|---|
| `browser.read`, `browser.navigate`, `browser.click` | inspect/click a page | ✅ low — auto, still observed+verified |
| `desktop.app.launch`, `desktop.app.close`, `desktop.window.focus` | app/window control | ⚠ confirmation (already enforced via `requiresConfirmation`) |
| `desktop.file.read` | read an allowlisted path | ⚠ confirmation + path allowlist |
| `desktop.file.write`, `desktop.file.delete`, `shell.execute` | mutating/execute | ⚠ approval, never silently permitted; typed-dangerous only |
| `message.send`, `purchase`, `account.security` | external side effects | ⚠→🔴 human approval, per-action, non-reusable |
| `credential.extract`, keylogging, hidden-mic, background surveillance | — | 🔴 **never implemented** |

`shell.execute` is intentionally the weakest form and is NOT reachable through an app
name — the launch/close resolvers reject shell metacharacters outright (`; & | \` $`),
proven in tests. Arbitrary PowerShell/shell is out of scope by design.

---

## 4. Skill & runtime installer — declarative + verified (contract)

A skill is data, not code-with-privileges. The plan is a registry that stores a
manifest and resolves it to a fabric capability only after it is *installed AND
verified*:

```
skill: browser-research
version: 1.0.0
runtime: python            # python | node | binary
dependencies: [browser-use, chromium]
permissions: [browser.read, browser.navigate, browser.click]   # scopes, not blanket
verification: [imports_resolve, launch_test_url, dom_observed]  # health gates
```

Install loop (each step observable, never claimed without evidence):
`detect OS → detect runtimes/package managers → resolve → install isolated →
verify imports → run declared verification → register capability → READY`.
If any gate fails: `BLOCKED`/`CONFIG_REQUIRED` — not a fake `READY`. This mirrors the
Truthful Status engine already in the codebase (`READY` only when registered +
configured + credential + health + test all pass).

---

## 5. Device registry (future)

Each device: `{ deviceId, platform, capabilities[], cpu, ramMb, gpuVramMb, storageGb,
runtimes[], skills[], connectedApps[], permissions[], online, lastHeartbeat }`.
A mission becomes plan → **select device** (camera on phone, big GPU on workstation,
logged-in browser session on the laptop, large model in cloud) → select model →
select skills → execute via the fabric → observe → verify. Cross-device execution reuses
the same fabric contract; the transport (LAN/relay) is a later concern and must not
weaken the per-action approval gates.

---

## 6. Integration stance on the named OSS projects

- **OpenWorker** — mine its *patterns* (approval gates, hard floors, standing vs
  one-time permissions, audit provenance, connector model, job checkpoints) and wrap
  them as a fabric adapter. **Do not** import its agent loop as a co-equal brain.
- **Browser Use** — high-level agentic web actions, behind a `browser.*` adapter,
  scoped to declared permissions, with observed DOM/`page_loaded` verification.
- **Chrome DevTools MCP** — the deterministic inspect/debug layer (DOM, network,
  console, screenshots) as an MCP adapter the fabric calls.
- **OpenHands / Agent Canvas** — reference for workspaces/execution environments only.
- **Mem0** — *optional* persistent-memory backend behind the **existing** MemorySystem;
  never a second memory authority.
- **scrcpy / ADB / Appium** — Android control/device automation behind
  `device.android.*`, gated by explicit device pairing + per-action approval.

Rule: every imported component is a reviewed adapter with declared dependencies and
scopes; none becomes an independent decision-maker. (The curated-skills ecosystem is
explicitly *curated, not security-audited* — hence review-before-enable.)

---

## 7. Phased build order (each slice = one verified vertical, committed, not pushed)

1. **5E desktop expansion** — `desktop.window.focus` (done, REAL_BUT_UNVERIFIED),
   then `desktop.window.list` (read-only, reliably verifiable) and file read/close-styled
   actions with allowlists.
2. **DB production durability** — provision managed Postgres, non-superuser app role,
   `DATABASE_URL` server-side, run `npm run db:provision` against it, flip prod
   persistence BLOCKED → REAL_VERIFIED. (needs human credential)
3. **Browser layer** — install Chromium + Browser Use/CDP, `browser.read` vertical slice.
   (needs network/toolchain; verify then register)
4. **Skill registry + declarative installer** with the manifest above + verification.
5. **MCP adapters** — one MCP server live, health-checked through the fabric. (needs
   configured servers + secrets)
6. **Device registry + Android adapter** — one paired device, ADB/scrcpy vertical slice.
   (needs a real device; Appium for structured testing later)
7. **Model Center as a decision engine** — task→capability→hardware→runtime→route,
   reusing `ModelRouter`/`ResourceGovernor`; AirLLM only once compatibility is verified.
8. **Unified diagnostics + cross-device fabric** — the same action contract from any device.

---

## 8. What I will not fake (standing constraints)

- Platform availability that doesn't exist (Mac/Linux/iOS can't be built here).
- "Installed/connected/ready" without running the real verification for it.
- A second orchestrator/router/memory/voice/permission/verification system.
- Push, deploy, release mutation, or installer replacement without explicit approval.
- Live inference / voice / device / foreground effects that the environment can't
  actually perform — those stay REAL_BUT_UNVERIFIED or BLOCKED, exactly as the focus
  capability is today.
