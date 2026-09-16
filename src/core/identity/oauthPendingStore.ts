/**
 * In-memory PKCE state for the OpenRouter browser OAuth dance (single server
 * process — the desktop app / a persistent local server). Entries are consumed on
 * use and expire.
 *
 * OpenRouter's documented callback returns ONLY a `code` (it does not echo `state`),
 * so the pending transaction is ALSO bound to the caller's authenticated session id
 * (`sub`) and retrieved on that basis. The PKCE verifier lives only here — never in
 * long-term storage and never in the browser.
 */
interface Pending { verifier: string; redirectUri: string; state: string; sub: string; at: number }
const TTL_MS = 10 * 60 * 1000;

class OAuthPendingStore {
  private byState = new Map<string, Pending>();
  private bySub = new Map<string, string>(); // session sub -> active state (one flow per session)

  set(state: string, v: { verifier: string; redirectUri: string; sub: string }) {
    this.byState.set(state, { verifier: v.verifier, redirectUri: v.redirectUri, state, sub: v.sub, at: Date.now() });
    this.bySub.set(v.sub, state);
  }
  take(state: string): Pending | undefined {
    const p = this.byState.get(state);
    if (!p) return undefined;
    this.delete(p);
    return Date.now() - p.at > TTL_MS ? undefined : p;
  }
  /** Retrieve + consume the pending transaction bound to an authenticated session. */
  takeForSub(sub: string): Pending | undefined {
    const state = this.bySub.get(sub);
    if (!state) return undefined;
    return this.take(state);
  }
  private delete(p: Pending) {
    this.byState.delete(p.state);
    if (this.bySub.get(p.sub) === p.state) this.bySub.delete(p.sub);
  }
  size() { return this.byState.size; }
}
export const pendingOAuth = new OAuthPendingStore();
