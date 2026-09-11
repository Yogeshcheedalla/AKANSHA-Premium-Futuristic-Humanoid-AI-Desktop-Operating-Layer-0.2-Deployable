import { clamp } from '../ml/AkanshaML';
import type { UserStateAssessment } from '../user/UserModel';
import { preferenceEngine } from '../user/UserModel';
import { eventBus } from '../events/EventBus';

/* ═══════════════ INTERRUPTION INTELLIGENCE ═══════════════ */

export type SpeakDecision =
  | 'SPEAK_NOW'
  | 'WAIT'
  | 'NOTIFY_SILENTLY'
  | 'STORE_FOR_LATER'
  | 'ASK_NEXT_TIME'
  | 'NEVER_INTERRUPT';

export const DECISION_LABEL: Record<SpeakDecision, string> = {
  SPEAK_NOW: 'Speak now',
  WAIT: 'Wait for a natural pause',
  NOTIFY_SILENTLY: 'Notify silently',
  STORE_FOR_LATER: 'Store for later',
  ASK_NEXT_TIME: 'Ask next time you interact',
  NEVER_INTERRUPT: 'Do not interrupt',
};

export interface CandidateNotification {
  id: string;
  title: string;
  /** 0-1 — how urgent is this right now? */
  urgency: number;
  /** 0-1 — how important overall? */
  importance: number;
  /** 0-1 — how confident are we in the interpretation? */
  confidence: number;
  /** 0-1 — is it time-critical (expires)? */
  timeSensitivity: number;
  /** 0-1 — is the user directly working on this? */
  relevanceToCurrentWork: number;
  risk: 'low' | 'medium' | 'high' | 'critical';
  requiresAction: boolean;
  source: string;
  expiresAt?: number;
}

export interface InterruptionHistory {
  recentInterruptions: number;      // in the last 30 minutes
  lastInterruptionAt: number | null;
  /** 0-1 — did past interruptions land well? */
  receptivenessScore: number;
}

export interface ShouldSpeakInput {
  notification: CandidateNotification;
  userState: UserStateAssessment;
  history: InterruptionHistory;
  currentConversationActive: boolean;
  hourOfDay: number;
  /** Explicit user override */
  dndLevel?: 'critical-only' | 'important' | 'normal' | 'everything';
}

export interface ShouldSpeakResult {
  decision: SpeakDecision;
  score: number;
  reasons: string[];
  /** How the decision should be delivered */
  delivery: 'voice' | 'banner' | 'badge' | 'silent' | 'deferred';
}

/**
 * InterruptionManager — the "Should I speak?" system.
 *
 * Akansha must not interrupt just because it HAS information. This is a
 * deterministic multi-factor decision — no LLM call, so it is instant.
 *
 * Example outcomes the weighting produces:
 *   Coding + random Instagram like      → NEVER_INTERRUPT
 *   Coding + failing build being worked on → SPEAK_NOW
 *   Meeting + non-urgent email          → STORE_FOR_LATER
 */
export class InterruptionManager {
  private history: InterruptionHistory = {
    recentInterruptions: 0,
    lastInterruptionAt: null,
    receptivenessScore: 0.5,
  };
  private interruptionLog: Array<{ at: number; notification: string; decision: SpeakDecision }> = [];

  /** Record how the user reacted — feeds receptiveness learning. */
  recordReaction(accepted: boolean) {
    // EWMA so recent reactions dominate
    this.history.receptivenessScore =
      this.history.receptivenessScore * 0.8 + (accepted ? 1 : 0) * 0.2;

    if (!accepted) {
      eventBus.emit('learning.lesson_created', 'InterruptionManager', {
        lesson: 'User dismissed an interruption — reduce frequency',
        receptiveness: this.history.receptivenessScore,
      });
    }
    // Learn the preference too
    preferenceEngine.observe({
      capability: 'proactive.interruption',
      approved: accepted,
      source: 'implicit',
      riskTier: 'low',
      weight: 0.6,
    });
  }

