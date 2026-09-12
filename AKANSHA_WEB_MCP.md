# AKANSHA — Web + MCP Integration (Checkpoint 3)

Real web + MCP capability integrated into the existing Master Orchestrator. No second orchestrator, no duplicate frameworks, no fake success. Every claim below has runtime evidence from this session.

## Architecture (Web Capability Mesh, under the Master Orchestrator)

```
USER → INTENT → MASTER ORCHESTRATOR → (research intent)
        ↓
   WEB CAPABILITY
   ├── WebSearchProvider  (DuckDuckGo Instant Answer + Wikipedia; key-free)
   ├── WebReaderProvider  (HTTP fetch + title/text/headings/links extraction)
   └── BrowserCapabilityAdapter (reuses Windows computer-use; launch+navigate)
        ↓
   SEARCH → RETRIEVE SOURCES → (optional model synthesis) → CITED ANSWER
        ↓
   OBSERVATION → VERIFICATION (≥1 source actually retrieved) → RESPONSE → MEMORY

MCP (separate capability boundary):
   Master Orchestrator / Tool Router → MCPRegistry (trust+permission gate)
        → MCPClientManager (official SDK) → MCP server (stdio | Streamable HTTP)
        → tool call → result → verification
```

## Files created
- `src/core/web/types.ts` — SearchResult, WebDocument, provider interfaces, ResearchResult.
- `src/core/web/DuckDuckGoSearchProvider.ts` — key-free search (DDG Instant Answer JSON API).
- `src/core/web/WikipediaSearchProvider.ts` — key-free search (Wikipedia search API).
- `src/core/web/HttpWebReaderProvider.ts` — dependency-free fetch + HTML extraction.
- `src/core/web/WebCapability.ts` — facade: search (multi-provider merge/dedupe), read, research (search→retrieve→cited answer).
- `src/core/web/BrowserCapabilityAdapter.ts` — browser tier reusing the computer-use provider (launch + address-bar navigate).
- `src/core/mcp/MCPRegistry.ts` — server registry + security gate (DISCOVERED→SCANNING→APPROVED/BLOCKED; trust + permission review).
- `src/core/mcp/MCPClientManager.ts` — real MCP client (official SDK): connect/disconnect, discover tools/resources/prompts, call tools, pooling, timeouts.
- `scripts/test-mcp-server.mjs` — harmless local stdio MCP server (echo, add) for round-trip verification.
- `src/app/api/mcp/route.ts` — GET list (authenticated), POST connect (admin).
- `src/app/api/mcp/call/route.ts` — POST call (sensitive + risk gate).
- `src/core/audit3.test.ts` — MCP security-gate + real round-trip + web research tests.

## Files changed
- `next.config.ts` — `serverExternalPackages` += `@modelcontextprotocol/sdk` (runtime external, like `pg`).
- `src/core/orchestration/MasterOrchestrator.ts` — research intent now runs real web research (search→retrieve→optional model synthesis→cited answer); COMPLETED only if ≥1 source retrieved.
- `src/app/api/akansha/command/route.ts` — response now includes `sources`.
- `package.json` — added `@modelcontextprotocol/sdk`.

## Reused (not duplicated)
Master Orchestrator, Tool/Permission/Risk engines, CredentialVault, ExecutionLedger (idempotency), EventBus, WindowsComputerUseProvider (browser tier), auth guards. No new orchestrator/event bus/voice manager.

## Security model
- **Least privilege / capability boundary:** MCP servers are treated as privileged software. Unknown `trustLevel` → BLOCKED. Privileged permissions (`EXECUTION/FILESYSTEM/FINANCIAL/SENSITIVE_DATA/ACCOUNT/DELETE/MESSAGE`) without `sandboxed:true` → BLOCKED. The client refuses to connect unless state is APPROVED.
- **AuthN vs AuthZ:** `/api/mcp` POST (install/connect) = **admin**; `/api/mcp/call` = **sensitive**; GET list = authenticated. A user-role session is rejected (403) on the admin route — verified.
- **Risk gate on calls:** each tool call passes RiskEngine (DENY → 403).
- **Idempotency:** tool calls keyed by requestId via ExecutionLedger.
- **External content is not trusted memory:** retrieved web content is used as source material for the answer; it is not written as authoritative system memory.

## Verification strategy (NO EVIDENCE = NO SUCCESS)
- Research is `COMPLETED` only when at least one source page was actually fetched and content extracted; otherwise `FAILED` with an honest message.
- A model answer is grounded in retrieved source text (synthesis prompt forbids fabrication); if no model, the extractive, source-attributed answer is returned.
- MCP tool call returns the raw result as evidence; the caller verifies.

## Actual runtime results (this session)
- `webCapability.search('Kubernetes')` → real results (Wikipedia, DDG).
- `webCapability.research('what is Kubernetes')` → **verified=true**, 2 real sources retrieved (Wikipedia 4000 chars).
- `POST /api/akansha/command "search the web for the latest AI developments"` → **COMPLETED**, 3 real sources retrieved + cited (usedModel=false because the configured key is out of credits).
- MCP over HTTP (admin session): connect → **CONNECTED**, tools `["echo","add"]`; call `add(20,22)` → **"42"**, verified=true; GET /api/mcp → `itest:CONNECTED:2tools`.
- MCP security: unknown server → **403 BLOCKED**; user session on admin route → **403 forbidden**.
- `npm test` → **39/39** (incl. real MCP SDK round-trip + web research); `tsc` 0; `next build` 0; new-file lint 0; `git diff --check` 0.

## Status
- MCP client: **VERIFIED** (real SDK, stdio round-trip).
- MCP server support: **VERIFIED** for stdio; Streamable HTTP implemented but not exercised against a live remote server here → **UNVERIFIED (HTTP transport)**.
- Web search: **VERIFIED** (key-free providers). News-grade recency needs a Brave/Tavily key → **UNVERIFIED (no key)**.
- Web reader: **VERIFIED**.
- Browser: **PARTIAL** — launch + navigate real (coarse, via computer-use); DOM element click/type/verify NOT implemented.
- Authentication: **VERIFIED**. Authorization: **VERIFIED** (role gates enforced).
- Tool routing: **VERIFIED** (registry → gate → client → call → verify).
- Observation/Verification: **VERIFIED** for web research + MCP result; NO EVIDENCE=NO SUCCESS holds.
- Recovery: bounded timeouts on tool calls; full MCP failure taxonomy partially mapped (timeout/tool-not-found/not-connected) — **PARTIAL**.
- Security: **VERIFIED** (trust/permission gate, authz, risk gate, idempotency).

## Remaining limitations / next
- Browser DOM automation (Playwright or a real DOM engine) to replace the `PageAgentAdapter` mock and enable verified click/type/verify on pages.
- News/recency search provider (Brave/Tavily) behind the same interface when a key is configured.
- Streamable-HTTP MCP transport verified against a real remote server.
- MCP tool results should feed the same decision-trace + memory pipeline as execution (currently returned to the caller).
- Self-generated MCP/adapter pipeline: interfaces + lifecycle exist conceptually; autonomous generation intentionally NOT implemented.
