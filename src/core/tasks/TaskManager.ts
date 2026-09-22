/**
 * TaskManager — durable background tasks, DISTINCT from chat turns.
 *
 * The bug this removes: a task being torn down when the chat response finishes.
 * Here, submitting a task returns immediately ("continuing in background") and
 * the executor keeps running it inside the (persistent desktop) backend,
 * independent of the request. State is persisted to a durable JobStore, so a
 * running/waiting task is reconciled on restart. Only explicit cancel — or a
 * verified terminal state — ends a task.
 *
 * It is NOT a second orchestrator: each action step is executed through the
 * EXISTING ActionDispatcher (real execute → observe → verify). Terminal states:
 * COMPLETED / FAILED / CANCELLED. WAITING means Akansha still owns the task.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { actionDispatcher } from '../actions/ActionDispatcher';
import { eventBus } from '../events/EventBus';

export type TaskStatus = 'CREATED' | 'PLANNING' | 'RUNNING' | 'WAITING' | 'WAITING_FOR_USER' | 'RETRYING' | 'BLOCKED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export const TERMINAL: TaskStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

export type TaskStep =
  | { kind: 'action'; label: string; actionId: string; payload: Record<string, unknown> }
  | { kind: 'wait'; label: string; ms: number }
  | { kind: 'clarify'; label: string; field: string; question: string; options?: string[] };

export interface TaskRecord {
  taskId: string;
  goal: string;
  ownerId: string;
  status: TaskStatus;
  steps: TaskStep[];
  currentStep: number;
  retryCount: number;
  checkpoint: string | null;
  lastEvidence: string | null;
  failure: string | null;
  cancelRequested: boolean;
  answers: Record<string, string>;
  pendingQuestion: string | null;
  createdAt: number;
  updatedAt: number;
  deadlineAt: number;
}

const MAX_STEPS = 24;
const DEFAULT_DEADLINE_MS = 30 * 60_000; // 30 min overall ceiling — never runs forever

class JobStore {
  private path(): string {
    return process.env.AKANSHA_HOME ? join(process.env.AKANSHA_HOME, 'data', 'tasks.json') : join(process.cwd(), 'data', 'akansha', 'data', 'tasks.json');
  }
  read(): TaskRecord[] {
    try { const j = JSON.parse(readFileSync(this.path(), 'utf8')); return Array.isArray(j.tasks) ? j.tasks : []; } catch { return []; }
  }
  write(tasks: TaskRecord[]): void {
    try { mkdirSync(dirname(this.path()), { recursive: true }); writeFileSync(this.path(), JSON.stringify({ updated: Date.now(), tasks }, null, 2), 'utf8'); } catch { /* best effort */ }
  }
}

class TaskManager {
  private store = new JobStore();
  private tasks = new Map<string, TaskRecord>();
  private running = new Set<string>();
  private reconciled = false;

  private loadAll(): TaskRecord[] {
    if (this.tasks.size === 0) for (const t of this.store.read()) this.tasks.set(t.taskId, t);
    return Array.from(this.tasks.values());
  }

  private persist(t: TaskRecord): void {
    this.tasks.set(t.taskId, t);
    this.store.write(Array.from(this.tasks.values()).slice(-200)); // bounded history
  }

  /** Reconcile persisted non-terminal tasks after a restart (run once). */
  reconcile(): { resumed: string[] } {
    if (this.reconciled) return { resumed: [] };
    this.reconciled = true;
    const resumed: string[] = [];
    for (const t of this.loadAll()) {
      if (TERMINAL.includes(t.status)) continue; // never resurrect a terminal task
      if (t.status === 'WAITING_FOR_USER') continue; // parked on purpose, awaiting the user's answer
      if (Date.now() > t.deadlineAt) { t.status = 'FAILED'; t.failure = 'deadline exceeded across restart'; this.persist(t); continue; }
      // RUNNING/WAITING/RETRYING/CREATED/PLANNING → resume from currentStep.
      t.status = 'RUNNING'; t.updatedAt = Date.now(); this.persist(t);
      resumed.push(t.taskId);
      void this.run(t.taskId);
    }
    return { resumed };
  }

