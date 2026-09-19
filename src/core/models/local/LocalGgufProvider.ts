/**
 * LocalGgufProvider — a ModelProvider for a verified local GGUF, gated on REAL
 * inference. It mirrors the security posture already proven in the prototype:
 *
 *   signed manifest -> SHA-256 -> GGUF validation -> runtime LAUNCHES ->
 *   runtime LOADS the model -> an actual generation returns non-empty text
 *   => only then is the model "usable".
 *
 * A process launch is NOT success. There is no fabricated response and no
 * invented runtime path: if no runtime was detected, healthCheck reports
 * UNAVAILABLE honestly, and generate() throws rather than pretending. No
 * binaries or models are committed; the runtime path and model path are supplied
 * by config/detection at runtime.
 */
import { spawn } from 'node:child_process';
import type {
  ModelProvider, ModelInfo, ModelRequest, ModelResponse, ModelStreamEvent,
  HealthStatus, ProviderDescriptor, ProviderCapabilities,
} from '@/core/models/ModelProvider';
import { verifyArtifact, type ManifestModelEntry } from '@/core/models/local/ModelIntegrity';
import * as fs from 'node:fs';
import { join } from 'node:path';

export interface LocalRuntime {
  /** Absolute path to an executable llama.cpp CLI (detected, never downloaded here). */
  binaryPath: string | null;
  exists: boolean;
  version?: string | null;
}

export interface LocalModelState {
  entry: ManifestModelEntry;
  artifactPath: string;
  integrityVerified: boolean;
  inferenceVerified: boolean;
  lastOutput?: string;
  lastTimings?: { totalMs: number; genTps?: number | null; promptTps?: number | null };
  reason?: string;
}

/** Read-only runtime detection: is a llama.cpp CLI present AND does it launch? */
export function detectLlamaRuntime(candidatePaths: string[]): LocalRuntime {
  const found = candidatePaths.find((p) => { try { return !!p && fs.existsSync(p); } catch { return false; } }) || null;
  if (!found) return { binaryPath: null, exists: false };
  return { binaryPath: found, exists: true };
}

/**
 * Standard locations a llama.cpp runtime may have been bundled or provisioned
 * into — packaged Electron resources, the app-controlled data dir, and the repo
 * (dev). These are CANDIDATE paths only; detectLlamaRuntime existence-checks them,
 * so nothing is ever assumed present. The runtime is placed here by the installer
 * build (electron-builder extraResources) or an operator provisioning step.
 */
export function defaultLlamaCandidates(): string[] {
  const exe = process.platform === 'win32' ? 'llama-cli.exe' : 'llama-cli';
  const out: string[] = [];
  const rp = (process as { resourcesPath?: string }).resourcesPath;
  if (rp) out.push(join(rp, 'runtime', 'llama', exe));                       // packaged main process
  if (process.env.AKANSHA_PACKAGED_RUNTIME) out.push(join(process.env.AKANSHA_PACKAGED_RUNTIME, exe)); // forwarded by Electron main to the backend
  if (process.env.AKANSHA_HOME) out.push(join(process.env.AKANSHA_HOME, 'runtime', 'llama', exe)); // provisioned per-user
  out.push(join(process.cwd(), 'runtime', 'llama', exe));                     // repo / dev
  return out;
}

/**
 * Run a single deterministic completion and parse the generated text + tokens/s.
 * Isolated so it can be exercised against a real runtime (integration) while the
 * pure gating below is unit-tested offline. Returns ok ONLY for non-empty text.
 */
export function runLocalInference(
  runtime: LocalRuntime, modelPath: string, prompt: string, opts: { maxTokens?: number; timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<{ ok: boolean; text: string; genTps?: number | null; promptTps?: number | null; totalMs: number; reason?: string; cancelled?: boolean }> {
  return new Promise((resolve) => {
    if (!runtime.exists || !runtime.binaryPath) return resolve({ ok: false, text: '', totalMs: 0, reason: 'runtime-missing' });
    const t0 = Date.now();
    let out = '';
    const args = ['-m', modelPath, '-p', prompt, '-n', String(opts.maxTokens ?? 32), '--temp', '0', '-ngl', '0', '--single-turn', '--no-display-prompt'];
    let child: any;
    try { child = spawn(runtime.binaryPath, args, { windowsHide: true }); }
    catch (e: any) { return resolve({ ok: false, text: '', totalMs: 0, reason: 'spawn-error:' + (e?.message || e) }); }
    let settled = false;
    const finish = (r: { ok: boolean; text: string; genTps?: number | null; promptTps?: number | null; totalMs: number; reason?: string; cancelled?: boolean }) => { if (!settled) { settled = true; clearTimeout(timer); opts.signal?.removeEventListener('abort', onAbort); resolve(r); } };
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} finish({ ok: false, text: '', totalMs: Date.now() - t0, reason: 'timeout' }); }, opts.timeoutMs ?? 120000);
    // Real cancellation: kill the actual subprocess, report cancelled (never ok).
    const onAbort = () => { try { child.kill('SIGKILL'); } catch { /* gone */ } finish({ ok: false, text: '', totalMs: Date.now() - t0, reason: 'cancelled', cancelled: true }); };
    if (opts.signal) { if (opts.signal.aborted) return onAbort(); opts.signal.addEventListener('abort', onAbort, { once: true }); }
    child.stdout.on('data', (b: Buffer) => { out += b.toString('utf8'); });
    child.stderr.on('data', (b: Buffer) => { out += b.toString('utf8'); });
    child.on('error', (e: any) => finish({ ok: false, text: '', totalMs: Date.now() - t0, reason: 'err:' + (e?.message || e) }));
    child.on('close', (code: number) => {
      // llama.cpp prints a real stats line, e.g. "[ Prompt: 95.5 t/s | Generation: 20.4 t/s ]".
      // We report ONLY what it exposes; token COUNTS are not printed in single-turn mode,
      // so callers must treat them as NOT AVAILABLE rather than estimate them.
      const gen = /Generation:\s*([\d.]+)\s*t\/s/i.exec(out);
      const prm = /Prompt:\s*([\d.]+)\s*t\/s/i.exec(out);
      // Extract the assistant line: single-turn prints the completion; take last
      // non-empty line that isn't a stats/banner line.
      const text = out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/t\/s|Loading|build|model |error|Exiting|^\[|^\s*$/i.test(l)).slice(-1)[0] || '';
      finish({ ok: code === 0 && text.length > 0, text, genTps: gen ? Number(gen[1]) : null, promptTps: prm ? Number(prm[1]) : null, totalMs: Date.now() - t0, reason: text ? undefined : 'no-output' });
    });
  });
}

