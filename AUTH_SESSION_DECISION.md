# Akansha — Canonical Authentication & Session Architecture (Phase 1B)

Design-first. Builds on `MULTI_PLATFORM_AUDIT.md` / `MULTI_PLATFORM_ROADMAP.md` (unchanged). **No production credentials configured or requested; no Vercel/publish changes.** Labels: VERIFIED / BUILT — NOT VERIFIED / NOT BUILT / NOT CONFIGURED — HUMAN ACTION.

## PHASE A — Current auth (read, not assumed)

One engine already exists and is coherent:

- **Google OAuth (server-side):** `googleOAuth.ts` — Authorization Code + **PKCE (S256)**, `state`+`nonce`+`verifier` sealed in a **short-lived (10 min), AES-256-GCM-encrypted, HttpOnly `tx` cookie** scoped `Path=/api/auth/google`, cleared on callback (single-use). Server-only `GOOGLE_CLIENT_SECRET` exchange. `/api/auth/google` returns honest **501 `configured:false`** when unconfigured (never a broken redirect).
- **Callback (`/api/auth/google/callback`):** validates state, exchanges code, verifies identity, **creates/updates the account keyed by Google `sub`** (`Account.ts`), mints a session, **fixed `/app` redirect** (open-redirect safe), clears the tx cookie. Best-effort welcome email that can't block login.
- **Session:** `session.ts` `AuthManager` + `tokens.ts` — **stateless HMAC-SHA256** token (`base64url(body).sig`, constant-time verify, `exp` enforced). Principal = `{sub, role, provider?, email?, name?, avatar?, iat, exp, jti}` — **no secrets**. `issueIdentity/issue/issueGuest`; `revoke(jti)` (in-memory set); `authenticate(req)` reads `Bearer` header **or** `akansha_session` cookie.
- **Cookie:** `HttpOnly; SameSite=Lax; Path=/; Max-Age=12h; Secure(prod)`.
- **Authorization:** `guard.ts` `authorize(req, level)` — role rank `guest=1 user=1 admin=2`; guest **cannot** reach `sensitive`/`admin`; 401/403; identity only from the verified token.
- **Mandatory gate:** `appAccess.ts` `decideAppAccess` — `/app` needs a real `user` session; else Google sign-in or honest NOT_CONFIGURED.
- **Tests already green:** googleOAuth PKCE/state/tx seal, callback (success/state-mismatch/open-redirect/no-secret-leak), guest RBAC, googleSub identity, token expiry/tamper/logout.

## PHASE B — Session strategy comparison → recommendation

| Dimension | **Option 1 — Hosted-origin cookie session** | Option 2 — Bearer-token session (native/offline) |
|---|---|---|
| Reuses existing engine as-is | **Yes** (already is) | Needs new token issuance/exchange endpoint |
| Web / Electron | ✓ (current) | works but adds complexity |
| Android/iOS via **Capacitor WebView on the hosted origin** | **✓ unchanged** — WebView origin = host, cookies flow | only needed for a *bundled/offline* client |
| CSRF | SameSite=Lax blocks cross-site XHR/POST cookie; OAuth `state`+PKCE | no cookie → no CSRF, but needs token transport security |
| XSS/token theft | HttpOnly cookie (not JS-readable); risk = session-riding from same-origin XSS | access token in app storage (Keychain/Keystore); theft if store leaked; refresh/rot/revocable |
| Refresh / revoke | 12h stateless; **in-memory revoke is not durable across isolates** (limitation) | natural place for durable, per-device revocation + refresh |
| Multiple devices | each login = own cookie/token+jti | first-class device records |
| Deep links / callbacks | none (in-app browser to host) | one-time-code return via Android intent / iOS universal link |
| Offline | none (needs network) | token usable offline for cached reads |
| Complexity | **lowest** | higher (new endpoints + native flows + storage) |

**RECOMMENDED: Option 1 as the single canonical architecture now** — Web, all three Electron shells, and **Android/iOS as a Capacitor WebView pointed at the hosted production origin** all share the one `AuthManager` cookie session. This is the smallest design that preserves the brain and adds no second auth engine.

**Option 2 is retained as a *future* extension of the same engine** (a short-lived Bearer access + rotating refresh + **durable per-device session store**) and becomes required **only if** we ship a fully-offline / bundled-mobile client. It must not fork identity: it issues the *same* `Principal` from `AuthManager`.

## PHASE C — Device-session model (design; NOT BUILT — needs persistence)

