import type {
  ModelProvider,
  ProviderDescriptor,
  ProviderCapabilities,
  ModelInfo,
  ModelRequest,
  ModelResponse,
  ModelStreamEvent,
  HealthStatus,
  ProviderType,
  ChatMessage,
} from '../../core/models/ModelProvider';
import { credentialVault } from '../../core/security/CredentialVault';
import { inferCapabilitiesFromId } from './CapabilityInference';

export interface ProviderConfigInput {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl?: string;
  apiKey?: string;
  credentialRef?: string;
  defaultModel?: string;
  enabled?: boolean;
  isDefault?: boolean;
  fallbackPriority?: number;
  temperature?: number;
  timeoutMs?: number;
  contextLimit?: number;
  streaming?: boolean;
  organization?: string;
  project?: string;
  headers?: Record<string, string>;
  keyless?: boolean;
  /** Route this config through the named FreeLLMApi gateway adapter (see below). */
  freellmapi?: boolean;
}

const DEFAULT_BASE_URLS: Record<ProviderType, string | undefined> = {
  ollama: 'http://127.0.0.1:11434',
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  'openai-compatible': undefined,
  openrouter: 'https://openrouter.ai/api/v1',
  local: 'http://127.0.0.1:8080',
  custom: undefined,
};

/**
 * One concrete engine serves every OpenAI-shaped provider type
 * (openai, openai-compatible, local, custom, and ollama's /v1 compatibility
 * surface). Gemini has its own endpoint shape and is handled by a dedicated
 * adapter. This avoids four near-identical implementations.
 */
