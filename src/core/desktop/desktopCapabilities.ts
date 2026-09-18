import { actionRegistry, type ActionRegistry } from '@/core/actions/ActionRegistry';
import type { ActionRequest, Evidence, FailureCode } from '@/core/actions/types';
import { resolveApp, expandEnv, type AppSpec } from '@/core/execution/appRegistry';
import { windowsComputerUseProvider } from '@/core/execution/WindowsComputerUseProvider';
import type { ProcessCloseResult } from '@/core/execution/types';

/** Shell metacharacters are NEVER allowed in an application name — resolution is by
 *  allowlist alias to a fixed exe, never by interpolating user text into a shell. */
const SHELL_METACHARS = /[;&|<>`$\n\r]|\|\||&&/;
export function isSafeAppName(s: unknown): s is string {
  return typeof s === 'string' && s.trim().length > 0 && s.length <= 64 && !SHELL_METACHARS.test(s);
}

/** Truthful platform status for desktop control (Windows-only this phase). */
export function desktopControlStatus(platform: string = process.platform): 'READY' | 'UNAVAILABLE' {
  return platform === 'win32' ? 'READY' : 'UNAVAILABLE';
}

interface Launcher { launch(app: string): Promise<{ found: boolean; pid?: number; title?: string }>; }
interface Closer { close(app: string): Promise<ProcessCloseResult>; }
interface Focuser { focus(app: string): Promise<{ found: boolean; foreground?: boolean; title?: string; foregroundPid?: number; targetPid?: number }>; }

/**
 * Register the real Windows desktop capabilities `desktop.app.launch` and
 * `desktop.app.close` through the existing Action Fabric. They reuse the real
 * resolver + Win32 provider; success requires OBSERVED evidence (a real
 * process appearing / disappearing), never "the call returned".
 */
export function registerDesktopCapabilities(deps: {
  registry?: ActionRegistry;
  resolve?: (q: string) => AppSpec | null;
  launcher?: Launcher;
  closer?: Closer;
  focuser?: Focuser;
  platform?: string;
} = {}) {
  const registry = deps.registry ?? actionRegistry;
  const resolve = deps.resolve ?? resolveApp;
  const launcher = deps.launcher ?? windowsComputerUseProvider;
  const closer = deps.closer ?? windowsComputerUseProvider;
  const focuser = deps.focuser ?? windowsComputerUseProvider;
  const platform = deps.platform ?? process.platform;

  const fail = (code: FailureCode, stage: string, message: string) =>
    ({ evidence: { kind: 'process', observed: false, summary: message } as Evidence, failure: { code, stage, message, retryable: false } });

  // ── desktop.app.launch ────────────────────────────────────────────────
  registry.register({
    actionId: 'desktop.app.launch',
    capabilityId: 'desktop.control',
    requiresConfirmation: true, // OS-level action → explicit authorization via the fabric
    execute: async (req: ActionRequest) => {
      const app = (req.payload || {}).application;
      if (platform !== 'win32') return fail('DESKTOP_CONTROL_UNAVAILABLE', 'platform', 'Desktop control is Windows-only in this build.');
      if (!isSafeAppName(app)) return fail('UNKNOWN', 'validate', 'Application name is empty or contains disallowed characters.');
      if (desktopControlStatus(platform) !== 'READY') return fail('DESKTOP_CONTROL_UNAVAILABLE', 'platform', 'Desktop control unavailable.');

      const spec = resolve(app);
      if (!spec) return fail('APP_NOT_FOUND', 'resolve', `Application not found in the allowed registry: ${app}`);

      const obs = await launcher.launch(app);
      if (!obs.found) return fail('RUNTIME_START_FAILED', 'execute', `${app} did not start (no window/process observed).`);

      const evidence: Evidence = {
        kind: 'process', observed: true,
        summary: `launched ${app}${obs.pid ? ` (pid ${obs.pid})` : ''}${obs.title ? ` — "${obs.title}"` : ''}`,
        data: { app, pid: obs.pid ?? null, executable: expandEnv(spec.exe), title: obs.title ?? null },
      };
      return { output: obs, evidence };
    },
    // COMPLETED only if a real process/window was observed for the requested app.
    verify: ({ evidence }) => evidence && evidence.observed && evidence.kind === 'process' && !!evidence.data
      ? { verified: true, method: 'processObserved', reason: evidence.summary }
      : { verified: false, method: 'processObserved', reason: 'No observed process/window evidence' },
  });

  // ── desktop.app.close ─────────────────────────────────────────────────
  registry.register({
    actionId: 'desktop.app.close',
    capabilityId: 'desktop.control',
    requiresConfirmation: true, // terminates a running process → explicit authorization
    execute: async (req: ActionRequest) => {
      const app = (req.payload || {}).application;
      if (platform !== 'win32') return fail('DESKTOP_CONTROL_UNAVAILABLE', 'platform', 'Desktop control is Windows-only in this build.');
      if (!isSafeAppName(app)) return fail('UNKNOWN', 'validate', 'Application name is empty or contains disallowed characters.');
      if (desktopControlStatus(platform) !== 'READY') return fail('DESKTOP_CONTROL_UNAVAILABLE', 'platform', 'Desktop control unavailable.');

      const spec = resolve(app);
      if (!spec) return fail('APP_NOT_FOUND', 'resolve', `Application not found in the allowed registry: ${app}`);
      if (!spec.processName) return fail('APP_BLOCKED', 'resolve', `${app} has no resolvable process name to close.`);

      const r = await closer.close(app);
      // Nothing was running → cannot claim we closed something (truthful, not a fake success).
      if (!r.wasRunning) return fail('APP_NOT_FOUND', 'execute', `${app} is not currently running.`);
      // Was running but survived the terminate attempt (e.g. respawn) → NOT closed.
      if (!r.closed) {
        return fail('VERIFICATION_FAILED', 'verify', `${app} did not terminate (still running: pid ${r.remainingPids.join(', ')}).`);
      }

      const evidence: Evidence = {
        kind: 'process', observed: true,
        summary: `closed ${app}${r.killedPid ? ` (pid ${r.killedPid})` : ''} — process no longer observed`,
        data: { app, killedPid: r.killedPid ?? null, processName: spec.processName, executable: expandEnv(spec.exe) },
      };
      return { output: r, evidence };
    },
    // COMPLETED only if the process was OBSERVED to terminate.
    verify: ({ evidence }) => evidence && evidence.observed && evidence.kind === 'process' && !!evidence.data
      ? { verified: true, method: 'processTerminated', reason: evidence.summary }
      : { verified: false, method: 'processTerminated', reason: 'No observed process-termination evidence' },
  });

  // ── desktop.window.focus ──────────────────────────────────────────────
  registry.register({
    actionId: 'desktop.window.focus',
    capabilityId: 'desktop.control',
    requiresConfirmation: true, // changes OS foreground → authorization through the fabric
    execute: async (req: ActionRequest) => {
      const app = (req.payload || {}).application;
      if (platform !== 'win32') return fail('DESKTOP_CONTROL_UNAVAILABLE', 'platform', 'Desktop control is Windows-only in this build.');
      if (!isSafeAppName(app)) return fail('UNKNOWN', 'validate', 'Application name is empty or contains disallowed characters.');
      if (desktopControlStatus(platform) !== 'READY') return fail('DESKTOP_CONTROL_UNAVAILABLE', 'platform', 'Desktop control unavailable.');

      const spec = resolve(app);
      if (!spec) return fail('APP_NOT_FOUND', 'resolve', `Application not found in the allowed registry: ${app}`);

      const obs = await focuser.focus(app);
      if (!obs.found) return fail('APP_NOT_FOUND', 'execute', `${app} has no open window to focus.`);
      if (!obs.foreground) return fail('VERIFICATION_FAILED', 'verify', `${app}'s window was not confirmed as the foreground window.`);

      const evidence: Evidence = {
        kind: 'window', observed: true,
        summary: `focused ${app}${obs.title ? ` — "${obs.title}"` : ''} (foreground pid ${obs.foregroundPid})`,
        data: { app, title: obs.title ?? null, foregroundPid: obs.foregroundPid ?? null, targetPid: obs.targetPid ?? null },
      };
      return { output: obs, evidence };
    },
    // COMPLETED only if the target window was OBSERVED in the foreground.
    verify: ({ evidence }) => evidence && evidence.observed && evidence.kind === 'window' && !!evidence.data
      ? { verified: true, method: 'foregroundObserved', reason: evidence.summary }
      : { verified: false, method: 'foregroundObserved', reason: 'No observed foreground-window evidence' },
  });

  return registry;
}

// Register on the real singleton so the fabric actually exposes these capabilities
// at runtime (mirrors how capabilities.ts self-registers memory.write on import).
// Tests pass an injected fake registry and are unaffected by this default call.
if (typeof process !== 'undefined' && process.env.AKANSHA_SKIP_DESKTOP_SELFREGISTER !== '1') {
  registerDesktopCapabilities();
}
