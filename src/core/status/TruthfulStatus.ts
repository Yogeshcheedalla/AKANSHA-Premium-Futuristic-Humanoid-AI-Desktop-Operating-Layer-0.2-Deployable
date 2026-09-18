import type { CapabilityStatus } from '../actions/types';

/**
 * Truthful status derivation — the UI must consume THIS, never invent its own
 * "READY"/"online"/"connected". READY requires every real signal (registered,
 * configured, credential present, health ok, and a passing test). Anything short
 * maps to an honest non-ready state.
 */
export interface CapabilitySignals {
  registered: boolean;
  configured: boolean;
  credentialPresent: boolean;
  healthOk: boolean;
  testPassed: boolean;
  running?: boolean;
  failed?: boolean;
}

export function deriveCapabilityStatus(s: CapabilitySignals): CapabilityStatus {
  if (!s.registered) return 'UNAVAILABLE';
  if (s.failed) return 'FAILED';
  if (!s.configured) return 'CONFIG_REQUIRED';
  if (!s.credentialPresent) return 'AUTH_REQUIRED';
  if (!s.healthOk) return 'BLOCKED';
  if (!s.testPassed) return 'CONFIG_REQUIRED'; // configured but not verified → NOT ready
  if (s.running) return 'RUNNING';
  return 'READY';
}
