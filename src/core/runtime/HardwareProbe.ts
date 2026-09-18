/**
 * HardwareProbe — read the REAL device (RAM / CPU / arch / free disk / GPU hint)
 * to decide what a local model can run. Previously the platform's ResourceGovernor
 * used hardcoded tier defaults; this gives the governor and the local-model
 * selector actual measurements so "Offline AI" recommendations are honest, not
 * guessed. Probes are isolated so classification is unit-testable offline.
 */
import * as os from 'node:os';
import * as fs from 'node:fs';

/** A command runner returns stdout or throws; injected so probing is testable offline. */
export type CommandRunner = (cmd: string, args: string[]) => string;

export interface HardwareProfile {
  platform: string;
  architecture: string;
  cpuModel: string;
  cpuCores: number;
  totalRamGB: number;
  freeRamGB: number;
  freeDiskGB: number;
  // Best-effort accelerator hint. We NEVER claim a GPU we did not detect.
  gpu: { detected: boolean; vendor?: string; vramGB?: number; model?: string; freeVramGB?: number; integrated?: boolean };
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
  /** When provided, a REAL accelerator probe runs. Omitted → env-only (no exec). */
  run?: CommandRunner;
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

const INTEGRATED_RE = /intel|uhd|hd graphics|iris|vega|asus|microsoft basic render/i;

/**
 * Pure, injectable accelerator probe. Returns an honest HardwareProfile['gpu']
 * or { detected: false }. It NEVER invents VRAM: integrated graphics report a
 * model + vendor but no dedicated VRAM (shared memory is not VRAM). Any probe
 * failure degrades to not-detected rather than guessing.
 */
export function probeAccelerator(run: CommandRunner): HardwareProfile['gpu'] {
  // 1) NVIDIA — nvidia-smi gives authoritative total + FREE VRAM.
  try {
    const out = run('nvidia-smi', ['--query-gpu=name,memory.total,memory.free', '--format=csv,noheader,nounits']);
    const line = String(out || '').trim().split('\n')[0] || '';
    const parts = line.split(',').map((s) => s.trim());
    const name = parts[0] || '';
    const totalMiB = Number(parts[1]);
    const freeMiB = Number(parts[2]);
    if (name && Number.isFinite(totalMiB) && totalMiB > 0) {
      return {
        detected: true, vendor: 'nvidia', model: name,
        vramGB: Math.round((totalMiB / 1024) * 10) / 10,
        freeVramGB: Number.isFinite(freeMiB) ? Math.round((freeMiB / 1024) * 10) / 10 : undefined,
        integrated: false,
      };
    }
  } catch { /* no nvidia-smi — fall through */ }

  // 2) Windows WMI — the largest video controller. AdapterRAM is capped at 4 GiB
  //    (uint32) and is the dedicated frame buffer; integrated adapters are marked
  //    and their shared RAM is NOT reported as VRAM. Where powershell is absent the
  //    runner throws and we simply fall through to not-detected.
  try {
    const out = run('powershell.exe', [
      '-NoProfile', '-Command',
      "(Get-CimInstance Win32_VideoController | Sort-Object AdapterRAM -Descending | Select-Object -First 1 Name,AdapterRAM | ConvertTo-Json -Compress)",
    ]);
    const info = JSON.parse(String(out || '').trim());
    const name = String(info?.Name || '');
    const adapterBytes = Number(info?.AdapterRAM || 0);
    if (!name) return { detected: false };
    const base = classifyGpu(name);
    if (!base.detected) return { detected: true, vendor: 'other', model: name, integrated: false };
    const integrated = INTEGRATED_RE.test(name);
    return {
      ...base, model: name, integrated,
      vramGB: integrated || !adapterBytes ? undefined : Math.round((adapterBytes / 1e9) * 10) / 10,
    };
  } catch { /* WMI probe failed / unavailable */ }

  // Nothing credible was observed — report not-detected (never guess a GPU).
  return { detected: false };
}

/** Default runner: real exec, short timeout, never throws to the caller silently. */
export const execRun: CommandRunner = (cmd, args) => {
  // Lazy require so the module loads fine where child_process is restricted.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execFileSync } = require('node:child_process');
  return execFileSync(cmd, args, { encoding: 'utf8', timeout: 6000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
};

/**
 * Detect the current device. All reads are best-effort and guarded; an
 * unavailable probe degrades to 0/false rather than throwing or guessing.
 * The accelerator is only probed when a `run` command-runner is supplied,
 * so unit tests of the pure classification logic never shell out.
 */
export function detectHardware({ os: osImpl = os, diskPath = process.cwd(), run }: ProbeContext = {}): HardwareProfile {
  const cores = osImpl.cpus?.() || [];
  const vendorHint = process.env.AKANSHA_GPU || ''; // only set if a real source provides it
  let gpu: HardwareProfile['gpu'] = vendorHint ? classifyGpu(vendorHint) : { detected: false };
  // Real probe (only when a runner is provided) upgrades/overrides the hint.
  if (run) { try { const probed = probeAccelerator(run); if (probed.detected) gpu = probed; } catch { /* keep hint */ } }
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

/** Production entry point: like detectHardware but performs the REAL accelerator probe. */
export function detectHardwareLive(run: CommandRunner = execRun): HardwareProfile {
  return detectHardware({ run });
}