Today sessions are stateless; the only revocation is an **in-memory, per-process** jti set — insufficient for durable multi-device logout on Vercel (multi-instance) or across restarts.

Target table (Postgres, RLS by user), to be added **with the DB milestone**, not now:

```
device_sessions(
  id uuid pk,               -- stable internal session id (== token jti)
  user_id text,             -- google sub  (RLS key)
  device_id text,           -- per-install id from the client
  platform enum             -- windows|macos|linux|android|ios|web
  created_at, last_used_at, expires_at,
  revoked_at nullable,
  token_family text         -- for rotating refresh (Option 2)
)
```
Rules: never persist the raw token/secret (only a hash of jti/family); revocation = set `revoked_at`; `authenticate()` consults this store (with an in-memory hot cache) instead of only the process-local set. **Status: NOT BUILT — depends on production PostgreSQL (HUMAN ACTION).**

## PHASE D — Mobile auth flow (design, safe default)

**Default (Option 1):** Android/iOS open the hosted app in a Capacitor `CapWebView`/InAppBrowser at `https://akansha-gamma.vercel.app`; the existing cookie session works inside the WebView. Google sign-in uses the existing web flow. No native secret, no new endpoint. Limitation: no offline; session lives in the WebView store.

**When Option 2 is required (offline/native):**
```
App → open secure system browser → /api/auth/google (PKCE, state)
   → Google → /api/auth/google/callback (server)
   → mint ONE-TIME, short-lived code bound to device_id+platform (not the session token)
   → redirect via custom scheme (androidApp://...) / iOS Universal Link
   → App exchanges code → POST /api/auth/mobile/exchange → Bearer access + rotating refresh
```
Documented controls: PKCE + `state` still server-side; deep-link return carries only the **one-time code**; token stored in Keychain/Keystore; refresh rotation + reuse-detection revokes the token family. **Status: NOT BUILT.**

## PHASE E — Security review (findings)

Checked: OAuth state fixation, PKCE, CSRF, token/URL leakage, localStorage/renderer secrets, API-key/Google-secret exposure, insecure/open redirects, cookie flags, rotation, revocation, replay.

- ✅ PKCE S256 + server-side secret; ✅ `state` bound to encrypted single-use tx cookie; ✅ fixed `/app` (no open redirect) — tested; ✅ HttpOnly/Secure/SameSite=Lax cookie; ✅ no client secrets, `sub` (not email) is identity — tested; ✅ expired/tampered token rejected + per-jti logout — tested; ✅ replay of the same code fails (Google one-time code + cleared tx cookie).
- ⚠️ **Confirmed limitation 1 (not a rewrite blocker):** durable revocation/multi-device is **not** implemented (in-memory, per-process, unbounded set). → fixed by Phase C (needs DB). **NOT CONFIGURED — HUMAN ACTION (provision Postgres).**
- ⚠️ **Confirmed footgun (recommended 1-line hardening, NOT yet applied):** `authEnabled()` disables auth whenever `AKANSHA_AUTH_DISABLED==='true'` **regardless of environment**; if that flag ever reaches production, `authorize()` mints an admin principal. Proposed minimal fix: also require `process.env.NODE_ENV !== 'production'` for the bypass. Left unapplied pending approval (design phase; avoids unrelated change).
- ✅ No CSRF token needed given SameSite=Lax + state; revisit if Option 2 is chosen.

## PHASE F — Implementation decision

For the **recommended Option 1**, the canonical architecture **already exists and is correct** — no auth rewrite or new engine is required; mobile reuses it via WebView. Therefore **zero auth-code changes** are implemented this phase. The only genuine gap (durable multi-device sessions/revocation) is intentionally deferred because it requires the production database — building it half-way against an unprovisioned DB would violate "evidence over assumptions." The `authEnabled` hardening is offered but unapplied (awaiting approval).

## PHASE G — Tests (this phase)

Existing auth coverage re-run green. **Added** session tests that pass against current code:
- multiple concurrent sessions for the same `sub` are independent; logging out one jti does not invalidate the other (per-jti revocation isolation);
- guest session cannot reach `sensitive` even with a valid token (gate isolation).

Run: `npm test`, `tsc --noEmit`, `next build`, `eslint` on touched files — results in the phase report.

---
**Boundaries honored:** no production creds; no Vercel/env/`AKANSHA_RELEASES`/download-button change; nothing published; no second auth/session engine; Windows v3.0.0 untouched. Durable device sessions are **NOT CONFIGURED — HUMAN ACTION (needs Postgres)**.
