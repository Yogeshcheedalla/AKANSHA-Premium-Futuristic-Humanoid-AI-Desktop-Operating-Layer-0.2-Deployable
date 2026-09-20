import crypto from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { db, isDbConfigured } from '@/db';
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
 * cache (so the hot resolve() path stays sync). Durability follows whichever
 * persistence layer the deployment has:
 *   • database configured (web/production): envelopes mirror to the
 *     `credentials` table — EXACTLY as before, same key derivation, existing
 *     stored envelopes remain valid;
 *   • DB-less desktop: envelopes persist to an encrypted local file under the
 *     app home, keyed by a random machine-local secret generated on first use
 *     (file ACL is the boundary) — so a connected provider survives restart.
 * The contract (opaque ref, never raw) is identical in both modes.
 */
export class CredentialVault {
  private store = new Map<string, { encrypted: string; iv: string }>();
  private algo = 'aes-256-gcm';
  private hydrated = false;

  /* ── DB-less desktop persistence ─────────────────────────────────────── */
  private localDir(): string {
    return process.env.AKANSHA_HOME ? join(process.env.AKANSHA_HOME, 'data') : join(process.cwd(), 'data', 'akansha', 'data');
  }
  private localFile(): string { return join(this.localDir(), 'vault.json'); }
  private keyFile(): string { return join(this.localDir(), 'vault.key'); }
  private machineSecret(): Buffer {
    try {
      if (!existsSync(this.keyFile())) {
        mkdirSync(dirname(this.keyFile()), { recursive: true });
        writeFileSync(this.keyFile(), crypto.randomBytes(32), { mode: 0o600 });
      }
      return readFileSync(this.keyFile());
    } catch {
      return Buffer.from('akansha-vault-machine-secret-unavailable');
    }
  }
  private readLocal(): Record<string, { encrypted: string; iv: string }> {
    try {
      if (!existsSync(this.localFile())) return {};
      const j = JSON.parse(readFileSync(this.localFile(), 'utf8'));
      return j && typeof j === 'object' ? j : {};
    } catch { return {}; }
  }
  private writeLocal(map: Record<string, { encrypted: string; iv: string }>): void {
    try { mkdirSync(dirname(this.localFile()), { recursive: true }); writeFileSync(this.localFile(), JSON.stringify(map), { mode: 0o600 }); } catch { /* best effort */ }
  }

  private key(): Buffer {
    const secret =
      process.env.AKANSHA_SECRET ||
      process.env.DATABASE_URL ||
      'akansha-local-development-vault-key';
    // DB mode: EXACT previous derivation (existing production envelopes stay valid).
    if (isDbConfigured) return crypto.createHash('sha256').update(secret).digest();
    // Desktop mode: bind to the per-machine secret file as well.
    return crypto.createHash('sha256').update(secret).update(this.machineSecret()).digest();
  }

  /**
   * Load any previously persisted envelopes into the in-memory cache.
   * Safe to call repeatedly; no-op when persistence is unavailable.
   */
  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    if (!isDbConfigured) {
      for (const [ref, env] of Object.entries(this.readLocal())) {
        if (!this.store.has(ref) && env?.encrypted && env?.iv) this.store.set(ref, env);
      }
      return;
    }
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
    if (!isDbConfigured) {
      const map = this.readLocal();
      map[ref] = { encrypted, iv };
      this.writeLocal(map);
      return;
    }
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
    if (!isDbConfigured) {
      const map = this.readLocal();
      delete map[ref];
      this.writeLocal(map);
      return;
    }
    void db.delete(credentials).where(eq(credentials.ref, ref)).catch(() => {});
  }
}

export const credentialVault = new CredentialVault();
