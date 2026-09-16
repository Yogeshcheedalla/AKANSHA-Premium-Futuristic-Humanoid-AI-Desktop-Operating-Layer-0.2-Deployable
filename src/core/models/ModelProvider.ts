/**
 * Universal Model Provider abstraction.
 *
 * The rest of Akansha must NEVER care whether intelligence comes from
 * Ollama, llama.cpp, Gemini, OpenAI, an OpenAI-compatible Base URL, or a
 * custom endpoint. Everything flows through ModelRouter.
 */

export type ProviderType =
  | 'ollama'
  | 'openai'
  | 'gemini'
  | 'openai-compatible'
  | 'openrouter'
  | 'local'
  | 'custom';

export interface ProviderCapabilities {
  chat: boolean;
  reasoning: boolean;
  vision: boolean;
  tools: boolean;
  streaming: boolean;
  embeddings: boolean;
}

export interface ModelInfo {
  id: string;
  provider: string;
  providerType: ProviderType;
  displayName?: string;
  capabilities: ProviderCapabilities;
  contextWindow?: number;
  maxOutputTokens?: number;
  available: boolean;
  latencyMs?: number;
  healthScore?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

export interface ModelRequest {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  tools?: unknown[];
  toolChoice?: unknown;
  signal?: AbortSignal;
}

export interface ModelUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ModelResponse {
  id: string;
  content: string;
  model: string;
  provider: string;
  providerType: ProviderType;
  usage?: ModelUsage;
  finishReason: string;
  toolCalls?: unknown[];
}

export interface ModelStreamEvent {
  delta?: string;
  content?: string;
  finishReason?: string;
  provider?: string;
  model?: string;
}

export interface HealthStatus {
  state: 'AVAILABLE' | 'DEGRADED' | 'UNAVAILABLE' | 'AUTH_REQUIRED' | 'UNKNOWN';
  latencyMs: number;
  detail?: string;
  checkedAt: number;
}

export interface ProviderDescriptor {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl?: string;
  credentialRef?: string;
  defaultModel?: string;
  enabled: boolean;
  isDefault: boolean;
  fallbackPriority: number;
  capabilities: ProviderCapabilities;
  settings: {
    temperature?: number;
    timeoutMs?: number;
    contextLimit?: number;
    streaming?: boolean;
    organization?: string;
    project?: string;
    headers?: Record<string, string>;
  };
}

export interface ModelProvider {
  readonly id: string;
  readonly name: string;
  readonly type: ProviderType;

  descriptor(): ProviderDescriptor;
  capabilities(): ProviderCapabilities;
  healthCheck(): Promise<HealthStatus>;
  listModels(): Promise<ModelInfo[]>;
  generate(request: ModelRequest): Promise<ModelResponse>;
  stream(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
  cancel(requestId: string): Promise<void>;
}
