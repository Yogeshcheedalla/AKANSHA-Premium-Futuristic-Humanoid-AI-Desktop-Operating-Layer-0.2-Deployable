import { actionRegistry, type ActionRegistry } from '@/core/actions/ActionRegistry';
import type { ActionRequest, Evidence, FailureCode } from '@/core/actions/types';
import { resolveApp, expandEnv, type AppSpec } from '@/core/execution/appRegistry';
import { windowsComputerUseProvider } from '@/core/execution/WindowsComputerUseProvider';

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

/**
 * Register the FIRST real Windows desktop capability `desktop.app.launch` through the
 * existing Action Fabric. It reuses the real resolver + Win32 provider; success requires
 * OBSERVED evidence (a real window/process), never "spawn returned".
 */
export function registerDesktopCapabilities(deps: {
  registry?: ActionRegistry;
  resolve?: (q: string) => AppSpec | null;
  launcher?: Launcher;
  platform?: string;
} = {}) {
  const registry = deps.registry ?? actionRegistry;
  const resolve = deps.resolve ?? resolveApp;
  const launcher = deps.launcher ?? windowsComputerUseProvider;
  const platform = deps.platform ?? process.platform;

  registry.register({
    actionId: 'desktop.app.launch',
    capabilityId: 'desktop.control',
    requiresConfirmation: true, // OS-level action → explicit authorization via the fabric
    execute: async (req: ActionRequest) => {
      const app = (req.payload || {}).application;
      const fail = (code: FailureCode, stage: string, message: string) =>
        ({ evidence: { kind: 'process', observed: false, summary: message } as Evidence, failure: { code, stage, message, retryable: false } });

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
  return registry;
}
