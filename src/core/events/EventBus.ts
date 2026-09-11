export type AkanshaEventType =
  | 'mission.created'
  | 'mission.planned'
  | 'mission.completed'
  | 'mission.failed'
  | 'mission.cancelled'
  | 'agent.started'
  | 'agent.completed'
  | 'agent.failed'
  | 'mcp.connected'
  | 'mcp.failed'
  | 'mcp.discovered'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'observation.created'
  | 'verification.started'
  | 'verification.passed'
  | 'verification.failed'
  | 'recovery.started'
  | 'retry.started'
  | 'replan.started'
  | 'evaluation.completed'
  | 'learning.lesson_created'
  | 'capability.score_updated'
  | 'avatar.state_changed'
  | 'speech.started'
  | 'speech.completed'
  | 'speech.interrupted'
  | 'skill.registered'
  | 'connector.connected'
  | 'connector.failed'
  | 'memory.updated'
  | 'resource.throttled'
  | 'integration.health_changed'
  | 'model.selected'
  | 'request.received'
  | 'auth.granted'
  | 'auth.rejected'
  | 'auth.denied'
  | 'auth.revoked'
  | 'auth.bootstrap_created'
  | 'execution.started'
  | 'execution.evidence'
  | 'voice.state_changed'
  | 'asr.final'
  | 'tts.speaking';

export interface AkanshaEvent {
  type: AkanshaEventType;
  requestId?: string;
  missionId?: string;
  taskId?: string;
  goalId?: string;
  speechId?: string;
  source: string;
  payload: any;
  timestamp: number;
  eventId: string;
}

type Listener = (event: AkanshaEvent) => void;

export class EventBus {
  private listeners = new Map<AkanshaEventType | '*', Set<Listener>>();
  private history: AkanshaEvent[] = [];
  private historyLimit = 500;

  emit(
    type: AkanshaEventType,
    source: string,
    payload: any = {},
    correlation: Partial<Pick<AkanshaEvent, 'requestId' | 'missionId' | 'taskId' | 'goalId' | 'speechId'>> = {}
  ) {
    const event: AkanshaEvent = {
      type,
      source,
      payload,
      timestamp: Date.now(),
      eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...correlation,
    };

    this.history.push(event);
    if (this.history.length > this.historyLimit) {
      this.history = this.history.slice(-this.historyLimit);
    }

    const specific = this.listeners.get(type);
    const all = this.listeners.get('*');
    specific?.forEach((l) => l(event));
    all?.forEach((l) => l(event));
  }

  on(type: AkanshaEventType | '*', listener: Listener): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(listener);
    return () => {
      this.listeners.get(type)?.delete(listener);
    };
  }

  getHistory(limit = 100): AkanshaEvent[] {
    return this.history.slice(-limit);
  }

  getHistoryByMission(missionId: string): AkanshaEvent[] {
    return this.history.filter((e) => e.missionId === missionId);
  }
}

export const eventBus = new EventBus();
