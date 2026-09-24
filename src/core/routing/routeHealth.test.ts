import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRouteError, isRetryable, isPermanentForRequest, toCachedHealth, COOLDOWN_MS,
} from './routeHealth';

test('401/403 → AUTH_REQUIRED (not retryable, permanent for the request)', () => {
  assert.equal(classifyRouteError('401 Unauthorized'), 'AUTH_REQUIRED');
  assert.equal(classifyRouteError('invalid api key provided'), 'AUTH_REQUIRED');
  assert.equal(classifyRouteError('rejected', 403), 'AUTH_REQUIRED');
  assert.equal(isRetryable('AUTH_REQUIRED'), false);
  assert.equal(isPermanentForRequest('AUTH_REQUIRED'), true);
});

test('billing/credits → QUOTA_EXHAUSTED, checked BEFORE generic 429', () => {
  // A "429 no credits" must be treated as permanent-ish quota, not a 30s rate limit.
  assert.equal(classifyRouteError('HTTP 429 insufficient credits / no billing'), 'QUOTA_EXHAUSTED');
  assert.equal(classifyRouteError('quota exceeded for this account', 429), 'QUOTA_EXHAUSTED');
  assert.equal(classifyRouteError('payment required', 402), 'QUOTA_EXHAUSTED');
  assert.equal(isRetryable('QUOTA_EXHAUSTED'), false);
});

test('plain 429 rate limit → RATE_LIMITED (retryable after cooldown)', () => {
  assert.equal(classifyRouteError('HTTP 429 Too Many Requests', 429), 'RATE_LIMITED');
  assert.equal(classifyRouteError('upstream rate_limited'), 'RATE_LIMITED');
  assert.equal(isRetryable('RATE_LIMITED'), true);
  assert.ok(COOLDOWN_MS.RATE_LIMITED > 0 && COOLDOWN_MS.RATE_LIMITED < COOLDOWN_MS.QUOTA_EXHAUSTED);
});

test('unknown/absent model → MODEL_UNAVAILABLE (retrying the same body is pointless)', () => {
  assert.equal(classifyRouteError('model not found', 404), 'MODEL_UNAVAILABLE');
  assert.equal(classifyRouteError('The model gpt-9 does not exist'), 'MODEL_UNAVAILABLE');
  assert.equal(isPermanentForRequest('MODEL_UNAVAILABLE'), true);
});

test('network/timeout/5xx → UNAVAILABLE', () => {
  assert.equal(classifyRouteError('fetch failed'), 'UNAVAILABLE');
  assert.equal(classifyRouteError('request timed out', 408), 'UNAVAILABLE');
  assert.equal(classifyRouteError('bad gateway', 502), 'UNAVAILABLE');
});

test('context overflow / bad request → DEGRADED (route is fine, request is not)', () => {
  assert.equal(classifyRouteError('maximum context length exceeded', 400), 'DEGRADED');
  assert.equal(classifyRouteError('this prompt is too long for the model', 400), 'DEGRADED');
});

test('HTTP status is parsed from the message text when no explicit status is passed', () => {
  assert.equal(classifyRouteError('Provider said: HTTP 429 slow down'), 'RATE_LIMITED');
  assert.equal(classifyRouteError('returned HTTP 503 upstream'), 'UNAVAILABLE');
});

test('toCachedHealth maps fine states back onto the coarse bootstrap vocabulary', () => {
  assert.equal(toCachedHealth('QUOTA_EXHAUSTED'), 'AUTH_REQUIRED');
  assert.equal(toCachedHealth('RATE_LIMITED'), 'RATE_LIMITED');
  assert.equal(toCachedHealth('MODEL_UNAVAILABLE'), 'DEGRADED');
  assert.equal(toCachedHealth('READY'), 'AVAILABLE');
  assert.equal(toCachedHealth('LOCAL_FALLBACK'), 'AVAILABLE');
});
