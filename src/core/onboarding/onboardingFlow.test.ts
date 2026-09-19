import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveOnboardingSteps, type OnboardingStep } from './onboardingFlow';
import type { SetupViewModel, InstallResult } from '@/core/aiSetup/types';

const byId = (steps: OnboardingStep[], id: string) => steps.find((s) => s.id === id)!;

function setup(over: Partial<SetupViewModel> = {}): SetupViewModel {
  return {
    device: { platform: 'win32', architecture: 'x64', cpuModel: 'Intel', cpuCores: 12, ramGB: 16.9, freeDiskGB: 59, gpu: { detected: true, vendor: 'intel' }, acceleration: ['cpu'], tier: 3 },
    runtime: { available: true, name: 'llama.cpp', supportsAcceleration: ['cpu'] },
    catalog: { status: 'ready', reasons: [], fixture: false, models: [
      { id: 'qwen1.5b', name: 'Qwen 2.5 1.5B', compatibility: { runnable: true, score: 90, rating: 'GOOD', reasons: [] }, installable: true } as any,
    ] },
    aiMode: { recommended: 'offline', offlineReady: true, reason: 'verified local model available' },
    online: { provider: 'openrouter', connected: false, verified: false, configured: false },
    readiness: { offline: 'READY', online: 'UNAVAILABLE' },
    ...over,
  } as SetupViewModel;
}

test('cold start (no setup, signed out) → nothing claims READY', () => {
  const s = deriveOnboardingSteps({ authenticated: false });
  assert.equal(byId(s, 'auth').status, 'PENDING');
  assert.equal(byId(s, 'device').status, 'PENDING');
  assert.equal(byId(s, 'models').status, 'PENDING');
  assert.equal(byId(s, 'install').status, 'UNAVAILABLE');
  assert.equal(byId(s, 'complete').status, 'PENDING');
});

test('model is NOT READY until an install result reports usable (real inference)', () => {
  const s = deriveOnboardingSteps({ authenticated: true, setup: setup(), voice: { available: true, verified: false } });
  assert.equal(byId(s, 'models').status, 'READY', 'a compatible model is offered');
  assert.equal(byId(s, 'install').status, 'AVAILABLE', 'installable but not yet READY');
  const s2 = deriveOnboardingSteps({ authenticated: true, setup: setup(), installResults: { 'qwen1.5b': { ok: true, usable: true, modelId: 'qwen1.5b' } as InstallResult } });
  assert.equal(byId(s2, 'install').status, 'READY', 'READY only after usable=true');
});

test('voice is NOT READY unless a real round-trip was verified', () => {
  const unverified = deriveOnboardingSteps({ authenticated: true, setup: setup(), voice: { available: true, verified: false } });
  assert.equal(byId(unverified, 'voice').status, 'PENDING');
  const noMic = deriveOnboardingSteps({ authenticated: true, setup: setup(), voice: { available: false, verified: false } });
  assert.equal(byId(noMic, 'voice').status, 'UNAVAILABLE');
  const verified = deriveOnboardingSteps({ authenticated: true, setup: setup(), voice: { available: true, verified: true } });
  assert.equal(byId(verified, 'voice').status, 'READY');
});

test('desktop control only claimed on a supporting platform', () => {
  const win = deriveOnboardingSteps({ authenticated: true, setup: setup() });
  assert.match(byId(win, 'capability').detail, /available \(Windows\)/);
  const lin = deriveOnboardingSteps({ authenticated: true, setup: setup({ device: { ...setup().device, platform: 'linux' } }) });
  assert.match(byId(lin, 'capability').detail, /not on this device/);
});

test('persistence is reported honestly, never "synced" when disabled', () => {
  const off = deriveOnboardingSteps({ authenticated: true, setup: setup(), persistenceEnabled: false });
  assert.match(byId(off, 'complete').detail, /cloud sync not configured/);
  const on = deriveOnboardingSteps({ authenticated: true, setup: setup(), persistenceEnabled: true });
  assert.match(byId(on, 'complete').detail, /Durable memory synced/);
});

test('unconfigured catalog blocks the models step (no fake recommendations)', () => {
  const s = deriveOnboardingSteps({ authenticated: true, setup: setup({ catalog: { status: 'not-configured', reasons: ['no catalog'], fixture: false, models: [] } }) });
  assert.equal(byId(s, 'models').status, 'BLOCKED');
});
