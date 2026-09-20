/**
 * Free LLM provider catalog — NORMALIZED metadata derived from the community
 * reference repository "mnfst/awesome-free-llm-apis" (a CATALOG SOURCE, not
 * executable code and not an orchestrator). Every field below was transcribed
 * from the repository README at the pinned revision; anything the source does
 * not document stays undefined (UNKNOWN) — never invented.
 *
 * This module is DATA + types only. Providers are connected, stored, verified
 * and routed EXCLUSIVELY by the existing ProviderManager → CredentialVault →
 * ModelRouter → costPolicy chain. Nothing here bypasses them, and no provider
 * is enabled automatically: the user must explicitly connect each one (§19).
 *
 * "Free tier" never means unlimited: documented rate limits and usage
 * restrictions are carried verbatim and MUST be surfaced by the UI.
 */

export interface CatalogModelEntry {
  name: string;
  context?: string;        // as documented (e.g. '128K') — raw, not parsed
  maxOutput?: string;
  modality?: string;
  rateLimit?: string;
}

export interface FreeProviderEntry {
  providerId: string;
  displayName: string;
  category: 'provider-api' | 'inference-provider';
  baseUrl: string;
  apiKeyUrl?: string;
  openAiCompatible?: boolean;      // only when DOCUMENTED (text or /openai/ URL); else undefined
  requiresKey: boolean | 'unknown';
  freeTier?: string;               // documented wording
  restrictions?: string[];         // documented caveats (verification, retirement, regions…)
  models: CatalogModelEntry[];
  sourceUrl: string;               // provider's own page as listed upstream
}

