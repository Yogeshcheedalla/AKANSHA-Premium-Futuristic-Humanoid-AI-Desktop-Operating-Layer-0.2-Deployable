import { test } from 'node:test';
import assert from 'node:assert/strict';
import { smtpConfig, isSmtpConfigured, sendMail, type TransportLike } from '@/core/email/mailService';

const cfgEnv = { SMTP_HOST: 'smtp.example.com', SMTP_PORT: '465', SMTP_SECURE: 'true', SMTP_USER: 'u', SMTP_PASS: 'SECRET123', SMTP_FROM: 'a@b.co', SMTP_FROM_NAME: 'Akansha' } as any;

test('smtpConfig: port 465 => implicit TLS (secure true); 587 => STARTTLS (secure false)', () => {
  assert.equal(smtpConfig({ SMTP_PORT: '465' } as any).secure, true);
  assert.equal(smtpConfig({ SMTP_PORT: '587', SMTP_SECURE: 'false' } as any).secure, false);
});

test('isSmtpConfigured requires host + user + from', () => {
  assert.equal(isSmtpConfigured({} as any), false);
  assert.equal(isSmtpConfigured({ SMTP_HOST: 'h', SMTP_USER: 'u' } as any), false); // no from
  assert.equal(isSmtpConfigured(cfgEnv), true);
});

test('sendMail: not configured => NOT_CONFIGURED (no throw, no fake)', async () => {
  const r = await sendMail({ to: 'x@y.z', subject: 's', text: 't' }, { env: {} as any });
  assert.equal(r.ok, false);
  assert.equal(r.status, 'NOT_CONFIGURED');
});

test('sendMail: configured + transport => SENT with messageId', async () => {
  const transport: TransportLike = { verify: async () => true, sendMail: async () => ({ messageId: 'mid-1' }) };
  const r = await sendMail({ to: 'x@y.z', subject: 's', text: 't' }, { env: cfgEnv, transport });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'SENT');
  assert.equal(r.messageId, 'mid-1');
});

test('sendMail: failure is redacted — SMTP password never appears in the error', async () => {
  const transport: TransportLike = { verify: async () => true, sendMail: async () => { throw new Error('auth failed pass=SECRET123 user=u'); } };
  const r = await sendMail({ to: 'x@y.z', subject: 's', text: 't' }, { env: cfgEnv, transport });
  assert.equal(r.ok, false);
  assert.equal(r.status, 'FAILED');
  assert.ok(!JSON.stringify(r).includes('SECRET123'), 'credential must be redacted from errors');
});

test('sendMail: configured but no transport => TRANSPORT_UNAVAILABLE', async () => {
  const r = await sendMail({ to: 'x@y.z', subject: 's', text: 't' }, { env: cfgEnv, transport: null });
  assert.equal(r.ok, false);
  assert.equal(r.status, 'TRANSPORT_UNAVAILABLE');
});
