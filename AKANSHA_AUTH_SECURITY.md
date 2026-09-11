# AKANSHA — Authentication & Authorization (Feature 2)

## Model

Server-side, capability-level security. Identity comes **only** from a verified signed token — never from a client-supplied `userId`. Authentication (“who”) is enforced separately from authorization (“is this allowed”), and sensitive actions additionally pass the RiskEngine.

## Files added

- `src/core/auth/tokens.ts` — HMAC-SHA256 signed stateless session tokens (base64url body + timing-safe signature), expiry, `safeEquals` constant-time compare.
- `src/core/auth/session.ts` — `AuthManager`: local pairing-token bootstrap (env `AKANSHA_ACCESS_TOKEN`/`AKANSHA_ADMIN_TOKEN`, else a strong token generated once and persisted to gitignored `.akansha-auth.json` mode 0600), issue/verify/revoke (in-memory jti revocation set), request authentication (Authorization: Bearer **or** `akansha_session` cookie).
- `src/core/auth/guard.ts` — `authorize(request, level)` returning a verified principal or a 401/403 `NextResponse`. Levels: `public < authenticated < sensitive < admin`.
- `src/app/api/auth/session/route.ts` — POST (exchange passphrase → session + httpOnly cookie), GET (introspect), DELETE (revoke + clear cookie).
- `src/instrumentation.ts` — materializes the pairing token at server startup.

## Route classification (enforced server-side)

| Route | Method | Level |
|---|---|---|
| `/api/health` | GET | public |
| `/api/auth/session` | POST | public (login) |
| `/api/auth/session` | GET/DELETE | authenticated |
| `/api/akansha/command` | POST | authenticated |
| `/api/cognitive` | GET/POST | authenticated |
| `/api/graph` | GET | authenticated |
| `/api/repositories` | GET | authenticated |
| `/api/system/status` | GET | authenticated |
| `/api/providers` | GET | authenticated |
| `/api/providers` | POST | admin |
| `/api/providers/[id]` | PATCH/DELETE | admin |
| `/api/providers/test` | POST | admin |
| `/api/connectors` | GET | authenticated |
| `/api/connectors` | POST/PATCH/DELETE | admin |
| `/api/execute` | POST | sensitive |
| `/api/tests`, `/api/redteam` | GET | admin |

## Authentication flow

1. Desktop app / user reads the local pairing token (`.akansha-auth.json`) or uses a configured env token.
2. `POST /api/auth/session {passphrase}` → server constant-time checks it, issues a signed 12h session token, sets it as an **httpOnly, SameSite=Lax** cookie (Secure in production).
3. Subsequent same-origin requests carry the cookie automatically; `authorize()` verifies signature + expiry + revocation and resolves the principal.
4. `DELETE /api/auth/session` adds the jti to the revocation set and clears the cookie.

## Authorization

Role rank: user=1, admin=2. A `user` session can drive the assistant and read state; provider/connector/MCP/system mutation and the test/redteam suites require `admin`. The `/api/execute` endpoint requires `sensitive` **and** still runs the RiskEngine + PermissionEngine + confirmation gate internally — auth never replaces risk control.

## Security model & audit

- Secrets (passphrases, tokens, API keys) are never logged, never returned by any API, never placed in client bundles. Only opaque jti/role are audited via `eventBus` (`auth.granted/rejected/denied/revoked`).
- `.akansha-auth.json` is gitignored and written with mode 0600.
- A dev bypass exists only via explicit `AKANSHA_AUTH_DISABLED=true` (off by default).
- Constant-time comparisons prevent timing leaks on passphrase/token checks.

## Tests (added)

`src/core/audit2.test.ts`: token round-trip + expiry; tampered token rejected; `safeEquals`; `authorize` returns 401 for unauthenticated sensitive and allows public; valid bearer authorizes authenticated route; a user-role token is rejected (403) on an admin route (authz ≠ authn).

## Actual runtime results (verified this session)

- Unauthenticated `GET /api/providers` → **401**.
- Bootstrap token created at startup (32 chars); `POST /api/auth/session` → session token (179 chars) + cookie set.
- Authenticated `GET /api/providers` → **200**.
- `POST /api/execute` without auth → **401**; with auth + destructive goal → **403 REFUSED**; with auth + safe goal → **200 COMPLETED**.
- Cookie flow (what the UI uses): no cookie → 401; after login, same-origin request with cookie → 200.

## Remaining limitations

- Single-user local trust model (pairing token), not multi-tenant accounts. No password hashing/DB of users because there is no user DB in this desktop architecture.
- Stateless tokens can’t be individually revoked until the jti is seen once (revocation is best-effort in-memory). For long-lived deployments, store sessions server-side.
- No CSRF token on cookie-authenticated POSTs (SameSite=Lax mitigates most cases); add explicit CSRF if exposed beyond localhost.

## UNVERIFIED

- Multi-user / OAuth / refresh-token flows (not implemented — out of scope for a local desktop assistant).
