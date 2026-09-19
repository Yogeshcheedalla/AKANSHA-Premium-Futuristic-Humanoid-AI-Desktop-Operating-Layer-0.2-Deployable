import { NextResponse } from 'next/server';
import { authorize } from '@/core/auth/guard';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { detectHardwareLive } from '@/core/runtime/HardwareProbe';
import { detectRuntimes } from '@/core/runtime/RuntimeManager';
import { loadCatalogForApp } from '@/core/catalog/catalogProvider';
import { toManifestEntry, type CatalogModel } from '@/core/catalog/ModelCatalog';
import { evaluate } from '@/core/catalog/CompatibilityEngine';
import { initialPipelineState, planNext } from '@/core/catalog/ModelManager';
import { provisionAndVerify } from '@/core/models/local/LocalModelRegistry';
import { downloadArtifactToFile } from '@/core/models/local/downloadArtifact';
import { createInstallJob, updateInstallJob, getInstallJob, listInstallJobs, activeJobFor } from '@/core/catalog/installJobs';
import { readUserCatalog } from '@/core/models/local/userCatalog';

export const dynamic = 'force-dynamic';

/** Where the app keeps artifacts: the app-controlled home, never read-only resources. */
export function modelsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.AKANSHA_HOME ? join(env.AKANSHA_HOME, 'models') : join(process.cwd(), 'data', 'akansha', 'models');
}

/**
 * POST /api/ai/install/execute { modelId }
 * Starts a REAL install JOB through the EXISTING gates (compatibility/storage/
 * runtime via planNext) and the EXISTING provisionAndVerify chain (download →
 * SHA-256+GGUF integrity → real llama.cpp inference → measured benchmark →
 * register). Returns 202 + jobId immediately; progress and truth live in the
 * job (GET the same path; cancel via /api/ai/install/execute/[jobId]/cancel).
 * A cancelled job can NEVER become READY; partial downloads are deleted, never
 * left behind to masquerade as the artifact.
 */
export async function POST(request: Request) {
  const guard = authorize(request, 'sensitive');
  if (!guard.ok) return guard.response;
  try {
    const body = await request.json().catch(() => ({}));
    const modelId = String(body?.modelId || '');
    const catalog = loadCatalogForApp(process.env);
    if (catalog.status !== 'ready') {
      return NextResponse.json({ ok: false, stage: 'idle', blocked: `MODEL CATALOG ${catalog.status.toUpperCase()}`, usable: false, reasons: catalog.reasons });
    }
    const model: CatalogModel | undefined = catalog.models.find((m) => m.id === modelId)
      || readUserCatalog().find((m) => m.id === modelId); // explicit user-trusted entries
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
    const active = activeJobFor(model.id);
    if (active) return NextResponse.json({ ok: true, accepted: true, jobId: active.jobId, state: active.state, alreadyRunning: true });

    const job = createInstallJob(model.id, entry.sizeBytes || null);

    // Run the real pipeline as a background job; the job carries honest state.
    void (async () => {
      try {
        if (!existsSync(artifactPath)) {
          const dl = await downloadArtifactToFile(entry.url, artifactPath, entry.sizeBytes, {
            signal: job.abort.signal,
            onProgress: (bytes) => updateInstallJob(job.jobId, { bytesDownloaded: bytes }),
          });
          if (dl.cancelled) { updateInstallJob(job.jobId, { state: 'CANCELLED', stage: 'cancelled', endedAt: Date.now() }); return; }
          if (!dl.ok) { updateInstallJob(job.jobId, { state: 'FAILED', stage: 'download', error: dl.reason, endedAt: Date.now() }); return; }
        }
        const result = await provisionAndVerify({
          entry,
          artifactPath,
          runtime: llama!.detect,
          prompt: 'Reply with exactly: AKANSHA OFFLINE ORCHESTRATION READY',
          maxTokens: 24,
          timeoutMs: 120000,
          signal: job.abort.signal,
          onStage: (s) => updateInstallJob(job.jobId, { state: s === 'integrity' ? 'VERIFYING' : 'INFERENCE_TESTING', stage: s }),
        });
        if (result.cancelled) {
          updateInstallJob(job.jobId, { state: 'CANCELLED', stage: 'cancelled', endedAt: Date.now() });
          try { if (existsSync(artifactPath + '.part')) unlinkSync(artifactPath + '.part'); } catch { /* best effort */ }
          return;
        }
        if (!result.ok) { updateInstallJob(job.jobId, { state: 'FAILED', stage: result.stage, error: result.reason, endedAt: Date.now() }); return; }
        updateInstallJob(job.jobId, {
          state: 'READY', stage: 'ready', endedAt: Date.now(),
          benchmark: result.benchmark ? { genTps: result.benchmark.genTps, promptTps: result.benchmark.promptTps, totalMs: result.benchmark.totalMs } : null,
        });
      } catch (e: any) {
        updateInstallJob(job.jobId, { state: 'FAILED', stage: 'internal', error: String(e?.message || e), endedAt: Date.now() });
      }
    })();

    return NextResponse.json({ ok: true, accepted: true, jobId: job.jobId, state: job.state }, { status: 202 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'execute failed', usable: false }, { status: 500 });
  }
}

/** GET /api/ai/install/execute[?jobId=|&modelId=] — job status for honest UI state. */
export async function GET(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  const params = new URL(request.url).searchParams;
  const jobId = params.get('jobId');
  const modelId = params.get('modelId');
  if (jobId) {
    const j = getInstallJob(jobId);
    return NextResponse.json({ ok: !!j, job: j || null, active: j ? null : activeJobFor(modelId || '') });
  }
  return NextResponse.json({ ok: true, jobs: listInstallJobs(modelId || undefined) });
}
