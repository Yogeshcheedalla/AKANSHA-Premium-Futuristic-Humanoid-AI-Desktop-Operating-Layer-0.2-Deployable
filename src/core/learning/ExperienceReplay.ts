import { EWMADetector, ContextualBandit, LinearRanker, clamp } from '../ml/AkanshaML';
import { eventBus } from '../events/EventBus';

/* ═══════════════ FAILURE CLASSIFICATION ═══════════════ */

export type FailureClass =
  | 'AUTHENTICATION' | 'PERMISSION' | 'NETWORK' | 'TIMEOUT'
  | 'TOOL_FAILURE' | 'MODEL_FAILURE' | 'BROWSER_FAILURE' | 'DOM_MISMATCH'
  | 'FILE_LOCK' | 'DEPENDENCY_FAILURE' | 'RESOURCE_EXHAUSTION'
  | 'VERIFICATION_FAILURE' | 'AMBIGUOUS_INTENT' | 'WRONG_TARGET'
  | 'PARTIAL_COMPLETION' | 'UNKNOWN';

export interface FailureClassification {
  failureClass: FailureClass;
  rootCause: string;
  probableCause: string;
  recoverable: boolean;
  strategy: 'RETRY_SAME' | 'RETRY_ALTERNATIVE' | 'REPLAN' | 'ESCALATE_USER' | 'GIVE_UP';
  alternativeCapability?: string;
}

const FAILURE_SIGNATURES: Array<{ test: RegExp; cls: FailureClass; cause: string; strategy: FailureClassification['strategy'] }> = [
  { test: /\b(401|403|unauthori[sz]ed|invalid api key|token expired|auth required)\b/i, cls: 'AUTHENTICATION', cause: 'credentials rejected or expired', strategy: 'ESCALATE_USER' },
  { test: /\b(permission denied|access denied|forbidden|insufficient scope|eacces)\b/i, cls: 'PERMISSION', cause: 'required permission not granted', strategy: 'ESCALATE_USER' },
  { test: /\b(dns|econnrefused|enotfound|network|offline|unreachable|socket hang up)\b/i, cls: 'NETWORK', cause: 'network unreachable', strategy: 'RETRY_ALTERNATIVE' },
  { test: /\b(timeout|timed out|deadline exceeded|etimedout)\b/i, cls: 'TIMEOUT', cause: 'operation exceeded its time budget', strategy: 'RETRY_SAME' },
  { test: /\b(captcha|challenge|human verification|sign in to continue)\b/i, cls: 'BROWSER_FAILURE', cause: 'human verification challenge', strategy: 'ESCALATE_USER' },
  { test: /\b(canvas|shadow root|iframe|cross-origin|element not found|selector|no such element)\b/i, cls: 'DOM_MISMATCH', cause: 'DOM selector no longer matches the page', strategy: 'RETRY_ALTERNATIVE' },
  { test: /\b(locked|ebusy|in use by another process)\b/i, cls: 'FILE_LOCK', cause: 'file locked by another process', strategy: 'RETRY_SAME' },
  { test: /\b(module not found|cannot resolve|dependency|enoent|import error)\b/i, cls: 'DEPENDENCY_FAILURE', cause: 'missing or broken dependency', strategy: 'REPLAN' },
  { test: /\b(out of memory|oom|resource exhausted|too many requests|429|rate limit)\b/i, cls: 'RESOURCE_EXHAUSTION', cause: 'resource budget exhausted', strategy: 'RETRY_ALTERNATIVE' },
  { test: /\b(verification failed|expected state|assertion|not verified|mismatch)\b/i, cls: 'VERIFICATION_FAILURE', cause: 'action ran but the result did not match the expected state', strategy: 'REPLAN' },
  { test: /\b(ambiguous|unclear|which one did you mean|multiple matches)\b/i, cls: 'AMBIGUOUS_INTENT', cause: 'request could not be resolved to one target', strategy: 'ESCALATE_USER' },
  { test: /\b(wrong (file|window|app|tab)|opened the wrong|not the intended)\b/i, cls: 'WRONG_TARGET', cause: 'action applied to the wrong target', strategy: 'REPLAN' },
  { test: /\b(partial|some steps|incomplete)\b/i, cls: 'PARTIAL_COMPLETION', cause: 'only some steps completed', strategy: 'RETRY_SAME' },
];

