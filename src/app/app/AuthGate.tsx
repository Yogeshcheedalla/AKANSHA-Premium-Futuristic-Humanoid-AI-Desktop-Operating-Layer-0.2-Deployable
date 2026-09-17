import type { AppView } from '@/core/auth/appAccess';

/**
 * The mandatory Google authentication gate for /app (server-rendered).
 *
 * There is NO username/password and NO guest bypass on the hosted web — Google is
 * the only identity provider. When Google is not yet configured we say so honestly
 * instead of showing a broken button.
 */
export function AuthGate({ view, reason }: { view: AppView; reason: string }) {
  const configured = view !== 'NOT_CONFIGURED';
  return (
    <div className="relative min-h-screen w-full overflow-hidden flex items-center justify-center px-6" style={{ background: 'radial-gradient(1200px 600px at 50% -10%, rgba(0,240,255,0.10), transparent), #010208' }}>
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur-xl p-10 text-center shadow-[0_0_60px_rgba(0,240,255,0.08)]">
        <div className="mx-auto mb-6 h-16 w-16 rounded-full border border-cyan-400/30 bg-gradient-to-br from-cyan-500/20 to-purple-500/20 flex items-center justify-center">
          <span className="text-cyan-200 text-xl font-light">A</span>
        </div>
        <h1 className="text-2xl font-light tracking-[0.2em] text-white/90">AKANSHA</h1>
        <p className="mt-1 text-[10px] uppercase tracking-[0.25em] text-white/40">Humanoid AI Operating Layer</p>

        {configured ? (
          <>
            <p className="mt-8 text-sm text-white/50">Sign in with Google to continue.</p>
            <a
              href="/api/auth/google"
              className="mt-6 inline-flex w-full items-center justify-center gap-3 rounded-xl border border-white/15 bg-white px-5 py-3 text-sm font-medium text-[#0b0f17] hover:bg-white/90 transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.2 13.9 17.6 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.9 7.2l7.6 5.9c4.4-4.1 7.1-10.2 7.1-17.6z"/><path fill="#FBBC05" d="M10.4 28.3c-.5-1.4-.8-2.9-.8-4.3s.3-3 .8-4.3l-7.8-6.1C1 16.5 0 20.1 0 24s1 7.5 2.6 10.4l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.4-5.5l-7.6-5.9c-2.1 1.4-4.8 2.3-7.8 2.3-6.4 0-11.8-4.4-13.6-9.8l-7.8 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
              Continue with Google
            </a>
            <p className="mt-5 text-[11px] text-white/30">Akansha never sees your Google password. Authentication is handled by Google.</p>
          </>
        ) : (
          <>
            <div className="mt-8 rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200/90">
              Google authentication is not configured.
            </div>
            <p className="mt-4 text-[12px] text-white/40">Set <span className="font-mono text-white/60">GOOGLE_CLIENT_ID</span> and <span className="font-mono text-white/60">GOOGLE_CLIENT_SECRET</span> in the server environment (Vercel), then sign in. No account or password is stored by Akansha.</p>
          </>
        )}

        <a href="/" className="mt-8 inline-block text-[11px] text-white/30 hover:text-white/60">← Back to home</a>
        <p className="sr-only">{reason}</p>
      </div>
    </div>
  );
}