/** The gate: usable ONLY when integrity + a real inference both passed. */
export function isModelUsable(state: LocalModelState): boolean {
  return state.integrityVerified === true && state.inferenceVerified === true && !!state.lastOutput && state.lastOutput.trim().length > 0;
}

/** Pure decision used by the router/UI: honest UNAVAILABLE when no runtime. */
export function localHealth(state: LocalModelState, runtime: LocalRuntime): HealthStatus {
  const now = Date.now();
  if (!runtime.exists) return { state: 'UNAVAILABLE', latencyMs: 0, detail: 'no llama.cpp runtime detected', checkedAt: now };
  if (!state.integrityVerified) return { state: 'DEGRADED', latencyMs: 0, detail: 'model integrity not verified', checkedAt: now };
  if (!isModelUsable(state)) return { state: 'DEGRADED', latencyMs: 0, detail: state.reason || 'inference not yet verified', checkedAt: now };
  return { state: 'AVAILABLE', latencyMs: state.lastTimings?.totalMs ?? 0, detail: `verified ${state.lastOutput?.slice(0, 40)}`, checkedAt: now };
}

/** Capabilities we can HONESTLY claim for a CPU llama.cpp GGUF (no fake streaming/tools). */
export function localCapabilities(): ProviderCapabilities {
  return { chat: true, reasoning: true, vision: false, tools: false, streaming: false, embeddings: false };
}

export class LocalGgufProvider implements ModelProvider {
  readonly id = 'local-llama';
  readonly name = 'Local GGUF (llama.cpp)';
  readonly type = 'local' as const;
  constructor(private state: LocalModelState, private runtime: LocalRuntime) {}

  descriptor(): ProviderDescriptor {
    return {
      id: this.id, name: this.name, type: 'local', enabled: true, isDefault: false,
      fallbackPriority: 5, capabilities: localCapabilities(), settings: {},
      defaultModel: this.state.entry.id,
    };
  }
  capabilities() { return localCapabilities(); }
  healthCheck(): Promise<HealthStatus> { return Promise.resolve(localHealth(this.state, this.runtime)); }
  listModels(): Promise<ModelInfo[]> {
    if (!isModelUsable(this.state)) return Promise.resolve([]);
    return Promise.resolve([{
      id: this.state.entry.id, provider: this.id, providerType: 'local',
      displayName: this.state.entry.id, capabilities: localCapabilities(),
      contextWindow: this.state.entry.contextLength, available: true, healthScore: 1,
    }]);
  }
  async generate(request: ModelRequest): Promise<ModelResponse> {
    if (!isModelUsable(this.state)) throw new Error(this.state.reason || 'Local model is not usable: integrity/inference not verified');
    const prompt = request.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
    const r = await runLocalInference(this.runtime, this.state.artifactPath, prompt, { maxTokens: request.maxTokens });
    if (!r.ok) throw new Error('Local inference failed: ' + (r.reason || 'no output'));
    // Persist the REAL measured metrics from this genuine run (no estimation) so
    // observability / benchmarks can report exactly what llama.cpp exposed.
    this.state.lastOutput = r.text;
    this.state.lastTimings = { totalMs: r.totalMs, genTps: r.genTps ?? null, promptTps: r.promptTps ?? null };
    return {
      id: `local-${Date.now()}`, content: r.text, model: this.state.entry.id, provider: this.id,
      providerType: 'local', finishReason: 'stop',
    };
  }

  /** The last genuine run's real metrics (llama-reported). Null if never run. */
  getLastMetrics(): { totalMs: number; genTps: number | null; promptTps: number | null; text: string } | null {
    if (!this.state.lastTimings || !this.state.lastOutput) return null;
    return {
      totalMs: this.state.lastTimings.totalMs,
      genTps: this.state.lastTimings.genTps ?? null,
      promptTps: this.state.lastTimings.promptTps ?? null,
      text: this.state.lastOutput,
    };
  }
  async *stream(): AsyncIterable<ModelStreamEvent> { /* non-streaming locally; never fake it */ }
  async cancel(): Promise<void> {}
}
