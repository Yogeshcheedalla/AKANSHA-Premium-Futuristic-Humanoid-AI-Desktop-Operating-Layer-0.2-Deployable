import { eventBus } from '../events/EventBus';
import { skillRegistry } from '../skills/SkillRegistry';

export interface Lesson {
  id: string;
  domain: string;
  scenario: string;
  outcome: 'success' | 'failure';
  cause?: string;
  strategy: string;
  evidence: string[];
  confidence: number;
  createdAt: number;
  applicationCount: number;
}

export interface StrategyUpdateCandidate {
  domain: string;
  proposedChange: string;
  evidence: Lesson[];
  risk: 'low' | 'medium' | 'high';
  requiresAuthorization: boolean;
}

/**
 * Cross-mission learning engine.
 *
 * Extracts reusable lessons from mission outcomes, updates capability
 * performance scores, and proposes strategy updates. It NEVER silently
 * alters security boundaries or core privileges.
 */
export class LearningEngine {
  private lessons = new Map<string, Lesson>();
  private strategyCandidates: StrategyUpdateCandidate[] = [];

  /**
   * Record a lesson from a mission outcome.
   */
  learnLesson(input: {
    domain: string;
    scenario: string;
    outcome: 'success' | 'failure';
    cause?: string;
    strategy: string;
    evidence?: string[];
  }): Lesson {
    const lesson: Lesson = {
      id: `lesson-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      domain: input.domain,
      scenario: input.scenario,
      outcome: input.outcome,
      cause: input.cause,
      strategy: input.strategy,
      evidence: input.evidence || [],
      confidence: input.outcome === 'success' ? 0.8 : 0.9,
      createdAt: Date.now(),
      applicationCount: 0,
    };
    this.lessons.set(lesson.id, lesson);
    eventBus.emit('learning.lesson_created', 'LearningEngine', { lessonId: lesson.id, domain: lesson.domain, outcome: lesson.outcome });
    return lesson;
  }

  /**
   * Retrieve lessons relevant to a new scenario (experience-driven routing).
   */
  getRelevantLessons(domain: string, scenario: string): Lesson[] {
    const s = scenario.toLowerCase();
    return Array.from(this.lessons.values())
      .filter((l) => l.domain === domain && l.scenario.toLowerCase().includes(s.split(' ')[0] || s))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 10);
  }

  /**
   * Apply a lesson — record that it influenced a future decision.
   */
  applyLesson(lessonId: string) {
    const lesson = this.lessons.get(lessonId);
    if (lesson) lesson.applicationCount++;
  }

  /**
   * Record a capability outcome so routing is experience-driven.
   */
  recordCapabilityOutcome(skillId: string, outcome: 'success' | 'failure', latencyMs: number, note?: string) {
    skillRegistry.recordOutcome(skillId, outcome, latencyMs, note);
  }

  /**
   * Propose a strategy update. Security-sensitive changes require authorization.
   */
  proposeStrategy(domain: string, proposedChange: string, risk: 'low' | 'medium' | 'high'): StrategyUpdateCandidate {
    const evidence = Array.from(this.lessons.values()).filter((l) => l.domain === domain).slice(-5);
    const candidate: StrategyUpdateCandidate = {
      domain,
      proposedChange,
      evidence,
      risk,
      requiresAuthorization: risk === 'high' || risk === 'medium',
    };
    this.strategyCandidates.push(candidate);
    return candidate;
  }

  /**
   * Promote an authorized strategy update into effect.
   */
  promoteStrategy(candidate: StrategyUpdateCandidate, authorized: boolean) {
    if (candidate.requiresAuthorization && !authorized) {
      return { promoted: false, reason: 'Strategy change requires explicit authorization' };
    }
    eventBus.emit('capability.score_updated', 'LearningEngine', { domain: candidate.domain, promoted: true });
    return { promoted: true };
  }

  getLessons(): Lesson[] {
    return Array.from(this.lessons.values());
  }

  getStrategyCandidates(): StrategyUpdateCandidate[] {
    return [...this.strategyCandidates];
  }
}

export const learningEngine = new LearningEngine();
