/**
 * Connected Services — Akansha identity is kept SEPARATE from any provider
 * account. Connecting OpenRouter stores ONLY an opaque credentialRef in the
 * CredentialVault (AES-GCM, never raw, never in renderer state). The Akansha
 * login (Google / email OTP / session) is independent: an OpenRouter key is a
 * connected service, not the user's Akansha password, and is revocable on its
 * own. This module owns that relationship; it never calls the network.
 */
import { credentialVault } from '@/core/security/CredentialVault';

export type ProviderName = 'openrouter' | string;

export interface ConnectedService {
  provider: ProviderName;
  credentialRef: string;    // opaque; the raw key is never stored here
  label?: string;           // from /key verify (e.g. 'personal'), never the secret
  addedAt: number;
  verified: boolean;        // only true if OpenRouter.verifyKey() returned ok
}

export class ConnectedServices {
  private services = new Map<ProviderName, ConnectedService>();

  /** Connect a provider from an authorization-code exchange result. */
  connect(opts: { provider: ProviderName; apiKey: string; label?: string; verified: boolean }): ConnectedService {
    if (opts.provider === 'akansha') throw new Error('Akansha identity is not a connected service');
    const credentialRef = credentialVault.put(opts.apiKey);
    const svc: ConnectedService = {
      provider: opts.provider, credentialRef, label: opts.label,
      addedAt: Date.now(), verified: opts.verified === true,
    };
    this.services.set(opts.provider, svc);
    return svc;
  }

  /** Safe for UI: never exposes the key. */
  list(): Array<{ provider: ProviderName; label?: string; verified: boolean; connected: boolean }> {
    return Array.from(this.services.values()).map((s) => ({
      provider: s.provider, label: s.label, verified: s.verified, connected: credentialVault.exists(s.credentialRef),
    }));
  }

  get(provider: ProviderName): ConnectedService | undefined { return this.services.get(provider); }

  /** Resolve the raw key ONLY for an authorized server-side request. Never logs it. */
  resolveKey(provider: ProviderName): string | null {
    const s = this.services.get(provider);
    return s ? credentialVault.resolve(s.credentialRef) : null;
  }

  disconnect(provider: ProviderName): boolean {
    const s = this.services.get(provider);
    if (!s) return false;
    try { credentialVault.forget(s.credentialRef); } catch { /* persistence disabled — in-memory ref is dropped below regardless */ }
    this.services.delete(provider);
    return true;
  }
}

export const connectedServices = new ConnectedServices();