export const FREE_PROVIDER_CATALOG = {
  source: 'mnfst/awesome-free-llm-apis',
  sourceUrl: 'https://github.com/mnfst/awesome-free-llm-apis',
  sourceRevision: '167013ff729e30f3a92bb8d416062d6c34a84507',
  sourceRevisionDate: '2026-08-21T05:32:47Z',
  checkedAt: 1789898736000, // fetch time of the pinned README (2026-09-20, Asia/Kolkata)
  attribution: 'Provider information sourced from mnfst/awesome-free-llm-apis (community catalog). Akansha does not operate these providers; the catalog does not grant access; limits are the providers\' own.',
  providers: [
    {
      providerId: 'aion-labs', displayName: 'Aion Labs', category: 'provider-api',
      baseUrl: 'https://api.aionlabs.ai/v1', apiKeyUrl: 'https://www.aionlabs.ai/app/api-keys/',
      requiresKey: true,
      models: [
        { name: 'aion-labs/aion-2.0', context: '128K', maxOutput: '32K', modality: 'Text (reasoning)', rateLimit: '15 RPM, 20K TPD' },
        { name: 'aion-labs/aion-rp-llama-3.1-8b', context: '32K', maxOutput: '32K', modality: 'Text', rateLimit: '15 RPM, 20K TPD' },
        { name: 'aion-labs/aion-3.0', context: '128K', maxOutput: '32K', modality: 'Text (reasoning)', rateLimit: '15 RPM, 20K TPD' },
        { name: 'aion-labs/aion-3.0-mini', context: '128K', maxOutput: '32K', modality: 'Text (reasoning)', rateLimit: '15 RPM, 20K TPD' },
      ],
      sourceUrl: 'https://www.aionlabs.ai/app/api-keys/',
    },
    {
      providerId: 'cohere', displayName: 'Cohere', category: 'provider-api',
      baseUrl: 'https://api.cohere.com/v2', apiKeyUrl: 'https://dashboard.cohere.com/api-keys',
      requiresKey: true,
      models: [
        { name: 'Command A+ (218B)', context: '128K', maxOutput: '64K', modality: 'Text + Image', rateLimit: '20 RPM' },
        { name: 'Command A (111B)', context: '256K', maxOutput: '8K', modality: 'Text', rateLimit: '20 RPM' },
        { name: 'Command R+', context: '128K', maxOutput: '4K', modality: 'Text', rateLimit: '20 RPM' },
        { name: 'Command R7B', context: '128K', maxOutput: '4K', modality: 'Text', rateLimit: '20 RPM' },
        { name: 'Command A Vision', context: '128K', maxOutput: '8K', modality: 'Text + Image', rateLimit: '20 RPM' },
        { name: 'Aya Vision 32B', context: '16K', maxOutput: '4K', modality: 'Text + Image', rateLimit: '20 RPM' },
      ],
      sourceUrl: 'https://dashboard.cohere.com/api-keys',
    },
    {
      providerId: 'google-gemini', displayName: 'Google Gemini', category: 'provider-api',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKeyUrl: 'https://aistudio.google.com/app/apikey',
      requiresKey: true,
      models: [
        { name: 'Gemini 3.7 Flash', context: '1M', maxOutput: '65K', modality: 'Text + Image + Audio + Video' },
        { name: 'Gemini 3.6 Flash', context: '1M', maxOutput: '65K', modality: 'Text + Image + Audio + Video', rateLimit: '15 RPM, 1,500 RPD' },
        { name: 'Gemini 3.5 Flash-Lite', context: '1M', maxOutput: '65K', modality: 'Text + Image + Audio + Video', rateLimit: '30 RPM, 1,500 RPD' },
        { name: 'Gemini 2.5 Pro', context: '1M', maxOutput: '65K', modality: 'Text + Image + Audio + Video', rateLimit: '5 RPM, 50 RPD' },
        { name: 'Gemma 4 31B', context: '256K', maxOutput: '32K', modality: 'Text' },
      ],
      sourceUrl: 'https://aistudio.google.com/app/apikey',
    },
    {
      providerId: 'mistral', displayName: 'Mistral AI', category: 'provider-api',
      baseUrl: 'https://api.mistral.ai/v1', apiKeyUrl: 'https://console.mistral.ai/api-keys',
      requiresKey: true,
      models: [
        { name: 'Mistral Medium 3.5 (128B)', context: '256K', modality: 'Text + Image + Code', rateLimit: '~1 RPS, 500K TPM' },
        { name: 'Mistral Small 4', context: '256K', modality: 'Text + Image + Code', rateLimit: '~1 RPS, 500K TPM' },
        { name: 'Codestral', context: '128K', modality: 'Code', rateLimit: '~1 RPS, 500K TPM' },
        { name: 'Ministral 3 8B', context: '256K', modality: 'Text + Vision', rateLimit: '~1 RPS, 500K TPM' },
      ],
      sourceUrl: 'https://console.mistral.ai/api-keys',
    },
    {
      providerId: 'z-ai', displayName: 'Z AI (Zhipu AI)', category: 'provider-api',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKeyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
      requiresKey: true,
      restrictions: ['GLM-4.5-Flash: retirement announced by the source'],
      models: [
        { name: 'GLM-4.7-Flash', context: '200K', maxOutput: '128K', modality: 'Text (reasoning)', rateLimit: '1 concurrent request' },
        { name: 'GLM-4.6V-Flash', context: '128K', maxOutput: '32K', modality: 'Multimodal', rateLimit: '1 concurrent request' },
      ],
      sourceUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    },
    {
      providerId: 'cloudflare-workers-ai', displayName: 'Cloudflare Workers AI', category: 'inference-provider',
      baseUrl: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run', apiKeyUrl: 'https://dash.cloudflare.com/profile/api-tokens',
      openAiCompatible: false, // documented as its own endpoint shape (account-scoped /ai/run)
      requiresKey: true,
      freeTier: '10K neurons/day (shared across models)',
      models: [
        { name: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', context: '24K', modality: 'Text', rateLimit: '10K neurons/day (shared)' },
        { name: '@cf/meta/llama-4-scout-17b-16e-instruct', context: '131K', modality: 'Multimodal', rateLimit: '10K neurons/day (shared)' },
        { name: '@cf/openai/gpt-oss-120b', context: '128K', modality: 'Text', rateLimit: '10K neurons/day (shared)' },
      ],
      sourceUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    },
    {
      providerId: 'groq', displayName: 'Groq', category: 'inference-provider',
      baseUrl: 'https://api.groq.com/openai/v1', apiKeyUrl: 'https://console.groq.com/keys',
      openAiCompatible: true, // documented by the /openai/v1 endpoint family
      requiresKey: true,
      models: [
        { name: 'openai/gpt-oss-120b', context: '131K', maxOutput: '65K', modality: 'Text', rateLimit: '30 RPM, 1,000 RPD' },
        { name: 'openai/gpt-oss-20b', context: '131K', maxOutput: '65K', modality: 'Text', rateLimit: '30 RPM, 1,000 RPD' },
        { name: 'qwen/qwen3.6-27b', context: '131K', maxOutput: '16K', modality: 'Text', rateLimit: '30 RPM, 1,000 RPD' },
      ],
      sourceUrl: 'https://console.groq.com/keys',
    },
    {
      providerId: 'huggingface', displayName: 'Hugging Face Inference', category: 'inference-provider',
      baseUrl: 'https://router.huggingface.co/v1', apiKeyUrl: 'https://huggingface.co/settings/tokens',
      requiresKey: true,
      freeTier: '$0.10/month Inference Provider credits for free users (subject to change); routes to Fireworks, Together, Hyperbolic, Nebius, Novita, DeepInfra and others',
      models: [
        { name: 'Meta-Llama-3.1-8B-Instruct', context: '128K', maxOutput: '~4K', modality: 'Text', rateLimit: 'Credit-metered' },
        { name: 'Qwen2.5-Coder-7B-Instruct', context: '131K', maxOutput: '~4K', modality: 'Text', rateLimit: 'Credit-metered' },
      ],
      sourceUrl: 'https://huggingface.co/settings/tokens',
    },
    {
      providerId: 'kilo', displayName: 'Kilo Code', category: 'inference-provider',
      baseUrl: 'https://api.kilo.ai/api/gateway', apiKeyUrl: 'https://app.kilo.ai/profile',
      requiresKey: false,
      freeTier: 'Free models with no credit card and no API key required; kilo-auto/free auto-router dynamically routes to the free pool',
      models: [
        { name: 'kilo-auto/free', modality: 'Text (auto-router)', rateLimit: '200 req/hr' },
        { name: 'nvidia/nemotron-3-ultra-550b-a55b:free', context: '1M', maxOutput: '65K', modality: 'Text', rateLimit: '200 req/hr' },
        { name: 'poolside/laguna-s-2.1:free', context: '262K', maxOutput: '32K', modality: 'Text (code)', rateLimit: '200 req/hr' },
      ],
      sourceUrl: 'https://app.kilo.ai/profile',
    },
    {
      providerId: 'llm7', displayName: 'LLM7.io', category: 'inference-provider',
      baseUrl: 'https://api.llm7.io/v1', apiKeyUrl: 'https://token.llm7.io',
      requiresKey: false,
      freeTier: 'Anonymous access needs no key (turbo models); a free token raises limits on the same models',
      models: [
        { name: 'gpt-oss:20b', context: '128K', modality: 'Text', rateLimit: '10 RPM, 60 req/hr (anonymous)' },
        { name: 'mistral-Nemo-Instruct-2407', context: '128K', modality: 'Text', rateLimit: '10 RPM, 60 req/hr (anonymous)' },
      ],
      sourceUrl: 'https://token.llm7.io',
    },
    {
      providerId: 'nvidia-nim', displayName: 'NVIDIA NIM', category: 'inference-provider',
      baseUrl: 'https://integrate.api.nvidia.com/v1', apiKeyUrl: 'https://build.nvidia.com/explore/discover',
      requiresKey: true,
      freeTier: 'Free with NVIDIA Developer Program membership; 100+ models; rate-limited per model',
      restrictions: ['Session/weekly limits unpublished by the source'],
      models: [
        { name: 'deepseek-v4-pro', context: '1M', modality: 'Text', rateLimit: 'Session/weekly limits (unpublished)' },
        { name: 'gpt-oss:120b', context: '128K', modality: 'Text', rateLimit: 'Session/weekly limits (unpublished)' },
      ],
      sourceUrl: 'https://build.nvidia.com/explore/discover',
    },
    {
      providerId: 'openrouter', displayName: 'OpenRouter', category: 'inference-provider',
      baseUrl: 'https://openrouter.ai/api/v1', apiKeyUrl: 'https://openrouter.ai/keys',
      openAiCompatible: true, // documented: "OpenAI SDK-compatible"
      requiresKey: true,
      freeTier: '17 free models (:free suffix); auto-routing available',
      models: [
        { name: 'openai/gpt-oss-20b:free', context: '131K', maxOutput: '32K', modality: 'Text', rateLimit: '20 RPM, 50 RPD' },
        { name: 'google/gemma-4-26b-a4b-it:free', context: '262K', maxOutput: '32K', modality: 'Text + Image', rateLimit: '20 RPM, 50 RPD' },
        { name: 'openrouter/auto', modality: 'Text (auto-router)' },
      ],
      sourceUrl: 'https://openrouter.ai/keys',
    },
    {
      providerId: 'ovhcloud', displayName: 'OVHcloud AI Endpoints', category: 'inference-provider',
      baseUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', apiKeyUrl: 'https://www.ovhcloud.com/en/public-cloud/ai-endpoints/catalog/',
      openAiCompatible: true, // documented: "OpenAI SDK-compatible"
      requiresKey: false,
      freeTier: 'Free anonymous tier (no API key, no signup): 2 RPM per IP per model; 20+ open-weight models hosted in EU',
      models: [
        { name: 'gpt-oss-120b', context: '128K', maxOutput: '~32K', modality: 'Text', rateLimit: '2 RPM (anonymous)' },
        { name: 'Qwen3-Coder-30B-A3B-Instruct', context: '262K', maxOutput: '~32K', modality: 'Text (code)', rateLimit: '2 RPM (anonymous)' },
        { name: 'Qwen2.5-VL-72B-Instruct', context: '128K', maxOutput: '~8K', modality: 'Text + Vision', rateLimit: '2 RPM (anonymous)' },
      ],
      sourceUrl: 'https://www.ovhcloud.com/en/public-cloud/ai-endpoints/catalog/',
    },
    {
      providerId: 'siliconflow', displayName: 'SiliconFlow', category: 'inference-provider',
      baseUrl: 'https://api.siliconflow.cn/v1', apiKeyUrl: 'https://cloud.siliconflow.cn/account/ak',
      requiresKey: true,
      freeTier: 'Permanently free models, no credit card required',
      restrictions: ['Identity verification required', 'Most of the 100+ catalog models are paid'],
      models: [
        { name: 'Qwen/Qwen3-8B', context: '128K', modality: 'Text', rateLimit: '1,000 RPM, 50,000 TPM' },
      ],
      sourceUrl: 'https://cloud.siliconflow.cn/account/ak',
    },
    {
      providerId: 'modelscope', displayName: 'ModelScope', category: 'inference-provider',
      baseUrl: 'https://api-inference.modelscope.cn/v1', apiKeyUrl: 'https://modelscope.cn/my/myaccesstoken',
      requiresKey: true,
      freeTier: 'Free API-Inference for registered users',
      restrictions: ['Requires Alibaba Cloud account binding + real-name verification'],
      models: [
        { name: 'Qwen/Qwen3.5-35B-A3B', context: '256K', modality: 'Text', rateLimit: '2,000 RPD total; <=500 RPD/model (dynamic)' },
      ],
      sourceUrl: 'https://modelscope.cn/my/myaccesstoken',
    },
  ] as FreeProviderEntry[],
};

export type FreeProviderCatalog = typeof FREE_PROVIDER_CATALOG;

/** Providers whose docs say they speak the OpenAI wire format (undefined = unknown). */
export function openAiCompatibleEntries(catalog: FreeProviderCatalog = FREE_PROVIDER_CATALOG): FreeProviderEntry[] {
  return catalog.providers.filter((p) => p.openAiCompatible === true);
}

/** Dedupe guard used by tests + UI: providerIds must be unique. */
export function duplicateProviderIds(catalog: FreeProviderCatalog = FREE_PROVIDER_CATALOG): string[] {
  const seen = new Set<string>(); const dupes = new Set<string>();
  for (const p of catalog.providers) { if (seen.has(p.providerId)) dupes.add(p.providerId); seen.add(p.providerId); }
  return [...dupes];
}
