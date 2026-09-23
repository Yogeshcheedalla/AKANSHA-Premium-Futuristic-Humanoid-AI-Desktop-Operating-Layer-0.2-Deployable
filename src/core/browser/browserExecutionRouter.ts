/**
 * PHASE 3 — Browser Intelligence Fabric: the ONE authoritative BrowserExecutionRouter.
 *
 * Akansha owns the mission; every engine (Playwright, Stagehand, Browser Use,
 * Skyvern, computer-use/vision, direct HTTP/API) is a TOOL selected by this router —
 * none of them owns mission state, memory, permissions, verification, or truth.
 *
 * Design rules enforced here:
 *  - Preferred order: direct API → deterministic DOM → AI-assisted → goal agent →
 *    visual/form → computer-use, with an ordered fallback chain.
 *  - Browser identity is a HARD constraint: a user-named browser is never silently
 *    substituted; if unavailable → report, don't swap.
 *  - Model-agnostic + policy-aware: reasoning/vision models come from the existing
 *    Model Selection Engine; FREE_ONLY never selects paid; paid requires explicit
 *    consent (never silently spend).
 *  - Security: never bypass CAPTCHA / 2FA / auth walls / permission boundaries —
 *    STOP, preserve session, request the user action, resume after.
 *  - NO EVIDENCE = NO SUCCESS: a strategy whose engine is not installed is reported
 *    not-executable, never faked.
 */
import { selectModel, type ModelPolicy, type ModelCandidate } from '../routing/modelSelection';

export type BrowserStrategy =
  | 'direct-api' | 'browser-open' | 'dom-deterministic' | 'ai-assisted'
  | 'goal-agent' | 'visual-form' | 'computer-use';

export type EngineAvailability = Record<BrowserStrategy, boolean>;

/** Truthful ledger of what is wired in THIS build (updated as engines install). */
export const DEFAULT_ENGINES: EngineAvailability = {
  'direct-api': true,          // server-side fetch of a legitimate public endpoint
  'browser-open': true,        // existing browser.navigate (open a URL in a chosen browser)
  'dom-deterministic': false,  // Playwright — not installed yet
  'ai-assisted': false,        // Stagehand — not installed yet
  'goal-agent': false,         // Browser Use — not installed yet
  'visual-form': false,        // Skyvern — not installed yet
  'computer-use': false,       // vision/computer-use model loop — not wired yet
};

export interface BrowserTask {
  goal: string;
  url?: string;
  needsPageControl?: boolean; // click / type / scroll
  needsRead?: boolean;        // extract / summarize page content
  needsFormFill?: boolean;
  unknownPage?: boolean;      // structure not known ahead of time
  visualComplexity?: boolean; // form-heavy / visually structured
  hasPublicApi?: boolean;     // a legitimate structured endpoint exists
  currentInfo?: boolean;      // needs live web data
  hardBrowser?: string;       // user-named browser = HARD constraint
}

export type BlockedReason =
  | 'CAPTCHA' | 'AUTH_WALL' | 'TWO_FA' | 'PERMISSION' | 'BROWSER_UNAVAILABLE'
  | 'NO_ELIGIBLE_MODEL' | 'PAID_CONSENT_REQUIRED' | 'ENGINE_UNAVAILABLE';

export interface ModelRef { providerId: string; modelId: string; costTier: string }

export interface BrowserPlan {
  strategy: BrowserStrategy;
  fallbackChain: BrowserStrategy[];
  browser?: string;
  model: ModelRef | null;
  requiresPaidConsent: boolean;
  confidence: number;
  executable: boolean;
  blocked?: BlockedReason;
  blockedDetail?: string;
  needsUser?: boolean;
  reasons: string[];
}

const NEEDS_MODEL: BrowserStrategy[] = ['ai-assisted', 'goal-agent', 'visual-form', 'computer-use'];

/** Detect a request to defeat a security/access-control mechanism. Never honored. */
export function requestsSecurityBypass(text: string): BlockedReason | null {
  const t = (text || '').toLowerCase();
  if (/\b(captcha|recaptcha)\b/.test(t) && /\b(bypass|defeat|solve it for|get around|avoid|skip)\b/.test(t)) return 'CAPTCHA';
  if (/\b(2fa|two[- ]factor|otp)\b/.test(t) && /\b(bypass|defeat|skip|get around|without)\b/.test(t)) return 'TWO_FA';
  if (/\b(bypass|defeat|circumvent|evade|crack)\b/.test(t) && /\b(auth|authentication|login|paywall|access control|permission|block ?list|ban)\b/.test(t)) return 'AUTH_WALL';
  return null;
}

