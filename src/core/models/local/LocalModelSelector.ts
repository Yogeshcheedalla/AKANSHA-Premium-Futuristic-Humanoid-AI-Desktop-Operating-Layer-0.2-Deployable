/**
 * LocalModelSelector — hardware-aware selection of a LOCAL model, from the
 * signed manifest (never a hardcoded list) evaluated against the real
 * HardwareProfile. Reuses the same fit predicate for recommendation and for
 * per-model badges so the UI and the router can never disagree.
 *
 * Rules (honest, no force-install):
 *   - tier is a capability signal, never a reason to auto-install.
 *   - a model is installable only if RAM AND free disk both clear its minimums
 *     (plus a safety buffer) on THIS device.
 *   - offline selection returns a truthful reason when nothing fits — it does
 *     NOT silently fall back to cloud (the caller decides).
 */
import type { HardwareProfile } from '@/core/runtime/HardwareProbe';
import type { ManifestModelEntry } from '@/core/models/local/ModelIntegrity';

const STORAGE_BUFFER_GB = 2;

export type ModelState =
  | 'RECOMMENDED' | 'GPU_ACCELERATED' | 'CPU_ONLY' | 'INSTALLED'
  | 'INSUFFICIENT_RAM' | 'INSUFFICIENT_STORAGE' | 'UNSUPPORTED' | 'UNKNOWN';

export interface ModelAssessment {
  id: string;
  status: ModelState;
  installable: boolean;
  reason: string;
  sizeGB: number;
  requiredStorageGB: number;
}

function fits(entry: ManifestModelEntry, hw: HardwareProfile, buffer = STORAGE_BUFFER_GB): boolean {
  const sizeGB = (entry.sizeBytes || 0) / 1e9;
  const minStorage = entry.minimumStorageGB ?? Math.ceil(sizeGB);
  if (entry.minimumRamGB && (hw.totalRamGB || 0) < entry.minimumRamGB) return false;
  if ((hw.freeDiskGB || 0) < minStorage + buffer) return false;
  return true;
}

export function assessModel(entry: ManifestModelEntry, hw: HardwareProfile, ctx: { installed?: boolean; recommendedId?: string | null } = {}): ModelAssessment {
  const sizeGB = Math.round(((entry.sizeBytes || 0) / 1e9) * 10) / 10;
  const minStorage = entry.minimumStorageGB ?? Math.ceil(sizeGB);
  const requiredStorageGB = Math.round((minStorage + STORAGE_BUFFER_GB) * 10) / 10;
  const accelerated = !!hw.gpu?.detected;

  let status: ModelState;
  let reason: string;
  if (ctx.installed) { status = 'INSTALLED'; reason = 'installed + integrity verified'; }
  else if (entry.id === ctx.recommendedId) { status = 'RECOMMENDED'; reason = 'best fit for this device'; }
  else if (!fits(entry, hw)) {
    if (entry.minimumRamGB && (hw.totalRamGB || 0) < entry.minimumRamGB) { status = 'INSUFFICIENT_RAM'; reason = `needs ${entry.minimumRamGB} GB RAM, ${hw.totalRamGB} available`; }
    else { status = 'INSUFFICIENT_STORAGE'; reason = `needs ~${requiredStorageGB} GB free, ${hw.freeDiskGB} available`; }
  } else { status = accelerated ? 'GPU_ACCELERATED' : 'CPU_ONLY'; reason = 'fits this device'; }

  const installable = status === 'RECOMMENDED' || status === 'GPU_ACCELERATED' || status === 'CPU_ONLY' || status === 'INSTALLED';
  return { id: entry.id, status, installable, reason, sizeGB, requiredStorageGB };
}

/**
 * Assess the whole manifest and pick the recommended local model (largest tier
 * that fits, best capability count within the tier). Returns null when nothing
 * fits — the caller must NOT then assume cloud silently.
 */
export function selectLocalModel(entries: ManifestModelEntry[], hw: HardwareProfile, installedIds: string[] = []): { recommendedId: string | null; assessments: ModelAssessment[]; offlineReady: boolean } {
  const installed = new Set(installedIds);
  const fitting = entries.filter((e) => fits(e, hw));
  let recommendedId: string | null = null;
  if (fitting.length) {
    const maxCaps = fitting.reduce((m, e) => Math.max(m, (e.capabilities || []).length), 0);
    recommendedId = fitting.find((e) => (e.capabilities || []).length === maxCaps)!.id;
  }
  const assessments = entries.map((e) => assessModel(e, hw, { installed: installed.has(e.id), recommendedId }));
  return { recommendedId, assessments, offlineReady: !!recommendedId };
}
