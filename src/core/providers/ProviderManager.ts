import { db } from '@/db';
import { modelProviders, providerModels } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { createProvider, type ProviderConfigInput } from '../../integrations/models/ProviderFactory';
import type { ModelProvider, ModelInfo, HealthStatus, ProviderType } from '../models/ModelProvider';
import { LocalGgufProvider, detectLlamaRuntime, type LocalModelState } from '../models/local/LocalGgufProvider';
import { readUsable } from '../models/local/LocalModelRegistry';
import { credentialVault } from '../security/CredentialVault';
import { eventBus } from '../events/EventBus';

export interface ProviderRecord {
  providerId: string;
  name: string;
  type: ProviderType;
  baseUrl: string | null;
  defaultModel: string | null;
  enabled: boolean;
  isDefault: boolean;
  fallbackPriority: number;
  policy: string;
  capabilities: Record<string, boolean>;
  settings: Record<string, unknown>;
  health: { status: string; latencyMs: number; detail?: string };
  credentialConfigured: boolean;
}

/**
 * Provider Manager — user-configurable AI providers.
 *
 * Providers persist in the database. Secrets live ONLY in the CredentialVault
 * and are referenced by credentialRef; they are never returned by any API,
 * never logged, and never included in traces or mission history.
 */
export class ProviderManager {
  private providers = new Map<string, ModelProvider>();
  private loaded = false;

