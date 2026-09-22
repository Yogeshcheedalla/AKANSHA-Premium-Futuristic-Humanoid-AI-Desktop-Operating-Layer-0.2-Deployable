import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emailPlatform, emailTransport, mailForArtifact } from './emailTransport';
import { sendFile } from './communicationCapability';

test('emailPlatform reflects the ACTUAL SMTP config (honest availability)', () => {
  const hadHost = process.env.SMTP_HOST; const hadUser = process.env.SMTP_USER; const hadFrom = process.env.SMTP_FROM;
  delete process.env.SMTP_HOST; delete process.env.SMTP_USER; delete process.env.SMTP_FROM;
  try {
    assert.equal(emailPlatform().configured, false);
  } finally {
    if (hadHost) process.env.SMTP_HOST = hadHost; if (hadUser) process.env.SMTP_USER = hadUser; if (hadFrom) process.env.SMTP_FROM = hadFrom;
  }
});

test('emailTransport returns null (NOT sent) when SMTP is not configured', async () => {
  const hadHost = process.env.SMTP_HOST; const hadUser = process.env.SMTP_USER; const hadFrom = process.env.SMTP_FROM;
  delete process.env.SMTP_HOST; delete process.env.SMTP_USER; delete process.env.SMTP_FROM;
  try {
    const r = await emailTransport({ id: 'email', label: 'Email', configured: false, requiresAuth: false }, { name: 'R', identifier: 'r@example.com' }, 'ReverseString.java');
    assert.equal(r, null);
  } finally {
    if (hadHost) process.env.SMTP_HOST = hadHost; if (hadUser) process.env.SMTP_USER = hadUser; if (hadFrom) process.env.SMTP_FROM = hadFrom;
  }
});

test('sendFile via an unconfigured email platform is CAPABILITY_UNAVAILABLE (never fake-sent)', async () => {
  const unconfigured = { id: 'email', label: 'Email (SMTP)', configured: false, requiresAuth: false };
  const out = await sendFile(unconfigured, { name: 'Rahul', identifier: 'r@example.com' }, 'ReverseString.java', async () => 'nope');
  assert.equal(out.status, 'CAPABILITY_UNAVAILABLE');
});

test('mailForArtifact builds a real message', () => {
  const m = mailForArtifact('r@example.com', 'ReverseString.java', 'here is the fix');
  assert.equal(m.to, 'r@example.com');
  assert.ok(m.text.includes('ReverseString.java'));
});
