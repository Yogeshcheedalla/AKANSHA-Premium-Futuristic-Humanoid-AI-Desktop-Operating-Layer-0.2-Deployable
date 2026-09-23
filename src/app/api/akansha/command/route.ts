import { NextResponse } from 'next/server';
import { integrationManager } from '@/integrations/IntegrationManager';
import { intentEngine } from '@/core/intent/IntentEngine';
import { skillRegistry } from '@/core/skills/SkillRegistry';
import { masterOrchestrator } from '@/core/orchestration/MasterOrchestrator';
import { learningEngine } from '@/core/learning/LearningEngine';
import { modelRouter } from '@/core/models/ModelRouter';
import { mapToAiModePhrase, parseModelFlowCommand } from '@/core/models/AiModeCommands';
import { applyAiMode } from '@/core/models/AiModeApply';
import { recommendModels } from '@/core/catalog/recommend';
import { executionLedger } from '@/core/runtime/ExecutionLedger';
import { resourceGovernor } from '@/core/resources/ResourceGovernor';
import { memoryIntelligence } from '@/core/memory/MemoryIntelligence';
import { db } from '@/db';
import { decisionTraces } from '@/db/schema';
import { eventBus } from '@/core/events/EventBus';
import { authorize } from '@/core/auth/guard';

export const dynamic = 'force-dynamic';

/**
 * THE single request pipeline. No other path turns user input into execution.
 *
 * INPUT → DUPLICATE GATE → INTENT → TIER → RESOURCE BUDGET →
 * (Tier 0/1: deterministic, no model) |
 * (Tier 2+: MODEL ROUTING + FALLBACK → MISSION) →
 * MEMORY SCORING → TRACE → RESPONSE
 */

