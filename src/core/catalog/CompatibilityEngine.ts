/**
 * CompatibilityEngine — MODEL × HARDWARE × RUNTIME scoring. This is the
 * recommendation brain behind the Model Center: given a real HardwareProfile
 * and a signed CatalogModel (+ which runtime is available), it produces a
 * 0-100 compatibility score and an honest UI rating:
 *
 *   EXCELLENT · GOOD · USABLE · SLOW · UNSUPPORTED
 *
 * It NEVER invents performance. Benchmark labels come through as
 * 'measured' or 'estimated' and are surfaced verbatim; if performance is
 * unknown it reports "Estimated"/"Unknown", never a fabricated number.
 */
import type { HardwareProfile } from '@/core/runtime/HardwareProbe';
import type { CatalogModel } from '@/core/catalog/ModelCatalog';

export type CompatibilityRating = 'EXCELLENT' | 'GOOD' | 'USABLE' | 'SLOW' | 'UNSUPPORTED';

export interface RuntimeDescriptor {
  available: boolean;
  name: string;            // e.g. 'llama.cpp'
  supportsAcceleration: string[]; // e.g. ['cpu','cuda']
  version?: string;
}

export interface CompatibilityResult {
  modelId: string;
  score: number;           // 0-100
  rating: CompatibilityRating;
  runnable: boolean;       // can it run at all (RAM/storage/platform/runtime)
  reasons: string[];
  performanceLabel: 'Measured' | 'Estimated' | 'Unknown';
  estimatedTokensPerSec?: number; // only if a source provides it; never fabricated
  memoryGB?: number;
  acceleration?: string;   // chosen backend if any
}

function ramHeadroom(hw: HardwareProfile, m: CatalogModel): number {
  return (hw.totalRamGB || 0) - (m.recommendedRamGB || m.minimumRamGB || 0);
}

/**
 * @param availableBackend present only if actually detected (cuda/metal/vulkan/cpu).
 */
export function evaluate(model: CatalogModel, hw: HardwareProfile, runtime: RuntimeDescriptor): CompatibilityResult {
  const reasons: string[] = [];
  const platOk = !model.platforms?.length || model.platforms.includes(hw.platform);
  const archOk = !model.architecture?.length || model.architecture.includes(hw.architecture);
  const runtimeOk = runtime.available && runtime.name === model.runtimeRequirement;
  const ramOk = (hw.totalRamGB || 0) >= (model.minimumRamGB || 0);
  const diskOk = (hw.freeDiskGB || 0) >= (model.minimumStorageGB || 0) + 2;

  if (!platOk) reasons.push('platform-unsupported');
  if (!archOk) reasons.push('architecture-unsupported');
  if (!runtimeOk) reasons.push(`runtime-missing:${model.runtimeRequirement}`);
  if (!ramOk) reasons.push(`insufficient-ram:${model.minimumRamGB}`);
  if (!diskOk) reasons.push(`insufficient-storage:${model.minimumStorageGB}`);

  const runnable = platOk && archOk && runtimeOk && ramOk && diskOk;

  // Acceleration: only claim it if BOTH model + hardware + runtime support it.
  const hwBackends = new Set<string>([ 'cpu' ]);
  if (hw.gpu?.detected && hw.gpu.vendor) hwBackends.add(hw.gpu.vendor === 'apple' ? 'metal' : hw.gpu.vendor === 'nvidia' ? 'cuda' : hw.gpu.vendor === 'amd' ? 'vulkan' : 'cpu');
  const common = model.accelerationSupport.filter((b) => hwBackends.has(b) && runtime.supportsAcceleration.includes(b));
  const acceleration = common.length ? common[0] : 'cpu';

  let performanceLabel: CompatibilityResult['performanceLabel'] = 'Unknown';
  let estimatedTokensPerSec: number | undefined;
  let memoryGB: number | undefined;
  if (model.benchmark.source === 'measured' && (model.benchmark.generationTokensPerSec ?? model.benchmark.promptTokensPerSec)) {
    performanceLabel = 'Measured';
    estimatedTokensPerSec = model.benchmark.generationTokensPerSec ?? model.benchmark.promptTokensPerSec;
    memoryGB = model.benchmark.memoryGB;
  } else if (model.benchmark.generationTokensPerSec ?? model.benchmark.promptTokensPerSec) {
    performanceLabel = 'Estimated'; // values exist but were not measured on THIS device
    estimatedTokensPerSec = model.benchmark.generationTokensPerSec ?? model.benchmark.promptTokensPerSec;
    memoryGB = model.benchmark.memoryGB;
  }

  if (!runnable) {
    return { modelId: model.id, score: 0, rating: 'UNSUPPORTED', runnable: false, reasons, performanceLabel, estimatedTokensPerSec, memoryGB, acceleration };
  }

  // Score from real headroom, never from a promised speed.
  let score = 40;
  const head = ramHeadroom(hw, model);
  if (head >= 12) score += 30; else if (head >= 6) score += 20; else if (head >= 2) score += 8;
  if (acceleration !== 'cpu') score += 20; else score += 4;
  const diskMargin = (hw.freeDiskGB || 0) - (model.minimumStorageGB || 0);
  if (diskMargin >= 20) score += 10; else if (diskMargin >= 8) score += 5;
  if ((model.gpuRequirements?.required) && (hw.gpu?.vramGB || 0) < (model.gpuRequirements?.minVramGB || 0)) score -= 30;
  score = Math.max(0, Math.min(100, Math.round(score)));

  const rating: CompatibilityRating =
    !runnable ? 'UNSUPPORTED'
      : score >= 85 ? 'EXCELLENT'
      : score >= 65 ? 'GOOD'
      : score >= 45 ? 'USABLE'
      : 'SLOW';

  return { modelId: model.id, score, rating, runnable: true, reasons, performanceLabel, estimatedTokensPerSec, memoryGB, acceleration };
}

/** Rank a whole catalog for a device; best-first, with the honest rating. */
export function rankCatalog(models: CatalogModel[], hw: HardwareProfile, runtime: RuntimeDescriptor): { model: CatalogModel; compat: CompatibilityResult }[] {
  return models
    .map((model) => ({ model, compat: evaluate(model, hw, runtime) }))
    .sort((a, b) => (b.compat.runnable ? 1 : 0) - (a.compat.runnable ? 1 : 0) || b.compat.score - a.compat.score);
}
