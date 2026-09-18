import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { detectHardwareLive } from '@/core/runtime/HardwareProbe';
import { loadCatalogForApp } from '@/core/catalog/catalogProvider';
import { detectRuntimes, runtimeFor } from '@/core/runtime/RuntimeManager';
import { evaluate } from '@/core/catalog/CompatibilityEngine';
import { toManifestEntry } from '@/core/catalog/ModelCatalog';
import { initialPipelineState, planNext } from '@/core/catalog/ModelManager';

export const dynamic = 'force-dynamic';

/**
 * POST /api/ai/install { modelId }
 * Drives the EXISTING ModelManager pipeline honestly: it evaluates the real
 * compatibility / storage / runtime gates and returns the true next stage.
 *
 * It performs NO download itself and can NEVER report a model READY from a mere
 * install request — 'ready'/usable only follows a real inference self-test (see
 * ModelManager.recordInference). If no runtime is detected it returns an honest
 * 'runtime' block. This keeps the state machine single-source and unfakeable.
 */
export async function POST(request: Request) {
  const guard = authorize(request, 'sensitive');
  if (!guard.ok) return guard.response;
  try {
    const body = await request.json().catch(() => ({}));
    const modelId = String(body?.modelId || '');
    const catalog = loadCatalogForApp(process.env);
    if (catalog.status !== 'ready') {
      return NextResponse.json({ ok: false, stage: 'idle', blocked: `MODEL CATALOG ${catalog.status.toUpperCase()}`, reasons: catalog.reasons });
    }
    const model = catalog.models.find((m) => m.id === modelId);
    if (!model) return NextResponse.json({ ok: false, stage: 'idle', blocked: 'model-not-in-catalog' }, { status: 404 });

    const hardware = detectHardwareLive();
    const rt = runtimeFor(detectRuntimes(process.env.LLAMA_CPP_PATHS ? { 'llama.cpp': process.env.LLAMA_CPP_PATHS.split(',') } : {}).find((r) => r.adapter.name === 'llama.cpp'));
    const compat = evaluate(model, hardware, { available: rt.available, name: rt.name, supportsAcceleration: rt.supportsAcceleration });
    const state = initialPipelineState(model.id);
    const gate = planNext(state, {
      compat, freeDiskGB: hardware.freeDiskGB, networkAvailable: true, runtimeAvailable: rt.available,
    }, toManifestEntry(model));

    return NextResponse.json({
      ok: gate.action !== 'block',
      modelId: model.id,
      stage: gate.nextStage,
      action: gate.action,
      blocked: gate.blocked ?? null,
      compatibility: { rating: compat.rating, runnable: compat.runnable, reasons: compat.reasons, performanceLabel: compat.performanceLabel },
      usable: false, // NEVER true here — only a real inference self-test flips it
      runtimeAvailable: rt.available,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'install failed' }, { status: 500 });
  }
}
