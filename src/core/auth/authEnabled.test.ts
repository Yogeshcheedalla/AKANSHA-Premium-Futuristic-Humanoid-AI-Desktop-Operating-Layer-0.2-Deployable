import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.AKANSHA_SECRET = 'test-auth-secret';
import { auth } from '@/core/auth/session';

function withEnv(patch: Record<string, string | undefined>, fn: () => void) {
  const saved = { ...process.env };
  Object.assign(process.env, patch);
  try { fn(); } finally {
    for (const k of Object.keys(patch)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]!; }
  }
}

test('authEnabled: production ALWAYS enforces auth even if the disable flag is set', () => {
  withEnv({ NODE_ENV: 'production', AKANSHA_AUTH_DISABLED: 'true' }, () => {
    assert.equal(auth.authEnabled(), true, 'the dev bypass must never activate on a deployed build');
  });
});

test('authEnabled: local dev may disable auth only outside production', () => {
  withEnv({ NODE_ENV: 'development', AKANSHA_AUTH_DISABLED: 'true' }, () => {
    assert.equal(auth.authEnabled(), false);
  });
  withEnv({ NODE_ENV: 'development', AKANSHA_AUTH_DISABLED: undefined }, () => {
    assert.equal(auth.authEnabled(), true, 'on by default');
  });
});