/* ═══════════════ EXPERIENCE RECORD ═══════════════ */

export interface Experience {
  experienceId: string;
  task: string;
  intent: string;
  context: Record<string, unknown>;
  plan: string[];
  tools: string[];
  model?: { provider: string; modelId: string };
  actions: string[];
  observations: string[];
  result: 'success' | 'failure' | 'partial';
  verification: { performed: boolean; passed: boolean; evidence?: string };
  failure?: FailureClassification;
  correction?: string;
  userFeedback?: { positive: boolean; note?: string };
  durationMs: number;
  createdAt: number;
}

export interface ExtractedLesson {
  lessonId: string;
  domain: string;
  pattern: string;
  outcome: 'success' | 'failure';
  lesson: string;
  evidenceCount: number;
  confidence: number;
  recommendedChange: string;
  appliesTo: string[];
  createdAt: number;
}

/* ═══════════════ EXPERIENCE REPLAY ENGINE ═══════════════ */

/**
 * ExperienceReplay — the mistake-learning core.
 *
 * Every mission becomes a structured experience. Periodically replay those
 * experiences to answer: what repeatedly works, what repeatedly fails, which
 * model is best for which task, which tools are unreliable, which user
 * preferences changed. This is what turns "AI learns" into actual
 * continual improvement.
 */
export class ExperienceReplay {
  private experiences: Experience[] = [];
  private lessons = new Map<string, ExtractedLesson>();
  private failureDetector = new EWMADetector(0.2, 3);
  private latencyDetector = new EWMADetector(0.15, 2.8);

  /* Model-selection bandit: context = [isCoding, isReasoning, isVision, isFast, localPref] */
  private modelBandit = new ContextualBandit(5, 0.55);
  /* Tool-selection ranker */
  private toolRanker = new LinearRanker(0.05);

  private maxExperiences = 600;

  /* ── CLASSIFICATION ── */

  classifyFailure(errorText: string, context?: Record<string, unknown>): FailureClassification {
    const text = errorText || '';

    for (const sig of FAILURE_SIGNATURES) {
      if (sig.test.test(text)) {
        return {
          failureClass: sig.cls,
          rootCause: sig.cause,
          probableCause: sig.cause,
          recoverable: sig.strategy !== 'GIVE_UP' && sig.strategy !== 'ESCALATE_USER',
          strategy: sig.strategy,
        };
      }
    }

    return {
      failureClass: 'UNKNOWN',
      rootCause: 'could not classify the failure from the available evidence',
      probableCause: 'unrecognised error pattern',
      recoverable: true,
      strategy: 'RETRY_ALTERNATIVE',
    };
  }

  /* ── RECORD ── */

