/**
 * AiMode — the single decision surface for "Cloud AI vs Offline AI". It does NOT
 * route itself; it translates the user's choice + the real hardware profile +
 * which local model is genuinely usable into a ModelRouter policy + an honest
 * explanation, then the existing ModelRouter remains the sole authority.
 *
 * Guarantees:
 *   - Offline is offered ONLY when a local model is integrity- AND inference-
 *     verified (usable). Never auto-installs a model to satisfy a request.
 *   - No silent fallback: 'auto' may pick cloud, but an explicit 'offline' that
 *     cannot be satisfied returns ok:false with a reason — it does NOT quietly
 *     call the cloud.
 *   - Cloud selection keeps the existing provider resolution untouched.
 */
import type { RoutingPolicy } from '@/core/models/ModelRouter';
import type { HardwareProfile } from '@/core/runtime/HardwareProbe';
import { selectLocalModel, type ModelAssessment } from '@/core/models/local/LocalModelSelector';
import type { ManifestModelEntry } from '@/core/models/local/ModelIntegrity';

export type AiMode = 'auto' | 'offline' | 'cloud';

export interface AiModeDecision {
  ok: boolean;
  mode: 'offline' | 'cloud';
  policy: RoutingPolicy;
  reason: string;
  recommendedLocalModel: string | null;
  fallbackUsed: boolean;      // true only when 'auto' chose cloud because offline wasn't ready
  assessments: ModelAssessment[];
}

/**
 * @param usableLocalIds ids of local models that have passed integrity AND a real
 *        inference self-test (from the runtime layer). Empty ⇒ offline not ready.
 */
export function decideAiMode(opts: {
  mode: AiMode;
  hardware: HardwareProfile;
  catalog: ManifestModelEntry[];
  usableLocalIds: string[];
}): AiModeDecision {
  const { mode, hardware, catalog, usableLocalIds } = opts;
  const sel = selectLocalModel(catalog, hardware, usableLocalIds);
  const usable = (sel.recommendedId && usableLocalIds.includes(sel.recommendedId)) ? sel.recommendedId : (usableLocalIds[0] ?? null);
  const offlineReady = !!usable;

  if (mode === 'offline') {
    return {
      ok: offlineReady,
      mode: offlineReady ? 'offline' : 'cloud',
      policy: offlineReady ? 'LOCAL_ONLY' : 'CLOUD_ONLY',
      reason: offlineReady ? `offline verified provider: ${usable}` : 'No usable local model (needs install + integrity + inference verification). Offline AI is not available; refusing to silently use cloud.',
      recommendedLocalModel: usable, fallbackUsed: false, assessments: sel.assessments,
    };
  }

  if (mode === 'cloud') {
    return { ok: true, mode: 'cloud', policy: 'CLOUD_ONLY', reason: 'cloud selected by user', recommendedLocalModel: usable, fallbackUsed: false, assessments: sel.assessments };
  }

  // auto: prefer verified offline, else cloud — and say so.
  if (offlineReady) {
    return { ok: true, mode: 'offline', policy: 'PREFERRED_LOCAL', reason: `auto: verified local model available (${usable})`, recommendedLocalModel: usable, fallbackUsed: false, assessments: sel.assessments };
  }
  return { ok: true, mode: 'cloud', policy: 'PREFERRED_CLOUD', reason: 'auto: no usable local model → cloud', recommendedLocalModel: null, fallbackUsed: true, assessments: sel.assessments };
}
