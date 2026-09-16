# AKANSHA — OpenRouter Online AI (OAuth) Configuration

This documents **exactly what the application currently expects**. Every name,
endpoint, and behavior below is read from the code, not invented. Akansha NEVER
collects the OpenRouter password and NEVER auto-creates an account.

## Purpose

OpenRouter OAuth lets a user connect **their own** OpenRouter account so Akansha
can use cloud ("online") AI. Authorization happens entirely through **OpenRouter's
own** browser flow (which also hosts OpenRouter sign-up/sign-in). Akansha only
receives an authorization `code` at the callback and exchanges it for the user's
own API key, which is stored as an opaque credential.

## The two independent paths

| Path | Where it runs | Needs client_id? | Needs an Akansha account? |
| --- | --- | --- | --- |
| Offline / local AI (llama.cpp + signed GGUF) | **Desktop only** | No | **No** (accountless guest) |
| Online AI (OpenRouter OAuth) | Web + desktop | **Yes** for live OAuth | **No** before/for connecting |

An API-key path also exists independently of OAuth: setting `OPENROUTER_API_KEY`
makes the `openrouter` provider usable for generation without the OAuth dance.
The OAuth flow below is specifically the "Continue with OpenRouter" account
connection.

## Required environment variables (real names from the code)

Read from `openRouterOAuthConfig()` in `src/core/identity/openRouterOAuth.ts`:

| Variable | Required? | Meaning | Source |
| --- | --- | --- | --- |
| `AKANSHA_OPENROUTER_CLIENT_ID` | **Yes** for live OAuth | The OAuth application client id registered with OpenRouter. If absent, the flow is honestly **BLOCKED**. | `openRouterOAuthConfig().clientId` |
| `AKANSHA_OPENROUTER_REDIRECT_URI` | Optional | Exact OAuth redirect/callback URI. If omitted it is **derived** from `AKANSHA_PUBLIC_URL`. | `openRouterOAuthConfig().redirectUri` |
| `AKANSHA_PUBLIC_URL` | Recommended in prod | Base public URL; redirect is derived as `${AKANSHA_PUBLIC_URL}/api/ai/online/callback`. | `openRouterOAuthConfig()` |
| `AKANSHA_OPENROUTER_SCOPE` | Optional | OAuth scope; **defaults to `model:read`**. | `openRouterOAuthConfig().scope` |
| `AKANSHA_OPENROUTER_AUTHORIZE_URL` | Optional | Override the authorize endpoint (defaults to `https://openrouter.ai/auth`). | `openRouterOAuthConfig().authorizeUrl` |

> Note: the plain-API-key provider uses the **different** variables
> `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_BASE_URL`. Those are not
> the OAuth `AKANSHA_OPENROUTER_*` names. Do not confuse them.

## Production callback / redirect URI

For the deployed production site the callback is:

```
https://akansha-gamma.vercel.app/api/ai/online/callback
```

This is handled by `src/app/api/ai/online/callback/route.ts` (GET and POST).
When configuring OpenRouter, register this **exact** string as the redirect URI.
If `AKANSHA_OPENROUTER_REDIRECT_URI` is not set, the app derives the same value
from `AKANSHA_PUBLIC_URL=https://akansha-gamma.vercel.app`.

## OAuth flow (implemented, architecture verified by tests)

1. **Connect** — `POST /api/ai/online/connect` (guarded as `authenticated`).
   Server mints PKCE (S256) `verifier`/`challenge` + a single-use `state`, stores
   `{verifier, redirectUri}` in `pendingOAuth`, and returns the OpenRouter
   authorize URL. The URL is opened in the **system browser**, never an embedded
   webview.
2. **Authorize at OpenRouter** — the user signs into / creates their OpenRouter
   account **on OpenRouter's own page**. Akansha is not involved and never sees a
   password.
3. **Callback** — OpenRouter redirects to
   `/api/ai/online/callback?code=...&state=...`. The route **takes** the pending
   `state` (single-use) and `parseCallback` rejects any **state mismatch (CSRF)**
   or an `error` response.
4. **Code exchange** — `completeOpenRouterAuth` calls
   `POST https://openrouter.ai/api/v1/auth/keys` (with the code + PKCE verifier)
   to obtain the user's own API key.
5. **Verification** — the key is checked against the **authenticated**
   `GET https://openrouter.ai/api/v1/key`. (A bogus key → 401 → not stored. The
   public `/models` list is NOT used to judge auth, because it returns 200 even
   for a bad key.)
6. **Credential storage** — only on a successful verify, the key is stored as an
   **opaque** `credentialRef` via `ConnectedServices` (AES-GCM CredentialVault,
   DPAPI-backed on desktop). The raw key is **never** returned to the renderer,
   logged, or placed in traces. The route returns only a masked label.

### Security properties preserved

- PKCE (S256) + CSRF `state`, single-use pending store.
- Authenticated `GET /key` verification before any trust.
- Opaque credential storage; OpenRouter connection is a **ConnectedService**,
  separate from Akansha identity.
- **Accountless**: no Akansha signup is needed to start a chat or to begin the
  OpenRouter connection (the guest session satisfies the `authenticated` guard);
  guests are still refused `sensitive`/`admin` operations.

## What happens when `client_id` is absent (current production state)

`isOAuthConfigured()` returns `false`, so `startOpenRouterConnect()` returns
`{ configured:false, reason:'OPENROUTER CLIENT_ID/redirect not configured' }`,
and `POST /api/ai/online/connect` responds **`501`**:

```json
{ "ok": false, "configured": false, "error": "OPENROUTER CLIENT_ID/redirect not configured" }
```

No authorize URL is fabricated. The Model Center shows "OpenRouter connection not
configured". **This 501 is correct, expected behavior — not a deployment failure.**
Verified by `src/app/api/ai/online/connect/route.test.ts`.

## How to configure a real client_id

1. Create an OAuth application in your OpenRouter account and register the exact
   redirect URI above (`https://akansha-gamma.vercel.app/api/ai/online/callback`).
2. In Vercel (project `akansha`, team `cheedallayogesh05-1678s-projects`), set:
   ```
   AKANSHA_OPENROUTER_CLIENT_ID=<the registered client id>
   AKANSHA_PUBLIC_URL=https://akansha-gamma.vercel.app
   ```
   (Optionally pin `AKANSHA_OPENROUTER_REDIRECT_URI` to the exact callback.)
3. Redeploy so the value is present at runtime.

Never commit the client id value, and **never** fabricate one to make a demo pass.

## Live status (honest)

- **Architecture + code: VERIFIED** — PKCE/state, callback CSRF rejection, code
  exchange, `GET /key` verification, and opaque credential storage are all
  implemented and covered by offline tests
  (`src/integrations/openrouter/oauth.test.ts`, `OpenRouter.test.ts`,
  `src/core/identity/openRouterOAuth.test.ts`,
  `src/app/api/ai/online/connect/route.test.ts`).
- **Live end-to-end OAuth: BLOCKED** — requires a real registered
  `AKANSHA_OPENROUTER_CLIENT_ID`, which is **NOT CONFIGURED**. Until one is
  supplied the connect route correctly returns `501`.
