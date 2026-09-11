import { BayesianBelief, clamp } from '../ml/AkanshaML';
import { eventBus } from '../events/EventBus';

/* ═══════════════ FUNCTIONAL ASSISTANCE PROFILE ═══════════════ */

export interface CommunicationStyle {
  verbosity: 'concise' | 'balanced' | 'detailed';
  technicalDepth: 'simple' | 'practical' | 'expert';
  prefersActionOverQuestions: boolean;
  stepByStepExplanations: boolean;
  humour: 'none' | 'light' | 'playful';
}

export interface InteractionStyle {
  modality: 'voice-first' | 'text-first' | 'hybrid';
  proactiveAssistance: boolean;
  interruptionTolerance: 'low' | 'medium' | 'high';
  confirmationPreference: 'minimal' | 'balanced' | 'always';
}

export interface ExecutionExpectations {
  wantsTruthfulCompletion: boolean;
  wantsVerification: boolean;
  wantsAutomaticRecovery: boolean;
  dislikesDisconnectedDemos: boolean;
  wantsCompleteImplementations: boolean;
}

export interface LearningExpectations {
  correctionsShouldPersist: boolean;
  successfulWorkflowsBecomeSkills: boolean;
  mistakesShouldNotRepeat: boolean;
}

export interface UserBoundaries {
  neverStorePasswords: boolean;
  neverStoreOtps: boolean;
  neverRecordContinuously: boolean;
  requireConfirmationForExternalMessages: boolean;
  requireConfirmationForFinancialActions: boolean;
  allowAmbientMonitoring: boolean;
  allowScreenContext: boolean;
  allowSpeakerIdentification: boolean;
}

/** A functional assistance profile — NOT a psychological evaluation. */
export interface AssistanceProfile {
  userId: string;
  displayName: string;
  communication: CommunicationStyle;
  interaction: InteractionStyle;
  execution: ExecutionExpectations;
  learning: LearningExpectations;
  boundaries: UserBoundaries;
  activeProjects: string[];
  workingHours: { start: number; end: number };
  updatedAt: number;
}

const DEFAULT_PROFILE: AssistanceProfile = {
  userId: 'boss',
  displayName: 'Boss',
  communication: {
    verbosity: 'concise',
    technicalDepth: 'expert',
    prefersActionOverQuestions: true,
    stepByStepExplanations: false,
    humour: 'light',
  },
  interaction: {
    modality: 'voice-first',
    proactiveAssistance: true,
    interruptionTolerance: 'low',
    confirmationPreference: 'minimal',
  },
  execution: {
    wantsTruthfulCompletion: true,
    wantsVerification: true,
    wantsAutomaticRecovery: true,
    dislikesDisconnectedDemos: true,
    wantsCompleteImplementations: true,
  },
  learning: {
    correctionsShouldPersist: true,
    successfulWorkflowsBecomeSkills: true,
    mistakesShouldNotRepeat: true,
  },
  boundaries: {
    neverStorePasswords: true,
    neverStoreOtps: true,
    neverRecordContinuously: true,
    requireConfirmationForExternalMessages: true,
    requireConfirmationForFinancialActions: true,
    allowAmbientMonitoring: true,
    allowScreenContext: true,
    allowSpeakerIdentification: false,
  },
  activeProjects: ['Akansha'],
  workingHours: { start: 8, end: 24 },
  updatedAt: Date.now(),
};

/* ═══════════════ PREFERENCE LEARNING ═══════════════ */

export interface LearnedPreference {
  key: string;             // e.g. "windows.launch_application"
  capability: string;
  scope: string;
  value: boolean | string | number;
  mean: number;            // posterior probability
  confidence: number;      // 0-1
  evidenceCount: number;
  riskTier: 'low' | 'medium' | 'high';
  source: 'explicit' | 'implicit' | 'observed';
  lastUpdated: number;
  expiresAt?: number;
}

export interface PreferenceObservation {
  capability: string;
  scope?: string;
  /** What the user chose / implied. */
  approved: boolean;
  source: 'explicit' | 'implicit' | 'observed';
  riskTier: 'low' | 'medium' | 'high';
  weight?: number;
  note?: string;
}

/**
 * Preference Learning Engine.
 *
 * Learns "does the user want confirmation for this capability?" using
 * Beta-Bernoulli Bayesian updating — explicit feedback weighted far more than
 * inference from behaviour, recency applied, and confidence never allowed to
 * leak ACROSS capabilities (learning "don't ask before opening files" must
 * never imply "don't ask before sending money").
 */