/** Tier 0: deterministic answers — never spend a model call. */
function deterministicAnswer(text: string): string | null {
  const t = text.toLowerCase().trim();

  // Handles "what time is it", "what's the time in India", "current time in X"
  const timeMatch =
    t.match(/what(?:'s| is) the time(?: in (.+?))?\??$/) ||
    t.match(/what time is it(?: in (.+?))?\??$/) ||
    t.match(/(?:current|local) time(?: in (.+?))?\??$/);
  if (timeMatch) {
    const region = (timeMatch[1] || '').replace(/\?+$/, '').trim() || undefined;
    try {
      const now = new Date();
      const formatted = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: region ? region.replace(/\s+/g, '_') : undefined,
      }).format(now);
      return `It's ${formatted}${region ? ` in ${region}` : ''}, Boss.`;
    } catch {
      return `It's ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}, Boss.`;
    }
  }

  const calcMatch = t.match(/what(?:'s| is)\s+([\d\s+\-*/().^%]+)\??$/);
  if (calcMatch) {
    try {
      const expr = calcMatch[1].replace(/\^/g, '**');
      // eslint-disable-next-line no-new-func
      const value = Function(`"use strict";return (${expr})`)();
      if (typeof value === 'number' && Number.isFinite(value)) {
        return `That's ${Number(value.toFixed(6))}, Boss.`;
      }
    } catch {
      /* fall through */
    }
  }

  if (/\b(date|day) (is it|today)\b/.test(t)) {
    return `Today is ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, Boss.`;
  }

  return null;
}

/** Map intent to an intelligence tier — minimum sufficient compute. */
function tierFor(intent: string): 'tier0' | 'tier1' | 'tier2' | 'tier3' | 'tier4' {
  switch (intent) {
    case 'conversation':
    case 'question':
      return 'tier1';
    case 'information_request':
      return 'tier2';
    case 'command':
      return 'tier3';
    case 'research':
      return 'tier3';
    case 'coding':
      return 'tier4';
    case 'mission':
    case 'automation':
      return 'tier4';
    default:
      return 'tier2';
  }
}

export async function POST(request: Request) {
  const started = Date.now();

  const guard = authorize(request, 'authenticated');
  if (!guard.ok) return guard.response;

  try {
    await integrationManager.initialize();
    // Authoritative bootstrap: loads providers, discovers models, probes health
    // ONCE (cached afterwards). Every route below sees live evidence.
    { const { providerBootstrap } = await import('@/core/providers/providerBootstrap'); await providerBootstrap.run(); }
    // Resume any durable tasks that were RUNNING/WAITING before a restart (once).
    { const { taskManager } = await import('@/core/tasks/TaskManager'); taskManager.reconcile(); }

    const body = await request.json();
    const text: string = (body?.text || body?.message || '').toString().trim();
    const requestId: string =
      body?.requestId || `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    if (!text) {
      return NextResponse.json({ ok: false, error: 'Empty input' }, { status: 400 });
    }

    // ── DUPLICATE GATE (idempotent by requestId) ──────────────────────
    const result = await executionLedger.run(requestId, async () => {
      eventBus.emit('request.received', 'Pipeline', { requestId, text }, { requestId });

      // ── INTENT ──────────────────────────────────────────────────────
      const intent = intentEngine.detect(text);
      const tier = tierFor(intent.intent);
      const budget = resourceGovernor.budgetFor(tier);
      resourceGovernor.begin(requestId, budget);

      // Every branch below MUST release the resource budget exactly once.
      try {
        // ── RESUME: a parked WAITING_FOR_USER mission consumes this turn as its
        //    answer and resumes from the blocked step (completed work is NOT re-run).
        {
          const { taskManager } = await import('@/core/tasks/TaskManager');
          const waiting = taskManager.list().find((t) => t.status === 'WAITING_FOR_USER');
          const step = waiting ? waiting.steps[waiting.currentStep] : undefined;
          if (waiting && step && step.kind === 'clarify') {
            const resumed = taskManager.answer(waiting.taskId, step.field, text);
            return {
              ok: true, requestId, intent: 'clarification_response', tier: 'tier0', path: 'mission-resume',
              usedModel: false, status: resumed?.status || 'RUNNING',
              response: `Got it — using "${text}". Resuming "${waiting.goal}" from the blocked step.`,
              task: { taskId: waiting.taskId, status: resumed?.status },
              trace: { kind: 'deterministic', candidates: [], selected: null, reasons: ['Answered a WAITING_FOR_USER mission; resumed without re-running completed steps.'] },
              latencyMs: Date.now() - started,
            };
          }
        }

        // ── TIER 0: deterministic — zero model calls ──────────────────
        const deterministic = deterministicAnswer(text);
        if (deterministic) {
          return {
            ok: true,
            requestId,
            intent: intent.intent,
            tier: 'tier0',
            path: 'deterministic',
            usedModel: false,
            status: 'COMPLETED',
            response: deterministic,
            trace: {
              kind: 'deterministic',
              candidates: [{ providerId: 'local-skill', modelId: 'deterministic', score: 100, reasons: ['no-model-required'] }],
              selected: { providerId: 'local-skill', modelId: 'deterministic' },
              reasons: ['Resolved locally without a model call — zero latency, zero tokens.'],
            },
            latencyMs: Date.now() - started,
          };
        }

        // ── TIER 0b: AI-mode switch phrasings → real ModelRouter policy change.
        //    Same code path as the Settings UI toggle (applyAiMode) — voice and UI
        //    can never drift. Honest even when the requested mode can't be met.
        const modePhrase = mapToAiModePhrase(text);
        if (modePhrase) {
          const applied = applyAiMode(modePhrase.mode);
          const label = modePhrase.mode === 'offline' ? 'Offline (local-first)' : modePhrase.mode === 'cloud' ? 'Online (cloud providers)' : modePhrase.mode === 'both' ? 'Both (local + cloud)' : 'Auto (balanced)';
          const reply = applied.requestedMode === 'offline' && !applied.offlineReady
            ? `No verified local model is installed yet, Boss, so offline AI isn't ready — and I won't use the cloud and call it offline. Want me to show the models that fit this device? Say "show recommended models", or just "install recommended model" and I'll set up the best one for you.`
            : `${label} mode enabled${applied.reason ? ` — ${applied.reason}` : '.'} Routing updated live, Boss.`;
          return {
            ok: true,
            requestId,
            intent: intent.intent,
            tier: 'tier0',
            path: 'ai-mode',
            usedModel: false,
            status: 'COMPLETED',
            response: reply,
            mode: applied,
            trace: {
              kind: 'deterministic',
              candidates: [{ providerId: 'model-router', modelId: 'policy', score: 100, reasons: ['ai-mode-phrase'] }],
              selected: { providerId: 'model-router', modelId: 'policy' },
              reasons: ['Applied through the existing ModelRouter policy — the same authority the Settings toggle uses.'],
            },
            latencyMs: Date.now() - started,
          };
        }

        // ── TIER 0c: guided offline model flow (real recommendations + real install).
        const modelFlow = parseModelFlowCommand(text);
        if (modelFlow === 'show-recommendations') {
          const recs = recommendModels(process.env, 5);
          const body = recs.length
            ? recs.map((r, i) => `${i + 1}. ${r.name}${r.sizeGB ? ` (~${r.sizeGB} GB)` : ''} — ${r.rating.toLowerCase()}`).join('\n')
            : 'No runnable model matched this device from the signed catalog right now.';
          return {
            ok: true, requestId, intent: intent.intent, tier: 'tier0', path: 'model-recommend',
            usedModel: false, status: 'COMPLETED',
            response: recs.length
              ? `Here are the models that fit this device, Boss:\n${body}\n\nSay "install recommended model" and I'll set up the best one (${recs[0].name}).`
              : body,
            recommendations: recs,
            action: recs.length ? { navigate: 'modelcenter' } : undefined,
            trace: { kind: 'deterministic', candidates: [], selected: null, reasons: ['CompatibilityEngine device-fit recommendations.'] },
            latencyMs: Date.now() - started,
          };
        }
        if (modelFlow === 'install-recommended') {
          const recs = recommendModels(process.env, 1);
          if (!recs.length) {
            return {
              ok: true, requestId, intent: intent.intent, tier: 'tier0', path: 'model-install',
              usedModel: false, status: 'COMPLETED',
              response: 'No runnable model matched this device from the signed catalog, Boss — I won\'t install something I can\'t verify. Open Models to search manually.',
              trace: { kind: 'deterministic', candidates: [], selected: null, reasons: ['no device-fit model.'] },
              latencyMs: Date.now() - started,
            };
          }
          // The CLIENT performs the real install via /api/ai/install/execute (the
          // existing gated pipeline). We never claim it succeeded here.
          return {
            ok: true, requestId, intent: intent.intent, tier: 'tier0', path: 'model-install',
            usedModel: false, status: 'COMPLETED',
            response: `Okay Boss — installing ${recs[0].name}${recs[0].sizeGB ? ` (~${recs[0].sizeGB} GB)` : ''}. I'll download it, verify its integrity, and run a real inference test before I call it ready. Watch Models for progress.`,
            action: { install: recs[0].modelId, navigate: 'modelcenter' },
            trace: { kind: 'deterministic', candidates: [], selected: null, reasons: ['install delegated to the real gated pipeline.'] },
            latencyMs: Date.now() - started,
          };
        }

        // ── TIER 0e: PHASE 1 semantic understanding — honest capability limits.
        //    If the goal needs an INTERACTIVE organ not wired in this build (page
        //    control, repository analysis, vision, computer-use), report it truthfully
        //    instead of pretending or shredding it into a fake multi-step task.
        {
          const { analyzeGoal, honestCapabilityNote } = await import('@/core/understanding/semanticUnderstanding');
          const plan = analyzeGoal(text);
          const HARD_UNWIRED = ['pageUnderstanding', 'repoInspection', 'vision', 'computerUse'];
          const blockedOrgans = plan.blocked.filter((b) => HARD_UNWIRED.includes(b));
          const actionableIntent = intent.intent === 'command' || intent.intent === 'automation' || intent.intent === 'research';
          if (blockedOrgans.length && actionableIntent) {
            const canDo = plan.executable.length ? ` What I can do right now: ${plan.executable.join(', ')}.` : '';
            return {
              ok: true, requestId, intent: intent.intent, tier: 'tier0', path: 'capability-limited',
              usedModel: false, status: 'CAPABILITY_UNAVAILABLE',
              response: `${honestCapabilityNote(plan) || 'This needs capabilities Akansha has not wired yet.'} The parts I can't do yet: ${blockedOrgans.join(', ')} — browser page-control, repository analysis and vision/computer-use are on the roadmap (PHASE 3). I will not pretend I did them.${canDo}`,
              semantic: plan,
              trace: { kind: 'deterministic', candidates: [], selected: null, reasons: ['PHASE 1: goal needs unwired interactive organs → honest CAPABILITY_UNAVAILABLE.'] },
              latencyMs: Date.now() - started,
            };
          }
        }

        // ── TIER 0d: durable BACKGROUND TASK (multi-step / timed). The chat
        //    response finishing must NOT end the task — the executor keeps it
        //    alive and it survives restart. Only explicit cancel ends it.
        {
          const { planGoal, toTaskSteps } = await import('@/core/tasks/goalPlanner');
          const { taskManager } = await import('@/core/tasks/TaskManager');
          const subtasks = await planGoal(text);
          const actionable = subtasks.filter((s) => s.actionId || s.clarify || s.label.startsWith('wait '));
          if (actionable.length >= 2) {
            const steps = toTaskSteps(subtasks);
            const t = taskManager.create(text, steps, 'local');
            taskManager.start(t.taskId);
            return {
              ok: true, requestId, intent: intent.intent, tier: 'tier0', path: 'background-task',
              usedModel: false, status: 'RUNNING',
              response: `Working on it, Boss — ${subtasks.length} steps (${subtasks.map((s) => s.label).join(', ')}). I'll ask only if I need a decision from you, and tell you when it's done, blocked, or failed.`,
              task: { taskId: t.taskId, steps: subtasks.map((s) => s.label) },
              trace: { kind: 'deterministic', candidates: [], selected: null, reasons: ['Durable mission via goal planner (DAG + clarify) → TaskManager.'] },
              latencyMs: Date.now() - started,
            };
          }
        }

        // ── TIER 1: conversation — genuine model reply when a provider exists,
        //    fast and tool-free (no agents/MCP/execution). Canned fallback otherwise.
        if (intent.intent === 'conversation') {
          let reply = 'Hello, Boss. Akansha is online and listening.';
          let usedModel = false;
          let sel: { providerId: string; modelId: string } | null = null;

          // Policy-aware selection: honor explicit "free only" / "offline" / "private"
          // requests via the Model Selection Engine. Guarded — any miss falls through to
          // the existing (verified) free-first path unchanged.
          try {
            const { selectForTurn } = await import('@/core/routing/modelSelection');
            const { providerBootstrap } = await import('@/core/providers/providerBootstrap');
            const { providerManager } = await import('@/core/providers/ProviderManager');
            const decision = selectForTurn(text, providerBootstrap.get()?.routes || []);
            if (decision) {
              const prov = providerManager.get(decision.providerId);
              const resp: any = prov && await prov.generate({
                model: decision.modelId,
                messages: [
                  { role: 'system', content: 'You are Akansha, a warm, concise personal assistant. Reply in one or two friendly sentences. Address the user as "Boss". Never claim to have performed actions.' },
                  { role: 'user', content: text },
                ],
                maxTokens: 120, temperature: 0.6,
              } as any);
              if (resp?.content && String(resp.content).trim()) {
                sel = { providerId: decision.providerId, modelId: decision.modelId };
                return {
                  ok: true, requestId, intent: intent.intent, tier, path: 'conversation', usedModel: true, status: 'COMPLETED',
                  response: String(resp.content).trim(),
                  trace: { kind: 'conversation', candidates: [sel ? { ...sel, score: 100, reasons: [decision.reason] } : []], selected: sel, reasons: [`Policy-aware selection: ${decision.reason}`] },
                  latencyMs: Date.now() - started,
                };
              }
            }
          } catch { /* fall through to default free-first path */ }

          try {
            const gen = await modelRouter.generateWithFallback(
              {
                messages: [
                  {
                    role: 'system',
                    content:
                      'You are Akansha, a warm, concise personal assistant. Reply to short greetings/questions in one or two friendly sentences. Address the user as "Boss". Never claim to have performed actions.',
                  },
                  { role: 'user', content: text },
                ],
                maxTokens: 120,
                temperature: 0.6,
              },
              'conversation'
            );
            if (gen.response.content && gen.response.content.trim()) {
              reply = gen.response.content.trim();
              usedModel = true;
              sel = { providerId: gen.response.provider, modelId: gen.response.model };
            }
          } catch {
            // Honest: the SYSTEM is running but no AI inference route answered.
            reply = 'Akansha is running, but no verified AI inference route is available right now. Open AI Center → Enable Free AI (one free provider key makes conversation work), or install a local model from Models. I will not pretend a model answered when none did.';
            usedModel = false;
          }
          return {
            ok: true,
            requestId,
            intent: intent.intent,
            tier,
            path: 'conversation',
            usedModel,
            status: 'COMPLETED',
            response: reply,
            trace: {
              kind: 'conversation',
              candidates: sel ? [{ providerId: sel.providerId, modelId: sel.modelId, score: 100, reasons: ['fast-chat'] }] : [],
              selected: sel,
              reasons: usedModel
                ? ['Conversation answered by the model — no Windows action, no agent, no tool execution.']
                : ['No provider reachable — returned an honest static greeting.'],
            },
            latencyMs: Date.now() - started,
          };
        }

        // ── MODEL ROUTING (auditable candidate trace) ─────────────────
        const decision = await modelRouter.routeTask(intent.intent, [
          ...(intent.intent === 'coding' ? ['coding'] : []),
          ...(intent.intent === 'research' ? ['reasoning'] : []),
        ]);

        const trace = {
          kind: 'model' as const,
          candidates: (decision?.candidates || []).slice(0, 10).map((c) => ({
            providerId: c.providerId,
            modelId: c.modelId,
            score: c.score,
            reasons: c.reasons,
            costTier: c.costTier,
          })),
          selected: decision ? { providerId: decision.provider, modelId: decision.modelId } : null,
          reasons: decision
            ? [`Intent "${intent.intent}" → ${tier}`, decision.reason]
            : ['No configured provider returned a usable model.'],
        };

        // ── MEMORY CONTEXT (retrieve only — informs the model) ────────
        const relevant = await memoryIntelligence.retrieve(text, 4);
        const memoryContext = relevant.length
          ? relevant.map((m) => `- (${m.type}) ${m.content}`).join('\n').slice(0, 1200)
          : '';

        // ── CAPABILITY ROUTING ────────────────────────────────────────
        const skillCandidates = skillRegistry.rankForGoal(text);
        const topSkill = skillCandidates.find((c) => c.score >= 15) || null;

        // ── EXECUTION (orchestrator does real generation/risk/verify) ─
        const mission = await masterOrchestrator.createMission(text, {
          intent: intent.intent,
          requestId,
          memoryContext,
        });
        const missionResult = await masterOrchestrator.runMission(mission.id);

        const usedModel = !!missionResult.context?.model;
        const succeeded = missionResult.status === 'COMPLETED';
        const reply: string =
          missionResult.context?.reply ||
          (succeeded
            ? 'Done.'
            : 'I could not complete that, and I am not going to pretend otherwise.');

        // ── LEARNING (honest outcome only) ────────────────────────────
        if (topSkill) {
          learningEngine.recordCapabilityOutcome(
            topSkill.skill.id,
            succeeded ? 'success' : 'failure',
            Date.now() - started,
            `routed via ${topSkill.skill.provider}`
          );
        }

        // ── MEMORY WRITE (store the exchange, scored) ─────────────────
        const memType = intent.intent === 'research' || intent.intent === 'coding' ? 'procedural' : 'episodic';
        const factors = memoryIntelligence.deriveFactors(text, {
          type: memType,
          relevant: true,
          recurring: false,
        });
        const scored = memoryIntelligence.score(factors, text);
        let memoryStored = false;
        if (scored.decision === 'store') {
          memoryStored = await memoryIntelligence.persist({
            memoryId: `mem-${Date.now().toString(36)}`,
            type: memType,
            content: `${text}\n→ ${reply}`.slice(0, 4000),
            importance: factors.importance,
            confidence: succeeded ? 0.8 : 0.4,
            score: scored.score,
            decision: scored.decision,
            reasons: scored.reasons,
            createdAt: Date.now(),
            accessCount: 0,
            metadata: { intent: intent.intent, status: missionResult.status },
          });
        }
        if (memoryStored) {
          eventBus.emit('memory.updated', 'MemoryIntelligence', { requestId, decision: scored.decision, score: scored.score });
        }

        // ── DECISION TRACE (persisted, best-effort) ───────────────────
        try {
          await db.insert(decisionTraces).values({
            traceId: `trace-${requestId}`,
            requestId,
            missionId: mission.id,
            kind: 'model',
            candidates: trace.candidates,
            selected: trace.selected || {},
            reasons: trace.reasons,
          });
        } catch {
          /* trace persistence is best-effort */
        }

        const usage = resourceGovernor.usageFor(requestId);

        return {
          ok: true,
          requestId,
          intent: intent.intent,
          tier,
          path: usedModel ? 'generated' : 'orchestrated',
          usedModel,
          missionId: mission.id,
          status: missionResult.status,
          failureClass: missionResult.context?.failureClass || null,
          evidence: missionResult.context?.evidence || null,
          sources: missionResult.context?.sources || null,
          model: missionResult.context?.model || (decision ? { provider: decision.provider, modelId: decision.modelId } : null),
          matchedSkill: topSkill ? { id: topSkill.skill.id, name: topSkill.skill.name, score: topSkill.score } : null,
          memory: { decision: scored.decision, score: scored.score, stored: memoryStored, retrieved: relevant.length, reasons: scored.reasons },
          resources: { tier, tokenBudget: usage.budget.tokenBudget, maxAgents: usage.budget.maxConcurrentAgents },
          response: reply,
          trace,
          latencyMs: Date.now() - started,
        };
      } finally {
        // Release the resource budget on EVERY path (fixes the early-return leak).
        resourceGovernor.finish(requestId);
      }
    });

    await executionLedger.persist({
      requestId,
      intent: (result as any)?.intent || '',
      status: (result as any)?.status || (result as any)?.path || 'OK',
      response: { response: (result as any)?.response },
      latencyMs: Date.now() - started,
    });

    return NextResponse.json({ ...(result as object), latencyMs: Date.now() - started });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Unknown error' }, { status: 500 });
  }
}
