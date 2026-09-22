/**
 * PHASE 1 — Universal Semantic Understanding.
 *
 * Turns a natural-language GOAL into an explicit set of REQUIRED CAPABILITIES and
 * reports, honestly, whether each is actually available in this build right now —
 * given the derived cost/privacy policy. It EXTENDS the existing capabilityRegistry
 * + modelSelection; it is NOT a second planner/router and owns no mission state.
 *
 * Core rule enforced here: NO EVIDENCE = NO SUCCESS. A capability that is only
 * planned (not wired) is reported NOT_WIRED, never silently assumed to work. This
 * is what lets Akansha understand "open YouTube + research Kafka + compare this
 * repo + summarize + save" as a MULTI-ORGAN goal instead of a bare "open youtube".
 */
import { capabilitiesFor, agentFor, missingDeliveryPlatform } from '../routing/capabilityRegistry';
import { derivePolicy, type ModelPolicy, type TaskRequirements } from '../routing/modelSelection';

export type CapabilityStatus =
  | 'AVAILABLE'          // wired executor exists + permitted by policy
  | 'PARTIAL'            // exists but limited (honest caveat)
  | 'NOT_WIRED'          // organ not implemented yet (PHASE 3/4/…)
  | 'BLOCKED_BY_POLICY'  // would need network/paid, but policy forbids
  | 'NEEDS_USER';        // missing a required input (e.g. delivery platform)

/** How real an organ's implementation is in the CURRENT build. Truthful ledger. */
export type Maturity = 'wired' | 'partial' | 'planned';

export const CAPABILITY_MATURITY: Record<string, Maturity> = {
  desktop: 'wired',          // open/close/focus + launch verified
  browser: 'wired',          // open/navigate a URL in a chosen browser (NOT page control)
  filesystem: 'wired',       // save/read/write local files
  memory: 'wired',           // preference + memory fabric read-back
  coding: 'wired',           // model-generated code (artifact), not compiled/run here
  documents: 'partial',      // basic export; not a full office pipeline
  communication: 'partial',  // email wired; WhatsApp/Telegram not
  compiler: 'planned',       // no build/run executor
  webSearch: 'planned',      // SearXNG/research provider not verified live (PHASE 4)
  pageUnderstanding: 'planned', // no DOM/read-page extraction (PHASE 3)
  repoInspection: 'planned', // no code-repo analyzer
  vision: 'planned',         // no screenshot/vision loop
  computerUse: 'planned',    // no GUI act/observe/verify (PHASE 3)
};

// Network-dependent organs — blocked when the policy is OFFLINE_ONLY / PRIVACY_FIRST.
const NETWORK_CAPS = new Set(['browser', 'webSearch', 'pageUnderstanding', 'repoInspection', 'communication']);

const EXTRA: Array<{ id: string; re: RegExp }> = [
  { id: 'pageUnderstanding', re: /\b(summariz\w*|read (the|this|that) (page|site|article|video|post)|extract\w* (from|the)|transcrib\w*|what does (the|this|that) (page|site|video|article)|differences|compare it)\b/i },
  { id: 'repoInspection', re: /\b(repositor(?:y|ies)|repo|github repo|this repo|codebase|source code|commit|branch|pull request|pr)\b/i },
  { id: 'vision', re: /\b(screen|screenshot|see (what|this|the)|image|picture|camera|photo)\b/i },
  { id: 'computerUse', re: /\b(click|tap|type into|fill (in|out|the)|press the button|scroll (down|up)|select the)\b/i },
];

const REASONING = /\b(compare|summariz\w*|analy[sz]e|differences|evaluate|explain|reason|decide|plan|pros and cons|trade-?offs?)\b/i;
const CODING = /\b(code|program|script|function|implement|refactor|fix .* bug|repository|repo\b|codebase|source code)\b/i;

/** Union of the base capabilityRegistry hits + the extended organ detectors. */
export function detectCapabilities(text: string): string[] {
  const found = new Set<string>(capabilitiesFor(text));
  for (const e of EXTRA) if (e.re.test(text)) found.add(e.id);
  return [...found];
}