  shouldSpeak(input: ShouldSpeakInput): ShouldSpeakResult {
    const { userState: us, currentConversationActive } = input;
    const reasons: string[] = [];

    /* ── NORMALISE INPUT ──
       A missing or malformed field must NEVER produce NaN, because NaN
       propagates through every comparison and silently breaks the decision.
       Unknown values are treated as "unremarkable" (0.5 / false). */
    const num = (v: unknown, fallback = 0.5): number => {
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
    };

    const n: CandidateNotification = {
      id: input.notification?.id ?? `notif-${Date.now()}`,
      title: input.notification?.title ?? 'Untitled notification',
      urgency: num(input.notification?.urgency, 0.3),
      importance: num(input.notification?.importance, 0.3),
      confidence: num(input.notification?.confidence, 0.8),
      timeSensitivity: num(input.notification?.timeSensitivity, 0.2),
      relevanceToCurrentWork: num(
        (input.notification as CandidateNotification | undefined)?.relevanceToCurrentWork ??
        (input.notification as { relevance?: unknown } | undefined)?.relevance,
        0.3
      ),
      risk: input.notification?.risk ?? 'low',
      requiresAction: !!input.notification?.requiresAction,
      source: input.notification?.source ?? 'unknown',
      expiresAt: input.notification?.expiresAt,
    };

    let score = 0;

    /* ── URGENCY & IMPORTANCE ── */
    score += n.urgency * 30;
    if (n.urgency > 0.7) reasons.push('time-critical');

    score += n.importance * 22;
    if (n.importance > 0.7) reasons.push('high importance');

    score += n.timeSensitivity * 14;
    if (n.timeSensitivity > 0.7) reasons.push('expires soon');

    /* ── RELEVANCE — the strongest human-like factor ── */
    score += n.relevanceToCurrentWork * 26;
    if (n.relevanceToCurrentWork > 0.75) {
      reasons.push(`directly relevant to ${us.state.toLowerCase()}`);
    } else if (n.relevanceToCurrentWork < 0.2) {
      score -= 32;
      reasons.push('not related to current work');
    }

    /* ── ACTION REQUIREMENT ── */
    if (n.requiresAction) { score += 12; reasons.push('requires a decision'); }

    /* ── CONFIDENCE ── */
    if (n.confidence < 0.6) { score -= 18; reasons.push('low interpretation confidence'); }

    /* ── RISK ── */
    if (n.risk === 'critical' || n.risk === 'high') { score += 10; reasons.push('risk-relevant'); }

    /* ── USER STATE PENALTIES ── */
    const statePenalty: Partial<Record<string, number>> = {
      SLEEPING: 95,
      DO_NOT_DISTURB: 95,
      MEETING: 48,
      PRESENTING: 60,
      GAMING: 40,
      CODING: 22,
      FOCUSED: 18,
      READING: 12,
      WATCHING: 10,
      CALLING: 44,
    };
    const penalty = statePenalty[us.state] ?? 0;
    if (penalty) {
      // Scale by how confident we are in the state inference
      const effective = penalty * us.confidence;
      score -= effective;
      reasons.push(`${us.state.toLowerCase()} (state confidence ${us.confidence.toFixed(2)})`);
    }

    /* ── FREQUENCY / FATIGUE ── */
    if (this.history.recentInterruptions >= 3) {
      score -= 22;
      reasons.push(`${this.history.recentInterruptions} recent interruptions`);
    }
    if (this.history.lastInterruptionAt && Date.now() - this.history.lastInterruptionAt < 120000) {
      score -= 14;
      reasons.push('interrupted less than 2 minutes ago');
    }
    if (this.history.receptivenessScore < 0.35) {
      score -= 16;
      reasons.push('user has been dismissing interruptions');
    }

    /* ── TIME OF DAY ── */
    const hour = input.hourOfDay;
    if (hour >= 23 || hour < 7) { score -= 30; reasons.push('night hours'); }

    /* ── ACTIVE CONVERSATION ── */
    if (currentConversationActive) {
      // Mid-conversation: only truly urgent matters break in
      if (n.urgency < 0.8) { score -= 25; reasons.push('conversation in progress'); }
      else { score += 8; reasons.push('urgent during conversation'); }
    }

    score = Math.max(-100, Math.min(100, Math.round(score)));

    /* ── RESOLVE THE DECISION ── */
    let decision: SpeakDecision;

    // Explicit DND override
    const dnd = input.dndLevel ?? us.interruptibility;
    if (dnd === 'critical-only' && n.urgency < 0.85 && n.risk !== 'critical') {
      decision = 'NEVER_INTERRUPT';
    } else if (score >= 45) {
      decision = 'SPEAK_NOW';
    } else if (score >= 25) {
      decision = 'NOTIFY_SILENTLY';
    } else if (score >= 5) {
      decision = score >= 12 ? 'WAIT' : 'STORE_FOR_LATER';
    } else if (score >= -25) {
      decision = 'STORE_FOR_LATER';
    } else {
      decision = 'NEVER_INTERRUPT';
    }

    // Never voice-speak during a meeting or presentation unless critical
    if ((us.state === 'MEETING' || us.state === 'PRESENTING') && decision === 'SPEAK_NOW' && n.urgency < 0.9) {
      decision = 'NOTIFY_SILENTLY';
      reasons.push('downgraded to silent during meeting');
    }

    const delivery: ShouldSpeakResult['delivery'] =
      decision === 'SPEAK_NOW' ? 'voice'
      : decision === 'NOTIFY_SILENTLY' ? 'banner'
      : decision === 'WAIT' ? 'banner'
      : decision === 'STORE_FOR_LATER' ? 'deferred'
      : 'silent';

    const result: ShouldSpeakResult = {
      decision,
      score,
      reasons: reasons.length ? reasons : ['neutral factors'],
      delivery,
    };

    this.interruptionLog.push({ at: Date.now(), notification: n.title, decision });
    if (this.interruptionLog.length > 100) this.interruptionLog = this.interruptionLog.slice(-100);

    if (decision === 'SPEAK_NOW' || decision === 'NOTIFY_SILENTLY') {
      this.history.recentInterruptions += 1;
      this.history.lastInterruptionAt = Date.now();
      // Decay the counter over time
      setTimeout(() => { this.history.recentInterruptions = Math.max(0, this.history.recentInterruptions - 1); }, 30 * 60 * 1000);
    }

    eventBus.emit('tool.completed', 'InterruptionManager', {
      title: n.title, decision, score, state: us.state,
    });

    return result;
  }

