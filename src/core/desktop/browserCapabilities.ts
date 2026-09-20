/**
 * Browser capability behind the EXISTING Action Fabric (not a second engine).
 *
 * `browser.navigate` opens a URL in a browser with an EXPLICIT, typed request:
 *   { url, browser? }
 * - When a browser is named (e.g. "in brave"), it MUST be that browser. If it is
 *   not installed, the action fails APP_NOT_FOUND — it NEVER silently falls back
 *   to Edge/Chrome/default. (This is the exact bug where "open youtube in brave"
 *   reported "Edge did not start".)
 * - When no browser is named, the OS default browser is used via explorer.exe
 *   (a fixed exe + a validated URL argument — never shell string interpolation).
 *
 * COMPLETED requires observed evidence: the specific browser process is running
 * (and, best-effort, a window whose title references the target host).
 */
import { actionRegistry, type ActionRegistry } from '@/core/actions/ActionRegistry';
import type { ActionRequest, Evidence, FailureCode } from '@/core/actions/types';
import { resolveApplication, isSafeUrl } from '@/core/execution/applicationResolver';
import { windowsComputerUseProvider } from '@/core/execution/WindowsComputerUseProvider';

const ALL_BROWSER_PROCS = ['msedge', 'chrome', 'brave', 'firefox'];

interface BrowserProvider {
  launchExe(exe: string, args: string[], titleHint: string): Promise<{ found: boolean; processAlive?: boolean; pid?: number; title?: string | null }>;
  processExists(names: string[]): Promise<{ running: boolean; pid?: number }>;
}

export function registerBrowserCapabilities(deps: {
  registry?: ActionRegistry;
  resolve?: (q: string, o?: { browserOnly?: boolean }) => Promise<{ executable: string; processName: string; titleHint: string } | null>;
  provider?: BrowserProvider;
} = {}) {
  const registry = deps.registry ?? actionRegistry;
  const resolve = deps.resolve ?? ((q: string, o?: { browserOnly?: boolean }) => resolveApplication(q, o));
  const provider = deps.provider ?? windowsComputerUseProvider;

  const fail = (code: FailureCode, stage: string, message: string) =>
    ({ evidence: { kind: 'process', observed: false, summary: message } as Evidence, failure: { code, stage, message, retryable: false } });

  registry.register({
    actionId: 'browser.navigate',
    capabilityId: 'browser.control',
    requiresConfirmation: true, // opens an external program → authorization via the fabric
    execute: async (req: ActionRequest) => {
      const p = req.payload || {};
      const url = String(p.url || '');
      const browser = p.browser ? String(p.browser) : '';
      if (!isSafeUrl(url)) return fail('UNKNOWN', 'validate', 'A valid http(s) URL is required.');

      let exe = '';
      let procNames = ALL_BROWSER_PROCS;
      let titleHint = '';

      if (browser) {
        const r = await resolve(browser, { browserOnly: true });
        if (!r) return fail('APP_NOT_FOUND', 'resolve', `${browser} is not installed or could not be resolved. I will not substitute another browser.`);
        exe = r.executable;
        procNames = [r.processName];
        titleHint = r.titleHint;
      } else {
        // OS default browser via explorer.exe (fixed exe + validated URL arg).
        exe = 'explorer.exe';
        titleHint = '';
      }

      const obs = await provider.launchExe(exe, [url], titleHint);
      // Verify the SPECIFIC browser process is actually running.
      const pe = await provider.processExists(procNames);
      if (!pe.running) {
        return fail('RUNTIME_START_FAILED', 'verify', `${browser || 'A browser'} did not start (no ${procNames.join('/')} process observed).`);
      }
      const host = (() => { try { return new URL(url).hostname; } catch { return url; } })();
      const evidence: Evidence = {
        kind: 'process', observed: true,
        summary: `opened ${url} in ${browser || 'default browser'}${pe.pid ? ` (pid ${pe.pid})` : ''}${obs.title ? ` — window "${obs.title}"` : ''}`,
        data: { url, browser: browser || 'default', executable: exe, pid: pe.pid ?? null, windowTitle: obs.title ?? null, host },
      };
      return { output: { ...obs, pid: pe.pid }, evidence };
    },
    verify: ({ evidence }) => evidence && evidence.observed && evidence.kind === 'process' && !!evidence.data
      ? { verified: true, method: 'browserProcessObserved', reason: evidence.summary }
      : { verified: false, method: 'browserProcessObserved', reason: 'No observed browser-process evidence' },
  });

  registry.register({
    actionId: 'desktop.app.launchResolved',
    capabilityId: 'desktop.control',
    requiresConfirmation: true,
    execute: async (req: ActionRequest) => {
      const p = req.payload || {};
      const exe = String(p.executable || '');
      const procName = String(p.processName || '');
      const titleHint = String(p.titleHint || '');
      const args = Array.isArray(p.arguments) ? (p.arguments as string[]).map(String).filter((a) => !/[;&|<>`$\n\r]/.test(a)) : [];
      // The router supplies a DISCOVERED real path; validate it is a plain .exe
      // with no shell metacharacters (defense in depth — never arbitrary shell).
      if (!/\.exe$/i.test(exe) || /[;&|<>`$\n\r]/.test(exe) || !procName || /[;&|<>`$\n\r]/.test(procName)) {
        return fail('UNKNOWN', 'validate', 'A resolved executable and process name are required.');
      }
      const obs = await provider.launchExe(exe, args, titleHint);
      const pe = await provider.processExists([procName]);
      if (!pe.running) return fail('RUNTIME_START_FAILED', 'verify', `${p.label || procName} did not start (no ${procName} process observed).`);
      const evidence: Evidence = {
        kind: 'process', observed: true,
        summary: `launched ${p.label || procName} (pid ${pe.pid ?? obs.pid ?? '?'})`,
        data: { executable: exe, processName: procName, pid: pe.pid ?? obs.pid ?? null, title: obs.title ?? null },
      };
      return { output: { ...obs, pid: pe.pid ?? obs.pid }, evidence };
    },
    verify: ({ evidence }) => evidence && evidence.observed && evidence.kind === 'process' && !!evidence.data
      ? { verified: true, method: 'processObserved', reason: evidence.summary }
      : { verified: false, method: 'processObserved', reason: 'No observed process evidence' },
  });

  return registry;
}

if (typeof process !== 'undefined' && process.env.AKANSHA_SKIP_DESKTOP_SELFREGISTER !== '1') {
  registerBrowserCapabilities();
}