export interface CapabilityRequirement {
  id: string;
  agent: string;
  maturity: Maturity;
  status: CapabilityStatus;
  reason: string;
}

export interface SemanticPlan {
  goal: string;
  policy: ModelPolicy;
  requirements: CapabilityRequirement[];
  executable: string[];   // AVAILABLE
  partial: string[];      // PARTIAL
  blocked: string[];      // NOT_WIRED or BLOCKED_BY_POLICY
  needsUser: string[];    // NEEDS_USER
  fullyExecutable: boolean;
  modelRequirements: TaskRequirements;
}

function statusFor(id: string, text: string, policy: ModelPolicy): { status: CapabilityStatus; reason: string } {
  const maturity = CAPABILITY_MATURITY[id] ?? 'planned';
  const offline = policy === 'OFFLINE_ONLY' || policy === 'PRIVACY_FIRST';
  if (maturity === 'planned') return { status: 'NOT_WIRED', reason: 'organ not implemented in this build' };
  if (offline && NETWORK_CAPS.has(id)) return { status: 'BLOCKED_BY_POLICY', reason: `${policy} forbids network use` };
  if (id === 'communication' && missingDeliveryPlatform(text)) return { status: 'NEEDS_USER', reason: 'delivery platform not specified' };
  if (maturity === 'partial') return { status: 'PARTIAL', reason: 'available but limited' };
  return { status: 'AVAILABLE', reason: 'wired executor present' };
}

/** Analyze a goal into a SemanticPlan. Pure + deterministic; never fabricates. */
export function analyzeGoal(text: string, policyOverride?: ModelPolicy): SemanticPlan {
  const policy = policyOverride ?? derivePolicy(text);
  const ids = detectCapabilities(text);
  const requirements: CapabilityRequirement[] = ids.map((id) => {
    const { status, reason } = statusFor(id, text, policy);
    return { id, agent: agentFor(id), maturity: CAPABILITY_MATURITY[id] ?? 'planned', status, reason };
  });

  const executable = requirements.filter((r) => r.status === 'AVAILABLE').map((r) => r.id);
  const partial = requirements.filter((r) => r.status === 'PARTIAL').map((r) => r.id);
  const blocked = requirements.filter((r) => r.status === 'NOT_WIRED' || r.status === 'BLOCKED_BY_POLICY').map((r) => r.id);
  const needsUser = requirements.filter((r) => r.status === 'NEEDS_USER').map((r) => r.id);

  const modelRequirements: TaskRequirements = {
    reasoning: REASONING.test(text) || ids.includes('pageUnderstanding') || ids.includes('repoInspection'),
    coding: CODING.test(text),
    vision: ids.includes('vision') || ids.includes('computerUse'),
    toolCalling: ids.length > 0,
  };

  return {
    goal: text, policy, requirements, executable, partial, blocked, needsUser,
    fullyExecutable: requirements.length > 0 && blocked.length === 0 && needsUser.length === 0,
    modelRequirements,
  };
}

/** A short, honest sentence for the UI about what Akansha can vs cannot do here. */
export function honestCapabilityNote(plan: SemanticPlan): string {
  if (plan.requirements.length === 0) return '';
  if (plan.fullyExecutable) return '';
  const blockedLabel: Record<string, string> = {
    webSearch: 'live web research', pageUnderstanding: 'reading/understanding a web page',
    repoInspection: 'inspecting a code repository', vision: 'looking at the screen/images',
    computerUse: 'controlling the screen (clicking/typing in apps)', compiler: 'compiling/running code',
  };
  const blockedNames = plan.blocked.map((b) => blockedLabel[b] || b);
  const parts: string[] = [];
  if (plan.executable.length) parts.push(`I can ${plan.executable.map((e) => e.replace('desktop', 'control apps')).join(', ')}`);
  if (blockedNames.length) parts.push(`but ${blockedNames.join(', ')} ${blockedNames.length > 1 ? 'aren\u2019t' : 'isn\u2019t'} wired yet`);
  if (plan.needsUser.length) parts.push('and I need one decision from you');
  return parts.length ? `Heads up: ${parts.join(', ')}. I'll do what's available and tell you exactly what I can't — I won't pretend otherwise.` : '';
}
