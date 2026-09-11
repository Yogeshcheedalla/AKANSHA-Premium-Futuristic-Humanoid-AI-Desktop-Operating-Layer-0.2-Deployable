import { memoryFabric } from '../memory/MemoryFabric';
import { experienceReplay } from '../learning/ExperienceReplay';
import { ambientContext } from '../ambient/AmbientContextEngine';
import { preferenceEngine, userStateEngine } from '../user/UserModel';
import { voicePipeline } from '../voice/VoicePipeline';
import { eventBus } from '../events/EventBus';

/* ═══════════════ DECISION TRACE ═══════════════ */

export interface TraceStep {
  label: string;
  detail: string;
  at: number;
}

export interface DecisionTrace {
  traceId: string;
  requestId: string;
  missionId?: string;
  intent: string;
  trigger: string;
  contextSnapshot: Record<string, unknown>;
  candidateTools: Array<{ id: string; score: number; reason: string }>;
  selectedTool: string | null;
  selectedModel?: { provider: string; modelId: string };
  riskAssessment: { score: number; action: string; reasons: string[] };
  escalationDecision: { decision: string; reason: string };
  verificationResult?: { performed: boolean; passed: boolean; evidence?: string };
  outcome: 'success' | 'failure' | 'pending';
  steps: TraceStep[];
  createdAt: number;
}

/* ═══════════════ EXPLANATION ENGINE ═══════════════ */

/**
 * ExplanationEngine — makes Akansha accountable and inspectable.
 *
 * Supports the four questions that build trust:
 *   "Why did you do that?"
 *   "What are you doing?"
 *   "What do you know about me?"
 *   "What did you learn?"
 */
export class ExplanationEngine {
  private traces = new Map<string, DecisionTrace>();
  private maxTraces = 200;

  recordTrace(trace: Omit<DecisionTrace, 'traceId' | 'createdAt' | 'steps'> & { steps?: TraceStep[] }): DecisionTrace {
    const full: DecisionTrace = {
      ...trace,
      traceId: `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      steps: trace.steps || [],
      createdAt: Date.now(),
    };
    this.traces.set(full.traceId, full);
    if (this.traces.size > this.maxTraces) {
      const oldest = Array.from(this.traces.keys()).slice(0, this.traces.size - this.maxTraces);
      for (const k of oldest) this.traces.delete(k);
    }
    eventBus.emit('observation.created', 'ExplanationEngine', { traceId: full.traceId, intent: full.intent });
    return full;
  }

  /** "Why did you do that?" — a full, human-readable justification. */
  why(traceId: string): string {
    const t = this.traces.get(traceId);
    if (!t) return "I don't have a recorded trace for that decision.";

    const lines: string[] = [];
    lines.push(`You asked me to "${t.trigger}". I classified that as ${t.intent.replace(/_/g, ' ')}.`);

    if (t.selectedModel) {
      lines.push(`I used ${t.selectedModel.provider} → ${t.selectedModel.modelId}.`);
    }

    if (t.candidateTools.length > 1) {
      const alternatives = t.candidateTools
        .filter((c) => c.id !== t.selectedTool)
        .slice(0, 2)
        .map((c) => c.id)
        .join(' and ');
      lines.push(
        `I chose ${t.selectedTool} over ${alternatives} because ${t.candidateTools.find((c) => c.id === t.selectedTool)?.reason || 'it scored highest'}.`
      );
    } else if (t.selectedTool) {
      lines.push(`I used the ${t.selectedTool} capability for this.`);
    }

    if (t.riskAssessment.reasons.length) {
      lines.push(`Risk was scored ${t.riskAssessment.score}/100 (${t.riskAssessment.action.replace(/_/g, ' ').toLowerCase()}) — ${t.riskAssessment.reasons.join(', ')}.`);
    }

    lines.push(`${t.escalationDecision.decision.replace(/_/g, ' ').toLowerCase()} because ${t.escalationDecision.reason}.`);

    if (t.verificationResult?.performed) {
      lines.push(
        t.verificationResult.passed
          ? `I verified the result: ${t.verificationResult.evidence || 'observed state matched expectation'}.`
          : `Verification FAILED — ${t.verificationResult.evidence || 'the observed state did not match what was expected'}.`
      );
    } else if (t.outcome === 'success') {
      lines.push('This was resolved deterministically, so no verification step was required.');
    }

    return lines.join(' ');
  }

  /** "What are you doing right now?" — never just "processing". */
  whatAreYouDoing(): string {
    const state = userStateEngine.getState();
    const voice = voicePipeline.getState();
    const replay = experienceReplay.replay();
    const anomalies = ambientContext.detectAnomalies();
    const recent = ambientContext.relevant(0.5, 3);

    const lines: string[] = [];

    lines.push(
      voice.mode === 'ACTIVE_CONVERSATION'
        ? "I'm in conversation with you, listening for your next request."
        : `I'm in ${voice.mode.replace(/_/g, ' ').toLowerCase()} — wake-word detection only, nothing is being transcribed.`
    );

    if (recent.length > 0) {
      lines.push(`In the background I'm tracking: ${recent.map((r) => r.title.toLowerCase()).join('; ')}.`);
    }

    if (anomalies.length > 0) {
      lines.push(`I've flagged ${anomalies.length} anomaly: ${anomalies[0]}`);
    }

    if (replay.anomalies.length > 0) {
      lines.push(`On capability health: ${replay.anomalies[0].detail}`);
    }

    const lessons = replay.lessons.filter((l) => l.evidenceCount >= 2);
    if (lessons.length > 0) {
      lines.push(`I'm carrying ${lessons.length} active lessons from past work.`);
    }

    lines.push(`You appear to be ${state.state.toLowerCase()} (confidence ${(state.confidence * 100).toFixed(0)}%), so my interrupt level is set to "${state.interruptibility}".`);

    if (lines.length === 1) lines.push('Nothing else is running.');

    return lines.join(' ');
  }

