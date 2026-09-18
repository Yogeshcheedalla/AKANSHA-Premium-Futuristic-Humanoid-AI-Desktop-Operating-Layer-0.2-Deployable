/**
 * Akansha Action Fabric — shared contracts.
 *
 * A reusable execution substrate so every capability follows the SAME path:
 *   authorize → execute → observe → VERIFY → (recover) → event → truthful status.
 *
 * It is NOT another orchestrator: it composes the existing authorities
 * (MasterOrchestrator, ModelRouter, PermissionEngine/RiskEngine, ExecutionLedger,
 * EventBus). Core principle enforced in code: provider output ≠ success,
 * HTTP 200 ≠ success, an LLM saying "done" ≠ success — only a verification
 * strategy with observed evidence yields COMPLETED.
 */

export type ActionStatus =
  | 'IDLE' | 'QUEUED' | 'RUNNING' | 'OBSERVED' | 'VERIFYING'
  | 'COMPLETED' | 'FAILED' | 'BLOCKED' | 'CANCELLED' | 'TIMED_OUT'
  | 'AUTH_REQUIRED' | 'CONFIG_REQUIRED' | 'UNAVAILABLE';

/** Truthful capability status — never invent READY without the real signals. */
export type CapabilityStatus =
  | 'READY' | 'RUNNING' | 'CONFIG_REQUIRED' | 'AUTH_REQUIRED'
  | 'BLOCKED' | 'FAILED' | 'UNAVAILABLE';

export type FailureCode =
  | 'AUTH_REQUIRED' | 'AUTH_FAILED' | 'PERMISSION_DENIED'
  | 'PROVIDER_UNAVAILABLE' | 'MODEL_UNAVAILABLE' | 'MODEL_INCOMPATIBLE'
  | 'VRAM_INSUFFICIENT' | 'RAM_INSUFFICIENT' | 'STORAGE_INSUFFICIENT'
  | 'DEPENDENCY_MISSING' | 'RUNTIME_MISSING' | 'RUNTIME_START_FAILED'
  | 'INFERENCE_FAILED' | 'TOOL_FAILED' | 'VERIFICATION_FAILED'
  | 'TIMEOUT' | 'RATE_LIMITED' | 'NETWORK_UNAVAILABLE'
  | 'DATABASE_UNAVAILABLE' | 'MCP_UNAVAILABLE' | 'USER_CANCELLED' | 'UNKNOWN';

export interface ActionRequest {
  actionId: string;
  requestId: string;          // idempotency key (ExecutionLedger)
  userId?: string;
  missionId?: string;
  capabilityId?: string;
  providerId?: string;
  agentId?: string;
  payload?: Record<string, unknown>;
  confirmed?: boolean;        // user already approved a confirmation-gated action
  createdAt?: number;
}

/** Observed proof that the operation actually happened. Required for success. */
export interface Evidence {
  kind: string;               // e.g. 'http', 'inference', 'file', 'window', 'tool'
  summary: string;            // human-readable, non-secret
  observed: boolean;          // was the effect actually observed (not just requested)?
  data?: Record<string, unknown>;
}

export interface Verification {
  verified: boolean;
  method: string;
  reason?: string;
}

export interface ActionFailure {
  code: FailureCode;
  stage: string;
  message: string;
  retryable: boolean;
}

export interface ActionResult {
  actionId: string;
  requestId: string;
  status: ActionStatus;
  startedAt: number;
  completedAt?: number;
  output?: unknown;
  evidence?: Evidence;
  verification?: Verification;
  failure?: ActionFailure;
  duplicate?: boolean;        // replayed from the execution ledger
}

/** A typed verification strategy: decides success from observed evidence only. */
export type VerificationStrategy = (ctx: {
  output?: unknown;
  evidence?: Evidence;
}) => Verification;

export interface ActionContract {
  actionId: string;
  capabilityId?: string;
  /** risk description handed to the existing RiskEngine (never a new risk model). */
  riskDescription?: string;
  requiresConfirmation?: boolean;
  /** performs the real operation; must return observed evidence to be verifiable. */
  execute: (req: ActionRequest) => Promise<{ output?: unknown; evidence?: Evidence; failure?: ActionFailure }>;
  /** decides COMPLETED vs FAILED(VERIFICATION_FAILED). Defaults to requiring observed evidence. */
  verify?: VerificationStrategy;
  /** optional safe recovery hook (retry/restart) — must not fabricate success. */
  recover?: (req: ActionRequest, failure: ActionFailure) => Promise<{ output?: unknown; evidence?: Evidence; failure?: ActionFailure } | null>;
}
