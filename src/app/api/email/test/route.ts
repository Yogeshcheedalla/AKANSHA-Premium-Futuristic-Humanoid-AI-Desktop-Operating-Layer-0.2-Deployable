import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { sendMail, isSmtpConfigured } from '@/core/email/mailService';

export const dynamic = 'force-dynamic';

/**
 * POST /api/email/test — a protected, non-public SMTP diagnostic that sends ONE
 * transactional test message so an operator can verify delivery is actually wired.
 *
 * Security posture (matches the spec's "admin-safe, NOT an unrestricted public
 * email-sending endpoint"):
 *  - Requires a REAL account session ('sensitive'); guests and unauthenticated
 *    callers are rejected (403/401).
 *  - Sends ONLY to the caller's own verified email (from the signed session). An
 *    arbitrary `to` is refused, so this can never be driven as an open mail relay.
 *  - Returns an honest outcome (SENT / NOT_CONFIGURED / FAILED) with no credentials,
 *    host, or recipient list in the response.
 */
export async function POST(request: Request) {
  const guard = authorize(request, 'sensitive');
  if (!guard.ok) return guard.response;

  const email = guard.principal?.email;
  if (!email) {
    return NextResponse.json({ ok: false, status: 'NO_SENDER', error: 'Your session has no email to send a test message to.' }, { status: 400 });
  }

  let body: any = {};
  try { body = await request.json(); } catch { /* tolerate empty body */ }
  if (body?.to && body.to !== email) {
    return NextResponse.json({ ok: false, status: 'REFUSED', error: 'The test endpoint only sends to your own account email.' }, { status: 403 });
  }

  if (!isSmtpConfigured(process.env)) {
    return NextResponse.json({ ok: false, status: 'NOT_CONFIGURED' });
  }

  // Never await a hang: bounded like the welcome path; a failure must not 500 the UI.
  const result = await sendMail({
    to: email,
    subject: 'Akansha SMTP test',
    text: 'This is a transactional test message from Akansha. If you received it, SMTP delivery is working.',
  });

  return NextResponse.json({
    ok: result.ok,
    status: result.status,
    // Echo NO recipient/host/secret — only the outcome and an opaque message id.
    messageId: result.messageId ?? null,
    ...(result.status === 'FAILED' ? { errorCode: result.errorCode } : {}),
  });
}
