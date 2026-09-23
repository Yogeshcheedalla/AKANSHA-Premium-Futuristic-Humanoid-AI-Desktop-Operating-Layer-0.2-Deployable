import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executionVerifier } from './ExecutionVerifier';
import { executionPlanner } from './ExecutionPlanner';
import { executionEngine } from './ExecutionEngine';
import type { ComputerUseProvider, ExecutionPlan, ExecutionStep, WindowObservation, ProcessCloseResult } from './types';

// ── Verification: exact content, not substring-of-garbage ────────────────────
const step = (expect: ExecutionStep['expect']): ExecutionStep =>
  ({ id: 's', action: { kind: 'type', text: 'x' }, description: 'd', expect, status: 'PENDING', attemptCount: 0 });

test('textEquals passes on exact content and ignores whitespace/case differences', () => {
  const v = executionVerifier.verify(step({ textEquals: 'Hello World' }), { found: true, text: '  hello   world  ' });
  assert.equal(v.passed, true);
  assert.equal(v.method, 'visible-text-exact');
});

test('REGRESSION: textEquals REJECTS garbled/duplicated text that merely contains the phrase', () => {
  const garbage = 'hello world pgram inchello wd program in hello world program in c';
  const v = executionVerifier.verify(step({ textEquals: 'hello world program in c' }), { found: true, text: garbage });
  assert.equal(v.passed, false, 'a substring of garbage must not verify as success');
});

// ── Planner: authoring request → generate; literal → exact verify ────────────
test('authoring request is flagged generate (content produced later), not typed literally', () => {
  const plan = executionPlanner.plan('open notepad and write hello world program in c', 'low', [], false);
  assert.ok(plan);
  const typeStep = plan!.steps.find((s) => s.action.kind === 'type');
  assert.equal(typeStep?.generate, true);
  assert.equal(typeStep?.expect, undefined, 'expect is set only after real content is generated');
});

test('quoted literal is typed verbatim and verified by exact content', () => {
  const plan = executionPlanner.plan('open notepad and write "buy milk"', 'low', [], false);
  const typeStep = plan!.steps.find((s) => s.action.kind === 'type');
  assert.ok(!typeStep?.generate);
  assert.equal((typeStep?.expect as any)?.textEquals, 'buy milk');
});

// ── Engine: the effectful action is applied EXACTLY ONCE (no duplicate typing) ─
class FakeProvider implements ComputerUseProvider {
  id = 'fake';
  typeCalls = 0;
  private text = '';
  constructor(private readonly typedText: string, private readonly observedText: string) {}
  async isAvailable() { return true; }
  async launch(): Promise<WindowObservation> { return { found: true }; }
  async close(): Promise<ProcessCloseResult> { return { wasRunning: false, closed: false, remainingPids: [] }; }
  async focus(): Promise<WindowObservation> { return { found: true }; }
  async observe(): Promise<WindowObservation> { return { found: true, text: this.observedText }; }
  async type(text: string): Promise<WindowObservation> { this.typeCalls++; this.text = text; return { found: true, text: this.observedText }; }
  async key(): Promise<WindowObservation> { return { found: true }; }
  async click(): Promise<WindowObservation> { return { found: true }; }
  async scroll(): Promise<WindowObservation> { return { found: true }; }
  async listWindows() { return []; }
}

const oneTypeStep = (expect: ExecutionStep['expect']): ExecutionPlan => ({
  goal: 'g', riskTier: 'low', permissions: [], requiresConfirmation: false,
  steps: [{ id: 's1', action: { kind: 'type', text: 'X', target: 'notepad' }, description: 'type', expect, status: 'PENDING', attemptCount: 0 }],
});

test('verified type applies the action once', async () => {
  const p = new FakeProvider('X', 'X');
  const res = await executionEngine.execute(oneTypeStep({ textEquals: 'X' }), p, { requestId: 'r', missionId: 'm' });
  assert.equal(res.status, 'COMPLETED');
  assert.equal(p.typeCalls, 1);
});

test('REGRESSION: a type that fails verification is NOT re-applied (no duplicate text)', async () => {
  const p = new FakeProvider('X', 'wrong'); // observed never matches
  const res = await executionEngine.execute(oneTypeStep({ textEquals: 'X' }), p, { requestId: 'r', missionId: 'm2' });
  assert.equal(res.status, 'FAILED');
  assert.equal(p.typeCalls, 1, 'must type exactly once even across verify retries — the old loop re-typed 3x');
});
