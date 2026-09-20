import { modelRouter } from './ModelRouter';
import { detectHardwareLive } from '../runtime/HardwareProbe';
import { loadCatalogForApp } from '../catalog/catalogProvider';
import { toManifestEntry } from '../catalog/ModelCatalog';
import { decideAiMode, type AiMode } from './AiMode';
import { getUsableLocalModelIds } from './local/LocalModelRegistry';

export interface AppliedAiMode {
  requestedMode: AiMode;
  resolved: AiMode;
  policy: unknown;
  offlineReady: boolean;
  fallbackUsed: boolean;
  reason?: string;
}

/**
 * Apply a user AI-mode choice to the ONE authoritative ModelRouter policy.
 * Shared by POST /api/ai/mode and the deterministic command pipeline so voice
 * ("enable offline mode") and the UI toggle can never drift apart.
 * An 'offline' request that cannot be satisfied is reported honestly —
 * never a silent cloud fallback.
 */
export function applyAiMode(mode: AiMode): AppliedAiMode {
  const hardware = detectHardwareLive();
  const catalog = loadCatalogForApp(process.env);
  const modelEntries = catalog.models.map(toManifestEntry);
  const usableLocalIds = getUsableLocalModelIds();
  const decision = decideAiMode({ mode, hardware, catalog: modelEntries, usableLocalIds });
  modelRouter.setPolicy(decision.policy);
  return {
    requestedMode: mode,
    resolved: decision.mode,
    policy: modelRouter.getPolicy(),
    offlineReady: decision.ok && decision.mode === 'offline',
    fallbackUsed: decision.fallbackUsed,
    reason: decision.reason,
  };
}
