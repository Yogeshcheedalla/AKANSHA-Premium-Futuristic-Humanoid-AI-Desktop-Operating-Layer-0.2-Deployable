import { eventBus } from '../events/EventBus';

/* ═══════════════ TRUST LEVELS ═══════════════ */

export type TrustLevel =
  | 'TRUSTED'
  | 'VERIFIED'
  | 'USER_AUTHORED'
  | 'CONNECTED_PROVIDER'
  | 'KNOWN_APPLICATION'
  | 'EXTERNAL_CONTENT'
  | 'UNKNOWN'
  | 'UNTRUSTED';

/** Numeric weight per trust level — external content can never outrank the user. */
export const TRUST_WEIGHT: Record<TrustLevel, number> = {
  TRUSTED: 1.0,
  USER_AUTHORED: 1.0,
  VERIFIED: 0.85,
  CONNECTED_PROVIDER: 0.7,
  KNOWN_APPLICATION: 0.6,
  EXTERNAL_CONTENT: 0.15,
  UNKNOWN: 0.1,
  UNTRUSTED: 0,
};

/* ═══════════════ RISK ENGINE ═══════════════ */

export type RiskAction = 'AUTOMATIC' | 'AUTOMATIC_LOGGED' | 'ASK' | 'STRONG_CONFIRMATION' | 'DENY';

export interface RiskFactors {
  irreversibility: number;      // 0-1 — can this be undone?
  externalVisibility: number;   // 0-1 — does the world see it?
  financialImpact: number;      // 0-1 — money involved?
  privacy: number;              // 0-1 — sensitive data touched?
  accountPermissions: number;   // 0-1 — privileged scopes?
  dataSensitivity: number;      // 0-1 — secrets / credentials / PII?
  confidence: number;           // 0-1 — how sure are we?
  novelty: number;              // 0-1 — never done this before?
  historicalSuccess: number;    // 0-1 — has it worked before?
  trustLevel: TrustLevel;
}

/** Actions that are ALWAYS high-risk regardless of score. */
/**
 * Hard security rules. Patterns are written with bounded gaps (`[^.]{0,N}`)
 * rather than strict adjacency so that natural phrasing such as
 * "drop the production database" cannot slip past a rule written for
 * "drop database".
 */
/**
 * Verb stems with trailing-word-chars so inflections match:
 * "removing", "deleted", "formats", "truncating" all hit.
 * `\bremove\b` alone would MISS "removing" — a real bypass.
 */
const DESTROY = '(?:delet\\w*|remov\\w*|destroy\\w*|drop|dropp\\w*|truncat\\w*|format\\w*|wip\\w*|purg\\w*|eras\\w*|reset|clear\\w*|empty\\w*|flush\\w*|free\\s+up|get\\s+rid\\s+of|nuke|obliterat\\w*)';
const BULK_TARGET = '(?:databas\\w*|\\bdbs?\\b|tables?|schemas?|repos?|repositor\\w*|buckets?|volumes?|disks?|drives?|clusters?|namespaces?|collections?|index\\w*|everythings?|all\\s+of\\s+it|all\\s+data|all\\s+files?|the\\s+whole\\s+thing|all\\s+of\\s+them)';
const STORAGE = '(?:disks?|drives?|volumes?|partitions?|ssds?|hdds?|usbs?|c\\s?:\\s?drive)';
const FINANCIAL = '(?:purchas\\w*|checkout|buy\\w*|transferr?\\w*|send\\w*|pay\\w*|wire\\w*|deposit\\w*|subscribe|renew\\w*|order\\w*)';
const MONEY = '(?:money|payment\\w*|funds?|invoice\\w*|orders?|subscription\\w*|item|product|cart|bills?|fees?|amounts?)';
const CRED = '(?:pass\\s?-?\\s?words?|pass\\s?-?\\s?phrases?|pw|pwds?|secrets?|api\\s?-?\\s?keys?|access\\s?-?\\s?tokens?|auth\\s?-?\\s?tokens?|credentials?|otps?|tokens?)';

