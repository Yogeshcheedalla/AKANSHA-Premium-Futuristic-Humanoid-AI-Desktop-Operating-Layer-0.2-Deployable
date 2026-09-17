/**
 * Hybrid Model Selection Policy — a thin, EXPLAINABLE layer that is consumed BY the
 * existing ModelRouter. It reuses the authoritative `decideAiMode` (so there is still
 * ONE routing brain) and layers on the extra signals the spec calls for: privacy,
 * latency, network availability, current-information need and local capability.
 *
 * It never silently sends sensitive content to a cloud provider: a sensitive task is
 * pinned to LOCAL whenever a verified local model exists, and is refused (honest
 * unavailable) rather than leaked when none does.
 */
import { decideAiMode, type AiMode, type AiModeDecision } from '@/core/models/AiMode';
import type { RoutingPolicy } from '@/core/models/ModelRouter';
import type { HardwareProfile } from '@/core/runtime/HardwareProbe';
import type { ManifestModelEntry } from '@/core/models/local/ModelIntegrity';

export type ModelDecisionKind = 'LOCAL' | 'ONLINE' | 'HYBRID' | 'FAILOVER';

export interface ModelSelectionInput {
  mode: AiMode;
  hardware: HardwareProfile;
  catalog: ManifestModelEntry[];
  usableLocalIds: string[];
  sensitive?: boolean;
  networkAvailable?: boolean;
  requiresCurrentInfo?: boolean;
  latencySensitive?: boolean;
}

export interface ModelSelection {
  decision: ModelDecisionKind;
  policy: RoutingPolicy;
  reason: string;
  privacy: 'sensitive' | 'normal';
  fallbackAvailable: boolean;
  base: AiModeDecision;
}

export function selectModel(input: ModelSelectionInput): ModelSelection {
  const base = decideAiMode({ mode: input.mode, hardware: input.hardware, catalog: input.catalog, usableLocalIds: input.usableLocalIds });
  const offlineReady = !!base.recommendedLocalModel;
  const privacy: 'sensitive' | 'normal' = input.sensitive ? 'sensitive' : 'normal';
  const network = input.networkAvailable !== false;
  const fallbackAvailable = offlineReady && network;

  // Privacy first: sensitive content must stay local when a verified local model exists.
  if (input.sensitive) {
    if (offlineReady) return { decision: 'LOCAL', policy: 'LOCAL_ONLY', reason: 'sensitive content pinned to verified local model', privacy, fallbackAvailable, base };
    // No local model: refuse rather than leak to cloud.
    return { decision: 'FAILOVER', policy: 'LOCAL_ONLY', reason: 'sensitive content but no usable local model — refusing to send to cloud', privacy, fallbackAvailable: false, base };
  }

  // Current/external information needs online/tooling.
  if (input.requiresCurrentInfo) {
    if (network) return { decision: 'ONLINE', policy: 'PREFERRED_CLOUD', reason: 'current information requires online/tools', privacy, fallbackAvailable, base };
    return { decision: 'FAILOVER', policy: offlineReady ? 'LOCAL_ONLY' : 'CLOUD_ONLY', reason: 'needs current info but offline; ' + (offlineReady ? 'local model cannot fetch live data' : 'no provider'), privacy, fallbackAvailable: false, base };
  }

  // Latency-sensitive + a verified local model → prefer local for speed.
  if (input.latencySensitive && offlineReady) return { decision: 'LOCAL', policy: 'PREFERRED_LOCAL', reason: 'latency-sensitive, verified local model available', privacy, fallbackAvailable, base };

  // Otherwise defer to the authoritative AiMode decision (auto/offline/cloud/both).
  const decision: ModelDecisionKind = base.mode === 'offline' ? (base.policy === 'PREFERRED_LOCAL' ? 'HYBRID' : 'LOCAL') : (base.fallbackUsed ? 'HYBRID' : 'ONLINE');
  return { decision, policy: base.policy, reason: base.reason, privacy, fallbackAvailable, base };
}