  record(exp: Omit<Experience, 'experienceId' | 'createdAt'>): Experience {
    const full: Experience = {
      ...exp,
      experienceId: `exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: Date.now(),
    };

    this.experiences.push(full);
    if (this.experiences.length > this.maxExperiences) {
      this.experiences = this.experiences.slice(-this.maxExperiences);
    }

    // Anomaly detection on outcome and latency
    const failureSignal = full.result === 'failure' ? 1 : 0;
    this.failureDetector.observe(`task:${full.intent}`, failureSignal);
    this.latencyDetector.observe(`latency:${full.intent}`, full.durationMs);

    // Feed the model-selection bandit.
    // CRITICAL: only VERIFIED successes earn full reward. An unverified "success"
    // is indistinguishable from a fabricated one, so it earns nothing — this
    // prevents a flaky or malicious provider from buying routing dominance.
    if (full.model) {
      const ctx = this.modelContext(full.intent);
      const verified = full.verification?.performed && full.verification?.passed;
      if (verified || full.result === 'failure') {
        const reward = this.rewardFor(full);
        this.modelBandit.update(`${full.model.provider}::${full.model.modelId}`, ctx, reward);
      }
    }

    // Feed the tool ranker
    for (const tool of full.tools) {
      this.toolRanker.learn(
        { id: tool, features: this.toolFeatures(tool, full) },
        full.result === 'success' ? 1 : -1
      );
    }

    // Extract a lesson immediately for failures
    if (full.result === 'failure' && full.failure) {
      this.extractLesson(full);
    }
    if (full.result === 'success' && full.verification.passed && full.tools.length > 0) {
      this.extractLesson(full);
    }

    eventBus.emit('learning.lesson_created', 'ExperienceReplay', {
      experienceId: full.experienceId,
      result: full.result,
      failureClass: full.failure?.failureClass,
    });

    return full;
  }

  private modelContext(intent: string): number[] {
    const i = intent.toLowerCase();
    return [
      /cod|develop|implement|build|refactor/.test(i) ? 1 : 0,
      /reason|research|analy|plan|explain|compare/.test(i) ? 1 : 0,
      /vision|image|screen|screenshot|visual/.test(i) ? 1 : 0,
      /chat|greet|convers|quick|simple/.test(i) ? 1 : 0,
      0.5, // local preference placeholder
    ];
  }

  private rewardFor(exp: Experience): number {
    let reward = 0;
    reward += exp.result === 'success' ? 1 : -1;
    reward += exp.verification.passed ? 0.5 : -0.5;
    if (exp.userFeedback) reward += exp.userFeedback.positive ? 0.6 : -0.6;
    // Latency penalty — normalised
    reward -= clamp(exp.durationMs / 30000, 0, 1) * 0.4;
    return reward;
  }

  private toolFeatures(tool: string, exp: Experience): Record<string, number> {
    return {
      succeeded: exp.result === 'success' ? 1 : 0,
      verified: exp.verification.passed ? 1 : 0,
      fast: exp.durationMs < 3000 ? 1 : 0,
      lowRisk: 1,
      intentMatch: exp.tools.includes(tool) ? 1 : 0,
    };
  }

  /* ── LESSON EXTRACTION ── */

  private extractLesson(exp: Experience) {
    const domain = exp.intent || 'general';
    const isFailure = exp.result === 'failure';

    const key = isFailure
      ? `fail::${domain}::${exp.failure?.failureClass ?? 'UNKNOWN'}`
      : `win::${domain}::${exp.tools[0] ?? 'none'}`;

    const existing = this.lessons.get(key);
    const evidenceCount = (existing?.evidenceCount ?? 0) + 1;

    let lesson: string;
    let recommendedChange: string;
    let appliesTo: string[];

    if (isFailure && exp.failure) {
      lesson = `${exp.failure.failureClass} failures occur during ${domain}: ${exp.failure.rootCause}`;
      recommendedChange =
        exp.failure.strategy === 'RETRY_ALTERNATIVE' && exp.failure.alternativeCapability
          ? `Prefer ${exp.failure.alternativeCapability} for ${domain} tasks`
          : exp.failure.strategy === 'REPLAN'
            ? `Change the plan for ${domain}: avoid the step that caused "${exp.failure.rootCause}"`
            : `${exp.failure.strategy} is the effective response for ${exp.failure.failureClass}`;
      appliesTo = [domain, exp.failure.failureClass];
    } else {
      lesson = `${exp.tools[0] ?? 'This approach'} reliably completes ${domain} tasks with verification passing`;
      recommendedChange = `Keep preferring ${exp.tools[0]} for ${domain}`;
      appliesTo = [domain];
    }

    if (exp.correction) {
      lesson += ` — corrected via: ${exp.correction}`;
    }

    this.lessons.set(key, {
      lessonId: `lesson-${key}`,
      domain,
      pattern: key,
      outcome: isFailure ? 'failure' : 'success',
      lesson,
      evidenceCount,
      confidence: clamp(0.4 + evidenceCount * 0.15, 0, 0.98),
      recommendedChange,
      appliesTo,
      createdAt: existing?.createdAt ?? Date.now(),
    });
  }

  /* ── REPLAY & ANALYSIS ── */

  /**
   * Replay accumulated experience and surface what changed.
   * Answers "what did you learn?"
   */
  replay(): {
    lessons: ExtractedLesson[];
    anomalies: Array<{ key: string; kind: string; detail: string }>;
    modelInsights: Array<{ model: string; trials: number; recommendation: string }>;
    toolInsights: Array<{ tool: string; recommendation: string }>;
    summary: string[];
  } {
    const anomalies: Array<{ key: string; kind: string; detail: string }> = [];

    // Detect intents with unusually high failure rates or latency
    const intents = new Set(this.experiences.map((e) => e.intent));
    for (const intent of intents) {
      const base = this.failureDetector.baseline(`task:${intent}`);
      if (base.mean > 0.4) {
        anomalies.push({
          key: intent, kind: 'failure-rate',
          detail: `${intent} has a ${(base.mean * 100).toFixed(0)}% failure rate — investigate the failing step`,
        });
      }
      const lat = this.latencyDetector.baseline(`latency:${intent}`);
      if (lat.mean > 20000) {
        anomalies.push({
          key: intent, kind: 'latency',
          detail: `${intent} averages ${(lat.mean / 1000).toFixed(1)}s — consider a faster capability`,
        });
      }
    }

    // Model insights from the bandit
    const modelInsights: Array<{ model: string; trials: number; recommendation: string }> = [];
    const byModel = new Map<string, { wins: number; total: number; latency: number }>();
    for (const e of this.experiences) {
      if (!e.model) continue;
      const k = `${e.model.provider}::${e.model.modelId}`;
      const agg = byModel.get(k) || { wins: 0, total: 0, latency: 0 };
      agg.total++;
      if (e.result === 'success') agg.wins++;
      agg.latency += e.durationMs;
      byModel.set(k, agg);
    }
    for (const [model, agg] of byModel) {
      if (agg.total < 2) continue;
      const rate = agg.wins / agg.total;
      modelInsights.push({
        model, trials: agg.total,
        recommendation: rate > 0.8
          ? `${rate * 100}% success over ${agg.total} runs — prefer for this workload`
          : rate < 0.5
            ? `only ${rate * 100}% success over ${agg.total} runs — avoid for this workload`
            : `${rate * 100}% success over ${agg.total} runs — acceptable`,
      });
    }

    // Tool insights from the ranker
    const weights = this.toolRanker.getWeights();
    const succeededWeight = weights.succeeded ?? 0;
    const toolInsights = [
      {
        tool: 'verification',
        recommendation: succeededWeight > 0.5
          ? 'Verified executions correlate strongly with success — keep verification mandatory'
          : 'Verification weight is low; gather more evidence before relying on it',
      },
    ];

    const summary: string[] = [];
    const strongLessons = Array.from(this.lessons.values()).filter((l) => l.evidenceCount >= 2);
    for (const l of strongLessons.slice(0, 8)) summary.push(l.lesson);
    for (const a of anomalies.slice(0, 4)) summary.push(a.detail);
    for (const m of modelInsights.slice(0, 3)) summary.push(`${m.model}: ${m.recommendation}`);

    return {
      lessons: Array.from(this.lessons.values()).sort((a, b) => b.evidenceCount - a.evidenceCount),
      anomalies,
      modelInsights,
      toolInsights,
      summary,
    };
  }

  /* ── EMPIRICAL ROUTING ── */

  /**
   * Recommend a model based on learned performance, not marketing.
   * "This model has historically been best for this capability on this machine."
   */
  recommendModel(intent: string, candidates: string[]): { model: string | null; alternatives: Array<{ arm: string; score: number; trials: number }> } {
    if (candidates.length === 0) return { model: null, alternatives: [] };
    const ctx = this.modelContext(intent);
    const ranked = this.modelBandit.score(ctx, candidates);
    return { model: ranked[0]?.arm ?? null, alternatives: ranked };
  }

  /** Detect a repeated-failure pattern and propose an alternative. */
  diagnoseCapability(capability: string): { degraded: boolean; recommendation: string; failureRate: number } {
    const base = this.failureDetector.baseline(`task:${capability}`);
    const failureRate = clamp(base.mean, 0, 1);
    return {
      degraded: failureRate > 0.4,
      failureRate,
      recommendation: failureRate > 0.4
        ? `${capability} is failing ${(failureRate * 100).toFixed(0)}% of the time. Route to a fallback capability and investigate the root cause.`
        : `${capability} is healthy (${((1 - failureRate) * 100).toFixed(0)}% success).`,
    };
  }

  /* ── USER CORRECTION AS TRAINING DATA ── */

  /**
   * A user correction is the highest-value personalisation signal.
   * Records the misinterpretation so the intent classifier improves.
   */
  recordCorrection(input: {
    originalRequest: string;
    previousIntent: string;
    correctIntent: string;
    errorType: string;
    userNote?: string;
  }) {
    const exp: Omit<Experience, 'experienceId' | 'createdAt'> = {
      task: input.originalRequest,
      intent: input.correctIntent,
      context: { errorType: input.errorType, previousIntent: input.previousIntent },
      plan: [],
      tools: [],
      actions: [],
      observations: [`User corrected intent from "${input.previousIntent}" to "${input.correctIntent}"`],
      result: 'failure',
      verification: { performed: false, passed: false },
      failure: {
        failureClass: 'AMBIGUOUS_INTENT',
        rootCause: `misclassified as ${input.previousIntent}`,
        probableCause: input.errorType,
        recoverable: true,
        strategy: 'REPLAN',
      },
      correction: input.userNote || `Treat "${input.originalRequest.slice(0, 60)}" as ${input.correctIntent}`,
      durationMs: 0,
    };
    this.record(exp);
    return this.lessons.get(`fail::${input.correctIntent}::AMBIGUOUS_INTENT`);
  }

  /* ── INTROSPECTION ── */

  getExperiences(limit = 20): Experience[] {
    return this.experiences.slice(-limit).reverse();
  }

  getLessons(): ExtractedLesson[] {
    return Array.from(this.lessons.values()).sort((a, b) => b.evidenceCount - a.evidenceCount);
  }

  stats() {
    const successes = this.experiences.filter((e) => e.result === 'success').length;
    const failures = this.experiences.filter((e) => e.result === 'failure').length;
    const verified = this.experiences.filter((e) => e.verification.passed).length;
    const corrected = this.experiences.filter((e) => !!e.correction).length;
    return {
      total: this.experiences.length,
      successes, failures, verified, corrected,
      successRate: this.experiences.length ? successes / this.experiences.length : 0,
      verificationRate: this.experiences.length ? verified / this.experiences.length : 0,
      lessons: this.lessons.size,
      banditArms: this.modelBandit.stats(),
    };
  }
}

export const experienceReplay = new ExperienceReplay();

/* ═══════════════ SKILL VERSION CONTROL ═══════════════ */

export type SkillLifecycle =
  | 'GENERATED' | 'TESTING' | 'VALIDATED' | 'CANARY' | 'PRODUCTION' | 'DEPRECATED' | 'ROLLED_BACK';

export const LIFECYCLE_ORDER: SkillLifecycle[] = [
  'GENERATED', 'TESTING', 'VALIDATED', 'CANARY', 'PRODUCTION', 'DEPRECATED', 'ROLLED_BACK',
];

export interface SkillVersion {
  skillId: string;
  version: string;
  lifecycle: SkillLifecycle;
  parentVersion?: string;
  changeDescription: string;
  testResults: { passed: number; failed: number; securityScan: boolean };
  createdAt: number;
  promotedAt?: number;
}

/**
 * SkillVersionControl — never overwrite a working skill blindly.
 *
 * Especially important for self-generated MCPs and learned procedures:
 * a skill must pass testing, validation, and a canary period before it can
 * replace a production skill, and rollback must always be available.
 */
export class SkillVersionControl {
  private versions = new Map<string, SkillVersion[]>();

  create(skillId: string, version: string, changeDescription: string, parentVersion?: string): SkillVersion {
    const list = this.versions.get(skillId) || [];
    const v: SkillVersion = {
      skillId, version, lifecycle: 'GENERATED',
      parentVersion, changeDescription,
      testResults: { passed: 0, failed: 0, securityScan: false },
      createdAt: Date.now(),
    };
    list.push(v);
    this.versions.set(skillId, list);
    eventBus.emit('skill.registered', 'SkillVersionControl', { skillId, version, lifecycle: v.lifecycle });
    return v;
  }

  recordTests(skillId: string, version: string, passed: number, failed: number, securityScan: boolean) {
    const v = this.find(skillId, version);
    if (v) v.testResults = { passed, failed, securityScan };
  }

  /**
   * Promote a skill through its lifecycle. Enforces gates:
   * cannot reach PRODUCTION without passing tests AND a security scan AND a canary period.
   */
  promote(skillId: string, version: string, target: SkillLifecycle): { ok: boolean; reason: string } {
    const v = this.find(skillId, version);
    if (!v) return { ok: false, reason: 'version not found' };

    const currentIndex = LIFECYCLE_ORDER.indexOf(v.lifecycle);
    const targetIndex = LIFECYCLE_ORDER.indexOf(target);
    if (targetIndex <= currentIndex) {
      return { ok: false, reason: `already at ${v.lifecycle}` };
    }

    // GATE: production requires tests + security scan + canary
    if (target === 'PRODUCTION') {
      if (v.testResults.failed > 0) {
        return { ok: false, reason: `cannot promote: ${v.testResults.failed} tests failing` };
      }
      if (!v.testResults.securityScan) {
        return { ok: false, reason: 'cannot promote: security scan not completed' };
      }
      if (v.lifecycle !== 'CANARY') {
        return { ok: false, reason: 'cannot promote directly to production — must pass through CANARY' };
      }
      if (Date.now() - v.createdAt < 60000) {
        return { ok: false, reason: 'canary period too short — allow more observation time' };
      }
    }

    // Demote the previous production version
    if (target === 'PRODUCTION') {
      const list = this.versions.get(skillId) || [];
      for (const other of list) {
        if (other !== v && other.lifecycle === 'PRODUCTION') other.lifecycle = 'DEPRECATED';
      }
    }

    v.lifecycle = target;
    v.promotedAt = Date.now();
    eventBus.emit('capability.score_updated', 'SkillVersionControl', { skillId, version, lifecycle: target });
    return { ok: true, reason: `promoted to ${target}` };
  }

  /** Roll back to the most recent production or validated version. */
  rollback(skillId: string): { ok: boolean; restored?: SkillVersion; reason: string } {
    const list = this.versions.get(skillId) || [];
    const current = list.find((v) => v.lifecycle === 'PRODUCTION');
    const candidate = [...list]
      .reverse()
      .find((v) => (v.lifecycle === 'DEPRECATED' || v.lifecycle === 'VALIDATED') && v !== current);

    if (!candidate) return { ok: false, reason: 'no rollback target available' };
    if (current) current.lifecycle = 'ROLLED_BACK';
    candidate.lifecycle = 'PRODUCTION';
    eventBus.emit('recovery.started', 'SkillVersionControl', { skillId, restoredTo: candidate.version });
    return { ok: true, restored: candidate, reason: `rolled back to ${candidate.version}` };
  }

  private find(skillId: string, version: string) {
    return (this.versions.get(skillId) || []).find((v) => v.version === version);
  }

  history(skillId: string): SkillVersion[] {
    return this.versions.get(skillId) || [];
  }

  stats() {
    const all = Array.from(this.versions.values()).flat();
    const byLifecycle: Record<string, number> = {};
    for (const v of all) byLifecycle[v.lifecycle] = (byLifecycle[v.lifecycle] || 0) + 1;
    return { totalVersions: all.length, byLifecycle, skills: this.versions.size };
  }
}

export const skillVersionControl = new SkillVersionControl();
