import crypto from 'crypto';
import { db } from '@/db';
import { credentials } from '@/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Credential Vault.
 *
 * Raw API keys / tokens are NEVER stored in plain application state, never
 * returned by any API, never written to logs, events, telemetry, traces,
 * mission history or LLM prompts. Only an opaque credentialRef is exposed.
 *
 * Secrets are encrypted with AES-256-GCM and held in a synchronous in-memory
 * cache (so the hot resolve() path stays sync), and — when a database is
 * configured — mirrored to the `credentials` table so they survive restarts.
 * On startup, hydrate() reloads the encrypted envelopes from the DB into the
 * cache. When persistence is disabled the vault still works for the lifetime of
 * the process.
 *
 * In a real Windows desktop build the durable layer would delegate to Windows
 * Credential Manager / DPAPI; the same contract (opaque ref, never raw) holds.
 */
export class CredentialVault {
  private store = new Map<string, { encrypted: string; iv: string }>();
  private algo = 'aes-256-gcm';
  private hydrated = false;

  private key(): Buffer {
    const secret =
      process.env.AKANSHA_SECRET ||
      process.env.DATABASE_URL ||
      'akansha-local-development-vault-key';
    return crypto.createHash('sha256').update(secret).digest();
  }

  /**
   * Load any previously persisted envelopes into the in-memory cache.
   * Safe to call repeatedly; no-op when persistence is unavailable.
   */
  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      const rows = await db.select({ ref: credentials.ref, encrypted: credentials.encrypted, iv: credentials.iv }).from(credentials);
      for (const r of rows) {
        if (!this.store.has(r.ref)) this.store.set(r.ref, { encrypted: r.encrypted, iv: r.iv });
      }
    } catch {
      /* persistence disabled — cache still works in-process */
    }
  }

  /**
   * Store a secret and return an opaque reference. Mirrors to the DB when
   * persistence is available (fire-and-forget; never blocks the caller).
   */
  put(secret: string): string {
    const ref = `cred_${crypto.randomBytes(12).toString('hex')}`;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(this.algo, this.key(), iv) as unknown as {
      update: (d: Buffer | string, i?: string, o?: string) => Buffer;
      final: () => Buffer;
      getAuthTag: () => Buffer;
    };
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    const enc = encrypted.toString('base64');
    const ivB64 = iv.toString('base64');
    this.store.set(ref, { encrypted: enc, iv: ivB64 });
    void this.persist(ref, enc, ivB64);
    return ref;
  }

  private async persist(ref: string, encrypted: string, iv: string): Promise<void> {
    try {
      await db
        .insert(credentials)
        .values({ ref, encrypted, iv })
        .onConflictDoNothing();
    } catch {
      /* persistence disabled — in-memory copy remains valid for this process */
    }
  }

  /**
   * Resolve a reference. Returns null when missing — never throws, never logs the value.
   */
  resolve(ref?: string | null): string | null {
    if (!ref) return null;
    const entry = this.store.get(ref);
    if (!entry) return null;
    try {
      const buf = Buffer.from(entry.encrypted, 'base64');
      const tag = buf.subarray(buf.length - 16);
      const body = buf.subarray(0, buf.length - 16);
      const decipher = crypto.createDecipheriv(this.algo, this.key(), Buffer.from(entry.iv, 'base64')) as unknown as {
        update: (d: Buffer) => Buffer;
        final: () => Buffer;
        setAuthTag: (t: Buffer) => void;
      };
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }

  /**
   * Masked form for safe identification in logs/UI. Never the real key.
   */
  mask(ref?: string | null): string | null {
    const value = this.resolve(ref);
    if (!value) return null;
    if (value.length <= 8) return '••••••••';
    return `${value.slice(0, 4)}${'•'.repeat(8)}`;
  }

  exists(ref?: string | null): boolean {
    return !!ref && this.store.has(ref);
  }

  forget(ref: string) {
    this.store.delete(ref);
    void db.delete(credentials).where(eq(credentials.ref, ref)).catch(() => {});
  }
}

export const credentialVault = new CredentialVault();