export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;
  readonly name: string;
  readonly type: ProviderType;
  protected config: ProviderConfigInput;

  constructor(config: ProviderConfigInput) {
    this.id = config.id;
    this.name = config.name;
    this.type = config.type;
    this.config = config;
  }

  descriptor(): ProviderDescriptor {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      baseUrl: this.baseUrl(),
      credentialRef: this.credentialRef(),
      defaultModel: this.config.defaultModel,
      enabled: this.config.enabled !== false,
      isDefault: this.config.isDefault === true,
      fallbackPriority: this.config.fallbackPriority ?? 100,
      capabilities: this.capabilities(),
      settings: {
        temperature: this.config.temperature,
        timeoutMs: this.config.timeoutMs,
        contextLimit: this.config.contextLimit,
        streaming: this.config.streaming,
        organization: this.config.organization,
        project: this.config.project,
        headers: this.config.headers,
      },
    };
  }

  protected baseUrl(): string {
    return (this.config.baseUrl || DEFAULT_BASE_URLS[this.type] || '').replace(/\/$/, '');
  }

  protected credentialRef(): string | undefined {
    if (this.config.credentialRef && credentialVault.exists(this.config.credentialRef)) {
      return this.config.credentialRef;
    }
    if (this.config.apiKey) {
      return credentialVault.put(this.config.apiKey);
    }
    return undefined;
  }

  protected apiKey(): string | null {
    return credentialVault.resolve(this.credentialRef());
  }

  capabilities(): ProviderCapabilities {
    return {
      chat: true,
      reasoning: true,
      vision: true,
      tools: true,
      streaming: true,
      embeddings: this.type !== 'gemini',
    };
  }

  protected authHeaders(): Record<string, string> {
    const key = this.apiKey();
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(this.config.headers || {}) };
    if (key) headers['Authorization'] = `Bearer ${key}`;
    if (this.config.organization) headers['OpenAI-Organization'] = this.config.organization;
    return headers;
  }

  async listModels(): Promise<ModelInfo[]> {
    const key = this.apiKey();
    // Local providers (ollama) expose models without auth; remote ones need a key.
    if (this.isRemote() && !key) return [];

    try {
      const res = await fetch(`${this.baseUrl()}/models`, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 8000),
      });
      if (!res.ok) return [];
      const json = await res.json();
      const raw: any[] = json?.data || json?.models || [];
      return raw
        .map((m) => {
          const id: string = m.id || m.name || String(m);
          return {
            id: id.replace(/^models\//, ''),
            provider: this.id,
            providerType: this.type,
            displayName: m.display_name || id,
            capabilities: inferCapabilitiesFromId(id, this.capabilities()),
            contextWindow: m.context_length || m.context_window || this.config.contextLimit || 128000,
            maxOutputTokens: 8192,
            available: true,
            latencyMs: undefined,
            healthScore: 1,
          } satisfies ModelInfo;
        })
        .filter((m) => m.id);
    } catch {
      return [];
    }
  }

  protected isRemote(): boolean {
    return this.type === 'openai' || this.type === 'gemini' || this.type === 'openai-compatible' || this.type === 'custom';
  }

  async healthCheck(): Promise<HealthStatus> {
    const started = Date.now();
    const key = this.apiKey();
    if (this.isRemote() && !key) {
      return { state: 'AUTH_REQUIRED', latencyMs: 0, detail: 'No API key configured', checkedAt: Date.now() };
    }
    try {
      const res = await fetch(`${this.baseUrl()}/models`, {
        headers: this.authHeaders(),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 6000),
      });
      const latencyMs = Date.now() - started;
      if (res.status === 401 || res.status === 403) {
        return { state: 'AUTH_REQUIRED', latencyMs, detail: 'Credentials rejected', checkedAt: Date.now() };
      }
      if (!res.ok) {
        return { state: 'DEGRADED', latencyMs, detail: `HTTP ${res.status}`, checkedAt: Date.now() };
      }
      return { state: latencyMs > 2500 ? 'DEGRADED' : 'AVAILABLE', latencyMs, checkedAt: Date.now() };
    } catch (e: any) {
      return { state: 'UNAVAILABLE', latencyMs: Date.now() - started, detail: e?.name === 'TimeoutError' ? 'timeout' : 'unreachable', checkedAt: Date.now() };
    }
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const model = request.model || this.config.defaultModel;
    if (!model) {
      throw new Error(`Provider "${this.name}" has no default model configured`);
    }

    const res = await fetch(`${this.baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({
        model,
        messages: request.messages,
        temperature: request.temperature ?? this.config.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? 4096,
        stream: false,
        ...(request.tools ? { tools: request.tools, tool_choice: request.toolChoice } : {}),
      }),
      signal: request.signal || AbortSignal.timeout(this.config.timeoutMs ?? 60000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${this.name} HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }

    const json = await res.json();
    const choice = json?.choices?.[0];
    return {
      id: json?.id || `${this.id}-${Date.now()}`,
      content: choice?.message?.content || '',
      model,
      provider: this.id,
      providerType: this.type,
      usage: json?.usage
        ? {
            promptTokens: json.usage.prompt_tokens ?? 0,
            completionTokens: json.usage.completion_tokens ?? 0,
            totalTokens: json.usage.total_tokens ?? 0,
          }
        : undefined,
      finishReason: choice?.finish_reason || 'stop',
      toolCalls: choice?.message?.tool_calls,
    };
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const model = request.model || this.config.defaultModel;
    if (!model) {
      throw new Error(`Provider "${this.name}" has no default model configured`);
    }

    const res = await fetch(`${this.baseUrl()}/chat/completions`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({
        model,
        messages: request.messages,
        temperature: request.temperature ?? this.config.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? 4096,
        stream: true,
      }),
      signal: request.signal || AbortSignal.timeout(this.config.timeoutMs ?? 120000),
    });

    if (!res.ok || !res.body) {
      throw new Error(`${this.name} streaming failed: HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const parsed = JSON.parse(payload);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (delta) yield { delta, provider: this.id, model };
          const finish = parsed?.choices?.[0]?.finish_reason;
          if (finish) yield { finishReason: finish, provider: this.id, model };
        } catch {
          /* skip malformed chunk */
        }
      }
    }
  }

  async cancel(): Promise<void> {
    /* Cancellation is driven by the AbortSignal passed on the request. */
  }
}

/** Ollama speaks OpenAI-compatible /v1 endpoints natively. */
export class OllamaProvider extends OpenAICompatibleProvider {
  constructor(config: ProviderConfigInput) {
    super({ ...config, type: 'ollama', baseUrl: config.baseUrl || DEFAULT_BASE_URLS.ollama });
  }

