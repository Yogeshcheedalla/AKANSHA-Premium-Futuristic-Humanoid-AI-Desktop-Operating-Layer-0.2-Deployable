/**
 * HardwareProbe — read the REAL device (RAM / CPU / arch / free disk / GPU hint)
 * to decide what a local model can run. Previously the platform's ResourceGovernor
 * used hardcoded tier defaults; this gives the governor and the local-model
 * selector actual measurements so "Offline AI" recommendations are honest, not
 * guessed. Probes are isolated so classification is unit-testable offline.
 */
import * as os from 'node:os';
import * as fs from 'node:fs';

export interface HardwareProfile {
  platform: string;
  architecture: string;
  cpuModel: string;
  cpuCores: number;
  totalRamGB: number;
  freeRamGB: number;
  freeDiskGB: number;
  // Best-effort accelerator hint. We NEVER claim a GPU we did not detect.
  gpu: { detected: boolean; vendor?: string; vramGB?: number };
  tier: number;
}

export function toGB(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes <= 0) return 0;
  return Math.round((bytes / 1e9) * 10) / 10;
}

/** Coarse tier from RAM + free disk (higher = more headroom). */
export function classifyTier(profile: Pick<HardwareProfile, 'totalRamGB' | 'freeDiskGB'>): number {
  const ram = profile.totalRamGB || 0;
  const disk = profile.freeDiskGB || 0;
  if (ram >= 32 && disk >= 60) return 4;
  if (ram >= 16) return 3;
  if (ram >= 8) return 2;
  if (ram >= 4) return 1;
  return 0;
}

export interface ProbeContext {
  os?: typeof import('node:os');
  diskPath?: string;
}

function freeDiskFor(path: string): number {
  try {
    const statfs = (fs as any).statfsSync;
    if (statfs) { const s = statfs(path); return Number(s.bsize) * Number(s.bavail); }
  } catch { /* ignore */ }
  return 0;
}

/** Map a GPU model string to a vendor name without asserting VRAM we can't read. */
export function classifyGpu(vendor: string): HardwareProfile['gpu'] {
  const v = (vendor || '').toLowerCase();
  if (/nvidia|geforce|rtx|gtx/.test(v)) return { detected: true, vendor: 'nvidia' };
  if (/amd|radeon/.test(v)) return { detected: true, vendor: 'amd' };
  if (/intel|arc|iris/.test(v)) return { detected: true, vendor: 'intel' };
  if (/apple|m[1-9] /.test(v)) return { detected: true, vendor: 'apple' };
  return { detected: false };
}

/**
 * Detect the current device. All reads are best-effort and guarded; an
 * unavailable probe degrades to 0/false rather than throwing or guessing.
 */
export function detectHardware({ os: osImpl = os, diskPath = process.cwd() }: ProbeContext = {}): HardwareProfile {
  const cores = osImpl.cpus?.() || [];
  const vendorHint = process.env.AKANSHA_GPU || ''; // only set if a real source provides it
  const gpu = vendorHint ? classifyGpu(vendorHint) : { detected: false };
  const profile: HardwareProfile = {
    platform: osImpl.platform(),
    architecture: osImpl.arch(),
    cpuModel: cores[0]?.model || 'unknown',
    cpuCores: cores.length || 0,
    totalRamGB: toGB(osImpl.totalmem()),
    freeRamGB: toGB(osImpl.freemem()),
    freeDiskGB: toGB(freeDiskFor(diskPath)),
    gpu,
    tier: 0,
  };
  profile.tier = classifyTier(profile);
  return profile;
}
