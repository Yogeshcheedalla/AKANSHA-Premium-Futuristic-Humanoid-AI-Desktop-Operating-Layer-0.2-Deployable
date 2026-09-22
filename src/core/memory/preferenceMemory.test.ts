import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PreferenceMemory } from './preferenceMemory';

test('explicit current instruction always overrides stored memory', () => {
  const m = new PreferenceMemory();
  m.set('delivery', 'platform', 'email');
  const r = m.resolve('delivery', 'platform', 'Telegram');
  assert.deepEqual(r, { value: 'Telegram', source: 'explicit' });
});

test('stored preference is used when the request is silent', () => {
  const m = new PreferenceMemory();
  m.set('delivery', 'format', 'pdf');
  assert.deepEqual(m.resolve('delivery', 'format'), { value: 'pdf', source: 'memory' });
});

test('no explicit and no memory => need-user (never guesses)', () => {
  const m = new PreferenceMemory();
  assert.equal(m.resolve('delivery', 'platform').source, 'need-user');
});

test('clear removes preferences so outdated memory cannot steer execution', () => {
  const m = new PreferenceMemory();
  m.set('delivery', 'platform', 'email');
  m.clear('delivery');
  assert.equal(m.has('delivery', 'platform'), false);
  assert.equal(m.resolve('delivery', 'platform').source, 'need-user');
});
