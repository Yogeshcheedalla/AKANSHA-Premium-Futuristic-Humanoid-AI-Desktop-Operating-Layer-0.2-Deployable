import { test } from 'node:test';
import assert from 'node:assert/strict';

import { intentEngine } from '@/core/intent/IntentEngine';
import { riskEngine } from '@/core/security/RiskEngine';
import { credentialVault } from '@/core/security/CredentialVault';
import { resourceGovernor } from '@/core/resources/ResourceGovernor';
import { masterOrchestrator } from '@/core/orchestration/MasterOrchestrator';
import { inferCapabilitiesFromId, classifyTaskRequirement } from '@/integrations/models/CapabilityInference';

/* ── Intent classification (regression: the old "and" catch-all) ───────── */
test('intent: greetings are conversation, never execution', () => {
  assert.equal(intentEngine.detect('Hi').intent, 'conversation');
  assert.equal(intentEngine.detect('How are you?').intent, 'conversation');
  assert.equal(intentEngine.detect('Good morning').intent, 'conversation');
});

test('intent: arithmetic with "and" is NOT a mission (old bug)', () => {
  // Previously any string containing "and" was misrouted to mission.
  assert.equal(intentEngine.detect('What is 2 and 3?').intent, 'information_request');
});

test('intent: single command vs multi-step mission', () => {
  assert.equal(intentEngine.detect('Open Notepad').intent, 'command');
  assert.equal(intentEngine.detect('Open Notepad and write this note').intent, 'mission');
  assert.equal(intentEngine.detect('Create a report').intent, 'mission');
});

test('intent: research, coding, information_request', () => {
  assert.equal(intentEngine.detect('Search for the latest information about Kubernetes').intent, 'research');
  assert.equal(intentEngine.detect('Build this feature for me').intent, 'coding');
  assert.equal(intentEngine.detect('Explain Kubernetes simply').intent, 'information_request');
});

test('intent: destructive verbs are treated as actions (so risk gate fires)', () => {
  assert.equal(intentEngine.detect('format the disk drive').intent, 'command');
});

/* ── Risk engine hard rules ───────────────────────────────────────────── */
test('risk: irreversible storage destruction is DENIED', () => {
  assert.equal(riskEngine.assess('format the disk drive', { confidence: 1 }).action, 'DENY');
});

test('risk: financial + credential actions require confirmation', () => {
  assert.equal(riskEngine.assess('send money for the invoice', { confidence: 1 }).action, 'STRONG_CONFIRMATION');
  assert.equal(riskEngine.assess('read the api key', { confidence: 1 }).action, 'STRONG_CONFIRMATION');
});

test('risk: benign launch stays automatic', () => {
  assert.equal(riskEngine.assess('open Notepad', { irreversibility: 0.05, confidence: 0.95 }).action, 'AUTOMATIC');
});

/* ── Credential vault round-trip (works without a database) ───────────── */
test('vault: put/resolve round-trips a secret; mask never leaks it', () => {
  const ref = credentialVault.put('sk-test-1234567890abcdef');
  assert.equal(credentialVault.resolve(ref), 'sk-test-1234567890abcdef');
  assert.ok(credentialVault.exists(ref));
  const masked = credentialVault.mask(ref) || '';
  assert.ok(masked.startsWith('sk-t'));
  assert.ok(!masked.includes('1234567890'));
});

test('vault: unknown ref resolves to null (never throws)', () => {
  assert.equal(credentialVault.resolve('cred_does_not_exist'), null);
});

/* ── Resource governor: begin/finish pairing (leak fix) ───────────────── */
test('governor: budget is allocated on begin and released on finish', () => {
  const id = 'req-leak-test';
  resourceGovernor.begin(id, resourceGovernor.budgetFor('tier2'));
  assert.equal(resourceGovernor.usageFor(id).budget.tokenBudget, 8000);
  resourceGovernor.finish(id);
  assert.equal(resourceGovernor.usageFor(id).tokensUsed, 0);
});

/* ── Orchestrator honesty: NO EVIDENCE = NO SUCCESS ───────────────────── */
test('orchestrator: an action intent never fakes success (no evidence = no COMPLETED)', async () => {
  const mission = await masterOrchestrator.createMission('please take care of the thing', { intent: 'command', requestId: 'req-orch-1' });
  const result = await masterOrchestrator.runMission(mission.id);
  assert.notEqual(result.status, 'COMPLETED');
  assert.ok(result.context.failureClass, 'must report an honest failureClass, not silent success');
  assert.ok(!/completed and verified/i.test(String(result.context.reply)));
});

test('orchestrator: a refused action is REFUSED, not faked as success', async () => {
  const mission = await masterOrchestrator.createMission('format the disk drive', { intent: 'command', requestId: 'req-orch-2' });
  const result = await masterOrchestrator.runMission(mission.id);
  assert.equal(result.status, 'REFUSED');
});

/* ── Model capability selection (regression: embeddings chosen for chat) ─ */
test('capabilities: non-chat models are never chat-capable', () => {
  const allTrue = { chat: true, reasoning: true, vision: true, tools: true, streaming: true, embeddings: true };
  assert.equal(inferCapabilitiesFromId('text-embedding-ada-002', allTrue).chat, false);
  assert.equal(inferCapabilitiesFromId('whisper-1', allTrue).chat, false);
  assert.equal(inferCapabilitiesFromId('tts-1', allTrue).chat, false);
  assert.equal(inferCapabilitiesFromId('dall-e-3', allTrue).chat, false);
});

test('capabilities: real chat models remain chat-capable', () => {
  const allTrue = { chat: true, reasoning: true, vision: true, tools: true, streaming: true, embeddings: true };
  assert.equal(inferCapabilitiesFromId('gpt-4o', allTrue).chat, true);
  assert.equal(inferCapabilitiesFromId('claude-3-5-sonnet', allTrue).chat, true);
  assert.equal(inferCapabilitiesFromId('llama-3.1-8b-instruct', allTrue).chat, true);
});

test('capabilities: task requirement classification', () => {
  assert.equal(classifyTaskRequirement('research').reasoning, true);
  assert.equal(classifyTaskRequirement('coding').coding, true);
});
