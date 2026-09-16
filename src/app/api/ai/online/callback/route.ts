import { NextResponse } from 'next/server';
import { completeOpenRouterAuth, parseCallback } from '@/integrations/openrouter/oauth';
import { pendingOAuth } from '@/core/identity/oauthPendingStore';

export const dynamic = 'force-dynamic';

/**
 * GET/POST /api/ai/online/callback — the OpenRouter browser redirect target.
 * Validates the CSRF state against the pending PKCE store, then exchanges the
 * authorization code for the USER's own API key (POST /auth/keys) and verifies it
 * against the authenticated GET /key before storing it ONLY as an opaque credential.
 * The raw key is never logged, returned, or placed in the renderer.
 */
async function handle(request: Request) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  const pending = pendingOAuth.take(state);
  if (!pending) {
    return html(400, '<h3>Connection failed</h3><p>Invalid or expired state (possible CSRF). Nothing was connected.</p>');
  }
  try {
    const { code } = parseCallback(url.searchParams, state);
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
