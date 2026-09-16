import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { completeOpenRouterAuth, parseCallback } from '@/integrations/openrouter/oauth';
import { pendingOAuth } from '@/core/identity/oauthPendingStore';

export const dynamic = 'force-dynamic';

/**
 * GET/POST /api/ai/online/callback — the OpenRouter browser redirect target.
 *
 * Completion is bound to the caller's authenticated Akansha session: we take the
 * PKCE verifier THIS session started (OpenRouter's callback carries only a `code`,
 * not a documented `state`). If a `state` is returned it must belong to this
 * session and any mismatch is rejected (CSRF). The code is then exchanged
 * (POST /api/v1/auth/keys) and verified against the authenticated GET /api/v1/key
 * before the key is stored ONLY as an opaque credential. The raw key is never
 * logged, returned, or placed in the renderer.
 */
async function handle(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return html(401, '<h3>Connection failed</h3><p>An Akansha session is required to complete the connection.</p>');
  const sub = guard.principal?.sub ?? 'guest';

  const url = new URL(request.url);
  const qState = url.searchParams.get('state');

  let pending = pendingOAuth.takeForSub(sub);
  if (!pending && qState) {
    const byState = pendingOAuth.take(qState);
    if (byState && byState.sub === sub) pending = byState;
    else if (byState) return html(400, '<h3>Connection failed</h3><p>This authorization belongs to a different session. Nothing was connected.</p>');
  }
  if (!pending) {
    return html(400, '<h3>Connection failed</h3><p>No pending connection for this session (expired, already used, or started in another window). Please start again.</p>');
  }
  try {
    const { code } = parseCallback(url.searchParams, pending.state);
    const result = await completeOpenRouterAuth({ code, verifier: pending.verifier });
    // never expose the key; result is already masked
    return html(200, `<h3 style="color:#22c55e">✓ Online AI connected${result.label ? ` (${result.label})` : ''}</h3><p>You can close this window and return to Akansha.</p>`);
  } catch (e: any) {
    return html(400, `<h3>Connection failed</h3><p>${escape(e?.message || 'OAuth exchange failed')}</p>`);
  }
}

function html(status: number, body: string) {
  return new NextResponse(`<!doctype html><meta charset=utf-8><body style="font-family:system-ui;background:#0b0f17;color:#e5e7eb;padding:2rem">${body}</body>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
function escape(s: string) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string)); }

export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }
