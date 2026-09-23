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

test('local/free AI phrasings resolve deterministically without a model', () => {
  assert.deepEqual(mapToAiModePhrase('use local AI'), { mode: 'offline' });
  assert.deepEqual(mapToAiModePhrase('switch to local'), { mode: 'offline' });
  assert.deepEqual(mapToAiModePhrase('use free AI'), { mode: 'cloud' });
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

import { parseModelFlowCommand } from '@/core/models/AiModeCommands';

test('guided offline flow: show-recommendations phrasings', () => {
  assert.equal(parseModelFlowCommand('show recommended models'), 'show-recommendations');
  assert.equal(parseModelFlowCommand('what models can I install'), 'show-recommendations');
  assert.equal(parseModelFlowCommand('show me the best models for this device'), 'show-recommendations');
  // REGRESSION: these previously fell through to the desktop planner and failed.
  assert.equal(parseModelFlowCommand('what are the best model u recommend to install'), 'show-recommendations');
  assert.equal(parseModelFlowCommand('which model should I install'), 'show-recommendations');
  assert.equal(parseModelFlowCommand('recommend a model'), 'show-recommendations');
  assert.equal(parseModelFlowCommand('best model to install'), 'show-recommendations');
});

test('guided offline flow: install phrasings', () => {
  assert.equal(parseModelFlowCommand('install recommended model'), 'install-recommended');
  assert.equal(parseModelFlowCommand('install this'), 'install-recommended');
  assert.equal(parseModelFlowCommand('yes install it'), 'install-recommended');
});

test('guided offline flow: unrelated text is neither', () => {
  assert.equal(parseModelFlowCommand('open notepad'), null);
  assert.equal(parseModelFlowCommand('what is a model'), null);
  // A definitional question with no install/recommend intent must reach the model, not the recommender.
  assert.equal(parseModelFlowCommand('what is a good model for coding'), null);
});
