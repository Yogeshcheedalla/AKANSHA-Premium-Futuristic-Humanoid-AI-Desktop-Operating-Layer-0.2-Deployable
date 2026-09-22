import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capabilitiesFor, primaryCapability, missingDeliveryPlatform } from '../routing/capabilityRegistry';
import { planGoal, toTaskSteps } from './goalPlanner';
import { preferenceMemory } from '../memory/preferenceMemory';

test('capabilityRegistry maps natural language to capabilities', () => {
  assert.ok(capabilitiesFor('send this file to Rahul').includes('communication'));
  assert.ok(capabilitiesFor('research the latest AWS architecture').includes('webSearch'));
  assert.equal(primaryCapability('write a java program'), 'coding');
  assert.equal(missingDeliveryPlatform('send it to Rahul')?.field, 'platform');
  assert.equal(missingDeliveryPlatform('email it to Rahul'), null); // platform named
});

test('planGoal decomposes a chained goal and inserts a clarify for a missing platform', async () => {
  const subs = await planGoal('open notepad and send it to Rahul');
  assert.ok(subs.length >= 2);
  // Sequential dependency chain.
  assert.deepEqual(subs[1].dependsOn, [subs[0].id]);
  const clarify = subs.find((s) => s.clarify);
  assert.ok(clarify, 'expected a clarify subtask for the unspecified platform');
  assert.equal(clarify!.clarify!.field, 'platform');
});

test('toTaskSteps preserves the clarify step for TaskManager', async () => {
  const subs = await planGoal('open notepad and send it to Rahul');
  const steps = toTaskSteps(subs);
  assert.ok(steps.some((st) => st.kind === 'clarify' && st.field === 'platform'));
});

test('a single action stays a single subtask (no spurious task)', async () => {
  const subs = await planGoal('open notepad');
  assert.equal(subs.length, 1);
  assert.equal(subs[0].dependsOn.length, 0);
});

test('stored preference steers the platform (memory influences planning); unset still asks', async () => {
  preferenceMemory.set('delivery', 'platform', 'email');
  try {
    const subs = await planGoal('open notepad and send it to Rahul');
    assert.ok(!subs.some((s) => s.clarify), 'preference present -> no clarify');
    assert.ok(subs.some((s) => s.label === 'send via email'), 'uses stored platform');
  } finally {
    preferenceMemory.clear('delivery');
  }
  const back = await planGoal('open notepad and send it to Rahul');
  assert.ok(back.some((s) => s.clarify), 'no preference -> parks to ask');
});
