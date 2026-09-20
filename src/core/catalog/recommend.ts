/**
 * Device-aware model recommendations for the guided offline flow.
 *
 * Uses the EXISTING CompatibilityEngine.evaluate() (the same gate the install
 * planner uses) — it does NOT invent a second scorer. Returns the runnable
 * catalog models best-fit-for-this-device first, smallest first, so "show
 * recommended models" and "install recommended model" resolve to a real,
 * honest, installable choice.
 */
import { detectHardwareLive } from '../runtime/HardwareProbe';
import { detectRuntimes, runtimeFor } from '../runtime/RuntimeManager';
import { loadCatalogForApp } from './catalogProvider';
import { evaluate, type CompatibilityRating } from './CompatibilityEngine';

export interface Recommendation {
  modelId: string;
  name: string;
  sizeGB: number | null;
  rating: CompatibilityRating;
  runnable: boolean;
  reasons: string[];
}

const RANK: Record<CompatibilityRating, number> = { EXCELLENT: 0, GOOD: 1, USABLE: 2, SLOW: 3, UNSUPPORTED: 4 };

export function recommendModels(env: NodeJS.ProcessEnv = process.env, limit = 5): Recommendation[] {
  const catalog = loadCatalogForApp(env);
  if (catalog.status !== 'ready') return [];
  const hardware = detectHardwareLive();
  const llama = detectRuntimes(env.LLAMA_CPP_PATHS ? { 'llama.cpp': env.LLAMA_CPP_PATHS.split(',') } : {}).find((r) => r.adapter.name === 'llama.cpp');
  const rt = runtimeFor(llama);
  return catalog.models
    .map((m) => {
      const c = evaluate(m, hardware, { available: rt.available, name: rt.name, supportsAcceleration: rt.supportsAcceleration ?? [] });
      const name = [m.family, m.parameters, m.quantization].filter(Boolean).join(' ');
      return { modelId: m.id, name, sizeGB: m.downloadSizeBytes ? Math.round((m.downloadSizeBytes / 1e9) * 10) / 10 : null, rating: c.rating, runnable: c.runnable, reasons: c.reasons };
    })
    .filter((r) => r.runnable)
    .sort((a, b) => RANK[a.rating] - RANK[b.rating] || (a.sizeGB ?? 999) - (b.sizeGB ?? 999))
    .slice(0, limit);
}
