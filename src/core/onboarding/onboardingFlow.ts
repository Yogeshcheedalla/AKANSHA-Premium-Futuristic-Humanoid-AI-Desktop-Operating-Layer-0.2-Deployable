/**
 * Onboarding flow — the canonical Akansha journey as a PURE, testable model.
 *
 * It derives an ordered list of steps and each step's TRUTHFUL status from real
 * signals only (the existing SetupViewModel + voice + install results + auth +
 * persistence). It never invents readiness:
 *   • a model is READY only when an InstallResult reports usable=true (real inference)
 *   • voice is READY only when a real round-trip was verified
 *   • desktop control is only claimed on a platform that supports it
 *   • persistence reflects the actual DB state
 *
 * The UI (FirstRunOnboarding) renders this; it does not compute status itself.
 * No second orchestrator/router/memory — this only READS existing state.
 */
import type { SetupViewModel, InstallResult } from '@/core/aiSetup/types';

export type StepStatus = 'READY' | 'AVAILABLE' | 'PENDING' | 'BLOCKED' | 'UNAVAILABLE' | 'UNKNOWN';

export interface OnboardingStep {
  id: 'auth' | 'device' | 'capability' | 'voice' | 'mode' | 'models' | 'install' | 'complete';
  title: string;
  status: StepStatus;
  detail: string;
}

export interface OnboardingInput {
  authenticated: boolean;
  setup?: SetupViewModel | null;
  voice?: { available: boolean; verified: boolean };
  installResults?: Record<string, InstallResult>;
  persistenceEnabled?: boolean;
}

const localAiStatus = (s?: SetupViewModel | null): { status: StepStatus; detail: string } => {
  if (!s) return { status: 'UNKNOWN', detail: 'Detecting device…' };
  if (s.runtime.available && s.aiMode.offlineReady) return { status: 'READY', detail: `Local AI supported (${s.runtime.name})` };
  if (s.runtime.available) return { status: 'AVAILABLE', detail: `Runtime present; no model fits yet` };
  return { status: 'UNAVAILABLE', detail: 'No local runtime detected — cloud or install a runtime' };
};

export function deriveOnboardingSteps(input: OnboardingInput): OnboardingStep[] {
  const { authenticated, setup, voice, installResults = {}, persistenceEnabled = false } = input;
  const steps: OnboardingStep[] = [];

  steps.push({
    id: 'auth', title: 'Sign in',
    status: authenticated ? 'READY' : 'PENDING',
    detail: authenticated ? 'Authenticated with Google' : 'Sign in with Google to continue',
  });

  steps.push({
    id: 'device', title: 'Device detection',
    status: setup ? 'READY' : 'PENDING',
    detail: setup
      ? `${setup.device.platform} · ${setup.device.architecture} · ${setup.device.cpuCores} cores · ${setup.device.ramGB} GB RAM · ${setup.device.gpu.detected ? `GPU ${setup.device.gpu.vendor ?? ''}`.trim() : 'no dedicated GPU'} · ${setup.device.freeDiskGB} GB free`
      : 'Checking your hardware…',
  });

  const local = localAiStatus(setup);
  const cloud = !setup ? { status: 'UNKNOWN' as StepStatus, detail: '' }
    : setup.online.verified ? { status: 'READY' as StepStatus, detail: 'Cloud AI verified' }
    : setup.online.configured ? { status: 'AVAILABLE' as StepStatus, detail: 'Cloud AI configured' }
    : { status: 'UNAVAILABLE' as StepStatus, detail: 'Cloud AI not configured' };
  steps.push({
    id: 'capability', title: 'Your Akansha profile',
    status: setup ? 'READY' : 'PENDING',
    detail: `Local AI: ${local.detail} · Cloud: ${cloud.detail || '—'} · Desktop control: ${setup ? (setup.device.platform === 'win32' ? 'available (Windows)' : 'not on this device') : '—'}`,
  });

  // Voice: READY only on a real verified round-trip; never fake it.
  steps.push({
    id: 'voice', title: 'Voice (Qwen)',
    status: voice?.verified ? 'READY' : voice?.available ? 'PENDING' : 'UNAVAILABLE',
    detail: voice?.verified ? 'Voice session verified' : voice?.available ? 'Microphone available — run a voice test to verify' : 'No microphone/ASR available',
  });

  steps.push({
    id: 'mode', title: 'AI mode',
    status: setup ? 'AVAILABLE' : 'PENDING',
    detail: setup ? `Recommended: ${setup.aiMode.recommended.toUpperCase()} — ${setup.aiMode.reason}` : 'Choose Local / Cloud / Hybrid',
  });

  const runnable = setup ? setup.catalog.models.filter((m) => m.compatibility.runnable) : [];
  steps.push({
    id: 'models', title: 'Models for your device',
    status: !setup ? 'PENDING' : setup.catalog.status === 'not-configured' || setup.catalog.status === 'invalid'
      ? 'BLOCKED' : runnable.length ? 'READY' : 'UNAVAILABLE',
    detail: setup
      ? runnable.length ? `${runnable.length} compatible: ${runnable.slice(0, 5).map((m) => m.name).join(', ')}` : 'No model fits this device yet'
      : 'Loading catalog…',
  });

  // Install/READY: only a usable (inference-verified) model counts as READY.
  const usable = Object.values(installResults).some((r) => r.usable === true);
  const inFlight = Object.values(installResults).some((r) => !r.usable && !r.error && (r.stage === 'download' || r.stage === 'install' || r.stage === 'inference' || r.stage === 'benchmark' || r.stage === 'warmup' || r.stage === 'load'));
  steps.push({
    id: 'install', title: 'Model install & inference',
    status: usable ? 'READY' : inFlight ? 'PENDING' : runnable.length ? 'AVAILABLE' : 'UNAVAILABLE',
    detail: usable ? 'Model installed + inference verified' : inFlight ? 'Installing / verifying…' : runnable.length ? 'Ready to install a recommended model' : 'Nothing to install on this device',
  });

  steps.push({
    id: 'complete', title: 'Meet Akansha',
    status: authenticated && setup ? 'READY' : 'PENDING',
    detail: persistenceEnabled ? 'Durable memory synced (Postgres)' : 'Local memory active — cloud sync not configured',
  });

  return steps;
}