export class PreferenceLearningEngine {
  private beliefs = new BayesianBelief();
  private preferences = new Map<string, LearnedPreference>();
  private profile: AssistanceProfile = { ...DEFAULT_PROFILE };

  /** Capability scopes that must NEVER inherit learned autonomy. */
  private static ISOLATED_CAPABILITIES = new Set([
    'financial.transaction',
    'external_message.send',
    'credential.access',
    'system.destructive',
    'publish.content',
  ]);

  constructor() {
    // Seed from the baseline profile so early behaviour matches stated boundaries
    this.beliefs.init('windows.launch_application', { alpha: 4, beta: 1.2 });
    this.beliefs.init('filesystem.read_file', { alpha: 4, beta: 1.2 });
    this.beliefs.init('filesystem.write_file', { alpha: 2.5, beta: 2 });
    this.beliefs.init('external_message.send', { alpha: 1, beta: 5 });
    this.beliefs.init('financial.transaction', { alpha: 1, beta: 9 });
    this.beliefs.init('publish.content', { alpha: 1, beta: 5 });
    this.beliefs.init('proactive.interruption', { alpha: 1, beta: 2 });
  }

  getProfile(): AssistanceProfile {
    return { ...this.profile };
  }

  updateProfile(patch: Partial<AssistanceProfile>) {
    this.profile = { ...this.profile, ...patch, updatedAt: Date.now() };
  }

  private keyFor(capability: string, scope?: string) {
    return scope ? `${capability}::${scope}` : capability;
  }

  /**
   * Record an observation and update the posterior.
   * Explicit user statements carry 3× the weight of inferred behaviour.
   */
  observe(obs: PreferenceObservation): LearnedPreference {
    const key = this.keyFor(obs.capability, obs.scope);

    // NEVER learn autonomy for isolated high-risk capabilities
    if (PreferenceLearningEngine.ISOLATED_CAPABILITIES.has(obs.capability)) {
      return this.snapshot(key, obs.capability, obs.scope || 'global', obs.approved, obs.source, obs.riskTier, true);
    }

    const weight = (obs.weight ?? 1) * (obs.source === 'explicit' ? 3 : 1);
    this.beliefs.update(key, obs.approved, weight);
    if (obs.note) this.beliefs.update(`${key}::note`, obs.approved, 0); // no-op, keeps key known

    const pref = this.snapshot(key, obs.capability, obs.scope || 'global', obs.approved, obs.source, obs.riskTier, false);
    this.preferences.set(key, pref);

    eventBus.emit('memory.updated', 'PreferenceLearning', {
      key, mean: pref.mean, confidence: pref.confidence, source: obs.source,
    });
    return pref;
  }

