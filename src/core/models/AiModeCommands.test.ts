import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapToAiModePhrase } from '@/core/models/AiModeCommands';

test('offline mode phrasings map to the real policy switch', () => {
  assert.deepEqual(mapToAiModePhrase('enable offline mode'), { mode: 'offline' });
  assert.deepEqual(mapToAiModePhrase('go offline'), { mode: 'offline' });
  assert.deepEqual(mapToAiModePhrase('switch to offline'), { mode: 'offline' });
  assert.deepEqual(mapToAiModePhrase('Please use offline AI mode.'), { mode: 'offline' });
});

test('online/cloud phrasings map to cloud mode', () => {
  assert.deepEqual(mapToAiModePhrase('go online'), { mode: 'cloud' });
  assert.deepEqual(mapToAiModePhrase('enable online mode'), { mode: 'cloud' });
  assert.deepEqual(mapToAiModePhrase('switch to cloud'), { mode: 'cloud' });
});

test('both/auto map through', () => {
  assert.deepEqual(mapToAiModePhrase('set both mode'), { mode: 'both' });
  assert.deepEqual(mapToAiModePhrase('use auto'), { mode: 'auto' });
});

test('questions ABOUT modes are never treated as commands', () => {
  assert.equal(mapToAiModePhrase('what is offline mode'), null);
  assert.equal(mapToAiModePhrase('how do I enable offline mode?'), null);
  assert.equal(mapToAiModePhrase('can you enable offline mode and open notepad then email bob'), null);
});

test('unrelated text never matches', () => {
  assert.equal(mapToAiModePhrase('open notepad'), null);
  assert.equal(mapToAiModePhrase('the office is on fire'), null);
  assert.equal(mapToAiModePhrase(''), null);
});
