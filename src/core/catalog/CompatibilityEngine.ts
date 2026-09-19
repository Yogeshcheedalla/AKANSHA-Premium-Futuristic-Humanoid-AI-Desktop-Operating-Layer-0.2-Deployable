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
  const bm = model.benchmark || ({ source: 'estimated' } as CatalogModel['benchmark']);
  if (bm.source === 'measured' && (bm.generationTokensPerSec ?? bm.promptTokensPerSec)) {
    performanceLabel = 'Measured';
    estimatedTokensPerSec = bm.generationTokensPerSec ?? bm.promptTokensPerSec;
    memoryGB = bm.memoryGB;
  } else if (bm.generationTokensPerSec ?? bm.promptTokensPerSec) {
    performanceLabel = 'Estimated'; // values exist but were not measured on THIS device
    estimatedTokensPerSec = bm.generationTokensPerSec ?? bm.promptTokensPerSec;
    memoryGB = bm.memoryGB;
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

/* ════════════════════════════════════════════════════════════════════════════
 * HARDWARE-FIT LADDER — an EXTENSION of this same engine (there is no second
 * compatibility brain). Ordered rungs evaluated against the REAL detected
 * device, each carrying an honest basis:
 *
 *   measured   — observed from the actual hardware / real API metadata
 *   declared   — publisher-declared requirement (signed catalog)
 *   estimated  — derived heuristic from real data (never vendor-declared)
 *   unknown    — no reliable source; stays UNKNOWN, never invented
 *
 * Verdicts: FIT (sufficient declared/measured evidence it fits), POSSIBLE
 * (works may, but key values are uncertain/estimated/borderline), UNSUPPORTED
 * (concrete evidence it cannot run here). A verdict is an install-time
 * FORECAST only — READY remains exclusively the ModelManager pipeline's
 * (integrity → real inference) per-install authority. DOWNLOADABLE ≠ LOADABLE
 * ≠ PRACTICALLY USABLE ≠ READY.
 * ══════════════════════════════════════════════════════════════════════════ */

export type FitVerdict = 'FIT' | 'POSSIBLE' | 'UNSUPPORTED';
export type RungStatus = 'PASS' | 'FAIL' | 'UNKNOWN';
export type RungBasis = 'measured' | 'declared' | 'estimated' | 'unknown';
export type FitRungId =
  | 'model' | 'format' | 'architecture' | 'parameters' | 'quantization' | 'fileSize'
  | 'ram' | 'vram' | 'storage' | 'cpu' | 'gpu' | 'os' | 'runtime' | 'dependencies'
  | 'context' | 'resourcePressure';

export interface FitRung { id: FitRungId; status: RungStatus; basis: RungBasis; evidence: string }

export interface FitFacts {
  modelId: string;
  family?: string;                       // model family (catalog) — informational
  format?: string;                       // 'gguf' | 'safetensors' | … (absent = unknown)
  architecture?: string;                 // inference-engine arch name, e.g. 'qwen2'
  parameters?: number;                   // parameter COUNT (1.5e9), if reliably obtained
  quantization?: string;                 // vendor-declared only; never parsed from names
  fileSizeBytes?: number;                // real artifact size
  declared?: {
    minRamGB?: number; recRamGB?: number;
    requiresGpu?: boolean; minVramGB?: number;
    minStorageGB?: number;
    platforms?: string[]; cpuArch?: string[];
    runtime?: string;                    // required runtime name
    acceleration?: string[];             // cpu/cuda/metal/vulkan
    contextLength?: number;
    capabilities?: string[];             // chat/vision/…
  };
  /** True when the declared block comes from the SIGNED catalog (high trust). */
  declaredTrusted?: boolean;
}

export interface FitReport {
  verdict: FitVerdict;
  confidence: 'high' | 'moderate' | 'low';
  rungs: FitRung[];
  reasons: string[];
  unknownRungs: FitRungId[];
}

/** Rungs whose FAIL is disqualifying (concrete evidence the device can't run it). */
const CRITICAL_RUNGS: ReadonlySet<FitRungId> = new Set(['format', 'ram', 'vram', 'storage', 'cpu', 'os', 'runtime']);

/**
 * Architectures whose llama.cpp support is a KNOWN fact (llama.cpp registers
 * these loader names). Anything else stays UNKNOWN — we never guess support.
 */
const KNOWN_LLAMA_ARCHES = new Set([
  'llama', 'qwen2', 'qwen3', 'mistral', 'mixtral', 'gemma', 'gemma2', 'phi3',
  'falcon', 'stablelm', 'command-r', 'olmo', 'gemma3', 'granite', 'exaone',
]);

/** Parse '1.5B'/'70B'/'350M' → parameter count. Returns undefined when not clean. */
export function parseParameterCount(text?: string): number | undefined {
  const m = /^\s*([\d.]+)\s*([bmk])\s*$/i.exec(text || '');
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const mult = { b: 1e9, m: 1e6, k: 1e3 }[m[2].toLowerCase()] as number;
  return Math.round(n * mult);
}

/** RAM estimate (GB) from a real GGUF file size — heuristic, always labelled. */
export function estimateRamGBFromFileSize(fileSizeBytes: number): number {
  const sizeGB = fileSizeBytes / 1e9;
  return Math.round((sizeGB * 1.2 + 1.5) * 10) / 10;
}

export function fitFromCatalogModel(m: CatalogModel): FitFacts {
  return {
    modelId: m.id,
    family: m.family,
    format: m.format,
    architecture: m.family, // catalog families map 1:1 onto supported loader families below
    parameters: parseParameterCount(m.parameters),
    quantization: m.quantization,
    fileSizeBytes: m.downloadSizeBytes,
    declaredTrusted: true,
    declared: {
      minRamGB: m.minimumRamGB, recRamGB: m.recommendedRamGB,
      // A SIGNED catalog entry omits gpuRequirements to MEAN "not required"
      // (exactly how the existing card renders 'Optional') — omission is a
      // declaration there, but remains UNKNOWN for unsigned discovery metadata.
      requiresGpu: m.gpuRequirements ? !!m.gpuRequirements.required : false,
      minVramGB: m.gpuRequirements?.minVramGB,
      minStorageGB: m.minimumStorageGB,
      platforms: m.platforms, cpuArch: m.architecture,
      runtime: m.runtimeRequirement, acceleration: m.accelerationSupport,
      contextLength: m.contextLength, capabilities: m.capabilities,
    },
  };
}

/**
 * THE ladder evaluator. Rungs in spec order; every claim carries its basis;
 * absent data yields UNKNOWN rungs that NEVER block non-critically. Estimated
 * passes cap the verdict at POSSIBLE by construction (FIT requires declared or
 * measured evidence on every critical resource rung).
 */
export function buildFitReport(facts: FitFacts, hw: HardwareProfile, runtime: RuntimeDescriptor): FitReport {
  const d = facts.declared || {};
  const trusted = facts.declaredTrusted ? 'declared' : 'measured'; // metadata source basis
  const rungs: FitRung[] = [];
  const push = (id: FitRungId, status: RungStatus, basis: RungBasis, evidence: string) =>
    rungs.push({ id, status, basis, evidence });

  // 1 · Model
  push('model', 'PASS', 'measured', `${facts.modelId}${facts.family ? ` (family ${facts.family})` : ''}`);

  // 2 · Format — only GGUF has a verified loader path in llama.cpp today.
  if (facts.format === 'gguf') push('format', 'PASS', trusted, 'GGUF — supported by the llama.cpp loader');
  else if (!facts.format) push('format', 'UNKNOWN', 'unknown', 'artifact format not confirmed from metadata');
  else push('format', 'FAIL', trusted, facts.format === 'non-gguf'
    ? 'no GGUF artifact in the repository metadata — no verified loader path'
    : `${facts.format} — no verified loader runtime for this format here`);

  // 3 · Architecture (model arch, not CPU arch).
  // Signed-catalog entries are trusted BY SIGNATURE (the operator pinned them
  // for this runtime); discovered entries must match a KNOWN loader arch name.
  if (facts.architecture && facts.declaredTrusted) {
    push('architecture', 'PASS', 'declared', `family/architecture "${facts.architecture}" — signed catalog entry pinned for ${d.runtime || 'its runtime'}`);
  } else if (facts.architecture && KNOWN_LLAMA_ARCHES.has(facts.architecture)) {
    push('architecture', 'PASS', 'measured', `architecture "${facts.architecture}" is supported by llama.cpp`);
  } else if (facts.architecture) {
    push('architecture', 'UNKNOWN', 'unknown', `architecture "${facts.architecture}" — loader support not verified; left unknown`);
  } else {
    push('architecture', 'UNKNOWN', 'unknown', 'model architecture unavailable from authoritative metadata');
  }
  // Multimodal special case: vision artifacts need projector files + vision
  // runtime support we have NOT verified here — recorded as evidence on the
  // architecture rung, and it caps nothing (honest POSSIBLE ceiling applies).
  if (d.capabilities?.includes('vision')) {
    const archRung = rungs[rungs.length - 1];
    archRung.evidence += ' · declares vision/multimodal input — projector support NOT verified on this runtime';
    if (archRung.status === 'PASS') { archRung.status = 'UNKNOWN'; archRung.basis = 'unknown'; }
  }

  // 4 · Parameters (informational — real count or UNKNOWN)
  push('parameters', facts.parameters ? 'PASS' : 'UNKNOWN', facts.parameters ? trusted : 'unknown',
    facts.parameters ? `${(facts.parameters / 1e9).toFixed(facts.parameters >= 1e9 ? 1 : 2)}B parameters` : 'parameter count unknown');

  // 5 · Quantization (vendor-declared ONLY — never parsed from a model name)
  push('quantization', facts.quantization ? 'PASS' : 'UNKNOWN', facts.quantization ? 'declared' : 'unknown',
    facts.quantization ? `quantization ${facts.quantization} (declared)` : 'quantization not declared by an authoritative source');

  // 6 · File size (real bytes from the artifact listing / pinned catalog)
  push('fileSize', facts.fileSizeBytes ? 'PASS' : 'UNKNOWN', facts.fileSizeBytes ? trusted : 'unknown',
    facts.fileSizeBytes ? `${(facts.fileSizeBytes / 1e9).toFixed(2)} GB artifact` : 'artifact size unknown');

  // 7 · RAM — declared requirement wins; else a clearly-labelled estimate from
  // the REAL file size; else UNKNOWN. Estimates never produce a hard FAIL→
  // they only cap the verdict to POSSIBLE.
  if (d.minRamGB) {
    const ok = (hw.totalRamGB || 0) >= d.minRamGB;
    push('ram', ok ? 'PASS' : 'FAIL', 'declared', `needs ${d.minRamGB} GB (declared) vs ${hw.totalRamGB} GB RAM (measured)`);
  } else if (facts.fileSizeBytes) {
    const est = estimateRamGBFromFileSize(facts.fileSizeBytes);
    if (est > (hw.totalRamGB || 0)) push('ram', 'FAIL', 'estimated', `estimated need ${est} GB exceeds ${hw.totalRamGB} GB RAM — file too large to load (heuristic estimate)`);
    else if (est <= (hw.totalRamGB || 0) * 0.6) push('ram', 'PASS', 'estimated', `estimated need ${est} GB ≤ ${hw.totalRamGB} GB RAM (heuristic from real file size)`);
    else push('ram', 'UNKNOWN', 'estimated', `estimated need ${est} GB vs ${hw.totalRamGB} GB RAM — borderline, no declared requirement`);
  } else {
    push('ram', 'UNKNOWN', 'unknown', 'RAM requirement unavailable from authoritative metadata');
  }

  // 8 · VRAM
  if (d.requiresGpu) {
    const vram = hw.gpu?.vramGB;
    if (vram === undefined) push('vram', 'UNKNOWN', 'measured', `GPU requires ${d.minVramGB ?? 'an unknown amount of'} GB VRAM but dedicated VRAM is unreadable here`);
    else push('vram', vram >= (d.minVramGB || 0) ? 'PASS' : 'FAIL', 'measured', `${vram} GB VRAM measured vs ${d.minVramGB || 'any'} GB required (declared)`);
  } else if (d.requiresGpu === false) {
    push('vram', 'PASS', 'declared', 'GPU not required (declared) — CPU execution path supported');
  } else {
    push('vram', 'UNKNOWN', 'unknown', 'VRAM requirement unavailable from authoritative metadata; CPU-only fallback may be possible');
  }

  // 9 · Storage — declared minimum, else real file size + headroom (estimated).
  if (d.minStorageGB) {
    const ok = (hw.freeDiskGB || 0) >= d.minStorageGB + 2;
    push('storage', ok ? 'PASS' : 'FAIL', 'declared', `needs ${d.minStorageGB} GB +2 GB headroom (declared) vs ${hw.freeDiskGB} GB free (measured)`);
  } else if (facts.fileSizeBytes) {
    const need = Math.round((facts.fileSizeBytes / 1e9 + 2) * 10) / 10;
    if ((hw.freeDiskGB || 0) < need) push('storage', 'FAIL', 'estimated', `free ${hw.freeDiskGB} GB below the ${need} GB the artifact itself requires (measured size)`);
    else push('storage', 'PASS', 'estimated', `free ${hw.freeDiskGB} GB ≥ ${need} GB (real artifact size + 2 GB headroom)`);
  } else {
    push('storage', 'UNKNOWN', 'unknown', 'neither a declared storage minimum nor a known file size');
  }

  // 10 · CPU architecture
  if (d.cpuArch?.length) {
    const ok = d.cpuArch.includes(hw.architecture);
    push('cpu', ok ? 'PASS' : 'FAIL', 'declared', `supports [${d.cpuArch.join(', ')}]; device is ${hw.architecture} (${hw.cpuCores} cores, measured)`);
  } else {
    push('cpu', 'UNKNOWN', 'unknown', `device CPU ${hw.architecture} ×${hw.cpuCores} measured; artifact target arch not declared`);
  }

  // 11 · GPU compatibility (informational accelerator fit)
  {
    const accel = d.acceleration?.length ? d.acceleration : [];
    const vendor = hw.gpu?.detected ? hw.gpu.vendor : undefined;
    const wanted = vendor === 'nvidia' ? 'cuda' : vendor === 'apple' ? 'metal' : vendor === 'amd' ? 'vulkan' : 'cpu';
    if (!hw.gpu?.detected) push('gpu', accel.includes('cpu') || !accel.length ? 'PASS' : 'UNKNOWN', 'measured', 'no discrete GPU detected — CPU-only execution path');
    else push('gpu', 'PASS', 'measured', `${hw.gpu.model || vendor} detected; matching backend would be "${wanted}"${hw.gpu.integrated ? ' (integrated — shared memory is NOT VRAM)' : ''}`);
  }

  // 12 · OS
  if (d.platforms?.length) {
    const ok = d.platforms.includes(hw.platform);
    push('os', ok ? 'PASS' : 'FAIL', 'declared', `supports [${d.platforms.join(', ')}]; device is ${hw.platform} (measured)`);
  } else {
    push('os', 'UNKNOWN', 'unknown', `device OS ${hw.platform} measured; artifact platform list not declared`);
  }

  // 13 · Runtime
  if (!d.runtime) push('runtime', 'UNKNOWN', 'unknown', 'required runtime not declared');
  else if (runtime.available && runtime.name === d.runtime) push('runtime', 'PASS', 'measured', `${d.runtime}${runtime.version ? ` ${runtime.version}` : ''} detected and healthy`);
  else if (runtime.available) push('runtime', 'FAIL', 'measured', `requires "${d.runtime}" but the detected runtime is "${runtime.name}" (runtime mismatch)`);
  else push('runtime', 'FAIL', 'measured', `required runtime "${d.runtime}" not detected on this device`);

  // 14 · Runtime dependencies (kept conservative: only claim what the
  // detection already observed; vendor backends need their driver).
  {
    const needsGpuBackend = !!d.requiresGpu;
    if (!runtime.available) push('dependencies', 'UNKNOWN', 'unknown', 'runtime absent — dependency state unknown');
    else if (needsGpuBackend && hw.gpu?.vendor !== 'nvidia') push('dependencies', 'UNKNOWN', 'measured', 'GPU backend libraries only meaningful with the matching driver; none confirmed');
    else push('dependencies', 'PASS', 'measured', 'llama.cpp detected healthy (its own binary is the dependency); no extra packages claimed');
  }

  // 15 · Context length (informational)
  push('context', d.contextLength ? 'PASS' : 'UNKNOWN', d.contextLength ? 'declared' : 'unknown',
    d.contextLength ? `context ${d.contextLength} tokens (declared)` : 'context length unknown from metadata');

  // 16 · Expected resource pressure (measured device vs declared/estimated need)
  let pressure: RungStatus = 'UNKNOWN';
  {
    const need = d.recRamGB ?? d.minRamGB ?? (facts.fileSizeBytes ? estimateRamGBFromFileSize(facts.fileSizeBytes) : undefined);
    const basis: RungBasis = (d.recRamGB || d.minRamGB) ? 'declared' : 'estimated';
    if (need && hw.totalRamGB) {
      const head = hw.totalRamGB - need;
      pressure = head >= 6 ? 'PASS' : head >= 2 ? 'PASS' : head > 0 ? 'FAIL' : 'FAIL';
      const label = head >= 6 ? 'LOW' : head >= 2 ? 'MODERATE' : 'TIGHT/INSUFFICIENT';
      push('resourcePressure', head >= 2 ? 'PASS' : 'FAIL', basis, `${label} pressure: ${hw.totalRamGB} GB RAM vs ~${need} GB need (${basis})`);
    } else {
      push('resourcePressure', 'UNKNOWN', 'unknown', 'not enough declared/real-size data to judge resource pressure');
    }
  }

  // ── Verdict ─────────────────────────────────────────────────────────────
  const critical = rungs.filter((r) => CRITICAL_RUNGS.has(r.id));
  const failed = rungs.filter((r) => r.status === 'FAIL');
  const criticalFails = critical.filter((r) => r.status === 'FAIL');
  const unknowns = rungs.filter((r) => r.status === 'UNKNOWN').map((r) => r.id);

  let verdict: FitVerdict;
  if (criticalFails.length) verdict = 'UNSUPPORTED';
  else if (
    failed.length === 0 &&
    critical.every((r) => r.status === 'PASS' && (r.basis === 'declared' || r.basis === 'measured')) &&
    pressure === 'PASS'
  ) verdict = 'FIT';
  else verdict = 'POSSIBLE';

  const estimatedPass = critical.some((r) => r.status === 'PASS' && r.basis === 'estimated');
  const confidence: FitReport['confidence'] =
    unknowns.length >= 4 ? 'low' : (estimatedPass || unknowns.length >= 2) ? 'moderate' : 'high';

  const reasons = verdict === 'UNSUPPORTED'
    ? criticalFails.concat(failed.filter((r) => !CRITICAL_RUNGS.has(r.id))).map((r) => `${r.id}: ${r.evidence}`)
    : rungs.filter((r) => r.status === 'PASS' && r.basis !== 'unknown').map((r) => `${r.id} ✓ ${r.evidence}`);

  return { verdict, confidence, rungs, reasons, unknownRungs: unknowns };
}

/** Convenience: fit report straight from a signed catalog model. */
export function fitForCatalogModel(model: CatalogModel, hw: HardwareProfile, runtime: RuntimeDescriptor): FitReport {
  return buildFitReport(fitFromCatalogModel(model), hw, runtime);
}
