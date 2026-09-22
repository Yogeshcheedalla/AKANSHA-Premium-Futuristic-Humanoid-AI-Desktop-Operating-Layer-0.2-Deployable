import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeGoal, detectCapabilities, honestCapabilityNote, CAPABILITY_MATURITY } from './semanticUnderstanding';

test('a simple wired action is fully executable (open notepad → desktop)', () => {
  const p = analyzeGoal('open notepad');
  assert.ok(p.requirements.some((r) => r.id === 'desktop'));
  assert.ok(p.executable.includes('desktop'));
  assert.equal(p.blocked.length, 0);
  assert.equal(p.fullyExecutable, true);
  assert.equal(honestCapabilityNote(p), '');
});

test('REGRESSION: the composite research goal is understood as MULTI-capability, not "open youtube"', () => {
  const goal = 'Open YouTube and find the latest video about Apache Kafka, compare it with this repository, summarize the differences, and save the findings.';
  const caps = detectCapabilities(goal);
  // Must span several organs, not collapse to one command.
  assert.ok(caps.includes('browser'), 'browser');
  assert.ok(caps.includes('webSearch'), 'web research');
  assert.ok(caps.includes('pageUnderstanding'), 'read the page/video');
  assert.ok(caps.includes('repoInspection'), 'inspect the repository');
  assert.ok(caps.includes('filesystem'), 'save the findings');

  const p = analyzeGoal(goal);
  assert.equal(p.fullyExecutable, false, 'cannot fully run: research/page/repo organs are not wired');
  assert.ok(p.blocked.includes('webSearch'));
  assert.ok(p.blocked.includes('pageUnderstanding'));
  assert.ok(p.blocked.includes('repoInspection'));
  assert.ok(p.executable.includes('browser'));
  assert.ok(p.executable.includes('filesystem'));
  assert.equal(p.modelRequirements.reasoning, true, 'summarize/compare → reasoning');
  assert.equal(p.modelRequirements.coding, true, 'repository → coding');
});

test('honest note names the unwired organs and never claims they work', () => {
  const note = honestCapabilityNote(analyzeGoal('Open YouTube, read the page and summarize the differences'));
  assert.match(note, /won't pretend|I can't/i);
  assert.match(note, /web page|repository|research/i);
});

test('OFFLINE_ONLY policy blocks network organs rather than silently going online', () => {
  const p = analyzeGoal('open youtube', 'OFFLINE_ONLY');
  const browser = p.requirements.find((r) => r.id === 'browser');
  assert.equal(browser!.status, 'BLOCKED_BY_POLICY');
  assert.ok(p.blocked.includes('browser'));
});

test('communication without a platform parks for the user (NEEDS_USER), never guesses', () => {
  const p = analyzeGoal('send this to Rahul');
  const comm = p.requirements.find((r) => r.id === 'communication');
  assert.ok(comm);
  assert.equal(comm!.status, 'NEEDS_USER');
  assert.ok(p.needsUser.includes('communication'));
});

test('maturity ledger is truthful: planned organs are never marked available', () => {
  for (const [id, m] of Object.entries(CAPABILITY_MATURITY)) {
    if (m === 'planned') {
      const p = analyzeGoal(`please do ${id}`, 'AUTO');
      const req = p.requirements.find((r) => r.id === id);
      if (req) assert.notEqual(req.status, 'AVAILABLE', `${id} must not be AVAILABLE while planned`);
    }
  }
});
