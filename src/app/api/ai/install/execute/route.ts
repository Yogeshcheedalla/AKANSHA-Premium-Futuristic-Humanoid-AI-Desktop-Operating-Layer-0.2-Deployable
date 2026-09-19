import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { detectHardwareLive } from '@/core/runtime/HardwareProbe';
import { detectRuntimes } from '@/core/runtime/RuntimeManager';
import { loadCatalogForApp } from '@/core/catalog/catalogProvider';
import { toManifestEntry, type CatalogModel } from '@/core/catalog/ModelCatalog';
import { evaluate } from '@/core/catalog/CompatibilityEngine';
import { initialPipelineState, planNext } from '@/core/catalog/ModelManager';
import { provisionAndVerify, type UsableLocalModel } from '@/core/models/local/LocalModelRegistry';
import { downloadArtifactToFile } from '@/core/models/local/downloadArtifact';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // desktop backend only; long by nature (real download + real inference)

/** Where the app keeps artifacts: the app-controlled home, never read-only resources. */
export function modelsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.AKANSHA_HOME ? join(env.AKANSHA_HOME, 'models') : join(process.cwd(), 'data', 'akansha', 'models');
}

/**
 * POST /api/ai/install/execute { modelId }
 * THE execution leg of the EXISTING install pipeline. The planner route
 * (/api/ai/install) decides what is next; this route runs that same next step
 * for real — through the same gates (compatibility/storage/runtime) and the
 * same LocalModelRegistry.provisionAndVerify chain (integrity → GGUF → real
 * llama.cpp inference → measured benchmark → register). It can ONLY report
 * stage 'ready'/usable after a genuine non-empty generation, and it never
 * marks READY on download alone. Desktop path: nothing here runs on Vercel.
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
    const model: CatalogModel | undefined = catalog.models.find((m) => m.id === modelId);
    if (!model) return NextResponse.json({ ok: false, blocked: 'model-not-in-catalog', usable: false }, { status: 404 });
    const entry = toManifestEntry(model);

    // SAME gates as the planner route — this never bypasses the state machine.
    const runtimes = detectRuntimes(process.env.LLAMA_CPP_PATHS ? { 'llama.cpp': process.env.LLAMA_CPP_PATHS.split(',') } : {});
    const llama = runtimes.find((r) => r.adapter.name === 'llama.cpp');
    const hardware = detectHardwareLive();
    const gate = planNext(initialPipelineState(model.id), {
      compat: evaluate(model, hardware, { available: !!llama?.healthy, name: 'llama.cpp', supportsAcceleration: llama?.adapter.supportsAcceleration ?? [] }),
      freeDiskGB: hardware.freeDiskGB, networkAvailable: true, runtimeAvailable: !!llama?.healthy,
    }, entry);
    if (gate.blocked) {
      return NextResponse.json({ ok: false, stage: gate.nextStage, blocked: gate.blocked, usable: false });
    }

    const artifactPath = join(modelsRoot(), entry.id, entry.file);
    let downloaded = false;
    if (!existsSync(artifactPath)) {
      const dl = await downloadArtifactToFile(entry.url, artifactPath, entry.sizeBytes);
      if (!dl.ok) return NextResponse.json({ ok: false, stage: 'download', blocked: 'download-failed:' + dl.reason, usable: false });
      downloaded = true;
    }

    const result = await provisionAndVerify({
      entry,
      artifactPath,
      runtime: llama!.detect,
      prompt: 'Reply with exactly: AKANSHA OFFLINE ORCHESTRATION READY',
      maxTokens: 24,
      timeoutMs: 120000,
    });
    return NextResponse.json({
      ok: result.ok,
      usable: result.usable,
      stage: result.stage,
      blocked: result.ok ? null : result.reason,
      downloaded,
      artifactPath,
      benchmark: result.benchmark ? { genTps: result.benchmark.genTps, promptTps: result.benchmark.promptTps, totalMs: result.benchmark.totalMs, text: (result.benchmark.text || '').slice(0, 120) } : null,
      // Honest ceiling: 'ready' here still means ONLY what provisionAndVerify
      // proved — integrity + one real generation. It is not a promise of
      // quality beyond that measured evidence.
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'execute failed', usable: false }, { status: 500 });
  }
}

export type { UsableLocalModel };
