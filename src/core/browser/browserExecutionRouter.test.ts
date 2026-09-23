import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planBrowserTask, chooseStrategy, requestsSecurityBypass, DEFAULT_ENGINES,
  type EngineAvailability, type BrowserTask,
} from './browserExecutionRouter';
import type { ModelCandidate } from '../routing/modelSelection';

const withEngines = (over: Partial<EngineAvailability>): EngineAvailability => ({ ...DEFAULT_ENGINES, ...over });

const freeTool: ModelCandidate = { providerId: 'pollinations', modelId: 'free-chat', costTier: 'free', local: false, capabilities: { chat: true, toolCalling: true, vision: true }, health: 'READY' };
const paidTool: ModelCandidate = { providerId: 'openai', modelId: 'gpt-5', costTier: 'paid', local: false, capabilities: { chat: true, toolCalling: true, vision: true }, health: 'READY' };

test('execution hierarchy: public API first, else open, else deterministic DOM for known pages', () => {
  const e = withEngines({ 'dom-deterministic': true, 'ai-assisted': true });
  assert.equal(chooseStrategy({ goal: 'get data', hasPublicApi: true }, e), 'direct-api');
  assert.equal(chooseStrategy({ goal: 'open youtube', url: 'https://youtube.com' }, e), 'browser-open');
  assert.equal(chooseStrategy({ goal: 'read this known page', needsRead: true, unknownPage: false }, e), 'dom-deterministic');
});

test('escalation honors the hierarchy: visual-form > ai-assisted > goal-agent', () => {
  // Complex visual form → Skyvern (even though ai-assisted is available).
  const eVisual = withEngines({ 'dom-deterministic': true, 'ai-assisted': true, 'visual-form': true });
  assert.equal(chooseStrategy({ goal: 'fill complex form', needsFormFill: true, unknownPage: true, visualComplexity: true }, eVisual), 'visual-form');
  // Unknown read page → Stagehand (ai-assisted) before goal-agent.
  const eUnknown = withEngines({ 'dom-deterministic': true, 'ai-assisted': true, 'goal-agent': true });
  assert.equal(chooseStrategy({ goal: 'read unknown page', needsRead: true, unknownPage: true }, eUnknown), 'ai-assisted');
  // Page-control on an unfamiliar site, Stagehand not installed → Browser Use (goal-agent).
  const eGoal = withEngines({ 'dom-deterministic': true, 'ai-assisted': false, 'goal-agent': true });
  assert.equal(chooseStrategy({ goal: 'click through unfamiliar site', needsPageControl: true, unknownPage: true }, eGoal), 'goal-agent');
});

test('browser identity is a HARD constraint — never substituted', () => {
  const plan = planBrowserTask({ goal: 'open youtube in brave', url: 'https://youtube.com', hardBrowser: 'brave' }, { policy: 'AUTO', allowBrowserFallback: false });
  assert.equal(plan.browser, 'brave');
  assert.equal(plan.strategy, 'browser-open');
  assert.equal(plan.executable, true); // browser-open is wired
});

test('REGRESSION: never bypass CAPTCHA / 2FA / auth — blocked + needsUser, not executed', () => {
  assert.equal(requestsSecurityBypass('bypass the captcha on this site'), 'CAPTCHA');
  assert.equal(requestsSecurityBypass('skip 2fa to log in'), 'TWO_FA');
  assert.equal(requestsSecurityBypass('defeat the paywall'), 'AUTH_WALL');
  const plan = planBrowserTask({ goal: 'bypass the captcha and read the page', needsRead: true }, { policy: 'AUTO' });
  assert.equal(plan.executable, false);
  assert.equal(plan.needsUser, true);
  assert.ok(plan.blocked);
});

test('FREE_ONLY never selects a paid browser model — reports NO_ELIGIBLE_MODEL', () => {
  const plan = planBrowserTask(
    { goal: 'read this unknown page and summarize', needsRead: true, unknownPage: true },
    { policy: 'FREE_ONLY', engines: withEngines({ 'ai-assisted': true }), candidates: [paidTool] },
  );
  assert.equal(plan.blocked, 'NO_ELIGIBLE_MODEL');
  assert.equal(plan.executable, false);
});

test('a paid model under a permissive policy requires explicit consent (never silent spend)', () => {
  const plan = planBrowserTask(
    { goal: 'read this unknown page and summarize', needsRead: true, unknownPage: true },
    { policy: 'BEST_AVAILABLE', engines: withEngines({ 'ai-assisted': true }), candidates: [paidTool] },
  );
  assert.equal(plan.requiresPaidConsent, true);
  assert.equal(plan.needsUser, true);
  assert.equal(plan.executable, false, 'not executed until consent is granted');
  assert.equal(plan.model?.costTier, 'paid');
});

test('free model + installed engine → executable, no consent needed', () => {
  const plan = planBrowserTask(
    { goal: 'read this unknown page and summarize', needsRead: true, unknownPage: true },
    { policy: 'FREE_ONLY', engines: withEngines({ 'ai-assisted': true }), candidates: [freeTool] },
  );
  assert.equal(plan.executable, true);
  assert.equal(plan.requiresPaidConsent, false);
  assert.equal(plan.model?.providerId, 'pollinations');
});

test('HONESTY: interactive engines not installed → not executable (ENGINE_UNAVAILABLE), never faked', () => {
  const plan = planBrowserTask(
    { goal: 'click the subscribe button', needsPageControl: true, unknownPage: true },
    { policy: 'AUTO', engines: DEFAULT_ENGINES, candidates: [freeTool] },
  );
  assert.equal(plan.executable, false);
  assert.equal(plan.blocked, 'ENGINE_UNAVAILABLE');
});

test('fallback chain lists only later strategies that are actually available', () => {
  const plan = planBrowserTask(
    { goal: 'read known page', needsRead: true, unknownPage: false },
    { policy: 'AUTO', engines: withEngines({ 'dom-deterministic': true, 'ai-assisted': true, 'computer-use': false }) },
  );
  assert.equal(plan.strategy, 'dom-deterministic');
  assert.ok(plan.fallbackChain.includes('ai-assisted'));
  assert.ok(!plan.fallbackChain.includes('computer-use'));
});
