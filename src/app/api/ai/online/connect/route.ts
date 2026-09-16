import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { startOpenRouterConnect, openRouterOAuthConfig } from '@/core/identity/openRouterOAuth';
import { pendingOAuth } from '@/core/identity/oauthPendingStore';

export const dynamic = 'force-dynamic';

function requestOrigin(req: Request): string | undefined {
  try { const u = new URL(req.url); return `${u.protocol}//${u.host}`; } catch { return undefined; }
}

/**
 * POST /api/ai/online/connect — begin the browser-based OpenRouter PKCE flow.
 * Returns the authorize URL to open in the SYSTEM browser (never an embedded
 * webview). No client_id is required (per OpenRouter's current PKCE docs); the
 * callback is resolved from AKANSHA_OPENROUTER_REDIRECT_URI / AKANSHA_PUBLIC_URL,
 * falling back to the live request origin. Only when NO callback URL can be
 * resolved does this honestly report NOT CONFIGURED — Akansha never invents an
 * identifier and never collects the OpenRouter password.
 */
export async function POST(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  const sub = guard.principal?.sub ?? 'guest';

  const started = startOpenRouterConnect(process.env, requestOrigin(request));
  if (!started.configured) {
    return NextResponse.json({ ok: false, configured: false, error: started.reason }, { status: 501 });
  }
  pendingOAuth.set(started.state, { verifier: started.verifier, redirectUri: started.redirectUri, sub });
  return NextResponse.json({
    ok: true, configured: true,
    authorizeUrl: started.authorizeUrl, state: started.state,
    redirectUri: openRouterOAuthConfig(process.env, requestOrigin(request)).redirectUri,
  });
}