  /** "What do you know about me?" — transparent, correctable, confidence-stated. */
  whatDoYouKnow(): {
    intro: string;
    preferences: string[];
    habits: string[];
    projects: string[];
    procedures: string[];
    uncertain: string[];
    boundaries: string[];
    outro: string;
  } {
    const report = memoryFabric.selfReport();
    const prefSummary = preferenceEngine.summarise();

    return {
      intro: 'Here is what I believe about how you like to work. You can correct anything.',
      preferences: report.preferences.length ? report.preferences : prefSummary.communication,
      habits: report.habits,
      projects: report.projects,
      procedures: report.procedures,
      uncertain: report.hedged,
      boundaries: prefSummary.boundaries,
      outro: 'Nothing here is certain unless you told me directly — lower-confidence items are marked. Say "forget that" to remove anything.',
    };
  }

  /** "What did you learn?" — makes the learning system visible. */
  whatDidYouLearn(): { intro: string; lessons: string[]; anomalies: string[]; modelInsights: string[]; stats: ReturnType<typeof experienceReplay.stats> } {
    const replay = experienceReplay.replay();
    return {
      intro: replay.summary.length
        ? 'Since I started, here is what I learned:'
        : "I haven't accumulated enough experience yet to have drawn conclusions.",
      lessons: replay.lessons.slice(0, 8).map((l) =>
        `${l.outcome === 'failure' ? '⚠' : '✓'} ${l.lesson} (${l.evidenceCount} observations, ${(l.confidence * 100).toFixed(0)}% confidence)`
      ),
      anomalies: replay.anomalies.map((a) => a.detail),
      modelInsights: replay.modelInsights.map((m) => `${m.model}: ${m.recommendation}`),
      stats: experienceReplay.stats(),
    };
  }

  /** "What's happening in the background?" */
  whatsHappening(): { timeline: string[]; quarantined: number; stats: ReturnType<typeof ambientContext.stats> } {
    return {
      timeline: ambientContext.describe(14),
      quarantined: ambientContext.stats().quarantined,
      stats: ambientContext.stats(),
    };
  }

  getTrace(traceId: string): DecisionTrace | undefined {
    return this.traces.get(traceId);
  }

  recentTraces(limit = 15): DecisionTrace[] {
    return Array.from(this.traces.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  /** Search traces by intent or trigger text. */
  searchTraces(query: string, limit = 10): DecisionTrace[] {
    const q = query.toLowerCase();
    return Array.from(this.traces.values())
      .filter((t) => t.trigger.toLowerCase().includes(q) || t.intent.toLowerCase().includes(q))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }
}

export const explanationEngine = new ExplanationEngine();
