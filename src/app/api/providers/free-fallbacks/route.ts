import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { providerManager } from '@/core/providers/ProviderManager';
import { FREE_PROVIDER_CATALOG } from '@/core/providers/freeProviderCatalog';

export const dynamic = 'force-dynamic';

/**
 * POST /api/providers/free-fallbacks — the user's ONE-CLICK "second default":
 * enables the catalog providers documented as needing NO API key (Kilo's
 * kilo-auto/free auto-router, LLM7 anonymous, OVHcloud anonymous EU endpoints)
 * as additional routing candidates. When paid/quota-limited providers run dry
 * (429 / AUTH errors), the existing ModelRouter fallback chain automatically
 * flows to these — no code path bypasses the router.
 *
 * Explicit user action only (never enabled silently); each provider is then
 * health-checked for real, and honest per-provider results are returned.
 */
const KEYLESS_IDS = ['kilo', 'llm7', 'ovhcloud'];

export async function POST(request: Request) {
  const guard = authorize(request, 'sensitive');
  if (!guard.ok) return guard.response;
  try {
    const results: { providerId: string; name: string; ok: boolean; health?: string; error?: string }[] = [];
    for (const id of KEYLESS_IDS) {
      const p = FREE_PROVIDER_CATALOG.providers.find((x) => x.providerId === id);
      if (!p || p.openAiCompatible !== true) {
        results.push({ providerId: id, name: p?.displayName || id, ok: false, error: 'not documented as OpenAI-compatible' });
        continue;
      }
      try {
        await providerManager.addProvider({
          id: p.providerId, name: p.displayName, type: 'openai-compatible',
          baseUrl: p.baseUrl, defaultModel: p.models[0]?.name, enabled: true,
          fallbackPriority: 35, // free tier: before paid OpenRouter routes, after local
        } as never);
        const t = await providerManager.testProvider(p.providerId);
        results.push({ providerId: p.providerId, name: p.displayName, ok: true, health: t.health.state });
      } catch (e: any) {
        results.push({ providerId: p.providerId, name: p.displayName, ok: false, error: String(e?.message || e).slice(0, 120) });
      }
    }
    return NextResponse.json({ ok: true, results });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'enable failed' }, { status: 500 });
  }
}
