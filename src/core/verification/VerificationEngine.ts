export interface VerificationResult {
  verified: boolean;
  expectedState: any;
  actualState: any;
  discrepancies: string[];
  confidence: number;
  timestamp: number;
}

export interface RecoveryPlan {
  originalGoal: string;
  failureReason: string;
  retryStrategy: 'retry_same' | 'retry_alternative' | 'replan' | 'escalate';
  alternativePlan?: string;
  maxRetries: number;
  retryDelayMs: number;
}

export class VerificationEngine {
  private auditLog: VerificationResult[] = [];

  verify(expectedState: any, actualState: any, confidenceThreshold: number = 0.8): VerificationResult {
    const discrepancies: string[] = [];
    
    // Simple comparison logic - in production, domain-specific verifiers
    if (typeof expectedState === 'object' && typeof actualState === 'object') {
      for (const key in expectedState) {
        if (expectedState[key] !== actualState[key]) {
          discrepancies.push(`Mismatch on ${key}: expected ${JSON.stringify(expectedState[key])}, got ${JSON.stringify(actualState[key])}`);
        }
      }
    } else if (expectedState !== actualState) {
      discrepancies.push(`State mismatch: expected ${expectedState}, got ${actualState}`);
    }
    
    const verified = discrepancies.length === 0;
    const result: VerificationResult = {
      verified,
      expectedState,
      actualState,
      discrepancies,
      confidence: verified ? 1.0 : Math.max(0, 1 - discrepancies.length * 0.2),
      timestamp: Date.now(),
    };
    
    this.auditLog.push(result);
    console.log(`[VERIFY] ${verified ? 'PASSED' : 'FAILED'} — discrepancies: ${discrepancies.length}`);
    return result;
  }

  createRecoveryPlan(originalGoal: string, failureReason: string): RecoveryPlan {
    const strategy = failureReason.includes('not found') ? 'retry_alternative' : 
                      failureReason.includes('permission') ? 'escalate' : 'retry_same';
    
    return {
      originalGoal,
      failureReason,
      retryStrategy: strategy,
      maxRetries: strategy === 'escalate' ? 0 : 3,
      retryDelayMs: strategy === 'retry_same' ? 500 : 2000,
    };
  }

  getAuditLog(): VerificationResult[] {
    return this.auditLog;
  }
}

export const verificationEngine = new VerificationEngine();
