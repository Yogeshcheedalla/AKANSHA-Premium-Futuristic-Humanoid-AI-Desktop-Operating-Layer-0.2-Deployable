/**
 * Next.js server instrumentation — runs once at startup (Node runtime).
 *
 * Materializes the local pairing token so the desktop app / CLI can read
 * `.akansha-auth.json` and exchange it for a session. This is the bootstrap for
 * server-side authentication; nothing is logged except a masked hint.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    try {
      const { auth } = await import('@/core/auth/session');
      const token = auth.userPassphrase();
      // Never log the token itself.
      console.log(
        `[AKANSHA] auth enabled=${auth.authEnabled()} — local pairing token ready (${token.slice(0, 4)}…${token.slice(-2)}). ` +
          `Exchange it via POST /api/auth/session.`
      );
    } catch (e: any) {
      console.warn('[AKANSHA] auth bootstrap failed:', e?.message);
    }
  }
}
