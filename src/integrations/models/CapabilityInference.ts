import type { ProviderCapabilities } from '../../core/models/ModelProvider';

/**
 * Infer model capabilities from the model identifier and provider defaults.
 * We never hard-code individual models — we classify whatever a provider
 * actually reports as available.
 */
export function inferCapabilitiesFromId(
  modelId: string,
  defaults: ProviderCapabilities
): ProviderCapabilities {
  const id = modelId.toLowerCase();

  // Non-conversational families must never be selected for chat generation.
  const nonChat =
    /embed|bge|m3e|nomic-embed|text-embedding|\bada\b|whisper|transcribe|transcript|\btts\b|speech|audio-?input|moderation|dall|image|\bsd\b|stable-?diffusion|realtime|\bocr\b/.test(id);

  const vision =
    /vision|visual|vl|image|multimodal|omni|gemma.*vision|llava|qwen.*vl|gemini/.test(id);
  const reasoning =
    /reason|think|r1|o1|o3|o4|deepseek|qwq|logic|pro|ultra|opus|max|thinking/.test(id);
  const coding =
    /code|coder|dev|programming|starcoder|codestral|devstral|swe/.test(id);
  const fast =
    /mini|flash|fast|nano|tiny|small|lite|8b|3b|1\.5b|7b|instant|haiku/.test(id);
  const tools =
    /tool|function|agent|instruct|chat|qwen|llama|gpt|claude|gemini|mistral/.test(id);

  return {
    chat: !nonChat,
    reasoning: reasoning || !fast ? true : defaults.reasoning,
    vision: vision || defaults.vision,
    tools: tools || defaults.tools,
    streaming: true,
    embeddings: /embed|bge|m3e|nomic/.test(id) || defaults.embeddings,
  };
}

export function classifyTaskRequirement(
  taskType: string
): { reasoning: boolean; vision: boolean; coding: boolean; fast: boolean } {
  const t = taskType.toLowerCase();
  return {
    reasoning: /reason|research|analy|plan|architect|compare|explain|strateg|decide|debug/.test(t),
    vision: /vision|image|screenshot|screen|photo|ocr|visual/.test(t),
    coding: /cod|develop|refactor|implement|build|program|test|debug/.test(t),
    fast: /chat|convers|greet|small|quick|simple|acknowledge/.test(t),
  };
}