/** Choose the preferred strategy for a task, honoring the execution hierarchy. */
export function chooseStrategy(task: BrowserTask, engines: EngineAvailability): BrowserStrategy {
  if (task.hasPublicApi && engines['direct-api']) return 'direct-api';
  const interactive = task.needsPageControl || task.needsRead || task.needsFormFill;
  if (!interactive) return 'browser-open';
  if (!task.unknownPage && engines['dom-deterministic']) return 'dom-deterministic';
  if (task.visualComplexity && engines['visual-form']) return 'visual-form';
  if (task.unknownPage && engines['ai-assisted']) return 'ai-assisted';
  if (task.needsPageControl && engines['goal-agent']) return 'goal-agent';
  if (engines['computer-use']) return 'computer-use';
  // No interactive engine installed: name the best-intended strategy so the caller
  // can report it honestly (executable=false, ENGINE_UNAVAILABLE).
  if (task.unknownPage || task.needsRead) return 'ai-assisted';
  return 'dom-deterministic';
}

/** Ordered fallback chain = later strategies that are actually available. */
function fallbackChainFor(preferred: BrowserStrategy, engines: EngineAvailability): BrowserStrategy[] {
  const order: BrowserStrategy[] = ['direct-api', 'dom-deterministic', 'ai-assisted', 'goal-agent', 'visual-form', 'computer-use'];
  const idx = order.indexOf(preferred);
  return order.slice(idx + 1).filter((s) => engines[s]);
}

export interface RouterContext {
  policy: ModelPolicy;
  engines?: EngineAvailability;
  candidates?: ModelCandidate[];
  freeRamGB?: number;
  allowBrowserFallback?: boolean; // if false, a missing hard browser blocks (never substitutes)
}

/** The single decision point for a browser mission. Pure + deterministic. */
export function planBrowserTask(task: BrowserTask, ctx: RouterContext): BrowserPlan {
  const engines = ctx.engines ?? DEFAULT_ENGINES;
  const reasons: string[] = [];

  // 1) Security first — never route around access controls.
  const bypass = requestsSecurityBypass(task.goal);
  if (bypass) {
    return {
      strategy: 'browser-open', fallbackChain: [], browser: task.hardBrowser, model: null,
      requiresPaidConsent: false, confidence: 1, executable: false, blocked: bypass,
      blockedDetail: 'Akansha does not bypass CAPTCHA, 2FA, auth walls, or permission boundaries.',
      needsUser: true, reasons: ['security: refusing to defeat an access-control mechanism; will preserve session and resume after you complete it.'],
    };
  }

  // 2) Browser identity — hard constraint, never substituted.
  let browser = task.hardBrowser;
  if (browser && ctx.allowBrowserFallback === false) {
    // (availability of the specific browser is checked at execution; here we simply
    //  guarantee we never pick a different one.)
    reasons.push(`browser "${browser}" is a hard constraint (never substituted)`);
  }

  // 3) Strategy + fallback chain.
  const strategy = chooseStrategy(task, engines);
  const fallbackChain = fallbackChainFor(strategy, engines);
  reasons.push(`strategy=${strategy}`);

  // 4) Model selection for AI strategies (model-agnostic + policy-aware).
  let model: ModelRef | null = null;
  let requiresPaidConsent = false;
  let blocked: BlockedReason | undefined;
  let blockedDetail: string | undefined;
  if (NEEDS_MODEL.includes(strategy)) {
    const reqs: Parameters<typeof selectModel>[0] = {
      vision: strategy === 'computer-use', reasoning: true, toolCalling: true,
    };
    const sel = selectModel(reqs, ctx.policy, ctx.candidates ?? [], { freeRamGB: ctx.freeRamGB });
    if (!sel.decision) {
      blocked = 'NO_ELIGIBLE_MODEL';
      blockedDetail = sel.blockedReason ?? 'no model meets this browser task under the current policy';
      reasons.push('no eligible model');
    } else {
      model = { providerId: sel.decision.providerId, modelId: sel.decision.modelId, costTier: sel.decision.costTier };
      requiresPaidConsent = sel.decision.requiresPaidConsent;
      reasons.push(`model ${model.providerId}/${model.modelId} (${model.costTier})`);
    }
  }

  // 5) Executability — the chosen engine must be installed (NO EVIDENCE = NO SUCCESS).
  const engineReady = engines[strategy];
  const modelReady = !NEEDS_MODEL.includes(strategy) || (!!model && !blocked);
  const executable = engineReady && modelReady && !requiresPaidConsent;
  if (!engineReady && !blocked) { blocked = 'ENGINE_UNAVAILABLE'; blockedDetail = `${strategy} engine not installed in this build`; reasons.push('engine not wired yet'); }
  if (requiresPaidConsent) { reasons.push('paid model selected — explicit consent required before spending'); }

  return {
    strategy, fallbackChain, browser, model, requiresPaidConsent,
    confidence: engineReady ? (modelReady ? 0.8 : 0.4) : 0.1,
    executable, blocked, blockedDetail, needsUser: !!requiresPaidConsent || blocked === 'NO_ELIGIBLE_MODEL',
    reasons,
  };
}
