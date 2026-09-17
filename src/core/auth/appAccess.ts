/**
 * Mandatory-application access decision (pure + testable).
 *
 * Akansha's application (/app and assistant functionality) requires a REAL,
 * Google-authenticated session — there is NO username/password account and NO
 * guest bypass for the hosted app. Google is the only identity provider; Akansha
 * issues its own secure session AFTER Google verifies the identity.
 *
 * The public landing page and public health/release/auth endpoints are handled
 * elsewhere (they stay open). This decides only what /app shows.
 */
import type { Principal } from './tokens';

export type AppView = 'APP' | 'GOOGLE_GATE' | 'NOT_CONFIGURED';

export interface AppAccessDecision {
  view: AppView;
  reason: string;
}

/**
 * A session counts for the app only if it is a REAL account session (role 'user').
 * On the hosted web the ONLY way to obtain one is Google (there is no password
 * system). On the desktop the local bootstrap yields a 'user' session so offline AI
 * never depends on Google. Guest sessions are explicitly NOT sufficient.
 */
export function isAppSession(p: Principal | null | undefined): boolean {
  return !!p && p.role === 'user';
}

export function decideAppAccess(input: {
  principal: Principal | null;
  googleConfigured: boolean;
}): AppAccessDecision {
  if (isAppSession(input.principal)) return { view: 'APP', reason: 'authenticated account session' };
  if (!input.googleConfigured) {
    return { view: 'NOT_CONFIGURED', reason: 'Google authentication is not configured.' };
  }
  return { view: 'GOOGLE_GATE', reason: 'Sign in with Google to continue.' };
}