  /** Built-in definitions used to seed a fresh install. */
  private builtin(): ProviderConfigInput[] {
    return [
      { id: 'ollama', name: 'Ollama (Local)', type: 'ollama', baseUrl: process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434', enabled: true, fallbackPriority: 20 },
      { id: 'openrouter', name: 'OpenRouter (Cloud)', type: 'openrouter', baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1', apiKey: process.env.OPENROUTER_API_KEY, defaultModel: process.env.OPENROUTER_MODEL || 'openrouter/free', enabled: true, fallbackPriority: 30 },
      { id: 'openai', name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: process.env.OPENAI_API_KEY, enabled: true, fallbackPriority: 40 },
      { id: 'gemini', name: 'Google Gemini', type: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: process.env.GEMINI_API_KEY, enabled: true, fallbackPriority: 50 },
      {
        id: 'experiential',
        name: 'Experiential Labs',
        type: 'openai-compatible',
        baseUrl: process.env.EXPLABS_BASE_URL || 'https://api.experientiallabs.ai/v1',
        apiKey: process.env.EXPLABS_API_KEY,
        enabled: true,
        fallbackPriority: 10,
      },
      { id: 'local-server', name: 'Local Inference Server', type: 'local', baseUrl: 'http://127.0.0.1:8080', enabled: false, fallbackPriority: 60 },
    ];
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    this.providers.clear();

    let rows: any[] = [];
    try {
      rows = await db.select().from(modelProviders);
    } catch {
      rows = [];
    }

    if (rows.length === 0) {
      // Best-effort seed from built-ins + environment (no-op when persistence
      // is disabled — the in-memory fallback below still makes providers work).
      for (const cfg of this.builtin()) {
        const credentialRef = cfg.apiKey ? credentialVault.put(cfg.apiKey) : undefined;
        try {
          await db.insert(modelProviders).values({
            providerId: cfg.id,
            name: cfg.name,
            type: cfg.type,
            baseUrl: cfg.baseUrl || null,
            credentialRef: credentialRef || null,
            enabled: cfg.enabled !== false,
            isDefault: cfg.id === 'experiential',
            fallbackPriority: cfg.fallbackPriority ?? 100,
            capabilities: {},
            settings: { temperature: 0.7, timeoutMs: 60000 },
            health: { status: 'UNKNOWN', latencyMs: 0 },
          });
        } catch {
          /* table may not exist yet, or persistence is disabled */
        }
      }
      try {
        rows = await db.select().from(modelProviders);
      } catch {
        rows = [];
      }
    }

    if (rows.length === 0) {
      // Persistence unavailable — instantiate built-in/env providers in memory
      // so a configured model is still reachable and the assistant still works.
      for (const cfg of this.builtin()) {
        this.instantiate(cfg);
      }
      this.syncLocalProviders();
      return;
    }

    for (const row of rows) {
      this.instantiate({
        id: row.providerId,
        name: row.name,
        type: row.type as ProviderType,
        baseUrl: row.baseUrl || undefined,
        credentialRef: row.credentialRef || undefined,
        defaultModel: row.defaultModel || undefined,
        enabled: row.enabled,
        isDefault: row.isDefault,
        fallbackPriority: row.fallbackPriority,
        ...(typeof row.settings === 'object' && row.settings ? row.settings : {}),
      });
    }
    this.syncLocalProviders();
  }

  /**
   * Register the verified local GGUF provider with the single ModelRouter.
   *
   * DESKTOP-ONLY AND RUNTIME-GATED: this is inert on a server (e.g. Vercel)
   * because no llama.cpp binary is detected there — we never download or run a
   * runtime on the web host, and we never register an unverified model. A model
   * is exposed here ONLY if it is already in the LocalModelRegistry, which is
   * written solely by provisionAndVerify() after a REAL inference self-test.
   * The provider's own healthCheck/generate re-enforce the integrity+inference
   * gate, so this method cannot fabricate usability. Failures are swallowed so
   * local-inference problems never break cloud provider loading.
   */
  private syncLocalProviders(): void {
    try {
      const paths = (process.env.LLAMA_CPP_PATHS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (paths.length === 0) return;

      const runtime = detectLlamaRuntime(paths);
      if (!runtime.exists || !runtime.binaryPath) return;

      const usable = readUsable();
      for (const rec of usable) {
        const entry = {
          id: rec.id,
          file: rec.artifactPath,
          url: '',
          sha256: rec.sha256,
          sizeBytes: 0,
          format: 'gguf' as const,
        };
        const state: LocalModelState = {
          entry,
          artifactPath: rec.artifactPath,
          integrityVerified: true,
          inferenceVerified: true,
          lastOutput: rec.benchmark?.text || '',
          lastTimings: rec.benchmark?.totalMs ? { totalMs: rec.benchmark.totalMs, genTps: rec.benchmark.genTps ?? null, promptTps: rec.benchmark.promptTps ?? null } : undefined,
        };
        // Gate on the same honest predicate the provider uses: registry entries
        // only exist after a real inference, but we re-check rather than trust it.
        if (!state.lastOutput || state.lastOutput.trim().length === 0) continue;
        try {
          this.providers.set('local-llama', new LocalGgufProvider(state, runtime));
        } catch {
          /* ignore a single bad record; never break provider load */
        }
        break;
      }
    } catch {
      /* desktop-only convenience; never allowed to break provider loading */
    }
  }

  private instantiate(cfg: ProviderConfigInput) {
    if (cfg.enabled === false) return;
    try {
      this.providers.set(cfg.id, createProvider(cfg));
    } catch (e: any) {
      eventBus.emit('integration.health_changed', 'ProviderManager', { providerId: cfg.id, error: e?.message });
    }
  }

  async addProvider(input: ProviderConfigInput): Promise<ProviderRecord> {
    const credentialRef = input.apiKey ? credentialVault.put(input.apiKey) : input.credentialRef;

    await db
      .insert(modelProviders)
      .values({
        providerId: input.id,
        name: input.name,
        type: input.type,
        baseUrl: input.baseUrl || null,
        credentialRef: credentialRef || null,
        defaultModel: input.defaultModel || null,
        enabled: input.enabled !== false,
        isDefault: input.isDefault === true,
        fallbackPriority: input.fallbackPriority ?? 100,
        capabilities: {},
        settings: {
          temperature: input.temperature ?? 0.7,
          timeoutMs: input.timeoutMs ?? 60000,
          contextLimit: input.contextLimit,
          streaming: input.streaming ?? true,
          organization: input.organization,
          project: input.project,
          headers: input.headers,
        },
        health: { status: 'UNKNOWN', latencyMs: 0 },
      })
      .onConflictDoNothing();

    this.instantiate({ ...input, credentialRef, apiKey: undefined });
    const rec = await this.getRecord(input.id);
    eventBus.emit('mcp.connected', 'ProviderManager', { providerId: input.id, type: input.type });
    return rec!;
  }

  async updateProvider(providerId: string, patch: Partial<ProviderConfigInput> & { enabled?: boolean }): Promise<ProviderRecord | null> {
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.baseUrl !== undefined) values.baseUrl = patch.baseUrl;
    if (patch.defaultModel !== undefined) values.defaultModel = patch.defaultModel;
    if (patch.enabled !== undefined) values.enabled = patch.enabled;
    if (patch.fallbackPriority !== undefined) values.fallbackPriority = patch.fallbackPriority;
    if (patch.apiKey) values.credentialRef = credentialVault.put(patch.apiKey);
    if (patch.temperature !== undefined || patch.timeoutMs !== undefined) {
      values.settings = {
        temperature: patch.temperature ?? 0.7,
        timeoutMs: patch.timeoutMs ?? 60000,
        streaming: patch.streaming ?? true,
      };
    }

    await db.update(modelProviders).set(values).where(eq(modelProviders.providerId, providerId));
    this.loaded = false;
    await this.load();
    return this.getRecord(providerId);
  }

  async removeProvider(providerId: string): Promise<void> {
    await db.delete(modelProviders).where(eq(modelProviders.providerId, providerId));
    await db.delete(providerModels).where(eq(providerModels.providerId, providerId));
    this.providers.delete(providerId);
  }

  get(providerId: string): ModelProvider | undefined {
    return this.providers.get(providerId);
  }

  getAll(): ModelProvider[] {
    return Array.from(this.providers.values());
  }

  async getRecord(providerId: string): Promise<ProviderRecord | null> {
    const p = this.providers.get(providerId);
    if (!p) return null;
    const d = p.descriptor();
    const apiKey = credentialVault.resolve(d.credentialRef);
    return {
      providerId: d.id,
      name: d.name,
      type: d.type,
      baseUrl: d.baseUrl || null,
      defaultModel: d.defaultModel || null,
      enabled: d.enabled,
      isDefault: d.isDefault,
      fallbackPriority: d.fallbackPriority,
      policy: 'BALANCED',
      capabilities: d.capabilities as unknown as Record<string, boolean>,
      settings: d.settings as unknown as Record<string, unknown>,
      health: { status: 'UNKNOWN', latencyMs: 0 },
      credentialConfigured: !!apiKey,
    };
  }

  async listRecords(): Promise<ProviderRecord[]> {
    await this.load();
    const records: ProviderRecord[] = [];
    for (const p of this.providers.values()) {
      const rec = await this.getRecord(p.id);
      if (rec) records.push(rec);
    }
    return records.sort((a, b) => a.fallbackPriority - b.fallbackPriority);
  }

  /**
   * Test a provider: performs a real health check and model discovery.
   * Returns actual evidence — never a fabricated success.
   */
  async testProvider(providerId: string): Promise<{ health: HealthStatus; models: ModelInfo[] }> {
    await this.load();
    const p = this.providers.get(providerId);
    if (!p) {
      return { health: { state: 'UNAVAILABLE', latencyMs: 0, detail: 'Provider not found', checkedAt: Date.now() }, models: [] };
    }
    const health = await p.healthCheck();
    const models = health.state === 'AVAILABLE' || health.state === 'DEGRADED' ? await p.listModels() : [];

    await db
      .update(modelProviders)
      .set({
        health: { status: health.state, latencyMs: health.latencyMs, detail: health.detail, checkedAt: health.checkedAt },
        updatedAt: new Date(),
      })
      .where(eq(modelProviders.providerId, providerId));

    if (models.length > 0) {
      await db.delete(providerModels).where(eq(providerModels.providerId, providerId));
      await db.insert(providerModels).values(
        models.map((m) => ({
          providerId,
          modelId: m.id,
          displayName: m.displayName || m.id,
          capabilities: m.capabilities as unknown as Record<string, boolean>,
          contextWindow: m.contextWindow ?? null,
          available: m.available,
          healthScore: m.healthScore ?? 1,
        }))
      );
    }

    eventBus.emit('integration.health_changed', 'ProviderManager', { providerId, state: health.state, latencyMs: health.latencyMs, models: models.length });
    return { health, models };
  }

  async refreshAllHealth(): Promise<Record<string, HealthStatus>> {
    await this.load();
    const out: Record<string, HealthStatus> = {};
    for (const p of this.providers.values()) {
      out[p.id] = await p.healthCheck();
    }
    return out;
  }
}

export const providerManager = new ProviderManager();
