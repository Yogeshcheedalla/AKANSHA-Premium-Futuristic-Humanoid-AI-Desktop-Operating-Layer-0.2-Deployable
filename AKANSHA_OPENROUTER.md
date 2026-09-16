# AKANSHA — OpenRouter Online AI (OAuth PKCE) Configuration

This documents **exactly what the current official OpenRouter OAuth PKCE flow and
this application expect**. Names, endpoints and behaviors are read from the code and
from OpenRouter's current documentation. Akansha NEVER collects the OpenRouter
password and NEVER invents an identifier.

> **Correction:** an earlier build gated "Connect OpenRouter" on a required
> `AKANSHA_OPENROUTER_CLIENT_ID` and returned `501` without one. OpenRouter's
> **current** PKCE flow does **not** require a `client_id` — it needs only a
> callback URL. That false blocker has been removed. `client_id` is now optional
> (forwarded only if you register one later) and never fabricated.

## The flow (as OpenRouter documents it)

```
https://openrouter.ai/auth
    ?callback_url=<your callback>
    &code_challenge=<S256(verifier)>
    &code_challenge_method=S256
    [&key_label=Akansha]            # optional
    [&state=<single-use>]           # forwarded; not relied upon (see CSRF)
        |  user signs in / signs up ON OpenRouter and authorizes Akansha
        v
<your callback>?code=<authorization-code>
        |
        v
POST https://openrouter.ai/api/v1/auth/keys
     { "code": ..., "code_verifier": ..., "code_challenge_method": "S256" }
        v   ->  { "key": "sk-or-..." }   (the USER's own key)
GET  https://openrouter.ai/api/v1/key     (Authorization: Bearer <key>)  -> verify
        v
store ONLY as an opaque credentialRef (AES-GCM vault; DPAPI on desktop)
```

There is **no** `client_id`, `response_type`, `redirect_uri`, or `scope` in
OpenRouter's `/auth` shape — it uses `callback_url`. The **only required** input is
a real callback URL.

## Required / relevant environment variables (real names from the code)

Resolved in `openRouterOAuthConfig()` / `resolveOAuthCallback()`:

| Variable | Required? | Meaning |
| --- | --- | --- |
| `AKANSHA_PUBLIC_URL` | Recommended (production) | Base public URL. Callback = `${AKANSHA_PUBLIC_URL}/api/ai/online/callback`. |
| `AKANSHA_OPENROUTER_REDIRECT_URI` | Optional | Exact callback URL; **overrides** `AKANSHA_PUBLIC_URL` derivation. Must match the deployed origin exactly. |
| `AKANSHA_OPENROUTER_CLIENT_ID` | **Optional (NOT required)** | Forwarded to `/auth` only if you have registered one. Never invented. |
| `AKANSHA_OPENROUTER_KEY_LABEL` | Optional | OpenRouter's `key_label` (default `Akansha`). |
| `AKANSHA_OPENROUTER_AUTHORIZE_URL` | Optional | Override `/auth` endpoint. |

Callback precedence (never conflicting): `AKANSHA_OPENROUTER_REDIRECT_URI` →
`AKANSHA_PUBLIC_URL + /api/ai/online/callback` → the live request origin. So the
deployed site can start the flow with `AKANSHA_PUBLIC_URL` set (or even without it,
deriving from the request host).

> The plain-API-key provider path is separate and uses `OPENROUTER_API_KEY`,
> `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL` — do not confuse those with the OAuth
> `AKANSHA_OPENROUTER_*` names.

## Production callback

```
https://akansha-gamma.vercel.app/api/ai/online/callback
```

Recommended production env (Vercel project `akansha`):
```
AKANSHA_PUBLIC_URL=https://akansha-gamma.vercel.app
```

## Security properties (preserved)

- **PKCE S256**: random `code_verifier` (never in the browser or long-term storage);
  `code_challenge = BASE64URL(SHA-256(verifier))` sent to `/auth`; verifier replayed
  on the exchange.
- **CSRF**: OpenRouter's documented callback returns only `code` (it does **not** echo
  `state`), so the pending PKCE transaction is bound to the caller's **authenticated
  Akansha session** and is **single-use** (`pendingOAuth.takeForSub`). A returned
  `state` is still validated for mismatch when present. No code is ever exchanged
  before a pending transaction for THIS session is found; a replayed/consumed
  transaction is rejected.
- **Verification before trust**: the exchanged key is checked against the
  **authenticated** `GET /api/v1/key` (a bogus key → 401 → not stored). The public
  `/models` list is never used to judge auth (it returns 200 even unauthenticated).
- **Credential storage**: only an opaque `credentialRef` in ConnectedServices
  (AES-GCM vault, DPAPI-backed on desktop). The raw key is never returned to the
  renderer, logged, or placed in traces. Connected OpenRouter is separate from
  Akansha identity.

## Accountless AKANSHA

No Akansha signup is required. `POST /api/ai/online/connect` is guarded as
`authenticated`, which an accountless **guest** session satisfies — so "Continue
with OpenRouter" works with no Akansha account. Guests are still refused
`sensitive`/`admin` operations. Authentication and (if needed) signup happen on
OpenRouter's own page; Akansha never sees the OpenRouter password, recovery code, or
MFA secret.

## When is the endpoint still `501`?

Only when **no** callback URL can be resolved (no `AKANSHA_OPENROUTER_REDIRECT_URI`,
no `AKANSHA_PUBLIC_URL`, and no parseable request origin) — a genuinely
un-configurable state. It is **not** used as a proxy for "we haven't invented a
client_id", because no client_id is needed.

## Live status (honest)

- **Architecture + code: VERIFIED** offline — client_id-free authorize URL
  (`callback_url` + PKCE S256 + optional `key_label`/`state`), session-bound
  single-use CSRF, code exchange at `POST /api/v1/auth/keys` with
  `{code, code_verifier, code_challenge_method}`, `GET /key` verification, opaque
  vault storage, accountless guest access. Covered by
  `OpenRouter.test.ts`, `oauth.test.ts`, `openRouterOAuth.test.ts`, and the
  `connect/` + `callback/` route tests.
- **Production `connect`: VERIFIED LIVE** — returns a real `openrouter.ai/auth`
  redirect (HTTP 200) for a session, no longer a client_id `501`.
- **Full end-to-end OAuth completion** (real login → code → key stored): requires a
  human to finish the login on OpenRouter. It is not claimed complete here without
  that browser evidence, and no client_id is invented to fake it.
