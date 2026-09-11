import { eventBus } from '../events/EventBus';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface SkillFailureMode {
  mode: string;
  cause: string;
  recovery: string;
  alternativeCapability?: string;
}

export interface SkillPerformanceRecord {
  timestamp: number;
  outcome: 'success' | 'failure';
  latencyMs: number;
  note?: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  provider: string;
  providers: string[]; // all capable providers, ordered by preference
  inputs: string[];
  outputs: string[];
  tools: string[];
  mcpServers: string[];
  agents: string[];
  requiredPermissions: string[];
  riskLevel: RiskLevel;
  dependencies: string[];
  preconditions: string[];
  successCriteria: string[];
  failureModes: SkillFailureMode[];
  verification: string;
  latencyProfile: { min: number; max: number; typical: number };
  reliabilityProfile: number; // 0-1
  learningHistory: SkillPerformanceRecord[];
  availability: 'available' | 'degraded' | 'unavailable';
}

export interface SkillCandidate {
  skill: Skill;
  score: number;
  reasons: string[];
}

export class SkillRegistry {
  private skills = new Map<string, Skill>();

  register(skill: Skill) {
    this.skills.set(skill.id, skill);
    eventBus.emit('skill.registered', 'SkillRegistry', { skillId: skill.id, name: skill.name });
  }

  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  findByProvider(provider: string): Skill[] {
    return this.getAll().filter((s) => s.providers.includes(provider));
  }

  findByCapability(need: string): Skill[] {
    const n = need.toLowerCase();
    return this.getAll().filter(
      (s) =>
        s.name.toLowerCase().includes(n) ||
        s.description.toLowerCase().includes(n) ||
        s.outputs.some((o) => o.toLowerCase().includes(n)) ||
        s.tools.some((t) => t.toLowerCase().includes(n))
    );
  }

  /**
   * Score available skills for a given goal using capability fit, latency,
   * reliability, recent success rate, permissions, cost, and failure history.
   */
  rankForGoal(goal: string, requiredPermission?: string): SkillCandidate[] {
    const goalLower = goal.toLowerCase();
    const candidates: SkillCandidate[] = [];

    for (const skill of this.skills.values()) {
      if (skill.availability === 'unavailable') continue;
      if (requiredPermission && !skill.requiredPermissions.includes(requiredPermission)) continue;

      let score = 0;
      const reasons: string[] = [];

      // Capability fit
      if (
        skill.name.toLowerCase().includes(goalLower) ||
        skill.description.toLowerCase().includes(goalLower)
      ) {
        score += 40;
        reasons.push('direct-capability-match');
      } else {
        score += 5;
      }

      // Reliability
      score += skill.reliabilityProfile * 30;
      if (skill.reliabilityProfile > 0.85) reasons.push('high-reliability');

      // Recent success rate from learning history
      const recent = skill.learningHistory.slice(-10);
      if (recent.length > 0) {
        const successRate = recent.filter((r) => r.outcome === 'success').length / recent.length;
        score += successRate * 20;
        if (successRate >= 0.8) reasons.push('strong-recent-success');
        if (successRate < 0.5) reasons.push('recent-failures-lower-score');
      } else {
        score += 10;
      }

      // Latency preference (lower = better score)
      const latencyScore = Math.max(0, 10 - skill.latencyProfile.typical / 500);
      score += latencyScore;

      // Risk penalty
      const riskPenalty: Record<RiskLevel, number> = { low: 0, medium: 5, high: 12, critical: 20 };
      score -= riskPenalty[skill.riskLevel];

      candidates.push({ skill, score: Math.max(0, Math.min(100, score)), reasons });
    }

    return candidates.sort((a, b) => b.score - a.score);
  }

  recordOutcome(skillId: string, outcome: 'success' | 'failure', latencyMs: number, note?: string) {
    const skill = this.skills.get(skillId);
    if (!skill) return;
    skill.learningHistory.push({ timestamp: Date.now(), outcome, latencyMs, note });
    // Keep bounded history
    if (skill.learningHistory.length > 100) {
      skill.learningHistory = skill.learningHistory.slice(-100);
    }

    // Update reliability profile with exponential moving average
    const success = outcome === 'success' ? 1 : 0;
    skill.reliabilityProfile = skill.reliabilityProfile * 0.9 + success * 0.1;

    eventBus.emit('capability.score_updated', 'SkillRegistry', { skillId, outcome, reliabilityProfile: skill.reliabilityProfile });
  }
}

export const skillRegistry = new SkillRegistry();
