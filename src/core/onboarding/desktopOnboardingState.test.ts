import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOnboarding, completeOnboarding, statePath, FILE } from '../../../electron/onboardingState.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'akan-onboard-'));

test('missing state file => NOT onboarded, not recoverable', () => {
  const r = readOnboarding(tmp());
  assert.equal(r.onboarded, false);
  assert.equal(r.recoverable, false);
});

test('completeOnboarding persists durably and readOnboarding reflects it', () => {
  const dir = tmp();
  const res = completeOnboarding(dir, '3.0.0');
  assert.equal(res.onboarded, true);
  assert.ok(existsSync(statePath(dir)), 'onboarding-state.json written to userData');
  const r = readOnboarding(dir);
  assert.equal(r.onboarded, true);
  assert.equal(r.version, 1);
  assert.equal(typeof r.completedAt, 'string');
  // No secrets stored.
  assert.doesNotMatch(readFileSync(statePath(dir), 'utf8').toLowerCase(), /api[_-]?key|token|secret|passwor/);
});

test('malformed state file => recoverable, never silently complete', () => {
  const dir = tmp();
  writeFileSync(join(dir, FILE), '{ this is not json ', 'utf8');
  const r = readOnboarding(dir);
  assert.equal(r.onboarded, false);
  assert.equal(r.recoverable, true);
});

test('atomic write leaves no temp file behind', () => {
  const dir = tmp();
  completeOnboarding(dir, '3.0.0');
  const leftovers = readdirSync(dir).filter((f) => f.endsWith('.tmp'));
  assert.equal(leftovers.length, 0);
});
