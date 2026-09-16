import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { startOpenRouterConnect, openRouterOAuthConfig } from '@/core/identity/openRouterOAuth';
import { pendingOAuth } from '@/core/identity/oauthPendingStore';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ai/online/connect — begin browser-based OpenRouter PKCE.
 * Returns the authorize URL to open in the SYSTEM browser (never an embedded webview
 * with credentials). If no client_id is configured, honestly reports NOT CONFIGURED —
 * Akansha never invents one and never collects the OpenRouter password.
 */
export async function POST(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;

  const started = startOpenRouterConnect(process.env);
  if (!started.configured) {
    return NextResponse.json({ ok: false, configured: false, error: started.reason }, { status: 501 });
  }
  pendingOAuth.set(started.state, { verifier: started.verifier, redirectUri: started.redirectUri });
  return NextResponse.json({
    ok: true, configured: true,
    authorizeUrl: started.authorizeUrl, state: started.state,
    redirectUri: openRouterOAuthConfig(process.env).redirectUri,
  });
}
