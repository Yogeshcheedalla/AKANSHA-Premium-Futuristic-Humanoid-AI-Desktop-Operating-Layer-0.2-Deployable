/**
 * In-memory PKCE state for the OpenRouter browser OAuth dance (single server
 * process). Maps state -> { verifier, redirectUri } between /connect and /callback.
 * state is a high-entropy CSRF token; entries are consumed on use and expire.
 */
interface Pending { verifier: string; redirectUri: string; at: number }
const TTL_MS = 10 * 60 * 1000;

class OAuthPendingStore {
  private map = new Map<string, Pending>();
  set(state: string, v: { verifier: string; redirectUri: string }) { this.map.set(state, { ...v, at: Date.now() }); }
  take(state: string): Pending | undefined {
    const p = this.map.get(state);
    if (!p) return undefined;
    this.map.delete(state);
    return Date.now() - p.at > TTL_MS ? undefined : p;
  }
  size() { return this.map.size; }
}
export const pendingOAuth = new OAuthPendingStore();