const HARD_RULES: Array<{ test: RegExp; action: RiskAction; reason: string }> = [
  // ── DENY rules FIRST so irreversibility is never downgraded to "confirm" ──
  { test: new RegExp(`\\b(?:format|wip|eras)\\w*\\b[^.]{0,40}\\b${STORAGE}`, 'i'), action: 'DENY', reason: 'irreversible storage destruction' },
  { test: new RegExp(`\\b${STORAGE}\\b[^.]{0,40}\\b(?:format|wip|eras)\\w*`, 'i'), action: 'DENY', reason: 'irreversible storage destruction' },

  // ── Destructive verbs aimed at bulk/structural targets ──
  { test: new RegExp(`\\b${DESTROY}\\b[^.]{0,60}\\b${BULK_TARGET}`, 'i'), action: 'STRONG_CONFIRMATION', reason: 'destructive bulk operation' },
  { test: new RegExp(`\\b${BULK_TARGET}\\b[^.]{0,60}\\b${DESTROY}`, 'i'), action: 'STRONG_CONFIRMATION', reason: 'destructive bulk operation' },
  // "removing everything in it" — pronoun/vague object with no named target
  { test: new RegExp(`\\b${DESTROY}\\b[^.]{0,20}\\beverythings?\\b`, 'i'), action: 'STRONG_CONFIRMATION', reason: 'destructive bulk operation' },

  // ── Financial ──
  { test: new RegExp(`\\b${FINANCIAL}\\b[^.]{0,50}\\b${MONEY}\\b`, 'i'), action: 'STRONG_CONFIRMATION', reason: 'financial transaction' },
  { test: new RegExp(`\\b${MONEY}\\b[^.]{0,50}\\b${FINANCIAL}\\b`, 'i'), action: 'STRONG_CONFIRMATION', reason: 'financial transaction' },
  // "complete checkout" / "place the order" alone are financial
  { test: /\b(?:complete|finish|confirm|process|place)\b[^.]{0,20}\b(?:checkout|order|payment|purchase)\b/i, action: 'STRONG_CONFIRMATION', reason: 'financial transaction' },

  // ── Credentials ──
  { test: new RegExp(`\\b${CRED}\\b`, 'i'), action: 'STRONG_CONFIRMATION', reason: 'credential access' },
  { test: /\b(?:read|show|print|reveal|display|output|log)\w*\b[^.]{0,20}\b(?:the\s+)?(?:token|key|secret|credential|otp)\b/i, action: 'STRONG_CONFIRMATION', reason: 'credential access' },

  // ── Privileged access ──
  { test: /\b(?:ssh|rdp|remote\s?desktop)\b[^.]{0,30}\b(?:production|prod|live)\b/i, action: 'STRONG_CONFIRMATION', reason: 'production access' },
  { test: /\b(?:kill|terminate|shutdown|reboot|restart|halt)\w*\b[^.]{0,40}\b(?:server|production|prod|node|cluster|service|instance)\b/i, action: 'ASK', reason: 'service availability' },
  { test: /\b(?:registry|regedit|group\s?_?\s?policy|uac)\b/i, action: 'STRONG_CONFIRMATION', reason: 'system configuration' },
  // Publishing / external visibility
  { test: /\b(?:post|publish|tweet|share|upload|make\s+public)\w*\b[^.]{0,30}\b(?:private|personal|sensitive|confidential|secret)\b/i, action: 'STRONG_CONFIRMATION', reason: 'publishing private data' },
];

export interface RiskAssessment {
  score: number;          // 0-100
  action: RiskAction;
  tier: 'low' | 'medium' | 'high' | 'critical';
  reasons: string[];
  hardRuleTriggered?: string;
  requiresAuthentication: boolean;
}

/**
 * Risk Engine — numerical risk scoring with NON-OVERRIDABLE hard rules.
 *
 * Critically: a model can never talk itself into permission. Hard rules are
 * evaluated FIRST and cannot be lowered by a favourable score.
 */
export class RiskEngine {
  /** Hard security rules — checked before any scoring. */
  hardRule(action: string): { action: RiskAction; reason: string } | null {
    for (const rule of HARD_RULES) {
      if (rule.test.test(action)) return { action: rule.action, reason: rule.reason };
    }
    return null;
  }