  private snapshot(
    key: string, capability: string, scope: string, value: boolean,
    source: LearnedPreference['source'], riskTier: LearnedPreference['riskTier'], frozen: boolean
  ): LearnedPreference {
    const mean = frozen ? 0 : this.beliefs.mean(key);
    const confidence = frozen ? 0.99 : this.beliefs.confidence(key);
    return {
      key, capability, scope, value,
      mean: frozen ? (value ? 0 : 1) : mean,
      confidence,
      evidenceCount: frozen ? 0 : this.beliefs.evidence(key),
      riskTier,
      source,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Should Akansha ask before performing this action?
   * Combines learned preference with risk tier — risk always wins.
   */
  shouldConfirm(capability: string, riskTier: 'low' | 'medium' | 'high'): { confirm: boolean; confidence: number; reason: string } {
    // High-risk capability → always confirm, regardless of what was learned
    if (riskTier === 'high' || PreferenceLearningEngine.ISOLATED_CAPABILITIES.has(capability)) {
      return { confirm: true, confidence: 0.99, reason: `${capability} is risk-isolated and always requires confirmation` };
    }

    const pref = this.preferences.get(capability) ?? this.preferences.get(this.keyFor(capability, 'global'));
    const mean = pref?.mean ?? this.beliefs.mean(capability);
    const conf = pref?.confidence ?? this.beliefs.confidence(capability);

    // Not enough evidence → fall back to the stated profile preference
    if (conf < 0.5) {
      const stated = this.profile.interaction.confirmationPreference;
      const confirm = stated === 'always' ? true : stated === 'minimal' ? riskTier === 'medium' : false;
      return { confirm, confidence: conf, reason: `insufficient evidence (${conf.toFixed(2)}); using stated preference "${stated}"` };
    }

    // mean = probability the user is happy with autonomy
    const confirm = mean < 0.6;
    return {
      confirm,
      confidence: conf,
      reason: confirm
        ? `learned that user prefers confirmation for ${capability} (p(autonomy)=${mean.toFixed(2)})`
        : `learned autonomy for ${capability} (p(autonomy)=${mean.toFixed(2)}, ${pref?.evidenceCount ?? 0} observations)`,
    };
  }

  /** Detect contradictions so we don't blindly overwrite a stable preference. */
  detectConflict(capability: string, newValue: boolean): { conflict: boolean; existing?: LearnedPreference } {
    const existing = this.preferences.get(capability);
    if (!existing) return { conflict: false };
    const disagree = (existing.value !== newValue) && existing.confidence > 0.75 && existing.evidenceCount >= 5;
    return { conflict: disagree, existing };
  }

  listPreferences(): LearnedPreference[] {
    return Array.from(this.preferences.values()).sort((a, b) => b.lastUpdated - a.lastUpdated);
  }

  /** Human-readable summary for "what do you know about me?" */
  summarise(): { communication: string[]; autonomy: string[]; boundaries: string[] } {
    const p = this.profile;
    return {
      communication: [
        `Prefers ${p.communication.verbosity} answers at ${p.communication.technicalDepth} depth`,
        p.communication.prefersActionOverQuestions ? 'Prefers direct action over clarifying questions' : 'Comfortable with clarifying questions',
        `${p.interaction.modality} interaction, ${p.interaction.interruptionTolerance} interruption tolerance`,
      ],
      autonomy: this.listPreferences()
        .filter((x) => x.evidenceCount >= 3)
        .slice(0, 6)
        .map((x) => `${x.capability}: ${x.value ? 'autonomous' : 'asks first'} (${x.confidence.toFixed(2)} confidence, ${x.evidenceCount} observations)`),
      boundaries: Object.entries(p.boundaries)
        .filter(([, v]) => v === true)
        .slice(0, 8)
        .map(([k]) => k.replace(/([A-Z])/g, ' $1').toLowerCase().trim()),
    };
  }
}

export const preferenceEngine = new PreferenceLearningEngine();

/* ═══════════════ USER STATE ENGINE ═══════════════ */

export type UserState =
  | 'IDLE' | 'FOCUSED' | 'WORKING' | 'CODING' | 'READING' | 'WATCHING'
  | 'MEETING' | 'CALLING' | 'PRESENTING' | 'GAMING' | 'TRAVELING'
  | 'AWAY' | 'SLEEPING' | 'DO_NOT_DISTURB' | 'VOICE_CONVERSATION' | 'MISSION_ACTIVE';

export interface ObservableSignals {
  activeApplication?: string;
  windowTitle?: string;
  keyboardActivityPerMin?: number;
  mouseActivityPerMin?: number;
  calendarState?: 'free' | 'busy' | 'meeting' | 'focus-block';
  microphoneActive?: boolean;
  meetingAppDetected?: boolean;
  screenLocked?: boolean;
  userInteractedRecently?: boolean;
  voiceSessionActive?: boolean;
  missionRunning?: boolean;
  hourOfDay?: number;
  explicitSetting?: UserState;
}

export interface UserStateAssessment {
  state: UserState;
  confidence: number;
  signalsUsed: string[];
  interruptible: boolean;
  interruptibility: 'critical-only' | 'important' | 'normal' | 'everything';
}

const CODING_APPS = ['code', 'visual studio', 'intellij', 'webstorm', 'vim', 'neovim', 'terminal', 'powershell', 'iterm', 'cursor'];
const MEETING_APPS = ['zoom', 'teams', 'meet', 'slack huddle', 'discord', 'webex'];
const WATCHING_APPS = ['youtube', 'netflix', 'prime', 'disney', 'vlc', 'spotify'];
const READING_APPS = ['adobe acrobat', 'kindle', 'books', 'notion', 'obsidian'];
const GAMING_APPS = ['steam', 'epic games', 'battle.net', 'game'];

/**
 * User State Engine — infers what the user is doing from OBSERVABLE signals
 * only, and always reports a confidence rather than pretending certainty.
 * Sensitive states are never inferred without an explicit signal.
 */
export class UserStateEngine {
  private current: UserStateAssessment = {
    state: 'IDLE',
    confidence: 0.4,
    signalsUsed: ['default'],
    interruptible: true,
    interruptibility: 'normal',
  };

  assess(signals: ObservableSignals): UserStateAssessment {
    // Explicit setting always wins
    if (signals.explicitSetting) {
      return this.commit(signals.explicitSetting, 1.0, ['explicit user setting'], signals);
    }

    // Screen locked → away or sleeping by time of day
    if (signals.screenLocked) {
      const hour = signals.hourOfDay ?? new Date().getHours();
      const sleeping = hour >= 23 || hour < 7;
      return this.commit(sleeping ? 'SLEEPING' : 'AWAY', 0.9, ['screen locked', sleeping ? 'late hour' : 'time of day'], signals);
    }

    // Active meeting beats everything else
    if (signals.meetingAppDetected || signals.calendarState === 'meeting') {
      return this.commit('MEETING', 0.92, [signals.meetingAppDetected ? 'meeting app foreground' : 'calendar busy'], signals);
    }
    if (signals.calendarState === 'focus-block') {
      return this.commit('FOCUSED', 0.8, ['calendar focus block'], signals);
    }

    // Voice session with Akansha
    if (signals.voiceSessionActive) {
      return this.commit('VOICE_CONVERSATION', 0.95, ['voice session active'], signals);
    }

    // Mission running
    if (signals.missionRunning) {
      return this.commit('MISSION_ACTIVE', 0.85, ['mission running'], signals);
    }

    const app = (signals.activeApplication || '').toLowerCase();
    const title = (signals.windowTitle || '').toLowerCase();
    const kbd = signals.keyboardActivityPerMin ?? 0;
    const mouse = signals.mouseActivityPerMin ?? 0;

    // Application classification
    const appMatch = (list: string[]) => list.some((a) => app.includes(a) || title.includes(a));

    if (appMatch(CODING_APPS)) {
      const activity = clamp((kbd / 120) * 0.5 + 0.5, 0, 1);
      return this.commit('CODING', 0.75 + activity * 0.2, ['coding app foreground', `keyboard ${kbd}/min`], signals);
    }
    if (appMatch(GAMING_APPS)) return this.commit('GAMING', 0.8, ['game foreground'], signals);
    if (appMatch(WATCHING_APPS)) return this.commit('WATCHING', 0.78, ['media app foreground'], signals);
    if (appMatch(READING_APPS)) return this.commit('READING', 0.7, ['reading app foreground'], signals);
    if (appMatch(MEETING_APPS)) return this.commit('CALLING', 0.85, ['communication app foreground'], signals);

    // Activity-level fallback
    const totalActivity = kbd + mouse;

    // Night hours with zero activity → probable sleep (observable: time + inactivity)
    const hr = signals.hourOfDay ?? new Date().getHours();
    if (totalActivity < 5 && (hr >= 23 || hr < 7)) {
      return this.commit('SLEEPING', 0.68, [`no activity at ${hr}:00`], signals);
    }

    if (totalActivity > 200) return this.commit('WORKING', 0.6, [`high activity ${Math.round(totalActivity)}/min`], signals);
    if (totalActivity > 40) return this.commit('FOCUSED', 0.55, [`moderate activity ${Math.round(totalActivity)}/min`], signals);
    if (signals.userInteractedRecently) return this.commit('IDLE', 0.5, ['recent interaction, low activity'], signals);

    return this.commit('AWAY', 0.45, ['no activity detected'], signals);
  }

  private commit(state: UserState, confidence: number, signalsUsed: string[], s: ObservableSignals): UserStateAssessment {
    // DO_NOT_DISTURB and SLEEPING are never interruptible
    const neverInterrupt = state === 'DO_NOT_DISTURB' || state === 'SLEEPING';
    const lowTolerance = ['CODING', 'PRESENTING', 'GAMING', 'FOCUSED', 'MEETING', 'READING'];

    let interruptibility: UserStateAssessment['interruptibility'] = 'normal';
    if (neverInterrupt) interruptibility = 'critical-only';
    else if (lowTolerance.includes(state)) interruptibility = 'important';

    this.current = {
      state,
      confidence: clamp(confidence, 0, 1),
      signalsUsed,
      interruptible: !neverInterrupt,
      interruptibility,
    };
    return this.current;
  }

  getState(): UserStateAssessment {
    return { ...this.current };
  }
}

export const userStateEngine = new UserStateEngine();