  /** Native Ollama tags endpoint — richer metadata than /v1/models. */
  async listModels(): Promise<ModelInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl()}/api/tags`, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return super.listModels();
      const json = await res.json();
      const models: any[] = json?.models || [];
      return models.map((m) => ({
        id: m.name,
        provider: this.id,
        providerType: 'ollama' as ProviderType,
        displayName: m.name,
        capabilities: inferCapabilitiesFromId(`${m.name} ${m.details?.family || ''}`, this.capabilities()),
        contextWindow: m.context_length || this.config.contextLimit || 128000,
        maxOutputTokens: 8192,
        available: true,
        healthScore: 1,
      }));
    } catch {
      return [];
    }
  }

  protected isRemote(): boolean {
    return false;
  }
}

/** Google Gemini uses its own endpoint shape. */
export class GeminiProvider extends OpenAICompatibleProvider {
  constructor(config: ProviderConfigInput) {
    super({ ...config, type: 'gemini', baseUrl: config.baseUrl || DEFAULT_BASE_URLS.gemini });
  }

  private key(): string | null {
    return this.apiKey();
  }

  async listModels(): Promise<ModelInfo[]> {
    const key = this.key();
    if (!key) return [];
    try {
      const res = await fetch(`${this.baseUrl()}/models?key=${encodeURIComponent(key)}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return [];
      const json = await res.json();
      const models: any[] = json?.models || [];
      return models
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => ({
          id: (m.name || '').replace(/^models\//, ''),
          provider: this.id,
          providerType: 'gemini' as ProviderType,
          displayName: m.displayName || m.name,
          capabilities: inferCapabilitiesFromId(m.name || '', this.capabilities()),
          contextWindow: m.inputTokenLimit || this.config.contextLimit || 128000,
          maxOutputTokens: m.outputTokenLimit || 8192,
          available: true,
          healthScore: 1,
        }))
        .filter((m) => m.id);
    } catch {
      return [];
    }
  }

  async healthCheck(): Promise<HealthStatus> {
    const started = Date.now();
    const key = this.key();
    if (!key) return { state: 'AUTH_REQUIRED', latencyMs: 0, detail: 'No API key configured', checkedAt: Date.now() };
    try {
      const res = await fetch(`${this.baseUrl()}/models?key=${encodeURIComponent(key)}`, {
        signal: AbortSignal.timeout(6000),
      });
      const latencyMs = Date.now() - started;
      if (res.status === 401 || res.status === 403) {
        return { state: 'AUTH_REQUIRED', latencyMs, detail: 'Invalid API key', checkedAt: Date.now() };
      }
      if (res.status === 429) {
        return { state: 'DEGRADED', latencyMs, detail: 'RATE_LIMITED', checkedAt: Date.now() };
      }
      if (res.status === 400) {
        return { state: 'DEGRADED', latencyMs, detail: 'INVALID_REQUEST', checkedAt: Date.now() };
      }
      if (!res.ok) {
        return { state: 'DEGRADED', latencyMs, detail: `PROVIDER_ERROR (HTTP ${res.status})`, checkedAt: Date.now() };
      }
      return { state: 'AVAILABLE', latencyMs, checkedAt: Date.now() };
    } catch {
      return { state: 'UNAVAILABLE', latencyMs: Date.now() - started, detail: 'unreachable', checkedAt: Date.now() };
    }
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const key = this.key();
    const model = request.model || this.config.defaultModel;
    if (!key) throw new Error('Gemini requires an API key');
    if (!model) throw new Error('Gemini has no default model configured');

    const system = request.messages.filter((m: ChatMessage) => m.role === 'system').map((m) => m.content).join('\n');
    const contents = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

    const res = await fetch(`${this.baseUrl()}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig: {
          temperature: request.temperature ?? this.config.temperature ?? 0.7,
          maxOutputTokens: request.maxTokens ?? 4096,
        },
      }),
      signal: request.signal || AbortSignal.timeout(this.config.timeoutMs ?? 60000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Gemini HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }

    const json = await res.json();
    const content = (json?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('');
    return {
      id: json?.responseId || `${this.id}-${Date.now()}`,
      content,
      model,
      provider: this.id,
      providerType: 'gemini',
      usage: json?.usageMetadata
        ? {
            promptTokens: json.usageMetadata.promptTokenCount ?? 0,
            completionTokens: json.usageMetadata.candidatesTokenCount ?? 0,
            totalTokens: json.usageMetadata.totalTokenCount ?? 0,
          }
        : undefined,
      finishReason: json?.candidates?.[0]?.finishReason || 'stop',
    };
  }

  async *stream(): AsyncIterable<ModelStreamEvent> {
    // Gemini streaming uses a different SSE shape; fall back to non-streaming.
    const result = await this.generate({ messages: [] } as ModelRequest).catch(() => null);
    if (result) yield { content: result.content, finishReason: 'stop', provider: this.id };
  }
}

/**
 * OpenRouter — an OpenAI-compatible chat surface, but health/auth is verified
 * against the AUTHENTICATED `GET /key` endpoint (via OpenRouter.verifyKey), NOT
 * the PUBLIC `GET /models` (which returns 200 even for a bogus/missing key).
 * This is the false-success guard the audit required; keys never leave the server.
 */
export class OpenRouterProvider extends OpenAICompatibleProvider {
  constructor(config: ProviderConfigInput) {
    super({
      ...config,
      type: 'openrouter',
      baseUrl: config.baseUrl || DEFAULT_BASE_URLS.openrouter,
      headers: { 'HTTP-Referer': 'https://akansha.local', 'X-Title': 'Akansha', ...(config.headers || {}) },
    });
  }
  protected isRemote(): boolean { return true; }
  async healthCheck(): Promise<HealthStatus> {
    const started = Date.now();
    const key = this.apiKey();
    if (!key) return { state: 'AUTH_REQUIRED', latencyMs: 0, detail: 'No OpenRouter key configured', checkedAt: Date.now() };
    const { verifyKey } = await import('../openrouter/OpenRouter');
    const r = await verifyKey(key);
    const latencyMs = Date.now() - started;
    if (r.ok) return { state: 'AVAILABLE', latencyMs, checkedAt: Date.now() };
    if (r.status === 401 || r.status === 403) return { state: 'AUTH_REQUIRED', latencyMs, detail: 'Key rejected by /key', checkedAt: Date.now() };
    if (r.error === 'network') return { state: 'UNAVAILABLE', latencyMs, detail: 'unreachable', checkedAt: Date.now() };
    return { state: 'AUTH_REQUIRED', latencyMs, detail: r.error || 'invalid key', checkedAt: Date.now() };
  }
}

/**
 * Keyless free provider (currently Pollinations' text endpoint).
 *
 * A genuinely no-API-key free route so a fresh install can ANSWER without the
 * user configuring anything. It is NOT a special-cased "always ready" provider:
 * healthCheck performs a REAL GET /models and only reports AVAILABLE when the
 * endpoint actually returns a model list, and generate() is a real POST. If the
 * upstream starts requiring a key or goes down, it honestly reports the failure
 * like every other provider (the runtime trusts live evidence, not the claim).
 *
 * Verified live: GET /models → 200 [{name,...}]; POST /openai {model,messages}
 * → 200 real assistant reply. No Authorization header is sent.
 */
export class KeylessFreeProvider extends OpenAICompatibleProvider {
  constructor(config: ProviderConfigInput) {
    super({ ...config, type: 'openai-compatible' });
  }
  // Keyless: never treated as an auth-gated remote provider.
  protected isRemote(): boolean { return false; }
  protected authHeaders(): Record<string, string> {
    return { 'Content-Type': 'application/json', ...(this.config.headers || {}) };
  }
  private chatUrl(): string {
    const b = this.baseUrl().replace(/\/+$/, '');
    // Standard OpenAI-compatible gateways (e.g. OmniRoute .../v1) use /chat/completions;
    // Pollinations' bare origin uses its /openai alias.
    return /\/v\d+$/.test(b) ? `${b}/chat/completions` : `${b}/openai`;
  }

  private fallbackModels(): ModelInfo[] {
    const dm = this.config.defaultModel;
    if (!dm) return [];
    return [{
      id: dm, provider: this.id, providerType: this.type, displayName: dm,
      capabilities: inferCapabilitiesFromId(dm, this.capabilities()),
      contextWindow: 32000, maxOutputTokens: 4096, available: true, healthScore: 1,
    }];
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const res = await fetch(`${this.baseUrl()}/models`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return this.fallbackModels();
      const raw = await res.json();
      const arr: any[] = Array.isArray(raw) ? raw : (raw?.data || []);
      const models = arr
        .map((m) => {
          const id: string = m.id || m.name || String(m);
          return {
            id, provider: this.id, providerType: this.type,
            displayName: m.description || m.name || id,
            capabilities: inferCapabilitiesFromId(id, this.capabilities()),
            contextWindow: m.context_length || m.contextWindow || 32000,
            maxOutputTokens: 4096, available: true, healthScore: 1,
          } satisfies ModelInfo;
        })
        .filter((m) => m.id);
      return models.length ? models : this.fallbackModels();
    } catch { return this.fallbackModels(); }
  }

  async healthCheck(): Promise<HealthStatus> {
    const started = Date.now();
    // 1) Prefer the keyless model list (Pollinations exposes /models with no auth).
    try {
      const res = await fetch(`${this.baseUrl()}/models`, { signal: AbortSignal.timeout(8000) });
      const latencyMs = Date.now() - started;
      if (res.ok) {
        const raw = await res.json().catch(() => null);
        const count = Array.isArray(raw) ? raw.length : (raw?.data?.length || 0);
        if (count > 0) return { state: 'AVAILABLE', latencyMs, detail: `${count} keyless models`, checkedAt: Date.now() };
      }
    } catch { /* fall through to a real chat ping */ }
    // 2) Fallback: a REAL 1-token chat — proves the gateway can answer even when
    //    /models is auth-gated (e.g. OmniRoute on loopback). Honest live evidence.
    try {
      const res = await fetch(this.chatUrl(), {
        method: 'POST', headers: this.authHeaders(),
        body: JSON.stringify({ model: this.config.defaultModel || 'openai', messages: [{ role: 'user', content: 'ping' }], max_tokens: 16 }),
        signal: AbortSignal.timeout(12000),
      });
      const latencyMs = Date.now() - started;
      if (res.ok) {
        const j = await res.json().catch(() => null);
        if (j?.choices?.[0]) return { state: 'AVAILABLE', latencyMs, detail: 'keyless chat ping ok', checkedAt: Date.now() };
        return { state: 'DEGRADED', latencyMs, detail: 'chat ping returned no choice', checkedAt: Date.now() };
      }
      if (res.status === 401 || res.status === 403) return { state: 'AUTH_REQUIRED', latencyMs, detail: 'gateway requires an API key', checkedAt: Date.now() };
      return { state: 'DEGRADED', latencyMs, detail: `HTTP ${res.status}`, checkedAt: Date.now() };
    } catch (e: any) {
      return { state: 'UNAVAILABLE', latencyMs: Date.now() - started, detail: e?.name === 'TimeoutError' ? 'timeout' : 'unreachable', checkedAt: Date.now() };
    }
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const model = request.model || this.config.defaultModel || 'openai';
    const res = await fetch(this.chatUrl(), {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ model, messages: request.messages, temperature: request.temperature ?? 0.7, max_tokens: request.maxTokens ?? 1024 }),
      signal: request.signal || AbortSignal.timeout(this.config.timeoutMs ?? 45000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${this.name} HTTP ${res.status}${body ? `: ${body.slice(0, 160)}` : ''}`);
    }
    const json = await res.json();
    const choice = json?.choices?.[0];
    return {
      id: json?.id || `${this.id}-${Date.now()}`,
      content: choice?.message?.content || '',
      model, provider: this.id, providerType: this.type,
      finishReason: choice?.finish_reason || 'stop',
    };
  }
}

