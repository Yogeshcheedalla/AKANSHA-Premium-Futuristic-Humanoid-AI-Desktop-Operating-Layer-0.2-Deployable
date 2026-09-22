import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveContact, sendFile, availablePlatforms, type Contact, type Platform } from './communicationCapability';

const DIR: Contact[] = [
  { name: 'Rahul Kumar', identifier: 'rahul.kumar92@example.com' },
  { name: 'Rahul Reddy', identifier: '+91-90000-00002' },
  { name: 'Rahul Sharma', identifier: 'rahul.sharma' },
  { name: 'Priya N', identifier: 'priya@example.com' },
];

test('resolveContact returns AMBIGUOUS with all exact matches (never guesses)', () => {
  const r = resolveContact('Rahul', DIR);
  assert.equal(r.status, 'AMBIGUOUS');
  if (r.status === 'AMBIGUOUS') assert.equal(r.matches.length, 3);
});

test('resolveContact resolves a unique exact identifier', () => {
  const r = resolveContact('Rahul Kumar', DIR);
  assert.equal(r.status, 'RESOLVED');
  if (r.status === 'RESOLVED') assert.equal(r.contact.identifier, 'rahul.kumar92@example.com');
});

test('resolveContact NOT_FOUND for unknown', () => {
  assert.equal(resolveContact('Zaphod', DIR).status, 'NOT_FOUND');
});

test('availablePlatforms only lists configured platforms', () => {
  const plats: Platform[] = [
    { id: 'whatsapp', label: 'WhatsApp', configured: false, requiresAuth: true },
    { id: 'email', label: 'Email', configured: true, requiresAuth: false },
  ];
  assert.deepEqual(availablePlatforms(plats).map((p) => p.id), ['email']);
});

test('sendFile returns CAPABILITY_UNAVAILABLE when no platform is configured (never fake-sent)', async () => {
  const out = await sendFile(undefined, DIR[0], 'ReverseString.java', async () => 'should-not-run');
  assert.equal(out.status, 'CAPABILITY_UNAVAILABLE');
  assert.match(out.reason, /no delivery platform is configured/i);
});

test('sendFile SENT only when the transport returns a real confirmation', async () => {
  const email: Platform = { id: 'email', label: 'Email', configured: true, requiresAuth: false };
  const ok = await sendFile(email, DIR[0], 'ReverseString.java', async () => 'message-id:abc123');
  assert.equal(ok.status, 'SENT');
  const noConfirm = await sendFile(email, DIR[0], 'ReverseString.java', async () => null);
  assert.equal(noConfirm.status, 'CAPABILITY_UNAVAILABLE'); // "called" != "sent"
});