  getHistory() {
    return { ...this.history, log: this.interruptionLog.slice(-20) };
  }
}

export const interruptionManager = new InterruptionManager();

/* ═══════════════ AMBIENT AWARENESS (not surveillance) ═══════════════ */

export type AmbientEventType =
  | 'window_changed' | 'app_launched' | 'app_closed'
  | 'notification_received' | 'calendar_event' | 'file_changed'
  | 'download_completed' | 'github_event' | 'email_event' | 'social_event'
  | 'mission_progress' | 'mission_failed' | 'build_failed' | 'test_failed'
  | 'system_warning' | 'battery_low' | 'disk_full' | 'network_changed'
  | 'device_connected' | 'device_disconnected' | 'error_dialog';

export interface AmbientEvent {
  id: string;
  type: AmbientEventType;
  source: string;
  title: string;
  detail?: string;
  timestamp: number;
  /** 0-1 urgency */
  urgency: number;
  /** 0-1 importance */
  importance: number;
  /** 0-1 relevance to the user's current project/work */
  relevance: number;
  requiresAction: boolean;
  /** Trust level of the source — external content is low-trust */
  trustLevel: 'TRUSTED' | 'KNOWN_APPLICATION' | 'CONNECTED_PROVIDER' | 'EXTERNAL_CONTENT' | 'UNKNOWN';
  /** Never allow external content to carry instructions */
  containsInstructions: boolean;
}

export interface CollectorStats {
  collector: string;
  eventsCollected: number;
  lastEventAt: number | null;
  enabled: boolean;
}

/**
 * AmbientContextEngine — watches AUTHORISED SYSTEM EVENTS rather than
 * recording the world. Every event is relevance-filtered before it can
 * influence anything.
 */
export class AmbientContextEngine {
  private events: AmbientEvent[] = [];
  private collectors = new Map<string, CollectorStats>();
  private maxEvents = 400;

