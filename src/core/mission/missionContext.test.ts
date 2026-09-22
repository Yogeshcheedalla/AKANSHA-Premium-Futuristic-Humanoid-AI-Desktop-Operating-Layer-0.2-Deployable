import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveReferences, classifyTurn, MissionContext } from './missionContext';

test('resolveReferences maps pronouns to the most recent relevant artifact', () => {
  const arts = [
    { kind: 'code' as const, value: 'ReverseString.java', label: 'program', at: 1 },
    { kind: 'entity' as const, value: 'Rahul Kumar', label: 'contact', at: 2 },
  ];
  assert.equal(resolveReferences('save it as ReverseString.java', arts).resolved.includes('ReverseString.java'), true);
  assert.equal(resolveReferences('message him about it', arts).resolved.includes('Rahul Kumar'), true);
});

test('resolveReferences is a no-op when there is nothing to resolve to', () => {
  const r = resolveReferences('open notepad', []);
  assert.equal(r.substituted, false);
  assert.equal(r.resolved, 'open notepad');
});

test('classifyTurn distinguishes task / mission / clarification / correction / cancel / question', () => {
  assert.equal(classifyTurn('open notepad'), 'TASK');
  assert.equal(classifyTurn('create a java program, save it, and send it to Rahul'), 'MISSION');
  assert.equal(classifyTurn('what time is it?'), 'QUESTION');
  assert.equal(classifyTurn('stop'), 'CANCELLATION');
  assert.equal(classifyTurn('WhatsApp', { hasActiveMission: true, awaiting: { resumeKey: 'x', question: 'which platform?', field: 'platform', options: ['WhatsApp', 'email'] } }), 'CLARIFICATION_RESPONSE');
  assert.equal(classifyTurn('no, I meant Telegram', { hasActiveMission: true }), 'CORRECTION');
});

test('MissionContext remembers artifacts and resolves follow-up references', () => {
  const m = new MissionContext();
  m.remember('file', 'ReverseString.java', 'the java program');
  const { resolved, substituted } = m.resolve('send it to Rahul');
  assert.equal(substituted, true);
  assert.equal(resolved.includes('ReverseString.java'), true);
});

test('MissionContext awaiting round-trips', () => {
  const m = new MissionContext();
  m.awaitUser({ resumeKey: 'r1', question: 'Which Rahul?', field: 'recipient', options: ['Rahul Kumar', 'Rahul Reddy'] });
  assert.equal(m.getAwaiting()?.field, 'recipient');
  assert.equal(m.classify('Rahul Kumar'), 'CLARIFICATION_RESPONSE');
  m.clearAwaiting();
  assert.equal(m.getAwaiting(), null);
});