  assess(description: string, factors: Partial<RiskFactors> = {}): RiskAssessment {
    const reasons: string[] = [];
    const f: RiskFactors = {
      irreversibility: factors.irreversibility ?? 0.2,
      externalVisibility: factors.externalVisibility ?? 0.1,
      financialImpact: factors.financialImpact ?? 0,
      privacy: factors.privacy ?? 0.2,
      accountPermissions: factors.accountPermissions ?? 0.2,
      dataSensitivity: factors.dataSensitivity ?? 0.1,
      confidence: factors.confidence ?? 0.8,
      novelty: factors.novelty ?? 0.3,
      historicalSuccess: factors.historicalSuccess ?? 0.7,
      trustLevel: factors.trustLevel ?? 'UNKNOWN',
    };

    // 1. HARD RULES FIRST — cannot be overridden
    const hard = this.hardRule(description);
    if (hard) {
      return {
        score: hard.action === 'DENY' ? 100 : 88,
        action: hard.action,
        tier: 'critical',
        reasons: [`Hard security rule: ${hard.reason}`],
        hardRuleTriggered: hard.reason,
        requiresAuthentication: hard.action === 'STRONG_CONFIRMATION',
      };
    }

    // 2. Weighted scoring
    let score = 0;
    score += f.irreversibility * 30;   if (f.irreversibility > 0.6) reasons.push('hard to reverse');
    score += f.externalVisibility * 18; if (f.externalVisibility > 0.5) reasons.push('externally visible');
    score += f.financialImpact * 25;   if (f.financialImpact > 0.3) reasons.push('financial impact');
    score += f.privacy * 14;           if (f.privacy > 0.5) reasons.push('touches private data');
    score += f.accountPermissions * 16; if (f.accountPermissions > 0.5) reasons.push('privileged scope');
    score += f.dataSensitivity * 20;   if (f.dataSensitivity > 0.5) reasons.push('sensitive data');
    score += f.novelty * 8;            if (f.novelty > 0.7) reasons.push('unfamiliar operation');
    score -= f.historicalSuccess * 10;

    // Trust level modulates risk
    const trust = TRUST_WEIGHT[f.trustLevel];
    score *= 1 + (0.5 - trust) * 0.6;
    if (f.trustLevel === 'UNTRUSTED') reasons.push('untrusted source');

    // Low confidence raises the ask threshold
    score += (1 - f.confidence) * 10;
    if (f.confidence < 0.6) reasons.push('low confidence in interpretation');

    score = Math.max(0, Math.min(100, Math.round(score)));

    let action: RiskAction;
    if (score <= 20) action = 'AUTOMATIC';
    else if (score <= 50) action = 'AUTOMATIC_LOGGED';
    else if (score <= 75) action = 'ASK';
    else action = 'STRONG_CONFIRMATION';

    const tier = score <= 20 ? 'low' : score <= 50 ? 'medium' : score <= 75 ? 'high' : 'critical';

    const assessment: RiskAssessment = {
      score,
      action,
      tier,
      reasons: reasons.length ? reasons : ['no elevated risk factors'],
      requiresAuthentication: action === 'STRONG_CONFIRMATION',
    };

    eventBus.emit('tool.started', 'RiskEngine', { description, score, action, tier });
    return assessment;
  }
}

export const riskEngine = new RiskEngine();

/* ═══════════════ HUMAN-IN-THE-LOOP ESCALATION ═══════════════ */

export type EscalationDecision = 'EXECUTE' | 'EXECUTE_AND_NOTIFY' | 'CLARIFY' | 'CONFIRM' | 'REFUSE';

export interface EscalationInput {
  confidence: number;      // interpretation confidence
  risk: RiskAssessment;
  userPreference?: { autonomous: boolean; confidence: number }; // learned preference
}

/**
 * Resolves the "Akansha asks too many questions" complaint while never
 * trading safety for convenience.
 */
export function escalationDecision(input: EscalationInput): { decision: EscalationDecision; reason: string } {
  const { confidence, risk } = input;
  const pref = input.userPreference;
  const prefAutonomy = pref ? pref.autonomous && pref.confidence > 0.7 : false;

  // Critical risk always confirms
  if (risk.action === 'DENY') return { decision: 'REFUSE', reason: 'Blocked by hard security rule' };
  if (risk.action === 'STRONG_CONFIRMATION') {
    return { decision: 'CONFIRM', reason: 'High-risk action requires explicit confirmation' };
  }

  // Low risk + high confidence → just do it
  if (risk.score <= 20 && confidence >= 0.85) {
    return { decision: 'EXECUTE', reason: 'Low risk and confident interpretation' };
  }

  // Low risk + medium confidence → execute with a light notification
  if (risk.score <= 35 && confidence >= 0.7) {
    return { decision: 'EXECUTE_AND_NOTIFY', reason: 'Low risk; proceeding with notification' };
  }

  // Learned user preference for autonomy on medium risk
  if (risk.score <= 50 && prefAutonomy && confidence >= 0.8) {
    return { decision: 'EXECUTE_AND_NOTIFY', reason: 'User prefers autonomy on low/medium risk actions' };
  }

  // Medium risk + low confidence → clarify instead of guessing
  if (confidence < 0.6) {
    return { decision: 'CLARIFY', reason: 'Ambiguous request — asking beats guessing' };
  }

  return { decision: 'CONFIRM', reason: 'Moderate risk requires confirmation' };
}
