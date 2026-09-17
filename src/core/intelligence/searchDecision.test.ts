import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideSearch } from '@/core/intelligence/searchDecision';

test('educational question → MODEL_ONLY, no search', () => {
  const d = decideSearch('Explain recursion in one paragraph.');
  assert.equal(d.mode, 'MODEL_ONLY');
  assert.equal(d.requiresCurrentInfo, false);
});

test('current-information request → WEB_SEARCH when online', () => {
  const d = decideSearch('What is the latest Windows release?', { networkAvailable: true });
  assert.equal(d.mode, 'WEB_SEARCH');
  assert.equal(d.requiresCurrentInfo, true);
});

test('current-information request with NO network → honest NO_SEARCH, flagged', () => {
  const d = decideSearch('What is today\'s weather?', { networkAvailable: false });
  assert.equal(d.mode, 'NO_SEARCH');
  assert.equal(d.requiresCurrentInfo, true);
});

test('explicit search wording → WEB_SEARCH', () => {
  const d = decideSearch('Find me the official OpenRouter documentation.', { networkAvailable: true });
  assert.equal(d.mode, 'WEB_SEARCH');
});

test('memory recall → LOCAL_KNOWLEDGE (no web)', () => {
  assert.equal(decideSearch('What did I tell you about my project?').mode, 'LOCAL_KNOWLEDGE');
  assert.equal(decideSearch('anything', { hasMemoryHit: true }).mode, 'LOCAL_KNOWLEDGE');
});

test('desktop action verb → DESKTOP_ACTION (not a search)', () => {
  assert.equal(decideSearch('Open Notepad and type hello').mode, 'DESKTOP_ACTION');
});

test('never fabricates a search: empty input → NO_SEARCH', () => {
  assert.equal(decideSearch('   ').mode, 'NO_SEARCH');
});
