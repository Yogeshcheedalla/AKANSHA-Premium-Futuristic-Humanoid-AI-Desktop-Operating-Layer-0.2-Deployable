/**
 * Setup ViewModel — the single, serializable description the first-run wizard and
 * the permanent Model Center render. It COMPOSES the existing backend (HardwareProbe,
 * RuntimeManager, signed ModelCatalog, CompatibilityEngine, AiMode, ConnectedServices)
 * into honest UI state. It introduces NO new engine and NEVER fabricates a status:
 *
 *   - Offline readiness reflects the REAL runtime + catalog + usable models.
 *   - Online readiness reflects the REAL connected-services state (never the key).
 *   - No silent cloud fallback (mirrors AiMode).
 *
 * The pure `buildSetupViewModel(deps)` is offline-testable with injected fakes;
 * `getSetupViewModel()` gathers the real dependencies at request time.
 */
import { detectHardware, execRun, type CommandRunner, type HardwareProfile } from '@/core/runtime/HardwareProbe';
import { detectRuntimes, runtimeFor } from '@/core/runtime/RuntimeManager';
import { evaluate } from '@/core/catalog/CompatibilityEngine';
import { loadCatalogForApp, type CatalogResult } from '@/core/catalog/catalogProvider';
import { decideAiMode } from '@/core/models/AiMode';
import { toManifestEntry, type CatalogModel } from '@/core/catalog/ModelCatalog';
import { connectedServices as defaultConnected, type ConnectedServices } from '@/core/identity/ConnectedServices';
import { isOAuthConfigured } from '@/core/identity/openRouterOAuth';
import { getUsableLocalModelIds as getUsableLocalIds } from '@/core/models/local/LocalModelRegistry';
import type { ManifestModelEntry } from '@/core/models/local/ModelIntegrity';
import type { SetupViewModel, ModelCardVM, CatalogStatus } from './types';

export type { SetupViewModel, ModelCardVM } from './types';
export type { CatalogStatus };

export interface SetupDeps {
  hardware: HardwareProfile;
  catalog: CatalogResult;
  runtime: { available: boolean; name: string; supportsAcceleration: string[]; version?: string };
  usableLocalIds: string[];
  openrouter: { connected: boolean; verified: boolean; configured?: boolean; label?: string | null };
}

function card(model: CatalogModel, deps: SetupDeps): ModelCardVM {
  const rt = deps.runtime;
  const compat = evaluate(model, deps.hardware, {
    available: rt.available, name: rt.name, supportsAcceleration: rt.supportsAcceleration,
  });
  const entry: ManifestModelEntry = toManifestEntry(model);
  const installable = compat.runnable && rt.available && !deps.usableLocalIds.includes(model.id);
  return {
    id: model.id, name: `${model.family} ${model.version} ${model.parameters}`.trim(),
    family: model.family, version: model.version, quantization: model.quantization, format: model.format,
    downloadSizeBytes: model.downloadSizeBytes, installedSizeBytes: model.installedSizeBytes,
    minimumRamGB: model.minimumRamGB, recommendedRamGB: model.recommendedRamGB, minimumStorageGB: model.minimumStorageGB,
    gpuRequirements: model.gpuRequirements, runtimeRequirement: model.runtimeRequirement, contextLength: model.contextLength,
    capabilities: model.capabilities, quality: model.quality, license: model.license, sourceUrl: model.sourceUrl,
    performanceLabel: compat.performanceLabel, estimatedTokensPerSec: compat.estimatedTokensPerSec, memoryGB: compat.memoryGB,
    bestFor: model.bestFor, drawbacks: model.drawbacks, internetRequired: model.internetRequired,
    compatibility: { score: compat.score, rating: compat.rating, runnable: compat.runnable, reasons: compat.reasons },
    sha256Present: /^[a-f0-9]{64}$/i.test(entry.sha256 || ''), signed: !!model.signature, installable,
  };
}

/** Pure builder — everything below is derived from the injected deps, never invented. */
export function buildSetupViewModel(deps: SetupDeps): SetupViewModel {
  const modelEntries = deps.catalog.models.map(toManifestEntry);
  const mode = decideAiMode({
    mode: 'auto', hardware: deps.hardware, catalog: modelEntries, usableLocalIds: deps.usableLocalIds,
  });
  const offlineReady = deps.usableLocalIds.length > 0;

  let offline = 'OFFLINE AI READY';
  if (deps.catalog.status === 'not-configured') offline = 'MODEL CATALOG NOT CONFIGURED';
  else if (!deps.runtime.available) offline = 'LOCAL RUNTIME NOT DETECTED';
  else if (!offlineReady) offline = 'LOCAL MODEL NOT INSTALLED';
  // A development fixture must NEVER masquerade as a production READY.
  if (deps.catalog.status === 'fixture' && offline === 'OFFLINE AI READY') {
    offline = 'FIXTURE CATALOG (DEV ONLY) — not a production model';
  } else if (deps.catalog.status === 'fixture') {
    offline = `FIXTURE (DEV ONLY): ${offline}`;
  }

  const online =
    deps.openrouter.connected && deps.openrouter.verified ? 'ONLINE AI READY'
      : deps.openrouter.configured === false ? 'OPENROUTER NOT CONFIGURED (no callback URL)'
      : 'CONNECT OPENROUTER TO ENABLE ONLINE AI';

  return {
    device: {
      platform: deps.hardware.platform, architecture: deps.hardware.architecture,
      cpuModel: deps.hardware.cpuModel, cpuCores: deps.hardware.cpuCores, ramGB: deps.hardware.totalRamGB,
      freeDiskGB: deps.hardware.freeDiskGB, gpu: deps.hardware.gpu,
      acceleration: deps.runtime.supportsAcceleration, tier: deps.hardware.tier,
    },
    runtime: deps.runtime,
    catalog: {
      status: deps.catalog.status, reasons: deps.catalog.reasons,
      fixture: deps.catalog.status === 'fixture',
      models: deps.catalog.models.map((m) => card(m, deps)),
    },
    aiMode: { recommended: mode.mode, offlineReady, reason: mode.reason },
    online: { provider: 'openrouter', connected: deps.openrouter.connected, verified: deps.openrouter.verified, configured: deps.openrouter.configured ?? true, label: deps.openrouter.label ?? null },
    readiness: { offline, online },
  };
}

/** Production gatherer — reads the REAL device/runtime/catalog/connection state. */
export function getSetupViewModel(cs: ConnectedServices = defaultConnected, env = process.env, run: CommandRunner = execRun): SetupViewModel {
  const hardware = detectHardware({ run });
  const catalog = loadCatalogForApp(env);
  const runtimes = detectRuntimes(env.LLAMA_CPP_PATHS ? { 'llama.cpp': env.LLAMA_CPP_PATHS.split(',') } : {});
  const rt = runtimeFor(runtimes.find((r) => r.adapter.name === 'llama.cpp'));
  const orList = cs.list().find((s) => s.provider === 'openrouter');
  // usableLocalIds: models that genuinely passed integrity AND a real inference
  // self-test (LocalModelRegistry). Empty until that actually happens — never faked.
  const usableLocalIds = getUsableLocalIds();
  return buildSetupViewModel({
    hardware, catalog,
    runtime: { available: rt.available, name: rt.name, supportsAcceleration: rt.supportsAcceleration, version: rt.version },
    usableLocalIds,
    openrouter: { connected: !!orList?.connected, verified: !!orList?.verified, configured: isOAuthConfigured(env), label: orList?.label ?? null },
  });
}
