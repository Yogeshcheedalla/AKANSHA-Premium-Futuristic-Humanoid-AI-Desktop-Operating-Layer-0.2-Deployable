import { NextResponse } from 'next/server';
import { providerManager } from '@/core/providers/ProviderManager';
import { modelRouter } from '@/core/models/ModelRouter';
import { authorize } from '@/core/auth/guard';
import { providerError } from '@/core/providers/providerHttpError';
import type { ProviderType } from '@/core/models/ModelProvider';

export const dynamic = 'force-dynamic';

const VALID_TYPES: ProviderType[] = ['ollama', 'openai', 'gemini', 'openai-compatible', 'openrouter', 'local', 'custom'];

/** List configured providers — secrets are NEVER returned. */
export async function GET(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  try {
    const records = await providerManager.listRecords();
    const registry = modelRouter.getRegistry();
    return NextResponse.json({
      ok: true,
      providers: records.map((r) => ({ ...r, modelsDiscovered: registry.listByProvider(r.providerId).length })),
      policy: modelRouter.getPolicy(),
      modelCount: registry.listAll().length,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}

/** Add a new provider. The API key goes straight into the vault. */
export async function POST(request: Request) {
  const guard = authorize(request, 'admin');
  if (!guard.ok) return guard.response;
  try {
    const body = await request.json();
    const type = body?.type as ProviderType;

    if (!body?.name || !type || !VALID_TYPES.includes(type)) {
      return NextResponse.json({ ok: false, error: 'name and a valid type are required' }, { status: 400 });
    }

    const providerId = (body.providerId || body.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const record = await providerManager.addProvider({
      id: providerId,
      name: body.name,
      type,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      defaultModel: body.defaultModel,
      enabled: body.enabled !== false,
      isDefault: body.isDefault === true,
      fallbackPriority: body.fallbackPriority ?? 100,
      temperature: body.temperature,
      timeoutMs: body.timeoutMs,
      contextLimit: body.contextLimit,
      streaming: body.streaming !== false,
      organization: body.organization,
      project: body.project,
      headers: body.headers,
    });

    return NextResponse.json({ ok: true, provider: { ...record, modelsDiscovered: 0 } });
  } catch (e: any) {
    return providerError(e);
  }
}
