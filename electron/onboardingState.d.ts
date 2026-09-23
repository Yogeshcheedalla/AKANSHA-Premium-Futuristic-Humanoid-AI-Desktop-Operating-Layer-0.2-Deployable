// Type declarations for the plain-JS durable onboarding-state module so the
// Electron main process (JS) and the TS test suite share one contract.

export interface OnboardingReadResult {
  onboarded: boolean;
  version: number;
  completedAt: string | null;
  /** true when the file exists but is unparseable (recoverable, not complete). */
  recoverable: boolean;
}

export interface OnboardingCompleteResult {
  onboarded: true;
  version: number;
  completedAt: string;
  recoverable: false;
}

export declare const FILE: string;
export declare const VERSION: number;
export declare function statePath(userDataDir: string): string;
export declare function readOnboarding(userDataDir: string): OnboardingReadResult;
export declare function completeOnboarding(userDataDir: string, appVersion?: string): OnboardingCompleteResult;