  create(goal: string, steps: TaskStep[], ownerId = 'local'): TaskRecord {
    const now = Date.now();
    const t: TaskRecord = {
      taskId: `task-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      goal, ownerId, status: 'CREATED',
      steps: steps.slice(0, MAX_STEPS), currentStep: 0, retryCount: 0,
      checkpoint: null, lastEvidence: null, failure: null, cancelRequested: false,
      answers: {}, pendingQuestion: null,
      createdAt: now, updatedAt: now, deadlineAt: now + DEFAULT_DEADLINE_MS,
    };
    this.persist(t);
    return t;
  }

  start(taskId: string): void { void this.run(taskId); }

  cancel(taskId: string): TaskRecord | null {
    const t = this.tasks.get(taskId) || this.loadAll().find((x) => x.taskId === taskId);
    if (!t || TERMINAL.includes(t.status)) return t || null;
    t.cancelRequested = true; t.updatedAt = Date.now(); this.persist(t);
    return t;
  }

  /** Supply the answer to a parked WAITING_FOR_USER mission and RESUME it. */
  answer(taskId: string, field: string, value: string): TaskRecord | null {
    const t = this.tasks.get(taskId) || this.loadAll().find((x) => x.taskId === taskId);
    if (!t) return null;
    t.answers = { ...t.answers, [field]: value };
    t.pendingQuestion = null;
    t.updatedAt = Date.now();
    this.persist(t);
    if (t.status === 'WAITING_FOR_USER') {
      t.status = 'RUNNING'; this.persist(t);
      eventBus.emit('task.resumed', 'TaskManager', { taskId, field, value });
      void this.run(taskId);
    }
    return t;
  }

  get(taskId: string): TaskRecord | null { return this.tasks.get(taskId) || this.loadAll().find((x) => x.taskId === taskId) || null; }
  list(): TaskRecord[] { return this.loadAll().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50); }

  private sleep(ms: number, taskId: string): Promise<'done' | 'cancelled' | 'timeout'> {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const cur = this.tasks.get(taskId);
        if (!cur || cur.cancelRequested) return resolve('cancelled');
        if (Date.now() > cur.deadlineAt) return resolve('timeout');
        if (Date.now() - started >= ms) return resolve('done');
        setTimeout(tick, Math.min(250, ms));
      };
      tick();
    });
  }

  private async run(taskId: string): Promise<void> {
    if (this.running.has(taskId)) return;
    this.running.add(taskId);
    try {
      const t = this.tasks.get(taskId);
      if (!t) return;
      t.status = 'RUNNING'; t.updatedAt = Date.now(); this.persist(t);
      eventBus.emit('task.started', 'TaskManager', { taskId, goal: t.goal });

      for (let i = t.currentStep; i < t.steps.length; i++) {
        const cur = this.tasks.get(taskId)!;
        if (cur.cancelRequested) { cur.status = 'CANCELLED'; cur.updatedAt = Date.now(); this.persist(cur); eventBus.emit('task.cancelled', 'TaskManager', { taskId }); return; }
        if (Date.now() > cur.deadlineAt) { cur.status = 'FAILED'; cur.failure = 'task deadline exceeded'; cur.updatedAt = Date.now(); this.persist(cur); eventBus.emit('task.failed', 'TaskManager', { taskId, reason: 'deadline' }); return; }
        cur.currentStep = i; cur.status = 'RUNNING'; this.persist(cur);
        const step = t.steps[i];

        if (step.kind === 'wait') {
          cur.status = 'WAITING'; cur.checkpoint = step.label; this.persist(cur);
          eventBus.emit('task.waiting', 'TaskManager', { taskId, step: step.label });
          const r = await this.sleep(step.ms, taskId);
          if (r === 'cancelled') { const c = this.tasks.get(taskId)!; c.status = 'CANCELLED'; c.updatedAt = Date.now(); this.persist(c); return; }
          if (r === 'timeout') { const c = this.tasks.get(taskId)!; c.status = 'FAILED'; c.failure = 'deadline exceeded during wait'; c.updatedAt = Date.now(); this.persist(c); return; }
          continue;
        }

        if (step.kind === 'clarify') {
          if (cur.answers[step.field] === undefined) {
            cur.status = 'WAITING_FOR_USER'; cur.pendingQuestion = step.question; cur.checkpoint = step.label;
            cur.updatedAt = Date.now(); this.persist(cur);
            eventBus.emit('task.awaiting_user', 'TaskManager', { taskId, field: step.field, question: step.question, options: step.options });
            return; // park on THIS step; answer() resumes from here (completed steps are not re-run)
          }
          cur.pendingQuestion = null; this.persist(cur);
          continue;
        }

        // action step → the EXISTING fabric (execute→observe→verify). Real evidence required.
        const res = await actionDispatcher.dispatch({
          actionId: step.actionId, requestId: `${taskId}:step:${i}`, missionId: taskId,
          userId: t.ownerId, confirmed: true, payload: step.payload,
        });
        const c = this.tasks.get(taskId)!;
        if (res.status === 'COMPLETED') {
          c.lastEvidence = res.evidence?.summary || 'verified';
          this.persist(c);
          continue;
        }
        // Not verified → retry once, then fail honestly (never advance on a lie).
        c.retryCount += 1;
        if (c.retryCount <= 1 && res.status !== 'AUTH_REQUIRED') {
          c.status = 'RETRYING'; this.persist(c);
          i -= 1; // retry same step next loop
          continue;
        }
        c.status = 'FAILED'; c.failure = `${step.label}: ${res.failure?.message || res.status}`; c.updatedAt = Date.now(); this.persist(c);
        eventBus.emit('task.failed', 'TaskManager', { taskId, step: step.label, reason: c.failure });
        return;
      }

      const done = this.tasks.get(taskId)!;
      if (!done.cancelRequested) { done.status = 'COMPLETED'; done.updatedAt = Date.now(); this.persist(done); eventBus.emit('task.completed', 'TaskManager', { taskId, goal: done.goal }); }
      else { done.status = 'CANCELLED'; done.updatedAt = Date.now(); this.persist(done); }
    } finally {
      this.running.delete(taskId);
    }
  }
}

export const taskManager = new TaskManager();
