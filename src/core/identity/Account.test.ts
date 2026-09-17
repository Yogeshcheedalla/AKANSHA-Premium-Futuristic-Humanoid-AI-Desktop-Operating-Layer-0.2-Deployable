import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAccountRepository } from '@/core/identity/Account';

const identity = (sub: string, email: string, name: string) => ({ sub, email, name });

test('Google identity is keyed by stable sub, NOT email (email change keeps the same account)', () => {
  const repo = new InMemoryAccountRepository();
  const first = repo.upsertFromGoogle(identity('sub-1', 'a@example.com', 'A'));
  assert.equal(first.id, 'acct_sub-1');

  // Same Google sub but the email + name changed on a later login: it must remain the
  // SAME account (spec: "Do not use email alone as the permanent primary identity").
  const again = repo.upsertFromGoogle(identity('sub-1', 'moved@example.com', 'A2'));
  assert.equal(again.id, 'acct_sub-1', 'identity is the googleSub, not the email');
  assert.equal(again.email, 'moved@example.com', 'profile refreshed in place');
  assert.ok(again.createdAt <= again.updatedAt);
  assert.ok(again.lastLoginAt >= again.createdAt);
});

test('Different sub with the SAME email is a different account; unknown subjects resolve to null', () => {
  const repo = new InMemoryAccountRepository();
  const a = repo.upsertFromGoogle(identity('sub-A', 'shared@example.com', 'A'));
  const b = repo.upsertFromGoogle(identity('sub-B', 'shared@example.com', 'B'));
  assert.notEqual(a.id, b.id, 'two Google subjects never collide just because the email matches');
  assert.ok(repo.findBySubject('sub-A'));
  assert.equal(repo.findBySubject('missing'), null);
});