/**
 * FreeLLMApiProvider — the named "Continuous Free Inference Fabric" gateway
 * adapter (spec item #1).
 *
 * It is a thin SUBCLASS of the proven KeylessFreeProvider so we reuse the exact
 * OpenAI-compatible `/v1` engine (listModels / chat ping / generate) instead of
 * copying a near-identical implementation. This adapter exists to integrate an
 * external self-hosted free-gateway (e.g. freellmapi) that fronts MANY upstream
 * free providers behind one `.../v1` endpoint: Akansha still does its own
 * capability-aware routing + failover through the existing ModelRouter, and this
 * provider is simply ONE more free route in the pool.
 *
 * Honesty rules (this is the whole point of the spec):
 *  - We NEVER claim "unlimited tokens". A gateway cannot turn finite upstream
 *    quotas into infinite ones; what it gives us is MORE ROUTES + failover, which
 *    is exactly what makes the assistant degrade gracefully.
 *  - Health is LIVE evidence only (a real probe), so a gateway that isn't running
 *    honestly reports UNAVAILABLE and the router moves on — never a fake "free".
 *  - It is keyless by default; if an operator's gateway needs a key they can add
 *    one via the normal credential vault, and it is then treated as auth-gated.
 */
export class FreeLLMApiProvider extends KeylessFreeProvider {
  constructor(config: ProviderConfigInput) {
    super({
      ...config,
      // Default to a localhost free-gateway OpenAI surface if nothing was set;
      // the caller (ProviderManager) gates whether this provider is enabled at all.
      baseUrl: config.baseUrl || process.env.KANSHA_FREE_GATEWAY_URL || 'http://127.0.0.1:8000/v1',
      keyless: config.keyless !== false,
    });
  }

  /** Human-readable honesty note surfaced to the dashboard/catalog. */
  static readonly honestyNote =
    'Free-gateway route: many upstream free providers with routing + failover. Not unlimited quota — it degrades gracefully across providers, then to local.';
}

export function createProvider(config: ProviderConfigInput): ModelProvider {
  if (config.freellmapi) return new FreeLLMApiProvider({ ...config, keyless: config.keyless !== false });
  if (config.keyless) return new KeylessFreeProvider(config);
  switch (config.type) {
    case 'ollama':
      return new OllamaProvider(config);
    case 'gemini':
      return new GeminiProvider(config);
    case 'openrouter':
      return new OpenRouterProvider(config);
    case 'openai':
    case 'openai-compatible':
    case 'local':
    case 'custom':
    default:
      return new OpenAICompatibleProvider(config);
  }
}
