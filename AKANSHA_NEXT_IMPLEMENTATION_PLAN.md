# AKANSHA — Next Implementation Plan (from verified findings only)

Every item here traces to a concrete finding in `AKANSHA_FEATURE_REALITY_MATRIX.md`. Priorities: **P0 blocks the core product**, P1 major capability, P2 important enhancement, P3 polish.

## Per-subsystem decision (KEEP / FIX / COMPLETE / REPLACE / REMOVE)

| Subsystem | Decision | Why |
|---|---|---|
| Electron desktop + installer | **KEEP** | Verified working end-to-end |
| Master Orchestrator / risk / idempotency / auth / vault | **KEEP** | Verified working |
| Windows launch+observe+verify | **KEEP** | Verified (real window, verified=true) |
| Windows **type+verify** | **FIX** | Type executes but UIA text read-back returns empty → honest FAILED |
| Browser automation | **COMPLETE (build)** | Missing; Chrome/search unhandled |
| PageAgentAdapter | **REPLACE or REMOVE** | `execute()` is a mock (`verified=true`); unreachable |
| MCP | **COMPLETE (build client)** | Registry only; no real connect/discover/invoke |
| Connectors | **COMPLETE** | Catalogue only; `resolveCredential` returns null; no OAuth/API |
| Memory | **FIX + COMPLETE** | No user-facing remember/recall; persistence needs DB; 3 duplicate impls |
| Conversation (follow-up/correction/cancel) | **COMPLETE** | No cancellation, no multi-turn context |
| Voice | **KEEP code + VERIFY on device** | Real browser APIs; hardware unverified |
| Acoustic barge-in | **COMPLETE** | Only keystroke barge-in exists |
| Ambient/proactive | **COMPLETE (add sources)** | Engine only; no live event sources |
| Self-improvement loop | **COMPLETE** | Recording/classify exist; replay→promote→rollback not wired |
| Vision | **COMPLETE** | Registered capability only |

## Ordered backlog

### P0 — Core product blockers
1. **Fix Windows type+verify read-back.** The `Read-EditText` UIA path returns empty for Notepad/charmap. Use `TextPattern` (document range) or `ValuePattern` correctly, and match the right Edit control; add a bounded re-observe. Acceptance: “open Notepad and write Hello Akansha” reaches `COMPLETED` **only** after the typed text is actually observed in the window. Until then it must stay `FAILED` (as it correctly is now).
2. **Make model generation demonstrably work.** Add a funded provider (or local Ollama) and confirm `usedModel:true` with a real answer through the packaged app. (Code path already verified with a healthy provider; the environment key is out of credits.)

### P1 — Major capabilities
3. **Memory intent + recall.** Add `remember`/`recall` intents; route “remember X” to a memory write and “what did I say earlier?” to retrieval that is actually surfaced in the answer. Ship DB migrations and verify persistence across restart.
4. **Conversation control.** Add cancellation (“never mind”, “stop”) and multi-turn context; ensure a pending operation is aborted.
5. **Browser automation (real).** Replace the `PageAgentAdapter` mock with a real backend (Playwright or a browser MCP) with observe→verify, or remove it so nothing pretends to work.
6. **Real MCP client.** Implement connect → discover tools → invoke → verify, replacing the registry-only stubs; do not mark nodes AVAILABLE without a live server.
7. **Voice on-device verification + acoustic barge-in.** Test mic/ASR/TTS on a real device; implement VAD-during-playback barge-in; add a pluggable ASR/TTS provider (local Whisper / cloud).

### P2 — Important enhancements
8. **Connectors that actually work.** Implement OAuth/PKCE + API clients + real `resolveCredential`; enforce per-capability authorization.
9. **Self-improvement loop.** Wire test→replay→evaluate→promote→rollback with canary gating (skill versioning already has gates).
10. **Ambient event sources.** Windows notifications/calendar/downloads collectors feeding the existing policy engine (privacy-preserving, local-first).
11. **Auth hardening.** CSRF on cookie routes, rate limiting, persistent token revocation.
12. **Consolidate memory** to one authoritative store; retire the duplicate implementations.

### P3 — Polish
13. Vision pipeline (screen analysis) behind the model router.
14. LRU cap on the execution-ledger cache; persistent Electron worker to avoid per-action PowerShell spawn latency.
15. Code-signing certificate for the installer (removes SmartScreen warning).
16. Optional model-backed greeting instead of the fixed string.

## Explicitly NOT to do (avoid duplicate/fake systems)
- Do not add a second orchestrator, event bus, voice manager, or API client.
- Do not re-add fake ambient/user-state telemetry (already removed).
- Do not ship any download/link that points to a nonexistent artifact.
- Do not mark any action `COMPLETED` without observed verification (NO EVIDENCE = NO SUCCESS).

## Suggested first concrete step
Fix **#1 (type+verify read-back)** first — it is the one place where a core advertised capability (“write text and verify it”) currently does not complete, and it is a small, targeted change in `WindowsComputerUseProvider.Read-EditText` / `ExecutionVerifier`, testable immediately on this Windows machine.
