/**
 * RuntimeManager — the RUNTIME layer, kept deliberately separate from models
 * ("Runtime ≠ Model"). It tracks which inference runtimes are installed and
 * healthy so a model can be updated independently of its runtime and vice versa.
 *
 * No downloads happen here: it only records + validates runtimes the operator/
 * installer already placed, and answers "can I run <model> right now?". The only
 * built-in adapter today is llama.cpp; the shape is extensible for future
 * runtimes without touching the model layer.
 */
import { detectLlamaRuntime } from '@/core/models/local/LocalGgufProvider';
import type { LocalRuntime } from '@/core/models/local/LocalGgufProvider';

export interface RuntimeAdapter {
  name: string;                       // 'llama.cpp'
  supportsAcceleration: string[];     // ['cpu','cuda',...]
  /** Candidate executable locations for this platform. */
  candidateBinaries: string[];
}

export interface InstalledRuntime {
  adapter: RuntimeAdapter;
  detect: LocalRuntime;               // path + exists (+ version filled by a probe)
  healthy: boolean;
}

const LLAMA_CPP: RuntimeAdapter = {
  name: 'llama.cpp',
  supportsAcceleration: ['cpu', 'cuda', 'metal', 'vulkan'],
  candidateBinaries: [], // populated per-platform by the caller (config), never assumed
};

export const KNOWN_RUNTIMES: RuntimeAdapter[] = [LLAMA_CPP];

/**
 * Discover installed runtimes from the GIVEN candidate paths only. It never
 * invents a runtime: if nothing launches, the adapter reports not-healthy, and
 * consumers (ModelManager, AiMode) must then NOT offer offline.
 */
export function detectRuntimes(candidatesByRuntime: Record<string, string[]> = {}): InstalledRuntime[] {
  return KNOWN_RUNTIMES.map((adapter) => {
    const paths = candidatesByRuntime[adapter.name] ?? adapter.candidateBinaries;
    const detect = detectLlamaRuntime(paths);
    return { adapter, detect, healthy: detect.exists };
  });
}

export function runtimeFor(adapter: InstalledRuntime | undefined): { available: boolean; name: string; supportsAcceleration: string[]; version?: string } {
  if (!adapter) return { available: false, name: 'none', supportsAcceleration: [] };
  return { available: adapter.healthy, name: adapter.adapter.name, supportsAcceleration: adapter.adapter.supportsAcceleration, version: adapter.detect.version ?? undefined };
}
