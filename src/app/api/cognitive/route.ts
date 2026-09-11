import { NextResponse } from 'next/server';
import {
  voicePipeline,
  AUDIO_MODE_LABEL,
  AUDIO_MODE_PRIVACY,
  type AudioMode,
  type OwnershipSignals,
} from '@/core/voice/VoicePipeline';
import { userStateEngine, preferenceEngine, type ObservableSignals } from '@/core/user/UserModel';
import {
  ambientContext,
  interruptionManager,
  type CandidateNotification,
} from '@/core/ambient/AmbientContextEngine';
import { memoryFabric } from '@/core/memory/MemoryFabric';
import { experienceReplay, skillVersionControl } from '@/core/learning/ExperienceReplay';
import { explanationEngine } from '@/core/explain/ExplanationEngine';
import { riskEngine, escalationDecision } from '@/core/security/RiskEngine';
import { eventBus } from '@/core/events/EventBus';
import { authorize } from '@/core/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * Cognitive state endpoint — the single view of everything Akansha perceives,
 * decides, remembers and has learned. Powers the Cognitive workspace.
 */
export async function GET(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  try {
    // No live OS signal provider (foreground app, notifications, calendar,
    // downloads, etc.) is wired into this build, so the ambient timeline and
    // user-state are intentionally NOT fabricated here. The engines still run
    // on whatever real events are ingested via POST; with none connected, the
    // dashboard honestly shows an empty/unknown state rather than fake telemetry.
    const signalProviderConnected = false;

    // Assess user state from whatever observable signals actually exist.
    // (Only the real clock is available without an OS signal provider.)
    const userState = userStateEngine.assess({
      hourOfDay: new Date().getHours(),
      userInteractedRecently: false,
      voiceSessionActive: voicePipeline.getState().sessionActive,
      missionRunning: false,
      screenLocked: false,
    } as any);

    const voice = voicePipeline.getState();

    return NextResponse.json({
      ok: true,
      telemetry: {
        liveSignalProvider: signalProviderConnected,
        note: 'Ambient events and user-state reflect only real ingested signals. No OS/browser/calendar signal provider is connected, so these are shown as unknown/empty rather than simulated.',
      },
      voice: {
        mode: voice.mode,
        modeLabel: AUDIO_MODE_LABEL[voice.mode],
        privacy: AUDIO_MODE_PRIVACY[voice.mode],
        vad: voice.vad,
        wake: voice.wake,
        ownership: voice.ownership,
        speech: voice.speech,
        sessionActive: voice.sessionActive,
        audioModes: (Object.keys(AUDIO_MODE_LABEL) as AudioMode[]).map((m) => ({
          mode: m, label: AUDIO_MODE_LABEL[m], privacy: AUDIO_MODE_PRIVACY[m],
        })),
      },
      user: {
        state: userState.state,
        confidence: userState.confidence,
        signalsUsed: userState.signalsUsed,
        interruptibility: userState.interruptibility,
        interruptible: userState.interruptible,
        profile: preferenceEngine.summarise(),
        preferences: preferenceEngine.listPreferences(),
      },
      memory: {
        stats: memoryFabric.stats(),
        selfReport: memoryFabric.selfReport(),
        recent: {
          preference: memoryFabric.byType('preference', 6).map((m) => ({
            content: m.content, confidence: m.confidence, trust: m.provenance.trustLevel,
          })),
          episodic: memoryFabric.byType('episodic', 6).map((m) => ({ content: m.content, confidence: m.confidence })),
          error: memoryFabric.byType('error', 6).map((m) => ({ content: m.content, confidence: m.confidence })),
          procedural: memoryFabric.byType('procedural', 6).map((m) => ({ content: m.content, confidence: m.confidence })),
        },
      },
      learning: {
        stats: experienceReplay.stats(),
        lessons: experienceReplay.getLessons().slice(0, 10).map((l) => ({
          domain: l.domain, outcome: l.outcome, lesson: l.lesson,
          evidenceCount: l.evidenceCount, confidence: l.confidence, recommendedChange: l.recommendedChange,
        })),
        skillVersions: skillVersionControl.stats(),
      },
      ambient: {
        timeline: ambientContext.getTimeline(20).map((e) => ({
          type: e.type, title: e.title, detail: e.detail, urgency: e.urgency,
          importance: e.importance, trustLevel: e.trustLevel, quarantined: e.relevance === 0 && e.importance === 0,
          at: e.timestamp,
        })),
        stats: ambientContext.stats(),
        anomalies: ambientContext.detectAnomalies(),
        whatIsHappening: ambientContext.describe(8),
      },
      interruption: interruptionManager.getHistory(),
      explanation: {
        whatAreYouDoing: explanationEngine.whatAreYouDoing(),
        whatDidYouLearn: explanationEngine.whatDidYouLearn(),
        recentTraces: explanationEngine.recentTraces(8).map((t) => ({
          traceId: t.traceId, intent: t.intent, trigger: t.trigger,
          selectedTool: t.selectedTool, outcome: t.outcome,
          riskScore: t.riskAssessment.score,
        })),
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Unknown error' }, { status: 500 });
  }
}

/**
 * POST actions: mute/unmute the mic, resolve an utterance through the
 * ownership gate, run an interruption decision, or store a memory.
 */
export async function POST(request: Request) {
  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;
  try {
    const body = await request.json();
    const action = body?.action;

    switch (action) {
      /* ── Microphone kill switch ── */
      case 'set_muted': {
        voicePipeline.setMuted(!!body.muted);
        return NextResponse.json({ ok: true, voice: voicePipeline.getState() });
      }

      /* ── Resolve an utterance through the ownership gate ── */
      case 'resolve_utterance': {
        const transcript: string = body.transcript || '';
        const isFinal: boolean = body.isFinal !== false; // default: final
        const signals: Omit<OwnershipSignals, 'partialTranscript'> = body.signals || {};

        const result = voicePipeline.resolveUtterance(transcript, isFinal, signals);

        return NextResponse.json({
          ok: true,
          transcript,
          isFinal,
          wake: result.wake,
          ownership: result.ownership,
          execute: result.execute,
          mode: voicePipeline.getState().mode,
          modeLabel: AUDIO_MODE_LABEL[voicePipeline.getState().mode],
          privacy: AUDIO_MODE_PRIVACY[voicePipeline.getState().mode],
        });
      }

      /* ── Should I speak? ── */
      case 'should_speak': {
        const n: CandidateNotification = body.notification;
        if (!n?.title) {
          return NextResponse.json({ ok: false, error: 'notification.title required' }, { status: 400 });
        }

        const userState = userStateEngine.assess(body.signals || {
          activeApplication: 'Visual Studio Code',
          keyboardActivityPerMin: 140,
          hourOfDay: new Date().getHours(),
        });

        const result = interruptionManager.shouldSpeak({
          notification: { ...n, id: n.id || `notif-${Date.now()}` },
          userState,
          history: interruptionManager.getHistory(),
          currentConversationActive: voicePipeline.getState().sessionActive,
          hourOfDay: new Date().getHours(),
          dndLevel: body.dndLevel,
        });

        return NextResponse.json({ ok: true, result, userState });
      }

      /* ── Record user reaction to an interruption ── */
      case 'record_reaction': {
        interruptionManager.recordReaction(!!body.accepted);
        return NextResponse.json({ ok: true, history: interruptionManager.getHistory() });
      }

      /* ── Store a memory (poisoning-defended) ── */
      case 'store_memory': {
        const result = memoryFabric.store({
          type: body.type || 'episodic',
          content: body.content || '',
          importance: body.importance ?? 0.6,
          confidence: body.confidence ?? 0.7,
          sensitivity: body.sensitivity || 'normal',
          sourceType: body.sourceType || 'user_statement',
          userAuthored: body.userAuthored !== false,
          scope: body.scope,
          tags: body.tags,
        });
        return NextResponse.json({ ok: true, result });
      }

      /* ── Retrieve memories (hybrid) ── */
      case 'retrieve_memory': {
        const results = memoryFabric.retrieve({
          text: body.query || '',
          types: body.types,
          limit: body.limit || 6,
        });
        return NextResponse.json({
          ok: true,
          results: results.map((r) => ({
            memoryId: r.memory.memoryId,
            type: r.memory.type,
            content: r.memory.content,
            confidence: r.memory.confidence,
            trust: r.memory.provenance.trustLevel,
            phrasing: r.hedging.text,
            score: r.score,
            contributions: r.contributions,
          })),
        });
      }

      /* ── Record a user correction (highest-value training signal) ── */
      case 'record_correction': {
        const lesson = experienceReplay.recordCorrection({
          originalRequest: body.originalRequest || '',
          previousIntent: body.previousIntent || 'unknown',
          correctIntent: body.correctIntent || 'unknown',
          errorType: body.errorType || 'misclassification',
          userNote: body.userNote,
        });
        return NextResponse.json({ ok: true, lesson });
      }

      /* ── Record an experience ── */
      case 'record_experience': {
        const exp = experienceReplay.record({
          task: body.task || '',
          intent: body.intent || 'unknown',
          context: body.context || {},
          plan: body.plan || [],
          tools: body.tools || [],
          model: body.model,
          actions: body.actions || [],
          observations: body.observations || [],
          result: body.result || 'success',
          verification: body.verification || { performed: false, passed: false },
          failure: body.failure,
          correction: body.correction,
          userFeedback: body.userFeedback,
          durationMs: body.durationMs || 0,
        });
        return NextResponse.json({ ok: true, experience: { experienceId: exp.experienceId, result: exp.result } });
      }

      /* ── Explain a decision ── */
      case 'why': {
        const explanation = explanationEngine.why(body.traceId || '');
        return NextResponse.json({ ok: true, explanation });
      }

      /* ── Assess risk for an action ── */
      case 'assess_risk': {
        const assessment = riskEngine.assess(body.description || '', body.factors || {});
        const pref = preferenceEngine.shouldConfirm(
          body.capability || 'generic',
          assessment.tier === 'critical' ? 'high' : assessment.tier
        );
        const escalation = escalationDecision({
          confidence: body.confidence ?? 0.8,
          risk: assessment,
          userPreference: { autonomous: !pref.confirm, confidence: pref.confidence },
        });
        return NextResponse.json({ ok: true, assessment, escalation, preference: pref });
      }

      /* ── Empirical model recommendation ── */
      case 'recommend_model': {
        const candidates: string[] = body.candidates || [];
        const rec = experienceReplay.recommendModel(body.intent || 'reasoning', candidates);
        return NextResponse.json({ ok: true, recommendation: rec });
      }

      default:
        return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Unknown error' }, { status: 500 });
  }
}
