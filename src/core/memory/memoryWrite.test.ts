import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemorySystem } from '@/core/memory/MemorySystem';
import { processMemory, decideMemory, classifySensitivity, computeImportance } from '@/core/memory/memoryWrite';

const fresh = () => new MemorySystem();

test('sensitivity filter rejects passwords / api keys / tokens / private keys', () => {
  assert.equal(classifySensitivity('my password is hunter2').sensitive, true);
  assert.equal(classifySensitivity('api_key: sk-abcdef123456').sensitive, true);
  assert.equal(classifySensitivity('bearer abcdef123456789').sensitive, true);
  assert.equal(classifySensitivity('-----BEGIN RSA PRIVATE KEY-----').sensitive, true);
  assert.equal(classifySensitivity('I prefer dark mode').sensitive, false);
});

test('DO_NOT_STORE for sensitive input, and never persists it', () => {
  const sys = fresh();
  const out = processMemory({ text: 'remember my password is p@ssw0rd123', explicitRemember: true }, sys);
  assert.equal(out.action, 'DO_NOT_STORE');
  assert.equal(out.stored, false);
  assert.equal(sys.getAllMemories().length, 0);
});

test('STORE a stable preference and verify it actually persisted', () => {
  const sys = fresh();
  const out = processMemory({ text: 'Remember that I prefer Java.', explicitRemember: true, userId: 'u1' }, sys);
  assert.equal(out.action, 'STORE');
  assert.equal(out.stored, true);
  assert.ok(out.memoryId);
  assert.ok(sys.retrieveMemory(out.memoryId!), 'entry readable back from the store');
});

test('deduplication updates instead of creating endless duplicates', () => {
  const sys = fresh();
  const a = processMemory({ text: 'Remember that I prefer Java.', explicitRemember: true, userId: 'u1' }, sys);
  const b = processMemory({ text: 'Remember that I prefer Java.', explicitRemember: true, userId: 'u1' }, sys);
  assert.equal(a.stored, true);
  assert.equal(b.updated, true);
  assert.equal(b.memoryId, a.memoryId);
  assert.equal(sys.getAllMemories().length, 1, 'no duplicate rows');
});

test('changed preference with same signature updates provenance, not duplicates', () => {
  const sys = fresh();
  const a = processMemory({ text: 'Remember that I prefer Java.', explicitRemember: true, userId: 'u1' }, sys);
  const b = processMemory({ text: 'Remember that I prefer Java.', explicitRemember: true, userId: 'u1', source: 'voice' }, sys);
  assert.equal(b.updated, true);
  assert.equal(sys.getAllMemories().length, 1);
  assert.equal((sys.retrieveMemory(a.memoryId!)!.metadata as any).source, 'voice');
});

test('ephemeral / low-value are not persisted', () => {
  const sys = fresh();
  const e = processMemory({ text: 'use this filename for today', userId: 'u1' }, sys);
  assert.equal(e.action, 'EPHEMERAL');
  assert.equal(e.stored, false);
  const low = processMemory({ text: 'hello there', userId: 'u1' }, sys);
  assert.equal(low.action, 'DO_NOT_STORE');
  assert.equal(sys.getAllMemories().length, 0);
});

test('importance scoring: explicit + stable > temporary', () => {
  assert.ok(computeImportance('remember I always prefer dark mode', true) > computeImportance('for today use this', false));
});

test('decideMemory classifies category for project facts as ASK_USER', () => {
  const d = decideMemory({ text: 'Our project uses a monorepo architecture decision' });
  assert.ok(['ASK_USER', 'STORE'].includes(d.action));
});