  registerCollector(name: string) {
    this.collectors.set(name, { collector: name, eventsCollected: 0, lastEventAt: null, enabled: true });
  }

  setCollectorEnabled(name: string, enabled: boolean) {
    const c = this.collectors.get(name);
    if (c) c.enabled = enabled;
  }

  /** Ingest an event. Events containing instructions from untrusted sources are quarantined. */
  ingest(event: Omit<AmbientEvent, 'id' | 'timestamp'>): AmbientEvent | null {
    const collector = this.collectors.get(event.source);
    if (collector && !collector.enabled) return null;

    const full: AmbientEvent = {
      ...event,
      id: `amb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
    };

    // QUARANTINE: external content that tries to give instructions
    if (full.containsInstructions && (full.trustLevel === 'EXTERNAL_CONTENT' || full.trustLevel === 'UNKNOWN')) {
      eventBus.emit('tool.failed', 'AmbientContextEngine', {
        quarantined: full.id,
        reason: 'External content attempted to inject instructions',
        source: full.source,
      });
      // Keep it for audit, but neutralise its influence
      full.relevance = 0;
      full.importance = 0;
      full.urgency = 0;
    }

    this.events.push(full);
    if (this.events.length > this.maxEvents) this.events = this.events.slice(-this.maxEvents);

    if (collector) {
      collector.eventsCollected++;
      collector.lastEventAt = full.timestamp;
    }

    eventBus.emit('observation.created', 'AmbientContextEngine', {
      type: full.type, title: full.title, urgency: full.urgency,
    });
    return full;
  }

  /** Relevance filter — only meaningful events surface. */
  relevant(minImportance = 0.4, limit = 20): AmbientEvent[] {
    return this.events
      .filter((e) => e.importance >= minImportance || e.urgency >= 0.7)
      .sort((a, b) => (b.urgency * 0.6 + b.importance * 0.4) - (a.urgency * 0.6 + a.importance * 0.4))
      .slice(0, limit);
  }

  /** Answer "what is happening in the background?" */
  describe(limit = 12): string[] {
    const recent = this.events.slice(-limit).reverse();
    if (recent.length === 0) return ['Nothing significant is happening in the background.'];
    return recent.map((e) => {
      const t = new Date(e.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      return `${t} — ${e.title}${e.detail ? `: ${e.detail}` : ''}`;
    });
  }

  /** Detect anomalies in ambient event rates. */
  detectAnomalies(): string[] {
    const now = Date.now();
    const warnings: string[] = [];

    // Burst detection — >5 events in 10 seconds from one source
    const bySource = new Map<string, AmbientEvent[]>();
    for (const e of this.events) {
      if (now - e.timestamp > 10000) continue;
      const list = bySource.get(e.source) || [];
      list.push(e);
      bySource.set(e.source, list);
    }
    for (const [source, list] of bySource) {
      if (list.length > 5) warnings.push(`Event burst from ${source} (${list.length} in 10s) — possible loop or runaway process`);
    }

    // Repeated failure detection
    const failures = this.events.filter((e) => (e.type === 'build_failed' || e.type === 'test_failed') && now - e.timestamp < 600000);
    if (failures.length >= 3) warnings.push(`${failures.length} build/test failures in the last 10 minutes`);

    return warnings;
  }

  getTimeline(limit = 60) {
    return this.events.slice(-limit).reverse();
  }

  stats() {
    const byType: Record<string, number> = {};
    for (const e of this.events) byType[e.type] = (byType[e.type] || 0) + 1;
    return {
      total: this.events.length,
      byType,
      collectors: Array.from(this.collectors.values()),
      quarantined: this.events.filter((e) => e.relevance === 0 && e.importance === 0).length,
    };
  }
}

export const ambientContext = new AmbientContextEngine();

// Register the standard collectors
[
  'WindowsEventCollector',
  'AppEventCollector',
  'NotificationCollector',
  'CalendarCollector',
  'MissionCollector',
  'DeviceCollector',
  'SystemHealthCollector',
  'SocialEventCollector',
].forEach((c) => ambientContext.registerCollector(c));
